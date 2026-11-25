import React, { useEffect, useState } from 'react';
import {
  Play,
  Scissors,
  X,
  RotateCcw,
  Crop,
  SlidersHorizontal,
  Trash2,
  Sparkles,
  CheckCircle2,
  Plus,
  Film,
} from 'lucide-react';
import { useStore } from '../../state/useStore';
import { audioEngine } from '../../audio/AudioEngine';
import { voiceManager } from '../../audio/VoiceManager';
import { computeEqualSlices, detectTransients } from '../../audio/AutoChop';
import { WaveformCanvas } from '../components/WaveformCanvas';

interface SampleEditorDrawerProps {
  onRequestImport?: () => void;
}

export const SampleEditorDrawer: React.FC<SampleEditorDrawerProps> = ({ onRequestImport }) => {
  const selectedPadId = useStore((s) => s.selectedPadId);
  const pad = useStore((s) => s.project.pads[selectedPadId]);
  const editorSection = useStore((s) => s.editorSection);
  const setEditorOpen = useStore((s) => s.setEditorOpen);
  const updatePad = useStore((s) => s.updatePad);
  const clearPad = useStore((s) => s.clearPad);
  const applyDestructiveNormalize = useStore((s) => s.applyDestructiveNormalize);
  const applyDestructiveCrop = useStore((s) => s.applyDestructiveCrop);
  const applyDestructiveReverse = useStore((s) => s.applyDestructiveReverse);
  const assignSlicesToPads = useStore((s) => s.assignSlicesToPads);
  const showToast = useStore((s) => s.showToast);

  const [chopMode, setChopMode] = useState<'transients' | 'equal' | 'lazy'>('transients');
  const [sensitivity, setSensitivity] = useState(0.55);
  const [equalCount, setEqualCount] = useState(8);
  const [slices, setSlices] = useState<number[]>([]);

  // Recompute slices when entering Chop mode or changing params
  useEffect(() => {
    if (editorSection !== 'chop' || !pad?.hasSample) return;
    const buf = audioEngine.getSample(pad.sampleId);
    if (!buf) return;

    if (chopMode === 'transients') {
      setSlices(detectTransients(buf, sensitivity, pad.start, pad.end, 16));
    } else if (chopMode === 'equal') {
      setSlices(computeEqualSlices(equalCount, pad.start, pad.end));
    } else if (chopMode === 'lazy' && slices.length === 0) {
      setSlices([pad.start]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSection, chopMode, sensitivity, equalCount, pad?.id, pad?.sampleId, pad?.start, pad?.end]);

  if (!pad) return null;

  const previewSlice = (index: number) => {
    if (!pad.hasSample || index < 0 || index >= slices.length) return;
    const s0 = slices[index];
    const s1 = index + 1 < slices.length ? slices[index + 1] : pad.end;
    void audioEngine.unlock();
    voiceManager.triggerPad(pad, { startOverride: s0, endOverride: s1 });
  };

  const handleLazyMark = () => {
    const pb = voiceManager.getPadPlaybackState(pad.id);
    if (!pb.active) {
      // Start playing so user can tap marks in rhythm
      void audioEngine.unlock();
      voiceManager.triggerPad(pad);
      setSlices([pad.start]);
      showToast('In riproduzione: premi "+ MARK" a tempo per tagliare!');
      return;
    }
    const pos = pb.normalizedPos;
    if (pos > pad.start + 0.01 && pos < pad.end - 0.01) {
      setSlices((prev) => Array.from(new Set([...prev, pos])).sort((a, b) => a - b).slice(0, 16));
    }
  };

  const regionDurMs = Math.round(pad.duration * (pad.end - pad.start) * 1000);

  return (
    <div className="editor-panel">
      <div className="editor-header">
        <input
          type="text"
          className="editor-name-input"
          value={pad.name}
          onChange={(e) => updatePad(pad.id, { name: e.target.value })}
          aria-label="Nome pad"
        />

        <div className="editor-tabs">
          <button
            type="button"
            className={`editor-tab-btn ${editorSection === 'edit' ? 'active' : ''}`}
            onClick={() => setEditorOpen(true, 'edit')}
          >
            EDIT
          </button>
          <button
            type="button"
            className={`editor-tab-btn ${editorSection === 'chop' ? 'active' : ''}`}
            onClick={() => setEditorOpen(true, 'chop')}
          >
            CHOP
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="icon-btn accent"
            onPointerDown={() => {
              void audioEngine.unlock();
              voiceManager.triggerPad(pad);
            }}
            onPointerUp={() => voiceManager.releasePad(pad.id)}
            title="Ascolta sample"
          >
            <Play size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setEditorOpen(false)}
            aria-label="Chiudi editor"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {!pad.hasSample ? (
        <div className="phase-placeholder">
          <p>Questo pad è vuoto. Registra dal microfono, importa un file audio/video o carica lo Starter Kit.</p>
        </div>
      ) : (
        <>
          <WaveformCanvas
            pad={pad}
            slices={slices}
            showSlices={editorSection === 'chop'}
            onChangeRegion={(start, end) => updatePad(pad.id, { start, end })}
            onTapSlice={previewSlice}
          />

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
            }}
          >
            <span>LEN: {(regionDurMs / 1000).toFixed(2)}s</span>
            <span>
              START {(pad.start * 100).toFixed(0)}% — END {(pad.end * 100).toFixed(0)}%
            </span>
          </div>

          {editorSection === 'edit' ? (
            <>
              <div className="param-grid">
                <div className="param-card">
                  <div className="param-head">
                    <span>VOLUME</span>
                    <span className="param-val">{Math.round(pad.volume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    className="range-slider"
                    min={0}
                    max={1.5}
                    step={0.01}
                    value={pad.volume}
                    onDoubleClick={() => updatePad(pad.id, { volume: 1 })}
                    onChange={(e) => updatePad(pad.id, { volume: Number(e.target.value) })}
                  />
                </div>

                <div className="param-card">
                  <div className="param-head">
                    <span>PITCH</span>
                    <span className="param-val">
                      {pad.pitch > 0 ? `+${pad.pitch}` : pad.pitch} st
                    </span>
                  </div>
                  <input
                    type="range"
                    className="range-slider"
                    min={-24}
                    max={24}
                    step={0.5}
                    value={pad.pitch}
                    onDoubleClick={() => updatePad(pad.id, { pitch: 0 })}
                    onChange={(e) => updatePad(pad.id, { pitch: Number(e.target.value) })}
                  />
                </div>

                <div className="param-card">
                  <div className="param-head">
                    <span>TONE (EQ)</span>
                    <span className="param-val">
                      {pad.tone > 0 ? `+${Math.round(pad.tone * 100)}` : Math.round(pad.tone * 100)}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="range-slider"
                    min={-1}
                    max={1}
                    step={0.02}
                    value={pad.tone}
                    onDoubleClick={() => updatePad(pad.id, { tone: 0 })}
                    onChange={(e) => updatePad(pad.id, { tone: Number(e.target.value) })}
                  />
                </div>

                <div className="param-card">
                  <div className="param-head">
                    <span>PAN</span>
                    <span className="param-val">
                      {Math.abs(pad.pan) < 0.03
                        ? 'C'
                        : pad.pan < 0
                          ? `L${Math.round(-pad.pan * 100)}`
                          : `R${Math.round(pad.pan * 100)}`}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="range-slider"
                    min={-1}
                    max={1}
                    step={0.02}
                    value={pad.pan}
                    onDoubleClick={() => updatePad(pad.id, { pan: 0 })}
                    onChange={(e) => updatePad(pad.id, { pan: Number(e.target.value) })}
                  />
                </div>

                <div className="param-card">
                  <div className="param-head">
                    <span>ATTACK</span>
                    <span className="param-val">{Math.round(pad.attack * 1000)} ms</span>
                  </div>
                  <input
                    type="range"
                    className="range-slider"
                    min={0.002}
                    max={0.8}
                    step={0.002}
                    value={pad.attack}
                    onDoubleClick={() => updatePad(pad.id, { attack: 0.002 })}
                    onChange={(e) => updatePad(pad.id, { attack: Number(e.target.value) })}
                  />
                </div>

                <div className="param-card">
                  <div className="param-head">
                    <span>RELEASE</span>
                    <span className="param-val">{Math.round(pad.release * 1000)} ms</span>
                  </div>
                  <input
                    type="range"
                    className="range-slider"
                    min={0.008}
                    max={2.0}
                    step={0.008}
                    value={pad.release}
                    onDoubleClick={() => updatePad(pad.id, { release: 0.06 })}
                    onChange={(e) => updatePad(pad.id, { release: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="toggle-row">
                <button
                  type="button"
                  className={`toggle-chip ${pad.oneShot ? 'on' : ''}`}
                  onClick={() => updatePad(pad.id, { oneShot: !pad.oneShot }, true)}
                >
                  ONE-SHOT
                </button>
                <button
                  type="button"
                  className={`toggle-chip ${pad.loop ? 'on' : ''}`}
                  onClick={() => updatePad(pad.id, { loop: !pad.loop }, true)}
                >
                  LOOP
                </button>
                <button
                  type="button"
                  className={`toggle-chip ${pad.reverse ? 'on' : ''}`}
                  onClick={() => updatePad(pad.id, { reverse: !pad.reverse }, true)}
                >
                  REVERSE
                </button>
                <button
                  type="button"
                  className={`toggle-chip ${pad.chokeGroup > 0 ? 'on' : ''}`}
                  onClick={() =>
                    updatePad(pad.id, { chokeGroup: (pad.chokeGroup + 1) % 5 }, true)
                  }
                >
                  CHOKE: {pad.chokeGroup === 0 ? 'OFF' : `GRP ${pad.chokeGroup}`}
                </button>
              </div>

              <div className="toggle-row">
                <button
                  type="button"
                  className="toggle-chip"
                  onClick={() => applyDestructiveNormalize(pad.id)}
                >
                  <Sparkles size={13} />
                  Normalize
                </button>
                <button
                  type="button"
                  className="toggle-chip"
                  onClick={() => applyDestructiveCrop(pad.id)}
                >
                  <Crop size={13} />
                  Crop Trim
                </button>
                {onRequestImport && (
                  <button
                    type="button"
                    className="toggle-chip"
                    onClick={onRequestImport}
                  >
                    <Film size={13} />
                    Import Video/Audio
                  </button>
                )}
                <button
                  type="button"
                  className="toggle-chip"
                  onClick={() => applyDestructiveReverse(pad.id)}
                >
                  <RotateCcw size={13} />
                  Bake Reverse
                </button>
                <button
                  type="button"
                  className="toggle-chip"
                  onClick={() =>
                    updatePad(pad.id, {
                      volume: 1,
                      pitch: 0,
                      pan: 0,
                      tone: 0,
                      attack: 0.002,
                      release: 0.06,
                      start: 0,
                      end: 1,
                    })
                  }
                >
                  <SlidersHorizontal size={13} />
                  Reset Params
                </button>
                <button
                  type="button"
                  className="toggle-chip danger"
                  onClick={() => {
                    clearPad(pad.id);
                    setEditorOpen(false);
                  }}
                >
                  <Trash2 size={13} />
                  Clear Pad
                </button>
              </div>
            </>
          ) : (
            <div className="chop-panel">
              <div className="chop-row">
                <button
                  type="button"
                  className={`toggle-chip ${chopMode === 'transients' ? 'on' : ''}`}
                  onClick={() => setChopMode('transients')}
                >
                  <Scissors size={13} />
                  Transients
                </button>
                <button
                  type="button"
                  className={`toggle-chip ${chopMode === 'equal' ? 'on' : ''}`}
                  onClick={() => setChopMode('equal')}
                >
                  Equal Grid
                </button>
                <button
                  type="button"
                  className={`toggle-chip ${chopMode === 'lazy' ? 'on' : ''}`}
                  onClick={() => {
                    setChopMode('lazy');
                    setSlices([pad.start]);
                  }}
                >
                  Lazy Chop (Tap)
                </button>
              </div>

              {chopMode === 'transients' && (
                <div className="param-card">
                  <div className="param-head">
                    <span>SENSITIVITY</span>
                    <span className="param-val">
                      {Math.round(sensitivity * 100)}% ({slices.length} slices)
                    </span>
                  </div>
                  <input
                    type="range"
                    className="range-slider"
                    min={0.05}
                    max={0.98}
                    step={0.02}
                    value={sensitivity}
                    onChange={(e) => setSensitivity(Number(e.target.value))}
                  />
                </div>
              )}

              {chopMode === 'equal' && (
                <div className="chop-row">
                  {[2, 4, 8, 12, 16].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`toggle-chip ${equalCount === n ? 'on' : ''}`}
                      onClick={() => setEqualCount(n)}
                    >
                      {n} Slices
                    </button>
                  ))}
                </div>
              )}

              {chopMode === 'lazy' && (
                <div className="chop-row">
                  <button
                    type="button"
                    className="primary-cta"
                    style={{ background: '#eab308', color: '#111' }}
                    onPointerDown={handleLazyMark}
                  >
                    <Plus size={15} />
                    <span>PLAY / + MARK ({slices.length})</span>
                  </button>
                  <button
                    type="button"
                    className="toggle-chip"
                    onClick={() => setSlices([pad.start])}
                  >
                    Reset Marks
                  </button>
                </div>
              )}

              <div className="chop-row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Tocca la forma d&apos;onda per ascoltare i singoli slice ({slices.length}).
                </span>
                <button
                  type="button"
                  className="primary-cta"
                  disabled={slices.length === 0}
                  onClick={() => {
                    const count = assignSlicesToPads(pad.id, slices);
                    if (count > 0) setEditorOpen(false);
                  }}
                >
                  <CheckCircle2 size={15} />
                  <span>Assign {slices.length} to Pads</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
