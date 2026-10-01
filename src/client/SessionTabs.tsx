import { useEffect, useRef } from 'react';
import type { SessionInfo } from '../shared/protocol';

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

export function SessionTabs({ sessions, selected, status, reachable, onSelect, onClose }: {
  sessions: SessionInfo[]; selected: string | null; status: string; reachable: boolean;
  onSelect: (id: string) => void; onClose: (session: SessionInfo) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const reveal = () => element.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected]);
  return <div ref={list} className="session-list" aria-label="终端标签">{sessions.map(session => {
    const { name, folder, agent } = sessionLabel(session);
    const active = selected === session.id;
    const state = !reachable ? 'offline' : !session.running ? 'ended'
      : active ? status === '已连接' ? 'live' : status.includes('连接中') || status.includes('重连中') ? 'connecting' : 'offline' : 'live';
    const hint = !reachable ? '无法连接服务' : !session.running ? '会话已结束' : active ? status : '会话运行中';
    return <div className={`session ${active ? 'active' : ''}`} key={session.id}>
      <button className="session-select" aria-pressed={active} title={`${name}\n${session.cwd}\n${hint}`} onClick={() => onSelect(session.id)}>
        <span className={`dot ${state}`} aria-label={hint} />
        {agent && <span className={`command-icon ${agent}`} aria-label={agent}>{agent === 'claude' ? '✳' : '›_'}</span>}
        <strong>{name}</strong><small>{folder}</small>
      </button>
      <button className="end" title={`结束 ${name}`} onClick={() => onClose(session)}>×</button>
    </div>;
  })}</div>;
}
