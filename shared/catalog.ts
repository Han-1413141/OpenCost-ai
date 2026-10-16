export const modelNames: Record<string, string> = {
  'deepseek-v3.2': 'DeepSeek V3.2',
  'qwen3-coder': 'Qwen3 Coder',
  'kimi-k2': 'Kimi K2',
  'glm-4.5': 'GLM 4.5',
  'gpt-5': 'GPT-5',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
};
export const harnessNames: Record<string, string> = {
  opencode: 'OpenCode',
  dsh: 'DeepSeek Harness',
  codex: 'Codex CLI',
  'claude-code': 'Claude Code',
  aider: 'Aider',
  cursor: 'Cursor',
  cline: 'Cline',
  'custom-harness': '自定义 Harness',
};
export const colors: Record<string, string> = {
  'deepseek-v3.2': '#3975d9',
  'qwen3-coder': '#8769c1',
  'kimi-k2': '#2c696b',
  'glm-4.5': '#469b75',
  'gpt-5': '#363b42',
  'claude-sonnet-4-5': '#c67859',
};
export const nameModel = (id: string) => modelNames[id] ?? id;
export const nameHarness = (id: string) => harnessNames[id] ?? id;
