import { constants } from 'node:fs';
import { mkdir, readdir, open, realpath, unlink, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import { resolve, basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse, stringify } from 'yaml';
import sharp from 'sharp';
import type { Config } from './config.ts';
import type { DirectoryListing, FileInfo } from '../shared/protocol.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export class Files {
  constructor(private config: Config) {}
  async directory(path: string) {
    const canonical = await realpath(resolve(path));
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
    return { path: cwd, parent: parent !== cwd ? parent : null,
      entries: folders.filter(entry => entry !== null).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  async read(cwd: string, path: string, base?: string) {
    if (!path || path.includes('\0') || path.length > 8192) throw new HttpError(400, '文件路径无效');
    const expanded = path.startsWith('~/') ? join(process.env.HOME || cwd, path.slice(2)) : path;
    const canonical = await realpath(resolve(base || cwd, expanded));
    const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new HttpError(400, '只能预览普通文件');
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
      await mkdir(this.config.uploadDir, { recursive: true, mode: 0o700 });
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mime];
      // 使用无空格、无控制字符的路径，避免 CLI 路径粘贴歧义。
      let path: string;
      for (;;) {
        path = join(this.config.uploadDir, `${randomBytes(6).toString('hex')}${ext}`);
        try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      // 归属记录留在会话目录，服务重启后仍能只清理本会话的图片。
      try { await appendFile(join(folder, 'files.yaml'), stringify([path]), { mode: 0o600 }); }
      catch (error) { await unlink(path); throw error; }
      return { path, name: basename(originalName).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || basename(path), size: bytes.length, mime, isImage: true, width: meta.width, height: meta.height } satisfies FileInfo;
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async removeUploads(sessionId: string) {
    const folder = join(this.config.dataDir, 'uploads', sessionId);
    let paths: unknown;
    try { paths = parse(await readFile(join(folder, 'files.yaml'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (Array.isArray(paths)) {
      await Promise.all(paths.filter((path): path is string => typeof path === 'string' && /^[a-f0-9]{12}\.(?:png|jpg|webp|gif)$/.test(basename(path))).map(path => rm(path, { force: true })));
    }
    await rm(folder, { recursive: true, force: true });
  }
}
function imageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
}
