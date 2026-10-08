export type InteractionMode = 'native' | 'local';
export type ClientSettings = { fontFamily: string; interactionMode: InteractionMode };
export const defaultClientSettings: ClientSettings = { fontFamily: '', interactionMode: 'native' };
const storageKey = 'web-terminal.settings';
const legacyFontKey = 'web-terminal.fontFamily';

export function loadClientSettings(): ClientSettings {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaultClientSettings, fontFamily: localStorage.getItem(legacyFontKey) || '' };
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaultClientSettings };
    return {
      fontFamily: typeof value.fontFamily === 'string' ? value.fontFamily : '',
      interactionMode: value.interactionMode === 'local' ? 'local' : 'native',
    };
  } catch { return { ...defaultClientSettings }; }
}

export function saveClientSettings(settings: ClientSettings): void {
  localStorage.setItem(storageKey, JSON.stringify(settings));
  // 新设置已写入后移除旧字体入口；清理失败不影响本次保存。
  try { localStorage.removeItem(legacyFontKey); } catch {}
}
