import React, { useEffect, useRef } from 'react';
import { Play, Square, Lock, Unlock, RotateCcw, Radio } from 'lucide-react';
import { PERFORM_FX_LIST, PerformFxId } from '../../audio/PerformFxEngine';
import { audioEngine } from '../../audio/AudioEngine';
import { sequencerEngine } from '../../audio/SequencerEngine';
import { recorderService } from '../../audio/RecorderService';
import { useStore } from '../../state/useStore';
import { BANK_LABELS } from '../../state/types';
import { t } from '../../i18n/t';

const MASTER_SEGMENTS = 16;

export const PerformView: React.FC = () => {
  const fxValues = useStore((s) => s.fxValues);
  const fxHold = useStore((s) => s.fxHold);
  const isSeqPlaying = useStore((s) => s.isSeqPlaying);
  const isRecording = useStore((s) => s.isRecording);
  const recordingSource = useStore((s) => s.recordingSource);
  const pads = useStore((s) => s.project.pads);

  const setFxValue = useStore((s) => s.setFxValue);
  const toggleFxHold = useStore((s) => s.toggleFxHold);
  const resetAllFx = useStore((s) => s.resetAllFx);
  const setRecordingState = useStore((s) => s.setRecordingState);
  const assignSampleToPad = useStore((s) => s.assignSampleToPad);
  const showToast = useStore((s) => s.showToast);

  const activePointers = useRef(new Map<number, PerformFxId>());
  const segRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Ensure AudioWorklet FX processor is loaded when entering Perform tab
  useEffect(() => {
    void audioEngine.ensureFxWorklet();
  }, []);

  // 60fps Master Output Green / Yellow / Red Segmented LED Meter
  useEffect(() => {
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      const peak = audioEngine.getOutputPeak();
      smoothed = peak > smoothed ? peak : smoothed * 0.84;
      const litCount = Math.round(Math.min(1, smoothed * 1.15) * MASTER_SEGMENTS);
      for (let i = 0; i < MASTER_SEGMENTS; i++) {
        const el = segRefs.current[i];
        if (!el) continue;
        el.classList.toggle('lit', i < litCount);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const updateFromPointer = (el: HTMLDivElement, fxId: PerformFxId, clientY: number) => {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = 1 - (clientY - rect.top) / rect.height;
    setFxValue(fxId, Math.max(0, Math.min(1, ratio)));
  };

  const handleFaderDown = (e: React.PointerEvent<HTMLDivElement>, fxId: PerformFxId) => {
    e.preventDefault();
    void audioEngine.unlock();
    void audioEngine.ensureFxWorklet();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    activePointers.current.set(e.pointerId, fxId);
    updateFromPointer(e.currentTarget, fxId, e.clientY);
  };

  const handleFaderMove = (e: React.PointerEvent<HTMLDivElement>, fxId: PerformFxId) => {
    if (activePointers.current.get(e.pointerId) !== fxId) return;
    updateFromPointer(e.currentTarget, fxId, e.clientY);
  };

  const handleFaderUp = (e: React.PointerEvent<HTMLDivElement>, fxId: PerformFxId) => {
    if (activePointers.current.get(e.pointerId) !== fxId) return;
    activePointers.current.delete(e.pointerId);
    if (!useStore.getState().fxHold) {
      setFxValue(fxId, 0);
    }
  };

  const handleToggleResample = async () => {
    if (isRecording && recordingSource === 'resample') {
      const res = await recorderService.stopRecording(true);
      setRecordingState(false, null, null);
      if (res?.buffer) {
        const code = `${BANK_LABELS[Math.floor(res.padId / 16)]}${(res.padId % 16) + 1}`;
        assignSampleToPad(res.padId, res.buffer, `FX ${code}`);
        showToast(t('fxResampleSaved', { code }));
      } else {
        showToast(t('fxResampleEmpty'));
      }
      return;
    }

    // Pick first empty pad automatically so students don't have to hunt for a slot
    const freePad = pads.find((p) => !p.hasSample);
    const targetId = freePad ? freePad.id : 63;
    try {
      await recorderService.startRecording('resample', targetId);
      setRecordingState(true, targetId, 'resample');
      const code = `${BANK_LABELS[Math.floor(targetId / 16)]}${(targetId % 16) + 1}`;
      showToast(t('fxResampleStart', { code }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('resampleError'));
    }
  };

  const anyActive = Object.values(fxValues).some((v) => v > 0.01);

  return (
    <section className="perform-view" aria-label="Perform FX View">
      {/* Clean Hardware Control Row */}
      <div className="perform-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className={`seq-big-btn ${isSeqPlaying ? 'playing' : ''}`}
            onPointerDown={() => sequencerEngine.togglePlay()}
          >
            {isSeqPlaying ? <Square size={14} /> : <Play size={14} />}
            <span>{isSeqPlaying ? 'STOP' : 'PLAY'}</span>
          </button>

          <button
            type="button"
            className={`seq-big-btn ${fxHold ? 'hold-on' : ''}`}
            onClick={toggleFxHold}
            title={t('fxHoldTitle')}
          >
            {fxHold ? <Lock size={14} /> : <Unlock size={14} />}
            <span>HOLD</span>
          </button>

          <button
            type="button"
            className="pill-btn"
            disabled={!anyActive}
            onPointerDown={() => resetAllFx()}
            title={t('fxResetTitle')}
          >
            <RotateCcw size={13} />
            <span>RESET</span>
          </button>
        </div>

        <button
          type="button"
          className={`pill-btn ${recordingSource === 'resample' ? 'active-rec' : ''}`}
          onClick={() => void handleToggleResample()}
          title={t('fxResampleTitle')}
        >
          <Radio size={13} />
          <span>{recordingSource === 'resample' ? 'STOP RSMP' : 'RESAMPLE'}</span>
        </button>
      </div>

      {/* Master Output Green / Yellow / Red LED Bar */}
      <div className="master-led-strip" aria-label="Master Output Level">
        <span className="led-strip-label">OUT</span>
        <div className="led-bar-h">
          {Array.from({ length: MASTER_SEGMENTS }, (_, i) => {
            const zone = i >= 13 ? 'red' : i >= 10 ? 'yellow' : 'green';
            return (
              <span
                key={i}
                ref={(el) => {
                  segRefs.current[i] = el;
                }}
                className={`led-seg ${zone}`}
              />
            );
          })}
        </div>
        <span className="led-strip-label">{fxHold ? 'HOLD ON' : 'TOUCH'}</span>
      </div>

      {/* 6 Big Multi-Touch Vertical FX Faders */}
      <div className="fx-rack">
        {PERFORM_FX_LIST.map((fx) => {
          const val = fxValues[fx.id] ?? 0;
          const pct = Math.round(val * 100);
          const isLit = val > 0.02;

          return (
            <div key={fx.id} className={`fx-channel ${isLit ? 'active' : ''}`}>
              <div className="fx-head">
                <span className="fx-led" />
                <span className="fx-title">{fx.label}</span>
              </div>

              <div
                className="fx-track"
                onPointerDown={(e) => handleFaderDown(e, fx.id)}
                onPointerMove={(e) => handleFaderMove(e, fx.id)}
                onPointerUp={(e) => handleFaderUp(e, fx.id)}
                onPointerCancel={(e) => handleFaderUp(e, fx.id)}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="fx-rail-ticks" aria-hidden="true" />
                <div className="fx-fill" style={{ height: `${pct}%` }} />
                <div
                  className="fx-cap"
                  style={{ bottom: `calc(${pct}% - 12px)` }}
                >
                  <span className="fx-cap-line" />
                </div>
              </div>

              <div className="fx-foot">
                <span className="fx-pct">{isLit ? `${pct}%` : t(fx.hintKey)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
