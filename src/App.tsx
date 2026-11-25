import React, { useEffect } from 'react';
import { useStore } from './state/useStore';
import { audioEngine } from './audio/AudioEngine';
import { TopBar } from './ui/components/TopBar';
import { LowLatencyBanner } from './ui/components/LowLatencyBanner';
import { TabBar } from './ui/components/TabBar';
import { SampleView } from './ui/views/SampleView';
import { SequenceView } from './ui/views/SequenceView';
import { WorkshopQRModal } from './ui/components/WorkshopQRModal';

export const App: React.FC = () => {
  const initApp = useStore((s) => s.initApp);
  const activeTab = useStore((s) => s.activeTab);
  const toastMessage = useStore((s) => s.toastMessage);
  const setAudioUnlocked = useStore((s) => s.setAudioUnlocked);

  useEffect(() => {
    void initApp();

    const unsub = audioEngine.onUnlock(() => setAudioUnlocked(true));
    const unlockOnce = () => {
      void audioEngine.unlock();
    };

    window.addEventListener('pointerdown', unlockOnce, { passive: true, once: true });
    return () => {
      unsub();
      window.removeEventListener('pointerdown', unlockOnce);
    };
  }, [initApp, setAudioUnlocked]);

  return (
    <div className="app-shell">
      <TopBar />
      <LowLatencyBanner />
      <TabBar />

      <main className="workspace">
        {activeTab === 'sample' && <SampleView />}

        {activeTab === 'sequence' && <SequenceView />}

        {activeTab === 'perform' && (
          <div className="phase-placeholder">
            <span className="phase-badge">IN ARRIVO — FASE 3</span>
            <h2 style={{ margin: '6px 0 0', color: 'var(--text-primary)', fontSize: 18 }}>
              Performance FX &amp; 4-Bus Mixer
            </h2>
            <p style={{ maxWidth: 380, margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              Slider verticali multi-touch (Filter, Stutter, Pitch, Dub Delay, Reverb, Bitcrush...)
              con HOLD, Resample e Mixer a 4 Bus + Master.
            </p>
          </div>
        )}
      </main>

      <WorkshopQRModal />

      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default App;
