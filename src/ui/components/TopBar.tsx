import React, { useEffect, useRef } from 'react';
import { QrCode, Square, Play, Undo2, Menu, Disc3, Trash2, X } from 'lucide-react';
import { useStore } from '../../state/useStore';
import { audioEngine } from '../../audio/AudioEngine';
import { sequencerEngine } from '../../audio/SequencerEngine';

const TOP_VU_SEGS = 8;

export const TopBar: React.FC = () => {
  const bpm = useStore((s) => s.project.bpm);
  const setBpm = useStore((s) => s.setBpm);
  const undoCount = useStore((s) => s.undoStack.length);
  const undo = useStore((s) => s.undo);
  const setQrModalOpen = useStore((s) => s.setQrModalOpen);
  const menuOpen = useStore((s) => s.menuOpen);
  const setMenuOpen = useStore((s) => s.setMenuOpen);
  const isSeqPlaying = useStore((s) => s.isSeqPlaying);
  const loadStarterKit = useStore((s) => s.loadStarterKit);
  const clearProject = useStore((s) => s.clearProject);

  const vuSegRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tapBtnRef = useRef<HTMLButtonElement | null>(null);
  const tapTimesRef = useRef<number[]>([]);
  const dragRef = useRef<{ startY: number; startBpm: number; moved: boolean } | null>(null);

  useEffect(() => {
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      const peak = audioEngine.getOutputPeak();
      smoothed = peak > smoothed ? peak : smoothed * 0.84;
      const lit = Math.round(Math.min(1, smoothed * 1.15) * TOP_VU_SEGS);
      for (let i = 0; i < TOP_VU_SEGS; i++) {
        const el = vuSegRefs.current[i];
        if (el) el.classList.toggle('lit', i < lit);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleBpmPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    void audioEngine.unlock();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startBpm: bpm, moved: false };
  };

  const handleBpmPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = drag.startY - e.clientY;
    if (Math.abs(dy) > 6) {
      drag.moved = true;
      setBpm(Math.round(drag.startBpm + dy * 0.4));
    }
  };

  const handleTapTempo = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    void audioEngine.unlock();

    const btn = tapBtnRef.current;
    if (btn) {
      btn.classList.remove('tap-pulse');
      void btn.offsetWidth;
      btn.classList.add('tap-pulse');
    }

    const now = performance.now();
    const prev = tapTimesRef.current;
    const taps =
      prev.length > 0 && now - prev[prev.length - 1] > 2200 ? [now] : [...prev, now].slice(-6);
    tapTimesRef.current = taps;

    if (taps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
      const avgMs = sum / (taps.length - 1);
      const nextBpm = Math.max(40, Math.min(240, Math.round(60000 / avgMs)));
      setBpm(nextBpm);
    }
  };

  const handleBpmPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <>
      <header className="top-bar">
        <div className="brand-cluster">
          <div className="brand-logo" title="Simpler — Un campionatore facile.">
            <span className="brand-badge-akai">SIMPLER</span>
          </div>

          <button
            type="button"
            className="bpm-chip"
            title="Trascina su/giù per regolare i BPM"
            onPointerDown={handleBpmPointerDown}
            onPointerMove={handleBpmPointerMove}
            onPointerUp={handleBpmPointerUp}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          >
            <span>{Math.round(bpm)}</span>
            <span className="bpm-label">BPM</span>
          </button>

          <button
            ref={tapBtnRef}
            type="button"
            className="tap-btn"
            title="Tap Tempo: premi a tempo per impostare i BPM"
            onPointerDown={handleTapTempo}
          >
            TAP
          </button>
        </div>

        <div className="top-actions">
          {/* Classic Segmented LED VU Meter (Green -> Yellow -> Red) */}
          <div className="vu-meter-seg" aria-hidden="true">
            {Array.from({ length: TOP_VU_SEGS }, (_, i) => {
              const zone = i >= 7 ? 'red' : i >= 5 ? 'yellow' : 'green';
              return (
                <span
                  key={i}
                  ref={(el) => {
                    vuSegRefs.current[i] = el;
                  }}
                  className={`led-seg ${zone}`}
                />
              );
            })}
          </div>

          <button
            type="button"
            className={`icon-btn ${isSeqPlaying ? 'accent' : ''}`}
            title={isSeqPlaying ? 'Stop Beat' : 'Play Beat'}
            onPointerDown={() => {
              if (isSeqPlaying) {
                sequencerEngine.stop();
              } else {
                sequencerEngine.togglePlay();
              }
            }}
          >
            {isSeqPlaying ? <Square size={13} /> : <Play size={14} />}
          </button>

          <button
            type="button"
            className="icon-btn"
            title="Undo"
            disabled={undoCount === 0}
            onClick={undo}
          >
            <Undo2 size={15} />
          </button>

          <button
            type="button"
            className="icon-btn"
            title="Condividi QR Workshop"
            onClick={() => setQrModalOpen(true)}
          >
            <QrCode size={15} />
          </button>

          <button
            type="button"
            className="icon-btn"
            title="Menu Progetto"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={16} />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="modal-backdrop" onClick={() => setMenuOpen(false)}>
          <div className="modal-card" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 className="modal-title">SIMPLER</h2>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Un campionatore facile.
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setMenuOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                className="menu-row-btn"
                onClick={() => {
                  setMenuOpen(false);
                  setQrModalOpen(true);
                }}
              >
                <QrCode size={16} />
                <span>Condividi QR Code (Workshop)</span>
              </button>

              <button
                type="button"
                className="menu-row-btn"
                onClick={() => {
                  void audioEngine.unlock().then(() => {
                    loadStarterKit();
                    setMenuOpen(false);
                  });
                }}
              >
                <Disc3 size={16} />
                <span>Carica Boom Bap Starter Kit (Bank A)</span>
              </button>

              <button
                type="button"
                className="menu-row-btn danger"
                onClick={() => {
                  clearProject();
                  setMenuOpen(false);
                }}
              >
                <Trash2 size={16} />
                <span>Nuovo Progetto Vuoto (Clear All)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
