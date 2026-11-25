import { audioEngine } from './AudioEngine';

export interface StarterPadSpec {
  padIndex: number;
  name: string;
  color: string;
  chokeGroup: number;
  oneShot: boolean;
  loop?: boolean;
  buffer: AudioBuffer;
}

// Deterministic seeded PRNG for consistent dusty textures & vinyl crackle
function makeRng(seedStart: number) {
  let seed = seedStart;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 1073741823.5) - 1;
  };
}

// Subtle 12-bit / SP-1200 warmth + gentle tape saturation + soft HF rolloff
function applyBoomBapGrit(data: Float32Array, grit = 0.25, crushSteps = 180): void {
  let lp = 0;
  for (let i = 0; i < data.length; i++) {
    let x = data[i];
    // Warm soft-clip tape drive
    x = Math.tanh(x * (1 + grit * 1.4));
    // Gentle 12-bit quantization crunch (very subtle, preserves dynamics)
    if (grit > 0.05) {
      const q = Math.round(x * crushSteps) / crushSteps;
      x = x * (1 - grit * 0.45) + q * (grit * 0.45);
    }
    // Warm vintage sampler low-pass smoothing (~12-14kHz feel)
    lp += (x - lp) * 0.72;
    data[i] = lp;
  }
}

// 1. Dusty 90s Boom Bap Acoustic Kick (punchy chest thump + subtle room grit)
function synthBoomBapKick(sr: number, muted = false): AudioBuffer {
  const dur = muted ? 0.36 : 0.46;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const rand = makeRng(muted ? 4011 : 1029);

  let phase = 0;
  let noiseLp = 0;
  const startF = muted ? 128 : 165;
  const endF = muted ? 44 : 50;
  const pitchTau = muted ? 0.038 : 0.032;
  const ampTau = muted ? 0.12 : 0.155;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const freq = endF + (startF - endF) * Math.exp(-t / pitchTau);
    phase += (2 * Math.PI * freq) / sr;

    // Warm fundamental + slight 2nd harmonic beater punch
    const body = Math.sin(phase) * 0.88 + Math.sin(phase * 2) * 0.16 * Math.exp(-t / 0.04);

    // Filtered beater thwack & dusty room air
    const n = rand();
    noiseLp += (n - noiseLp) * (muted ? 0.08 : 0.18);
    const beater = noiseLp * Math.exp(-t / 0.016) * (muted ? 0.35 : 0.7);
    const room = noiseLp * Math.exp(-t / 0.08) * 0.08;

    const env = Math.min(1, t / 0.0025) * Math.exp(-t / ampTau);
    data[i] = (body * env + beater + room) * 0.92;
  }

  applyBoomBapGrit(data, muted ? 0.32 : 0.28, 160);
  return buf;
}

// 2. Crunchy 90s Layered Acoustic Snare (woody shell + crispy breakbeat snares + vinyl dust)
function synthBoomBapSnare(sr: number): AudioBuffer {
  const dur = 0.32;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const rand = makeRng(7721);

  let phase1 = 0;
  let phase2 = 0;
  let lp = 0;
  let hp = 0;
  let prev = 0;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Woody shell crack around 195Hz + overtone ~340Hz
    const f1 = 192 + 65 * Math.exp(-t / 0.014);
    const f2 = 345 + 40 * Math.exp(-t / 0.012);
    phase1 += (2 * Math.PI * f1) / sr;
    phase2 += (2 * Math.PI * f2) / sr;
    const shell =
      (Math.sin(phase1) * 0.72 + Math.sin(phase2) * 0.3) * Math.exp(-t / 0.052);

    // Bandpassed snappy snare wires
    const n = rand();
    hp = 0.78 * (hp + n - prev);
    prev = n;
    lp += (hp - lp) * 0.42; // keeps crispy 1.5k-6k punch, tames harsh 15k fizz

    const crack = lp * Math.exp(-t / 0.022) * 0.75;
    const tail = lp * Math.exp(-t / 0.115) * 0.62;

    data[i] = (shell + crack + tail) * 0.9;
  }

  applyBoomBapGrit(data, 0.36, 140);
  return buf;
}

