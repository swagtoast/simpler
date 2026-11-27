import React, { useState } from 'react';
import { Music, Film, Youtube, X } from 'lucide-react';
import { parseYouTubeUrl, ParsedYouTubeUrl } from '../../utils/youtube';
import { t } from '../../i18n/t';

interface ImportModalProps {
  targetCode: string;
  onPickAudio: () => void;
  onPickVideo: () => void;
  onOpenYouTube: (parsed: ParsedYouTubeUrl) => void;
  onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  targetCode,
  onPickAudio,
  onPickVideo,
  onOpenYouTube,
  onClose,
}) => {
  const [ytInput, setYtInput] = useState('');
  const [ytError, setYtError] = useState<string | null>(null);

  const handleSubmitYouTube = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseYouTubeUrl(ytInput);
    if (!parsed) {
      setYtError(t('importYtInvalid'));
      return;
    }
    setYtError(null);
    onOpenYouTube(parsed);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">{t('importModalTitle', { code: targetCode })}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Dedicated Audio Sample & Video/Screen-Rec Pickers (separate so iOS opens Files for Audio!) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            type="button"
            className="import-tile-btn"
            onClick={() => {
              onClose();
              onPickAudio();
            }}
          >
            <Music size={20} style={{ color: 'var(--accent-primary)' }} />
            <span className="import-tile-title">{t('importAudioTitle')}</span>
            <span className="import-tile-sub">{t('importAudioSub')}</span>
          </button>

          <button
            type="button"
            className="import-tile-btn"
            onClick={() => {
              onClose();
              onPickVideo();
            }}
          >
            <Film size={20} style={{ color: 'var(--accent-primary)' }} />
            <span className="import-tile-title">{t('importVideoTitle')}</span>
            <span className="import-tile-sub">{t('importVideoSub')}</span>
          </button>
        </div>

        {/* YouTube URL -> Floating YouTube Sampler Window */}
        <form onSubmit={handleSubmitYouTube} className="import-yt-box">
          <label className="import-yt-label" htmlFor="simpler-yt-url">
            <Youtube size={14} style={{ color: 'var(--accent-primary)' }} />
            <span>{t('importYtLabel')}</span>
          </label>
          <input
            id="simpler-yt-url"
            type="text"
            className="editor-name-input"
            style={{ maxWidth: '100%', fontSize: 12.5 }}
            value={ytInput}
            onChange={(e) => {
              setYtInput(e.target.value);
              if (ytError) setYtError(null);
            }}
            placeholder={t('importYtPlaceholder')}
            autoComplete="off"
          />
          {ytError && (
            <div style={{ fontSize: 11.5, color: 'var(--accent-primary)', fontWeight: 700 }}>
              {ytError}
            </div>
          )}
          <button
            type="submit"
            className="primary-cta"
            style={{ width: '100%' }}
            disabled={!ytInput.trim()}
          >
            <Youtube size={15} />
            <span>{t('importYtOpen')}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
