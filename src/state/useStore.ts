import { create } from 'zustand';
import {
  BankId,
  BANK_LABELS,
  createDefaultPad,
  createDefaultProject,
  NoteEvent,
  PadConfig,
  ProjectMeta,
  SampleToolMode,
  SequencePattern,
  TabId,
} from './types';
import { audioEngine } from '../audio/AudioEngine';
import { voiceManager } from '../audio/VoiceManager';
import { generateStarterKit } from '../audio/StarterKit';
import { PerformFxId } from '../audio/PerformFxEngine';
import { cropBuffer, normalizeBuffer } from '../audio/AutoChop';
import {
  clearAllStoredSamples,
  loadProjectMeta,
  loadSamplesForProject,
  saveProjectMeta,
  saveSampleBuffer,
} from '../storage/ProjectDB';

const MAX_UNDO = 25;

let saveTimer: number | null = null;
function scheduleSaveMeta(project: ProjectMeta) {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveProjectMeta(project);
    saveTimer = null;
  }, 250);
}

function makeSampleId(): string {
  return `smp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface AppState {
  project: ProjectMeta;
  undoStack: ProjectMeta[];
  activeTab: TabId;
  activeBank: BankId;
  selectedPadId: number;
  toolMode: SampleToolMode;
  dragSourcePadId: number | null;

  editorOpen: boolean;
  editorSection: 'edit' | 'chop';
  keyboardOpen: boolean;
  qrModalOpen: boolean;
  menuOpen: boolean;
  showLatencyBanner: boolean;
  audioUnlocked: boolean;

  isRecording: boolean;
  recordingPadId: number | null;
  recordingSource: 'mic' | 'resample' | null;
  toastMessage: string | null;
  initialized: boolean;

  // Sequencer & Piano Roll state (Phase 2)
  activeSequenceId: string;
  isSeqPlaying: boolean;
  isSeqRecording: boolean;
  isCountingIn: boolean;
  countInBeat: number;
  metronomeOn: boolean;
  metronomeVolume: number; // 0.05..1
  countInOn: boolean;
  songMode: boolean;
  mutedPads: number[];
  pianoRollOpen: boolean;
  exportModalOpen: boolean;

  // Phase 3: Inline Pad Mixer + Simple Perform FX
  padMixerMode: boolean;
  fxHold: boolean;
  fxValues: Record<PerformFxId, number>;

  // Actions
  initApp: () => Promise<void>;
  setAudioUnlocked: (unlocked: boolean) => void;
  setActiveTab: (tab: TabId) => void;
  setActiveBank: (bank: BankId) => void;
  selectPad: (padId: number) => void;
  setToolMode: (mode: SampleToolMode) => void;
  setDragSourcePadId: (padId: number | null) => void;
  setEditorOpen: (open: boolean, section?: 'edit' | 'chop') => void;
  setKeyboardOpen: (open: boolean) => void;
  setQrModalOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  dismissLatencyBanner: () => void;
  setBpm: (bpm: number) => void;
  setRecordingState: (
    recording: boolean,
    padId?: number | null,
    source?: 'mic' | 'resample' | null
  ) => void;
  showToast: (msg: string) => void;

  // Pad sample operations
  assignSampleToPad: (
    padId: number,
    buffer: AudioBuffer,
    name?: string,
    overrides?: Partial<PadConfig>
  ) => void;
  updatePad: (padId: number, patch: Partial<PadConfig>, recordUndo?: boolean) => void;
  clearPad: (padId: number) => void;
  copyPad: (fromId: number, toId: number) => void;
  swapPads: (aId: number, bId: number) => void;
  applyDestructiveNormalize: (padId: number) => void;
  applyDestructiveCrop: (padId: number) => void;
  applyDestructiveReverse: (padId: number) => void;
  assignSlicesToPads: (sourcePadId: number, slices: number[]) => number;

  // Project actions
  loadStarterKit: () => void;
  clearProject: () => void;
  undo: () => void;

  // Sequencer & Piano Roll actions
  setSeqTransport: (
    playing: boolean,
    recording: boolean,
    countingIn: boolean,
    countInBeat: number
  ) => void;
  selectSequence: (seqId: string) => void;
  addSequence: () => void;
  duplicateSequence: (seqId: string) => void;
  deleteSequence: (seqId: string) => void;
  clearSequence: (seqId: string) => void;
  setSequenceBars: (seqId: string, bars: number) => void;
  setSwing: (swing: number) => void;
  setQuantize: (quantize: number) => void;
  toggleMetronome: () => void;
  setMetronomeOn: (on: boolean) => void;
  setMetronomeVolume: (volume: number) => void;
  toggleCountIn: () => void;
  toggleSongMode: () => void;
  toggleMutePad: (padId: number) => void;
  setPianoRollOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;
  addNoteToSequence: (seqId: string, note: NoteEvent) => void;
  removeNoteFromSequence: (seqId: string, noteId: string) => void;
  toggleStepNote: (seqId: string, padId: number, startBeat: number) => void;
  updateNoteVelocity: (seqId: string, noteId: string, velocity: number) => void;
  quantizeSequenceNow: (seqId: string) => void;
  clearPadFromSequence: (seqId: string, padId: number) => void;

  // Phase 3 actions
  togglePadMixerMode: () => void;
  setPadMixerMode: (on: boolean) => void;
  setFxValue: (id: PerformFxId, value: number) => void;
  toggleFxHold: () => void;
  resetAllFx: () => void;
}

let toastTimer: number | null = null;

export const useStore = create<AppState>((set, get) => {
  const pushUndo = (current: ProjectMeta) => {
    const stack = get().undoStack;
    const next = [...stack.slice(-(MAX_UNDO - 1)), structuredClone(current)];
    set({ undoStack: next });
  };

  return {
    project: createDefaultProject(),
    undoStack: [],
    activeTab: 'sample',
    activeBank: 0,
    selectedPadId: 0,
    toolMode: 'play',
    dragSourcePadId: null,

    editorOpen: false,
    editorSection: 'edit',
    keyboardOpen: false,
    qrModalOpen: false,
    menuOpen: false,
    showLatencyBanner: true,
    audioUnlocked: false,

    isRecording: false,
    recordingPadId: null,
    recordingSource: null,
    toastMessage: null,
    initialized: false,

    activeSequenceId: 'seq-1',
    isSeqPlaying: false,
    isSeqRecording: false,
    isCountingIn: false,
    countInBeat: 0,
    metronomeOn: false,
    metronomeVolume: 0.75,
    countInOn: true,
    songMode: false,
    mutedPads: [],
    pianoRollOpen: false,
    exportModalOpen: false,

    padMixerMode: false,
    fxHold: false,
    fxValues: {
      lpf: 0,
      hpf: 0,
      crush: 0,
      delay: 0,
      reverb: 0,
      stutter: 0,
    },

    initApp: async () => {
      if (get().initialized) return;

      const dismissed = localStorage.getItem('padbox_latency_banner_dismissed') === '1';
      set({ showLatencyBanner: !dismissed });

      const savedMeta = await loadProjectMeta('default-project');
      if (
        savedMeta &&
        savedMeta.name !== 'Workshop Starter Kit' &&
        Array.isArray(savedMeta.pads) &&
        savedMeta.pads.length === 64
      ) {
        const sampleIds = Array.from(
          new Set(
            savedMeta.pads
              .map((p) => p.sampleId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
          )
        );
        await loadSamplesForProject(sampleIds);

        // Verify each pad's sample buffer actually loaded
        const verifiedPads = savedMeta.pads.map((p) => {
          if (p.hasSample && p.sampleId && !audioEngine.getSample(p.sampleId)) {
            return { ...p, hasSample: false, sampleId: null, duration: 0 };
          }
          return p;
        });

        set({
          project: { ...savedMeta, pads: verifiedPads },
          activeSequenceId: savedMeta.sequences?.[0]?.id ?? 'seq-1',
          initialized: true,
        });
      } else {
        // First visit: load the lightweight synthesized Starter Kit automatically so workshop students can play immediately!
        set({ initialized: true });
        get().loadStarterKit();
      }
    },

    setAudioUnlocked: (unlocked) => set({ audioUnlocked: unlocked }),
    setActiveTab: (tab) =>
      set({ activeTab: tab, editorOpen: false, keyboardOpen: false, toolMode: 'play', dragSourcePadId: null }),
    setActiveBank: (bank) => set({ activeBank: bank }),
    selectPad: (padId) => set({ selectedPadId: padId }),
    setToolMode: (mode) => set({ toolMode: mode, dragSourcePadId: null }),
    setDragSourcePadId: (padId) => set({ dragSourcePadId: padId }),
    setEditorOpen: (open, section) =>
      set((s) => ({
        editorOpen: open,
        editorSection: section ?? s.editorSection,
        keyboardOpen: open ? false : s.keyboardOpen,
      })),
    setKeyboardOpen: (open) =>
      set((s) => ({
        keyboardOpen: open,
        editorOpen: open ? false : s.editorOpen,
      })),
    setQrModalOpen: (open) => set({ qrModalOpen: open, menuOpen: false }),
    setMenuOpen: (open) => set({ menuOpen: open }),
    dismissLatencyBanner: () => {
      localStorage.setItem('padbox_latency_banner_dismissed', '1');
      set({ showLatencyBanner: false });
    },
    setBpm: (bpm) => {
      const clamped = Math.max(40, Math.min(240, Math.round(bpm * 10) / 10));
      if (audioEngine.isUnlocked) {
        audioEngine.performFx.setBpm(clamped);
      }
      set((s) => {
        const project = { ...s.project, bpm: clamped };
        scheduleSaveMeta(project);
        return { project };
      });
    },
    setRecordingState: (recording, padId = null, source = null) =>
      set({ isRecording: recording, recordingPadId: padId, recordingSource: source }),

    showToast: (msg) => {
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      set({ toastMessage: msg });
      toastTimer = window.setTimeout(() => {
        set({ toastMessage: null });
        toastTimer = null;
      }, 2600);
    },

    assignSampleToPad: (padId, buffer, name, overrides) => {
      const state = get();
      pushUndo(state.project);
      const sampleId = makeSampleId();
      audioEngine.setSample(sampleId, buffer);
      void saveSampleBuffer(sampleId, buffer);

      const pads = state.project.pads.map((p) => {
        if (p.id !== padId) return p;
        return {
          ...p,
          name: name ?? p.name,
          hasSample: true,
          sampleId,
          duration: buffer.duration,
          start: 0,
          end: 1,
          reverse: false,
          slices: [],
          ...overrides,
        };
      });

      const project = { ...state.project, pads };
      scheduleSaveMeta(project);
      set({ project, selectedPadId: padId });
    },

    updatePad: (padId, patch, recordUndo = false) => {
      const state = get();
      if (recordUndo) pushUndo(state.project);
      if (typeof patch.volume === 'number') {
        voiceManager.setPadLiveVolume(padId, patch.volume);
      }
      let updatedPad: PadConfig | null = null;
      const pads = state.project.pads.map((p) => {
        if (p.id !== padId) return p;
        updatedPad = { ...p, ...patch };
        return updatedPad;
      });
      const project = { ...state.project, pads };
      scheduleSaveMeta(project);
      set({ project });

      if (
        updatedPad &&
        (patch.start !== undefined ||
          patch.end !== undefined ||
          patch.loop !== undefined ||
          patch.oneShot !== undefined ||
          patch.pitch !== undefined ||
          patch.reverse !== undefined)
      ) {
        voiceManager.syncPadParams(updatedPad);
      }
    },

    clearPad: (padId) => {
      const state = get();
      pushUndo(state.project);
      voiceManager.stopByPad(padId);
      const fresh = createDefaultPad(padId);
      const pads = state.project.pads.map((p) => (p.id === padId ? fresh : p));
      const project = { ...state.project, pads };
      scheduleSaveMeta(project);
      set({ project });
    },

    copyPad: (fromId, toId) => {
      if (fromId === toId) return;
      const state = get();
      const src = state.project.pads[fromId];
      if (!src?.hasSample || !src.sampleId) return;
      const srcBuf = audioEngine.getSample(src.sampleId);
      if (!srcBuf) return;

      pushUndo(state.project);
      const clonedBuf = audioEngine.cloneBuffer(srcBuf);
      const newSampleId = makeSampleId();
      audioEngine.setSample(newSampleId, clonedBuf);
      void saveSampleBuffer(newSampleId, clonedBuf);

      const pads = state.project.pads.map((p) =>
        p.id === toId
          ? {
              ...src,
              id: toId,
              sampleId: newSampleId,
              name: src.name,
            }
          : p
      );
      const project = { ...state.project, pads };
      scheduleSaveMeta(project);
      set({ project, selectedPadId: toId });
      get().showToast(`Copiato su ${BANK_LABELS[Math.floor(toId / 16)]}${(toId % 16) + 1}`);
    },

    swapPads: (aId, bId) => {
      if (aId === bId) return;
      const state = get();
      pushUndo(state.project);
      const padA = state.project.pads[aId];
      const padB = state.project.pads[bId];
      const pads = state.project.pads.map((p) => {
        if (p.id === aId) return { ...padB, id: aId };
        if (p.id === bId) return { ...padA, id: bId };
        return p;
      });
      const project = { ...state.project, pads };
      scheduleSaveMeta(project);
      set({ project, selectedPadId: bId });
      get().showToast('Pad scambiati');
    },

    applyDestructiveNormalize: (padId) => {
      const state = get();
      const pad = state.project.pads[padId];
      const buf = audioEngine.getSample(pad?.sampleId ?? null);
      if (!pad || !buf) return;
      const norm = normalizeBuffer(buf, 0.96);
      get().assignSampleToPad(padId, norm, pad.name, {
        start: pad.start,
        end: pad.end,
        volume: pad.volume,
        pitch: pad.pitch,
        pan: pad.pan,
        tone: pad.tone,
        attack: pad.attack,
        release: pad.release,
        oneShot: pad.oneShot,
        loop: pad.loop,
        reverse: pad.reverse,
        chokeGroup: pad.chokeGroup,
      });
      get().showToast('Sample normalizzato');
    },

    applyDestructiveCrop: (padId) => {
      const state = get();
      const pad = state.project.pads[padId];
      const buf = audioEngine.getSample(pad?.sampleId ?? null);
      if (!pad || !buf) return;
      const cropped = cropBuffer(buf, pad.start, pad.end);
      get().assignSampleToPad(padId, cropped, pad.name, {
        start: 0,
        end: 1,
        volume: pad.volume,
        pitch: pad.pitch,
        pan: pad.pan,
        tone: pad.tone,
        attack: pad.attack,
        release: pad.release,
        oneShot: pad.oneShot,
        loop: pad.loop,
        reverse: pad.reverse,
        chokeGroup: pad.chokeGroup,
      });
      get().showToast('Sample ritagliato (Crop)');
    },

    applyDestructiveReverse: (padId) => {
      const state = get();
      const pad = state.project.pads[padId];
      const buf = audioEngine.getSample(pad?.sampleId ?? null);
      if (!pad || !buf) return;
      const rev = audioEngine.createReversedBuffer(buf);
      get().assignSampleToPad(padId, rev, pad.name, {
        start: 1 - pad.end,
        end: 1 - pad.start,
        reverse: false,
        volume: pad.volume,
        pitch: pad.pitch,
        pan: pad.pan,
        tone: pad.tone,
        attack: pad.attack,
        release: pad.release,
        oneShot: pad.oneShot,
        loop: pad.loop,
        chokeGroup: pad.chokeGroup,
      });
      get().showToast('Buffer invertito');
    },

    assignSlicesToPads: (sourcePadId, rawSlices) => {
      const state = get();
      const srcPad = state.project.pads[sourcePadId];
      const srcBuf = audioEngine.getSample(srcPad?.sampleId ?? null);
      if (!srcPad || !srcBuf || rawSlices.length === 0) return 0;

      const sorted = Array.from(new Set(rawSlices))
        .filter((v) => v >= srcPad.start && v < srcPad.end - 0.004)
        .sort((a, b) => a - b);
      if (sorted.length === 0) return 0;

      // Find empty pads first (starting after sourcePadId, wrapping across all 64 pads)
      const targetIds: number[] = [];
      for (let offset = 1; offset < 64 && targetIds.length < sorted.length; offset++) {
        const idx = (sourcePadId + offset) % 64;
        if (!state.project.pads[idx].hasSample) {
          targetIds.push(idx);
        }
      }

      if (targetIds.length === 0) {
        get().showToast('Nessun pad libero disponibile (svuota un banco prima)');
        return 0;
      }

      pushUndo(state.project);
      const pads = [...state.project.pads];

      for (let i = 0; i < targetIds.length; i++) {
        const sliceStart = sorted[i];
        const sliceEnd = i + 1 < sorted.length ? sorted[i + 1] : srcPad.end;
        const targetId = targetIds[i];

        // Share the underlying AudioBuffer reference via independent cloned sampleId or shared sampleId
        // Sharing the exact AudioBuffer (same sampleId) is instant, uses zero extra RAM, and lets users readjust start/end later!
        pads[targetId] = {
          ...pads[targetId],
          name: `${srcPad.name.slice(0, 8)} #${i + 1}`,
          color: srcPad.color,
          hasSample: true,
          sampleId: srcPad.sampleId,
          duration: srcBuf.duration,
          start: sliceStart,
          end: sliceEnd,
          volume: srcPad.volume,
          pitch: srcPad.pitch,
          tone: srcPad.tone,
          attack: 0.003,
          release: 0.04,
          oneShot: true,
          loop: false,
          reverse: false,
          chokeGroup: srcPad.chokeGroup || 4, // Auto-assign choke group so chops play cleanly!
          slices: [],
        };
      }

      const project = { ...state.project, pads };
      scheduleSaveMeta(project);
      const targetBank = Math.floor(targetIds[0] / 16) as BankId;
      set({ project, activeBank: targetBank, selectedPadId: targetIds[0] });
      get().showToast(`${targetIds.length} slice assegnati ai pad (Choke ${srcPad.chokeGroup || 4})`);
      return targetIds.length;
    },

    loadStarterKit: () => {
      const state = get();
      pushUndo(state.project);
      voiceManager.stopAll();
      const specs = generateStarterKit();
      const pads = [...state.project.pads];

      for (const spec of specs) {
        const sampleId = makeSampleId();
        audioEngine.setSample(sampleId, spec.buffer);
        void saveSampleBuffer(sampleId, spec.buffer);
        pads[spec.padIndex] = {
          ...createDefaultPad(spec.padIndex),
          name: spec.name,
          color: spec.color,
          hasSample: true,
          sampleId,
          duration: spec.buffer.duration,
          chokeGroup: spec.chokeGroup,
          oneShot: spec.oneShot,
          loop: spec.loop ?? false,
        };
      }

      const project = { ...state.project, name: 'Boom Bap Kit', bpm: 92, pads };
      scheduleSaveMeta(project);
      set({ project, activeBank: 0, selectedPadId: 0 });
      get().showToast('Boom Bap Kit caricato (Banco A)');
    },

    clearProject: () => {
      const state = get();
      pushUndo(state.project);
      voiceManager.stopAll();
      audioEngine.clearAllSamples();
      void clearAllStoredSamples();
      const fresh = createDefaultProject();
      scheduleSaveMeta(fresh);
      set({
        project: fresh,
        activeBank: 0,
        selectedPadId: 0,
        editorOpen: false,
        keyboardOpen: false,
      });
      get().showToast('Progetto svuotato');
    },

    undo: () => {
      const stack = get().undoStack;
      if (stack.length === 0) return;
      const prev = stack[stack.length - 1];
      scheduleSaveMeta(prev);
      set({
        project: prev,
        undoStack: stack.slice(0, -1),
      });
      get().showToast('Annullato (Undo)');
    },

    // --- Sequencer & Piano Roll Actions ---
    setSeqTransport: (playing, recording, countingIn, countInBeat) =>
      set({
        isSeqPlaying: playing,
        isSeqRecording: recording,
        isCountingIn: countingIn,
        countInBeat,
      }),

    selectSequence: (seqId) => set({ activeSequenceId: seqId }),

    addSequence: () => {
      const state = get();
      if (state.project.sequences.length >= 16) {
        get().showToast('Massimo 16 sequenze raggiunte');
        return;
      }
      pushUndo(state.project);
      const nextNum = state.project.sequences.length + 1;
      const newSeq: SequencePattern = {
        id: `seq-${Date.now().toString(36)}`,
        name: `Seq ${nextNum}`,
        bars: 2,
        notes: [],
      };
      const project = {
        ...state.project,
        sequences: [...state.project.sequences, newSeq],
      };
      scheduleSaveMeta(project);
      set({ project, activeSequenceId: newSeq.id });
    },

    duplicateSequence: (seqId) => {
      const state = get();
      const src = state.project.sequences.find((s) => s.id === seqId);
      if (!src) return;
      if (state.project.sequences.length >= 16) {
        get().showToast('Massimo 16 sequenze raggiunte');
        return;
      }
      pushUndo(state.project);
      const copy: SequencePattern = {
        id: `seq-${Date.now().toString(36)}`,
        name: `Seq ${state.project.sequences.length + 1}`,
        bars: src.bars,
        notes: src.notes.map((n, i) => ({
          ...n,
          id: `n-${Date.now().toString(36)}-${i}`,
        })),
      };
      const project = {
        ...state.project,
        sequences: [...state.project.sequences, copy],
      };
      scheduleSaveMeta(project);
      set({ project, activeSequenceId: copy.id });
      get().showToast(`Duplicata in ${copy.name}`);
    },

    deleteSequence: (seqId) => {
      const state = get();
      if (state.project.sequences.length <= 1) {
        get().clearSequence(seqId);
        return;
      }
      pushUndo(state.project);
      const sequences = state.project.sequences.filter((s) => s.id !== seqId);
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({
        project,
        activeSequenceId:
          state.activeSequenceId === seqId ? sequences[0].id : state.activeSequenceId,
      });
    },

    clearSequence: (seqId) => {
      const state = get();
      pushUndo(state.project);
      const sequences = state.project.sequences.map((s) =>
        s.id === seqId ? { ...s, notes: [] } : s
      );
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({ project });
      get().showToast('Sequenza svuotata');
    },

    setSequenceBars: (seqId, bars) => {
      const state = get();
      pushUndo(state.project);
      const maxBeat = bars * 4;
      const sequences = state.project.sequences.map((s) => {
        if (s.id !== seqId) return s;
        // If doubling bars (e.g. 2 -> 4), optionally keep existing notes cleanly; if shrinking, trim out-of-range notes
        const notes = s.notes.filter((n) => n.startBeat < maxBeat);
        return { ...s, bars, notes };
      });
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({ project });
    },

    setSwing: (swing) => {
      const clamped = Math.max(0, Math.min(0.65, swing));
      set((s) => {
        const project = { ...s.project, swing: clamped };
        scheduleSaveMeta(project);
        return { project };
      });
    },

    setQuantize: (quantize) => {
      set((s) => {
        const project = { ...s.project, quantize };
        scheduleSaveMeta(project);
        return { project };
      });
    },

    toggleMetronome: () => set((s) => ({ metronomeOn: !s.metronomeOn })),
    setMetronomeOn: (on) => set({ metronomeOn: on }),
    setMetronomeVolume: (volume) => {
      const clamped = Math.max(0.05, Math.min(1, volume));
      set({ metronomeVolume: clamped });
    },
    toggleCountIn: () => set((s) => ({ countInOn: !s.countInOn })),
    toggleSongMode: () => set((s) => ({ songMode: !s.songMode })),

    toggleMutePad: (padId) =>
      set((s) => {
        const exists = s.mutedPads.includes(padId);
        return {
          mutedPads: exists
            ? s.mutedPads.filter((id) => id !== padId)
            : [...s.mutedPads, padId],
        };
      }),

    setPianoRollOpen: (open) => set({ pianoRollOpen: open }),
    setExportModalOpen: (open) => set({ exportModalOpen: open }),

    addNoteToSequence: (seqId, note) => {
      const state = get();
      const sequences = state.project.sequences.map((s) =>
        s.id === seqId ? { ...s, notes: [...s.notes, note] } : s
      );
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({ project });
    },

    removeNoteFromSequence: (seqId, noteId) => {
      const state = get();
      pushUndo(state.project);
      const sequences = state.project.sequences.map((s) =>
        s.id === seqId ? { ...s, notes: s.notes.filter((n) => n.id !== noteId) } : s
      );
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({ project });
    },

    toggleStepNote: (seqId, padId, startBeat) => {
      const state = get();
      const seq = state.project.sequences.find((s) => s.id === seqId);
      if (!seq) return;
      pushUndo(state.project);

      const existing = seq.notes.find(
        (n) => n.padId === padId && Math.abs(n.startBeat - startBeat) < 0.08
      );

      let nextNotes: NoteEvent[];
      if (existing) {
        nextNotes = seq.notes.filter((n) => n.id !== existing.id);
      } else {
        const note: NoteEvent = {
          id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          padId,
          startBeat: Math.round(startBeat * 1000) / 1000,
          durationBeats: 0.25,
          velocity: 0.9,
          pitchOffset: 0,
        };
        nextNotes = [...seq.notes, note];
      }

      const sequences = state.project.sequences.map((s) =>
        s.id === seqId ? { ...s, notes: nextNotes } : s
      );
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({ project });
    },

    updateNoteVelocity: (seqId, noteId, velocity) => {
      const clamped = Math.max(0.1, Math.min(1, velocity));
      const state = get();
      const sequences = state.project.sequences.map((s) =>
        s.id === seqId
          ? {
              ...s,
              notes: s.notes.map((n) =>
                n.id === noteId ? { ...n, velocity: clamped } : n
              ),
            }
          : s
      );
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({ project });
    },

    quantizeSequenceNow: (seqId) => {
      const state = get();
      const seq = state.project.sequences.find((s) => s.id === seqId);
      if (!seq || seq.notes.length === 0) return;

      const q = state.project.quantize || 16;
      const stepsPerBeat = q === 12 ? 3 : q / 4;
      const totalBeats = seq.bars * 4;
      pushUndo(state.project);

      const seen = new Set<string>();
      const quantized: NoteEvent[] = [];
      for (const n of seq.notes) {
        let snapped = Math.round(n.startBeat * stepsPerBeat) / stepsPerBeat;
        if (snapped >= totalBeats - 0.001) snapped = 0;
        snapped = Math.round(snapped * 1000) / 1000;
        const key = `${n.padId}:${snapped}:${n.pitchOffset}`;
        if (seen.has(key)) continue;
        seen.add(key);
        quantized.push({ ...n, startBeat: snapped });
      }

      const sequences = state.project.sequences.map((s) =>
        s.id === seqId ? { ...s, notes: quantized } : s
      );
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({ project });
      get().showToast(`Note allineate a 1/${q}`);
    },

    clearPadFromSequence: (seqId, padId) => {
      const state = get();
      pushUndo(state.project);
      const sequences = state.project.sequences.map((s) =>
        s.id === seqId ? { ...s, notes: s.notes.filter((n) => n.padId !== padId) } : s
      );
      const project = { ...state.project, sequences };
      scheduleSaveMeta(project);
      set({ project });
    },

    // --- Phase 3: Pad Mixer & Simple Perform FX ---
    togglePadMixerMode: () => set((s) => ({ padMixerMode: !s.padMixerMode })),
    setPadMixerMode: (on) => set({ padMixerMode: on }),

    setFxValue: (id, value) => {
      const clamped = Math.max(0, Math.min(1, value));
      audioEngine.performFx.setBpm(get().project.bpm);
      audioEngine.performFx.setFx(id, clamped);
      set((s) => ({
        fxValues: { ...s.fxValues, [id]: clamped },
      }));
    },

    toggleFxHold: () => {
      const next = !get().fxHold;
      set({ fxHold: next });
      if (!next) {
        // Releasing HOLD drops all active FX cleanly on the beat!
        get().resetAllFx();
      }
    },

    resetAllFx: () => {
      audioEngine.performFx.resetAll();
      set({
        fxValues: {
          lpf: 0,
          hpf: 0,
          crush: 0,
          delay: 0,
          reverb: 0,
          stutter: 0,
        },
      });
    },
  };
});
