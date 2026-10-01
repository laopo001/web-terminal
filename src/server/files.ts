import { constants } from 'node:fs';
import { mkdir, readdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Config } from './config.ts';
import type { DirectoryListing, FileInfo } from '../shared/protocol.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function inside(path: string, roots: string[]): boolean {
  return roots.some(root => { const rel = relative(root, path); return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)); });
}
export class Files {
  constructor(private config: Config) {}
  async directory(path: string) {
    const canonical = await realpath(resolve(path));
    if (!inside(canonical, this.config.roots)) throw new HttpError(403, '目录不在允许访问的范围内');
    const handle = await open(canonical, constants.O_RDONLY);
    try { if (!(await handle.stat()).isDirectory()) throw new HttpError(400, '工作目录无效'); } finally { await handle.close(); }
    return canonical;
  }
  async directories(path: string): Promise<DirectoryListing> {
    const cwd = await this.directory(path);
    const entries = await readdir(cwd, { withFileTypes: true });
    const folders = await Promise.all(entries.filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(async entry => {
      try { return { name: entry.name, path: await this.directory(join(cwd, entry.name)) }; }
      catch { return null; }
    }));
    const parent = dirname(cwd);
    return { path: cwd, parent: parent !== cwd && inside(parent, this.config.roots) ? parent : null,
      entries: folders.filter(entry => entry !== null).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  async read(sessionId: string, cwd: string, path: string, base?: string) {
    if (!path || path.includes('\0') || path.length > 8192) throw new HttpError(400, '文件路径无效');
    const expanded = path.startsWith('~/') ? join(process.env.HOME || cwd, path.slice(2)) : path;
    const canonical = await realpath(resolve(base || cwd, expanded));
    const roots = [...this.config.roots, join(this.config.dataDir, 'uploads', sessionId)];
    if (!inside(canonical, roots)) throw new HttpError(403, '文件不在允许访问的范围内');
    const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new HttpError(400, '只能预览普通文件');
      // 打开后再次验证实际文件，防止目录或符号链接在检查和打开之间被替换。
      if (process.platform === 'linux') {
        const actual = await realpath(`/proc/self/fd/${handle.fd}`);
        if (!inside(actual, roots)) throw new HttpError(403, '文件不在允许访问的范围内');
      }
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0);
      const mime = imageMime(head);
      const info: FileInfo = { path: canonical, name: basename(canonical), size: stat.size, mime: mime || 'application/octet-stream', isImage: !!mime };
      if (mime && stat.size <= 50 * 1024 * 1024) {
        const bytes = await handle.readFile();
        const metadata = await sharp(bytes, { limitInputPixels: 64_000_000 }).metadata();
        info.width = metadata.width; info.height = metadata.height;
        return { handle, info, bytes };
      }
      return { handle, info, bytes: undefined };
    } catch (error) { await handle.close(); throw error; }
  }
  async upload(sessionId: string, temporary: string, originalName: string) {
    try {
      const handle = await open(temporary, 'r');
      let bytes: Buffer;
      try { bytes = await handle.readFile(); } finally { await handle.close(); }
      const mime = imageMime(bytes);
      if (!mime) throw new HttpError(415, '支持 PNG、JPEG、WebP 和 GIF 图片');
      const meta = await sharp(bytes, { limitInputPixels: 64_000_000 }).metadata().catch(() => { throw new HttpError(415, '图片无法解码或像素数超过限制'); });
      if (!meta.width || !meta.height) throw new HttpError(415, '图片无法解码');
      const folder = join(this.config.dataDir, 'uploads', sessionId);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mime];
      // 使用无空格、无控制字符的路径，避免 CLI 路径粘贴歧义。
      const path = join(folder, `${randomUUID()}${ext}`);
      await rename(temporary, path);
      return { path, name: basename(originalName).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || basename(path), size: bytes.length, mime, isImage: true, width: meta.width, height: meta.height } satisfies FileInfo;
    } finally { await unlink(temporary).catch(() => {}); }
  }
}
function imageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
}
