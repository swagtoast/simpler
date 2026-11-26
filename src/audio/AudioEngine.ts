// Singleton ultra-low-latency Web Audio Engine.
// Lives completely outside React so audio scheduling, meters, and playheads never trigger UI re-renders.

import { PerformFxChain } from './PerformFxEngine';

export interface DecodedSampleEntry {
  buffer: AudioBuffer;
  reversedBuffer: AudioBuffer | null;
}

class AudioEngineImpl {
  private ctx: AudioContext | null = null;
  private masterInput: GainNode | null = null;
  private fxChain: PerformFxChain | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private masterOutput: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData = new Float32Array(256);

  private workletLoaded = false;
  private workletLoadingPromise: Promise<void> | null = null;
  private fxWorkletLoaded = false;
  private fxWorkletLoadingPromise: Promise<void> | null = null;
  private unlocked = false;

  private samples = new Map<string, DecodedSampleEntry>();
  private unlockListeners = new Set<() => void>();

  get context(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({
        latencyHint: 'interactive',
      });

      this.masterInput = this.ctx.createGain();
      this.masterInput.gain.value = 0.92;

      this.fxChain = new PerformFxChain(this.ctx);

      // Transparent safety brickwall-style limiter so students never clip speakers
      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -1.5;
      this.masterLimiter.knee.value = 3;
      this.masterLimiter.ratio.value = 16;
      this.masterLimiter.attack.value = 0.002;
      this.masterLimiter.release.value = 0.08;

      this.masterOutput = this.ctx.createGain();
      this.masterOutput.gain.value = 1.0;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.7;

      this.masterInput.connect(this.fxChain.input);
      this.fxChain.output.connect(this.masterLimiter);
      this.masterLimiter.connect(this.masterOutput);
      this.masterOutput.connect(this.analyser);
      this.masterOutput.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  get performFx(): PerformFxChain {
    this.context;
    return this.fxChain!;
  }

  get inputNode(): GainNode {
    this.context;
    return this.masterInput!;
  }

  get outputNode(): GainNode {
    this.context;
    return this.masterOutput!;
  }

  get isUnlocked(): boolean {
    return this.unlocked && this.ctx?.state === 'running';
  }

  get baseLatencyMs(): number {
    if (!this.ctx) return 0;
    const base = (this.ctx.baseLatency ?? 0) + (this.ctx.outputLatency ?? 0);
    return Math.round(base * 1000);
  }

  onUnlock(cb: () => void): () => void {
    this.unlockListeners.add(cb);
    return () => this.unlockListeners.delete(cb);
  }

  async unlock(): Promise<AudioContext> {
    const ctx = this.context;

    // iOS 17+ AudioSession API: MUST use 'play-and-record' (not 'playback'!)
    // so both loud speaker playback AND the iPhone microphone work together!
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession && nav.audioSession.type !== 'play-and-record') {
        nav.audioSession.type = 'play-and-record';
      }
    } catch {
      // Ignore if unsupported
    }

    if (ctx.state !== 'running') {
      await ctx.resume();
    }

    if (!this.unlocked) {
      // Prime iOS/Safari audio pipeline with a 1-sample silent buffer
      const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = silent;
      src.connect(ctx.destination);
      src.start(0);
      this.unlocked = true;
      this.unlockListeners.forEach((cb) => cb());
      // Preload perform FX worklet quietly in background right after unlock
      void this.ensureFxWorklet();
    }

    return ctx;
  }

  async ensureFxWorklet(): Promise<boolean> {
    const ctx = this.context;
    if (this.fxWorkletLoaded) return true;
    if (!ctx.audioWorklet) return false;

    if (!this.fxWorkletLoadingPromise) {
      const workletUrl = `${import.meta.env.BASE_URL}worklets/fx-processor.js`;
      this.fxWorkletLoadingPromise = ctx.audioWorklet
        .addModule(workletUrl)
        .then(() => {
          this.fxWorkletLoaded = true;
          this.fxChain?.attachFxWorklet();
        })
        .catch((err) => {
          this.fxWorkletLoadingPromise = null;
          console.warn('Perform FX AudioWorklet failed to load:', err);
          throw err;
        });
    }

    try {
      await this.fxWorkletLoadingPromise;
      return true;
    } catch {
      return false;
    }
  }

  async ensureRecorderWorklet(): Promise<boolean> {
    const ctx = await this.unlock();
    if (this.workletLoaded) return true;
    if (!ctx.audioWorklet) return false;

    if (!this.workletLoadingPromise) {
      const workletUrl = `${import.meta.env.BASE_URL}worklets/recorder-processor.js`;
      this.workletLoadingPromise = ctx.audioWorklet
        .addModule(workletUrl)
        .then(() => {
          this.workletLoaded = true;
        })
        .catch((err) => {
          this.workletLoadingPromise = null;
          console.warn('Recorder AudioWorklet failed to load, fallback will be used:', err);
          throw err;
        });
    }

    try {
      await this.workletLoadingPromise;
      return true;
    } catch {
      return false;
    }
  }

  setSample(sampleId: string, buffer: AudioBuffer): void {
    this.samples.set(sampleId, { buffer, reversedBuffer: null });
  }

  getSample(sampleId: string | null): AudioBuffer | null {
    if (!sampleId) return null;
    return this.samples.get(sampleId)?.buffer ?? null;
  }

  getReversedSample(sampleId: string | null): AudioBuffer | null {
    if (!sampleId) return null;
    const entry = this.samples.get(sampleId);
    if (!entry) return null;
    if (!entry.reversedBuffer) {
      entry.reversedBuffer = this.createReversedBuffer(entry.buffer);
    }
    return entry.reversedBuffer;
  }

  deleteSample(sampleId: string | null): void {
    if (!sampleId) return;
    this.samples.delete(sampleId);
  }

  clearAllSamples(): void {
    this.samples.clear();
  }

  getAllSamples(): Map<string, AudioBuffer> {
    const map = new Map<string, AudioBuffer>();
    for (const [id, entry] of this.samples.entries()) {
      map.set(id, entry.buffer);
    }
    return map;
  }

  createReversedBuffer(source: AudioBuffer): AudioBuffer {
    const ctx = this.context;
    const rev = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
    for (let ch = 0; ch < source.numberOfChannels; ch++) {
      const srcData = source.getChannelData(ch);
      const dstData = rev.getChannelData(ch);
      const len = srcData.length;
      for (let i = 0; i < len; i++) {
        dstData[i] = srcData[len - 1 - i];
      }
    }
    return rev;
  }

  cloneBuffer(source: AudioBuffer): AudioBuffer {
    const ctx = this.context;
    const copy = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
    for (let ch = 0; ch < source.numberOfChannels; ch++) {
      copy.getChannelData(ch).set(source.getChannelData(ch));
    }
    return copy;
  }

  getOutputPeak(): number {
    if (!this.analyser || !this.unlocked) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserData);
    let peak = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      const v = Math.abs(this.analyserData[i]);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak);
  }
}

export const audioEngine = new AudioEngineImpl();
