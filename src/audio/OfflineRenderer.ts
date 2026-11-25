import { zipSync } from 'fflate';
import { PadConfig, ProjectMeta, SequencePattern } from '../state/types';
import { audioEngine } from './AudioEngine';
import { sequencerEngine } from './SequencerEngine';

/**
 * Encodes an AudioBuffer into a standard stereo 16-bit PCM WAV Blob.
 */
export function encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const ch0 = buffer.getChannelData(0);
  const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s0 = Math.max(-1, Math.min(1, ch0[i]));
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    offset += 2;
    if (numChannels > 1) {
      const s1 = Math.max(-1, Math.min(1, ch1[i]));
      view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

interface ScheduledOfflineVoice {
  padId: number;
  chokeGroup: number;
  source: AudioBufferSourceNode;
  envGain: GainNode;
}

/**
 * Renders one or more sequences (repeated `loops` times) offline via OfflineAudioContext.
 * If `onlyPadId` is provided, renders only that pad (for individual stem export).
 */
export async function renderSequencesOffline(
  project: ProjectMeta,
  sequences: SequencePattern[],
  loops = 1,
  onlyPadId?: number,
  mutedPads: number[] = []
): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const spb = 60 / Math.max(40, Math.min(240, project.bpm || 92));
  const mutedSet = new Set(mutedPads);

  // Build flat event timeline across sequences * loops
  const events: {
    whenSec: number;
    pad: PadConfig;
    velocity: number;
    pitchOffset: number;
  }[] = [];

  let cursorBeats = 0;
  for (let l = 0; l < loops; l++) {
    for (const seq of sequences) {
      const seqBeats = Math.max(4, seq.bars * 4);
      for (const note of seq.notes) {
        if (onlyPadId !== undefined && note.padId !== onlyPadId) continue;
        if (onlyPadId === undefined && mutedSet.has(note.padId)) continue;
        const pad = project.pads[note.padId];
        if (!pad?.hasSample) continue;

        const swungBeat = sequencerEngine.applySwingToBeat(note.startBeat, project.swing);
        events.push({
          whenSec: (cursorBeats + swungBeat) * spb,
          pad,
          velocity: note.velocity,
          pitchOffset: note.pitchOffset,
        });
      }
      cursorBeats += seqBeats;
    }
  }

  events.sort((a, b) => a.whenSec - b.whenSec);

  const tailSec = 1.25;
  const totalSec = Math.max(0.5, cursorBeats * spb + tailSec);
  const totalFrames = Math.ceil(totalSec * sampleRate);

  const offline = new OfflineAudioContext(2, totalFrames, sampleRate);

  const masterGain = offline.createGain();
  masterGain.gain.value = 0.92;

  const limiter = offline.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 3;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;

  masterGain.connect(limiter);
  limiter.connect(offline.destination);

  const activeVoices: ScheduledOfflineVoice[] = [];

  for (const ev of events) {
    const pad = ev.pad;
    const buf = pad.reverse
      ? audioEngine.getReversedSample(pad.sampleId)
      : audioEngine.getSample(pad.sampleId);
    if (!buf) continue;

    const when = ev.whenSec;

    // Apply choke groups & same-pad retriggering cleanly in offline timeline
    for (let i = activeVoices.length - 1; i >= 0; i--) {
      const av = activeVoices[i];
      const shouldChoke =
        (pad.chokeGroup > 0 && av.chokeGroup === pad.chokeGroup) ||
        (pad.chokeGroup === 0 && av.padId === pad.id);
      if (shouldChoke) {
        try {
          av.envGain.gain.setValueAtTime(0.0001, when + 0.006);
          av.source.stop(when + 0.008);
        } catch {
          // ignore
        }
        activeVoices.splice(i, 1);
      }
    }

    const totalSemitones = pad.pitch + ev.pitchOffset;
    const playbackRate = Math.pow(2, totalSemitones / 12);

    const bufDur = buf.duration;
    const regionStart = pad.reverse ? (1 - pad.end) * bufDur : pad.start * bufDur;
    const regionEnd = pad.reverse ? (1 - pad.start) * bufDur : pad.end * bufDur;
    const regionLen = Math.max(0.005, regionEnd - regionStart);

    const src = offline.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(playbackRate, when);

    let last: AudioNode = src;
    if (Math.abs(pad.tone) > 0.02) {
      const low = offline.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 320;
      low.gain.value = -pad.tone * 9;

      const high = offline.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 2600;
      high.gain.value = pad.tone * 9;

      last.connect(low);
      low.connect(high);
      last = high;
    }

    const env = offline.createGain();
    const targetGain = Math.max(0.0001, pad.volume * ev.velocity);
    const attack = Math.max(0.002, pad.attack);
    const playWallDur = regionLen / playbackRate;
    const endFade = Math.min(0.008, playWallDur * 0.25);

    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(targetGain, when + attack);
    if (when + playWallDur > when + attack + endFade) {
      env.gain.setValueAtTime(targetGain, when + playWallDur - endFade);
      env.gain.linearRampToValueAtTime(0.0001, when + playWallDur);
    }

    last.connect(env);
    last = env;

    if (Math.abs(pad.pan) > 0.01 && typeof offline.createStereoPanner === 'function') {
      const panner = offline.createStereoPanner();
      panner.pan.setValueAtTime(pad.pan, when);
      last.connect(panner);
      last = panner;
    }

    last.connect(masterGain);
    src.start(when, regionStart, regionLen);

    activeVoices.push({ padId: pad.id, chokeGroup: pad.chokeGroup, source: src, envGain: env });
  }

  return await offline.startRendering();
}

export async function exportMixWav(
  project: ProjectMeta,
  sequences: SequencePattern[],
  loops: number,
  mutedPads: number[],
  filename: string
): Promise<void> {
  const rendered = await renderSequencesOffline(project, sequences, loops, undefined, mutedPads);
  const blob = encodeAudioBufferToWav(rendered);
  triggerBlobDownload(blob, filename);
}

export async function exportStemsZip(
  project: ProjectMeta,
  sequences: SequencePattern[],
  loops: number,
  filename: string
): Promise<number> {
  const usedPadIds = Array.from(
    new Set(sequences.flatMap((s) => s.notes.map((n) => n.padId)))
  ).filter((id) => project.pads[id]?.hasSample);

  if (usedPadIds.length === 0) return 0;

  const files: Record<string, Uint8Array> = {};
  for (const padId of usedPadIds) {
    const pad = project.pads[padId];
    const rendered = await renderSequencesOffline(project, sequences, loops, padId);
    const wavBlob = encodeAudioBufferToWav(rendered);
    const buf = new Uint8Array(await wavBlob.arrayBuffer());
    const safeName = pad.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 20) || `pad_${padId + 1}`;
    files[`${String(padId + 1).padStart(2, '0')}_${safeName}.wav`] = buf;
  }

  const zipped = zipSync(files, { level: 1 });
  const zipCopy = new Uint8Array(zipped.byteLength);
  zipCopy.set(zipped);
  const blob = new Blob([zipCopy.buffer], { type: 'application/zip' });
  triggerBlobDownload(blob, filename);
  return usedPadIds.length;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
