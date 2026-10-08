import { useEffect, useRef, useState } from 'react';
import { defaultClientSettings, type ClientSettings, type InteractionMode } from './clientSettings';

export function SettingsDialog({ value, defaultFont, onSave, onClose }: {
  value: ClientSettings; defaultFont: string; onSave: (settings: ClientSettings) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [font, setFont] = useState(value.fontFamily);
  const [interactionMode, setInteractionMode] = useState(value.interactionMode);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current!;
    dialog.querySelector<HTMLButtonElement>('[data-settings-cancel]')!.autofocus = true;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="session-close-dialog client-settings" aria-labelledby="client-settings-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      const next = font.trim();
      if (next && !CSS.supports('font-family', next)) { setError('请输入有效的字体名称或字体列表'); return; }
      try { onSave({ fontFamily: next, interactionMode }); } catch { setError('无法保存设置，请检查客户端存储权限'); }
    }}>
      <h2 id="client-settings-title">设置</h2>
      <section className="settings-section" aria-labelledby="settings-font-title">
        <h3 id="settings-font-title">字体</h3>
        <label htmlFor="terminal-font">终端字体</label>
        <input id="terminal-font" value={font} onChange={event => { setFont(event.target.value); setError(''); }} placeholder={defaultFont} />
        <p>填写本机已安装的字体名称，多个字体用逗号分隔。留空使用默认字体。设置同时用于终端和待发送文字，并保存在当前客户端。</p>
        <p>终端英文建议使用等宽字体，避免字间距异常。Windows 默认英文优先使用 Cascadia Code，未安装时使用 Consolas，中文使用微软雅黑。</p>
        <div className="font-preview" style={{ fontFamily: font.trim() && CSS.supports('font-family', font.trim()) ? font : defaultFont }}>中文字体预览 AaBb 0123456789</div>
      </section>
      <section className="settings-section" aria-labelledby="settings-interaction-title">
        <h3 id="settings-interaction-title">选择与复制</h3>
        <label htmlFor="interaction-mode">交互模式</label>
        <select id="interaction-mode" value={interactionMode} onChange={event => setInteractionMode(event.target.value as InteractionMode)}>
          <option value="native">CLI 原生</option><option value="local">本地选字</option>
        </select>
        <p>CLI 原生：点击和拖动交给程序，使用程序自己的选择与复制。</p>
        <p>触屏平时滑动滚屏；点击底部“复制”进入选字模式，再次点击退出。</p>
        <p>本地选字：鼠标拖选，触屏进入复制模式后拖动选字，再点复制。</p>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="session-close-actions"><button type="button" onClick={() => { setFont(defaultClientSettings.fontFamily); setInteractionMode(defaultClientSettings.interactionMode); }}>恢复默认</button><button type="button" data-settings-cancel onClick={onClose}>取消</button><button type="submit" className="primary">保存</button></div>
    </form>
  </dialog>;
}
