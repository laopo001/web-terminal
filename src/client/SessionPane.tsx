import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ClientMessage, FileInfo, ServerMessage, SessionInfo } from '../shared/protocol';
import { isImagePath, isTextPath, quoteForShell } from './paths';
import { api, fileBlob, blobUrl, errorText, UnauthorizedError, urlFor } from './api';
import { pathLinkProvider } from './links';
import { arrowSequence } from './terminalKeys';
import { DraftInput } from './DraftInput';
import { FilePreviewDialog } from './FilePreviewDialog';
import type { FilePreview } from './api';
import { enableTouchInteraction } from './terminalTouch';
import { isFocusReport, isMouseReport, preferScrollback, preferTextSelection } from './terminalInteraction';
import { suppressTerminalResponses } from './terminalResponses';
import { UploadThumbnail } from './UploadThumbnail';
import { enableTerminalClipboard, writeClipboardText } from './terminalClipboard';
import type { InteractionMode } from './clientSettings';
import { manageTerminalInputFocus } from './inputFocus';

type Attachment = { id: number; file: File; state: string; failed: boolean; text?: string; path?: string };

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

type Props = {
  session: SessionInfo; token: string; active: boolean; fontFamily: string; interactionMode: InteractionMode; maxUploadBytes: number;
  onNotice: (text: string) => void; onUnauthorized: () => void;
  onStatus: (id: string, status: string) => void;
  onActivity: (id: string, active: boolean) => void;
  setSessions: React.Dispatch<React.SetStateAction<SessionInfo[]>>;
  setReachable: React.Dispatch<React.SetStateAction<boolean>>;
};

