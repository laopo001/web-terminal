import { useEffect, useRef } from 'react';
import type { FilePreview } from './api';

export function FilePreviewDialog({ preview, onClose, onCopy, onDownload }: {
  preview: FilePreview; onClose: () => void; onCopy: () => void; onDownload: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  const { file, loading, error, url, text } = preview;
  return <dialog ref={ref} className="file-preview-dialog" aria-labelledby="file-preview-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === ref.current) { const rect = ref.current!.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header><h2 id="file-preview-title" title={file.path}>{file.name}</h2><button autoFocus aria-label="关闭文件预览" onClick={onClose}>×</button></header>
    <p className="file-path">{file.path}</p>
    <div className="file-preview-content">
      {loading && <p role="status">正在加载预览…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!loading && !error && text !== undefined && <pre>{text}</pre>}
      {!loading && !error && url && <img src={url} alt={file.name} />}
      {!loading && !error && text === undefined && !url && <p>此文件暂不支持直接预览，可下载查看。</p>}
    </div>
    <footer><span>{(file.size / 1024).toFixed(1)} KB</span><button onClick={onCopy}>复制路径</button><button className="primary" disabled={loading} onClick={onDownload}>下载文件</button></footer>
  </dialog>;
}
