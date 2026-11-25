export type PerformFxId = 'lpf' | 'hpf' | 'crush' | 'delay' | 'reverb' | 'stutter';

export interface PerformFxMeta {
  id: PerformFxId;
  label: string;
  hint: string;
}

export const PERFORM_FX_LIST: PerformFxMeta[] = [
  { id: 'lpf', label: 'FILTER', hint: 'Taglia alti (Lo-Fi)' },
  { id: 'hpf', label: 'HI-PASS', hint: 'Taglia bassi (Drop)' },
  { id: 'crush', label: 'CRUSH', hint: 'Grana 12-bit SP' },
  { id: 'delay', label: 'DELAY', hint: 'Eco Dub a tempo' },
  { id: 'reverb', label: 'REVERB', hint: 'Spazio / Room' },
  { id: 'stutter', label: 'STUTTER', hint: 'Ripeti a tempo' },
];

/**
 * Generates a warm vintage studio room impulse response procedurally (0 KB download).
 */
function createRoomImpulse(ctx: AudioContext, durationSec = 1.65): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * durationSec);
  const ir = ctx.createBuffer(2, len, sr);
  let seed = 918273;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 1073741823.5 - 1;
  };

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const decay = Math.pow(1 - t, 2.7);
      const n = rand();
      // Gradually darken reverb tail like an analog spring/plate room
      lp += (n - lp) * (0.45 - t * 0.32);
      data[i] = lp * decay * 0.72;
    }
  }
  return ir;
}

export class PerformFxChain {
  readonly input: GainNode;
  readonly output: GainNode;

  private ctx: AudioContext;
  private lpfNode: BiquadFilterNode;
  private hpfNode: BiquadFilterNode;
  private workletSlotIn: GainNode;
  private workletSlotOut: GainNode;
  private fxWorklet: AudioWorkletNode | null = null;

  // Dub Delay send
  private delaySend: GainNode;
  private delayNode: DelayNode;
  private delayFilter: BiquadFilterNode;
  private delayFeedback: GainNode;
  private delayReturn: GainNode;

  // Reverb send
  private reverbSend: GainNode;
  private convolver: ConvolverNode;
  private reverbReturn: GainNode;

  private values: Record<PerformFxId, number> = {
    lpf: 0,
    hpf: 0,
    crush: 0,
    delay: 0,
    reverb: 0,
    stutter: 0,
  };
  private currentBpm = 92;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // 1. DJ Low-Pass Filter
    this.lpfNode = ctx.createBiquadFilter();
    this.lpfNode.type = 'lowpass';
    this.lpfNode.frequency.value = 20000;
    this.lpfNode.Q.value = 1.2;

    // 2. DJ High-Pass Filter
    this.hpfNode = ctx.createBiquadFilter();
    this.hpfNode.type = 'highpass';
    this.hpfNode.frequency.value = 20;
    this.hpfNode.Q.value = 1.1;

    // 3. Worklet Insert Slot (bypassed directly until fx-processor loads)
    this.workletSlotIn = ctx.createGain();
    this.workletSlotOut = ctx.createGain();
    this.workletSlotIn.connect(this.workletSlotOut);

    // Serial main chain: input -> lpf -> hpf -> workletSlot -> output
    this.input.connect(this.lpfNode);
    this.lpfNode.connect(this.hpfNode);
    this.hpfNode.connect(this.workletSlotIn);
    this.workletSlotOut.connect(this.output);

    // 4. Parallel Dub Delay (warm bandpass feedback synced to BPM)
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = (60 / 92) * 0.75; // dotted 8th
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'bandpass';
    this.delayFilter.frequency.value = 1500;
    this.delayFilter.Q.value = 0.7;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.35;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.85;

    this.workletSlotOut.connect(this.delaySend);
    this.delaySend.connect(this.delayNode);
    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayFilter.connect(this.delayReturn);
    this.delayReturn.connect(this.output);

    // 5. Parallel Warm Room Reverb
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createRoomImpulse(ctx);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.9;

    this.workletSlotOut.connect(this.reverbSend);
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.output);
  }

  attachFxWorklet(): void {
    if (this.fxWorklet) return;
    try {
      const node = new AudioWorkletNode(this.ctx, 'perform-fx-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.workletSlotIn.disconnect();
      this.workletSlotIn.connect(node);
      node.connect(this.workletSlotOut);
      this.fxWorklet = node;
      // Sync current parameters into worklet
      this.setFx('crush', this.values.crush);
      this.setFx('stutter', this.values.stutter);
      this.setBpm(this.currentBpm);
    } catch (err) {
      console.warn('Could not attach perform-fx-processor:', err);
    }
  }

  setBpm(bpm: number): void {
    this.currentBpm = Math.max(40, Math.min(240, bpm));
    const now = this.ctx.currentTime;
    const dottedEighthSec = Math.min(1.8, (60 / this.currentBpm) * 0.75);
    this.delayNode.delayTime.setTargetAtTime(dottedEighthSec, now, 0.03);

    const bpmParam = this.fxWorklet?.parameters.get('bpm');
    if (bpmParam) {
      bpmParam.setValueAtTime(this.currentBpm, now);
    }
  }

  setFx(id: PerformFxId, rawAmount: number): void {
    const v = Math.max(0, Math.min(1, rawAmount));
    this.values[id] = v;
    const now = this.ctx.currentTime;

    switch (id) {
      case 'lpf': {
        // Exponential sweep 20kHz down to 190Hz + pleasant analog resonance bump
        const freq = v < 0.01 ? 20000 : 20000 * Math.pow(190 / 20000, v);
        const q = 1.0 + Math.sin(v * Math.PI) * 3.8;
        this.lpfNode.frequency.setTargetAtTime(freq, now, 0.015);
        this.lpfNode.Q.setTargetAtTime(q, now, 0.02);
        break;
      }
      case 'hpf': {
        // Exponential sweep 20Hz up to 4800Hz
        const freq = v < 0.01 ? 20 : 20 * Math.pow(4800 / 20, v);
        const q = 0.9 + Math.sin(v * Math.PI) * 3.2;
        this.hpfNode.frequency.setTargetAtTime(freq, now, 0.015);
        this.hpfNode.Q.setTargetAtTime(q, now, 0.02);
        break;
      }
      case 'delay': {
        this.delaySend.gain.setTargetAtTime(v * 0.72, now, 0.02);
        this.delayFeedback.gain.setTargetAtTime(0.18 + v * 0.56, now, 0.03);
        break;
      }
      case 'reverb': {
        this.reverbSend.gain.setTargetAtTime(v * 0.95, now, 0.02);
        break;
      }
      case 'crush': {
        const p = this.fxWorklet?.parameters.get('crush');
        if (p) p.setTargetAtTime(v, now, 0.015);
        break;
      }
      case 'stutter': {
        const p = this.fxWorklet?.parameters.get('stutter');
        if (p) p.setValueAtTime(v, now);
        break;
      }
    }
  }

  resetAll(): void {
    (Object.keys(this.values) as PerformFxId[]).forEach((id) => this.setFx(id, 0));
  }

  getValue(id: PerformFxId): number {
    return this.values[id];
  }
}
