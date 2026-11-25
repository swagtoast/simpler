import { audioEngine } from './AudioEngine';

/**
 * Computes equal slice points (normalized 0..1) inside [regionStart, regionEnd].
 */
export function computeEqualSlices(
  count: number,
  regionStart = 0,
  regionEnd = 1
): number[] {
  const safeCount = Math.max(2, Math.min(32, count));
  const span = Math.max(0.001, regionEnd - regionStart);
  const slices: number[] = [];
  for (let i = 0; i < safeCount; i++) {
    slices.push(regionStart + (span * i) / safeCount);
  }
  return slices;
}

/**
 * Energy-flux transient onset detector.
 * sensitivity: 0..1 (higher = more slices detected).
 */
export function detectTransients(
  buffer: AudioBuffer,
  sensitivity = 0.55,
  regionStart = 0,
  regionEnd = 1,
  maxSlices = 16
): number[] {
  const sr = buffer.sampleRate;
  const totalLen = buffer.length;
  const startSample = Math.floor(regionStart * totalLen);
  const endSample = Math.max(startSample + 1, Math.floor(regionEnd * totalLen));

  // Mix to mono envelope
  const numCh = buffer.numberOfChannels;
  const ch0 = buffer.getChannelData(0);
  const ch1 = numCh > 1 ? buffer.getChannelData(1) : null;

  const hop = Math.max(128, Math.floor(sr * 0.005)); // 5ms hop
  const win = hop * 2;
  const numFrames = Math.floor((endSample - startSample - win) / hop);
  if (numFrames <= 2) return [regionStart];

  const energy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const base = startSample + f * hop;
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const s = ch1 ? 0.5 * (ch0[base + i] + ch1[base + i]) : ch0[base + i];
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / win);
  }

  // Positive first-order energy difference (half-wave rectified onset function)
  const flux = new Float32Array(numFrames);
  let maxFlux = 0;
  for (let f = 1; f < numFrames; f++) {
    const diff = energy[f] - energy[f - 1] * 0.85;
    flux[f] = diff > 0 ? diff : 0;
    if (flux[f] > maxFlux) maxFlux = flux[f];
  }

  if (maxFlux < 1e-5) return [regionStart];

  // Adaptive local threshold
  const thresholdScale = 0.42 - Math.max(0, Math.min(1, sensitivity)) * 0.36; // 0.42 -> 0.06
  const minGapFrames = Math.max(8, Math.floor((sr * 0.075) / hop)); // 75ms minimum between slices
  const localRadius = 10;

  const peaks: { frame: number; score: number }[] = [];
  let lastAccepted = -minGapFrames;

  for (let f = 1; f < numFrames - 1; f++) {
    if (flux[f] <= flux[f - 1] || flux[f] < flux[f + 1]) continue;

    // Local mean
    const lo = Math.max(0, f - localRadius);
    const hi = Math.min(numFrames - 1, f + localRadius);
    let localSum = 0;
    for (let k = lo; k <= hi; k++) localSum += flux[k];
    const localMean = localSum / (hi - lo + 1);

    const thresh = Math.max(maxFlux * thresholdScale * 0.35, localMean * (1.2 + thresholdScale * 3.2));
    if (flux[f] > thresh && energy[f] > 0.015) {
      if (f - lastAccepted >= minGapFrames) {
        peaks.push({ frame: f, score: flux[f] });
        lastAccepted = f;
      } else if (peaks.length > 0 && flux[f] > peaks[peaks.length - 1].score) {
        peaks[peaks.length - 1] = { frame: f, score: flux[f] };
        lastAccepted = f;
      }
    }
  }

  // Always include regionStart if first peak is far enough from start
  const slices: number[] = [regionStart];
  const minDistNorm = (sr * 0.05) / totalLen;

  const limitedPeaks =
    peaks.length > maxSlices - 1
      ? [...peaks]
          .sort((a, b) => b.score - a.score)
          .slice(0, maxSlices - 1)
          .sort((a, b) => a.frame - b.frame)
      : peaks;

  for (const p of limitedPeaks) {
    // Nudge slightly back (3ms) to preserve transient attack
    const samplePos = Math.max(startSample, startSample + p.frame * hop - Math.floor(sr * 0.003));
    const norm = samplePos / totalLen;
    if (norm - slices[slices.length - 1] >= minDistNorm && norm < regionEnd - 0.005) {
      slices.push(norm);
    }
  }

  return slices.slice(0, maxSlices);
}

/**
 * Destructive sample editing tools (always return a fresh AudioBuffer).
 */
export function normalizeBuffer(source: AudioBuffer, targetPeak = 0.96): AudioBuffer {
  const ctx = audioEngine.context;
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);

  let peak = 0;
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const data = source.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }

  const gain = peak > 1e-6 ? targetPeak / peak : 1;
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const src = source.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] * gain;
    }
  }
  return out;
}

export function cropBuffer(
  source: AudioBuffer,
  normStart: number,
  normEnd: number
): AudioBuffer {
  const ctx = audioEngine.context;
  const start = Math.max(0, Math.floor(normStart * source.length));
  const end = Math.min(source.length, Math.max(start + 16, Math.floor(normEnd * source.length)));
  const len = end - start;
  const out = ctx.createBuffer(source.numberOfChannels, len, source.sampleRate);

  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    out.getChannelData(ch).set(source.getChannelData(ch).subarray(start, end));
  }
  return out;
}
