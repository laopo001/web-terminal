const BLOCKED_PROTOCOLS = new Set([
  'about:',
  'blob:',
  'data:',
  'file:',
  'javascript:',
  'jscript:',
  'livescript:',
  'mocha:',
  'ms-msdt:',
  'search-ms:',
  'shell:',
  'smb:',
  'tcl:',
  'vbscript:',
]);

const HOSTED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'ws:',
  'wss:',
  'ftp:',
  'ftps:',
]);

export const DIRECT_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'ftp:',
  'ftps:',
  'ssh:',
  'git:',
  'git+ssh:',
  'git+https:',
  'vscode:',
  'vscode-insiders:',
  'cursor:',
]);

/** 校验并解析可交由外部程序打开的 URI，拦截本地 file: 与脚本/高危协议。 */
export function parseExternalUrl(raw: string): URL | null {
  if (!raw || /[\x00-\x1f\x7f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (BLOCKED_PROTOCOLS.has(url.protocol) || url.protocol.startsWith('ms-')) return null;
  if (url.protocol === 'mailto:') {
    const [local, domain] = url.pathname.split('@');
    return local && domain && domain.includes('.') ? url : null;
  }
  if (!raw.slice(url.protocol.length).startsWith('//')) return null;
  if (HOSTED_PROTOCOLS.has(url.protocol)) {
    return url.hostname && !/^\.+$/.test(url.hostname) ? url : null;
  }
  return url.hostname || (url.pathname && url.pathname !== '/') ? url : null;
}

/** 将 file:// URI 还原为本地文件路径；无法解析为有效文件时返回 null。 */
export function parseFileUriPath(raw: string): string | null {
  const match = /^file:\/\/([^/]*)(\/.*)$/i.exec(raw);
  if (!match) return null;
  let path = match[2];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* 保留包含字面百分号的路径 */
  }
  if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1);
  if (!path || path === '/' || path.includes('\0')) return null;
  return path;
}
