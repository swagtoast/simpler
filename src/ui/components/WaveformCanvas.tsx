import React, { useEffect, useRef, useState } from 'react';
import { PadConfig } from '../../state/types';
import { audioEngine } from '../../audio/AudioEngine';
import { voiceManager } from '../../audio/VoiceManager';

interface WaveformCanvasProps {
  pad: PadConfig;
  slices?: number[];
  showSlices?: boolean;
  onChangeRegion: (start: number, end: number) => void;
  onTapSlice?: (sliceIndex: number) => void;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  pad,
  slices = [],
  showSlices = false,
  onChangeRegion,
  onTapSlice,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);

  const dragModeRef = useRef<'none' | 'start' | 'end' | 'pan' | 'pinch'>('none');
  const panAnchorRef = useRef<{ clientX: number; viewStart: number }>({
    clientX: 0,
    viewStart: 0,
  });
  const activeTouchesRef = useRef(new Map<number, number>()); // pointerId -> clientX
  const pinchAnchorRef = useRef<{
    dist: number;
    zoom: number;
    centerNorm: number;
    centerRel: number;
  } | null>(null);

  useEffect(() => {
    setZoom(1);
    setViewStart(0);
  }, [pad.id, pad.sampleId]);

  const viewSpan = 1 / zoom;
  const clampedViewStart = Math.max(0, Math.min(1 - viewSpan, viewStart));
  const viewEnd = clampedViewStart + viewSpan;

  const setZoomCentered = (nextZoom: number) => {
    const z = Math.max(1, Math.min(24, nextZoom));
    const center = clampedViewStart + viewSpan / 2;
    const nextSpan = 1 / z;
    const nextStart = Math.max(0, Math.min(1 - nextSpan, center - nextSpan / 2));
    setZoom(z);
    setViewStart(nextStart);
  };

  useEffect(() => {
    let raf = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(0, 0, w, h);

      const midY = h / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      const normToX = (n: number) => ((n - clampedViewStart) / viewSpan) * w;

      const buf = audioEngine.getSample(pad.sampleId);
      if (buf) {
        const ch0 = buf.getChannelData(0);
        const total = ch0.length;
        const startSample = Math.floor(clampedViewStart * total);
        const endSample = Math.max(startSample + 1, Math.floor(viewEnd * total));
        const samplesPerPixel = Math.max(1, (endSample - startSample) / w);

        const activeStartX = normToX(pad.start);
        const activeEndX = normToX(pad.end);

        // Dimmed outside trimmed region
        ctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
        if (activeStartX > 0) ctx.fillRect(0, 0, Math.min(w, activeStartX), h);
        if (activeEndX < w) ctx.fillRect(Math.max(0, activeEndX), 0, w - Math.max(0, activeEndX), h);

        // Waveform peaks
        const barStep = Math.max(1, Math.floor(dpr));
        for (let px = 0; px < w; px += barStep) {
          const s0 = Math.floor(startSample + px * samplesPerPixel);
          const s1 = Math.min(total, Math.floor(s0 + samplesPerPixel) + 1);
          let min = 0;
          let max = 0;
          const stride = Math.max(1, Math.floor((s1 - s0) / 16));
          for (let s = s0; s < s1; s += stride) {
            const v = ch0[s];
            if (v < min) min = v;
            if (v > max) max = v;
          }
          const inRegion = px >= activeStartX && px <= activeEndX;
          ctx.fillStyle = inRegion ? pad.color : 'rgba(148, 163, 184, 0.32)';
          const yTop = midY - max * (h * 0.44);
          const yBot = midY - min * (h * 0.44);
          ctx.fillRect(px, yTop, barStep, Math.max(dpr, yBot - yTop));
        }

        // Slice markers
        if (showSlices && slices.length > 0) {
          ctx.font = `700 ${Math.round(10 * dpr)}px monospace`;
          slices.forEach((sl, idx) => {
            const sx = normToX(sl);
            if (sx < -20 || sx > w + 20) return;
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 1.5 * dpr;
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, h);
            ctx.stroke();

            ctx.fillStyle = '#facc15';
            ctx.fillRect(sx, 0, 18 * dpr, 16 * dpr);
            ctx.fillStyle = '#111';
            ctx.fillText(String(idx + 1), sx + 4 * dpr, 12 * dpr);
          });
        }

        // Start Handle (green, chunky touch tab)
        const sx = normToX(pad.start);
        if (sx >= -16 * dpr && sx <= w + 16 * dpr) {
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 2.5 * dpr;
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, h);
          ctx.stroke();

          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx + 18 * dpr, 0);
          ctx.lineTo(sx, 20 * dpr);
          ctx.closePath();
          ctx.fill();
        }

        // End Handle (red, chunky touch tab)
        const ex = normToX(pad.end);
        if (ex >= -16 * dpr && ex <= w + 16 * dpr) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2.5 * dpr;
          ctx.beginPath();
          ctx.moveTo(ex, 0);
          ctx.lineTo(ex, h);
          ctx.stroke();

          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.moveTo(ex, h);
          ctx.lineTo(ex - 18 * dpr, h);
          ctx.lineTo(ex, h - 20 * dpr);
          ctx.closePath();
          ctx.fill();
        }

        // Live Playhead
        const playback = voiceManager.getPadPlaybackState(pad.id);
        if (playback.active) {
          const px = normToX(playback.normalizedPos);
          if (px >= 0 && px <= w) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * dpr;
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, h);
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pad.id, pad.sampleId, pad.start, pad.end, pad.color, slices, showSlices, clampedViewStart, viewSpan, viewEnd]);

  const clientXToNorm = (clientX: number): number => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    const rel = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return clampedViewStart + rel * viewSpan;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    activeTouchesRef.current.set(e.pointerId, e.clientX);

    // 2-finger pinch-to-zoom on smartphones!
    if (activeTouchesRef.current.size === 2) {
      const xs = Array.from(activeTouchesRef.current.values());
      const dist = Math.max(10, Math.abs(xs[1] - xs[0]));
      const midX = (xs[0] + xs[1]) / 2;
      const centerRel = Math.max(0, Math.min(1, (midX - rect.left) / rect.width));
      const centerNorm = clampedViewStart + centerRel * viewSpan;
      dragModeRef.current = 'pinch';
      pinchAnchorRef.current = { dist, zoom, centerNorm, centerRel };
      return;
    }

    const x = e.clientX - rect.left;
    const startX = ((pad.start - clampedViewStart) / viewSpan) * rect.width;
    const endX = ((pad.end - clampedViewStart) / viewSpan) * rect.width;
    const hitTol = 32;

    const distStart = Math.abs(x - startX);
    const distEnd = Math.abs(x - endX);

    if (distStart <= hitTol && distStart <= distEnd) {
      dragModeRef.current = 'start';
    } else if (distEnd <= hitTol) {
      dragModeRef.current = 'end';
    } else if (showSlices && slices.length > 0 && onTapSlice) {
      const n = clientXToNorm(e.clientX);
      let chosen = -1;
      for (let i = 0; i < slices.length; i++) {
        const s0 = slices[i];
        const s1 = i + 1 < slices.length ? slices[i + 1] : pad.end;
        if (n >= s0 && n <= s1) {
          chosen = i;
          break;
        }
      }
      if (chosen >= 0) {
        onTapSlice(chosen);
      }
      dragModeRef.current = zoom > 1 ? 'pan' : 'none';
      panAnchorRef.current = { clientX: e.clientX, viewStart: clampedViewStart };
    } else if (zoom > 1) {
      dragModeRef.current = 'pan';
      panAnchorRef.current = { clientX: e.clientX, viewStart: clampedViewStart };
    } else {
      void audioEngine.unlock();
      voiceManager.triggerPad(pad);
      dragModeRef.current = 'none';
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTouchesRef.current.has(e.pointerId)) {
      activeTouchesRef.current.set(e.pointerId, e.clientX);
    }

    const mode = dragModeRef.current;
    if (mode === 'none') return;

    if (mode === 'pinch' && activeTouchesRef.current.size >= 2 && pinchAnchorRef.current) {
      const xs = Array.from(activeTouchesRef.current.values());
      const dist = Math.max(10, Math.abs(xs[1] - xs[0]));
      const ratio = dist / pinchAnchorRef.current.dist;
      const nextZoom = Math.max(1, Math.min(24, pinchAnchorRef.current.zoom * ratio));
      const nextSpan = 1 / nextZoom;
      const nextStart = Math.max(
        0,
        Math.min(1 - nextSpan, pinchAnchorRef.current.centerNorm - pinchAnchorRef.current.centerRel * nextSpan)
      );
      setZoom(nextZoom);
      setViewStart(nextStart);
      return;
    }

    if (mode === 'start') {
      const nextStart = Math.max(0, Math.min(pad.end - 0.005, clientXToNorm(e.clientX)));
      onChangeRegion(nextStart, pad.end);
    } else if (mode === 'end') {
      const nextEnd = Math.min(1, Math.max(pad.start + 0.005, clientXToNorm(e.clientX)));
      onChangeRegion(pad.start, nextEnd);
    } else if (mode === 'pan') {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const dxNorm = ((panAnchorRef.current.clientX - e.clientX) / rect.width) * viewSpan;
      setViewStart(Math.max(0, Math.min(1 - viewSpan, panAnchorRef.current.viewStart + dxNorm)));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activeTouchesRef.current.delete(e.pointerId);
    if (activeTouchesRef.current.size < 2) {
      pinchAnchorRef.current = null;
      if (dragModeRef.current === 'pinch') {
        dragModeRef.current = 'none';
      }
    }
    if (activeTouchesRef.current.size === 0) {
      dragModeRef.current = 'none';
    }
  };

  return (
    <div className="waveform-wrap">
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.35 : 0.75;
          setZoomCentered(zoom * factor);
        }}
      />
      <div className="waveform-zoom-bar">
        <button
          type="button"
          className="zoom-chip"
          onClick={() => setZoomCentered(zoom / 2)}
          disabled={zoom <= 1}
        >
          −
        </button>
        <span className="zoom-chip" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {zoom.toFixed(zoom < 2 ? 0 : 1)}×
        </span>
        <button
          type="button"
          className="zoom-chip"
          onClick={() => setZoomCentered(zoom * 2)}
          disabled={zoom >= 24}
        >
          +
        </button>
      </div>
    </div>
  );
};
