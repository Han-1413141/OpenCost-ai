import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import type { HarnessDetection } from './model.js';

export function detectHarnesses(env = process.env, home = homedir()): HarnessDetection[] {
  const paths = (env.PATH ?? env.Path ?? '').split(delimiter);
  const globalRoots = [...paths, join(home, 'AppData', 'Roaming', 'npm')];
  const find = (name: string) =>
    paths
      .map((p) => join(p, name + (process.platform === 'win32' ? '.exe' : '')))
      .find(existsSync) ?? null;
  const native = (relative: string) =>
    globalRoots.map((p) => join(p, 'node_modules', relative)).find(existsSync) ?? null;
  const node = find('node');
  const dsh = native('@deepseek-ai/dsh/lib/bin.js');
  return [
    {
      id: 'codex',
      label: 'Codex',
      executable: find('codex'),
      args: [],
      source: join(env.CODEX_HOME ?? join(home, '.codex'), 'sessions'),
    },
    {
      id: 'claude',
      label: 'Claude Code',
      executable: find('claude') ?? native('@anthropic-ai/claude-code/bin/claude.exe'),
      args: [],
      source: join(home, '.claude', 'projects'),
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      executable: find('opencode') ?? native('opencode-ai/bin/opencode.exe'),
      args: [],
      source: join(home, '.local', 'share', 'opencode'),
    },
    {
      id: 'dsh',
      label: 'DSH',
      executable: dsh && node ? node : null,
      args: dsh ? [dsh] : [],
      source: join(env.DSH_HOME ?? join(home, '.dsh'), 'sessions'),
    },
  ].map((h) => ({ ...h, id: h.id as HarnessDetection['id'], available: !!h.executable }));
}

export function harnessCommand(h: HarnessDetection, schemaFile: string, outputFile: string) {
  if (!h.available || !h.executable)
    throw new Error('未检测到可调用的本地 CLI，请先安装或登录所选 Harness');
  if (h.id === 'dsh') throw new Error('DSH 当前只用作日志来源；请选择另一个 Harness 整理摘要');
  const args = [...h.args];
  const env = { ...process.env };
  if (h.id === 'codex') {
    args.push('exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only');
    // Read-only shell sandboxing does not disable hooks, connectors or delegation.
    // Scope these overrides to this invocation; unsupported flags stop the CLI.
    for (const feature of [
      'shell_tool',
      'unified_exec',
      'hooks',
      'apps',
      'plugins',
      'remote_plugin',
      'multi_agent',
      'multi_agent_v2',
      'browser_use',
      'browser_use_external',
      'browser_use_full_cdp_access',
      'computer_use',
      'image_generation',
      'view_image',
      'code_mode_host',
      'goals',
    ])
      args.push('--disable', feature);
    args.push('-c', 'web_search="disabled"');
    let config = '';
    try {
      config = readFileSync(
        join(env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'),
        'utf8',
      );
    } catch {}
    args.push('-c', disabledMcpOverride(config));
    args.push('--output-schema', schemaFile, '--output-last-message', outputFile, '--json', '-');
  }
  if (h.id === 'claude')
    args.push(
      '-p',
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--settings',
      '{"disableAllHooks":true}',
      '--no-session-persistence',
      '--output-format',
      'json',
    );
  if (h.id === 'opencode') {
    args.push('run', '--pure', '--format', 'json');
    env.OPENCODE_PERMISSION = '{"*":"deny"}';
  }
  return { executable: h.executable, args, env };
}

export function disabledMcpOverride(config: string) {
  const names = [
    ...config.matchAll(/^\s*\[mcp_servers\.(?:"([^"\r\n]+)"|([a-zA-Z0-9_-]+))\]\s*(?:#.*)?$/gm),
  ].map((match) => match[1] ?? match[2]);
  // CLI dotted-key overrides treat quotes as literal key characters. Put quoted
  // names inside the TOML value instead, preserving each existing transport.
  return `mcp_servers={${[...new Set(names)].map((name) => `${JSON.stringify(name)}={enabled=false}`).join(',')}}`;
}