// 3. Dusty Acoustic Hi-Hat (band-limited bronze sizzle, warm & human, not harsh electronic)
function synthBoomBapHat(sr: number, open: boolean): AudioBuffer {
  const dur = open ? 0.48 : 0.11;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const rand = makeRng(open ? 9921 : 3341);

  // Inharmonic bronze cymbal partials
  const freqs = [3120, 4180, 5430, 6820, 8110];
  let hp1 = 0;
  let prev1 = 0;
  let lp = 0;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = rand();
    hp1 = 0.84 * (hp1 + n - prev1);
    prev1 = n;

    let bronze = 0;
    for (let k = 0; k < freqs.length; k++) {
      bronze += Math.sin(2 * Math.PI * freqs[k] * t + k * 1.1);
    }
    bronze /= freqs.length;

    const raw = hp1 * 0.72 + bronze * 0.28;
    // Warm vintage sampler ceiling so it sits in a boom bap mix
    lp += (raw - lp) * 0.52;

    const attack = Math.min(1, t / 0.003);
    const decay = open ? Math.exp(-t / 0.19) : Math.exp(-t / 0.032);
    data[i] = lp * attack * decay * 0.78;
  }

  applyBoomBapGrit(data, 0.34, 150);
  return buf;
}

// 4. Woody Cross-Stick / Rimshot (classic 90s jazz-rap snare accent)
function synthBoomBapRim(sr: number): AudioBuffer {
  const dur = 0.11;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const rand = makeRng(5123);

  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const wood =
      Math.sin(2 * Math.PI * 410 * t) * 0.55 +
      Math.sin(2 * Math.PI * 980 * t) * 0.45 +
      Math.sin(2 * Math.PI * 1720 * t) * 0.35;
    lp += (rand() - lp) * 0.35;
    const hit = (wood + lp * 0.3) * Math.exp(-t / 0.018);
    data[i] = hit * 0.9;
  }
  applyBoomBapGrit(data, 0.3, 150);
  return buf;
}

// 5. Dusty Breakbeat Shaker / Tambourine
function synthBoomBapShaker(sr: number): AudioBuffer {
  const dur = 0.18;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const rand = makeRng(6217);
  let prev = 0;
  let lp = 0;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = rand();
    const hp = n - prev * 0.82;
    prev = n;
    lp += (hp - lp) * 0.48;

    // Slight double-pulse human shake feel
    const env =
      Math.min(1, t / 0.022) * Math.exp(-Math.max(0, t - 0.015) / 0.042) +
      0.35 * Math.exp(-Math.pow((t - 0.065) / 0.02, 2));
    data[i] = lp * env * 0.65;
  }
  applyBoomBapGrit(data, 0.25, 160);
  return buf;
}

// 6. Warm Vinyl Crackle & Dust Loop (adds instant analog soul!)
function synthVinylCrackle(sr: number): AudioBuffer {
  const dur = 2.0;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(2, len, sr);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const rand = makeRng(88421);

  let lpL = 0;
  let lpR = 0;
  let popEnvL = 0;
  let popEnvR = 0;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const nL = rand();
    const nR = rand();
    lpL += (nL - lpL) * 0.18;
    lpR += (nR - lpR) * 0.18;

    // Warm surface rumble + hiss
    const rumble = Math.sin(2 * Math.PI * 52 * t) * 0.012;
    const hissL = (nL - lpL) * 0.032 + lpL * 0.02 + rumble;
    const hissR = (nR - lpR) * 0.032 + lpR * 0.02 + rumble;

    // Sparse organic vinyl pops & clicks
    if (rand() > 0.9986) popEnvL = 0.25 + Math.abs(rand()) * 0.35;
    if (rand() > 0.9987) popEnvR = 0.22 + Math.abs(rand()) * 0.32;

    const clickL = popEnvL * (rand() > 0 ? 1 : -0.6);
    const clickR = popEnvR * (rand() > 0 ? 1 : -0.6);
    popEnvL *= 0.72;
    popEnvR *= 0.72;

    // Seamless crossfade at loop boundaries
    const fadeIn = Math.min(1, i / (sr * 0.03));
    const fadeOut = Math.min(1, (len - 1 - i) / (sr * 0.03));
    const win = Math.min(fadeIn, fadeOut);

    l[i] = (hissL + clickL) * win;
    r[i] = (hissR + clickR) * win;
  }
  return buf;
}

