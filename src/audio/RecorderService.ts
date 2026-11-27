import { audioEngine } from './AudioEngine';
import { t } from '../i18n/t';

export type RecordingSource = 'mic' | 'resample' | 'video' | 'tab';

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
  private tabStream: MediaStream | null = null;
  private micMonitorSource: MediaStreamAudioSourceNode | null = null;
  private micMonitorAnalyser: AnalyserNode | null = null;
  private micMonitorData = new Float32Array(256);

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

  get hasMicStream(): boolean {
    return !!(this.micStream && this.micStream.active);
  }

  get supportsTabAudioCapture(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function'
    );
  }

  async ensureTabAudioStream(): Promise<MediaStream> {
    if (this.tabStream && this.tabStream.active && this.tabStream.getAudioTracks().length > 0) {
      return this.tabStream;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      throw new Error(t('ytTabUnsupported'));
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((tr) => tr.stop());
      throw new Error(t('ytTabNoAudio'));
    }

    this.tabStream = stream;
    stream.getAudioTracks()[0].onended = () => {
      this.tabStream = null;
    };
    return stream;
  }

  stopTabStream(): void {
    if (this.tabStream) {
      this.tabStream.getTracks().forEach((tr) => tr.stop());
      this.tabStream = null;
    }
  }

  get currentInputPeak(): number {
    if (this.activeCapture) return this.inputPeak;
    if (this.micMonitorAnalyser) {
      this.micMonitorAnalyser.getFloatTimeDomainData(this.micMonitorData);
      let peak = 0;
      for (let i = 0; i < this.micMonitorData.length; i++) {
        const a = Math.abs(this.micMonitorData[i]);
        if (a > peak) peak = a;
      }
      return Math.min(1, peak * 1.4);
    }
    return 0;
  }

  get recordingElapsedSec(): number {
    if (!this.activeCapture) return 0;
    return (performance.now() - this.activeCapture.startedAt) / 1000;
  }

  /**
   * Requests microphone access directly inside a user tap gesture (critical for iPhone Safari/Chrome).
   * Also connects a silent input meter analyser so students can see the mic working before pressing REC.
   */
  async ensureMicStream(): Promise<MediaStream> {
    // Ensure iOS 17+ audioSession allows microphone input!
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) {
        nav.audioSession.type = 'play-and-record';
      }
    } catch {
      // ignore
    }

    if (this.micStream && this.micStream.active) {
      return this.micStream;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(t('micHttpsError'));
    }

    let stream: MediaStream;
    try {
      // Musical sampling constraints (disable voice-call DSP that ruins instruments/beatboxing)
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
    } catch {
      // Fallback to simplest possible constraint for maximum iOS/Android compatibility
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }

    this.micStream = stream;

    // Re-resume AudioContext after iOS permission prompt (iOS suspends AudioContext while alert is shown)
    const ctx = await audioEngine.unlock();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }

    // Attach lightweight live input meter analyser (not routed to speakers -> zero feedback)
    try {
      this.micMonitorSource?.disconnect();
      this.micMonitorSource = ctx.createMediaStreamSource(stream);
      this.micMonitorAnalyser = ctx.createAnalyser();
      this.micMonitorAnalyser.fftSize = 256;
      this.micMonitorSource.connect(this.micMonitorAnalyser);
    } catch {
      // ignore meter setup failure
    }

    return stream;
  }

  async startRecording(
    source: RecordingSource,
    targetPadId: number,
    customNode?: AudioNode
  ): Promise<void> {
    if (this.activeCapture) {
      await this.stopRecording(false);
    }

    let micSourceNode: MediaStreamAudioSourceNode | null = null;
    let customSourceNode: AudioNode | null = null;

    // For mic/tab: request stream FIRST while still inside user gesture!
    let micStream: MediaStream | null = null;
    let tabStream: MediaStream | null = null;
    if (source === 'mic') {
      micStream = await this.ensureMicStream();
    } else if (source === 'tab') {
      tabStream = await this.ensureTabAudioStream();
    }

    const ctx = await audioEngine.unlock();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
    const hasWorklet = await audioEngine.ensureRecorderWorklet();

    let sourceNode: AudioNode;
    if (source === 'mic' && micStream) {
      micSourceNode = ctx.createMediaStreamSource(micStream);
      sourceNode = micSourceNode;
    } else if (source === 'tab' && tabStream) {
      const audioOnlyStream = new MediaStream(tabStream.getAudioTracks());
      micSourceNode = ctx.createMediaStreamSource(audioOnlyStream);
      sourceNode = micSourceNode;
    } else if (source === 'video' && customNode) {
      customSourceNode = customNode;
      sourceNode = customNode;
    } else {
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
      const threshold = capture.source === 'mic' ? 0.01 : 0.002;
      while (
        startIdx < endIdx - 1 &&
        Math.abs(left[startIdx]) < threshold &&
        Math.abs(right[startIdx]) < threshold
      ) {
        startIdx++;
      }
      startIdx = Math.max(0, startIdx - Math.floor(ctx.sampleRate * 0.005));

      while (
        endIdx > startIdx + 1 &&
        Math.abs(left[endIdx - 1]) < threshold * 0.5 &&
        Math.abs(right[endIdx - 1]) < threshold * 0.5
      ) {
        endIdx--;
      }
      endIdx = Math.min(capture.totalSamples, endIdx + Math.floor(ctx.sampleRate * 0.02));
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
