import { audioEngine } from './AudioEngine';

export type RecordingSource = 'mic' | 'resample' | 'video';

interface ActiveCapture {
  source: RecordingSource;
  targetPadId: number;
  leftChunks: Float32Array[];
  rightChunks: Float32Array[];
  totalSamples: number;
  workletNode: AudioWorkletNode | null;
  scriptNode: ScriptProcessorNode | null;
  micSourceNode: MediaStreamAudioSourceNode | null;
  customSourceNode: AudioNode | null;
  silentSink: GainNode | null;
  startedAt: number;
}

class RecorderServiceImpl {
  private micStream: MediaStream | null = null;
  private activeCapture: ActiveCapture | null = null;
  private inputPeak = 0;

  get isRecording(): boolean {
    return this.activeCapture !== null;
  }

  get recordingSource(): RecordingSource | null {
    return this.activeCapture?.source ?? null;
  }

  get recordingPadId(): number | null {
    return this.activeCapture?.targetPadId ?? null;
  }

  get currentInputPeak(): number {
    return this.inputPeak;
  }

  get recordingElapsedSec(): number {
    if (!this.activeCapture) return 0;
    return (performance.now() - this.activeCapture.startedAt) / 1000;
  }

  async ensureMicStream(): Promise<MediaStream> {
    if (this.micStream && this.micStream.active) {
      return this.micStream;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        'Microfono bloccato: su smartphone serve aprire Koala Simpler tramite link HTTPS.'
      );
    }
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
      video: false,
    });
    return this.micStream;
  }

  async startRecording(
    source: RecordingSource,
    targetPadId: number,
    customNode?: AudioNode
  ): Promise<void> {
    if (this.activeCapture) {
      await this.stopRecording(false);
    }

    const ctx = await audioEngine.unlock();
    const hasWorklet = await audioEngine.ensureRecorderWorklet();

    let sourceNode: AudioNode;
    let micSourceNode: MediaStreamAudioSourceNode | null = null;
    let customSourceNode: AudioNode | null = null;

    if (source === 'mic') {
      const stream = await this.ensureMicStream();
      micSourceNode = ctx.createMediaStreamSource(stream);
      sourceNode = micSourceNode;
    } else if (source === 'video' && customNode) {
      customSourceNode = customNode;
      sourceNode = customNode;
    } else {
      // Internal lossless resample directly from PadBox master output
      sourceNode = audioEngine.outputNode;
    }

    const capture: ActiveCapture = {
      source,
      targetPadId,
      leftChunks: [],
      rightChunks: [],
      totalSamples: 0,
      workletNode: null,
      scriptNode: null,
      micSourceNode,
      customSourceNode,
      silentSink: null,
      startedAt: performance.now(),
    };

    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;
    silentSink.connect(ctx.destination);
    capture.silentSink = silentSink;

    if (hasWorklet) {
      const node = new AudioWorkletNode(ctx, 'recorder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
      });

      node.port.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'chunk') {
          capture.leftChunks.push(msg.left);
          capture.rightChunks.push(msg.right);
          capture.totalSamples += msg.length;
        } else if (msg.type === 'meter') {
          this.inputPeak = msg.peak;
        }
      };

      sourceNode.connect(node);
      node.connect(silentSink);
      node.port.postMessage({ type: 'start' });
      capture.workletNode = node;
    } else {
      const scriptNode = ctx.createScriptProcessor(2048, 2, 2);
      scriptNode.onaudioprocess = (ev) => {
        const ch0 = ev.inputBuffer.getChannelData(0);
        const ch1 =
          ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : ch0;
        const left = new Float32Array(ch0);
        const right = new Float32Array(ch1);
        capture.leftChunks.push(left);
        capture.rightChunks.push(right);
        capture.totalSamples += left.length;

        let peak = 0;
        for (let i = 0; i < left.length; i++) {
          const a = Math.abs(left[i]);
          if (a > peak) peak = a;
        }
        this.inputPeak = peak;
      };
      sourceNode.connect(scriptNode);
      scriptNode.connect(silentSink);
      capture.scriptNode = scriptNode;
    }

    this.activeCapture = capture;
  }

  async stopRecording(autoTrimSilence = true): Promise<{
    padId: number;
    buffer: AudioBuffer | null;
    source: RecordingSource;
  } | null> {
    const capture = this.activeCapture;
    if (!capture) return null;
    this.activeCapture = null;
    this.inputPeak = 0;

    const ctx = audioEngine.context;

    if (capture.workletNode) {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 120);
        const prevHandler = capture.workletNode!.port.onmessage;
        capture.workletNode!.port.onmessage = (ev) => {
          if (prevHandler) prevHandler.call(capture.workletNode!.port, ev);
          if (ev.data?.type === 'stopped') {
            window.clearTimeout(timeout);
            resolve();
          }
        };
        capture.workletNode!.port.postMessage({ type: 'stop' });
      });
    }

    try {
      capture.micSourceNode?.disconnect();
      if (capture.source === 'resample') {
        if (capture.workletNode) audioEngine.outputNode.disconnect(capture.workletNode);
        if (capture.scriptNode) audioEngine.outputNode.disconnect(capture.scriptNode);
      }
      if (capture.source === 'video' && capture.customSourceNode) {
        if (capture.workletNode) capture.customSourceNode.disconnect(capture.workletNode);
        if (capture.scriptNode) capture.customSourceNode.disconnect(capture.scriptNode);
      }
      capture.workletNode?.disconnect();
      capture.scriptNode?.disconnect();
      capture.silentSink?.disconnect();
    } catch {
      // ignore disconnect errors
    }

    if (capture.totalSamples < Math.floor(ctx.sampleRate * 0.04)) {
      return { padId: capture.targetPadId, buffer: null, source: capture.source };
    }

    const left = new Float32Array(capture.totalSamples);
    const right = new Float32Array(capture.totalSamples);
    let offset = 0;
    for (let i = 0; i < capture.leftChunks.length; i++) {
      left.set(capture.leftChunks[i], offset);
      right.set(capture.rightChunks[i], offset);
      offset += capture.leftChunks[i].length;
    }

    let startIdx = 0;
    let endIdx = capture.totalSamples;

    if (autoTrimSilence) {
      const threshold = capture.source === 'mic' ? 0.012 : 0.002;
      while (
        startIdx < endIdx - 1 &&
        Math.abs(left[startIdx]) < threshold &&
        Math.abs(right[startIdx]) < threshold
      ) {
        startIdx++;
      }
      startIdx = Math.max(0, startIdx - Math.floor(ctx.sampleRate * 0.004));

      while (
        endIdx > startIdx + 1 &&
        Math.abs(left[endIdx - 1]) < threshold * 0.5 &&
        Math.abs(right[endIdx - 1]) < threshold * 0.5
      ) {
        endIdx--;
      }
      endIdx = Math.min(capture.totalSamples, endIdx + Math.floor(ctx.sampleRate * 0.015));
    }

    const finalLen = Math.max(1, endIdx - startIdx);
    const isStereo =
      capture.source !== 'mic' || this.hasStereoDifference(left, right, startIdx, endIdx);
    const buffer = ctx.createBuffer(isStereo ? 2 : 1, finalLen, ctx.sampleRate);
    buffer.getChannelData(0).set(left.subarray(startIdx, endIdx));
    if (isStereo) {
      buffer.getChannelData(1).set(right.subarray(startIdx, endIdx));
    }

    return { padId: capture.targetPadId, buffer, source: capture.source };
  }

  private hasStereoDifference(l: Float32Array, r: Float32Array, start: number, end: number): boolean {
    const step = Math.max(1, Math.floor((end - start) / 256));
    for (let i = start; i < end; i += step) {
      if (Math.abs(l[i] - r[i]) > 1e-4) return true;
    }
    return false;
  }

  isVideoFile(file: File): boolean {
    if (file.type.startsWith('video/')) return true;
    return /\.(mp4|mov|m4v|webm|mkv|3gp)$/i.test(file.name);
  }

  /**
   * Fast direct audio/video decoding (works natively for WAV/MP3/M4A/OGG and most MP4/MOV screen recordings).
   * Returns null if a video container requires fallback live capture via <video>.
   */
  async tryDecodeFileDirectly(file: File): Promise<AudioBuffer | null> {
    const ctx = await audioEngine.unlock();
    const arrayBuffer = await file.arrayBuffer();
    try {
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      return null;
    }
  }
}

export const recorderService = new RecorderServiceImpl();
