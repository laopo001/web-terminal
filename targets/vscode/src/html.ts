import type { WorkspaceFolder } from '../../../src/shared/protocol.js';
import { randomBytes } from 'node:crypto';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);

const restoreStateScript = (nonce: string) => `<script nonce="${nonce}">acquireVsCodeApi().setState({});</script>`;

export function forwardedEmbedUrl(source: string): string {
  const url = new URL(source);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('VS Code 转发地址必须是无凭据的 HTTP(S) URL');
  }
  url.searchParams.set('embed', 'vscode');
  return url.href;
}

export function iframeHtml(source: string, nonce = randomBytes(16).toString('base64'), folders: WorkspaceFolder[] = []): string {
  const url = new URL(source);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('嵌入地址必须是无凭据的 HTTP(S) URL');
  }
  const origin = escapeHtml(url.origin);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<title>Web Terminal</title><style nonce="${nonce}">html,body,iframe{width:100%;height:100%;margin:0;padding:0;box-sizing:border-box}body{overflow:hidden;background:var(--vscode-editor-background)}iframe{display:block;border:0}</style></head>
<body><iframe title="Web Terminal" src="${escapeHtml(url.href)}" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" allow="clipboard-read; clipboard-write"></iframe><script nonce="${nonce}">
const api = acquireVsCodeApi(); api.setState({});
const frame = document.querySelector('iframe');
const origin = new URL(frame.src).origin;
let folders = ${JSON.stringify(folders).replaceAll('<', '\\u003c')};
const publish = () => frame.contentWindow.postMessage({ type: 'web-terminal:workspace-folders', folders }, origin);
window.addEventListener('message', event => {
  if (event.source === frame.contentWindow && event.origin === origin && event.data?.type === 'web-terminal:request-workspace-folders') publish();
  else if ((event.source === window || event.source === null) && event.data?.type === 'web-terminal:workspace-folders' && Array.isArray(event.data.folders)) { folders = event.data.folders; publish(); }
});
frame.addEventListener('load', publish);
</script></body></html>`;
}

export function errorHtml(message: string, nonce = randomBytes(16).toString('base64')): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);padding:20px}code{font-family:var(--vscode-editor-font-family)}</style></head><body><h2>无法打开 Web Terminal</h2><p>${escapeHtml(message)}</p><p>处理上述问题后运行 <code>Web Terminal: Reload</code> 重试。地址可用 <code>Web Terminal: Set Server URL</code> 设置。</p>${restoreStateScript(nonce)}</body></html>`;
}
