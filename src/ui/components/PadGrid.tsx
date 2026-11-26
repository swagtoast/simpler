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

const PAD_LED_SEGMENTS = 8;

interface PadGridProps {
  onStartMicHold?: (padId: number) => void;
  onStopMicHold?: (padId: number) => void;
  onSelectResampleTarget?: (padId: number) => void;
  playOnly?: boolean;
  eraseMode?: boolean;
  seqNoteCounts?: Record<number, number>;
  onErasePad?: (padId: number) => void;
}

export const PadGrid: React.FC<PadGridProps> = ({
  onStartMicHold,
  onStopMicHold,
  onSelectResampleTarget,
  playOnly = false,
  eraseMode = false,
  seqNoteCounts,
  onErasePad,
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
  const padMixerMode = useStore((s) => s.padMixerMode);

  const selectPad = useStore((s) => s.selectPad);
  const updatePad = useStore((s) => s.updatePad);
  const setDragSourcePadId = useStore((s) => s.setDragSourcePadId);
  const setToolMode = useStore((s) => s.setToolMode);
  const copyPad = useStore((s) => s.copyPad);
  const swapPads = useStore((s) => s.swapPads);
  const showToast = useStore((s) => s.showToast);

  const bankOffset = activeBank * 16;
  const bankPads: PadConfig[] = pads.slice(bankOffset, bankOffset + 16);

  const glowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const progressRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cellRefs = useRef<(HTMLElement | null)[]>([]);
  const padVuSegRefs = useRef<(HTMLSpanElement | null)[][]>(
    Array.from({ length: 16 }, () => Array(PAD_LED_SEGMENTS).fill(null))
  );
  const smoothedLevels = useRef<Float32Array>(new Float32Array(16));

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
  const mixerDragPointers = useRef(new Map<number, number>()); // pointerId -> padId

  // 60fps direct DOM playhead, trigger glow, mic level & per-pad LED VU meters (zero React re-renders!)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const recPadId = recorderService.recordingPadId;
      const recPeak = recorderService.currentInputPeak;
      const state = useStore.getState();
      const inMixer = state.padMixerMode && !eraseMode;

      for (let i = 0; i < 16; i++) {
        const padId = bankOffset + i;
        const pad = state.project.pads[padId];

        if (inMixer && pad?.hasSample) {
          const live = voiceManager.getPadLiveLevel(padId, pad.volume);
          const prev = smoothedLevels.current[i];
          const next = live > prev ? live : prev * 0.84;
          smoothedLevels.current[i] = next;

          const litCount = Math.round(Math.min(1, next / 1.08) * PAD_LED_SEGMENTS);
          const segs = padVuSegRefs.current[i];
          for (let s = 0; s < PAD_LED_SEGMENTS; s++) {
            const el = segs[s];
            if (el) el.classList.toggle('lit', s < litCount);
          }
          continue;
        }

        const glowEl = glowRefs.current[i];
        const progEl = progressRefs.current[i];

        if (recPadId === padId && recorderService.isRecording) {
          if (glowEl) glowEl.style.opacity = Math.min(0.7, 0.25 + recPeak * 0.7).toFixed(3);
          if (progEl) progEl.style.width = `${Math.min(100, Math.round(recPeak * 120))}%`;
          continue;
        }

        const st = voiceManager.getPadPlaybackState(padId);
        if (glowEl) {
          const opacity = st.active ? Math.max(0.24, st.flash * 0.6) : st.flash * 0.5;
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
  }, [bankOffset, eraseMode]);

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

  const handleMixerDrag = (el: HTMLElement, padId: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = 1 - (clientY - rect.top) / rect.height;
    const vol = Math.max(0, Math.min(1.5, Math.round(ratio * 150) / 100));
    updatePad(padId, { volume: vol });
  };

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
      // ignore
    }

    if (eraseMode && onErasePad) {
      selectPad(pad.id);
      if ((seqNoteCounts?.[pad.id] ?? 0) > 0) {
        onErasePad(pad.id);
      }
      return;
    }

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

    if (!playOnly && toolMode === 'resample' && !recorderService.isRecording && onSelectResampleTarget) {
      selectPad(pad.id);
      onSelectResampleTarget(pad.id);
      return;
    }

    selectPad(pad.id);
    cellRefs.current[localIdx]?.classList.add('pressed');

    // Explicit MIC mode: immediately start hold-to-record synchronously on ANY pad (works on iPhone!)
    if (!playOnly && toolMode === 'rec' && !recorderService.isRecording && onStartMicHold) {
      activePointers.current.set(e.pointerId, {
        padId: pad.id,
        micHold: true,
        micStarted: true,
        holdTimer: null,
      });
      onStartMicHold(pad.id);
      return;
    }

    // Normal PLAY mode on an EMPTY pad: start mic hold immediately (no setTimeout -> preserves iOS user gesture!)
    if (!playOnly && !pad.hasSample && !recorderService.isRecording && onStartMicHold) {
      if (!recorderService.hasMicStream) {
        // First time on iPhone: request mic permission synchronously inside this tap gesture
        void recorderService
          .ensureMicStream()
          .then(() => {
            showToast('Microfono pronto! Ora tieni premuto il pad per registrare');
          })
          .catch((err) => {
            showToast(err instanceof Error ? err.message : 'Permesso microfono negato');
          });
        return;
      }
      activePointers.current.set(e.pointerId, {
        padId: pad.id,
        micHold: true,
        micStarted: true,
        holdTimer: null,
      });
      onStartMicHold(pad.id);
      return;
    }

    activePointers.current.set(e.pointerId, {
      padId: pad.id,
      micHold: false,
      micStarted: false,
      holdTimer: null,
    });
    if (pad.hasSample) {
      // Latching One-Shot Loop: tap once to start looping, tap again to stop cleanly!
      if (pad.oneShot && pad.loop && !sequencerEngine.recording && voiceManager.isPadPlaying(pad.id)) {
        voiceManager.stopByPad(pad.id);
      } else {
        voiceManager.triggerPad(pad);
        sequencerEngine.recordLiveHit(pad.id);
      }
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

  const showInlineMixer = padMixerMode && !eraseMode;

  return (
    <div className="pad-grid" role="grid" aria-label={`Bank ${BANK_LABELS[activeBank]} Pads`}>
      {bankPads.map((pad, idx) => {
        const isSelected = pad.id === selectedPadId;
        const isDragSource = pad.id === dragSourcePadId;
        const isRecTarget = pad.id === recordingPadId;
        const labelCode = `${BANK_LABELS[activeBank]}${idx + 1}`;
        const noteCount = seqNoteCounts?.[pad.id] ?? 0;
        const isEraseTarget = eraseMode && noteCount > 0;
        const isEraseDimmed = eraseMode && noteCount === 0;

        // INLINE PAD MIXER MODE: Vertical Volume Fader + Green/Yellow/Red LED VU Bar on each loaded pad!
        if (showInlineMixer) {
          const volPct = Math.round(pad.volume * 100);
          const faderFillPct = Math.min(100, Math.round((pad.volume / 1.5) * 100));

          if (!pad.hasSample) {
            return (
              <div key={pad.id} className="pad-cell mixer-pad empty">
                <span className="pad-index">{labelCode}</span>
                <span className="pad-name">—</span>
              </div>
            );
          }

          return (
            <div
              key={pad.id}
              ref={(el) => {
                cellRefs.current[idx] = el;
              }}
              className={`pad-cell loaded mixer-pad ${isSelected ? 'selected' : ''}`}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="mixer-pad-head">
                <span className="mixer-pad-name">{pad.name}</span>
                <span className="mixer-pad-pct">{volPct}%</span>
              </div>

              <div className="mixer-pad-body">
                {/* Vertical Volume Fader */}
                <div
                  className="pad-fader-track"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    void audioEngine.unlock();
                    selectPad(pad.id);
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                      // ignore
                    }
                    mixerDragPointers.current.set(e.pointerId, pad.id);
                    handleMixerDrag(e.currentTarget, pad.id, e.clientY);
                  }}
                  onPointerMove={(e) => {
                    if (mixerDragPointers.current.get(e.pointerId) !== pad.id) return;
                    handleMixerDrag(e.currentTarget, pad.id, e.clientY);
                  }}
                  onPointerUp={(e) => {
                    mixerDragPointers.current.delete(e.pointerId);
                  }}
                  onPointerCancel={(e) => {
                    mixerDragPointers.current.delete(e.pointerId);
                  }}
                  onDoubleClick={() => updatePad(pad.id, { volume: 1 })}
                  title="Trascina su/giù per regolare il volume (doppio tap = 100%)"
                >
                  <div className="pad-fader-fill" style={{ height: `${faderFillPct}%` }} />
                  <div
                    className="pad-fader-knob"
                    style={{ bottom: `calc(${faderFillPct}% - 6px)` }}
                  />
                </div>

                {/* Vertical Segmented LED VU Meter (Green -> Yellow -> Red) */}
                <div className="pad-vu-bar" aria-hidden="true">
                  {Array.from({ length: PAD_LED_SEGMENTS }, (_, segIdx) => {
                    // Bottom-to-top rendering via column-reverse
                    const zone = segIdx >= 7 ? 'red' : segIdx >= 5 ? 'yellow' : 'green';
                    return (
                      <span
                        key={segIdx}
                        ref={(el) => {
                          padVuSegRefs.current[idx][segIdx] = el;
                        }}
                        className={`led-seg ${zone}`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

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
              isEraseTarget ? 'erase-target' : '',
              isEraseDimmed ? 'erase-dimmed' : '',
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
                {isEraseTarget && (
                  <span className="pad-badge erase-badge">×{noteCount}</span>
                )}
                {!eraseMode && isRecTarget && (
                  <span className="pad-badge" style={{ background: '#cc2222', color: '#fff' }}>
                    {recordingSource === 'resample' ? 'RSMP' : 'REC'}
                  </span>
                )}
                {!eraseMode && pad.loop && <span className="pad-badge">LOOP</span>}
                {!eraseMode && pad.reverse && <span className="pad-badge">REV</span>}
                {!eraseMode && pad.chokeGroup > 0 && <span className="pad-badge">C{pad.chokeGroup}</span>}
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