// 7. Warm Lo-Fi Jazz/Soul Rhodes Chop (with subtle vinyl dust & tape wow)
function synthDustyJazzChord(sr: number, midiNotes: number[], seed: number): AudioBuffer {
  const dur = 1.45;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(2, len, sr);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const rand = makeRng(seed);

  const freqs = midiNotes.map((m) => 440 * Math.pow(2, (m - 69) / 12));
  const phases = new Float64Array(freqs.length);

  let lpL = 0;
  let lpR = 0;
  let pop = 0;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Gentle tape pitch wow
    const wow = 1 + 0.0022 * Math.sin(2 * Math.PI * 1.9 * t + seed);
    const attack = Math.min(1, t / 0.015);
    const env = attack * Math.exp(-t / 0.78);
    const tineEnv = attack * Math.exp(-t / 0.14);

    let sumL = 0;
    let sumR = 0;
    for (let k = 0; k < freqs.length; k++) {
      // Slight human strum offset (0..18ms)
      const strumT = t - k * 0.0045;
      if (strumT < 0) continue;
      phases[k] += (2 * Math.PI * freqs[k] * wow) / sr;
      const ph = phases[k];
      const warm =
        Math.sin(ph) * 0.78 +
        Math.sin(ph * 2) * 0.18 * tineEnv +
        Math.sin(ph * 3) * 0.07 * tineEnv;
      const pan = 0.35 + (k / Math.max(1, freqs.length - 1)) * 0.3;
      sumL += warm * (1 - pan * 0.4);
      sumR += warm * (0.6 + pan * 0.4);
    }

    // Subtle sampled vinyl texture baked into the chop
    if (rand() > 0.999) pop = 0.09;
    const dust = rand() * 0.012 + pop;
    pop *= 0.7;

    const rawL = (sumL / freqs.length) * env * 1.15 + dust;
    const rawR = (sumR / freqs.length) * env * 1.15 + dust * 0.8;

    // Warm lo-fi band-limited filter (vintage jazz record tone)
    lpL += (rawL - lpL) * 0.28;
    lpR += (rawR - lpR) * 0.28;

    l[i] = lpL;
    r[i] = lpR;
  }

  applyBoomBapGrit(l, 0.26, 170);
  applyBoomBapGrit(r, 0.26, 170);
  return buf;
}

// 8. Warm Acoustic Upright / Muted Finger Bass (plays great chromatically in KEYS!)
function synthUprightBass(sr: number, freq: number): AudioBuffer {
  const dur = 0.95;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const rand = makeRng(2199);

  let phase = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Slight finger pluck pitch settle
    const f = freq * (1 + 0.025 * Math.exp(-t / 0.025));
    phase += (2 * Math.PI * f) / sr;

    const fundamental = Math.sin(phase) * 0.85;
    const woody = Math.sin(phase * 2) * 0.32 * Math.exp(-t / 0.18) + Math.sin(phase * 3) * 0.12 * Math.exp(-t / 0.08);
    const pluck = rand() * Math.exp(-t / 0.012) * 0.18;

    const raw = fundamental + woody + pluck;
    lp += (raw - lp) * 0.16; // deep, round low-end jazz bass
    const env = Math.min(1, t / 0.008) * Math.exp(-t / 0.48);
    data[i] = lp * env * 1.15;
  }

  applyBoomBapGrit(data, 0.22, 180);
  return buf;
}

