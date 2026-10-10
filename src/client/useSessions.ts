import { useEffect, useState } from 'react';
import type { ClientMessage, ServerMessage, SessionInfo } from '../shared/protocol';
import { api } from './api';

/** 会话状态订阅覆盖所有标签，不连接 PTY，也不参与尺寸控制。 */
export function useSessions(token: string | null, onUnauthorized: () => void, onError: (error: unknown, message: string) => void) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reachable, setReachable] = useState(false);
  useEffect(() => {
    if (!token) { setSessions([]); setLoaded(false); setReachable(false); return; }
    let disposed = false, received = false, retry = 0;
    let socket: WebSocket | undefined, timer: number | undefined;
    // 初始 HTTP 请求只用于加载；收到推送后不让较早的响应覆盖新状态。
    void api<SessionInfo[]>(token, '/api/sessions').then(list => {
      if (disposed || received) return;
      setSessions(list); setLoaded(true);
    }).catch(error => { if (!disposed && !received) onError(error, '加载会话失败'); });
    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket = ws;
      ws.onopen = () => { if (!disposed && socket === ws) ws.send(JSON.stringify({ type: 'auth', protocol: 2, token, scope: 'sessions' } satisfies ClientMessage)); };
      ws.onmessage = event => {
        if (disposed || socket !== ws) return;
        let message: ServerMessage;
        try { message = JSON.parse(event.data); } catch { onError(new Error('收到无效的会话状态'), '会话同步失败'); return; }
        if (message.type === 'sessions') {
          received = true; retry = 0;
          setSessions(message.sessions); setLoaded(true); setReachable(true);
        } else if (message.type === 'error') onError(new Error(message.message), '会话同步失败');
      };
      ws.onclose = event => {
        if (disposed || socket !== ws) return;
        setReachable(false);
        if (event.code === 4401) { onUnauthorized(); return; }
        if (event.code === 4404 || event.code === 4406) { onError(new Error('请更新并重启服务，再刷新页面'), '会话状态订阅不可用'); return; }
        timer = window.setTimeout(connect, Math.min(30_000, 700 * 2 ** Math.min(++retry, 6)));
      };
      ws.onerror = () => { if (!disposed && socket === ws) setReachable(false); };
    };
    connect();
    return () => { disposed = true; clearTimeout(timer); socket?.close(); };
  }, [token, onUnauthorized, onError]);
  return { sessions, setSessions, loaded, reachable };
}
