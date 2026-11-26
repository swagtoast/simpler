import React, { useState } from 'react';
import { Download, Layers, X } from 'lucide-react';
import { useStore } from '../../state/useStore';
import { exportMixWav, exportStemsZip } from '../../audio/OfflineRenderer';
import { t } from '../../i18n/t';

export const ExportModal: React.FC = () => {
  const project = useStore((s) => s.project);
  const activeSequenceId = useStore((s) => s.activeSequenceId);
  const mutedPads = useStore((s) => s.mutedPads);
  const setExportModalOpen = useStore((s) => s.setExportModalOpen);
  const showToast = useStore((s) => s.showToast);

  const [scope, setScope] = useState<'current' | 'song'>('current');
  const [loops, setLoops] = useState<number>(2);
  const [busy, setBusy] = useState(false);

  const activeSeq =
    project.sequences.find((s) => s.id === activeSequenceId) ?? project.sequences[0];
  const nonEmptySeqs = project.sequences.filter((s) => s.notes.length > 0);
  const targetSequences =
    scope === 'song' && nonEmptySeqs.length > 0 ? nonEmptySeqs : activeSeq ? [activeSeq] : [];

  const totalNotes = targetSequences.reduce((acc, s) => acc + s.notes.length, 0);
  const totalBars = targetSequences.reduce((acc, s) => acc + s.bars, 0) * loops;
  const estSeconds = ((totalBars * 4) / (project.bpm || 92)) * 60;

  const handleExportWav = async () => {
    if (totalNotes === 0) {
      showToast(t('exportNeedNotes'));
      return;
    }
    setBusy(true);
    try {
      const slug =
        scope === 'song'
          ? `simpler-beat-${Math.round(project.bpm)}bpm.wav`
          : `simpler-${activeSeq.name.toLowerCase().replace(/\s+/g, '-')}-${Math.round(project.bpm)}bpm.wav`;
      await exportMixWav(project, targetSequences, loops, mutedPads, slug);
      showToast(t('exportedToast', { file: slug }));
      setExportModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('exportWavError'));
    } finally {
      setBusy(false);
    }
  };

  const handleExportStems = async () => {
    if (totalNotes === 0) {
      showToast(t('exportNeedNotes'));
      return;
    }
    setBusy(true);
    try {
      const slug = `simpler-stems-${Math.round(project.bpm)}bpm.zip`;
      const count = await exportStemsZip(project, targetSequences, loops, slug);
      showToast(t('exportedStemsToast', { count, file: slug }));
      setExportModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('exportStemsError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && setExportModalOpen(false)}>
      <div className="modal-card" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">{t('exportTitle')}</h2>
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={() => setExportModalOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {t('exportScopeLabel')}
            </div>
            <div className="toggle-row">
              <button
                type="button"
                className={`toggle-chip ${scope === 'current' ? 'on' : ''}`}
                onClick={() => setScope('current')}
              >
                {t('exportOnlySeq', { name: activeSeq?.name ?? 'Seq 1', count: activeSeq?.notes.length ?? 0 })}
              </button>
              <button
                type="button"
                className={`toggle-chip ${scope === 'song' ? 'on' : ''}`}
                disabled={nonEmptySeqs.length === 0}
                onClick={() => setScope('song')}
              >
                {t('exportFullSong', { count: nonEmptySeqs.length })}
              </button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {t('exportLoopsLabel')}
            </div>
            <div className="toggle-row">
              {[1, 2, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`toggle-chip ${loops === n ? 'on' : ''}`}
                  onClick={() => setLoops(n)}
                >
                  {n}× ({Math.round(((targetSequences.reduce((a, s) => a + s.bars, 0) * n * 4) / (project.bpm || 92)) * 60)}s)
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              padding: '8px 10px',
              borderRadius: 6,
            }}
          >
            {totalNotes > 0
              ? t('exportEstDur', { sec: estSeconds.toFixed(1) })
              : t('exportNoNotes')}
          </div>

          <button
            type="button"
            className="primary-cta"
            disabled={busy || totalNotes === 0}
            onClick={() => void handleExportWav()}
          >
            <Download size={16} />
            <span>{busy ? t('exportRendering') : t('exportDownloadWav')}</span>
          </button>

          <button
            type="button"
            className="menu-row-btn"
            style={{ justifyContent: 'center' }}
            disabled={busy || totalNotes === 0}
            onClick={() => void handleExportStems()}
          >
            <Layers size={15} />
            <span>{t('exportDownloadStems')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
