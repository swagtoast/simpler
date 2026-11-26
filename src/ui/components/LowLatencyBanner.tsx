import React from 'react';
import { Volume2 } from 'lucide-react';
import { useStore } from '../../state/useStore';
import { audioEngine } from '../../audio/AudioEngine';
import { t } from '../../i18n/t';

export const LowLatencyBanner: React.FC = () => {
  const show = useStore((s) => s.showLatencyBanner);
  const dismiss = useStore((s) => s.dismissLatencyBanner);

  if (!show) return null;

  return (
    <div className="latency-banner" role="status">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Volume2 size={15} style={{ flexShrink: 0, color: '#9ef0c0' }} />
        <span>
          <strong>{t('latencyTitle')}</strong> {t('latencyBody')}
        </span>
      </div>
      <button
        type="button"
        className="latency-banner-close"
        onClick={() => {
          void audioEngine.unlock();
          dismiss();
        }}
      >
        OK
      </button>
    </div>
  );
};
