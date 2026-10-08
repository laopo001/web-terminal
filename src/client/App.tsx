import { useCallback, useEffect, useState } from 'react';
import type { ServerInfo, SessionInfo } from '../shared/protocol';
import { api, errorText, UnauthorizedError } from './api';
import { CloseSessionDialog } from './CloseSessionDialog';
import { MessageToast } from './MessageToast';
import { DirectoryPicker } from './DirectoryPicker';
import { useWorkspaceFolders } from './useWorkspaceFolders';
import { SessionTabs } from './SessionTabs';
import { SessionPane } from './SessionPane';
import { useVisualViewport } from './useVisualViewport';
import { FontSettings } from './FontSettings';
import { defaultTerminalFont, loadTerminalFont, saveTerminalFont } from './terminalFont';

const tokenKey = 'web-terminal.token';

export default function App() {
  useVisualViewport();
  const [customFont, setCustomFont] = useState(loadTerminalFont);
  const [fontSettingsOpen, setFontSettingsOpen] = useState(false);
  const defaultFont = defaultTerminalFont(navigator.platform);
  const fontFamily = customFont || defaultFont;
  const [token, setToken] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authValue, setAuthValue] = useState('');
  const [authError, setAuthError] = useState('');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reachable, setReachable] = useState(true);
  const [notice, setNoticeState] = useState({ id: 0, text: '' });
  const setNotice = useCallback((text: string) => setNoticeState(previous => ({ id: previous.id + 1, text })), []);
  const clearNotice = useCallback(() => setNoticeState(previous => ({ ...previous, text: '' })), []);
  const [busy, setBusy] = useState(false);
  const workspaceFolders = useWorkspaceFolders();
  const [creating, setCreating] = useState(false);
  const [pendingClose, setPendingClose] = useState<SessionInfo | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const selectSession = useCallback((id: string) => {
    setVisited(list => list.includes(id) ? list : [...list, id]);
    setSelected(id);
  }, []);
  const onStatus = useCallback((id: string, status: string) => setStatuses(previous => previous[id] === status ? previous : { ...previous, [id]: status }), []);
  const logout = useCallback(() => {
    localStorage.removeItem(tokenKey); setToken(null); setSessions([]); setSelected(null);
    setVisited([]); setStatuses({}); setPendingClose(null); setCloseError('');
  }, []);
  const handleApiError = useCallback((error: unknown, message: string) => { if (error instanceof UnauthorizedError) logout(); else setNotice(`${message}：${errorText(error)}`); }, [logout, setNotice]);
  useEffect(() => {
    const ids = new Set(sessions.map(session => session.id));
    setVisited(previous => previous.every(id => ids.has(id)) ? previous : previous.filter(id => ids.has(id)));
    setStatuses(previous => Object.keys(previous).every(id => ids.has(id)) ? previous : Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id))));
  }, [sessions]);
  useEffect(() => {
    const saved = localStorage.getItem(tokenKey);
    if (!saved) { setAuthChecking(false); return; }
    fetch('/api/auth', { headers: { Authorization: `Bearer ${saved}` } }).then(response => {
      if (response.ok) { setToken(saved); }
      else if (response.status === 401) localStorage.removeItem(tokenKey);
      else setAuthError(`验证暂时失败：HTTP ${response.status}。令牌已保留，请重试。`);
    }).catch(() => setAuthError('无法连接服务器。令牌已保留，请重试。')).finally(() => setAuthChecking(false));
  }, []);
  const login = async (value: string) => {
    setAuthError(''); setBusy(true);
    try {
      const response = await fetch('/api/auth', { headers: { Authorization: `Bearer ${value}` } });
      if (!response.ok) throw new Error(response.status === 401 ? '令牌无效' : `HTTP ${response.status}`);
      localStorage.setItem(tokenKey, value); setToken(value); setAuthValue('');
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

  const createSession = async (cwd: string) => {
    if (!token || busy) return; setBusy(true);
    try { const created = await api<SessionInfo>(token, '/api/sessions', { method: 'POST', body: JSON.stringify({ cwd }) }); setSessions(list => [...list, created]); selectSession(created.id); setCreating(false); setNotice('会话已创建'); }
    catch (error) { if (error instanceof UnauthorizedError) logout(); throw error; } finally { setBusy(false); }
  };
  const endSession = async (session: SessionInfo) => {
    if (!token || closing) return;
    setClosing(true); setCloseError('');
    try { await api(token, `/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' }); setSessions(list => list.filter(s => s.id !== session.id)); setSelected(current => current === session.id ? null : current); setPendingClose(null); setNotice('会话已结束'); }
    catch (error) { setCloseError(errorText(error)); handleApiError(error, '结束失败'); }
    finally { setClosing(false); }
  };
  if (authChecking) return <main className="auth-shell"><div className="auth-card"><span className="brand-mark">›_</span><h1>连接终端</h1><p>正在验证保存的访问令牌…</p></div></main>;
  if (!token) return <main className="auth-shell"><form className="auth-card" onSubmit={event => { event.preventDefault(); void login(authValue.trim() || localStorage.getItem(tokenKey) || ''); }}><span className="brand-mark">›_</span><h1>Web Terminal</h1><p>输入访问令牌，连接到你的工作空间。</p><label htmlFor="token">访问令牌</label><input id="token" type="password" autoComplete="off" value={authValue} onChange={e => setAuthValue(e.target.value)} placeholder={localStorage.getItem(tokenKey) ? '已保存令牌，可直接重试' : '粘贴访问令牌'} /><button className="primary" disabled={busy}>连接</button>{authError && <div className="error" role="alert">{authError}</div>}</form></main>;
  return <div className="app"><header className="tabs-bar">
    <SessionTabs sessions={sessions} selected={selected} statuses={statuses} reachable={reachable} onSelect={selectSession} onClose={session => { setCloseError(''); setPendingClose(session); }} />
    <div className="tab-actions"><button title="字体设置" aria-label="字体设置" onClick={() => setFontSettingsOpen(true)}>Aa</button><button title="创建会话" aria-label="创建会话" onClick={() => setCreating(value => !value)}>＋</button></div>
    {creating && <DirectoryPicker token={token} initialPath={workspaceFolders[0]?.path || current?.cwd || info?.defaultCwd || ''} home={info?.defaultCwd || ''} folders={workspaceFolders} busy={busy} onCreate={createSession} onClose={() => setCreating(false)} onUnauthorized={logout} />}
  </header><div className="workspace">
    {!selected && <div className="content"><div className="terminal-pane"><div className="empty-session"><strong>命令行终端</strong><p>{sessions.length ? '选择已有会话继续使用，或新建一个 Shell。' : '新建一个普通 Shell，运行你需要的命令。'}</p><button className="primary" disabled={busy} onClick={() => setCreating(true)}>新建 Shell</button></div></div></div>}
    {sessions.filter(session => visited.includes(session.id)).map(session => <SessionPane key={session.id} session={session} token={token} active={selected === session.id} fontFamily={fontFamily} maxUploadBytes={info?.maxUploadBytes ?? 20 * 1024 * 1024} onNotice={setNotice} onUnauthorized={logout} onStatus={onStatus} setSessions={setSessions} setReachable={setReachable} />)}
  </div>
  {notice.text && <MessageToast key={notice.id} message={notice.text} onClose={clearNotice} />}
  {pendingClose && <CloseSessionDialog name={pendingClose.name} busy={closing} error={closeError} onCancel={() => setPendingClose(null)} onConfirm={() => void endSession(pendingClose)} />}
  {fontSettingsOpen && <FontSettings value={customFont} defaultFont={defaultFont} onClose={() => setFontSettingsOpen(false)} onSave={font => { saveTerminalFont(font); setCustomFont(font); setFontSettingsOpen(false); }} />}
  </div>;
}
