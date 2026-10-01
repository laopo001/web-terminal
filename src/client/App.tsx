import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ClientMessage, FileInfo, ServerInfo, ServerMessage, SessionInfo } from '../shared/protocol';
import { isImagePath, quoteForShell } from './paths';
import { api, blobUrl, errorText, UnauthorizedError, urlFor } from './api';
import { pathLinkProvider } from './links';
import { arrowSequence } from './terminalKeys';
import { CloseSessionDialog } from './CloseSessionDialog';
import { MessageToast } from './MessageToast';
import { DirectoryPicker } from './DirectoryPicker';
import { useWorkspaceFolders } from './useWorkspaceFolders';
import { SessionTabs } from './SessionTabs';
import { enableTouchScroll } from './terminalTouch';
import { isFocusReport, isMouseReport, preferScrollback, preferTextSelection } from './terminalInteraction';
import { suppressTerminalResponses } from './terminalResponses';
import { useVisualViewport } from './useVisualViewport';
import { UploadThumbnail } from './UploadThumbnail';

const tokenKey = 'web-terminal.token';
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export default function App() {
  useVisualViewport();
  const [token, setToken] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authValue, setAuthValue] = useState('');
  const [authError, setAuthError] = useState('');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reachable, setReachable] = useState(true);
  const [status, setStatus] = useState('未连接');
  const [notice, setNoticeState] = useState({ id: 0, text: '' });
  const setNotice = useCallback((text: string) => setNoticeState(previous => ({ id: previous.id + 1, text })), []);
  const clearNotice = useCallback(() => setNoticeState(previous => ({ ...previous, text: '' })), []);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<{ id: number; file: File; state: string; failed: boolean }[]>([]);
  const uploadId = useRef(0);
  const uploadFailures = useRef(new Map<number, string>());
  const [preview, setPreview] = useState<{ file: FileInfo; url: string | null; loading: boolean; error?: string } | null>(null);
  const [hover, setHover] = useState<{ file: FileInfo; url: string | null; x: number; y: number; error?: string } | null>(null);
  const [draft, setDraft] = useState('');
  const composing = useRef(false);
  const compositionEnded = useRef(0);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const readyRef = useRef(false);
  const claimRef = useRef<() => void>(() => {});
  const draftInput = useRef<HTMLInputElement>(null);
  const workspaceFolders = useWorkspaceFolders();
  const [creating, setCreating] = useState(false);
  const [pendingClose, setPendingClose] = useState<SessionInfo | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const terminalHost = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const selectedRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const cwdRef = useRef('');
  const hoverTimer = useRef<number | null>(null);
  const hoverUrl = useRef<string | null>(null);
  const previewUrl = useRef<string | null>(null);
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const hoverGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  const revokeHover = useCallback(() => { hoverGeneration.current++;  if (hoverTimer.current !== null) clearTimeout(hoverTimer.current); hoverTimer.current = null; if (hoverUrl.current) URL.revokeObjectURL(hoverUrl.current); hoverUrl.current = null; setHover(null); }, []);
  const revokePreview = useCallback(() => { previewGeneration.current++;  if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; setPreview(null); }, []);
  const logout = useCallback(() => { localStorage.removeItem(tokenKey); tokenRef.current = null; setToken(null); setSessions([]); setSelected(null); setPendingClose(null); setCloseError(''); socket.current?.close(); revokeHover(); revokePreview(); }, [revokeHover, revokePreview]);
  const handleApiError = useCallback((error: unknown, message: string) => { if (error instanceof UnauthorizedError) logout(); else setNotice(`${message}：${errorText(error)}`); }, [logout]);

  useEffect(() => {
    const saved = localStorage.getItem(tokenKey);
    if (!saved) { setAuthChecking(false); return; }
    fetch('/api/auth', { headers: { Authorization: `Bearer ${saved}` } }).then(response => {
      if (response.ok) { tokenRef.current = saved; setToken(saved); }
      else if (response.status === 401) localStorage.removeItem(tokenKey);
      else setAuthError(`验证暂时失败：HTTP ${response.status}。令牌已保留，请重试。`);
    }).catch(() => setAuthError('无法连接服务器。令牌已保留，请重试。')).finally(() => setAuthChecking(false));
  }, []);
  const login = async (value: string) => {
    setAuthError(''); setBusy(true);
    try {
      const response = await fetch('/api/auth', { headers: { Authorization: `Bearer ${value}` } });
      if (!response.ok) throw new Error(response.status === 401 ? '令牌无效' : `HTTP ${response.status}`);
      localStorage.setItem(tokenKey, value); tokenRef.current = value; setToken(value); setAuthValue('');
    } catch (error) { setAuthError(errorText(error)); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([api<ServerInfo>(token, '/api/info'), api<SessionInfo[]>(token, '/api/sessions')]).then(([server, list]) => {
      if (!active) return; setReachable(true); setInfo(server); setSessions(list); setSelected(old => old && list.some(s => s.id === old) ? old : null);
    }).catch(error => { if (active) handleApiError(error, '加载失败'); });
    return () => { active = false; };
  }, [token, handleApiError]);
  useEffect(() => {
    if (!token) return;
    const sync = () => { void api<SessionInfo[]>(token, '/api/sessions').then(list => { setReachable(true); setSessions(list); setSelected(old => old && list.some(s => s.id === old) ? old : null); }).catch(error => { setReachable(false); if (error instanceof UnauthorizedError) logout(); }); };
    const timer = window.setInterval(sync, 5000); return () => clearInterval(timer);
  }, [token, handleApiError]);
  const current = sessions.find(s => s.id === selected);
  useEffect(() => { cwdRef.current = current?.cwd ?? ''; }, [current?.cwd]);

  const inspect = useCallback(async (path: string, base: string, target: 'hover' | 'preview', point?: { x: number; y: number }) => {
    if (!path.startsWith('/') && !path.startsWith('~/') && !base) { setNotice('历史相对路径的工作目录无法确定，请使用绝对路径'); return; }
    const id = selectedRef.current, key = tokenRef.current;
    const generation = target === 'hover' ? hoverGeneration.current : ++previewGeneration.current;
    if (!id || !key) return;
    try {
      const file = await api<FileInfo>(key, urlFor(id, 'meta', path, base || undefined));
      if (selectedRef.current !== id || (target === 'hover' ? hoverGeneration.current : previewGeneration.current) !== generation) return;
      if (target === 'hover') {
        if (!point || !file.mime.startsWith('image/')) return;
        const url = await blobUrl(key, urlFor(id, 'content', file.path, undefined, 'thumbnail'));
        if (selectedRef.current !== id || hoverGeneration.current !== generation) { URL.revokeObjectURL(url); return; }
        if (hoverUrl.current) URL.revokeObjectURL(hoverUrl.current); hoverUrl.current = url;
        setHover({ file, url, ...point });
      } else {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; setPreview({ file, url: null, loading: file.mime.startsWith('image/') });
        if (file.mime.startsWith('image/')) {
          const url = await blobUrl(key, urlFor(id, 'content', file.path));
          if (selectedRef.current !== id || previewGeneration.current !== generation) { URL.revokeObjectURL(url); return; }
          previewUrl.current = url; setPreview({ file, url, loading: false });
        }
      }
    } catch (error) { if (error instanceof UnauthorizedError) { logout(); return; } if (target === 'preview' && selectedRef.current === id && previewGeneration.current === generation) setPreview({ file: { path, name: path.split('/').pop() || path, size: 0, mime: '', isImage: isImagePath(path) }, url: null, loading: false, error: errorText(error) }); }
  }, [logout]);
  const download = async (file: FileInfo) => {
    if (!selected || !token) return;
    try { const url = await blobUrl(token, urlFor(selected, 'content', file.path, undefined, 'download')); const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (error) { handleApiError(error, '下载失败'); }
  };

  useEffect(() => {
    revokeHover(); revokePreview();
    if (!selected || !token || !terminalHost.current) { setStatus('未连接'); return; }
    const sessionId = selected;
    readyRef.current = false;
    let disposed = false, reconnectTimer: number | undefined, retry = 0, ws: WebSocket | null = null;
    const lineBases = new Map<number, string>();
    let renderQueue = Promise.resolve();
    const term = new Terminal({ cursorBlink: true, fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace', fontSize: 14, theme: { background: '#101821', foreground: '#d8e3e8', cursor: '#7bdfcd', selectionBackground: '#356b71aa' }, allowProposedApi: true });
    const responses = suppressTerminalResponses(term);
    const fit = new FitAddon(); term.loadAddon(fit); term.open(terminalHost.current); termRef.current = term;
    const selection = preferTextSelection(term);
    const scrolling = preferScrollback(term);
    // 让浏览器产生带图片数据的 paste 事件，不把 Ctrl+V 编码成远端的 ^V。
    term.attachCustomKeyEventHandler(event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'v') return false;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && term.hasSelection()) return false;
      return true;
    });
    let resizeTimer: number | undefined;
    let lastSize = '';
    const dimensions = () => fit.proposeDimensions();
    const resize = (claim = false) => {
      if (disposed || !terminalHost.current || terminalHost.current.clientWidth < 2 || terminalHost.current.clientHeight < 2) return;
      const proposed = dimensions();
      if (!proposed || proposed.rows < 2) return;
      const size = `${proposed.cols}:${proposed.rows}`;
      if (ws?.readyState === WebSocket.OPEN && readyRef.current && (claim || size !== lastSize)) {
        ws.send(JSON.stringify({ type: claim ? 'claim' : 'resize', ...proposed } satisfies ClientMessage)); lastSize = size;
      }
    };
    claimRef.current = () => resize(true);
    const scheduleResize = () => { if (resizeTimer) clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => resize(), 100); };
    const observer = new ResizeObserver(scheduleResize); observer.observe(terminalHost.current);
    document.addEventListener('visibilitychange', scheduleResize);
    // 容器决定期望尺寸，画布严格按服务端尺寸显示；窄窗口可横向滚动。
    const geometry = term.onRender(() => {
      const screen = terminalHost.current?.querySelector<HTMLElement>('.xterm-screen');
      if (screen && term.element) { term.element.style.width = `${screen.offsetWidth + 15}px`; term.element.style.height = `${screen.offsetHeight}px`; }
    });
    const send = (data: string) => {
      if (disposed) return;
      const terminalReport = isFocusReport(data) || isMouseReport(data);
      if (ws?.readyState === WebSocket.OPEN && readyRef.current) {
        if (!terminalReport) resize(true);
        ws.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage));
      } else if (!terminalReport) setNotice('连接未就绪，输入未发送');
    };
    const inputDisposable = term.onData(send);
    const touchScroll = enableTouchScroll(term, data => {
      if (!disposed && readyRef.current && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage));
    });
    const provider = pathLinkProvider(term, { base: row => lineBases.get(row) ?? '', activate: (path, base) => { revokeHover(); void inspect(path, base, 'preview'); }, hover: (path, base, point) => { revokeHover(); hoverTimer.current = window.setTimeout(() => { void inspect(path, base, 'hover', point); }, 300); }, leave: revokeHover });
    const linkDisposable = term.registerLinkProvider(provider);
    const connect = () => {
      if (disposed) return;
      setStatus(retry ? `重连中 · 第 ${retry} 次` : '连接中');
      readyRef.current = false;
      ws = null; socket.current = null;
      // 等上一条连接的写入队列排空，再重置，避免旧画面覆盖新连接。
      term.write('', () => {
      if (disposed) return;
      term.reset(); lineBases.clear();
      const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); ws = connection; socket.current = ws;
      ws.onopen = () => { if (disposed || ws !== connection) return; const size = dimensions() || { cols: 80, rows: 24 }; lastSize = `${size.cols}:${size.rows}`; connection.send(JSON.stringify({ type: 'auth', protocol: 2, token, sessionId, ...size } satisfies ClientMessage)); };
      ws.onmessage = event => {
        if (disposed || ws !== connection) return;
        let msg: ServerMessage;
        try { msg = JSON.parse(event.data) as ServerMessage; } catch { setNotice('收到无效的终端消息'); return; }
        renderQueue = renderQueue.then(async () => {
          if (disposed || ws !== connection) return;
          const write = (data: string) => new Promise<void>(resolve => term.write(data, resolve));
          if (msg.type === 'snapshot') {
            term.reset(); term.resize(msg.cols, msg.rows); lineBases.clear();
            await write(msg.data);
          } else if (msg.type === 'ready') {
            retry = 0; readyRef.current = true; setReachable(true); setStatus('已连接');
            cwdRef.current = msg.session.cwd; setSessions(list => list.map(s => s.id === sessionId ? msg.session : s)); resize();
          } else if (msg.type === 'output') {
            const start = term.buffer.active.baseY + term.buffer.active.cursorY, base = cwdRef.current;
            await write(msg.data);
            if (disposed) return;
            const end = term.buffer.active.baseY + term.buffer.active.cursorY;
            for (let row = start; row <= end; row++) lineBases.set(row, base);
            for (const row of lineBases.keys()) if (row < term.buffer.active.baseY - 2000) lineBases.delete(row);
          } else if (msg.type === 'exit') { readyRef.current = false; setStatus(`Shell 已退出 · ${msg.exitCode}`); }
          else if (msg.type === 'error') setNotice(msg.message);
        }).catch(() => { if (!disposed) setNotice('终端画面恢复失败，请重新连接'); });
      };
      ws.onclose = event => {
        if (disposed || ws !== connection) return;
        readyRef.current = false;
        if (event.code === 4406) { setStatus('需要刷新页面'); setNotice('终端协议已更新，请刷新页面'); return; }
        if (event.code === 4401) { logout(); return; }
        if (event.code === 4404) { setStatus('会话已结束'); void api<SessionInfo[]>(token, '/api/sessions').then(setSessions).catch(error => handleApiError(error, '会话同步失败')); return; }
        retry++; const delay = Math.min(30_000, 700 * 2 ** Math.min(retry, 6));
        setStatus(`已断开 · ${Math.ceil(delay / 1000)} 秒后重连`);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => { if (!disposed && ws === connection) setStatus('连接出错'); };
      });
    };
    connect();
    return () => { disposed = true; if (reconnectTimer) clearTimeout(reconnectTimer); observer.disconnect(); if (resizeTimer) clearTimeout(resizeTimer); document.removeEventListener('visibilitychange', scheduleResize); readyRef.current = false; claimRef.current = () => {}; responses.dispose(); selection.dispose(); scrolling.dispose(); touchScroll.dispose(); geometry.dispose(); inputDisposable.dispose(); linkDisposable.dispose(); ws?.close(); if (socket.current === ws) socket.current = null; term.dispose(); if (termRef.current === term) termRef.current = null; revokeHover(); revokePreview(); };
  }, [selected, token, inspect, logout, revokeHover, revokePreview, handleApiError]);

  const uploadFile = (file: File) => {
    const id = selectedRef.current, key = tokenRef.current;
    if (!id || !key) return;
    if (!imageTypes.has(file.type)) { setNotice('仅支持 PNG、JPEG、WebP、GIF 图片'); return; }
    if (file.size > (info?.maxUploadBytes ?? 20 * 1024 * 1024)) { setNotice('图片超过上传大小限制'); return; }
    const itemId = ++uploadId.current;
    const update = (state: string, failed = false) => { if (failed) uploadFailures.current.set(itemId, id); else uploadFailures.current.delete(itemId); setUploads(items => items.map(item => item.id === itemId ? { ...item, state, failed } : item)); };
    setUploads(items => [...items, { id: itemId, file, state: '排队上传…', failed: false }]);
    uploadQueue.current = uploadQueue.current.catch(() => undefined).then(async () => {
      if (selectedRef.current !== id) { update('已切换会话，未上传', true); return; }
      update('正在上传…');
      const form = new FormData(); form.append('file', file);
      try {
        const result = await api<FileInfo>(key, `/api/sessions/${encodeURIComponent(id)}/uploads`, { method: 'POST', body: form });
        if (selectedRef.current !== id) { update('已上传至原会话，未插入路径', true); return; }
        if (socket.current?.readyState === WebSocket.OPEN && readyRef.current) {
          claimRef.current(); socket.current.send(JSON.stringify({ type: 'paste', text: quoteForShell(result.path), submit: false } satisfies ClientMessage));
          update('已插入路径');
        } else { update('已上传，路径已保存到草稿'); setDraft(value => value + ' ' + quoteForShell(result.path)); setNotice('终端断线，路径已保存在草稿中'); }
      } catch (error) { if (error instanceof UnauthorizedError) logout(); else update(errorText(error), true); }
    });
  };
  const createSession = async (cwd: string) => {
    if (!token || busy) return; setBusy(true);
    try { const created = await api<SessionInfo>(token, '/api/sessions', { method: 'POST', body: JSON.stringify({ cwd }) }); setSessions(list => [...list, created]); setSelected(created.id); setCreating(false); setNotice('会话已创建'); }
    catch (error) { if (error instanceof UnauthorizedError) logout(); throw error; } finally { setBusy(false); }
  };
  const endSession = async (session: SessionInfo) => {
    if (!token || closing) return;
    setClosing(true); setCloseError('');
    try { await api(token, `/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' }); setSessions(list => list.filter(s => s.id !== session.id)); setSelected(current => current === session.id ? null : current); setPendingClose(null); setNotice('会话已结束'); }
    catch (error) { setCloseError(errorText(error)); handleApiError(error, '结束失败'); }
    finally { setClosing(false); }
  };
  const sendKey = (data: string): boolean => { if (socket.current?.readyState !== WebSocket.OPEN || !readyRef.current) { setNotice('连接未就绪，输入未发送'); return false; } claimRef.current(); socket.current.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage)); if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) termRef.current?.focus(); return true; };
  const sendDraft = async () => {
    if (sendingRef.current || composing.current || Date.now() - compositionEnded.current < 80) return;
    const id = selectedRef.current;
    if (!id || !draft.trim()) return;
    const text = draft;
    sendingRef.current = true; setSending(true);
    try {
      await uploadQueue.current;
      if ([...uploadFailures.current.values()].includes(id)) { setNotice('图片尚未上传成功，请重试或移除后发送'); return; }
      if (selectedRef.current !== id) return;
      if (!readyRef.current) { setNotice('连接未就绪，文字已保留'); return; }
      if (socket.current?.readyState === WebSocket.OPEN) {
        claimRef.current(); socket.current.send(JSON.stringify({ type: 'paste', text, submit: true } satisfies ClientMessage));
        setDraft(value => value === text ? '' : value); draftInput.current?.focus();
      }
    } finally { sendingRef.current = false; setSending(false); }
  };
  const onPaste = (event: React.ClipboardEvent) => { const file = [...event.clipboardData.items].find(item => item.kind === 'file' && imageTypes.has(item.type))?.getAsFile(); if (file) { event.preventDefault(); event.stopPropagation(); void uploadFile(file); } };
  const onDrop = (event: React.DragEvent) => { event.preventDefault(); const file = [...event.dataTransfer.files].find(f => imageTypes.has(f.type)); if (file) void uploadFile(file); };
  useEffect(() => () => { if (hoverUrl.current) URL.revokeObjectURL(hoverUrl.current); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  if (authChecking) return <main className="auth-shell"><div className="auth-card"><span className="brand-mark">›_</span><h1>连接终端</h1><p>正在验证保存的访问令牌…</p></div></main>;
  if (!token) return <main className="auth-shell"><form className="auth-card" onSubmit={event => { event.preventDefault(); void login(authValue.trim() || localStorage.getItem(tokenKey) || ''); }}><span className="brand-mark">›_</span><h1>Web Terminal</h1><p>输入访问令牌，连接到你的工作空间。</p><label htmlFor="token">访问令牌</label><input id="token" type="password" autoComplete="off" value={authValue} onChange={e => setAuthValue(e.target.value)} placeholder={localStorage.getItem(tokenKey) ? '已保存令牌，可直接重试' : '粘贴访问令牌'} /><button className="primary" disabled={busy}>连接</button>{authError && <div className="error" role="alert">{authError}</div>}</form></main>;
  return <div className="app"><header className="tabs-bar">
    <SessionTabs sessions={sessions} selected={selected} status={status} reachable={reachable} onSelect={setSelected} onClose={session => { setCloseError(''); setPendingClose(session); }} />
    <div className="tab-actions"><button title="创建会话" aria-label="创建会话" onClick={() => setCreating(value => !value)}>＋</button></div>
    {creating && <DirectoryPicker token={token} initialPath={workspaceFolders[0]?.path || current?.cwd || info?.defaultCwd || ''} home={info?.defaultCwd || ''} folders={workspaceFolders} busy={busy} onCreate={createSession} onClose={() => setCreating(false)} onUnauthorized={logout} />}
  </header><div className="workspace"><div className="content"><div className="terminal-pane">{!selected && <div className="empty-session"><strong>命令行终端</strong><p>{sessions.length ? '选择已有会话继续使用，或新建一个 Shell。' : '新建一个普通 Shell，运行你需要的命令。'}</p><button className="primary" disabled={busy} onClick={() => setCreating(true)}>新建 Shell</button></div>}<div className="terminal-wrap" onPasteCapture={onPaste} onDrop={onDrop} onDragOver={e => e.preventDefault()}><div ref={terminalHost} className="terminal-host" /></div><div className="mobile-keys" onPointerDown={e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }} role="toolbar" aria-label="触屏终端快捷键"><button onClick={() => sendKey('\x1b')}>Esc</button><button onClick={() => sendKey('\t')}>Tab</button><button onClick={() => sendKey('\x03')}>Ctrl C</button>{([['left', '←', '左方向键'], ['up', '↑', '上方向键'], ['down', '↓', '下方向键'], ['right', '→', '右方向键']] as const).map(([direction, label, title]) => <button key={direction} aria-label={title} title={title} disabled={status !== '已连接'} onPointerDown={e => e.preventDefault()} onClick={() => sendKey(arrowSequence(direction, termRef.current?.modes.applicationCursorKeysMode ?? false))}>{label}</button>)}<button onClick={() => fileInput.current?.click()}>上传</button></div><div className="draft-row"><input ref={draftInput} aria-label="待发送文字" enterKeyHint="send" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} onPasteCapture={onPaste} onFocus={() => claimRef.current()} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; compositionEnded.current = Date.now(); }} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !composing.current && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && Date.now() - compositionEnded.current >= 80) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) void sendDraft(); } }} placeholder="断线时可暂存文字；回车发送" /><button onPointerDown={e => e.preventDefault()} onClick={() => void sendDraft()} disabled={!draft || sending}>{sending ? '等待上传…' : '发送'}</button></div>{uploads.map(item => <div key={item.id} className={`upload-state ${item.failed ? 'error' : ''}`}><UploadThumbnail file={item.file} /><span>{item.file.name} · {item.state}</span>{item.failed && selected && <button onClick={() => { uploadFailures.current.delete(item.id); setUploads(items => items.filter(x => x.id !== item.id)); uploadFile(item.file); }}>重试</button>}<button onClick={() => { uploadFailures.current.delete(item.id); setUploads(items => items.filter(x => x.id !== item.id)); }}>关闭</button></div>)}</div>{preview && <aside className="preview"><div className="preview-head"><span>文件预览</span><button onClick={revokePreview}>×</button></div><div className="preview-body"><h2 title={preview.file.path}>{preview.file.name}</h2><p className="file-path">{preview.file.path}</p>{preview.loading && <p>加载图片中…</p>}{preview.error && <p className="error">{preview.error}</p>}{preview.url && preview.file.mime.startsWith('image/') && <img src={preview.url} alt={preview.file.name} />}<dl><dt>类型</dt><dd>{preview.file.mime || '未知'}</dd><dt>大小</dt><dd>{preview.file.size ? `${(preview.file.size / 1024).toFixed(1)} KB` : '未知'}</dd>{preview.file.width && <><dt>尺寸</dt><dd>{preview.file.width} × {preview.file.height}</dd></>}</dl><div className="preview-buttons"><button onClick={() => void navigator.clipboard.writeText(preview.file.path).then(() => setNotice('路径已复制')).catch(error => setNotice(`复制失败：${errorText(error)}`))}>复制路径</button><button className="primary" onClick={() => void download(preview.file)}>下载文件</button></div></div></aside>}</div></div>{notice.text && <MessageToast key={notice.id} message={notice.text} onClose={clearNotice} />}{pendingClose && <CloseSessionDialog name={pendingClose.name} busy={closing} error={closeError} onCancel={() => setPendingClose(null)} onConfirm={() => void endSession(pendingClose)} />}<input ref={fileInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadFile(file); }} />{hover?.url && <div className="hover-card" style={{ left: Math.min(hover.x + 16, window.innerWidth - 240), top: Math.min(hover.y + 16, window.innerHeight - 220) }}><img src={hover.url} alt={hover.file.name} /><span>{hover.file.name}</span></div>}</div>;
}
