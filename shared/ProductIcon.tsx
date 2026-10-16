const assets = {
  openai: new URL('./assets/product-icons/openai.svg', import.meta.url).href,
  claude: new URL('./assets/product-icons/claude-color.svg', import.meta.url).href,
  claudecode: new URL('./assets/product-icons/claudecode-color.svg', import.meta.url).href,
  deepseek: new URL('./assets/product-icons/deepseek-color.svg', import.meta.url).href,
  gemini: new URL('./assets/product-icons/gemini-color.svg', import.meta.url).href,
  qwen: new URL('./assets/product-icons/qwen-color.svg', import.meta.url).href,
  opencode: new URL('./assets/product-icons/opencode.svg', import.meta.url).href,
  cursor: new URL('./assets/product-icons/cursor.svg', import.meta.url).href,
  copilot: new URL('./assets/product-icons/githubcopilot.svg', import.meta.url).href,
  mistral: new URL('./assets/product-icons/mistral-color.svg', import.meta.url).href,
  kimi: new URL('./assets/product-icons/kimi-color.svg', import.meta.url).href,
  glm: new URL('./assets/product-icons/chatglm-color.svg', import.meta.url).href,
};
export function ProductIcon({ id, kind }: { id: string; kind: 'harness' | 'model' }) {
  const key: keyof typeof assets | null =
    kind === 'harness' && ['claude', 'claude-code'].includes(id)
      ? 'claudecode'
      : /^(codex|gpt-|o[134](?:-|$))/.test(id)
        ? 'openai'
        : /^claude/.test(id)
          ? 'claude'
          : /^deepseek/.test(id)
            ? 'deepseek'
            : /^gemini/.test(id)
              ? 'gemini'
              : /^qwen/.test(id)
                ? 'qwen'
                : /^mistral/.test(id)
                  ? 'mistral'
                  : /^kimi/.test(id)
                    ? 'kimi'
                    : /^glm/.test(id)
                      ? 'glm'
                      : id === 'opencode'
                        ? 'opencode'
                        : id === 'cursor'
                          ? 'cursor'
                          : /^(github-copilot|copilot)$/.test(id)
                            ? 'copilot'
                            : null;
  return (
    <span className="vbti-product-icon" aria-hidden="true">
      {key ? (
        <img src={assets[key]} alt="" width="24" height="24" />
      ) : (
        <b>{kind === 'harness' ? 'H' : 'M'}</b>
      )}
    </span>
  );
}
