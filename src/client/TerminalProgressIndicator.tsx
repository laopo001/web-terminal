import type { TerminalProgress } from '../shared/protocol';

export function TerminalProgressIndicator({ progress }: { progress: TerminalProgress }) {
  const label = progress.state === 3 ? 'CLI 正在运行' : progress.state === 2 ? `CLI 报告错误 · ${progress.value}%`
    : progress.state === 4 ? `CLI 暂停或警告 · ${progress.value}%` : `CLI 进度 · ${progress.value}%`;
  return <span className={`terminal-progress progress-state-${progress.state}`} title={label} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.state === 3 ? undefined : progress.value}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle className="progress-track" cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" pathLength="100" strokeDasharray={`${progress.state === 3 ? 25 : progress.value} 100`} />
    </svg>
  </span>;
}
