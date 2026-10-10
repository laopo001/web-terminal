import { useEffect, useRef, useState } from 'react';
import { errorText } from './api';

export function SessionEndedDialog({ cwd, busy, onClose, onCreate }: {
  cwd: string;
  busy: boolean;
  onClose: () => void;
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
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="session-ended-title">会话已结束</h2>
    <p>可以在当前路径新建终端。</p>
    <p className="session-ended-path">{cwd}</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="session-close-actions">
      <button autoFocus disabled={busy} onClick={onClose}>关闭</button>
      <button className="primary" disabled={busy} onClick={() => void create()}>{busy ? '正在创建…' : '在当前路径新建终端'}</button>
    </div>
  </dialog>;
}
