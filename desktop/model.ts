import { z } from 'zod';
import type { PersonalFeedback } from '../shared/personal-feedback.js';
import {
  harnessIds,
  type DailySummary,
  type ProcessingAttempt,
} from '../shared/desktop-summary.js';

export const SourceAuthorizationSchema = z
  .object({
    version: z.literal('source-root-1'),
    realPath: z.string().min(1).max(4096),
    device: z.string().regex(/^\d+$/),
    inode: z.string().regex(/^\d+$/),
  })
  .strict();
export type SourceAuthorization = z.infer<typeof SourceAuthorizationSchema>;

export const BindingSchema = z
  .object({
    id: z.string().uuid(),
    harness: z.enum(harnessIds),
    source: z.string().min(1).max(4096),
    enabled: z.boolean(),
    createdAt: z.string().datetime(),
    // Older bindings remain readable, but cannot authorize collection until rebound.
    authorization: SourceAuthorizationSchema.optional(),
    authorizationRevokedAt: z.string().datetime().optional(),
  })
  .strict();
export type Binding = z.infer<typeof BindingSchema>;
export const SettingsSchema = z
  .object({
    dailyTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('17:30'),
    reminderEnabled: z.boolean().default(true),
    generationMode: z.enum(['ask', 'automatic']).default('ask'),
    uploadMode: z.enum(['ask', 'automatic']).default('ask'),
    engine: z.enum(harnessIds).default('codex'),
    endpoint: z.string().max(2048).default(''),
    startAtLogin: z.boolean().default(false),
    introduced: z.boolean().default(false),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;
export type HarnessDetection = {
  id: (typeof harnessIds)[number];
  label: string;
  available: boolean;
  source: string;
  executable: string | null;
  args: string[];
};
export type Request = {
  id: string;
  kind: 'generate' | 'upload';
  day: string;
  bindings: number;
  summaryId?: string;
  scopeDigest: string;
  engine: string;
  endpoint: string;
};
export type Snapshot = {
  settings: Settings;
  bindings: Binding[];
  harnesses: HarnessDetection[];
  summaries: DailySummary[];
  uploaded: string[];
  pending: Request | null;
  busy: boolean;
  message: string;
  pairPrompt: string;
  storageBytes: number;
  attempts: ProcessingAttempt[];
  feedback?: PersonalFeedback | null;
  feedbackHistory?: PersonalFeedback[];
};
export type DesktopBridge = {
  snapshot(): Promise<Snapshot>;
  invoke(command: string, data?: unknown): Promise<unknown>;
  subscribe(listener: () => void): () => void;
};
declare global {
  interface Window {
    opencost: DesktopBridge;
  }
}
