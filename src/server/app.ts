import express from 'express';
import { createServer } from 'node:http';
import { mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import multer from 'multer';
import sharp from 'sharp';
import { authenticate, validToken } from './auth.ts';
import { Files, HttpError } from './files.ts';
import { Sessions, send } from './sessions.ts';
import type { Config } from './config.ts';
import { embeddingHeaders } from './embedding.ts';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serviceName, serviceProtocol, serviceVersion } from '../shared/service.ts';

export async function createApp(config: Config, options: { dev?: boolean; staticFiles?: boolean; staticDir?: string; instanceId?: string; managed?: boolean } = {}) {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const app = express();
  const instanceId = randomUUID();
  app.disable('x-powered-by');
  const server = createServer(app);
  const files = new Files(config);
  await files.directory(config.defaultCwd);
  const sessions = new Sessions(config, files);
  const uploadDir = join(config.dataDir, 'staging');
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const upload = multer({ dest: uploadDir, limits: { fileSize: config.maxUploadBytes, files: 1, fields: 0 } });
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.set(embeddingHeaders(req.path, req.query.embed, !!options.dev));
    next();
  });
  app.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').json({
    service: serviceName, version: serviceVersion, protocol: serviceProtocol,
    instanceId: options.instanceId ?? instanceId, pid: process.pid, managed: options.managed ?? false,
  }));
  app.use('/api', authenticate(config.token), express.json({ limit: '32kb' }));
  app.get('/api/auth', (_req, res) => res.json({ ok: true }));
  app.get('/api/info', (_req, res) => res.json({ machineId: config.machineId, defaultCwd: config.defaultCwd, maxUploadBytes: config.maxUploadBytes }));
  app.get('/api/directories', async (req, res) => {
    if (req.query.path !== undefined && (typeof req.query.path !== 'string' || req.query.path.length > 8192 || req.query.path.includes('\0'))) throw new HttpError(400, '路径参数无效');
    res.json(await files.directories(typeof req.query.path === 'string' && req.query.path ? req.query.path : config.defaultCwd));
  });
  app.get('/api/sessions', async (_req, res) => res.json(await sessions.list()));
  app.post('/api/sessions', async (req, res) => res.status(201).json(await sessions.create(req.body?.name, req.body?.cwd)));
  app.delete('/api/sessions/:id', async (req, res) => { await sessions.remove(req.params.id); res.json({ ok: true }); });
  app.post('/api/sessions/:id/uploads', (req, _res, next) => { sessions.get(String(req.params.id)); next(); }, upload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, '请选择图片');
    chmodSync(req.file.path, 0o600);
    const info = await files.upload(String(req.params.id), req.file.path, req.file.originalname);
    res.status(201).json(info);
  });
  app.get('/api/sessions/:id/files/:action', async (req, res) => {
    if (req.params.action !== 'meta' && req.params.action !== 'content') throw new HttpError(404, '接口不存在');
    const session = await sessions.current(req.params.id);
    if (typeof req.query.path !== 'string' || (req.query.base !== undefined && typeof req.query.base !== 'string')) throw new HttpError(400, '路径参数无效');
    const result = await files.read(session.cwd, req.query.path, req.query.base as string | undefined);
    if (req.params.action === 'meta') {
      await result.handle.close(); res.json(result.info); return;
    }
    if (req.query.thumbnail === '1') {
      await result.handle.close();
      if (!result.info.isImage) throw new HttpError(415, '该文件不是支持预览的图片');
      if (!result.bytes) throw new HttpError(413, '图片过大，请下载查看');
      const thumbnail = await sharp(result.bytes, { limitInputPixels: 64_000_000 }).rotate().resize({ width: 960, height: 720, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      res.type('image/webp').send(thumbnail); return;
    }
    res.setHeader('Content-Type', result.info.mime);
    res.setHeader('Content-Length', result.info.size);
    if (req.query.download === '1' || !result.info.isImage) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.info.name).replace(/'/g, '%27')}`);
    const stream = result.handle.createReadStream({ start: 0, autoClose: true });
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url || '/', 'http://localhost').pathname !== '/ws') {
      if (!options.dev) socket.destroy();
      return;
    }
    // 同源连接；代理部署时 Host 和浏览器 Origin 应保持一致。
    const origin = req.headers.origin;
    try { if (origin && new URL(origin).host !== req.headers.host) { socket.destroy(); return; } } catch { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let sessionId: string | undefined;
    let watching = false;
    const timer = setTimeout(() => ws.close(4401, '需要 token'), 5000);
    ws.once('close', () => clearTimeout(timer));
    ws.on('error', () => {});
    ws.on('message', (raw, binary) => {
      try {
        if (binary) throw new Error('消息格式无效');
        const message = JSON.parse(raw.toString());
        if (watching) throw new Error('会话状态订阅只支持读取');
        if (!sessionId) {
          if (message.type !== 'auth' || !validToken(message.token, config.token)) { ws.close(4401, 'token 无效'); return; }
          if (message.protocol !== 2) { send(ws, { type: 'error', message: '终端协议已更新，请刷新页面' }); ws.close(4406, '请刷新页面'); return; }
          if (message.scope === 'sessions') { watching = true; clearTimeout(timer); sessions.watch(ws); return; }
          if (typeof message.sessionId !== 'string') throw new Error('会话无效');
          const session = sessions.get(message.sessionId);
          sessionId = session.info.id;
          clearTimeout(timer);
          void sessions.attach(sessionId, ws, message.cols, message.rows).catch(error => { send(ws, { type: 'error', message: error.message }); ws.close(4404, '会话不可用'); });
        } else if (message.type === 'input' && typeof message.data === 'string') {
          sessions.input(sessionId, ws, message.data);
        } else if (message.type === 'paste' && typeof message.text === 'string' && typeof message.submit === 'boolean') {
          sessions.paste(sessionId, ws, message.text, message.submit);
        } else if (message.type === 'resize' || message.type === 'claim') {
          sessions.resize(sessionId, ws, message.cols, message.rows, message.type === 'claim');
        } else throw new Error('消息格式无效');
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : '请求失败' });
        ws.close(4404, '消息或会话不可用');
      }
    });
  });
  let closeVite: (() => Promise<void>) | undefined;
  if (options.dev) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
    closeVite = () => vite.close(); app.use(vite.middlewares);
  } else if (options.staticFiles !== false) {
    const staticDir = options.staticDir || fileURLToPath(new URL('../../dist/', import.meta.url));
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) { res.destroy(); return; }
    const code = (error as NodeJS.ErrnoException)?.code;
    const status = error instanceof HttpError ? error.status : error instanceof multer.MulterError ? 413 : code === 'ENOENT' ? 404 : code === 'EACCES' ? 403 : error instanceof SyntaxError ? 400 : 500;
    const message = status === 404 ? '文件或目录不存在' : status === 413 ? '图片超过 20 MiB 或上传格式无效' : status === 500 ? '服务处理失败，请查看服务日志' : (error as Error).message;
    if (status === 500) console.error(error);
    res.status(status).json({ error: message });
  });
  return { app, server, sessions, async close() {
    await sessions.shutdown();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await closeVite?.();
    await new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeAllConnections(); });
  } };
}
