import React, { useEffect } from 'react';
import { useStore } from './state/useStore';
import { audioEngine } from './audio/AudioEngine';
import { TopBar } from './ui/components/TopBar';
import { LowLatencyBanner } from './ui/components/LowLatencyBanner';
import { TabBar } from './ui/components/TabBar';
import { SampleView } from './ui/views/SampleView';
import { SequenceView } from './ui/views/SequenceView';
import { PerformView } from './ui/views/PerformView';
import { WorkshopQRModal } from './ui/components/WorkshopQRModal';
import { YouTubeFloatingPlayer } from './ui/components/YouTubeFloatingPlayer';

export const App: React.FC = () => {
  const initApp = useStore((s) => s.initApp);
  const activeTab = useStore((s) => s.activeTab);
  const toastMessage = useStore((s) => s.toastMessage);
  const floatingYouTube = useStore((s) => s.floatingYouTube);
  const setFloatingYouTube = useStore((s) => s.setFloatingYouTube);
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

        {activeTab === 'perform' && <PerformView />}
      </main>

      <WorkshopQRModal />

      {floatingYouTube && (
        <YouTubeFloatingPlayer
          video={floatingYouTube}
          onClose={() => setFloatingYouTube(null)}
        />
      )}

      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default App;
