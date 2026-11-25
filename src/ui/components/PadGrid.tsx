import React, { useEffect, useRef } from 'react';
import { BANK_LABELS, PadConfig } from '../../state/types';
import { useStore } from '../../state/useStore';
import { audioEngine } from '../../audio/AudioEngine';
import { voiceManager } from '../../audio/VoiceManager';
import { recorderService } from '../../audio/RecorderService';
import { sequencerEngine } from '../../audio/SequencerEngine';

const KEYBOARD_MAP = [
  '1', '2', '3', '4',
  'q', 'w', 'e', 'r',
  'a', 's', 'd', 'f',
  'z', 'x', 'c', 'v',
];

interface PadGridProps {
  onStartMicHold?: (padId: number) => void;
  onStopMicHold?: (padId: number) => void;
  onSelectResampleTarget?: (padId: number) => void;
  playOnly?: boolean;
}

export const PadGrid: React.FC<PadGridProps> = ({
  onStartMicHold,
  onStopMicHold,
  onSelectResampleTarget,
  playOnly = false,
}) => {
  const activeBank = useStore((s) => s.activeBank);
  const pads = useStore((s) => s.project.pads);
  const selectedPadId = useStore((s) => s.selectedPadId);
  const toolMode = useStore((s) => s.toolMode);
  const dragSourcePadId = useStore((s) => s.dragSourcePadId);
  const recordingPadId = useStore((s) => s.recordingPadId);
  const recordingSource = useStore((s) => s.recordingSource);
  const editorOpen = useStore((s) => s.editorOpen);
  const keyboardOpen = useStore((s) => s.keyboardOpen);
  const qrModalOpen = useStore((s) => s.qrModalOpen);
  const menuOpen = useStore((s) => s.menuOpen);

  const selectPad = useStore((s) => s.selectPad);
  const setDragSourcePadId = useStore((s) => s.setDragSourcePadId);
  const setToolMode = useStore((s) => s.setToolMode);
  const copyPad = useStore((s) => s.copyPad);
  const swapPads = useStore((s) => s.swapPads);
  const showToast = useStore((s) => s.showToast);

  const bankOffset = activeBank * 16;
  const bankPads: PadConfig[] = pads.slice(bankOffset, bankOffset + 16);

  const glowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const progressRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activePointers = useRef(
    new Map<
      number,
      {
        padId: number;
        micHold: boolean;
        micStarted: boolean;
        holdTimer: number | null;
      }
    >()
  );

  // 60fps direct DOM playhead, trigger glow & live mic level (zero React re-renders)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const recPadId = recorderService.recordingPadId;
      const recPeak = recorderService.currentInputPeak;

      for (let i = 0; i < 16; i++) {
        const padId = bankOffset + i;
        const glowEl = glowRefs.current[i];
        const progEl = progressRefs.current[i];

        if (recPadId === padId && recorderService.isRecording) {
          if (glowEl) glowEl.style.opacity = Math.min(0.65, 0.2 + recPeak * 0.7).toFixed(3);
          if (progEl) progEl.style.width = `${Math.min(100, Math.round(recPeak * 120))}%`;
          continue;
        }

        const st = voiceManager.getPadPlaybackState(padId);
        if (glowEl) {
          const opacity = st.active ? Math.max(0.2, st.flash * 0.5) : st.flash * 0.42;
          glowEl.style.opacity = opacity > 0.01 ? opacity.toFixed(3) : '0';
        }
        if (progEl) {
          progEl.style.width = st.active ? `${(st.regionProgress * 100).toFixed(1)}%` : '0%';
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [bankOffset]);

  // Desktop PC keyboard triggering (1-4 / Q-R / A-F / Z-V)
  useEffect(() => {
    const downKeys = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (editorOpen || keyboardOpen || qrModalOpen || menuOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();
      const idx = KEYBOARD_MAP.indexOf(key);
      if (idx === -1 || downKeys.has(key)) return;

      downKeys.add(key);
      const padId = bankOffset + idx;
      const pad = useStore.getState().project.pads[padId];
      void audioEngine.unlock();
      selectPad(padId);
      if (pad?.hasSample) {
        voiceManager.triggerPad(pad);
        sequencerEngine.recordLiveHit(pad.id);
      }
      cellRefs.current[idx]?.classList.add('pressed');
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const idx = KEYBOARD_MAP.indexOf(key);
      if (idx === -1) return;
      downKeys.delete(key);
      const padId = bankOffset + idx;
      voiceManager.releasePad(padId);
      cellRefs.current[idx]?.classList.remove('pressed');
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [bankOffset, editorOpen, keyboardOpen, qrModalOpen, menuOpen, selectPad]);

  const handlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    pad: PadConfig,
    localIdx: number
  ) => {
    e.preventDefault();
    void audioEngine.unlock();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture not supported
    }

    // Mode: COPY or SWAP (only on Sample tab)
    if (!playOnly && (toolMode === 'copy' || toolMode === 'swap')) {
      if (dragSourcePadId === null) {
        if (toolMode === 'copy' && !pad.hasSample) return;
        setDragSourcePadId(pad.id);
        selectPad(pad.id);
      } else {
        if (toolMode === 'copy') {
          copyPad(dragSourcePadId, pad.id);
        } else {
          swapPads(dragSourcePadId, pad.id);
        }
        setDragSourcePadId(null);
        setToolMode('play');
      }
      return;
    }

    // Mode: RESAMPLE target selection
    if (!playOnly && toolMode === 'resample' && !recorderService.isRecording && onSelectResampleTarget) {
      selectPad(pad.id);
      onSelectResampleTarget(pad.id);
      return;
    }

    selectPad(pad.id);
    cellRefs.current[localIdx]?.classList.add('pressed');

    // KOALA-STYLE INSTANT HOLD-TO-RECORD ON ANY EMPTY PAD (Sample tab only)
    if (!playOnly && !pad.hasSample && !recorderService.isRecording && onStartMicHold) {
      const entry = {
        padId: pad.id,
        micHold: true,
        micStarted: false,
        holdTimer: window.setTimeout(() => {
          entry.micStarted = true;
          onStartMicHold(pad.id);
        }, 120),
      };
      activePointers.current.set(e.pointerId, entry);
      return;
    }

    // Loaded pad: instant 0-delay trigger + live sequencer overdub if REC is on!
    activePointers.current.set(e.pointerId, {
      padId: pad.id,
      micHold: false,
      micStarted: false,
      holdTimer: null,
    });
    if (pad.hasSample) {
      voiceManager.triggerPad(pad);
      sequencerEngine.recordLiveHit(pad.id);
    }
  };

  const handlePointerUpOrCancel = (
    e: React.PointerEvent<HTMLButtonElement>,
    localIdx: number
  ) => {
    cellRefs.current[localIdx]?.classList.remove('pressed');
    const info = activePointers.current.get(e.pointerId);
    if (!info) return;
    activePointers.current.delete(e.pointerId);

    if (info.holdTimer !== null) {
      window.clearTimeout(info.holdTimer);
    }

    if (info.micHold) {
      if (info.micStarted && onStopMicHold) {
        onStopMicHold(info.padId);
      } else {
        showToast('Tieni premuto un pad vuoto per registrare col microfono');
      }
    } else {
      voiceManager.releasePad(info.padId);
    }
  };

  return (
    <div className="pad-grid" role="grid" aria-label={`Bank ${BANK_LABELS[activeBank]} Pads`}>
      {bankPads.map((pad, idx) => {
        const isSelected = pad.id === selectedPadId;
        const isDragSource = pad.id === dragSourcePadId;
        const isRecTarget = pad.id === recordingPadId;
        const labelCode = `${BANK_LABELS[activeBank]}${idx + 1}`;

        return (
          <button
            key={pad.id}
            ref={(el) => {
              cellRefs.current[idx] = el;
            }}
            type="button"
            className={[
              'pad-cell',
              pad.hasSample ? 'loaded' : '',
              isSelected ? 'selected' : '',
              isDragSource ? 'drag-source' : '',
              isRecTarget ? 'recording' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ '--pad-color': pad.color } as React.CSSProperties}
            onPointerDown={(e) => handlePointerDown(e, pad, idx)}
            onPointerUp={(e) => handlePointerUpOrCancel(e, idx)}
            onPointerCancel={(e) => handlePointerUpOrCancel(e, idx)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              ref={(el) => {
                glowRefs.current[idx] = el;
              }}
              className="pad-glow"
            />
            <div
              ref={(el) => {
                progressRefs.current[idx] = el;
              }}
              className="pad-progress"
            />

            <div className="pad-top-row">
              <span className="pad-index">{labelCode}</span>
              <div className="pad-badges">
                {isRecTarget && (
                  <span className="pad-badge" style={{ background: '#ef4444', color: '#fff' }}>
                    {recordingSource === 'resample' ? 'RSMP' : 'REC'}
                  </span>
                )}
                {pad.loop && <span className="pad-badge">LOOP</span>}
                {pad.reverse && <span className="pad-badge">REV</span>}
                {pad.chokeGroup > 0 && <span className="pad-badge">C{pad.chokeGroup}</span>}
              </div>
            </div>

            <div className="pad-name">
              {pad.hasSample
                ? pad.name
                : playOnly
                  ? '—'
                  : toolMode === 'resample'
                    ? 'Tap Target'
                    : 'Hold to Rec'}
            </div>
          </button>
        );
      })}
    </div>
  );
};
