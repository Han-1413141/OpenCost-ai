import { useState } from 'react';
import { DeferredPanel } from './DeferredPanel.js';
import type { JournalAnalysisAttachment, JournalTaskAnalysis } from './journal-analysis-schema.js';
const load = () =>
  import('./JournalTaskAnalysisView.js').then((m) => ({ default: m.JournalAnalysisPanel }));
export function JournalAnalysisEntry(props: {
  summaryId: string;
  sourceRefs: string[];
  analysis?: JournalTaskAnalysis;
  onRead?: () => Promise<JournalTaskAnalysis | null>;
  onApply: (attachment: JournalAnalysisAttachment) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState(props.analysis),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return open ? (
    <DeferredPanel
      load={load}
      panelProps={{ ...props, analysis, onClose: () => setOpen(false) }}
      title="任务分析"
      onCancel={() => setOpen(false)}
    />
  ) : (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            if (props.onRead) setAnalysis((await props.onRead()) ?? undefined);
            setOpen(true);
          } catch {
            setError('分析读取失败，请稍后再试');
          } finally {
            setBusy(false);
          }
        }}
      >
        任务、难度与代码分析
      </button>
      {error && <p role="status">{error}</p>}
    </>
  );
}
