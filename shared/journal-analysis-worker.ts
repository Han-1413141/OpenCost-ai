import { createJournalAnalysisProcessor } from './journal-analysis.js';
const process = createJournalAnalysisProcessor();
// No queue: at most one in-flight input. Closing the panel terminates this worker.
let busy = false;
self.onmessage = async (event: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = event.data;
  if (busy) {
    self.postMessage({ id, status: 'invalid' });
    return;
  }
  busy = true;
  try {
    self.postMessage({ id, status: 'ready', ...(await process(text)) });
  } catch {
    self.postMessage({
      id,
      status: 'invalid',
      message: '分析文件校验失败。请核对任务、要求修订、报告版本和容量；未保存原始内容。',
    });
  } finally {
    busy = false;
  }
};
