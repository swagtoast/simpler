export interface ParsedYouTubeUrl {
  videoId: string;
  startSec: number;
  embedUrl: string;
}

function parseTimestamp(raw: string | null): number {
  if (!raw) return 0;
  const trimmed = raw.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  let total = 0;
  const h = trimmed.match(/(\d+)h/);
  const m = trimmed.match(/(\d+)m/);
  const s = trimmed.match(/(\d+)s/);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total;
}

/**
 * Parses ANY YouTube URL format:
 * - youtube.com/watch?v=...
 * - m.youtube.com/watch?v=...
 * - music.youtube.com/watch?v=...
 * - youtu.be/...
 * - youtube.com/shorts/...
 * - youtube.com/live/...
 * - youtube.com/embed/...
 * - youtube-nocookie.com/embed/...
 * - bare 11-char video ID
 */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let videoId: string | null = null;
  let startSec = 0;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    videoId = trimmed;
  } else {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const url = new URL(withProto);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      startSec = parseTimestamp(url.searchParams.get('t') || url.searchParams.get('start'));

      if (host === 'youtu.be') {
        const seg = url.pathname.split('/').filter(Boolean)[0];
        if (seg && /^[a-zA-Z0-9_-]{11}$/.test(seg)) videoId = seg;
      } else if (
        host === 'youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtube-nocookie.com'
      ) {
        const vParam = url.searchParams.get('v');
        if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
          videoId = vParam;
        } else {
          const parts = url.pathname.split('/').filter(Boolean);
          if (
            parts.length >= 2 &&
            ['shorts', 'embed', 'live', 'v'].includes(parts[0]) &&
            /^[a-zA-Z0-9_-]{11}$/.test(parts[1])
          ) {
            videoId = parts[1];
          }
        }
      }
    } catch {
      // fallback regex below
    }

    if (!videoId) {
      const match = trimmed.match(
        /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([a-zA-Z0-9_-]{11})/
      );
      if (match) videoId = match[1];
    }
  }

  if (!videoId) return null;

  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (startSec > 0) params.set('start', String(startSec));

  return {
    videoId,
    startSec,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`,
  };
}
