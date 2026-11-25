import React from 'react';
import { Grid3X3, ListMusic, Sliders } from 'lucide-react';
import { useStore } from '../../state/useStore';
import { TabId } from '../../state/types';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'sample', label: 'SAMPLE', icon: <Grid3X3 size={14} /> },
  { id: 'sequence', label: 'SEQUENCE', icon: <ListMusic size={14} /> },
  { id: 'perform', label: 'PERFORM', icon: <Sliders size={14} /> },
];

export const TabBar: React.FC = () => {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  return (
    <nav className="tab-bar" aria-label="Main Sampler Views">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
          onClick={() => setActiveTab(t.id)}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
};
