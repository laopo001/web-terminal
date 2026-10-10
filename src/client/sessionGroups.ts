import type { SessionInfo } from '../shared/protocol';

export const tabLayoutStorageKey = 'web-terminal.tabLayout';
export const sessionGroupColors = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'gray'] as const;
export type SessionGroupColor = typeof sessionGroupColors[number];
export interface SessionGroup { id: string; name: string; color: SessionGroupColor; collapsed: boolean; sessionIds: string[] }
export interface TabLayout { order: string[]; groups: SessionGroup[] }
export type TabItem = { kind: 'session' | 'group'; id: string };
export type TabDrop = { kind: 'session'; id: string; side: 'before' | 'after' } | { kind: 'group'; id: string } | { kind: 'end' };
export type TabLayoutAction =
  | { type: 'create'; id: string; sessionId: string; name: string; color: SessionGroupColor }
  | { type: 'edit'; id: string; name: string; color: SessionGroupColor }
  | { type: 'assign'; sessionId: string; groupId: string | null }
  | { type: 'ungroup'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'move'; item: TabItem; direction: 'first' | -1 | 1 }
  | { type: 'drop'; item: TabItem; target: TabDrop };

export const groupColorStyles: Record<SessionGroupColor, { label: string; color: string }> = {
  blue: { label: '蓝色', color: '#89b4fa' }, cyan: { label: '青色', color: '#79d3df' },
  green: { label: '绿色', color: '#8ed8a2' }, yellow: { label: '黄色', color: '#efcf79' },
  orange: { label: '橙色', color: '#efa76c' }, red: { label: '红色', color: '#eb8b8b' },
  purple: { label: '紫色', color: '#bb9bea' }, pink: { label: '粉色', color: '#e9a0cb' },
  gray: { label: '灰色', color: '#a8b2bf' },
};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
export const itemKey = (item: TabItem) => `${item.kind}:${item.id}`;
const memberGroup = (layout: TabLayout, id: string) => layout.groups.find(group => group.sessionIds.includes(id));

export function parseTabLayout(value: unknown): TabLayout {
  if (!value || typeof value !== 'object') return { order: [], groups: [] };
  const raw = value as Partial<TabLayout>;
  const groups: SessionGroup[] = [];
  for (const record of Array.isArray(raw.groups) ? raw.groups : []) {
    if (!record || typeof record.id !== 'string' || groups.some(group => group.id === record.id)
      || typeof record.name !== 'string' || !record.name.trim() || !sessionGroupColors.includes(record.color)) continue;
    groups.push({ id: record.id, name: record.name.trim().slice(0, 40), color: record.color, collapsed: record.collapsed === true, sessionIds: strings(record.sessionIds) });
  }
  return { order: strings(raw.order), groups };
}
export function loadTabLayout(): TabLayout {
  try { return parseTabLayout(JSON.parse(localStorage.getItem(tabLayoutStorageKey) || 'null')); }
  catch { return { order: [], groups: [] }; }
}
export function saveTabLayout(layout: TabLayout) { localStorage.setItem(tabLayoutStorageKey, JSON.stringify(layout)); }

/** 只在收到完整会话列表后清理；新会话追加到本机自定义顺序的末尾。 */
export function reconcileTabLayout(layout: TabLayout, ids: string[]): TabLayout {
  const known = new Set(ids), assigned = new Set<string>();
  const groups = layout.groups.map(group => ({ ...group, sessionIds: group.sessionIds.filter(id => {
    if (!known.has(id) || assigned.has(id)) return false;
    assigned.add(id); return true;
  }) })).filter(group => group.sessionIds.length);
  const valid = new Set([...groups.map(group => itemKey({ kind: 'group', id: group.id })), ...ids.filter(id => !assigned.has(id)).map(id => itemKey({ kind: 'session', id }))]);
  const order = [...new Set(layout.order.filter(key => valid.has(key)))];
  for (const key of valid) if (!order.includes(key)) order.push(key);
  return { order, groups };
}

