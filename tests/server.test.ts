import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import sharp from 'sharp';
import { createApp } from '../src/server/app.ts';
import type { Config } from '../src/server/config.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'web-terminal-test-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const config: Config = { host: '127.0.0.1', port: 0, dataDir: join(root, 'data'), token: randomUUID(), roots: [workspace], defaultCwd: workspace, shell: '/bin/bash', machineId: randomUUID(), maxUploadBytes: 20 * 1024 * 1024 };
  let runtime = await createApp(config, { staticFiles: false });
  async function listen() { runtime.server.listen(0, '127.0.0.1'); await once(runtime.server, 'listening'); }
  await listen();
  const url = () => `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`;
  const api = (path: string, init: RequestInit = {}) => fetch(url() + path, { ...init, headers: { Authorization: `Bearer ${config.token}`, ...init.headers } });
  return { root, workspace, config, api, url, get runtime() { return runtime; },
    async restart() { await runtime.close(); runtime = await createApp(config, { staticFiles: false }); await listen(); },
    async close() { for (const s of await runtime.sessions.list()) await runtime.sessions.remove(s.id); await runtime.close(); await rm(root, { recursive: true, force: true }); }
  };
}
async function connect(url: string, token: string, id: string, cols = 100, rows = 30) {
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  let output = '', replay = '';
  ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'output') output += m.data; else if (m.type === 'replay') replay += m.data; });
  await once(ws, 'open');
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('ready timeout')), 5000);
    ws.on('message', raw => { if (JSON.parse(raw.toString()).type === 'ready') { clearTimeout(timeout); resolve(); } });
  });
  ws.send(JSON.stringify({ type: 'auth', token, sessionId: id, cols, rows }));
  await ready;
  return { ws, get output() { return output; }, get replay() { return replay; }, send(data: string) { ws.send(JSON.stringify({ type: 'input', data })); },
    async waitFor(text: string) {
      const start = Date.now();
      while (!output.includes(text)) { if (Date.now() - start > 5000) throw new Error(`没有收到 ${text}: ${output}`); await new Promise(r => setTimeout(r, 25)); }
    }
  };
}

test('认证、文件上传和真实内容预览，拒绝路径穿越与伪造图片', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.url() + '/api/sessions')).status, 401);
    assert.equal((await fetch(f.url() + '/api/auth', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await f.api('/api/auth')).status, 200);
    const created = await f.api('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试终端' }) });
    assert.equal(created.status, 201); const { id } = await created.json();
    const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#48bb78' } }).png().toBuffer();
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), '截图.png');
    const uploaded = await f.api(`/api/sessions/${id}/uploads`, { method: 'POST', body: form });
    assert.equal(uploaded.status, 201); const image = await uploaded.json();
    assert.equal(image.width, 64); assert.equal(image.height, 32);
    assert.equal((await stat(image.path)).mode & 0o777, 0o600);
    const endpoint = `/api/sessions/${id}/files/`;
    const meta = await (await f.api(endpoint + 'meta?path=' + encodeURIComponent(image.path))).json();
    assert.equal(meta.isImage, true);
    const original = await f.api(endpoint + 'content?path=' + encodeURIComponent(image.path));
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
    const preview = await f.api(endpoint + 'content?thumbnail=1&path=' + encodeURIComponent(image.path));
    assert.equal(preview.headers.get('content-type'), 'image/webp');
    assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width, 64);
    await writeFile(join(f.root, 'outside.txt'), 'outside');
    await symlink(join(f.root, 'outside.txt'), join(f.workspace, 'escape.txt'));
    assert.equal((await f.api(endpoint + 'meta?path=escape.txt')).status, 403);
    assert.equal((await f.api(endpoint + 'meta?path=../outside.txt')).status, 403);
    assert.equal((await f.api(endpoint + 'meta?path=missing.png')).status, 404);
    const forged = new FormData(); forged.append('file', new Blob(['not an image'], { type: 'image/png' }), 'bad.png');
    assert.equal((await f.api(`/api/sessions/${id}/uploads`, { method: 'POST', body: forged })).status, 415);
    await writeFile(join(f.workspace, 'hello.txt'), 'hello');
    const text = await f.api(endpoint + 'content?path=hello.txt');
    assert.match(text.headers.get('content-disposition')!, /attachment/);
    assert.equal(await text.text(), 'hello');
  } finally { await f.close(); }
});

test('WebSocket token 校验，真实 PTY 输入，断线重连保留 Shell、服务重启后结束', async () => {
  const f = await fixture();
  try {
    const wrong = new WebSocket(f.url().replace('http', 'ws') + '/ws');
    await once(wrong, 'open');
    const closed = once(wrong, 'close');
    wrong.send(JSON.stringify({ type: 'auth', token: 'wrong', sessionId: 'none' }));
    assert.equal((await closed)[0], 4401);
    const response = await f.api('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const { id } = await response.json();
    let terminal = await connect(f.url(), f.config.token, id);
    terminal.send("WT_PROBE=7319; printf 'ready-%s\\n' \"$WT_PROBE\"\r");
    await terminal.waitFor('ready-7319'); terminal.ws.terminate();
    terminal = await connect(f.url(), f.config.token, id);
    terminal.send("printf 'reconnect-%s\\n' \"$WT_PROBE\"\r");
    await terminal.waitFor('reconnect-7319'); terminal.ws.terminate();
    await f.restart();
    assert.equal((await f.runtime.sessions.current(id)).running, false);
  } finally { await f.close(); }
});

test('目录选择器只列出允许范围内的目录，拒绝越界和未认证访问', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.workspace, '子目录'));
    await writeFile(join(f.workspace, 'file.txt'), 'text');
    await symlink(f.root, join(f.workspace, 'outside'));
    assert.equal((await fetch(f.url() + '/api/directories')).status, 401);
    const listing = await (await f.api('/api/directories')).json();
    assert.equal(listing.path, f.workspace);
    assert.equal(listing.parent, null);
    assert.deepEqual(listing.entries, [{ name: '子目录', path: join(f.workspace, '子目录') }]);
    const nested = await (await f.api('/api/directories?path=' + encodeURIComponent(join(f.workspace, '子目录')))).json();
    assert.equal(nested.parent, f.workspace);
    assert.equal((await f.api('/api/directories?path=' + encodeURIComponent(f.root))).status, 403);
    assert.equal((await f.api('/api/directories?path=' + encodeURIComponent(join(f.workspace, 'outside')))).status, 403);
  } finally { await f.close(); }
});
