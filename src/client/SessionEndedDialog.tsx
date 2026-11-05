import { useEffect, useRef, useState } from 'react';
import { errorText } from './api';

export function SessionEndedDialog({ cwd, busy, error: closeError, onCancel, onCloseTab, onCreate }: {
  cwd: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onCloseTab: () => void;
  onCreate: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const create = async () => {
    setError('');
    try { await onCreate(); } catch (error) { setError(errorText(error)); }
  };
  return <dialog ref={ref} className="session-close-dialog session-ended-dialog" aria-labelledby="session-ended-title"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <button className="session-ended-cancel" aria-label="取消" title="取消" disabled={busy} onClick={onCancel}>×</button>
    <h2 id="session-ended-title">会话已结束</h2>
    <p>可以在当前路径重新打开终端。</p>
    <p className="session-ended-path">{cwd}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {closeError && <p className="error" role="alert">{closeError}</p>}
    <div className="session-close-actions">
      <button disabled={busy} onClick={onCloseTab}>关闭</button>
      <button className="primary" disabled={busy} onClick={() => void create()}>{busy ? '正在创建…' : '在当前路径重新打开终端'}</button>
    </div>
  </dialog>;
}
