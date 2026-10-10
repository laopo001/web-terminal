import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type DragEvent } from 'react';
import type { SessionInfo } from '../shared/protocol';
import { groupColorStyles, sessionGroupColors, sessionTabBlocks, itemKey, type SessionGroup, type TabItem, type TabDrop } from './sessionGroups';
import { useSessionGroups } from './useSessionGroups';
import { SessionGroupDialog } from './SessionGroupDialog';
import { TabMenu, type TabMenuPosition } from './TabMenu';

export function sessionLabel(session: SessionInfo) {
  const command = session.processName?.replace(/^.*\//, '') || '';
  const agent = /^(codex|claude)(?:$|[-.])/i.exec(command)?.[1]?.toLowerCase();
  const folder = session.cwd.replace(/\/+$/, '').split('/').pop() || '/';
  let title = session.title?.replace(/^[\u2800-\u28ff]\s*/, '').trim();
  if (title?.endsWith(` | ${folder}`)) title = title.slice(0, -folder.length - 3).trim();
  // Shell 的标题经常包含整条命令；仅采用已识别 CLI 主动提供的会话标题。
  const commandTitle = /^(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)*(?:exec\s+)?(?:\S*\/)?(?:codex|claude)(?:\s|$)/i.test(title || '');
  const name = agent && title && title !== folder && !commandTitle && !title.toLowerCase().startsWith(command.toLowerCase())
    ? title : command || session.name;
  return { name, folder, agent };
}

export function SessionTabs({ sessions, selected, reachable, onSelect, onClose, sessionsReady, onNotice }: {
  sessions: SessionInfo[]; selected: string | null; reachable: boolean;
  onSelect: (id: string) => void; onClose: (session: SessionInfo) => void;
  sessionsReady: boolean; onNotice: (message: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const { layout, change } = useSessionGroups(sessions, sessionsReady, onNotice);
  const groups = layout.groups;
  const [menu, setMenu] = useState<(TabMenuPosition & ({ kind: 'session'; session: SessionInfo } | { kind: 'group'; group: SessionGroup })) | null>(null);
  const [editing, setEditing] = useState<{ group: SessionGroup } | { session: SessionInfo } | null>(null);
  const [dragged, setDragged] = useState<TabItem | null>(null);
  const [dropTarget, setDropTarget] = useState<TabDrop | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const toggleGroup = (id: string) => change({ type: 'toggle', id });
  function position(event: MouseEvent<HTMLElement>, context: boolean): TabMenuPosition {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: context && event.clientX ? event.clientX : rect.left, y: context && event.clientY ? event.clientY : rect.bottom + 4, anchor: event.currentTarget.matches('button') ? event.currentTarget : event.currentTarget.querySelector('button') };
  }
  function sessionMenu(event: MouseEvent<HTMLElement>, session: SessionInfo, context = false) {
    event.preventDefault(); setMenu({ ...position(event, context), kind: 'session', session });
  }
  function groupMenu(event: MouseEvent<HTMLElement>, group: SessionGroup, context = false) {
    event.preventDefault(); setMenu({ ...position(event, context), kind: 'group', group });
  }
  const assign = (session: SessionInfo, groupId: string | null) => { closeMenu(); change({ type: 'assign', sessionId: session.id, groupId }); };
  const stopDrag = () => { setDragged(null); setDropTarget(null); };
  function startDrag(event: DragEvent<HTMLElement>, item: TabItem) {
    closeMenu(); setDragged(item);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', itemKey(item));
  }
  function over(event: DragEvent<HTMLElement>, target: TabDrop) {
    if (!dragged) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    setDropTarget(previous => JSON.stringify(previous) === JSON.stringify(target) ? previous : target);
    const element = list.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      if (event.clientX < rect.left + 24) element.scrollLeft -= 12;
      else if (event.clientX > rect.right - 24) element.scrollLeft += 12;
    }
  }
  function drop(event: DragEvent<HTMLElement>, target: TabDrop) {
    if (!dragged) return;
    event.preventDefault(); event.stopPropagation();
    change({ type: 'drop', item: dragged, target }); stopDrag();
  }
  function sessionDrop(event: DragEvent<HTMLElement>, id: string): TabDrop {
    const rect = event.currentTarget.getBoundingClientRect();
    return { kind: 'session', id, side: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' };
  }
  const collapsedKey = groups.map(group => `${group.id}:${group.collapsed}`).join(',');
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const reveal = () => (element.querySelector('.session.active') || element.querySelector('.session-group-label.active'))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal); observer.observe(element);
    return () => observer.disconnect();
  }, [selected, collapsedKey]);
  const renderSession = (session: SessionInfo) => {
    const { name, folder, agent } = sessionLabel(session);
    const active = selected === session.id;
    const state = !reachable ? 'offline' : session.running ? 'live' : 'ended';
    const hint = !reachable ? '状态同步已断开' : session.running ? '会话运行中' : '会话已结束';
    const outputActive = state === 'live' && !!session.outputActive;
    const placement = dropTarget?.kind === 'session' && dropTarget.id === session.id ? ` drop-${dropTarget.side}` : '';
    return <div className={`session ${active ? 'active' : ''}${placement}${dragged?.kind === 'session' && dragged.id === session.id ? ' dragging' : ''}`} key={session.id} data-session-id={session.id}
      draggable onDragStart={event => startDrag(event, {kind:'session',id:session.id})} onDragEnd={stopDrag}
      onDragOver={event => over(event, sessionDrop(event, session.id))} onDrop={event => drop(event, sessionDrop(event, session.id))}
      onContextMenu={event => sessionMenu(event, session, true)}>
      <button className="session-select" draggable aria-pressed={active} title={`${name}\n${session.cwd}\n${hint}\n拖动可排序，拖到组名加入分组`} onClick={() => onSelect(session.id)}>
        <span className={`dot ${state}${outputActive ? ' output-active' : ''}`} aria-label={outputActive ? '终端正在输出' : hint} />
        {agent && <span className={`command-icon ${agent}`} aria-label={agent}>{agent === 'claude' ? '✳' : '›_'}</span>}
        <strong>{name}</strong><small>{folder}</small>
      </button>
      <button className="tab-more" aria-label={`${name} 的标签菜单`} title="标签菜单（也可右键标签）" aria-haspopup="menu" aria-expanded={menu?.kind === 'session' && menu.session.id === session.id} onClick={event => sessionMenu(event, session)}>⋯</button>
      <button className="end" aria-label={`结束 ${name}`} title={`结束 ${name}`} onClick={() => onClose(session)}>×</button>
    </div>;
  };
  const currentGroup = menu?.kind === 'session' ? groups.find(group => group.sessionIds.includes(menu.session.id)) : undefined;
  const moveMenu = (item: TabItem, inGroup = false) => <><hr />
    <button role="menuitem" onClick={() => { change({type:'move',item,direction:'first'}); closeMenu(); list.current?.scrollTo({left:0}); }}>{inGroup ? '移到组内最前面' : '移到最前面'}</button>
    <button role="menuitem" onClick={() => { change({type:'move',item,direction:-1}); closeMenu(); }}>向前移动</button>
    <button role="menuitem" onClick={() => { change({type:'move',item,direction:1}); closeMenu(); }}>向后移动</button>
  </>;
  return <>
    <div ref={list} className={`session-list${dropTarget?.kind === 'end' ? ' drop-end' : ''}`} aria-label="终端标签" onDragOver={event => over(event,{kind:'end'})} onDrop={event => drop(event,{kind:'end'})}>
      {sessionTabBlocks(sessions, layout).map(block => {
        if (!block.group) return renderSession(block.sessions[0]);
        const group = block.group;
        const folded = group.collapsed;
        const active = block.sessions.some(session => session.id === selected);
        const activeOutput = reachable && block.sessions.some(session => session.running && session.outputActive);
        return <div key={group.id} className={`session-group ${folded ? 'collapsed' : ''}${dragged?.kind === 'group' && dragged.id === group.id ? ' dragging' : ''}`} data-group-id={group.id} role="group" aria-label={group.name}
          style={{ '--group-color': groupColorStyles[group.color].color } as CSSProperties}>
          <div className={`session-group-header${dropTarget?.kind === 'group' && dropTarget.id === group.id ? ' drop-group' : ''}`} draggable
            onDragStart={event => startDrag(event,{kind:'group',id:group.id})} onDragEnd={stopDrag}
            onDragOver={event => over(event,{kind:'group',id:group.id})} onDrop={event => drop(event,{kind:'group',id:group.id})}
            onContextMenu={event => groupMenu(event, group, true)}>
            <button className={`session-group-label ${active ? 'active' : ''}`} draggable aria-expanded={!folded}
              aria-label={`${folded ? '展开' : '折叠'}分组 ${group.name}（${block.sessions.length} 个标签）`} title={`${group.name} · ${block.sessions.length} 个标签，点击${folded ? '展开' : '折叠'}，拖动可排序`}
              onClick={() => toggleGroup(group.id)}><span className="group-chevron" aria-hidden="true">{folded ? '›' : '⌄'}</span><span className="group-name">{group.name}</span><span className="group-count">{block.sessions.length}</span>{folded && activeOutput && <span className="group-output" aria-label="组内终端正在输出" />}</button>
            <button className="group-more" aria-label={`${group.name} 的分组菜单`} title="编辑分组" aria-haspopup="menu" aria-expanded={menu?.kind === 'group' && menu.group.id === group.id} onClick={event => groupMenu(event, group)}>⋯</button>
          </div>
          {!folded && block.sessions.map(renderSession)}
        </div>;
      })}
    </div>
    {menu && <TabMenu position={menu} onClose={closeMenu}>{menu.kind === 'session' ? <>
      <button role="menuitem" onClick={() => { setEditing({session:menu.session}); closeMenu(); }}>添加到新分组…</button>
      {groups.length > 0 && <div className="tab-menu-caption">移至分组</div>}
      {groups.map(group => <button role="menuitem" key={group.id} disabled={group.id === currentGroup?.id} onClick={() => assign(menu.session,group.id)}><span className="menu-color" style={{background:groupColorStyles[group.color].color}} />{group.name}{group.id === currentGroup?.id && <span className="menu-check">✓</span>}</button>)}
      {currentGroup && <><hr /><button role="menuitem" onClick={() => assign(menu.session,null)}>移出分组</button></>}
      {moveMenu({kind:'session',id:menu.session.id},!!currentGroup)}
    </> : <>
      <button role="menuitem" onClick={() => { setEditing({group:menu.group}); closeMenu(); }}>编辑名称和颜色…</button>
      <button role="menuitem" onClick={() => { toggleGroup(menu.group.id); closeMenu(); }}>{menu.group.collapsed ? '展开分组' : '折叠分组'}</button>
      <hr /><button role="menuitem" onClick={() => { change({type:'ungroup',id:menu.group.id}); closeMenu(); }}>取消分组</button>
      {moveMenu({kind:'group',id:menu.group.id})}
    </>}</TabMenu>}
    {editing && <SessionGroupDialog group={'group' in editing ? editing.group : undefined} defaultColor={sessionGroupColors[groups.length % sessionGroupColors.length]} onClose={() => setEditing(null)}
      onSave={(name,color) => {
        if ('group' in editing) change({type:'edit',id:editing.group.id,name,color});
        else change({type:'create',id:globalThis.crypto?.randomUUID?.() || `group-${Date.now()}-${Math.random().toString(36).slice(2)}`,name,color,sessionId:editing.session.id});
        setEditing(null);
      }} />}
  </>;
}