// 9. Sampled Soul/Jazz Brass Horn Stab (warm filtered brass hit)
function synthSoulBrassStab(sr: number): AudioBuffer {
  const dur = 0.62;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(2, len, sr);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);

  // D minor triad + 7th horn stab (F4, A4, C5, E5)
  const freqs = [349.23, 440.0, 523.25, 659.25];
  let lpL = 0;
  let lpR = 0;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Brass swell attack + punchy falloff
    const attack = Math.min(1, t / 0.026);
    const env = attack * Math.exp(-Math.max(0, t - 0.04) / 0.21);
    const bright = 0.08 + 0.26 * Math.exp(-t / 0.16);

    let sL = 0;
    let sR = 0;
    for (let k = 0; k < freqs.length; k++) {
      const f = freqs[k] * (1 - 0.012 * Math.exp(-t / 0.03)); // subtle horn scoop-in
      const sawL = ((t * (f * 1.003)) % 1) * 2 - 1;
      const sawR = ((t * (f * 0.997)) % 1) * 2 - 1;
      sL += sawL;
      sR += sawR;
    }

    lpL += (sL / freqs.length - lpL) * bright;
    lpR += (sR / freqs.length - lpR) * bright;
    l[i] = lpL * env * 1.2;
    r[i] = lpR * env * 1.2;
  }

  applyBoomBapGrit(l, 0.32, 150);
  applyBoomBapGrit(r, 0.32, 150);
  return buf;
}

// 10. Vintage Vibraphone Bell Hit (classic 90s jazz hip-hop melody)
function synthDustyVibes(sr: number, midi: number): AudioBuffer {
  const dur = 1.2;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(2, len, sr);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const f = 440 * Math.pow(2, (midi - 69) / 12);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const motor = 0.82 + 0.18 * Math.sin(2 * Math.PI * 5.2 * t);
    const fund = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.55);
    const overtone = Math.sin(2 * Math.PI * f * 4 * t) * 0.18 * Math.exp(-t / 0.08);
    const mallet = Math.sin(2 * Math.PI * f * 2.75 * t) * 0.12 * Math.exp(-t / 0.018);
    const val = (fund + overtone + mallet) * Math.min(1, t / 0.004) * motor * 0.78;
    l[i] = val * (0.9 + 0.1 * Math.sin(2 * Math.PI * 5.2 * t));
    r[i] = val * (0.9 - 0.1 * Math.sin(2 * Math.PI * 5.2 * t));
  }
  applyBoomBapGrit(l, 0.2, 180);
  applyBoomBapGrit(r, 0.2, 180);
  return buf;
}

// 11. Turntable Vinyl Scratch / Chirp (classic hip-hop accent)
function synthVinylScratch(sr: number): AudioBuffer {
  const dur = 0.34;
  const len = Math.floor(sr * dur);
  const buf = audioEngine.context.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const rand = makeRng(44901);

  let phase = 0;
  let bp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Baby-scratch pitch curve: quick forward chirp -> reverse pull
    let speed: number;
    if (t < 0.14) {
      speed = 1.6 * Math.sin((t / 0.14) * Math.PI);
    } else if (t < 0.17) {
      speed = 0.05;
    } else {
      speed = 1.35 * Math.sin(((t - 0.17) / 0.17) * Math.PI);
    }

    const freq = 260 + speed * 780;
    phase += (2 * Math.PI * freq) / sr;

    // Formant-like vocal/record wave
    const wave =
      Math.sin(phase) * 0.55 +
      Math.sin(phase * 2.02) * 0.35 +
      Math.sin(phase * 3.05) * 0.22 +
      rand() * 0.12;

    bp += (wave - bp) * 0.38;
    const amp = Math.min(1, speed * 1.4) * Math.exp(-t / 0.45);
    data[i] = Math.tanh(bp * 1.5) * amp * 0.78;
  }
  applyBoomBapGrit(data, 0.35, 140);
  return buf;
}

