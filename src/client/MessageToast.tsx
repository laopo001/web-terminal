import { useEffect } from 'react';

export function MessageToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  return <div className="message-layer">
    <div className="message-toast" role="status" aria-live="polite" aria-atomic="true">
      <span className="message-icon" aria-hidden="true">i</span>
      <span className="message-text">{message}</span>
      <button className="message-close" aria-label="关闭通知" onClick={onClose}>×</button>
    </div>
  </div>;
}
