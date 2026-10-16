import { z } from 'zod';
// Exact public IDs only. Private deployment aliases and free text never enter journals.
export const PublicJournalModelSchema = z.enum([
  'gpt-5',
  'gpt-5-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
  'gpt-6-sol',
  'gpt-6-astra',
  'gpt-6.1-sol',
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v3',
  'deepseek-v3.1',
  'deepseek-v3.2',
  'qwen3-coder',
  'kimi-k2',
  'kimi-k2.5',
  'glm-4.5',
  'glm-4.6',
  'glm-4.7',
  'glm-5',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
]);
export function publicJournalModel(value: unknown) {
  const result = PublicJournalModelSchema.safeParse(value);
  return result.success ? result.data : null;
}
