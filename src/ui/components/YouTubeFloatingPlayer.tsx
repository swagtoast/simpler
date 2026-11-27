import React, { useEffect, useRef, useState } from 'react';
import { X, Minus, Maximize2, Circle, Square, Mic, MonitorSpeaker, GripHorizontal } from 'lucide-react';
import { ParsedYouTubeUrl } from '../../utils/youtube';
import { BANK_LABELS } from '../../state/types';
import { useStore } from '../../state/useStore';
import { recorderService } from '../../audio/RecorderService';
import { t } from '../../i18n/t';

interface YouTubeFloatingPlayerProps {
  video: ParsedYouTubeUrl;
  onClose: () => void;
}

export const YouTubeFloatingPlayer: React.FC<YouTubeFloatingPlayerProps> = ({
  video,
  onClose,
}) => {
  const selectedPadId = useStore((s) => s.selectedPadId);
  const assignSampleToPad = useStore((s) => s.assignSampleToPad);
  const setEditorOpen = useStore((s) => s.setEditorOpen);
  const showToast = useStore((s) => s.showToast);

  const [minimized, setMinimized] = useState(false);
  const [recMode, setRecMode] = useState<'none' | 'tab' | 'mic'>('none');
  const [elapsed, setElapsed] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  const ledRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const targetCode = `${BANK_LABELS[Math.floor(selectedPadId / 16)]}${(selectedPadId % 16) + 1}`;
  const supportsTab = recorderService.supportsTabAudioCapture;

  useEffect(() => {
    if (recMode === 'none') return;
    const id = window.setInterval(() => {
      setElapsed(recorderService.recordingElapsedSec);
    }, 80);

    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      const peak = recorderService.currentInputPeak;
      smoothed = peak > smoothed ? peak : smoothed * 0.82;
      const lit = Math.round(Math.min(1, smoothed * 1.4) * 10);
      for (let i = 0; i < 10; i++) {
        const el = ledRefs.current[i];
        if (el) el.classList.toggle('lit', i < lit);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.clearInterval(id);
      cancelAnimationFrame(raf);
    };
  }, [recMode]);

  // Clean up tab capture stream when closing floating window
  useEffect(() => {
    return () => {
      if (recorderService.isRecording) {
        void recorderService.stopRecording(false);
      }
      recorderService.stopTabStream();
    };
  }, []);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const origX = pos ? pos.x : rect.left;
    const origY = pos ? pos.y : rect.top;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX, origY };
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const nextX = Math.max(8, Math.min(window.innerWidth - 220, d.origX + (e.clientX - d.startX)));
    const nextY = Math.max(8, Math.min(window.innerHeight - 100, d.origY + (e.clientY - d.startY)));
    setPos({ x: nextX, y: nextY });
  };

  const handleDragEnd = () => {
    dragRef.current = null;
  };

  const handleToggleRec = async (mode: 'tab' | 'mic') => {
    if (recMode !== 'none') {
      const res = await recorderService.stopRecording(true);
      setRecMode('none');
      setElapsed(0);
      if (res?.buffer) {
        const code = `${BANK_LABELS[Math.floor(res.padId / 16)]}${(res.padId % 16) + 1}`;
        assignSampleToPad(res.padId, res.buffer, `YT ${code}`);
        showToast(t('ytSampledToast', { code, sec: res.buffer.duration.toFixed(1) }));
        setEditorOpen(true, 'edit');
      } else {
        showToast(t('recTooShort'));
      }
      return;
    }

    try {
      await recorderService.startRecording(mode, selectedPadId);
      setElapsed(0);
      setRecMode(mode);
    } catch (err) {
      setRecMode('none');
      showToast(err instanceof Error ? err.message : t('micError'));
    }
  };

  const handleClose = async () => {
    if (recMode !== 'none') {
      await recorderService.stopRecording(false);
      setRecMode('none');
    }
    recorderService.stopTabStream();
    onClose();
  };

  const stylePos: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : {};

  return (
    <div
      ref={cardRef}
      className={`yt-floating-window ${minimized ? 'minimized' : ''}`}
      style={stylePos}
      role="dialog"
      aria-label={t('ytFloatTitle')}
    >
      {/* Draggable Akai Hardware Header */}
      <div
        className="yt-float-header"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <GripHorizontal size={14} style={{ opacity: 0.7, flexShrink: 0 }} />
          <span className="yt-float-title">{t('ytFloatTitle')}</span>
          <span className="yt-pad-pill">{targetCode}</span>
        </div>

        <div
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="yt-hdr-btn"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? 'Espandi' : 'Riduci'}
          >
            {minimized ? <Maximize2 size={13} /> : <Minus size={13} />}
          </button>
          <button
            type="button"
            className="yt-hdr-btn"
            onClick={() => void handleClose()}
            title="Chiudi"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Embedded YouTube Player (kept mounted even when minimized so playback stays alive!) */}
      <div className="yt-iframe-wrap" style={{ display: minimized ? 'none' : 'block' }}>
        <iframe
          src={video.embedUrl}
          title="YouTube Player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="yt-iframe"
        />
      </div>

      {/* Recording Controls right under the video */}
      <div className="yt-controls">
        {recMode !== 'none' && (
          <div
            className="led-bar-h"
            style={{ height: 9, background: '#141619', padding: 2, borderRadius: 3 }}
          >
            {Array.from({ length: 10 }, (_, i) => {
              const zone = i >= 8 ? 'red' : i >= 6 ? 'yellow' : 'green';
              return (
                <span
                  key={i}
                  ref={(el) => {
                    ledRefs.current[i] = el;
                  }}
                  className={`led-seg ${zone}`}
                />
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          {supportsTab && (
            <button
              type="button"
              className={`primary-cta ${recMode === 'tab' ? 'recording-pulse' : ''}`}
              style={{ flex: 1, height: 34, fontSize: 11.5 }}
              disabled={recMode === 'mic'}
              onClick={() => void handleToggleRec('tab')}
            >
              {recMode === 'tab' ? <Square size={13} /> : <MonitorSpeaker size={14} />}
              <span>
                {recMode === 'tab' ? t('ytStopRec', { sec: elapsed.toFixed(1) }) : t('ytTabRec')}
              </span>
            </button>
          )}

          <button
            type="button"
            className={supportsTab ? 'icon-btn' : 'primary-cta'}
            style={{
              flex: 1,
              height: 34,
              fontSize: 11.5,
              ...(recMode === 'mic'
                ? { background: '#cc2222', color: '#fff', borderColor: '#8f1414' }
                : {}),
            }}
            disabled={recMode === 'tab'}
            onClick={() => void handleToggleRec('mic')}
          >
            {recMode === 'mic' ? (
              <Square size={13} />
            ) : supportsTab ? (
              <Mic size={13} />
            ) : (
              <Circle size={13} />
            )}
            <span>
              {recMode === 'mic' ? t('ytStopRec', { sec: elapsed.toFixed(1) }) : t('ytMicRec')}
            </span>
          </button>
        </div>

        {!minimized && <div className="yt-hint">{t('ytTabHint')}</div>}
      </div>
    </div>
  );
};
