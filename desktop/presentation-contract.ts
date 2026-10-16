import type { ControllerDeps } from './controller.js';
import type { HarnessDetection } from './model.js';
import type { DesktopStore } from './store.js';

export type JournalPresentation = {
  endpoint: string;
  deps: Pick<ControllerDeps, 'origin' | 'collect' | 'generate' | 'upload' | 'feedback' | 'accessKey'>;
  harnesses: HarnessDetection[];
  close(): Promise<void>;
};
export type PresentationModule = {
  createJournalPresentation(directory: string, store: DesktopStore): Promise<JournalPresentation>;
};
