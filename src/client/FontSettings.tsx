import { useEffect, useRef, useState } from 'react';

export function FontSettings({ value, defaultFont, onSave, onClose }: {
  value: string; defaultFont: string; onSave: (font: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [font, setFont] = useState(value);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current!; dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="session-close-dialog font-settings" aria-labelledby="font-settings-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      const next = font.trim();
      if (next && !CSS.supports('font-family', next)) { setError('请输入有效的字体名称或字体列表'); return; }
      try { onSave(next); } catch { setError('无法保存字体设置，请检查客户端存储权限'); }
    }}>
      <h2 id="font-settings-title">字体设置</h2>
      <label htmlFor="terminal-font">终端字体</label>
      <input autoFocus id="terminal-font" value={font} onChange={event => { setFont(event.target.value); setError(''); }} placeholder={defaultFont} />
      <p>填写本机已安装的字体名称，多个字体用逗号分隔。留空使用默认字体。设置同时用于终端和待发送文字，并保存在当前客户端。</p>
      <p>终端英文建议使用等宽字体，避免字间距异常。Windows 默认英文优先使用 Cascadia Code，未安装时使用 Consolas，中文使用微软雅黑。</p>
      <div className="font-preview" style={{ fontFamily: font.trim() && CSS.supports('font-family', font.trim()) ? font : defaultFont }}>中文字体预览 AaBb 0123456789</div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="session-close-actions"><button type="button" onClick={() => setFont('')}>恢复默认</button><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary">保存</button></div>
    </form>
  </dialog>;
}
