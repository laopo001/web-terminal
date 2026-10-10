import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import * as pty from 'node-pty';
import type { WebSocket } from 'ws';
import type { Config } from './config.ts';
import type { SessionInfo, ServerMessage } from '../shared/protocol.ts';
import { pasteText } from '../shared/terminalInput.ts';
import { foregroundInfo } from './processInfo.ts';
import { TerminalScreen } from './terminalScreen.ts';
import { Files, HttpError } from './files.ts';

interface Session {
  info: SessionInfo; process?: pty.IPty; clients: Map<WebSocket, { cols: number; rows: number }>; controller?: WebSocket; screen: TerminalScreen; pendingBytes: number;
  activityTimer?: ReturnType<typeof setTimeout>;
}
export function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState !== 1) return;
  if (ws.bufferedAmount > 4 * 1024 * 1024) { ws.close(1013, '终端输出过快，请重新连接'); return; }
  ws.send(JSON.stringify(message));
}
export class Sessions {
  private entries = new Map<string, Session>();
  private shuttingDown = false;
  private watchers = new Set<WebSocket>();
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  constructor(private config: Config, private files: Files) {
    const saved = join(config.dataDir, 'sessions.yaml');
    if (existsSync(saved)) {
      const records = parse(readFileSync(saved, 'utf8'));
      if (!Array.isArray(records)) throw new Error('sessions.yaml 格式无效');
      for (const record of records as SessionInfo[]) {
        if (!/^[a-f0-9-]{36}$/.test(record.id)) continue;
        const { id, name, cwd, createdAt } = record;
        const info: SessionInfo = { id, name, cwd, createdAt, running: false, outputActive: false };
        this.entries.set(info.id, this.makeSession(info));
      }
    }
  }
  private makeSession(info: SessionInfo): Session {
    const session: Session = { info, clients: new Map(), pendingBytes: 0, screen: new TerminalScreen(
      title => { if (info.title !== title) { info.title = title; this.publish(); } }, data => session.process?.write(data),
      progress => {
        if (info.progress?.state === progress?.state && info.progress?.value === progress?.value) return;
        info.progress = progress; this.publish();
      }) };
    return session;
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
        const foreground = await foregroundInfo(session.process!.pid, session.process!.process);
        if (foreground.cwd) session.info.cwd = foreground.cwd;
        session.info.processName = foreground.processName;
      } catch { /* 会话结束和目录删除时使用最后已知目录 */ }
    }
    return { ...session.info };
  }
  async list() { return Promise.all([...this.entries.keys()].map(id => this.current(id))); }
  private publish(ws?: WebSocket) {
    const message: ServerMessage = { type: 'sessions', sessions: [...this.entries.values()].map(session => ({ ...session.info })) };
    if (ws) send(ws, message);
    else for (const watcher of this.watchers) send(watcher, message);
  }
  watch(ws: WebSocket) {
    this.watchers.add(ws);
    this.publish(ws);
    ws.once('close', () => {
      this.watchers.delete(ws);
      if (!this.watchers.size) { clearInterval(this.refreshTimer); this.refreshTimer = undefined; }
    });
    if (!this.refreshTimer) this.refreshTimer = setInterval(() => void this.refresh(), 5000);
    void this.refresh();
  }
  private async refresh() {
    if (this.refreshing || this.shuttingDown) return;
    this.refreshing = true;
    try { await this.list(); if (!this.shuttingDown) this.publish(); }
    catch (error) { console.error('会话状态更新失败', error); }
    finally { this.refreshing = false; }
  }
  private stopActivity(session: Session) {
    clearTimeout(session.activityTimer); session.activityTimer = undefined;
    session.info.outputActive = false;
  }
  private outputActivity(session: Session) {
    clearTimeout(session.activityTimer);
    if (!session.info.outputActive) { session.info.outputActive = true; this.publish(); }
    session.activityTimer = setTimeout(() => { this.stopActivity(session); this.publish(); }, 800);
  }
  async create(name?: unknown, cwd?: unknown) {
    if (this.entries.size >= 32) throw new HttpError(409, '最多保留 32 个会话，请结束不需要的会话');
    if (name !== undefined && (typeof name !== 'string' || name.length > 80)) throw new HttpError(400, '会话名称最多 80 字符');
    if (cwd !== undefined && typeof cwd !== 'string') throw new HttpError(400, '工作目录无效');
    const dir = await this.files.directory((cwd as string) || this.config.defaultCwd);
    const id = randomUUID();
    const info: SessionInfo = { id, name: (name as string)?.trim() || `终端 ${this.entries.size + 1}`, cwd: dir, createdAt: new Date().toISOString(), running: true, outputActive: false };
    const session = this.makeSession(info);
    try {
      this.entries.set(id, session);
      this.ensureProcess(session);
    } catch (error) {
      this.entries.delete(id); void session.screen.dispose();
      throw error;
    }
    this.save();
    this.publish();
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
    const shellArgs = /(?:^|[/\\])(?:powershell|pwsh)(?:\.exe)?$/i.test(this.config.shell) ? ['-NoLogo']
      : /(?:^|[/\\])cmd(?:\.exe)?$/i.test(this.config.shell) ? ['/Q'] : ['-l'];
    const terminalProcess = this.spawnTerminal(this.config.shell, shellArgs, session.info.cwd, 100, 30);
    session.process = terminalProcess;
    terminalProcess.onData(data => {
      if (this.shuttingDown || this.entries.get(session.info.id) !== session) return;
      if (data) this.outputActivity(session);
      session.pendingBytes += data.length;
      if (session.pendingBytes > 256 * 1024) terminalProcess.pause();
      void session.screen.write(data, () => {
        for (const ws of session.clients.keys()) send(ws, { type: 'output', data });
        session.pendingBytes -= data.length;
        if (session.pendingBytes < 64 * 1024) terminalProcess.resume();
      }).catch(error => console.error('终端画面更新失败', error));
    });
    terminalProcess.onExit(({ exitCode }) => {
      session.process = undefined;
      if (this.shuttingDown) return;
      void session.screen.run(() => {
        session.info.running = false; session.info.progress = undefined; this.stopActivity(session); this.save(); this.publish();
        for (const ws of session.clients.keys()) { send(ws, { type: 'exit', exitCode }); ws.close(4404, '会话已结束'); }
        session.clients.clear(); session.controller = undefined;
      });
    });
  }
  private snapshot(session: Session, ws: WebSocket) {
    try { send(ws, { type: 'snapshot', ...session.screen.snapshot(), controller: ws === session.controller }); }
    catch { send(ws, { type: 'error', message: '画面尚未就绪，正在重新连接' }); ws.close(1013, '画面尚未就绪'); }
  }
  private applySize(session: Session, cols: number, rows: number) {
    const term = session.screen.terminal;
    if (term.cols === cols && term.rows === rows) return;
    session.screen.resize(cols, rows);
    session.process?.resize(cols, rows);
    for (const ws of session.clients.keys()) this.snapshot(session, ws);
  }
  async attach(id: string, ws: WebSocket, cols: number, rows: number) {
    const session = this.get(id), size = this.dimensions(cols, rows);
    if (!session.info.running) throw new HttpError(409, '会话已结束，请新建终端');
    ws.once('close', () => {
      void session.screen.run(() => {
        session.clients.delete(ws);
        if (session.controller !== ws) return;
        session.controller = session.clients.keys().next().value;
        if (session.controller) {
          const next = session.clients.get(session.controller)!;
          send(session.controller, { type: 'control', controller: true });
          this.applySize(session, next.cols, next.rows);
        }
      });
    });
    await this.current(id);
    await session.screen.run(() => {
      if (ws.readyState !== 1) return;
      if (!session.info.running) throw new HttpError(409, '会话已结束');
      if (!session.controller) { session.controller = ws; this.applySize(session, size.cols, size.rows); }
      session.clients.set(ws, size);
      this.snapshot(session, ws);
      send(ws, { type: 'ready', session: session.info });
    });
  }
  input(id: string, ws: WebSocket, data: string) {
    const session = this.get(id);
    void session.screen.run(() => { if (session.clients.has(ws)) session.process?.write(data); });
  }
  paste(id: string, ws: WebSocket, text: string, submit: boolean) {
    const session = this.get(id);
    void session.screen.run(() => {
      if (session.clients.has(ws)) session.process?.write(pasteText(text, session.screen.terminal.modes.bracketedPasteMode) + (submit ? '\r' : ''));
    });
  }
  resize(id: string, ws: WebSocket, cols: number, rows: number, claim = false) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return;
    const session = this.get(id), size = this.dimensions(cols, rows);
    void session.screen.run(() => {
      if (!session.clients.has(ws)) return;
      session.clients.set(ws, size);
      if (claim && session.controller !== ws) {
        session.controller = ws;
        for (const client of session.clients.keys()) send(client, { type: 'control', controller: client === ws });
      }
      if (session.controller === ws) this.applySize(session, size.cols, size.rows);
    });
  }
  async remove(id: string) {
    const session = this.get(id);
    this.stopActivity(session);
    session.process?.kill();
    for (const ws of session.clients.keys()) ws.close(1000, '会话已结束');
    this.entries.delete(id); this.save();
    this.publish();
    await session.screen.dispose();
    await this.files.removeUploads(id);
  }
  async shutdown() {
    this.shuttingDown = true; this.save();
    clearInterval(this.refreshTimer); this.refreshTimer = undefined;
    for (const ws of this.watchers) ws.close(1012, '服务重启中');
    this.watchers.clear();
    for (const session of this.entries.values()) {
      this.stopActivity(session);
      for (const ws of session.clients.keys()) ws.close(1012, '服务重启中');
      session.process?.kill();
    }
    await Promise.all([...this.entries.values()].map(session => session.screen.dispose()));
  }
}
