import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { harnessIds } from '../shared/desktop-summary.js';
import type { DesktopStore } from './store.js';
import type { Binding } from './model.js';
export function newPairToken(store: DesktopStore, now = Date.now()) {
  const token = randomBytes(24).toString('hex');
  store.set('pairing', { token, expires: now + 15 * 60000 });
  return token;
}
export function pairFromArgs(
  store: DesktopStore,
  args: string[],
  now = Date.now(),
): Binding | null {
  const value = (key: string) => {
    const i = args.indexOf(key);
    return i === -1 ? undefined : args[i + 1];
  };
  const token = value('--bind-token');
  if (!token) return null;
  const p = store.get<{ token: string; expires: number }>('pairing');
  if (
    !p ||
    p.expires < now ||
    !/^[a-f0-9]{48}$/.test(token) ||
    !timingSafeEqual(Buffer.from(p.token), Buffer.from(token))
  )
    throw new Error('绑定码已失效，请在应用重新复制绑定提示词');
  const harness = value('--harness'),
    source = value('--source');
  if (
    !harnessIds.includes(harness as any) ||
    !source ||
    !isAbsolute(source) ||
    !statSync(source).isDirectory()
  )
    throw new Error('绑定需要受支持的 Harness 和实际会话日志目录');
  const binding = store.bind(harness as Binding['harness'], resolve(source));
  store.set('pairing', null);
  store.event('binding', '通过一次性提示词绑定环境');
  return binding;
}
export function pairingPrompt(executable: string, token: string) {
  const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";
  return `请把当前常用 Harness 绑定到本机 OpenCost 工作日记。请识别当前 Harness 属于 codex、claude、opencode 或 dsh，找到它的真实会话日志目录（不要选择整个用户目录、项目源码目录、账号配置或账单目录）。OpenCode 可先将会话导出 JSON 到专用目录。只登记来源，不生成摘要、不上传、不改变 Harness 配置。向我展示所选日志目录；取得我的同意后，用 PowerShell 执行：\n& ${q(executable)} --bind-token ${q(token)} --harness '<实际 Harness>' --source '<实际会话日志目录的绝对路径>'\n绑定码 15 分钟有效、仅用一次。多个 Harness 分别在 OpenCost 生成新的绑定提示词。后续读取与模型调用仍由 OpenCost 的单次允许或自动授权控制。`;
}
