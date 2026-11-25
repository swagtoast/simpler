import React, { useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../../state/useStore';
import { audioEngine } from '../../audio/AudioEngine';
import { voiceManager } from '../../audio/VoiceManager';
import { sequencerEngine } from '../../audio/SequencerEngine';

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
  const setKeyboardOpen = useStore((s) => s.setKeyboardOpen);

  const [scaleId, setScaleId] = useState<string>('minorPent');
  const [octaveShift, setOctaveShift] = useState(0); // -2..+2
  const [gateMode, setGateMode] = useState(true);
  const [pressedOffsets, setPressedOffsets] = useState<Set<number>>(new Set());

  const pointerToOffset = useRef(new Map<number, number>());

  const keys = useMemo(() => {
    const intervals = SCALES[scaleId]?.intervals ?? SCALES.chromatic.intervals;
    const list: { offset: number; label: string; isSharp: boolean; isRoot: boolean }[] = [];
    const baseSemi = octaveShift * 12;

    // 2 full octaves + top root
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
      <div className="keyboard-controls">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong style={{ fontSize: 13 }}>KEYS:</strong>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: pad?.color || '#fff',
              maxWidth: 130,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pad?.hasSample ? pad.name : 'Pad vuoto'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <select
            className="scale-select"
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
            onClick={() => setOctaveShift((o) => Math.max(-2, o - 1))}
            title="Octave Down"
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>
            OCT {octaveShift >= 0 ? `+${octaveShift}` : octaveShift}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setOctaveShift((o) => Math.min(2, o + 1))}
            title="Octave Up"
          >
            <ChevronRight size={14} />
          </button>

          <button
            type="button"
            className={`toggle-chip ${gateMode ? 'on' : ''}`}
            onClick={() => setGateMode((g) => !g)}
          >
            {gateMode ? 'GATE' : '1-SHOT'}
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setKeyboardOpen(false)}
            aria-label="Chiudi tastiera"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {!pad?.hasSample ? (
        <div className="phase-placeholder">
          <p>Seleziona un pad con un sample caricato (es. Chord o Pluck) per suonarlo sulla tastiera.</p>
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
