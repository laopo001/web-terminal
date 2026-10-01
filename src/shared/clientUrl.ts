export const defaultServerUrl = 'http://localhost:3840';

/** 客户端只选择服务地址，认证数据不进入连接 URL。 */
export function normalizeServerUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('请输入完整的 http:// 或 https:// 服务器地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('服务器地址只支持 HTTP 或 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('服务器地址不能包含账号、密码、查询参数或锚点；token 请在 Web 登录页输入');
  if (url.pathname !== '/') throw new Error('请填写服务器根地址，例如 http://localhost:3840');
  return url.origin;
}

export function vscodeEmbedUrl(serverUrl: string): string {
  return `${normalizeServerUrl(serverUrl)}/?embed=vscode`;
}
