import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ClientMessage, FileInfo, ServerMessage, SessionInfo } from '../shared/protocol';
import { isImagePath, quoteForShell } from './paths';
import { api, blobUrl, errorText, UnauthorizedError, urlFor } from './api';
import { pathLinkProvider } from './links';
import { arrowSequence } from './terminalKeys';
import { DraftInput } from './DraftInput';
import { enableTouchInteraction } from './terminalTouch';
import { isFocusReport, isMouseReport, preferScrollback, preferTextSelection } from './terminalInteraction';
import { suppressTerminalResponses } from './terminalResponses';
import { UploadThumbnail } from './UploadThumbnail';
import { enableTerminalClipboard, writeClipboardText } from './terminalClipboard';
import type { InteractionMode } from './clientSettings';

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

type Props = {
  session: SessionInfo; token: string; active: boolean; fontFamily: string; interactionMode: InteractionMode; maxUploadBytes: number;
  onNotice: (text: string) => void; onUnauthorized: () => void;
  onStatus: (id: string, status: string) => void;
  setSessions: React.Dispatch<React.SetStateAction<SessionInfo[]>>;
  setReachable: React.Dispatch<React.SetStateAction<boolean>>;
};

/** 首次选中后保留；隐藏只停止交互与尺寸上报，连接和画面继续更新。 */
export function SessionPane({ session, token, active, fontFamily, interactionMode, maxUploadBytes, onNotice: setNotice, onUnauthorized: logout, onStatus, setSessions, setReachable }: Props) {
  const sessionId = session.id;
  const activeRef = useRef(active);
  const fontRef = useRef(fontFamily);
  useLayoutEffect(() => { fontRef.current = fontFamily; }, [fontFamily]);
  const mounted = useRef(true);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [status, setLocalStatus] = useState('未连接');
  const setStatus = useCallback((value: string) => { setLocalStatus(value); onStatus(sessionId, value); }, [sessionId, onStatus]);
  const [uploads, setUploads] = useState<{ id: number; file: File; state: string; failed: boolean }[]>([]);
  const uploadId = useRef(0);
  const uploadFailures = useRef(new Map<number, string>());
  const [preview, setPreview] = useState<{ file: FileInfo; url: string | null; loading: boolean; error?: string } | null>(null);
  const [hover, setHover] = useState<{ file: FileInfo; url: string | null; x: number; y: number; error?: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [copyMode, setCopyMode] = useState(false);
  const composing = useRef(false);
  const compositionEnded = useRef(0);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const readyRef = useRef(false);
  const claimRef = useRef<() => void>(() => {});
  const activateRef = useRef<() => void>(() => {});
  const cancelTouchRef = useRef<() => void>(() => {});
  const copyModeRef = useRef(false);
  const interactionModeRef = useRef(interactionMode);
  const draftInput = useRef<HTMLDivElement>(null);
  const terminalHost = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  useLayoutEffect(() => { interactionModeRef.current = interactionMode; copyModeRef.current = false; setCopyMode(false); cancelTouchRef.current(); termRef.current?.clearSelection(); }, [interactionMode]);
  useLayoutEffect(() => { copyModeRef.current = copyMode; cancelTouchRef.current(); termRef.current?.clearSelection(); }, [copyMode]);
  const cwdRef = useRef(session.cwd);
  const hoverTimer = useRef<number | null>(null);
  const hoverUrl = useRef<string | null>(null);
  const previewUrl = useRef<string | null>(null);
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const hoverGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const copyText = useCallback((text: string) => {
    void writeClipboardText(text).then(() => setNotice(`已复制 ${Array.from(text).length} 个字符`)).catch(error => setNotice(`复制失败：${errorText(error)}`));
  }, [setNotice]);
  useEffect(() => { cwdRef.current = session.cwd; }, [session.cwd]);
  const revokeHover = useCallback(() => { hoverGeneration.current++; if (hoverTimer.current !== null) clearTimeout(hoverTimer.current); hoverTimer.current = null; if (hoverUrl.current) URL.revokeObjectURL(hoverUrl.current); hoverUrl.current = null; setHover(null); }, []);
  const revokePreview = useCallback(() => { previewGeneration.current++; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; setPreview(null); }, []);
  const handleApiError = useCallback((error: unknown, message: string) => { if (error instanceof UnauthorizedError) logout(); else setNotice(`${message}：${errorText(error)}`); }, [logout, setNotice]);
  const inspect = useCallback(async (path: string, base: string, target: 'hover' | 'preview', point?: { x: number; y: number }) => {
    if (!path.startsWith('/') && !path.startsWith('~/') && !base) { setNotice('历史相对路径的工作目录无法确定，请使用绝对路径'); return; }
    const id = sessionId, key = token;
    const generation = target === 'hover' ? hoverGeneration.current : ++previewGeneration.current;
    if (!mounted.current) return;
    try {
      const file = await api<FileInfo>(key, urlFor(id, 'meta', path, base || undefined));
      if (!mounted.current || (target === 'hover' ? hoverGeneration.current : previewGeneration.current) !== generation) return;
      if (target === 'hover') {
        if (!point || !file.mime.startsWith('image/')) return;
        const url = await blobUrl(key, urlFor(id, 'content', file.path, undefined, 'thumbnail'));
        if (!mounted.current || hoverGeneration.current !== generation) { URL.revokeObjectURL(url); return; }
        if (hoverUrl.current) URL.revokeObjectURL(hoverUrl.current); hoverUrl.current = url;
        setHover({ file, url, ...point });
      } else {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; setPreview({ file, url: null, loading: file.mime.startsWith('image/') });
        if (file.mime.startsWith('image/')) {
          const url = await blobUrl(key, urlFor(id, 'content', file.path));
          if (!mounted.current || previewGeneration.current !== generation) { URL.revokeObjectURL(url); return; }
          previewUrl.current = url; setPreview({ file, url, loading: false });
        }
      }
    } catch (error) { if (!mounted.current) return; if (error instanceof UnauthorizedError) { logout(); return; } if (target === 'preview' && mounted.current && previewGeneration.current === generation) setPreview({ file: { path, name: path.split('/').pop() || path, size: 0, mime: '', isImage: isImagePath(path) }, url: null, loading: false, error: errorText(error) }); }
  }, [sessionId, token, logout, setNotice]);
  const download = async (file: FileInfo) => {
    if (!sessionId || !token) return;
    try { const url = await blobUrl(token, urlFor(sessionId, 'content', file.path, undefined, 'download')); const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (error) { handleApiError(error, '下载失败'); }
  };

  useEffect(() => {
    if (!sessionId || !token || !terminalHost.current) { setStatus('未连接'); return; }
    readyRef.current = false;
    let disposed = false, reconnectTimer: number | undefined, retry = 0, ws: WebSocket | null = null;
    const lineBases = new Map<number, string>();
    let renderQueue = Promise.resolve();
    let reconnectScrollLine: number | undefined;
    let liveOutput = false;
    const term = new Terminal({ cursorBlink: true, fontFamily: fontRef.current, fontSize: window.matchMedia('(hover: none) and (pointer: coarse)').matches ? 12 : 14, theme: { background: '#101821', foreground: '#d8e3e8', cursor: '#7bdfcd', selectionBackground: '#356b71aa' }, allowProposedApi: true });
    const responses = suppressTerminalResponses(term);
    const clipboard = enableTerminalClipboard(term, {
      canWrite: () => !disposed && liveOutput && activeRef.current && !document.hidden && document.hasFocus(),
      writeText: writeClipboardText,
      onError: error => setNotice(`终端复制失败：${errorText(error)}`),
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(terminalHost.current); termRef.current = term;
    const selection = preferTextSelection(term, () => interactionModeRef.current === 'local');
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
      if (disposed || !activeRef.current || document.hidden || !terminalHost.current || terminalHost.current.clientWidth < 2 || terminalHost.current.clientHeight < 2) return;
      const proposed = dimensions();
      if (!proposed || proposed.rows < 2) return;
      const size = `${proposed.cols}:${proposed.rows}`;
      if (ws?.readyState === WebSocket.OPEN && readyRef.current && (claim || size !== lastSize)) {
        ws.send(JSON.stringify({ type: claim ? 'claim' : 'resize', ...proposed } satisfies ClientMessage)); lastSize = size;
      }
    };
    claimRef.current = () => resize(true);
    activateRef.current = () => { term.refresh(0, term.rows - 1); resize(); };
    const scheduleResize = () => { if (resizeTimer) clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => resize(), 100); };
    const observer = new ResizeObserver(scheduleResize); observer.observe(terminalHost.current);
    document.addEventListener('visibilitychange', scheduleResize);
    // 容器决定期望尺寸，画布严格按服务端尺寸显示；窄窗口可横向滚动。
    const geometry = term.onRender(() => {
      if (!activeRef.current) return;
      const screen = terminalHost.current?.querySelector<HTMLElement>('.xterm-screen');
      if (screen && term.element) { term.element.style.width = `${screen.offsetWidth + 15}px`; term.element.style.height = `${screen.offsetHeight}px`; }
    });
    const send = (data: string) => {
      if (disposed || !activeRef.current) return;
      const terminalReport = isFocusReport(data) || isMouseReport(data);
      if (ws?.readyState === WebSocket.OPEN && readyRef.current) {
        if (!terminalReport) resize(true);
        ws.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage));
      } else if (!terminalReport) setNotice('连接未就绪，输入未发送');
    };
    const inputDisposable = term.onData(send);
    const touch = enableTouchInteraction(term, {
      selectionMode: () => interactionModeRef.current,
      copyMode: () => copyModeRef.current,
      onCancelCopy: () => setCopyMode(false),
      sendScrollInput: data => { if (!disposed && activeRef.current && readyRef.current && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage)); },
      copyText,
    });
    cancelTouchRef.current = touch.cancel;
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
      const buffer = term.buffer.active;
      reconnectScrollLine = buffer.type === 'normal' && buffer.viewportY < buffer.baseY ? buffer.viewportY : undefined;
      term.reset(); lineBases.clear();
      const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); ws = connection; socket.current = ws;
      ws.onopen = () => { if (disposed || ws !== connection) return; const size = activeRef.current ? dimensions() || { cols: term.cols, rows: term.rows } : { cols: term.cols, rows: term.rows }; lastSize = `${size.cols}:${size.rows}`; connection.send(JSON.stringify({ type: 'auth', protocol: 2, token, sessionId, ...size } satisfies ClientMessage)); };
      ws.onmessage = event => {
        if (disposed || ws !== connection) return;
        let msg: ServerMessage;
        try { msg = JSON.parse(event.data) as ServerMessage; } catch { setNotice('收到无效的终端消息'); return; }
        renderQueue = renderQueue.then(async () => {
          if (disposed || ws !== connection) return;
          const write = (data: string) => new Promise<void>(resolve => term.write(data, resolve));
          if (msg.type === 'snapshot') {
            const buffer = term.buffer.active;
            const scrollLine = reconnectScrollLine ?? (buffer.type === 'normal' && buffer.viewportY < buffer.baseY ? buffer.viewportY : undefined);
            reconnectScrollLine = undefined;
            term.reset(); term.resize(msg.cols, msg.rows); lineBases.clear();
            await write(msg.data);
            if (scrollLine !== undefined && term.buffer.active.type === 'normal') term.scrollToLine(scrollLine);
          } else if (msg.type === 'ready') {
            retry = 0; readyRef.current = true; setReachable(true); setStatus('已连接');
            cwdRef.current = msg.session.cwd; setSessions(list => list.map(s => s.id === sessionId ? msg.session : s)); resize();
          } else if (msg.type === 'output') {
            const start = term.buffer.active.baseY + term.buffer.active.cursorY, base = cwdRef.current;
            liveOutput = true;
            try { await write(msg.data); } finally { liveOutput = false; }
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
    return () => { disposed = true; if (reconnectTimer) clearTimeout(reconnectTimer); observer.disconnect(); if (resizeTimer) clearTimeout(resizeTimer); document.removeEventListener('visibilitychange', scheduleResize); readyRef.current = false; claimRef.current = () => {}; activateRef.current = () => {}; responses.dispose(); clipboard.dispose(); selection.dispose(); scrolling.dispose(); touch.dispose(); cancelTouchRef.current = () => {}; geometry.dispose(); inputDisposable.dispose(); linkDisposable.dispose(); ws?.close(); if (socket.current === ws) socket.current = null; term.dispose(); if (termRef.current === term) termRef.current = null; revokeHover(); revokePreview(); };
  }, [sessionId, token, inspect, logout, revokeHover, revokePreview, handleApiError, setStatus, setNotice, setSessions, setReachable, copyText]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamily;
    let cancelled = false;
    void document.fonts.ready.then(() => { if (!cancelled && activeRef.current) activateRef.current(); });
    return () => { cancelled = true; };
  }, [fontFamily]);

  const uploadFile = (file: File) => {
    const id = sessionId, key = token;
    if (!mounted.current) return;
    if (!imageTypes.has(file.type)) { setNotice('仅支持 PNG、JPEG、WebP、GIF 图片'); return; }
    if (file.size > maxUploadBytes) { setNotice('图片超过上传大小限制'); return; }
    const itemId = ++uploadId.current;
    const update = (state: string, failed = false) => { if (!mounted.current) return; if (failed) uploadFailures.current.set(itemId, id); else uploadFailures.current.delete(itemId); setUploads(items => items.map(item => item.id === itemId ? { ...item, state, failed } : item)); };
    setUploads(items => [...items, { id: itemId, file, state: '排队上传…', failed: false }]);
    uploadQueue.current = uploadQueue.current.catch(() => undefined).then(async () => {
      if (!mounted.current) return;
      update('正在上传…');
      const form = new FormData(); form.append('file', file);
      try {
        const result = await api<FileInfo>(key, `/api/sessions/${encodeURIComponent(id)}/uploads`, { method: 'POST', body: form });
        if (!mounted.current) return;
        if (activeRef.current && socket.current?.readyState === WebSocket.OPEN && readyRef.current) {
          claimRef.current(); socket.current.send(JSON.stringify({ type: 'paste', text: quoteForShell(result.path), submit: false } satisfies ClientMessage));
          update('已插入路径');
        } else { update('已上传，路径已保存到草稿'); setDraft(value => value + ' ' + quoteForShell(result.path)); if (activeRef.current) setNotice('路径已保存在当前会话草稿中'); }
      } catch (error) { if (!mounted.current) return; if (error instanceof UnauthorizedError) logout(); else update(errorText(error), true); }
    });
  };
  const sendKey = (data: string): boolean => { if (!activeRef.current) return false; if (socket.current?.readyState !== WebSocket.OPEN || !readyRef.current) { setNotice('连接未就绪，输入未发送'); return false; } claimRef.current(); socket.current.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage)); if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) termRef.current?.focus(); return true; };
  const sendDraft = async () => {
    if (!activeRef.current || sendingRef.current || composing.current || Date.now() - compositionEnded.current < 80) return;
    const id = sessionId;
    if (!id || !draft.trim()) return;
    const text = draft;
    const sentUploadId = uploadId.current;
    sendingRef.current = true; setSending(true);
    try {
      await uploadQueue.current;
      if (!mounted.current || !activeRef.current) return;
      if ([...uploadFailures.current.values()].includes(id)) { setNotice('图片尚未上传成功，请重试或移除后发送'); return; }
      if (!readyRef.current) { setNotice('连接未就绪，文字已保留'); return; }
      if (socket.current?.readyState === WebSocket.OPEN) {
        claimRef.current(); socket.current.send(JSON.stringify({ type: 'paste', text, submit: true } satisfies ClientMessage));
        setDraft(value => value === text ? '' : value); draftInput.current?.focus();
        setUploads(items => items.filter(item => item.id > sentUploadId));
      }
    } finally { sendingRef.current = false; if (mounted.current) setSending(false); }
  };
  const onPaste = (event: React.ClipboardEvent) => { const file = [...event.clipboardData.items].find(item => item.kind === 'file' && imageTypes.has(item.type))?.getAsFile(); if (file) { event.preventDefault(); event.stopPropagation(); void uploadFile(file); } };
  const onDrop = (event: React.DragEvent) => { event.preventDefault(); const file = [...event.dataTransfer.files].find(f => imageTypes.has(f.type)); if (file) void uploadFile(file); };
  useEffect(() => () => { if (hoverUrl.current) URL.revokeObjectURL(hoverUrl.current); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);


  useEffect(() => {
    if (active) activateRef.current();
    else { revokeHover(); termRef.current?.blur(); composing.current = false; copyModeRef.current = false; setCopyMode(false); cancelTouchRef.current(); }
  }, [active, revokeHover]);

  return <div className="content session-pane" hidden={!active} data-session-id={sessionId}><div className="terminal-pane"><div className="terminal-wrap" onPasteCapture={onPaste} onDrop={onDrop} onDragOver={e => e.preventDefault()}><div ref={terminalHost} className="terminal-host" /></div><div className="composer-dock"><div className="composer-panel" onPasteCapture={onPaste} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
        {uploads.length > 0 && <div className="composer-uploads" aria-label="图片上传状态">{uploads.map(item => <div key={item.id} className={`upload-state ${item.failed ? 'error' : ''}`}><UploadThumbnail file={item.file} /><span>{item.file.name} · {item.state}</span>{item.failed && <button onClick={() => { uploadFailures.current.delete(item.id); setUploads(items => items.filter(x => x.id !== item.id)); uploadFile(item.file); }}>重试</button>}<button aria-label={`移除 ${item.file.name}`} onClick={() => { uploadFailures.current.delete(item.id); setUploads(items => items.filter(x => x.id !== item.id)); }}>×</button></div>)}</div>}
        <div className="draft-row"><DraftInput ref={draftInput} style={{ fontFamily }} aria-label="待发送文字" onFocus={() => claimRef.current()} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; compositionEnded.current = Date.now(); }} value={draft} onChange={setDraft} onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && Date.now() - compositionEnded.current >= 80) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) void sendDraft(); }
        }} placeholder="输入命令或描述…" /></div>
        <div className="mobile-keys" onPointerDown={e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }} role="toolbar" aria-label="触屏终端快捷键"><button disabled={status !== '已连接'} onClick={() => sendKey('\t')}>Tab</button>{([['left', '←', '左方向键'], ['up', '↑', '上方向键'], ['down', '↓', '下方向键'], ['right', '→', '右方向键']] as const).map(([direction, label, title]) => <button key={direction} aria-label={title} title={title} disabled={status !== '已连接'} onClick={() => sendKey(arrowSequence(direction, termRef.current?.modes.applicationCursorKeysMode ?? false))}>{label}</button>)}</div>
        <div className="composer-actions">
          <div className="composer-tools" role="toolbar" aria-label="终端操作">
            <button className="attach-image" title="添加图片，也可粘贴或拖入" aria-label="添加图片" onPointerDown={e => e.preventDefault()} onClick={() => fileInput.current?.click()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11.5-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.9-2.9l8.5-8.5" /></svg></button>
            <span className="composer-divider" />
            <button title="发送 Esc" disabled={status !== '已连接'} onPointerDown={e => e.preventDefault()} onClick={() => sendKey('\x1b')}>Esc</button>
            <button title="中断当前程序（Ctrl+C）" aria-label="中断当前程序" disabled={status !== '已连接'} onPointerDown={e => e.preventDefault()} onClick={() => sendKey('\x03')}>Ctrl C</button>
            <button className="copy-mode-toggle" title={copyMode ? '退出复制模式，恢复手指滚屏' : '进入复制模式，手指拖动选字'} aria-label="复制模式" aria-pressed={copyMode} onPointerDown={e => e.preventDefault()} onClick={() => setCopyMode(value => !value)}>{copyMode ? '退出复制' : '复制'}</button>
          </div>
          <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
          <button className="composer-send" title={status === '已连接' ? '发送到当前会话' : status} onPointerDown={e => e.preventDefault()} onClick={() => void sendDraft()} disabled={!draft.trim() || sending || status !== '已连接'}>{sending ? '等待上传…' : status !== '已连接' ? '未连接' : '发送'}<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg></button>
        </div>
      </div></div></div>{preview && <aside className="preview"><div className="preview-head"><span>文件预览</span><button onClick={revokePreview}>×</button></div><div className="preview-body"><h2 title={preview.file.path}>{preview.file.name}</h2><p className="file-path">{preview.file.path}</p>{preview.loading && <p>加载图片中…</p>}{preview.error && <p className="error">{preview.error}</p>}{preview.url && preview.file.mime.startsWith('image/') && <img src={preview.url} alt={preview.file.name} />}<dl><dt>类型</dt><dd>{preview.file.mime || '未知'}</dd><dt>大小</dt><dd>{preview.file.size ? `${(preview.file.size / 1024).toFixed(1)} KB` : '未知'}</dd>{preview.file.width && <><dt>尺寸</dt><dd>{preview.file.width} × {preview.file.height}</dd></>}</dl><div className="preview-buttons"><button onClick={() => void navigator.clipboard.writeText(preview.file.path).then(() => setNotice('路径已复制')).catch(error => setNotice(`复制失败：${errorText(error)}`))}>复制路径</button><button className="primary" onClick={() => void download(preview.file)}>下载文件</button></div></div></aside>}<input ref={fileInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadFile(file); }} />{hover?.url && <div className="hover-card" style={{ left: Math.min(hover.x + 16, window.innerWidth - 240), top: Math.min(hover.y + 16, window.innerHeight - 220) }}><img src={hover.url} alt={hover.file.name} /><span>{hover.file.name}</span></div>}</div>;
}
