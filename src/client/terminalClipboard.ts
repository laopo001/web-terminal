import type { Terminal } from '@xterm/xterm';

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
