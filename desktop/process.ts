import { spawn, execFile } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// Only fixed, non-provider messages belong on this error. Raw output stays in memory.
export class ProcessExecutionError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number | null,
  ) {
    super(message);
  }
}
const running = new Map<ReturnType<typeof spawn>, () => void>();
export function stopProcesses() {
  for (const cancel of running.values()) cancel();
}
export function runProcess(
  executable: string,
  args: string[],
  input: string,
  cwd: string,
  env = process.env,
  timeoutMs = 120000,
  observeStdout?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const cancellation = () =>
    new ProcessExecutionError('调用已取消，已请求停止；已报告的用量仍会保留');
  if (signal?.aborted) return Promise.reject(cancellation());
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      size = 0,
      failure: Error | null = null;
    const decoder = new StringDecoder('utf8');
    const append = (text: string) => {
      output += text;
      try {
        observeStdout?.(text);
      } catch {
        failure ??= new ProcessExecutionError('本地调用输出无法处理，已请求停止');
        stop();
      }
    };
    let stopping = false,
      closed = false,
      forceTimer: ReturnType<typeof setTimeout> | undefined;
    const forceStop = () => {
      // Use the owned child handle, never a later lookup by PID. The OS may
      // still refuse termination; only close proves this child has finished.
      if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    const stop = () => {
      // close can lag behind exit when inherited pipes are still open. Never
      // invoke a PID-based tree stop after this child has already exited.
      if (stopping || closed || child.exitCode !== null || child.signalCode !== null) return;
      stopping = true;
      forceTimer = setTimeout(forceStop, 1000);
      forceTimer.unref();
      if (process.platform === 'win32' && child.pid)
        execFile(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          (error) => {
            if (error) forceStop();
          },
        );
      else child.kill();
    };
    const cancel = () => {
      failure ??= cancellation();
      stop();
    };
    running.set(child, cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => {
      failure ??= new ProcessExecutionError('调用超过时间限制，已请求停止；可能已消耗部分额度');
      stop();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      const remaining = Math.max(0, 1024 * 1024 - size);
      size += chunk.length;
      if (remaining) append(decoder.write(chunk.subarray(0, remaining)));
      if (size > 1024 * 1024) {
        failure ??= new ProcessExecutionError('调用输出超过上限，已停止，不保存原文');
        stop();
      }
    });
    child.stderr.on('data', () => {}); // Provider output can contain private context: never persist it.
    child.stdin.on('error', () => {});
    child.on('error', () => {
      failure ??= new ProcessExecutionError('本地 Harness 无法启动，请检查安装和登录状态');
    });
    child.on('close', (code) => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      running.delete(child);
      append(decoder.end());
      signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new ProcessExecutionError(
            `Harness 调用未完成（退出码 ${code}）。请在原环境检查登录、套餐和配置；不会上传失败输出。`,
            code,
          ),
        );
      else accept(output);
    });
    child.stdin.end(input);
  });
}
