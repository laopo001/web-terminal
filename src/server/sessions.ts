import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { readlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import * as pty from 'node-pty';
import type { WebSocket } from 'ws';
import type { Config } from './config.ts';
import type { SessionInfo, ServerMessage } from '../shared/protocol.ts';
import { Files, HttpError } from './files.ts';

interface Session {
  info: SessionInfo; process?: pty.IPty; clients: Set<WebSocket>; history: string[]; historySize: number;
}
export function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState !== 1) return;
  if (ws.bufferedAmount > 4 * 1024 * 1024) { ws.close(1013, '终端输出过快，请重新连接'); return; }
  ws.send(JSON.stringify(message));
}
export class Sessions {
  private entries = new Map<string, Session>();
  private shuttingDown = false;
  constructor(private config: Config, private files: Files) {
    const saved = join(config.dataDir, 'sessions.yaml');
    if (existsSync(saved)) {
      const records = parse(readFileSync(saved, 'utf8'));
      if (!Array.isArray(records)) throw new Error('sessions.yaml 格式无效');
      for (const record of records as SessionInfo[]) {
        if (!/^[a-f0-9-]{36}$/.test(record.id)) continue;
        const { id, name, cwd, createdAt } = record;
        const info: SessionInfo = { id, name, cwd, createdAt, running: false };
        this.entries.set(info.id, { info, clients: new Set(), history: [], historySize: 0 });
      }
    }
  }
  private save() {
    const file = join(this.config.dataDir, 'sessions.yaml');
    writeFileSync(`${file}.tmp`, stringify([...this.entries.values()].map(s => s.info)), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  get(id: string) {
    const session = this.entries.get(id);
    if (!session) throw new HttpError(404, '会话不存在');
    return session;
  }
  async current(id: string) {
    const session = this.get(id);
    if (session.info.running) {
      try {
        session.info.cwd = await readlink(`/proc/${session.process!.pid}/cwd`);
        session.info.processName = session.process?.process;
      } catch { /* 会话结束和目录删除时使用最后已知目录 */ }
    }
    return { ...session.info };
  }
  async list() { return Promise.all([...this.entries.keys()].map(id => this.current(id))); }
  async create(name?: unknown, cwd?: unknown) {
    if (this.entries.size >= 32) throw new HttpError(409, '最多保留 32 个会话，请结束不需要的会话');
    if (name !== undefined && (typeof name !== 'string' || name.length > 80)) throw new HttpError(400, '会话名称最多 80 字符');
    if (cwd !== undefined && typeof cwd !== 'string') throw new HttpError(400, '工作目录无效');
    const dir = await this.files.directory((cwd as string) || this.config.defaultCwd);
    const id = randomUUID();
    const info: SessionInfo = { id, name: (name as string)?.trim() || `终端 ${this.entries.size + 1}`, cwd: dir, createdAt: new Date().toISOString(), running: true };
    const session: Session = { info, clients: new Set(), history: [], historySize: 0 };
    try {
      this.entries.set(id, session);
      this.ensureProcess(session);
    } catch (error) {
      this.entries.delete(id);
      throw error;
    }
    this.save();
    return info;
  }
  private spawnTerminal(command: string, args: string[], cwd: string, cols: number, rows: number) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !['WEB_TERMINAL_TOKEN', 'TMUX', 'TMUX_PANE'].includes(key)) env[key] = value;
    env.TERM = 'xterm-256color'; env.COLORTERM = 'truecolor';
    return pty.spawn(command, args, { name: 'xterm-256color', cols, rows, cwd, env });
  }
  private dimensions(cols: number, rows: number) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) throw new HttpError(400, '终端尺寸无效');
    return { cols: Math.min(500, cols), rows: Math.min(300, rows) };
  }
  private ensureProcess(session: Session) {
    if (session.process || !session.info.running) return;
    const terminalProcess = this.spawnTerminal(this.config.shell, ['-l'], session.info.cwd, 100, 30);
    session.process = terminalProcess;
    terminalProcess.onData(data => {
      session.history.push(data); session.historySize += data.length;
      while (session.historySize > 2 * 1024 * 1024 && session.history.length > 1) session.historySize -= session.history.shift()!.length;
      for (const ws of session.clients) send(ws, { type: 'output', data });
    });
    terminalProcess.onExit(({ exitCode }) => {
      session.process = undefined;
      if (this.shuttingDown) return;
      session.info.running = false;
      this.save();
      for (const ws of session.clients) { send(ws, { type: 'exit', exitCode }); ws.close(1000, '会话已结束'); }
      session.clients.clear();
    });
  }
  attach(id: string, ws: WebSocket, cols: number, rows: number) {
    const session = this.get(id);
    if (!session.info.running) throw new HttpError(409, '会话已结束，请新建终端');
    const size = this.dimensions(cols, rows);
    this.ensureProcess(session);
    send(ws, { type: 'replay', data: session.history.join('') });
    session.process?.resize(size.cols, size.rows);
    ws.once('close', () => session.clients.delete(ws));
    session.clients.add(ws);
    send(ws, { type: 'ready', session: session.info });
  }
  input(id: string, ws: WebSocket, data: string) {
    const session = this.get(id);
    if (session.clients.has(ws)) session.process?.write(data);
  }
  resize(id: string, ws: WebSocket, cols: number, rows: number) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return;
    const size = this.dimensions(cols, rows);
    const session = this.get(id);
    if (!session.clients.has(ws)) return;
    const process = session.process;
    if (process && (process.cols !== size.cols || process.rows !== size.rows)) process.resize(size.cols, size.rows);
  }
  async remove(id: string) {
    const session = this.get(id);
    session.process?.kill();
    for (const ws of session.clients) ws.close(1000, '会话已结束');
    this.entries.delete(id); this.save();
    await rm(join(this.config.dataDir, 'uploads', id), { recursive: true, force: true });
  }
  shutdown() {
    this.shuttingDown = true; this.save();
    for (const session of this.entries.values()) {
      for (const ws of session.clients) ws.close(1012, '服务重启中');
      session.process?.kill();
    }
  }
}
