import { useEffect, useRef } from 'react';

export function CloseSessionDialog({ name, busy, error, onConfirm, onCancel }: {
  name: string;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="session-close-dialog" aria-labelledby="close-session-title"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="close-session-title">结束“{name}”？</h2>
    <p>这会结束该终端中运行的程序，并删除该会话上传的图片。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="session-close-actions">
      <button autoFocus disabled={busy} onClick={onCancel}>取消</button>
      <button className="primary" disabled={busy} onClick={onConfirm}>{busy ? '正在结束…' : '结束会话'}</button>
    </div>
  </dialog>;
}
