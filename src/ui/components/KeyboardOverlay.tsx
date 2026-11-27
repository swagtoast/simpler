import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Play,
  Square,
  Circle,
  Eraser,
} from 'lucide-react';
import { useStore } from '../../state/useStore';
import { audioEngine } from '../../audio/AudioEngine';
import { voiceManager } from '../../audio/VoiceManager';
import { sequencerEngine } from '../../audio/SequencerEngine';
import { t } from '../../i18n/t';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALES: Record<string, { label: string; intervals: number[] }> = {
  chromatic: { label: 'Chromatic (12)', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  minorPent: { label: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  majorPent: { label: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  minor: { label: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  major: { label: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  blues: { label: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
};

export const KeyboardOverlay: React.FC = () => {
  const selectedPadId = useStore((s) => s.selectedPadId);
  const pad = useStore((s) => s.project.pads[selectedPadId]);
  const sequences = useStore((s) => s.project.sequences);
  const activeSequenceId = useStore((s) => s.activeSequenceId);
  const isSeqPlaying = useStore((s) => s.isSeqPlaying);
  const isSeqRecording = useStore((s) => s.isSeqRecording);
  const isCountingIn = useStore((s) => s.isCountingIn);
  const countInBeat = useStore((s) => s.countInBeat);

  const clearPadFromSequence = useStore((s) => s.clearPadFromSequence);
  const setKeyboardOpen = useStore((s) => s.setKeyboardOpen);
  const showToast = useStore((s) => s.showToast);

  const [scaleId, setScaleId] = useState<string>('minorPent');
  const [octaveShift, setOctaveShift] = useState(0); // -2..+2
  const [gateMode, setGateMode] = useState(true);
  const [pressedOffsets, setPressedOffsets] = useState<Set<number>>(new Set());

  const pointerToOffset = useRef(new Map<number, number>());
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const barTextRef = useRef<HTMLSpanElement | null>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const activeSeq = sequences.find((s) => s.id === activeSequenceId) ?? sequences[0];
  const padNoteCount = useMemo(() => {
    if (!activeSeq || !pad) return 0;
    return activeSeq.notes.filter((n) => n.padId === pad.id).length;
  }, [activeSeq, pad]);

  // 60fps smooth bar/beat position readout & beat LEDs (zero React re-renders!)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const info = sequencerEngine.getPlayheadInfo();
      const totalBars = Math.max(1, Math.round(info.totalBeats / 4));

      if (progressBarRef.current) {
        progressBarRef.current.style.width =
          info.playing && !info.countingIn ? `${(info.progress * 100).toFixed(1)}%` : '0%';
      }

      if (barTextRef.current) {
        if (info.countingIn) {
          barTextRef.current.textContent = `COUNT ${info.countInBeat} / 4`;
        } else if (info.playing) {
          const curBar = Math.floor(info.beat / 4) + 1;
          const curBeat = Math.floor(info.beat % 4) + 1;
          barTextRef.current.textContent = `BAR ${curBar}.${curBeat} / ${totalBars}`;
        } else {
          barTextRef.current.textContent = `${totalBars} BAR`;
        }
      }

      const activeBeatIdx = info.countingIn
        ? info.countInBeat - 1
        : info.playing
          ? Math.floor(info.beat % 4)
          : -1;

      for (let i = 0; i < 4; i++) {
        const dot = dotRefs.current[i];
        if (!dot) continue;
        dot.classList.toggle('lit', i === activeBeatIdx);
        dot.classList.toggle('downbeat', i === 0 && i === activeBeatIdx);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const keys = useMemo(() => {
    const intervals = SCALES[scaleId]?.intervals ?? SCALES.chromatic.intervals;
    const list: { offset: number; label: string; isSharp: boolean; isRoot: boolean }[] = [];
    const baseSemi = octaveShift * 12;

    for (let oct = 0; oct < 2; oct++) {
      for (const semi of intervals) {
        const offset = baseSemi + oct * 12 + semi;
        const noteIdx = ((offset % 12) + 12) % 12;
        const name = NOTE_NAMES[noteIdx];
        const displayOct = 3 + octaveShift + oct;
        list.push({
          offset,
          label: `${name}${displayOct}`,
          isSharp: name.includes('#'),
          isRoot: semi === 0,
        });
      }
    }
    const topOffset = baseSemi + 24;
    list.push({
      offset: topOffset,
      label: `C${5 + octaveShift}`,
      isSharp: false,
      isRoot: true,
    });
    return list;
  }, [scaleId, octaveShift]);

  const handleDown = (e: React.PointerEvent<HTMLButtonElement>, offset: number) => {
    e.preventDefault();
    void audioEngine.unlock();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const tag = `kb-${e.pointerId}`;
    pointerToOffset.current.set(e.pointerId, offset);
    setPressedOffsets((prev) => {
      const next = new Set(prev);
      next.add(offset);
      return next;
    });

    if (pad?.hasSample) {
      voiceManager.triggerPad(pad, {
        pitchOffset: offset,
        forceGate: gateMode,
        voiceTag: tag,
      });
      sequencerEngine.recordLiveHit(pad.id, 0.9, offset);
    }
  };

  const handleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const offset = pointerToOffset.current.get(e.pointerId);
    if (offset === undefined) return;
    pointerToOffset.current.delete(e.pointerId);

    if (gateMode) {
      voiceManager.releaseTag(`kb-${e.pointerId}`);
    }

    setPressedOffsets((prev) => {
      const next = new Set(prev);
      next.delete(offset);
      return next;
    });
  };

  return (
    <div className="keyboard-overlay">
      {/* Sequencer Transport & Live Bar Position Strip (always visible in KEYS!) */}
      <div className="keys-transport-strip">
        <div className="keys-transport-left">
          <button
            type="button"
            className={`seq-big-btn ${isSeqPlaying ? 'playing' : ''}`}
            style={{ height: 32, padding: '0 10px' }}
            onPointerDown={() => sequencerEngine.togglePlay()}
          >
            {isSeqPlaying ? <Square size={13} /> : <Play size={13} />}
            <span>{isSeqPlaying ? 'STOP' : 'PLAY'}</span>
          </button>

          <button
            type="button"
            className={`seq-big-btn rec ${isSeqRecording ? 'recording' : ''}`}
            style={{ height: 32, padding: '0 10px' }}
            onPointerDown={() => sequencerEngine.toggleRecord()}
          >
            <Circle size={12} fill={isSeqRecording ? 'currentColor' : 'none'} />
            <span>
              {isCountingIn ? `${countInBeat}/4` : isSeqRecording ? 'REC' : 'REC'}
            </span>
          </button>

          {activeSeq && pad && padNoteCount > 0 && (
            <button
              type="button"
              className="pill-btn"
              style={{ height: 32, padding: '0 8px', borderColor: 'rgba(204,34,34,0.5)', color: 'var(--accent-primary)' }}
              onClick={() => {
                clearPadFromSequence(activeSeq.id, pad.id);
                showToast(t('kbClearedToast', { count: padNoteCount, pad: pad.name }));
              }}
              title={t('kbClearNotes', { pad: pad.name, seq: activeSeq.name })}
            >
              <Eraser size={13} />
              <span>×{padNoteCount}</span>
            </button>
          )}
        </div>

        <div className="keys-position-box">
          <div className="keys-pos-top">
            <span className="keys-seq-name">{activeSeq?.name ?? 'Seq 1'}</span>
            <span ref={barTextRef} className="keys-bar-readout">
              {activeSeq?.bars ?? 2} BAR
            </span>
            <div className="keys-beat-dots" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  ref={(el) => {
                    dotRefs.current[i] = el;
                  }}
                  className="beat-dot"
                />
              ))}
            </div>
          </div>
          <div className="keys-progress-track">
            <div ref={progressBarRef} className="keys-progress-fill" />
          </div>
        </div>

        <button
          type="button"
          className="icon-btn"
          style={{ height: 32, minWidth: 32 }}
          onClick={() => setKeyboardOpen(false)}
          aria-label={t('kbClose')}
        >
          <X size={16} />
        </button>
      </div>

      {/* Sound, Scale, Octave & Gate Controls */}
      <div className="keyboard-controls">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              background: pad?.color || '#fff',
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 800,
              color: 'var(--text-primary)',
              maxWidth: 130,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pad?.hasSample ? pad.name : t('kbEmptyPad')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <select
            className="scale-select"
            style={{ height: 30, fontSize: 11.5 }}
            value={scaleId}
            onChange={(e) => setScaleId(e.target.value)}
            aria-label="Scale"
          >
            {Object.entries(SCALES).map(([id, sc]) => (
              <option key={id} value={id}>
                {sc.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="icon-btn"
            style={{ height: 30, minWidth: 30 }}
            onClick={() => setOctaveShift((o) => Math.max(-2, o - 1))}
            title="Octave Down"
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700 }}>
            OCT {octaveShift >= 0 ? `+${octaveShift}` : octaveShift}
          </span>
          <button
            type="button"
            className="icon-btn"
            style={{ height: 30, minWidth: 30 }}
            onClick={() => setOctaveShift((o) => Math.min(2, o + 1))}
            title="Octave Up"
          >
            <ChevronRight size={14} />
          </button>

          <button
            type="button"
            className={`toggle-chip ${gateMode ? 'on' : ''}`}
            style={{ height: 30, padding: '0 9px', fontSize: 11 }}
            onClick={() => setGateMode((g) => !g)}
          >
            {gateMode ? 'GATE' : '1-SHOT'}
          </button>
        </div>
      </div>

      {!pad?.hasSample ? (
        <div className="phase-placeholder">
          <p>{t('kbEmptyMsg')}</p>
        </div>
      ) : (
        <div className="piano-grid">
          {keys.map((k) => {
            const isActive = pressedOffsets.has(k.offset);
            return (
              <button
                key={k.offset}
                type="button"
                className={[
                  'piano-key',
                  k.isSharp ? 'sharp' : '',
                  k.isRoot ? 'root' : '',
                  isActive ? 'active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onPointerDown={(e) => handleDown(e, k.offset)}
                onPointerUp={handleUp}
                onPointerCancel={handleUp}
                onContextMenu={(e) => e.preventDefault()}
              >
                <span>{k.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
