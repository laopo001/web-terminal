import { useEffect, useRef, useState } from 'react';
import type { DirectoryListing, WorkspaceFolder } from '../shared/protocol';
import { api, errorText, UnauthorizedError } from './api';

export function DirectoryPicker({ token, initialPath, home, folders, busy, onCreate, onClose, onUnauthorized }: {
  token: string; initialPath: string; home: string; folders: WorkspaceFolder[]; busy: boolean;
  onCreate: (path: string) => Promise<void>; onClose: () => void; onUnauthorized: () => void;
}) {
  const [path, setPath] = useState(initialPath);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  async function browse(value: string) {
    const request = ++sequence.current;
    setLoading(true); setError(''); setPath(value); setListing(null);
    try {
      const result = await api<DirectoryListing>(token, `/api/directories?path=${encodeURIComponent(value)}`);
      if (sequence.current !== request) return;
      setListing(result); setPath(result.path); setFilter('');
    } catch (cause) {
      if (sequence.current !== request) return;
      if (cause instanceof UnauthorizedError) onUnauthorized();
      else setError(errorText(cause));
    } finally { if (sequence.current === request) setLoading(false); }
  }
  useEffect(() => {
    const element = dialog.current!; element.showModal(); void browse(initialPath);
    return () => { sequence.current++; element.close(); };
  }, []);
  return <dialog ref={dialog} className="directory-picker" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><strong>选择工作目录</strong><button aria-label="关闭路径选择器" disabled={busy} onClick={onClose}>×</button></header>
    {folders.length > 0 && <section className="workspace-shortcuts"><small>VS Code 工作区</small><div>{folders.map(folder => <button key={folder.path} title={folder.path} disabled={busy} onClick={() => void browse(folder.path)}>{folder.name}</button>)}</div></section>}
    <form className="directory-path" onSubmit={event => { event.preventDefault(); void browse(path.trim()); }}>
      <button type="button" aria-label="上级目录" disabled={loading || busy || !listing?.parent} onClick={() => void browse(listing!.parent!)}>↑</button>
      <button type="button" aria-label="默认目录" disabled={busy} onClick={() => void browse(home)}>⌂</button>
      <input aria-label="工作目录" value={path} disabled={busy} onChange={event => setPath(event.target.value)} spellCheck={false} />
      <button disabled={busy || loading || !path.trim()}>前往</button>
    </form>
    <input className="directory-filter" aria-label="筛选文件夹" placeholder="筛选当前目录中的文件夹" value={filter} onChange={event => setFilter(event.target.value)} />
    <div className="directory-entries" aria-label="文件夹列表" aria-busy={loading}>
      {loading ? <p>正在读取目录…</p> : listing?.entries.filter(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(entry => <button key={entry.name} disabled={busy} title={entry.path} onClick={() => void browse(entry.path)}><span aria-hidden="true">▱</span>{entry.name}<span aria-hidden="true">›</span></button>)}
      {!loading && listing && !listing.entries.some(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) && <p>{filter ? '没有匹配的文件夹' : '此目录没有子文件夹'}</p>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || loading || !listing || listing.path !== path} onClick={() => void onCreate(listing!.path).catch(cause => setError(errorText(cause)))}>{busy ? '正在创建…' : '在此创建终端'}</button></footer>
  </dialog>;
}
