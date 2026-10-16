import { useState } from 'react';
import { DeferredPanel } from './DeferredPanel.js';
import { QuotaReplayClosed } from './QuotaReplayShell.js';
import type { PersonalFeedback } from './personal-feedback.js';

const loadFeedback = () =>
  import('./FeedbackPanel.js').then((module) => ({ default: module.FeedbackPanel }));
const loadPersona = () =>
  import('./FeedbackPersona.js').then((m) => ({ default: m.FeedbackPersona }));
export function DeferredPersonaPanel({ report }: { report: PersonalFeedback }) {
  return (
    <div className="personal-feedback vbti-private-result">
      <DeferredPanel load={loadPersona} panelProps={{ report }} title="VBTI 类型结果" />
    </div>
  );
}
const loadQuota = () =>
  import('./QuotaReplayPanel.js').then((module) => ({ default: module.QuotaReplayPanel }));

export function DeferredFeedbackPanel({
  report,
  relatedQuota,
}: {
  report: PersonalFeedback;
  relatedQuota?: PersonalFeedback['quota'];
}) {
  return (
    <DeferredPanel load={loadFeedback} panelProps={{ report, relatedQuota }} title="个人反馈" />
  );
}

/** No module load, worker, file read or calculation until the user explicitly opens the panel. */
export function QuotaReplayEntry() {
  const [enabled, setEnabled] = useState(false);
  const close = () => setEnabled(false);
  return enabled ? (
    <DeferredPanel
      load={loadQuota}
      panelProps={{ initiallyEnabled: true, onClose: close }}
      title="本地额度回放"
      onCancel={close}
    />
  ) : (
    <QuotaReplayClosed onEnable={() => setEnabled(true)} />
  );
}
