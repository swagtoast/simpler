import React, { useEffect, useRef, useState } from 'react';
import { Circle, Square, X, Play, Pause } from 'lucide-react';
import { audioEngine } from '../../audio/AudioEngine';
import { recorderService } from '../../audio/RecorderService';

interface VideoImportModalProps {
  file: File;
  targetPadId: number;
  onCaptured: (buffer: AudioBuffer, name: string) => void;
  onClose: () => void;
}

/**
 * Fallback & interactive YouTube screen-recording sampler:
 * Lets students play/scrub a local screen-recording video from their phone gallery
 * and capture the exact audio snippet straight onto a pad via Web Audio.
 */
export const VideoImportModal: React.FC<VideoImportModalProps> = ({
  file,
  targetPadId,
  onCaptured,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [objectUrl, setObjectUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSampling, setIsSampling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!isSampling) return;
    const id = window.setInterval(() => {
      setElapsed(recorderService.recordingElapsedSec);
    }, 80);
    return () => window.clearInterval(id);
  }, [isSampling]);

  const ensureAudioNode = async (): Promise<MediaElementAudioSourceNode> => {
    const ctx = await audioEngine.unlock();
    if (!mediaSourceRef.current && videoRef.current) {
      const node = ctx.createMediaElementSource(videoRef.current);
      // Route video audio to speakers so the student hears what they are sampling
      node.connect(ctx.destination);
      mediaSourceRef.current = node;
    }
    if (!mediaSourceRef.current) {
      throw new Error('Impossibile collegare la traccia audio del video.');
    }
    return mediaSourceRef.current;
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await ensureAudioNode();
      if (video.paused) {
        await video.play();
        setIsPlaying(true);
      } else {
        video.pause();
        setIsPlaying(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Errore riproduzione video');
    }
  };

  const handleToggleSample = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (!isSampling) {
      try {
        setErrorMsg(null);
        const node = await ensureAudioNode();
        if (video.paused) {
          await video.play();
          setIsPlaying(true);
        }
        await recorderService.startRecording('video', targetPadId, node);
        setElapsed(0);
        setIsSampling(true);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Errore cattura audio dal video');
      }
    } else {
      video.pause();
      setIsPlaying(false);
      setIsSampling(false);
      const res = await recorderService.stopRecording(true);
      if (res?.buffer) {
        const cleanName = file.name.replace(/\.[^/.]+$/, '').slice(0, 16) || 'Video Sample';
        onCaptured(res.buffer, cleanName);
      } else {
        setErrorMsg('Spezzone troppo breve: riprova lasciando scorrere il video.');
      }
    }
  };

  const handleClose = async () => {
    if (isSampling) {
      await recorderService.stopRecording(false);
    }
    try {
      mediaSourceRef.current?.disconnect();
    } catch {
      // ignore
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={() => void handleClose()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">Campiona da Video</h2>
          <button type="button" className="icon-btn" onClick={() => void handleClose()}>
            <X size={16} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          Posiziona il video sul punto che vuoi campionare (es. una registrazione schermo da YouTube) e premi{' '}
          <strong>SAMPLE</strong> per registrarlo sul pad.
        </p>

        {objectUrl && (
          <video
            ref={videoRef}
            src={objectUrl}
            controls
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            style={{
              width: '100%',
              maxHeight: 220,
              borderRadius: 10,
              background: '#000',
            }}
          />
        )}

        {errorMsg && (
          <div className="mode-hint rec" style={{ fontSize: 11.5 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="icon-btn" style={{ flex: 1 }} onClick={() => void togglePlay()}>
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            <span>{isPlaying ? 'Pausa' : 'Play'}</span>
          </button>

          <button
            type="button"
            className="primary-cta"
            style={{
              flex: 2,
              background: isSampling ? '#ef4444' : 'var(--accent-primary)',
            }}
            onClick={() => void handleToggleSample()}
          >
            {isSampling ? <Square size={15} /> : <Circle size={15} />}
            <span>{isSampling ? `STOP (${elapsed.toFixed(1)}s)` : 'SAMPLE AUDIO'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
