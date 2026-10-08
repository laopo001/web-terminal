import { mkdir, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { isLocalServer, probeService } from './probe.ts';
import { delay, processStamp, stopProcess } from './process.ts';

export interface ManagedState { pid: number; stamp: string; instanceId: string; url: string; config?: string }
export interface ManageOptions { url: string; entry: string; home?: string; config?: string }

export function servicePaths(url: string, home = process.env.WEB_TERMINAL_HOME || join(homedir(), '.web-terminal')) {
  if (!isLocalServer(url)) throw new Error('只能管理本机 HTTP 服务；远程地址请在服务器所在机器运行 web-terminal');
  const base = resolve(home);
  const directory = join(base, 'servers', new URL(url).port || '80');
  return { base, directory, state: join(directory, 'server.yaml'), log: join(directory, 'server.log'), config: join(base, 'config.yaml'), lock: join(directory, 'manager.lock') };
}

export async function readState(file: string): Promise<ManagedState | undefined> {
  try {
    const state = parse(await readFile(file, 'utf8'));
    if (Number.isSafeInteger(state?.pid) && state.pid > 0 && typeof state.stamp === 'string' && typeof state.instanceId === 'string' && typeof state.url === 'string') return state;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return undefined;
}

export async function writeState(file: string, state: ManagedState) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, stringify(state), { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

export async function manageService(action: 'start' | 'restart' | 'stop', options: ManageOptions) {
  const paths = servicePaths(options.url, options.home);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const owner = { pid: process.pid, stamp: await processStamp(process.pid) };
  if (!owner.stamp) throw new Error('无法校验当前进程，不能安全管理后台服务');
  const deadline = Date.now() + 20000;
  for (;;) {
    try { await writeFile(paths.lock, stringify(owner), { flag: 'wx', mode: 0o600 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const previous = parse(await readFile(paths.lock, 'utf8'));
        if (previous?.stamp && await processStamp(previous.pid) !== previous.stamp) { await rm(paths.lock, { force: true }); continue; }
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; }
      if (Date.now() >= deadline) throw new Error('另一个客户端正在管理服务，请稍后重试');
      await delay(150);
    }
  }
  try {
    let status = await probeService(options.url);
    const state = await readState(paths.state);
    const owned = state && await processStamp(state.pid) === state.stamp;
    if (status.kind === 'conflict' || status.kind === 'incompatible') throw new Error(status.message);
    if (action === 'start' && status.kind === 'ready') return status.identity;
    if (status.kind === 'ready' && (!owned || status.identity.instanceId !== state.instanceId || status.identity.pid !== state.pid)) {
      throw new Error('该 Web Terminal 由其他方式启动，未停止它。请用原来的服务管理器重启（例如 systemctl --user restart web-terminal.service）。');
    }
    if (owned) await stopProcess(state.pid, state.stamp);
    else if (status.kind === 'unreachable') throw new Error(status.message);
    await rm(paths.state, { force: true });
    if (action === 'stop') return undefined;
    status = await probeService(options.url);
    if (status.kind === 'ready') return status.identity;
    if (status.kind !== 'stopped') throw new Error(status.message);
    const log = await open(paths.log, 'a', 0o600);
    let child;
    let failure: Error | undefined;
    let exited = false;
    try {
      const config = options.config ? resolve(options.config) : state?.config;
      child = spawn(process.execPath, [options.entry, 'serve', '--url', options.url, '--home', paths.base, ...(config ? ['--config', config] : [])], {
        detached: true, stdio: ['ignore', log.fd, log.fd], windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      });
      child.once('error', error => { failure = error; });
      child.once('exit', () => { exited = true; });
    } finally { await log.close(); }
    child.unref();
    const started = Date.now();
    while (Date.now() - started < 15000) {
      if (failure || exited) break;
      const current = await probeService(options.url, 500);
      const launched = await readState(paths.state);
      if (current.kind === 'ready' && launched && launched.pid === child.pid && current.identity.instanceId === launched.instanceId) return current.identity;
      if (current.kind === 'conflict' || current.kind === 'incompatible') break;
      await delay(100);
    }
    // 启动超时不留下延迟占用端口的后台进程。
    if (child.pid && !exited) {
      const stamp = await processStamp(child.pid);
      if (stamp) await stopProcess(child.pid, stamp);
    }
    const logReader = await open(paths.log, 'r');
    let output: string;
    try {
      const size = (await logReader.stat()).size;
      const tail = Buffer.alloc(Math.min(size, 4000));
      const { bytesRead } = await logReader.read(tail, 0, tail.length, Math.max(0, size - tail.length));
      output = tail.subarray(0, bytesRead).toString('utf8');
    } finally { await logReader.close(); }
    throw new Error(`后台启动失败：${failure?.message || output || '等待服务就绪超时'}\n日志：${paths.log}`);
  } finally { await rm(paths.lock, { force: true }); }
}
