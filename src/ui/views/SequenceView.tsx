import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Square,
  Circle,
  Volume2,
  Grid,
  Download,
  Plus,
  Copy,
  Trash2,
  Repeat,
  Piano,
  Eraser,
  SlidersVertical,
} from 'lucide-react';
import { BANK_LABELS, BankId } from '../../state/types';
import { useStore } from '../../state/useStore';
import { sequencerEngine } from '../../audio/SequencerEngine';
import { PadGrid } from '../components/PadGrid';
import { PianoRollOverlay } from '../components/PianoRollOverlay';
import { ExportModal } from '../components/ExportModal';
import { KeyboardOverlay } from '../components/KeyboardOverlay';
import { t } from '../../i18n/t';

const QUANT_OPTIONS = [16, 8, 12, 0] as const;
const SWING_PRESETS = [0, 0.2, 0.38, 0.55] as const;
const BAR_OPTIONS = [1, 2, 4, 8] as const;

export const SequenceView: React.FC = () => {
  const sequences = useStore((s) => s.project.sequences);
  const pads = useStore((s) => s.project.pads);
  const quantize = useStore((s) => s.project.quantize);
  const swing = useStore((s) => s.project.swing);
  const activeSequenceId = useStore((s) => s.activeSequenceId);
  const activeBank = useStore((s) => s.activeBank);
  const isSeqPlaying = useStore((s) => s.isSeqPlaying);
  const isSeqRecording = useStore((s) => s.isSeqRecording);
  const isCountingIn = useStore((s) => s.isCountingIn);
  const countInBeat = useStore((s) => s.countInBeat);
  const metronomeOn = useStore((s) => s.metronomeOn);
  const songMode = useStore((s) => s.songMode);
  const pianoRollOpen = useStore((s) => s.pianoRollOpen);
  const exportModalOpen = useStore((s) => s.exportModalOpen);
  const keyboardOpen = useStore((s) => s.keyboardOpen);
  const padMixerMode = useStore((s) => s.padMixerMode);

  const selectSequence = useStore((s) => s.selectSequence);
  const togglePadMixerMode = useStore((s) => s.togglePadMixerMode);
  const addSequence = useStore((s) => s.addSequence);
  const duplicateSequence = useStore((s) => s.duplicateSequence);
  const clearSequence = useStore((s) => s.clearSequence);
  const setSequenceBars = useStore((s) => s.setSequenceBars);
  const setQuantize = useStore((s) => s.setQuantize);
  const setSwing = useStore((s) => s.setSwing);
  const toggleSongMode = useStore((s) => s.toggleSongMode);
  const setActiveBank = useStore((s) => s.setActiveBank);
  const setPianoRollOpen = useStore((s) => s.setPianoRollOpen);
  const setExportModalOpen = useStore((s) => s.setExportModalOpen);
  const setKeyboardOpen = useStore((s) => s.setKeyboardOpen);
  const clearPadFromSequence = useStore((s) => s.clearPadFromSequence);
  const showToast = useStore((s) => s.showToast);

  const [eraseMode, setEraseMode] = useState(false);

  const activeSeq = sequences.find((s) => s.id === activeSequenceId) ?? sequences[0];
  const progressRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Count how many hits each pad has in the active sequence (for lightweight ERASE badges)
  const seqNoteCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    if (!activeSeq) return counts;
    for (const n of activeSeq.notes) {
      counts[n.padId] = (counts[n.padId] ?? 0) + 1;
    }
    return counts;
  }, [activeSeq]);

  // 60fps progress bar on active playing sequence slot
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const info = sequencerEngine.getPlayheadInfo();
      for (const seq of useStore.getState().project.sequences) {
        const el = progressRefs.current[seq.id];
        if (!el) continue;
        if (info.playing && !info.countingIn && info.sequenceId === seq.id) {
          el.style.width = `${(info.progress * 100).toFixed(1)}%`;
        } else {
          el.style.width = '0%';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cycleQuantize = () => {
    const idx = QUANT_OPTIONS.indexOf(quantize as (typeof QUANT_OPTIONS)[number]);
    const next = QUANT_OPTIONS[(idx + 1) % QUANT_OPTIONS.length];
    setQuantize(next);
    showToast(
      next === 0 ? t('quantFree') : next === 12 ? t('quantTriplet') : `Quantize: 1/${next}`
    );
  };

  const cycleSwing = () => {
    const curIdx = SWING_PRESETS.findIndex((v) => Math.abs(v - swing) < 0.05);
    const next = SWING_PRESETS[(curIdx + 1) % SWING_PRESETS.length];
    setSwing(next);
    showToast(`Swing: ${Math.round(next * 100)}%`);
  };

  const cycleBars = () => {
    if (!activeSeq) return;
    const idx = BAR_OPTIONS.indexOf(activeSeq.bars as (typeof BAR_OPTIONS)[number]);
    const next = BAR_OPTIONS[(idx + 1) % BAR_OPTIONS.length];
    setSequenceBars(activeSeq.id, next);
    showToast(`${activeSeq.name}: ${next} ${next === 1 ? t('barsSingle') : t('barsPlural')}`);
  };

  const quantLabel =
    quantize === 0 ? 'Q: OFF' : quantize === 12 ? 'Q: 1/8T' : `Q: 1/${quantize}`;

  const bankHasSamples = (bank: BankId) =>
    pads.slice(bank * 16, bank * 16 + 16).some((p) => p.hasSample);

  return (
    <section className="seq-view" aria-label="Sequence View">
      {/* 1. Big Beginner-Friendly Transport & Groove Row */}
      <div className="seq-transport-row">
        <button
          type="button"
          className={`seq-big-btn ${isSeqPlaying ? 'playing' : ''}`}
          onPointerDown={() => sequencerEngine.togglePlay()}
        >
          {isSeqPlaying ? <Square size={15} /> : <Play size={15} />}
          <span>{isSeqPlaying ? 'STOP' : 'PLAY'}</span>
        </button>

        <button
          type="button"
          className={`seq-big-btn rec ${isSeqRecording ? 'recording' : ''}`}
          onPointerDown={() => sequencerEngine.toggleRecord()}
        >
          <Circle size={14} fill={isSeqRecording ? 'currentColor' : 'none'} />
          <span>
            {isCountingIn ? `COUNT ${countInBeat}` : isSeqRecording ? 'REC ON' : 'REC'}
          </span>
        </button>

        <button
          type="button"
          className={`pill-btn ${metronomeOn ? 'active-primary' : ''}`}
          onClick={() => sequencerEngine.toggleMetronome()}
          title={t('clickTitle')}
        >
          <Volume2 size={13} />
          <span>CLICK</span>
        </button>

        <button
          type="button"
          className={`pill-btn ${quantize > 0 ? 'active-mode' : ''}`}
          onClick={cycleQuantize}
          title={t('quantTitle')}
        >
          <span>{quantLabel}</span>
        </button>

        <button
          type="button"
          className={`pill-btn ${swing > 0 ? 'active-resample' : ''}`}
          onClick={cycleSwing}
          title={t('swingTitle')}
        >
          <span>SWING {Math.round(swing * 100)}%</span>
        </button>

        <button
          type="button"
          className="pill-btn active-primary"
          onClick={() => setPianoRollOpen(true)}
          title={t('editBeatTitle')}
        >
          <Grid size={13} />
          <span>EDIT BEAT</span>
        </button>

        <button
          type="button"
          className="pill-btn"
          onClick={() => setExportModalOpen(true)}
          title={t('wavTitle')}
        >
          <Download size={13} />
          <span>WAV</span>
        </button>
      </div>

      {/* 2. Sequence Slots Strip */}
      <div className="seq-slots-bar">
        <div className="seq-slots-scroll">
          {sequences.map((seq) => {
            const isActive = seq.id === activeSeq?.id;
            const hasNotes = seq.notes.length > 0;
            return (
              <button
                key={seq.id}
                type="button"
                className={`seq-slot ${isActive ? 'active' : ''} ${hasNotes ? 'filled' : ''}`}
                onClick={() => selectSequence(seq.id)}
              >
                <div className="seq-slot-top">
                  <span className="seq-slot-name">{seq.name}</span>
                  <span className="seq-slot-bars">{seq.bars}B</span>
                </div>
                <div className="seq-slot-meta">
                  {hasNotes ? t('notesCount', { count: seq.notes.length }) : t('emptySeq')}
                </div>
                <div
                  ref={(el) => {
                    progressRefs.current[seq.id] = el;
                  }}
                  className="seq-slot-progress"
                />
              </button>
            );
          })}

          <button
            type="button"
            className="seq-slot add-slot"
            onClick={addSequence}
            title={t('addSeqTitle')}
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Active Pattern Quick Controls */}
        {activeSeq && (
          <div className="seq-slot-actions">
            <button type="button" className="pill-btn" onClick={cycleBars} title={t('barsTitle')}>
              <span>{activeSeq.bars} BAR</span>
            </button>
            <button
              type="button"
              className={`pill-btn ${songMode ? 'active-mode' : ''}`}
              onClick={toggleSongMode}
              title={t('songTitle')}
            >
              <Repeat size={12} />
              <span>SONG</span>
            </button>
            <button
              type="button"
              className="pill-btn"
              onClick={() => duplicateSequence(activeSeq.id)}
              title={t('dupSeqTitle')}
            >
              <Copy size={12} />
            </button>
            <button
              type="button"
              className="pill-btn"
              onClick={() => clearSequence(activeSeq.id)}
              title={t('clearSeqTitle')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Friendly Count-In / Recording Guide */}
      {isCountingIn && (
        <div className="mode-hint rec" style={{ justifyContent: 'center', fontSize: 14 }}>
          <span>{t('countInReady', { beat: countInBeat })}</span>
        </div>
      )}

      {!isCountingIn && isSeqRecording && (
        <div className="mode-hint rec" style={{ fontSize: 12 }}>
          <span>🔴 {t('seqRecActive', { name: activeSeq?.name ?? 'Seq 1' })}</span>
          <button
            type="button"
            className="latency-banner-close"
            onClick={() => sequencerEngine.toggleRecord()}
          >
            Stop Rec
          </button>
        </div>
      )}

      {/* 3. Bank Selector + VOL + ERASE + KEYS + 4x4 Pads */}
      <div className="seq-bank-row">
        <div className="bank-switcher">
          {([0, 1, 2, 3] as BankId[]).map((b) => (
            <button
              key={b}
              type="button"
              className={`bank-btn ${activeBank === b ? 'active' : ''} ${bankHasSamples(b) ? 'has-samples' : ''}`}
              onClick={() => setActiveBank(b)}
            >
              {BANK_LABELS[b]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className={`pill-btn ${padMixerMode ? 'active-primary' : ''}`}
            onClick={() => {
              setEraseMode(false);
              togglePadMixerMode();
            }}
            title={t('volBtnTitle')}
          >
            <SlidersVertical size={13} />
            <span>VOL</span>
          </button>

          <button
            type="button"
            className={`pill-btn ${eraseMode ? 'active-rec' : ''}`}
            disabled={!activeSeq || activeSeq.notes.length === 0}
            onClick={() => setEraseMode((v) => !v)}
            title={t('eraseTitle')}
          >
            <Eraser size={13} />
            <span>{eraseMode ? t('done').toUpperCase() : 'ERASE'}</span>
          </button>

          <button
            type="button"
            className="pill-btn"
            onClick={() => {
              setEraseMode(false);
              setKeyboardOpen(true);
            }}
            title={t('keysSeqTitle')}
          >
            <Piano size={13} />
            <span>KEYS</span>
          </button>
        </div>
      </div>

      {eraseMode && activeSeq && (
        <div className="mode-hint rec" style={{ fontSize: 12 }}>
          <span>{t('eraseHint', { name: activeSeq.name })}</span>
          <button type="button" className="latency-banner-close" onClick={() => setEraseMode(false)}>
            {t('done')}
          </button>
        </div>
      )}

      <div className="sample-body">
        <PadGrid
          playOnly
          eraseMode={eraseMode}
          seqNoteCounts={seqNoteCounts}
          onErasePad={(padId) => {
            if (!activeSeq) return;
            clearPadFromSequence(activeSeq.id, padId);
            const padName = pads[padId]?.name || 'Pad';
            showToast(t('removedFromSeq', { pad: padName, seq: activeSeq.name }));
            const remaining = activeSeq.notes.filter((n) => n.padId !== padId).length;
            if (remaining === 0) setEraseMode(false);
          }}
        />
      </div>

      {pianoRollOpen && activeSeq && <PianoRollOverlay seqId={activeSeq.id} />}
      {exportModalOpen && <ExportModal />}
      {keyboardOpen && <KeyboardOverlay />}
    </section>
  );
};
