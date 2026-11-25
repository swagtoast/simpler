import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, X, Trash2, Wand2, VolumeX, Volume2 } from 'lucide-react';
import { useStore } from '../../state/useStore';
import { audioEngine } from '../../audio/AudioEngine';
import { voiceManager } from '../../audio/VoiceManager';
import { sequencerEngine } from '../../audio/SequencerEngine';

interface PianoRollOverlayProps {
  seqId: string;
}

export const PianoRollOverlay: React.FC<PianoRollOverlayProps> = ({ seqId }) => {
  const seq = useStore((s) => s.project.sequences.find((q) => q.id === seqId));
  const pads = useStore((s) => s.project.pads);
  const mutedPads = useStore((s) => s.mutedPads);
  const isSeqPlaying = useStore((s) => s.isSeqPlaying);
  const selectedPadId = useStore((s) => s.selectedPadId);

  const selectPad = useStore((s) => s.selectPad);
  const toggleStepNote = useStore((s) => s.toggleStepNote);
  const updateNoteVelocity = useStore((s) => s.updateNoteVelocity);
  const toggleMutePad = useStore((s) => s.toggleMutePad);
  const quantizeSequenceNow = useStore((s) => s.quantizeSequenceNow);
  const clearPadFromSequence = useStore((s) => s.clearPadFromSequence);
  const clearSequence = useStore((s) => s.clearSequence);
  const setPianoRollOpen = useStore((s) => s.setPianoRollOpen);

  const [focusPadId, setFocusPadId] = useState<number>(selectedPadId);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  // Show only loaded pads (or pads referenced by notes in this sequence) so beginners aren't overwhelmed
  const visiblePads = useMemo(() => {
    const usedIds = new Set(seq?.notes.map((n) => n.padId) ?? []);
    return pads.filter((p) => p.hasSample || usedIds.has(p.id));
  }, [pads, seq?.notes]);

  const totalSteps = (seq?.bars ?? 2) * 16; // 16th-note grid

  // 60fps smooth playhead sweep
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (playheadRef.current) {
        const info = sequencerEngine.getPlayheadInfo();
        if (info.playing && !info.countingIn && info.sequenceId === seqId) {
          playheadRef.current.style.opacity = '1';
          playheadRef.current.style.left = `${(info.progress * 100).toFixed(2)}%`;
        } else {
          playheadRef.current.style.opacity = '0';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seqId]);

  if (!seq) return null;

  const focusedPad = pads[focusPadId] ?? visiblePads[0];
  const focusedNotes = seq.notes
    .filter((n) => n.padId === focusedPad?.id)
    .sort((a, b) => a.startBeat - b.startBeat);

  return (
    <div className="pianoroll-overlay">
      <div className="editor-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className={`seq-big-btn ${isSeqPlaying ? 'playing' : ''}`}
            style={{ height: 32, padding: '0 10px' }}
            onPointerDown={() => sequencerEngine.togglePlay()}
          >
            {isSeqPlaying ? <Square size={13} /> : <Play size={13} />}
            <span>{isSeqPlaying ? 'STOP' : 'PLAY'}</span>
          </button>
          <strong style={{ fontSize: 13 }}>
            {seq.name} ({seq.bars} {seq.bars === 1 ? 'Bar' : 'Bars'})
          </strong>
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          <button
            type="button"
            className="pill-btn"
            onClick={() => quantizeSequenceNow(seq.id)}
            title="Allinea tutte le note a tempo"
          >
            <Wand2 size={13} />
            <span>Quantize</span>
          </button>
          <button
            type="button"
            className="pill-btn"
            onClick={() => clearSequence(seq.id)}
            title="Svuota sequenza"
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setPianoRollOpen(false)}
            aria-label="Chiudi Piano Roll"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
        Tocca una casella per inserire o rimuovere un colpo. I numeri in alto sono i battiti (1 · 2 · 3 · 4).
      </div>

      {/* Main Scrollable Step / Piano Roll Matrix */}
      <div className="pr-scroll-container">
        <div className="pr-matrix" style={{ minWidth: `${Math.max(520, totalSteps * 26 + 118)}px` }}>
          {/* Beat Ruler Header */}
          <div className="pr-ruler-row">
            <div className="pr-label-col pr-corner">SUONO</div>
            <div className="pr-steps-area">
              <div
                className="pr-steps-grid"
                style={{ gridTemplateColumns: `repeat(${totalSteps}, 1fr)` }}
              >
                {Array.from({ length: totalSteps }, (_, step) => {
                  const isBarStart = step % 16 === 0;
                  const isBeatStart = step % 4 === 0;
                  const barNum = Math.floor(step / 16) + 1;
                  const beatInBar = (Math.floor(step / 4) % 4) + 1;
                  return (
                    <div
                      key={step}
                      className={`pr-ruler-cell ${isBarStart ? 'bar-start' : isBeatStart ? 'beat-start' : ''}`}
                    >
                      {isBarStart ? `${barNum}.1` : isBeatStart ? `${beatInBar}` : '·'}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Pad Rows */}
          <div className="pr-rows-wrap">
            {visiblePads.map((pad) => {
              const isMuted = mutedPads.includes(pad.id);
              const isFocused = pad.id === focusedPad?.id;
              const padNotes = seq.notes.filter((n) => n.padId === pad.id);

              return (
                <div
                  key={pad.id}
                  className={`pr-row ${isFocused ? 'focused' : ''} ${isMuted ? 'muted' : ''}`}
                >
                  <div className="pr-label-col">
                    <button
                      type="button"
                      className="pr-pad-audition"
                      onPointerDown={() => {
                        void audioEngine.unlock();
                        setFocusPadId(pad.id);
                        selectPad(pad.id);
                        if (pad.hasSample) voiceManager.triggerPad(pad);
                      }}
                    >
                      <span className="pr-color-bar" style={{ background: pad.color }} />
                      <span className="pr-pad-name">{pad.name}</span>
                    </button>
                    <button
                      type="button"
                      className={`pr-mute-btn ${isMuted ? 'on' : ''}`}
                      onClick={() => toggleMutePad(pad.id)}
                      title={isMuted ? 'Riattiva traccia' : 'Muta traccia'}
                    >
                      {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    </button>
                  </div>

                  <div className="pr-steps-area">
                    <div
                      className="pr-steps-grid"
                      style={{ gridTemplateColumns: `repeat(${totalSteps}, 1fr)` }}
                    >
                      {Array.from({ length: totalSteps }, (_, step) => {
                        const stepBeat = step * 0.25;
                        const note = padNotes.find((n) => Math.abs(n.startBeat - stepBeat) < 0.08);
                        const beatGroup = Math.floor(step / 4) % 2;

                        return (
                          <button
                            key={step}
                            type="button"
                            className={`pr-cell ${beatGroup === 1 ? 'alt-beat' : ''} ${step % 16 === 0 ? 'bar-line' : ''} ${note ? 'has-note' : ''}`}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              void audioEngine.unlock();
                              setFocusPadId(pad.id);
                              selectPad(pad.id);
                              if (!note && pad.hasSample) {
                                voiceManager.triggerPad(pad);
                              }
                              toggleStepNote(seq.id, pad.id, stepBeat);
                            }}
                          >
                            {note && (
                              <span
                                className="pr-note-block"
                                style={{
                                  background: pad.color,
                                  opacity: 0.35 + note.velocity * 0.65,
                                }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Live Moving Playhead Overlay across all step columns */}
            <div className="pr-playhead-layer">
              <div ref={playheadRef} className="pr-playhead-line" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Velocity Lane for Focused Pad */}
      {focusedPad && (
        <div className="pr-velocity-panel">
          <div className="pr-vel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: focusedPad.color,
                  display: 'inline-block',
                }}
              />
              <strong>Velocity: {focusedPad.name}</strong>
              <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                ({focusedNotes.length} colpi)
              </span>
            </div>
            {focusedNotes.length > 0 && (
              <button
                type="button"
                className="pill-btn"
                style={{ height: 26, fontSize: 11 }}
                onClick={() => clearPadFromSequence(seq.id, focusedPad.id)}
              >
                <Trash2 size={11} />
                <span>Svuota {focusedPad.name}</span>
              </button>
            )}
          </div>

          {focusedNotes.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '6px 0' }}>
              Tocca la riga di <strong>{focusedPad.name}</strong> sopra per aggiungere colpi e poi regola qui il loro volume (velocity).
            </div>
          ) : (
            <div className="pr-vel-bars">
              {focusedNotes.map((note) => {
                const stepNum = Math.round(note.startBeat * 4) + 1;
                return (
                  <div key={note.id} className="pr-vel-item">
                    <div
                      className="pr-vel-track"
                      onPointerDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = 1 - (e.clientY - rect.top) / rect.height;
                        updateNoteVelocity(seq.id, note.id, ratio);
                      }}
                      onPointerMove={(e) => {
                        if (e.buttons !== 1) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = 1 - (e.clientY - rect.top) / rect.height;
                        updateNoteVelocity(seq.id, note.id, ratio);
                      }}
                    >
                      <div
                        className="pr-vel-fill"
                        style={{
                          height: `${Math.round(note.velocity * 100)}%`,
                          background: focusedPad.color,
                        }}
                      />
                    </div>
                    <span className="pr-vel-step">S{stepNum}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
