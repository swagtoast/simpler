import { PadConfig } from '../state/types';
import { audioEngine } from './AudioEngine';

export interface ActiveVoice {
  id: number;
  padId: number;
  sampleId: string;
  chokeGroup: number;
  source: AudioBufferSourceNode;
  envGain: GainNode;
  volGain: GainNode;
  velocity: number;
  startTime: number;
  regionStartSec: number;
  regionEndSec: number;
  bufferDuration: number;
  playbackRate: number;
  loop: boolean;
  reverse: boolean;
  oneShot: boolean;
  releaseSec: number;
  released: boolean;
  stopped: boolean;
}

export interface TriggerOptions {
  velocity?: number; // 0..1
  pitchOffset?: number; // semitones (for Keyboard mode / sequencer)
  when?: number; // exact AudioContext time for sequencer
  startOverride?: number; // normalized 0..1 (for slice preview)
  endOverride?: number; // normalized 0..1
  forceGate?: boolean; // hold-to-play for keyboard mode
  voiceTag?: string; // optional tag for keyboard note release
}

class VoiceManagerImpl {
  private voices = new Map<number, ActiveVoice>();
  private taggedVoices = new Map<string, number>();
  private nextVoiceId = 1;
  private padFlashTimes = new Map<number, number>();

  triggerPad(pad: PadConfig, options: TriggerOptions = {}): number | null {
    if (!pad.hasSample || !pad.sampleId) return null;

    const buffer = pad.reverse
      ? audioEngine.getReversedSample(pad.sampleId)
      : audioEngine.getSample(pad.sampleId);
    if (!buffer) return null;

    const ctx = audioEngine.context;
    if (ctx.state === 'suspended') {
      void audioEngine.unlock();
    }

    const now = options.when ?? ctx.currentTime;
    const velocity = Math.max(0.05, Math.min(1, options.velocity ?? 1));
    const totalSemitones = pad.pitch + (options.pitchOffset ?? 0);
    const playbackRate = Math.pow(2, totalSemitones / 12);

    // Choke handling: stop voices sharing same choke group, or same pad if non-polyphonic keyboard
    if (pad.chokeGroup > 0) {
      this.stopByChokeGroup(pad.chokeGroup, now);
    } else if (!options.voiceTag) {
      // Retriggering the same pad cleanly avoids muddying drums while letting keyboard play chords
      this.stopByPad(pad.id, now, 0.008);
    }

    const normStart = Math.max(0, Math.min(0.995, options.startOverride ?? pad.start));
    const normEnd = Math.max(normStart + 0.005, Math.min(1, options.endOverride ?? pad.end));

    // When reversed, map [normStart, normEnd] from forward coordinates into reversed buffer coordinates
    const bufDuration = buffer.duration;
    const regionStartSec = pad.reverse ? (1 - normEnd) * bufDuration : normStart * bufDuration;
    const regionEndSec = pad.reverse ? (1 - normStart) * bufDuration : normEnd * bufDuration;
    const regionLengthSec = Math.max(0.005, regionEndSec - regionStartSec);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(playbackRate, now);

    const isLoop = pad.loop && !options.startOverride;
    source.loop = isLoop;
    if (isLoop) {
      source.loopStart = regionStartSec;
      source.loopEnd = regionEndSec;
    }

    // Tone (Tilt EQ: negative = warm/lowpass tilt, positive = bright/highpass tilt)
    let lastNode: AudioNode = source;
    if (Math.abs(pad.tone) > 0.02) {
      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 320;
      lowShelf.gain.value = -pad.tone * 9;

      const highShelf = ctx.createBiquadFilter();
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 2600;
      highShelf.gain.value = pad.tone * 9;

      lastNode.connect(lowShelf);
      lowShelf.connect(highShelf);
      lastNode = highShelf;
    }

    // Envelope Gain (click-free attack & release) + Dedicated Live Volume Gain (for real-time Pad Mixer faders)
    const envGain = ctx.createGain();
    const volGain = ctx.createGain();
    volGain.gain.setValueAtTime(Math.max(0, pad.volume), now);

    const targetGain = Math.max(0.0001, velocity);
    const attackSec = Math.max(0.002, pad.attack);
    const releaseSec = Math.max(0.005, pad.release);

    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.linearRampToValueAtTime(targetGain, now + attackSec);

    lastNode.connect(envGain);
    envGain.connect(volGain);
    lastNode = volGain;

    // Stereo Pan
    if (Math.abs(pad.pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pad.pan)), now);
      lastNode.connect(panner);
      lastNode = panner;
    }

    lastNode.connect(audioEngine.inputNode);

    const isOneShot = options.forceGate ? false : pad.oneShot && !isLoop;
    const playDurationWallSec = regionLengthSec / playbackRate;

    if (isLoop) {
      source.start(now, regionStartSec);
    } else {
      // Schedule gentle fade-out at region end to avoid clicks
      const endFade = Math.min(0.008, playDurationWallSec * 0.25);
      const stopAt = now + playDurationWallSec;
      if (stopAt > now + attackSec + endFade) {
        envGain.gain.setValueAtTime(targetGain, stopAt - endFade);
        envGain.gain.linearRampToValueAtTime(0.0001, stopAt);
      }
      source.start(now, regionStartSec, regionLengthSec);
    }

    const voiceId = this.nextVoiceId++;
    const voice: ActiveVoice = {
      id: voiceId,
      padId: pad.id,
      sampleId: pad.sampleId,
      chokeGroup: pad.chokeGroup,
      source,
      envGain,
      volGain,
      velocity,
      startTime: now,
      regionStartSec,
      regionEndSec,
      bufferDuration: bufDuration,
      playbackRate,
      loop: isLoop,
      reverse: pad.reverse,
      oneShot: isOneShot,
      releaseSec,
      released: false,
      stopped: false,
    };

    this.voices.set(voiceId, voice);
    this.padFlashTimes.set(pad.id, performance.now());

    if (options.voiceTag) {
      const prevId = this.taggedVoices.get(options.voiceTag);
      if (prevId !== undefined) this.stopVoice(prevId, now, 0.01);
      this.taggedVoices.set(options.voiceTag, voiceId);
    }

    source.onended = () => {
      voice.stopped = true;
      this.voices.delete(voiceId);
      if (options.voiceTag && this.taggedVoices.get(options.voiceTag) === voiceId) {
        this.taggedVoices.delete(options.voiceTag);
      }
      try {
        source.disconnect();
        envGain.disconnect();
      } catch {
        // already disconnected
      }
    };

    return voiceId;
  }

  releasePad(padId: number): void {
    const ctx = audioEngine.context;
    const now = ctx.currentTime;
    for (const voice of this.voices.values()) {
      if (voice.padId === padId && !voice.oneShot && !voice.released) {
        this.releaseVoice(voice, now);
      }
    }
  }

  releaseTag(voiceTag: string): void {
    const id = this.taggedVoices.get(voiceTag);
    if (id === undefined) return;
    const voice = this.voices.get(id);
    if (voice && !voice.released) {
      this.releaseVoice(voice, audioEngine.context.currentTime);
    }
  }

  private releaseVoice(voice: ActiveVoice, now: number): void {
    voice.released = true;
    const fade = Math.max(0.008, voice.releaseSec);
    try {
      voice.envGain.gain.cancelScheduledValues(now);
      voice.envGain.gain.setValueAtTime(Math.max(0.0001, voice.envGain.gain.value), now);
      voice.envGain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      voice.source.stop(now + fade + 0.005);
    } catch {
      // voice already ended
    }
  }

  private stopVoice(voiceId: number, now: number, fadeSec = 0.008): void {
    const voice = this.voices.get(voiceId);
    if (!voice || voice.stopped) return;
    voice.released = true;
    voice.stopped = true;
    try {
      voice.envGain.gain.cancelScheduledValues(now);
      voice.envGain.gain.setValueAtTime(Math.max(0.0001, voice.envGain.gain.value), now);
      voice.envGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      voice.source.stop(now + fadeSec + 0.004);
    } catch {
      // ignore
    }
    this.voices.delete(voiceId);
  }

  stopByPad(padId: number, now = audioEngine.context.currentTime, fadeSec = 0.01): void {
    for (const [id, voice] of this.voices.entries()) {
      if (voice.padId === padId) {
        this.stopVoice(id, now, fadeSec);
      }
    }
  }

  stopByChokeGroup(group: number, now = audioEngine.context.currentTime): void {
    if (group <= 0) return;
    for (const [id, voice] of this.voices.entries()) {
      if (voice.chokeGroup === group) {
        this.stopVoice(id, now, 0.006);
      }
    }
  }

  stopAll(): void {
    const now = audioEngine.context.currentTime;
    for (const id of Array.from(this.voices.keys())) {
      this.stopVoice(id, now, 0.015);
    }
    this.taggedVoices.clear();
  }

  /**
   * Smoothly updates live volume of any currently sounding voices for this pad (Pad Mixer fader drag).
   */
  setPadLiveVolume(padId: number, volume: number): void {
    const now = audioEngine.context.currentTime;
    const clamped = Math.max(0, Math.min(1.5, volume));
    for (const v of this.voices.values()) {
      if (v.padId === padId && !v.stopped) {
        try {
          v.volGain.gain.setTargetAtTime(clamped, now, 0.012);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Computes real-time instantaneous signal level (0..1.2) for a pad's LED VU meter (Green/Yellow/Red)
   * directly from the playing AudioBuffer window with zero extra AnalyserNode overhead.
   */
  getPadLiveLevel(padId: number, padVolume: number): number {
    const ctx = audioEngine.context;
    let peak = 0;

    for (const v of this.voices.values()) {
      if (v.padId !== padId || v.stopped) continue;
      const buf = v.reverse
        ? audioEngine.getReversedSample(v.sampleId)
        : audioEngine.getSample(v.sampleId);
      if (!buf) continue;

      const elapsedSampleSec = Math.max(0, (ctx.currentTime - v.startTime) * v.playbackRate);
      const regionLen = Math.max(0.001, v.regionEndSec - v.regionStartSec);
      const offsetInRegion = v.loop ? elapsedSampleSec % regionLen : Math.min(regionLen, elapsedSampleSec);
      const posSec = v.regionStartSec + offsetInRegion;

      const ch0 = buf.getChannelData(0);
      const centerIdx = Math.min(ch0.length - 1, Math.max(0, Math.floor(posSec * buf.sampleRate)));
      const winEnd = Math.min(ch0.length, centerIdx + 256);

      let localPeak = 0;
      for (let i = centerIdx; i < winEnd; i += 4) {
        const a = Math.abs(ch0[i]);
        if (a > localPeak) localPeak = a;
      }

      const scaled = localPeak * padVolume * v.velocity * (v.released ? 0.35 : 1);
      if (scaled > peak) peak = scaled;
    }

    return Math.min(1.25, peak);
  }

  /**
   * Returns normalized playhead position (0..1 within full forward sample) and progress (0..1 within region)
   * for smooth 60fps UI/Canvas updates without React re-renders.
   */
  getPadPlaybackState(padId: number): {
    active: boolean;
    normalizedPos: number;
    regionProgress: number;
    flash: number;
  } {
    const flashTime = this.padFlashTimes.get(padId) ?? 0;
    const flash = Math.max(0, 1 - (performance.now() - flashTime) / 160);

    let latest: ActiveVoice | null = null;
    for (const v of this.voices.values()) {
      if (v.padId === padId && !v.stopped) {
        if (!latest || v.startTime > latest.startTime) {
          latest = v;
        }
      }
    }

    if (!latest) {
      return { active: false, normalizedPos: 0, regionProgress: 0, flash };
    }

    const ctx = audioEngine.context;
    const elapsedSampleSec = Math.max(0, (ctx.currentTime - latest.startTime) * latest.playbackRate);
    const regionLen = Math.max(0.001, latest.regionEndSec - latest.regionStartSec);

    let offsetInRegion: number;
    if (latest.loop) {
      offsetInRegion = elapsedSampleSec % regionLen;
    } else {
      offsetInRegion = Math.min(regionLen, elapsedSampleSec);
    }

    const regionProgress = offsetInRegion / regionLen;
    const posInBufferSec = latest.regionStartSec + offsetInRegion;
    const normalizedBufPos = posInBufferSec / Math.max(0.001, latest.bufferDuration);
    const normalizedPos = latest.reverse ? 1 - normalizedBufPos : normalizedBufPos;

    return {
      active: true,
      normalizedPos: Math.max(0, Math.min(1, normalizedPos)),
      regionProgress: Math.max(0, Math.min(1, regionProgress)),
      flash,
    };
  }
}

export const voiceManager = new VoiceManagerImpl();
