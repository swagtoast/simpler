// Real-time DSP AudioWorklet for Simpler Performance FX:
// 1. Vintage 12-bit/8-bit Bitcrusher + Sample-Rate Downsampler (CRUSH)
// 2. Tempo-synced Beat Repeat / Stutter loop buffer (STUTTER)

class PerformFxProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'crush', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'stutter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bpm', defaultValue: 92, minValue: 40, maxValue: 240, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // 2 seconds stereo ring buffer for clean beat-repeat stutter
    this.maxSamples = Math.max(44100 * 2, Math.ceil(sampleRate * 2));
    this.bufL = new Float32Array(this.maxSamples);
    this.bufR = new Float32Array(this.maxSamples);
    this.writeIdx = 0;

    // Stutter state
    this.stutterActive = false;
    this.stutterStartIdx = 0;
    this.stutterReadOffset = 0;
    this.stutterLen = Math.floor(sampleRate * 0.25);

    // Crush sample-and-hold state
    this.holdCounter = 0;
    this.heldL = 0;
    this.heldR = 0;
  }

  computeStutterLength(stutterAmount, bpm) {
    const spb = 60 / Math.max(40, Math.min(240, bpm));
    // Musical quantized divisions as you push the fader up:
    // 0.05..0.35 -> 1/8 note (0.5 beat)
    // 0.35..0.65 -> 1/16 note (0.25 beat)
    // 0.65..0.85 -> 1/32 note (0.125 beat)
    // 0.85..1.00 -> 1/64 roll (0.0625 beat)
    let beats = 0.5;
    if (stutterAmount > 0.85) beats = 0.0625;
    else if (stutterAmount > 0.65) beats = 0.125;
    else if (stutterAmount > 0.35) beats = 0.25;
    return Math.max(256, Math.min(this.maxSamples - 128, Math.floor(spb * beats * sampleRate)));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : inL;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;
    if (!inL || !outL) return true;

    const crush = parameters.crush[0];
    const stutter = parameters.stutter[0];
    const bpm = parameters.bpm[0];

    const wantStutter = stutter > 0.04;
    const targetStutterLen = wantStutter ? this.computeStutterLength(stutter, bpm) : this.stutterLen;

    if (wantStutter && !this.stutterActive) {
      // Lock the most recently played slice right behind writeIdx!
      this.stutterActive = true;
      this.stutterLen = targetStutterLen;
      this.stutterStartIdx = (this.writeIdx - this.stutterLen + this.maxSamples) % this.maxSamples;
      this.stutterReadOffset = 0;
    } else if (wantStutter && this.stutterActive) {
      // Smoothly tighten/loosen loop slice length as fader moves
      this.stutterLen = targetStutterLen;
      if (this.stutterReadOffset >= this.stutterLen) {
        this.stutterReadOffset = this.stutterReadOffset % this.stutterLen;
      }
    } else if (!wantStutter && this.stutterActive) {
      this.stutterActive = false;
    }

    // Crush parameters: downsample factor 1..20 & bit depth 16 -> 4
    const downsample = crush > 0.02 ? 1 + Math.floor(crush * crush * 22) : 1;
    const bits = crush > 0.02 ? 14 - crush * 9.5 : 16;
    const levels = Math.pow(2, bits);

    for (let i = 0; i < inL.length; i++) {
      const sL = inL[i];
      const sR = inR[i];

      // Always record live input into ring buffer when not stuttering
      if (!this.stutterActive) {
        this.bufL[this.writeIdx] = sL;
        this.bufR[this.writeIdx] = sR;
        this.writeIdx = (this.writeIdx + 1) % this.maxSamples;
      }

      let procL = sL;
      let procR = sR;

      if (this.stutterActive) {
        const readIdx = (this.stutterStartIdx + this.stutterReadOffset) % this.maxSamples;
        procL = this.bufL[readIdx];
        procR = this.bufR[readIdx];

        // Tiny 2ms crossfade window at loop edges to prevent clicks
        const fadeSamples = Math.min(96, Math.floor(this.stutterLen * 0.15));
        let env = 1;
        if (this.stutterReadOffset < fadeSamples) {
          env = this.stutterReadOffset / fadeSamples;
        } else if (this.stutterReadOffset > this.stutterLen - fadeSamples) {
          env = (this.stutterLen - this.stutterReadOffset) / fadeSamples;
        }
        procL *= env;
        procR *= env;

        this.stutterReadOffset++;
        if (this.stutterReadOffset >= this.stutterLen) {
          this.stutterReadOffset = 0;
        }
      }

      // Apply vintage bitcrusher + sample-rate reduction
      if (crush > 0.02) {
        this.holdCounter++;
        if (this.holdCounter >= downsample) {
          this.holdCounter = 0;
          this.heldL = Math.round(procL * levels) / levels;
          this.heldR = Math.round(procR * levels) / levels;
        }
        const wet = Math.min(1, crush * 1.4);
        procL = procL * (1 - wet) + this.heldL * wet;
        procR = procR * (1 - wet) + this.heldR * wet;
      }

      outL[i] = procL;
      if (outR !== outL) {
        outR[i] = procR;
      }
    }

    return true;
  }
}

registerProcessor('perform-fx-processor', PerformFxProcessor);