/** 首次选中后保留；隐藏只停止交互与尺寸上报，连接和画面继续更新。 */
export function SessionPane({ session, token, active, fontFamily, interactionMode, maxUploadBytes, onNotice: setNotice, onUnauthorized: logout, onStatus, onActivity, setSessions, setReachable }: Props) {
  const sessionId = session.id;
  const activeRef = useRef(active);
  const fontRef = useRef(fontFamily);
  useLayoutEffect(() => { fontRef.current = fontFamily; }, [fontFamily]);
  const mounted = useRef(true);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [status, setLocalStatus] = useState('未连接');
  const setStatus = useCallback((value: string) => { setLocalStatus(value); onStatus(sessionId, value); }, [sessionId, onStatus]);
  const [uploads, renderUploads] = useState<Attachment[]>([]);
  const uploadsRef = useRef<Attachment[]>([]);
  const setUploads = (update: (items: Attachment[]) => Attachment[]) => { uploadsRef.current = update(uploadsRef.current); renderUploads(uploadsRef.current); };
  const uploadId = useRef(0);
  const receivedAttachments = useRef(new Set<string>());
  const [preview, setPreview] = useState<FilePreview | null>(null);
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
  const updateInputFocusRef = useRef<() => void>(() => {});
  const interactionModeRef = useRef(interactionMode);
  const draftInput = useRef<HTMLDivElement>(null);
  const terminalHost = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  useLayoutEffect(() => { interactionModeRef.current = interactionMode; copyModeRef.current = false; updateInputFocusRef.current(); setCopyMode(false); cancelTouchRef.current(); termRef.current?.clearSelection(); }, [interactionMode]);
  useLayoutEffect(() => { copyModeRef.current = copyMode; updateInputFocusRef.current(); cancelTouchRef.current(); termRef.current?.clearSelection(); }, [copyMode]);
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
    if (target === 'preview') {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null;
      setPreview({ file: { path, name: path.split('/').pop() || path, size: 0, mime: '', isImage: isImagePath(path) }, url: null, loading: true });
    }
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
        const textFile = isTextPath(file.path);
        setPreview({ file, url: null, loading: file.isImage || textFile });
        if (file.mime.startsWith('image/')) {
          const url = await blobUrl(key, urlFor(id, 'content', file.path));
          if (!mounted.current || previewGeneration.current !== generation) { URL.revokeObjectURL(url); return; }
          previewUrl.current = url; setPreview({ file, url, loading: false });
        } else if (textFile) {
          if (file.size > 1024 * 1024) throw new Error('文本超过 1 MB，请下载查看');
          const blob = await fileBlob(key, urlFor(id, 'content', file.path));
          if (blob.size > 1024 * 1024) throw new Error('文本超过 1 MB，请下载查看');
          const text = await blob.text();
          if (!mounted.current || previewGeneration.current !== generation) return;
          if (text.includes('\0')) throw new Error('该文件含二进制内容，请下载查看');
          setPreview({ file, url: null, text, loading: false });
        }
      }
    } catch (error) { if (!mounted.current) return; if (error instanceof UnauthorizedError) { logout(); return; } if (target === 'preview' && mounted.current && previewGeneration.current === generation) setPreview(value => value ? { ...value, loading: false, error: errorText(error) } : null); }
  }, [sessionId, token, logout, setNotice]);
  const activatePath = useCallback(async (path: string, base: string) => {
    revokeHover();
    if (window.parent === window || new URLSearchParams(location.search).get('embed') !== 'vscode') { await inspect(path, base, 'preview'); return; }
    if (!path.startsWith('/') && !path.startsWith('~/') && !base) { setNotice('历史相对路径的工作目录无法确定，请使用绝对路径'); return; }
    try {
      const file = await api<FileInfo>(token, urlFor(sessionId, 'meta', path, base || undefined));
      if (mounted.current && activeRef.current) window.parent.postMessage({ type: 'web-terminal:open-file', path: file.path }, '*');
    } catch (error) { handleApiError(error, '打开文件失败'); }
  }, [sessionId, token, inspect, revokeHover, handleApiError, setNotice]);

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
    let activityTimer: number | undefined;
    const stopActivity = () => {
      if (activityTimer !== undefined) clearTimeout(activityTimer);
      activityTimer = undefined; onActivity(sessionId, false);
    };
    const showActivity = () => {
      if (activityTimer !== undefined) clearTimeout(activityTimer);
      else onActivity(sessionId, true);
      activityTimer = window.setTimeout(stopActivity, 800);
    };
    const term = new Terminal({ cursorBlink: true, fontFamily: fontRef.current, fontSize: window.matchMedia('(hover: none) and (pointer: coarse)').matches ? 12 : 14, theme: { background: '#101821', foreground: '#d8e3e8', cursor: '#7bdfcd', selectionBackground: '#356b71aa' }, allowProposedApi: true });
    const responses = suppressTerminalResponses(term);
    const clipboard = enableTerminalClipboard(term, {
      canWrite: () => !disposed && liveOutput && activeRef.current && !document.hidden && document.hasFocus(),
      writeText: writeClipboardText,
      onError: error => setNotice(`终端复制失败：${errorText(error)}`),
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(terminalHost.current); termRef.current = term;
    const inputFocus = manageTerminalInputFocus(term, () => copyModeRef.current);
    updateInputFocusRef.current = inputFocus.update;
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
    const provider = pathLinkProvider(term, { base: row => lineBases.get(row) ?? '', activate: (path, base) => { void activatePath(path, base); }, hover: (path, base, point) => { revokeHover(); hoverTimer.current = window.setTimeout(() => { void inspect(path, base, 'hover', point); }, 300); }, leave: revokeHover });
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
            if (msg.data) showActivity();
            const start = term.buffer.active.baseY + term.buffer.active.cursorY, base = cwdRef.current;
            liveOutput = true;
            try { await write(msg.data); } finally { liveOutput = false; }
            if (disposed) return;
            const end = term.buffer.active.baseY + term.buffer.active.cursorY;
            for (let row = start; row <= end; row++) lineBases.set(row, base);
            for (const row of lineBases.keys()) if (row < term.buffer.active.baseY - 2000) lineBases.delete(row);
          } else if (msg.type === 'exit') { stopActivity(); readyRef.current = false; setStatus(`Shell 已退出 · ${msg.exitCode}`); }
          else if (msg.type === 'error') {
            if (msg.message.startsWith('会话已结束')) { readyRef.current = false; setStatus('会话已结束'); }
            else setNotice(msg.message);
          }
        }).catch(() => { if (!disposed) setNotice('终端画面恢复失败，请重新连接'); });
      };
      ws.onclose = event => {
        if (disposed || ws !== connection) return;
        stopActivity();
        readyRef.current = false;
        if (event.code === 4406) { setStatus('需要刷新页面'); setNotice('终端协议已更新，请刷新页面'); return; }
        if (event.code === 4401) { logout(); return; }
        if (event.code === 4404) { setStatus('会话已结束'); void api<SessionInfo[]>(token, '/api/sessions').then(setSessions).catch(error => handleApiError(error, '会话同步失败')); return; }
        retry++; const delay = Math.min(30_000, 700 * 2 ** Math.min(retry, 6));
        setStatus(`已断开 · ${Math.ceil(delay / 1000)} 秒后重连`);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => { if (!disposed && ws === connection) { stopActivity(); setStatus('连接出错'); } };
      });
    };
    connect();
    return () => { disposed = true; stopActivity(); if (reconnectTimer) clearTimeout(reconnectTimer); observer.disconnect(); if (resizeTimer) clearTimeout(resizeTimer); document.removeEventListener('visibilitychange', scheduleResize); readyRef.current = false; claimRef.current = () => {}; activateRef.current = () => {}; responses.dispose(); clipboard.dispose(); inputFocus.dispose(); updateInputFocusRef.current = () => {}; selection.dispose(); scrolling.dispose(); touch.dispose(); cancelTouchRef.current = () => {}; geometry.dispose(); inputDisposable.dispose(); linkDisposable.dispose(); ws?.close(); if (socket.current === ws) socket.current = null; term.dispose(); if (termRef.current === term) termRef.current = null; revokeHover(); revokePreview(); };
  }, [sessionId, token, inspect, activatePath, logout, revokeHover, revokePreview, handleApiError, setStatus, setNotice, setSessions, setReachable, copyText, onActivity]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamily;
    let cancelled = false;
    void document.fonts.ready.then(() => { if (!cancelled && activeRef.current) activateRef.current(); });
    return () => { cancelled = true; };
  }, [fontFamily]);

  useEffect(() => {
    if (!active || window.parent === window || new URLSearchParams(location.search).get('embed') !== 'vscode') return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !activeRef.current) return;
      if (event.data?.type === 'web-terminal:request-composer') { window.parent.postMessage({ type: 'web-terminal:composer-ready' }, '*'); return; }
      if (event.data?.type !== 'web-terminal:text-attachment') return;
      const item = event.data.attachment;
      if (typeof item?.id !== 'string' || typeof item?.text !== 'string' || typeof item?.name !== 'string') return;
      if (!receivedAttachments.current.has(item.id)) {
        receivedAttachments.current.add(item.id);
        setUploads(items => [...items, { id: ++uploadId.current, file: new File([item.text], item.name, { type: 'text/plain' }), text: item.text, state: '待发送', failed: false }]);
        draftInput.current?.focus();
      }
      window.parent.postMessage({ type: 'web-terminal:attachment-received', id: item.id }, '*');
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'web-terminal:composer-ready' }, '*');
    return () => { window.removeEventListener('message', receive); window.parent.postMessage({ type: 'web-terminal:composer-hidden' }, '*'); };
  }, [active]);

  const uploadFile = (file: File) => {
    const id = sessionId, key = token;
    if (!mounted.current) return;
    if (!imageTypes.has(file.type)) { setNotice('仅支持 PNG、JPEG、WebP、GIF 图片'); return; }
    if (file.size > maxUploadBytes) { setNotice('图片超过上传大小限制'); return; }
    const itemId = ++uploadId.current;
    const update = (state: string, failed = false, path?: string) => { if (!mounted.current) return; setUploads(items => items.map(item => item.id === itemId ? { ...item, state, failed, path } : item)); };
    setUploads(items => [...items, { id: itemId, file, state: '排队上传…', failed: false }]);
    uploadQueue.current = uploadQueue.current.catch(() => undefined).then(async () => {
      if (!mounted.current || !uploadsRef.current.some(item => item.id === itemId)) return;
      update('正在上传…');
      const form = new FormData(); form.append('file', file);
      try {
        const result = await api<FileInfo>(key, `/api/sessions/${encodeURIComponent(id)}/uploads`, { method: 'POST', body: form });
        if (!mounted.current) return;
        update('已上传', false, result.path);
      } catch (error) { if (!mounted.current) return; if (error instanceof UnauthorizedError) logout(); else update(errorText(error), true); }
    });
  };
  const sendKey = (data: string): boolean => { if (!activeRef.current) return false; if (socket.current?.readyState !== WebSocket.OPEN || !readyRef.current) { setNotice('连接未就绪，输入未发送'); return false; } claimRef.current(); socket.current.send(JSON.stringify({ type: 'input', data } satisfies ClientMessage)); return true; };
  const sendDraft = async (explicit = false) => {
    if (!activeRef.current || sendingRef.current) return;
    if (!explicit && (composing.current || Date.now() - compositionEnded.current < 80)) return;
    const id = sessionId;
    // 按钮点击已结束编辑，从 DOM 读取输入法刚提交的文字，避免使用上一帧草稿。
    const text = explicit ? draftInput.current?.innerText ?? draft : draft;
    if (!id || (!text.trim() && !uploadsRef.current.length)) return;
    const sentUploadId = uploadId.current;
    sendingRef.current = true; setSending(true);
    try {
      await uploadQueue.current;
      if (!mounted.current || !activeRef.current) return;
      const attachments = uploadsRef.current.filter(item => item.id <= sentUploadId);
      if (attachments.some(item => item.failed)) { setNotice('图片尚未上传成功，请重试或移除后发送'); return; }
      if (!readyRef.current) { setNotice('连接未就绪，文字已保留'); return; }
      if (socket.current?.readyState === WebSocket.OPEN) {
        const payload = [text, ...attachments.map(item => item.text ?? (item.path ? quoteForShell(item.path) : ''))].filter(Boolean).join('\n');
        if (!payload.trim()) return;
        claimRef.current(); socket.current.send(JSON.stringify({ type: 'paste', text: payload, submit: true } satisfies ClientMessage));
        setDraft(value => value === text ? '' : value);
        setUploads(items => items.filter(item => item.id > sentUploadId));
      }
    } finally { sendingRef.current = false; if (mounted.current) setSending(false); }
  };
  const onPaste = (event: React.ClipboardEvent) => { const files = [...event.clipboardData.items].filter(item => item.kind === 'file' && imageTypes.has(item.type)).flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; }); if (files.length) { event.preventDefault(); event.stopPropagation(); files.forEach(uploadFile); } };
  const onDrop = (event: React.DragEvent) => { event.preventDefault(); [...event.dataTransfer.files].filter(f => imageTypes.has(f.type)).forEach(uploadFile); };
  useEffect(() => () => { if (hoverUrl.current) URL.revokeObjectURL(hoverUrl.current); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);


  useEffect(() => {
    if (active) activateRef.current();
    else { revokeHover(); termRef.current?.blur(); composing.current = false; copyModeRef.current = false; updateInputFocusRef.current(); setCopyMode(false); cancelTouchRef.current(); }
  }, [active, revokeHover]);

  return <div className="content session-pane" hidden={!active} data-session-id={sessionId}><div className="terminal-pane"><div className="terminal-wrap" onPasteCapture={onPaste} onDrop={onDrop} onDragOver={e => e.preventDefault()}><div ref={terminalHost} className="terminal-host" /></div><div className="composer-dock"><div className="composer-panel" onPasteCapture={onPaste} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
        {uploads.length > 0 && <div className="composer-attachments" aria-label="待发送附件">
          <span className="attachment-count" title={`${uploads.length} 个附件`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m21 11.5-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.9-2.9l8.5-8.5" /></svg> {uploads.length}</span>
          <div className="attachment-list">{uploads.map(item => <div key={item.id} className={`attachment-card ${item.failed ? 'error' : ''}`}>
            {item.text !== undefined ? <pre className="attachment-text">{item.text}</pre> : <UploadThumbnail file={item.file} />}
            <div className="attachment-caption"><span title={item.file.name}>{item.text !== undefined ? '▤ ' : ''}{item.file.name}</span><button aria-label={`移除 ${item.file.name}`} onClick={() => setUploads(items => items.filter(x => x.id !== item.id))}>×</button></div>
            <div className="attachment-status" title={item.state}>{item.state}{item.failed && <button onClick={() => { setUploads(items => items.filter(x => x.id !== item.id)); uploadFile(item.file); }}>重试</button>}</div>
          </div>)}</div>
          <button className="attachment-clear" onClick={() => setUploads(() => [])}>全部清除</button>
        </div>}
        <div className="draft-row"><DraftInput ref={draftInput} style={{ fontFamily }} aria-label="待发送文字" onFocus={() => claimRef.current()} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; compositionEnded.current = Date.now(); }} value={draft} onChange={setDraft} onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && Date.now() - compositionEnded.current >= 80) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) void sendDraft(); }
        }} placeholder="输入命令或描述…" /></div>
        <div className="mobile-keys" data-preserve-input-focus role="toolbar" aria-label="触屏终端快捷键"><button disabled={status !== '已连接'} onClick={() => sendKey('\t')}>Tab</button>{([['left', '←', '左方向键'], ['up', '↑', '上方向键'], ['down', '↓', '下方向键'], ['right', '→', '右方向键']] as const).map(([direction, label, title]) => <button key={direction} aria-label={title} title={title} disabled={status !== '已连接'} onClick={() => sendKey(arrowSequence(direction, termRef.current?.modes.applicationCursorKeysMode ?? false))}>{label}</button>)}</div>
        <div className="composer-actions">
          <div className="composer-tools" role="toolbar" aria-label="终端操作">
            <button className="attach-image" title="添加图片，也可粘贴或拖入" aria-label="添加图片" onClick={() => fileInput.current?.click()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11.5-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.9-2.9l8.5-8.5" /></svg></button>
            <span className="composer-divider" />
            <button data-preserve-input-focus title="发送 Esc" disabled={status !== '已连接'} onClick={() => sendKey('\x1b')}>Esc</button>
            <button data-preserve-input-focus title="中断当前程序（Ctrl+C）" aria-label="中断当前程序" disabled={status !== '已连接'} onClick={() => sendKey('\x03')}>Ctrl C</button>
            <button className="copy-mode-toggle" title={copyMode ? '退出复制模式，恢复手指滚屏' : '进入复制模式，手指拖动选字'} aria-label="复制模式" aria-pressed={copyMode} onClick={() => setCopyMode(value => !value)}>{copyMode ? '退出复制' : '复制'}</button>
          </div>
          <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
          <button className="composer-send" title={status === '已连接' ? '发送到当前会话' : status} onClick={() => void sendDraft(true)} disabled={(!draft.trim() && !uploads.length) || sending || status !== '已连接'}>{sending ? '等待上传…' : status !== '已连接' ? '未连接' : '发送'}<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg></button>
        </div>
      </div></div></div>{preview && <FilePreviewDialog preview={preview} onClose={revokePreview} onCopy={() => void navigator.clipboard.writeText(preview.file.path).then(() => setNotice('路径已复制')).catch(error => setNotice(`复制失败：${errorText(error)}`))} onDownload={() => void download(preview.file)} />}<input ref={fileInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; files.forEach(uploadFile); }} />{hover?.url && <div className="hover-card" style={{ left: Math.min(hover.x + 16, window.innerWidth - 240), top: Math.min(hover.y + 16, window.innerHeight - 220) }}><img src={hover.url} alt={hover.file.name} /><span>{hover.file.name}</span></div>}</div>;
}
