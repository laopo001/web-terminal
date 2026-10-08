const storageKey = 'web-terminal.fontFamily';

export function defaultTerminalFont(platform: string): string {
  return /win/i.test(platform)
    ? '"Cascadia Code", Consolas, "Microsoft YaHei", "微软雅黑", monospace'
    : '"Cascadia Code", "JetBrains Mono", Consolas, monospace';
}

export function loadTerminalFont(): string {
  try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
}

export function saveTerminalFont(value: string): void {
  if (value) localStorage.setItem(storageKey, value);
  else localStorage.removeItem(storageKey);
}
