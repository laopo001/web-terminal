import { useEffect, useRef, useState } from 'react';
import { groupColorStyles, sessionGroupColors, type SessionGroup, type SessionGroupColor } from './sessionGroups';
import { errorText } from './api';

export function SessionGroupDialog({ group, defaultColor, onSave, onClose }: {
  group?: SessionGroup; defaultColor: SessionGroupColor;
  onSave: (name: string, color: SessionGroupColor) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(group?.name || '新分组');
  const [color, setColor] = useState(group?.color || defaultColor);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    element.querySelector('input')?.select();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="session-close-dialog session-group-dialog" aria-labelledby="group-dialog-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!name.trim()) { setError('请输入分组名称'); return; }
      try { onSave(name.trim(), color); } catch (cause) { setError(errorText(cause)); }
    }}>
      <h2 id="group-dialog-title">{group ? '编辑分组' : '新建标签分组'}</h2>
      <label htmlFor="session-group-name">名称</label>
      <input id="session-group-name" autoFocus maxLength={40} value={name} onChange={event => { setName(event.target.value); setError(''); }} />
      <fieldset className="group-colors"><legend>颜色</legend>{sessionGroupColors.map(value => <button key={value} type="button"
        aria-label={groupColorStyles[value].label} aria-pressed={color === value} onClick={() => setColor(value)}
        style={{ background: groupColorStyles[value].color }}>{color === value ? '✓' : ''}</button>)}</fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="session-close-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={!name.trim()}>保存</button></div>
    </form>
  </dialog>;
}