/**
 * Generates a warm, dusty 16-pad 90s Boom Bap Hip-Hop Starter Kit on Bank A
 * procedurally in <45ms (0 KB audio downloads over mobile data).
 */
export function generateStarterKit(): StarterPadSpec[] {
  const sr = audioEngine.context.sampleRate;

  return [
    // Row 1: Core Boom Bap Drums
    { padIndex: 0, name: 'Kick Boom', color: '#e05a3a', chokeGroup: 0, oneShot: true, buffer: synthBoomBapKick(sr, false) },
    { padIndex: 1, name: 'Snare Crack', color: '#e58a35', chokeGroup: 0, oneShot: true, buffer: synthBoomBapSnare(sr) },
    { padIndex: 2, name: 'Hat Closed', color: '#d4a72c', chokeGroup: 1, oneShot: true, buffer: synthBoomBapHat(sr, false) },
    { padIndex: 3, name: 'Hat Open', color: '#eab308', chokeGroup: 1, oneShot: true, buffer: synthBoomBapHat(sr, true) },

    // Row 2: Breakbeat Percs & Vinyl Texture
    { padIndex: 4, name: 'Kick Muted', color: '#c84b31', chokeGroup: 0, oneShot: true, buffer: synthBoomBapKick(sr, true) },
    { padIndex: 5, name: 'Rimshot', color: '#d97706', chokeGroup: 0, oneShot: true, buffer: synthBoomBapRim(sr) },
    { padIndex: 6, name: 'Shaker Dust', color: '#2ea06c', chokeGroup: 0, oneShot: true, buffer: synthBoomBapShaker(sr) },
    { padIndex: 7, name: 'Vinyl Dust', color: '#64748b', chokeGroup: 0, oneShot: false, loop: true, buffer: synthVinylCrackle(sr) },

    // Row 3: Dusty Jazz / Soul Chops (D minor Boom Bap flip — Choke Group 2)
    { padIndex: 8, name: 'Jazz Chop 1', color: '#3b82f6', chokeGroup: 2, oneShot: true, buffer: synthDustyJazzChord(sr, [62, 65, 69, 72, 76], 1101) },
    { padIndex: 9, name: 'Jazz Chop 2', color: '#4f6ef7', chokeGroup: 2, oneShot: true, buffer: synthDustyJazzChord(sr, [60, 64, 67, 71, 74], 2202) },
    { padIndex: 10, name: 'Jazz Chop 3', color: '#7c5dfa', chokeGroup: 2, oneShot: true, buffer: synthDustyJazzChord(sr, [58, 62, 65, 69, 72], 3303) },
    { padIndex: 11, name: 'Jazz Chop 4', color: '#9b51e0', chokeGroup: 2, oneShot: true, buffer: synthDustyJazzChord(sr, [57, 61, 67, 72, 74], 4404) },

    // Row 4: Upright Bass, Soul Brass, Vibes, Scratch
    { padIndex: 12, name: 'Upright Bass', color: '#db4c77', chokeGroup: 3, oneShot: true, buffer: synthUprightBass(sr, 73.42) },
    { padIndex: 13, name: 'Soul Brass', color: '#0ea5e9', chokeGroup: 0, oneShot: true, buffer: synthSoulBrassStab(sr) },
    { padIndex: 14, name: 'Dusty Vibes', color: '#14b8a6', chokeGroup: 0, oneShot: true, buffer: synthDustyVibes(sr, 69) },
    { padIndex: 15, name: 'Vinyl Scratch', color: '#ef4444', chokeGroup: 0, oneShot: true, buffer: synthVinylScratch(sr) },
  ];
}
