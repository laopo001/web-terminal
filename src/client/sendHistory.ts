const storageKey = 'web-terminal.sendHistory';
const historyLimit = 100;

/** 同一浏览器共享最近发送内容，每次发送保留一条，包括重复内容。 */
export function loadSendHistory(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(-historyLimit) : [];
  } catch { return []; }
}

export function appendSendHistory(text: string): void {
  if (!text.trim()) return;
  localStorage.setItem(storageKey, JSON.stringify([...loadSendHistory(), text].slice(-historyLimit)));
}
