import type { FileInfo } from '../shared/protocol';

export class UnauthorizedError extends Error { constructor() { super('访问令牌已失效'); } }
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers } });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `HTTP ${response.status}`); }
  return response.json() as Promise<T>;
}
export function urlFor(session: string, action: 'meta' | 'content', path: string, base?: string, extra?: string): string {
  const query = new URLSearchParams({ path }); if (base) query.set('base', base); if (extra) query.set(extra, '1');
  return `/api/sessions/${encodeURIComponent(session)}/files/${action}?${query}`;
}
export async function fileBlob(token: string, url: string): Promise<Blob> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `HTTP ${response.status}`); }
  return response.blob();
}
export async function blobUrl(token: string, url: string): Promise<string> {
  return URL.createObjectURL(await fileBlob(token, url));
}
export type FilePreview = { file: FileInfo; url: string | null; loading: boolean; text?: string; error?: string };
