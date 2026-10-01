// VS Code 的 iframe 祖先包括原生 workbench 和外层 Webview。
export const vscodeFrameAncestors = [
  "'self'",
  'vscode-webview:',
  'vscode-file:',
  'https://*.vscode-cdn.net',
  'https://vscode.dev',
  'https://*.vscode.dev',
  'https://github.dev',
  'https://*.github.dev',
].join(' ');

export function embeddingHeaders(path: string, embed: unknown, dev: boolean): Record<string, string> {
  const embedded = path === '/' && embed === 'vscode';
  const ancestors = embedded ? vscodeFrameAncestors : "'none'";
  const headers: Record<string, string> = {};
  if (!embedded) headers['X-Frame-Options'] = 'DENY';
  const rules = dev ? [] : [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:", "connect-src 'self'", "font-src 'self'",
    "object-src 'none'", "base-uri 'none'",
  ];
  headers['Content-Security-Policy'] = [...rules, `frame-ancestors ${ancestors}`].join('; ');
  return headers;
}
