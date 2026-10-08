import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** PID 会复用；保存操作系统的进程启动标识，停止前再次校验。 */
export async function processStamp(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (fields[0] === 'Z') return undefined;
      return `${(await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()}:${fields[19]}`;
    }
    if (process.platform === 'win32') {
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CreationDate.ToUniversalTime().Ticks`], { timeout: 5000, windowsHide: true });
      return stdout.trim() || undefined;
    }
    const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 5000 });
    return stdout.trim() || undefined;
  } catch { return undefined; }
}

export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function stopProcess(pid: number, stamp: string): Promise<void> {
  if (await processStamp(pid) !== stamp) return;
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await processStamp(pid) !== stamp) return;
    await delay(100);
  }
  if (await processStamp(pid) === stamp) process.kill(pid, 'SIGKILL');
  const forcedDeadline = Date.now() + 3000;
  while (Date.now() < forcedDeadline) {
    if (await processStamp(pid) !== stamp) return;
    await delay(100);
  }
  throw new Error('后台进程未能退出，请查看服务日志');
}