export function updateTabLayout(previous: TabLayout, ids: string[], action: TabLayoutAction): TabLayout {
  const layout = reconcileTabLayout(previous, ids);
  const clean = () => reconcileTabLayout(layout, ids);
  const detach = (id: string) => {
    layout.order = layout.order.filter(key => key !== itemKey({ kind: 'session', id }));
    for (const group of layout.groups) group.sessionIds = group.sessionIds.filter(member => member !== id);
  };
  const move = (array: string[], key: string, direction: 'first' | -1 | 1) => {
    const index = array.indexOf(key);
    if (index < 0) return;
    const target = direction === 'first' ? 0 : Math.max(0, Math.min(array.length - 1, index + direction));
    array.splice(index, 1); array.splice(target, 0, key);
  };
  if (action.type === 'create') {
    if (!ids.includes(action.sessionId) || layout.groups.some(group => group.id === action.id)) return layout;
    const previousGroup = memberGroup(layout, action.sessionId);
    const oldKey = previousGroup ? itemKey({ kind: 'group', id: previousGroup.id }) : itemKey({ kind: 'session', id: action.sessionId });
    const index = layout.order.indexOf(oldKey);
    detach(action.sessionId);
    layout.groups.push({ id: action.id, name: action.name.trim(), color: action.color, collapsed: false, sessionIds: [action.sessionId] });
    layout.order.splice(index < 0 ? layout.order.length : index, 0, itemKey({ kind: 'group', id: action.id }));
  } else if (action.type === 'edit' || action.type === 'toggle') {
    const group = layout.groups.find(group => group.id === action.id);
    if (group) {
      if (action.type === 'toggle') group.collapsed = !group.collapsed;
      else { group.name = action.name.trim(); group.color = action.color; }
    }
  } else if (action.type === 'ungroup') {
    const group = layout.groups.find(group => group.id === action.id);
    if (!group) return layout;
    const index = layout.order.indexOf(itemKey({ kind: 'group', id: group.id }));
    layout.order.splice(index, 1, ...group.sessionIds.map(id => itemKey({ kind: 'session', id })));
    layout.groups = layout.groups.filter(candidate => candidate !== group);
  } else if (action.type === 'assign') {
    if (!ids.includes(action.sessionId)) return layout;
    const target = action.groupId === null ? undefined : layout.groups.find(group => group.id === action.groupId);
    if (action.groupId !== null && !target) return layout;
    if (target?.sessionIds.includes(action.sessionId)) return layout;
    const oldGroup = memberGroup(layout, action.sessionId);
    if (!target && !oldGroup) return layout;
    const oldIndex = layout.order.indexOf(oldGroup ? itemKey({ kind: 'group', id: oldGroup.id }) : itemKey({ kind: 'session', id: action.sessionId }));
    detach(action.sessionId);
    if (target) { target.sessionIds.push(action.sessionId); target.collapsed = false; }
    else layout.order.splice(oldIndex + 1, 0, itemKey({ kind: 'session', id: action.sessionId }));
  } else if (action.type === 'move') {
    const group = action.item.kind === 'session' ? memberGroup(layout, action.item.id) : undefined;
    move(group ? group.sessionIds : layout.order, group ? action.item.id : itemKey(action.item), action.direction);
  } else if (action.type === 'drop') {
    const { item, target } = action;
    if (target.kind === 'group' && !layout.groups.some(group => group.id === target.id) || target.kind === 'session' && !ids.includes(target.id)) return layout;
    if (item.kind === 'session' && (!ids.includes(item.id) || target.kind === 'session' && target.id === item.id)) return layout;
    const destinationGroup = target.kind === 'group' ? layout.groups.find(group => group.id === target.id) : target.kind === 'session' ? memberGroup(layout, target.id) : undefined;
    if (item.kind === 'group') {
      const sourceKey = itemKey(item);
      const targetKey = destinationGroup ? itemKey({ kind: 'group', id: destinationGroup.id }) : target.kind === 'session' ? itemKey(target) : undefined;
      if (!layout.order.includes(sourceKey) || sourceKey === targetKey) return layout;
      layout.order = layout.order.filter(key => key !== sourceKey);
      const index = targetKey ? layout.order.indexOf(targetKey) : -1;
      layout.order.splice(index < 0 ? layout.order.length : index + (target.kind === 'session' && target.side === 'after' ? 1 : 0), 0, sourceKey);
    } else {
      if (target.kind === 'group' && !destinationGroup || target.kind === 'session' && !ids.includes(target.id)) return layout;
      detach(item.id);
      if (destinationGroup) {
        const index = target.kind === 'session' ? destinationGroup.sessionIds.indexOf(target.id) : -1;
        destinationGroup.sessionIds.splice(index < 0 ? destinationGroup.sessionIds.length : index + (target.kind === 'session' && target.side === 'after' ? 1 : 0), 0, item.id);
      } else {
        const index = target.kind === 'session' ? layout.order.indexOf(itemKey(target)) : -1;
        layout.order.splice(index < 0 ? layout.order.length : index + (target.kind === 'session' && target.side === 'after' ? 1 : 0), 0, itemKey(item));
      }
    }
  }
  return clean();
}

export function sessionTabBlocks(sessions: SessionInfo[], layout: TabLayout): { group?: SessionGroup; sessions: SessionInfo[] }[] {
  const byId = new Map(sessions.map(session => [session.id, session]));
  const current = reconcileTabLayout(layout, sessions.map(session => session.id));
  return current.order.flatMap(key => {
    if (key.startsWith('session:')) { const session = byId.get(key.slice(8)); return session ? [{ sessions: [session] }] : []; }
    const group = current.groups.find(group => group.id === key.slice(6));
    return group ? [{ group, sessions: group.sessionIds.map(id => byId.get(id)!) }] : [];
  });
}
