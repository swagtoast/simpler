import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Radio,
  Film,
  SlidersHorizontal,
  SlidersVertical,
  Piano,
  Scissors,
  ArrowLeftRight,
  Square,
  Circle,
} from 'lucide-react';
import { BANK_LABELS, BankId } from '../../state/types';
import { useStore } from '../../state/useStore';
import { audioEngine } from '../../audio/AudioEngine';
import { recorderService } from '../../audio/RecorderService';
import { PadGrid } from '../components/PadGrid';
import { SampleEditorDrawer } from './SampleEditorDrawer';
import { KeyboardOverlay } from '../components/KeyboardOverlay';
import { VideoImportModal } from '../components/VideoImportModal';

export const SampleView: React.FC = () => {
  const activeBank = useStore((s) => s.activeBank);
  const pads = useStore((s) => s.project.pads);
  const selectedPadId = useStore((s) => s.selectedPadId);
  const toolMode = useStore((s) => s.toolMode);
  const dragSourcePadId = useStore((s) => s.dragSourcePadId);
  const editorOpen = useStore((s) => s.editorOpen);
  const keyboardOpen = useStore((s) => s.keyboardOpen);
  const isRecording = useStore((s) => s.isRecording);
  const recordingPadId = useStore((s) => s.recordingPadId);
  const recordingSource = useStore((s) => s.recordingSource);
  const padMixerMode = useStore((s) => s.padMixerMode);

  const setActiveBank = useStore((s) => s.setActiveBank);
  const setToolMode = useStore((s) => s.setToolMode);
  const togglePadMixerMode = useStore((s) => s.togglePadMixerMode);
  const setPadMixerMode = useStore((s) => s.setPadMixerMode);
  const setEditorOpen = useStore((s) => s.setEditorOpen);
  const setKeyboardOpen = useStore((s) => s.setKeyboardOpen);
  const setRecordingState = useStore((s) => s.setRecordingState);
  const assignSampleToPad = useStore((s) => s.assignSampleToPad);
  const showToast = useStore((s) => s.showToast);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const micLedRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [pendingVideoFile, setPendingVideoFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const selectedPad = pads[selectedPadId];

  // Live 60fps Mic input LED bar whenever MIC mode is open
  useEffect(() => {
    if (toolMode !== 'rec' && recordingSource !== 'mic') return;
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      const peak = recorderService.currentInputPeak;
      smoothed = peak > smoothed ? peak : smoothed * 0.82;
      const lit = Math.round(Math.min(1, smoothed * 1.4) * 10);
      for (let i = 0; i < 10; i++) {
        const el = micLedRefs.current[i];
        if (el) el.classList.toggle('lit', i < lit);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [toolMode, recordingSource]);

  const handleToggleMicMode = async () => {
    if (toolMode === 'rec') {
      if (recorderService.isRecording && recorderService.recordingSource === 'mic') {
        await handleStopMicHold(selectedPadId);
      }
      setToolMode('play');
      return;
    }

    // Request iPhone microphone synchronously inside the tap gesture!
    try {
      await recorderService.ensureMicStream();
      setPadMixerMode(false);
      setToolMode('rec');
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Permesso microfono negato. Su iPhone apri il link HTTPS in Safari.'
      );
    }
  };

  const handleTapRecordButton = async () => {
    if (isRecording && recordingSource === 'mic') {
      await handleStopMicHold(recordingPadId ?? selectedPadId);
      return;
    }
    await handleStartMicHold(selectedPadId);
  };

  const handleStartMicHold = async (padId: number) => {
    try {
      setRecordingState(true, padId, 'mic');
      await recorderService.startRecording('mic', padId);
    } catch (err) {
      setRecordingState(false, null, null);
      showToast(err instanceof Error ? err.message : 'Errore microfono');
    }
  };

  const handleStopMicHold = async (padId: number) => {
    if (!recorderService.isRecording || recorderService.recordingSource !== 'mic') {
      setRecordingState(false, null, null);
      return;
    }
    const result = await recorderService.stopRecording(true);
    setRecordingState(false, null, null);
    if (result?.buffer) {
      const code = `${BANK_LABELS[Math.floor(padId / 16)]}${(padId % 16) + 1}`;
      assignSampleToPad(padId, result.buffer, `Mic ${code}`);
      showToast(`Registrato su ${code} (${result.buffer.duration.toFixed(2)}s)`);
    } else {
      showToast('Registrazione troppo breve');
    }
  };

  const handleSelectResampleTarget = async (padId: number) => {
    try {
      await recorderService.startRecording('resample', padId);
      setRecordingState(true, padId, 'resample');
      setToolMode('play');
      const code = `${BANK_LABELS[Math.floor(padId / 16)]}${(padId % 16) + 1}`;
      showToast(`Resampling su ${code}: suona i pad e premi STOP!`);
    } catch (err) {
      setRecordingState(false, null, null);
      showToast(err instanceof Error ? err.message : 'Errore resampling');
    }
  };

  const handleStopResample = async () => {
    const result = await recorderService.stopRecording(true);
    setRecordingState(false, null, null);
    if (result?.buffer) {
      const code = `${BANK_LABELS[Math.floor(result.padId / 16)]}${(result.padId % 16) + 1}`;
      assignSampleToPad(result.padId, result.buffer, `Resample ${code}`);
      showToast(`Resample salvato su ${code} (${result.buffer.duration.toFixed(2)}s)`);
    } else {
      showToast('Nessun audio catturato nel resample');
    }
  };

  const triggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isVideo = recorderService.isVideoFile(file);

    // For very large screen-recording videos (> 30MB), open the interactive video trimmer/sampler directly
    if (isVideo && file.size > 30 * 1024 * 1024) {
      setPendingVideoFile(file);
      return;
    }

    setImporting(true);
    try {
      await audioEngine.unlock();
      const buffer = await recorderService.tryDecodeFileDirectly(file);
      if (buffer) {
        const cleanName = file.name.replace(/\.[^/.]+$/, '').slice(0, 18) || 'Sample';
        assignSampleToPad(selectedPadId, buffer, cleanName);
        showToast(`Caricato "${cleanName}" (${buffer.duration.toFixed(1)}s) — ritaglia la waveform!`);
        // Open Waveform Editor immediately for imported videos / long samples (> 3s) just like Koala workflow
        if (isVideo || buffer.duration > 3) {
          setEditorOpen(true, 'edit');
        }
      } else if (isVideo) {
        // Native container decode unsupported on this device -> seamless interactive <video> capture modal
        setPendingVideoFile(file);
      } else {
        showToast(`Formato audio non supportato: ${file.name}`);
      }
    } finally {
      setImporting(false);
    }
  };

  const bankHasSamples = (bank: BankId) =>
    pads.slice(bank * 16, bank * 16 + 16).some((p) => p.hasSample);

  const selectedCode = `${BANK_LABELS[Math.floor(selectedPadId / 16)]}${(selectedPadId % 16) + 1}`;

  const cycleMoveMode = () => {
    if (toolMode === 'play') setToolMode('copy');
    else if (toolMode === 'copy') setToolMode('swap');
    else setToolMode('play');
  };

  return (
    <section className="sample-view" aria-label="Sample View">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {/* Minimal Koala-style Bank + Action Bar */}
      <div className="sample-toolbar">
        <div className="bank-switcher" role="tablist" aria-label="Sample Banks">
          {([0, 1, 2, 3] as BankId[]).map((b) => (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={activeBank === b}
              className={`bank-btn ${activeBank === b ? 'active' : ''} ${bankHasSamples(b) ? 'has-samples' : ''}`}
              onClick={() => setActiveBank(b)}
            >
              {BANK_LABELS[b]}
            </button>
          ))}
        </div>

        <div className="action-strip">
          <button
            type="button"
            className={`pill-btn ${toolMode === 'rec' || recordingSource === 'mic' ? 'active-rec' : ''}`}
            onClick={() => void handleToggleMicMode()}
            title="Registra un sample col microfono del telefono o PC"
          >
            <Mic size={13} />
            <span>MIC</span>
          </button>

          <button
            type="button"
            className={`pill-btn ${padMixerMode ? 'active-primary' : ''}`}
            onClick={togglePadMixerMode}
            title="Mostra fader volume e VU meter sui pad"
          >
            <SlidersVertical size={13} />
            <span>VOL</span>
          </button>

          <button
            type="button"
            className="pill-btn"
            disabled={importing}
            onClick={triggerFilePicker}
            title="Importa video registrazione schermo (YouTube) o file audio sul pad selezionato"
          >
            <Film size={13} />
            <span>{importing ? 'CARICO...' : 'IMPORT'}</span>
          </button>

          <button
            type="button"
            className={`pill-btn ${toolMode === 'resample' || recordingSource === 'resample' ? 'active-resample' : ''}`}
            onClick={() => {
              if (recordingSource === 'resample') {
                void handleStopResample();
              } else {
                setToolMode(toolMode === 'resample' ? 'play' : 'resample');
              }
            }}
            title="Registra internamente i pad che suoni su un nuovo pad"
          >
            <Radio size={13} />
            <span>{recordingSource === 'resample' ? 'STOP' : 'RESAMPLE'}</span>
          </button>

          <button
            type="button"
            className={`pill-btn ${toolMode === 'copy' || toolMode === 'swap' ? 'active-mode' : ''}`}
            onClick={cycleMoveMode}
            title="Copia o scambia pad"
          >
            <ArrowLeftRight size={13} />
            <span>{toolMode === 'copy' ? 'COPY' : toolMode === 'swap' ? 'SWAP' : 'MOVE'}</span>
          </button>
        </div>
      </div>

      {/* Contextual Banners only when a special mode is active */}
      {toolMode === 'rec' && (
        <div className="mode-hint rec" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 160 }}>
            <div className="led-bar-h" style={{ maxWidth: 96, height: 10, background: '#171a1e', padding: 2, borderRadius: 3 }}>
              {Array.from({ length: 10 }, (_, i) => {
                const zone = i >= 8 ? 'red' : i >= 6 ? 'yellow' : 'green';
                return (
                  <span
                    key={i}
                    ref={(el) => {
                      micLedRefs.current[i] = el;
                    }}
                    className={`led-seg ${zone}`}
                  />
                );
              })}
            </div>
            <span style={{ fontSize: 11.5 }}>
              {isRecording && recordingSource === 'mic'
                ? `Registrando su ${selectedCode}...`
                : `Tieni premuto un pad oppure usa REC (${selectedCode})`}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="primary-cta"
              style={{ height: 28, padding: '0 10px', fontSize: 11.5 }}
              onClick={() => void handleTapRecordButton()}
            >
              {isRecording && recordingSource === 'mic' ? <Square size={12} /> : <Circle size={12} />}
              <span>{isRecording && recordingSource === 'mic' ? 'STOP' : `REC ${selectedCode}`}</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              style={{ height: 28, padding: '0 8px', fontSize: 11 }}
              onClick={() => void handleToggleMicMode()}
            >
              Fine
            </button>
          </div>
        </div>
      )}

      {isRecording && recordingSource === 'resample' && recordingPadId !== null && (
        <div className="mode-hint resample">
          <span>
            🔴 Resampling su{' '}
            <strong>
              {BANK_LABELS[Math.floor(recordingPadId / 16)]}
              {(recordingPadId % 16) + 1}
            </strong>{' '}
            — suona i pad!
          </span>
          <button
            type="button"
            className="primary-cta"
            style={{ height: 28, padding: '0 10px', fontSize: 11.5 }}
            onClick={() => void handleStopResample()}
          >
            <Square size={12} />
            <span>STOP</span>
          </button>
        </div>
      )}

      {toolMode === 'resample' && !isRecording && (
        <div className="mode-hint resample">
          <span>Tocca il pad su cui registrare il resample interno.</span>
          <button type="button" className="latency-banner-close" onClick={() => setToolMode('play')}>
            Annulla
          </button>
        </div>
      )}

      {(toolMode === 'copy' || toolMode === 'swap') && (
        <div className="mode-hint">
          <span>
            {dragSourcePadId === null
              ? `Tocca il pad da ${toolMode === 'copy' ? 'copiare' : 'scambiare'}.`
              : `Ora tocca il pad di destinazione.`}
          </span>
          <button type="button" className="latency-banner-close" onClick={() => setToolMode('play')}>
            Fine
          </button>
        </div>
      )}

      {/* 4x4 Multi-Touch Pad Grid (Hold any empty pad = instant Mic record!) */}
      <div className="sample-body">
        <PadGrid
          onStartMicHold={(padId) => void handleStartMicHold(padId)}
          onStopMicHold={(padId) => void handleStopMicHold(padId)}
          onSelectResampleTarget={(padId) => void handleSelectResampleTarget(padId)}
        />
      </div>

      {/* Clean Selected Pad Footer */}
      <div className="selected-pad-bar">
        <div className="selected-pad-info">
          <span
            className="selected-color-dot"
            style={{ background: selectedPad?.hasSample ? selectedPad.color : 'var(--border-strong)' }}
          />
          <div style={{ minWidth: 0 }}>
            <div className="selected-pad-title">
              {selectedCode} · {selectedPad?.hasSample ? selectedPad.name : 'Vuoto'}
            </div>
            <div className="selected-pad-meta">
              {selectedPad?.hasSample
                ? `${(selectedPad.duration * (selectedPad.end - selectedPad.start)).toFixed(2)}s · ${selectedPad.pitch >= 0 ? `+${selectedPad.pitch}` : selectedPad.pitch}st`
                : 'Tieni premuto per Mic · oppure IMPORT'}
            </div>
          </div>
        </div>

        <div className="selected-pad-btns">
          <button
            type="button"
            className="pill-btn active-primary"
            disabled={!selectedPad?.hasSample}
            onClick={() => setEditorOpen(true, 'edit')}
          >
            <SlidersHorizontal size={13} />
            <span>EDIT</span>
          </button>
          <button
            type="button"
            className="pill-btn"
            disabled={!selectedPad?.hasSample}
            onClick={() => setEditorOpen(true, 'chop')}
          >
            <Scissors size={13} />
            <span>CHOP</span>
          </button>
          <button
            type="button"
            className="pill-btn"
            disabled={!selectedPad?.hasSample}
            onClick={() => setKeyboardOpen(true)}
          >
            <Piano size={13} />
            <span>KEYS</span>
          </button>
        </div>
      </div>

      {editorOpen && <SampleEditorDrawer onRequestImport={triggerFilePicker} />}
      {keyboardOpen && <KeyboardOverlay />}

      {pendingVideoFile && (
        <VideoImportModal
          file={pendingVideoFile}
          targetPadId={selectedPadId}
          onCaptured={(buffer, name) => {
            assignSampleToPad(selectedPadId, buffer, name);
            setPendingVideoFile(null);
            setEditorOpen(true, 'edit');
            showToast(`Campionato da video (${buffer.duration.toFixed(1)}s)`);
          }}
          onClose={() => setPendingVideoFile(null)}
        />
      )}
    </section>
  );
};
