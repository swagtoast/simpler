import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Globe, X } from 'lucide-react';
import { useStore } from '../../state/useStore';
import { t } from '../../i18n/t';

export const WorkshopQRModal: React.FC = () => {
  const open = useStore((s) => s.qrModalOpen);
  const setOpen = useStore((s) => s.setQrModalOpen);
  const showToast = useStore((s) => s.showToast);

  const [qrSvg, setQrSvg] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [customUrl, setCustomUrl] = useState<string>(
    typeof window !== 'undefined' ? window.location.href : ''
  );

  const currentUrl = customUrl.trim() || (typeof window !== 'undefined' ? window.location.href : '');
  const isLocal =
    currentUrl.includes('://localhost') ||
    currentUrl.includes('://127.0.0.1') ||
    currentUrl.includes('://192.168.') ||
    currentUrl.includes('://10.');
  const isHttps = currentUrl.startsWith('https://');

  useEffect(() => {
    if (open && typeof window !== 'undefined') {
      setCustomUrl(window.location.href);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !currentUrl) return;
    QRCode.toString(currentUrl, {
      type: 'svg',
      margin: 1,
      width: 240,
      color: { dark: '#0f1116', light: '#ffffff' },
    })
      .then((svg) => setQrSvg(svg))
      .catch(() => setQrSvg(''));
  }, [open, currentUrl]);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      showToast(t('linkCopiedToast'));
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast(t('copyManualToast'));
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">{t('qrTitle')}</h2>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{t('appTagline')}</div>
          </div>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="qr-frame">
          {qrSvg ? (
            <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div style={{ width: 240, height: 240, display: 'grid', placeItems: 'center', color: '#111' }}>
              {t('qrGenerating')}
            </div>
          )}
          <div className="qr-url">{currentUrl}</div>
        </div>

        <input
          type="url"
          className="editor-name-input"
          style={{ maxWidth: '100%', fontSize: 12, fontFamily: 'var(--font-mono)' }}
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          placeholder="https://swagtoast.github.io/simpler/"
          aria-label={t('qrUrlAria')}
        />

        {isLocal && (
          <div className="mode-hint resample" style={{ fontSize: 11.5 }}>
            <span>⚠️ {t('qrLocalWarn')}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="primary-cta" style={{ flex: 1 }} onClick={handleCopy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            <span>{copied ? t('copied') : t('copyLink')}</span>
          </button>
          <span
            className="toggle-chip"
            style={{
              background: isHttps ? '#dcfce7' : '#fef3c7',
              borderColor: isHttps ? '#16a34a' : '#d97706',
              color: isHttps ? '#14532d' : '#78350f',
              boxShadow: 'none',
            }}
          >
            <Globe size={13} />
            {isHttps ? t('httpsReady') : t('httpsNeeded')}
          </span>
        </div>
      </div>
    </div>
  );
};
