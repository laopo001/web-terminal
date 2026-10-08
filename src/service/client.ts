import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readdir, access } from 'node:fs/promises';
import { serviceName } from '../shared/service.ts';
import { isLocalServer, probeService } from './probe.ts';

export type ServiceRuntime = 'auto' | 'native' | 'wsl';
export interface ClientServiceOptions { runtime?: ServiceRuntime; cliPath?: string; allowStart?: boolean }
const execute = promisify(execFile);
interface Launcher { file: string; prefix: string[]; command?: string }
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export class ServiceNotInstalledError extends Error {
  constructor(public readonly installCommand: string, detail = '') {
    super(`未找到本项目的 Web Terminal CLI。请在服务运行机器执行 ${installCommand}，安装后重试。${detail ? `\n${detail}` : ''}`);
  }
}

async function invoke(launcher: Launcher, args: string[], timeout = 25000) {
  const parameters = launcher.command ? [...launcher.prefix, `& ${[launcher.command, ...args].map(psQuote).join(' ')}`] : [...launcher.prefix, ...args];
  const result = await execute(launcher.file, parameters, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

function nativeLauncher(command: string): Launcher {
  if (process.platform === 'win32') return {
    file: 'powershell.exe', command, prefix: ['-NoProfile', '-NonInteractive', '-Command'],
  };
  return { file: command, prefix: [] };
}

async function findLauncher(options: ClientServiceOptions): Promise<Launcher> {
  const runtime = process.platform === 'win32' ? options.runtime || 'auto' : 'native';
  const candidates: Launcher[] = [];
  if (runtime !== 'wsl') {
    if (options.cliPath?.trim()) candidates.push(nativeLauncher(options.cliPath.trim()));
    else {
      candidates.push(nativeLauncher('web-terminal'));
      if (process.platform !== 'win32') {
        for (const command of [join(dirname(process.execPath), 'web-terminal'), join(homedir(), '.local/share/pnpm/web-terminal'), join(homedir(), '.npm-global/bin/web-terminal')]) candidates.push(nativeLauncher(command));
        // GUI 扩展宿主的 PATH 不一定包含 nvm 的全局 bin。
        const versions = join(homedir(), '.nvm/versions/node');
        for (const version of (await readdir(versions).catch(() => [])).sort().reverse()) {
          const directory = join(versions, version, 'bin');
          const command = join(directory, 'web-terminal');
          try { await access(command); candidates.push({ file: join(directory, 'node'), prefix: [command] }); } catch {}
        }
      }
    }
  }
  if (process.platform === 'win32' && runtime !== 'native' && !options.cliPath?.trim()) {
    candidates.push({ file: 'wsl.exe', prefix: ['--exec', 'bash', '-lc', 'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; export PATH="$HOME/.local/share/pnpm:$PATH"; exec "$@"', 'web-terminal-client', 'web-terminal'] });
  }
  for (const candidate of candidates) {
    try {
      const info = JSON.parse(await invoke(candidate, ['--version'], 8000));
      if (info.service === serviceName && typeof info.version === 'string') return candidate;
    } catch {}
  }
  const wsl = runtime === 'wsl' || (process.platform === 'win32' && runtime === 'auto');
  throw new ServiceNotInstalledError(wsl ? `wsl.exe --exec bash -lc 'npm install -g ${serviceName}'` : `npm install -g ${serviceName}`, options.cliPath ? `请检查 CLI 路径：${options.cliPath}` : '本地开发可先在项目目录执行 npm link。');
}

const operations = new Map<string, Promise<void>>();

export async function ensureService(url: string, options: ClientServiceOptions = {}, action: 'start' | 'restart' = 'start'): Promise<void> {
  // 同一客户端的侧栏、编辑器并发打开时共用一次检测/启动。
  const previous = operations.get(url);
  if (previous) {
    await previous;
    if (action === 'start') return;
  }
  const operation = (async () => {
    const status = await probeService(url);
    if (status.kind === 'conflict' || status.kind === 'incompatible') throw new Error(status.message);
    if (action === 'start' && status.kind === 'ready') return;
    if (!isLocalServer(url)) throw new Error(status.kind === 'stopped' ? '远程服务未启动，请在服务所在机器启动 Web Terminal。' : status.kind === 'ready' ? '远程地址仅支持连接；请在服务所在机器重启。' : status.message);
    if (action === 'start' && status.kind === 'unreachable') throw new Error(status.message);
    if (options.allowStart === false) throw new Error('请先信任此 VS Code 工作区，再启动或重启本机 Web Terminal 服务。');
    const launcher = await findLauncher(options);
    try { await invoke(launcher, [action, '--url', url]); }
    catch (error) { throw new Error(`Web Terminal ${action === 'restart' ? '重启' : '启动'}失败：${(error as { stderr?: string }).stderr?.trim() || (error instanceof Error ? error.message : String(error))}`); }
    const ready = await probeService(url);
    if (ready.kind !== 'ready') throw new Error(ready.kind === 'stopped' ? '命令已结束，但后台服务没有启动，请查看服务日志。' : ready.message);
  })();
  operations.set(url, operation);
  try { await operation; } finally { if (operations.get(url) === operation) operations.delete(url); }
}
