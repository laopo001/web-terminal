import type { Terminal } from '@xterm/xterm';

/** 优先使用浏览器剪贴板；HTTP 手机访问使用用户手势触发的兼容复制。 */
export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* 继续尝试兼容复制。 */ }
  }
  const previous = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = text; field.readOnly = true; field.setAttribute('aria-label', '待复制文字');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.append(field);
  try {
    field.focus({ preventScroll: true }); field.select(); field.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw new Error('浏览器不允许复制，请使用 HTTPS 或允许剪贴板访问');
  } finally { field.remove(); previous?.focus({ preventScroll: true }); }
}

/** OSC 52 只写入当前客户端剪贴板，不向远端返回本机剪贴板内容。 */
export function enableTerminalClipboard(term: Terminal, options: {
  canWrite: () => boolean;
  writeText: (text: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  let disposed = false;
  const handler = term.parser.registerOscHandler(52, data => {
    const separator = data.indexOf(';');
    if (separator < 0 || !/^[cps0-7]*$/.test(data.slice(0, separator))) return true;
    const encoded = data.slice(separator + 1);
    if (encoded === '?' || disposed || !options.canWrite()) return true;
    try {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      // 不阻塞终端输出；权限拒绝或 API 不可用时明确反馈。
      void options.writeText(text).catch(error => { if (!disposed) options.onError(error); });
    } catch (error) { options.onError(error); }
    return true;
  });
  return { dispose() { disposed = true; handler.dispose(); } };
}
