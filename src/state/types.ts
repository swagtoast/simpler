export type BankId = 0 | 1 | 2 | 3; // A, B, C, D
export type BusId = 'main' | 'A' | 'B' | 'C' | 'D';
export type TabId = 'sample' | 'sequence' | 'perform';
export type SampleToolMode = 'play' | 'rec' | 'resample' | 'copy' | 'swap';

export interface PadConfig {
  id: number; // 0..63
  name: string;
  color: string;
  hasSample: boolean;
  sampleId: string | null;
  duration: number; // seconds
  start: number; // 0..1 normalized
  end: number; // 0..1 normalized
  volume: number; // 0..1.5 (1.0 = 0dB)
  pitch: number; // semitones -24..+24
  pan: number; // -1..+1
  tone: number; // -1..+1 (tilt EQ: dark <-> bright)
  attack: number; // seconds 0..1.5
  release: number; // seconds 0.005..3.0
  oneShot: boolean;
  loop: boolean;
  reverse: boolean;
  chokeGroup: number; // 0 = off, 1..4 = choke group
  bus: BusId;
  slices: number[]; // normalized 0..1 slice markers
}

export interface NoteEvent {
  id: string;
  padId: number;
  startBeat: number;
  durationBeats: number;
  velocity: number; // 0.05..1
  pitchOffset: number; // semitones relative to pad pitch
}

export interface SequencePattern {
  id: string;
  name: string;
  bars: number;
  notes: NoteEvent[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  bpm: number;
  swing: number; // 0..0.75
  quantize: number; // 0 = off, 4, 8, 16, 32
  updatedAt: number;
  pads: PadConfig[];
  sequences: SequencePattern[];
}

export const PAD_PALETTE = [
  '#ff5a36', // tangerine
  '#ff8c2e', // amber
  '#eab308', // gold
  '#22c55e', // emerald
  '#14b8a6', // teal
  '#38bdf8', // sky
  '#3b82f6', // cobalt
  '#8b5cf6', // violet
  '#ec4899', // magenta
  '#ef4444', // crimson
];

export const BANK_LABELS = ['A', 'B', 'C', 'D'] as const;

export function createDefaultPad(id: number): PadConfig {
  const indexInBank = id % 16;
  const color = PAD_PALETTE[indexInBank % PAD_PALETTE.length];
  return {
    id,
    name: `Pad ${BANK_LABELS[Math.floor(id / 16)]}${indexInBank + 1}`,
    color,
    hasSample: false,
    sampleId: null,
    duration: 0,
    start: 0,
    end: 1,
    volume: 1.0,
    pitch: 0,
    pan: 0,
    tone: 0,
    attack: 0.002,
    release: 0.06,
    oneShot: true,
    loop: false,
    reverse: false,
    chokeGroup: 0,
    bus: 'main',
    slices: [],
  };
}

export function createDefaultProject(): ProjectMeta {
  return {
    id: 'default-project',
    name: 'Untitled Session',
    bpm: 96,
    swing: 0,
    quantize: 16,
    updatedAt: Date.now(),
    pads: Array.from({ length: 64 }, (_, i) => createDefaultPad(i)),
    sequences: [
      { id: 'seq-1', name: 'Seq 1', bars: 2, notes: [] },
      { id: 'seq-2', name: 'Seq 2', bars: 2, notes: [] },
      { id: 'seq-3', name: 'Seq 3', bars: 4, notes: [] },
      { id: 'seq-4', name: 'Seq 4', bars: 4, notes: [] },
    ],
  };
}
