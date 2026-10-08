import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { stringify } from 'yaml';
import { probeService } from '../src/service/probe.ts';
import { ensureService, ServiceNotInstalledError } from '../src/service/client.ts';
import { processStamp } from '../src/service/process.ts';
import { serviceName, serviceProtocol } from '../src/shared/service.ts';

const execute = promisify(execFile);

async function listening(server: ReturnType<typeof createServer> | ReturnType<typeof createTcpServer>) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function unusedUrl() {
  const server = createServer(); const url = await listening(server);
  await new Promise<void>(done => server.close(() => done())); return url;
}

test('检测区分正确身份、协议不兼容、占用端口与停止，不需要登录 token', async () => {
  let body: unknown = { service: serviceName, protocol: serviceProtocol, version: '0.1.2', instanceId: 'test', pid: process.pid, managed: true };
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); });
  const url = await listening(server);
  try {
    assert.equal((await probeService(url)).kind, 'ready');
    body = { ...(body as object), protocol: 999 };
    assert.equal((await probeService(url)).kind, 'incompatible');
    body = { service: 'another-service' };
    assert.equal((await probeService(url)).kind, 'conflict');
  } finally { await new Promise<void>(done => server.close(() => done())); }
  assert.equal((await probeService(url)).kind, 'stopped');
});

test('端口接受连接但不响应时不当作服务未启动，也不执行 CLI', async () => {
  const sockets = new Set<import('node:net').Socket>();
  const server = createTcpServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const url = await listening(server);
  try { assert.equal((await probeService(url, 100)).kind, 'unreachable'); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(done => server.close(() => done())); }
});

test('客户端报告未安装，拒绝在不受信任工作区启动', async () => {
  const url = await unusedUrl();
  await assert.rejects(ensureService(url, { cliPath: '/missing/web-terminal', runtime: 'native' }), error => error instanceof ServiceNotInstalledError && error.installCommand.includes(serviceName));
  await assert.rejects(ensureService(url, { allowStart: false }), /信任/);
});

test('真实 CLI：从任意目录启动、并发复用、重启、挂起恢复、拒绝错误 PID，最后停止', { timeout: 60000 }, async () => {
  await mkdir('.data', { recursive: true });
  const root = await mkdtemp(resolve('.data/service-test-'));
  const output = join(root, 'dist-server/cli.js');
  await build({ entryPoints: ['src/cli.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>CLI package fixture</title>');
  const home = join(root, 'home');
  await mkdir(home);
  const customConfig = join(root, 'custom.yaml');
  await writeFile(customConfig, stringify({ defaultCwd: root, roots: [root], shell: '/bin/bash', dataDir: 'custom-data' }));
  const url = await unusedUrl();
  const env: NodeJS.ProcessEnv = { ...process.env, WEB_TERMINAL_HOME: home };
  delete env.WEB_TERMINAL_CONFIG;
  delete env.WEB_TERMINAL_DATA_DIR;
  const cli = (action: string, args: string[] = []) => execute(process.execPath, [output, action, '--url', url, ...args], { cwd: home, env, timeout: 25000 });
  const identity = async () => { const status = await probeService(url); assert.equal(status.kind, 'ready'); if (status.kind !== 'ready') throw new Error('not ready'); return status.identity; };
  let suspended = 0;
  let innocent: ReturnType<typeof spawn> | undefined;
  try {
    const versions = JSON.parse((await execute(process.execPath, [output, '--version'])).stdout);
    assert.equal(versions.service, serviceName);
    const [first, second] = await Promise.all([cli('start', ['--config', customConfig]), cli('start', ['--config', customConfig])]);
    assert.equal(JSON.parse(first.stdout).identity.instanceId, JSON.parse(second.stdout).identity.instanceId);
    const initial = await identity();
    const page = await fetch(url); assert.match(await page.text(), /CLI package fixture/);
    assert.equal((await fetch(url + '/api/sessions')).status, 401);
    const paths = join(home, 'servers', new URL(url).port);
    const tokenBefore = await readFile(join(root, 'custom-data/token'), 'utf8');
    await cli('restart');
    const restarted = await identity();
    assert.notEqual(restarted.instanceId, initial.instanceId);
    assert.equal(await readFile(join(root, 'custom-data/token'), 'utf8'), tokenBefore);
    assert.equal(await processStamp(initial.pid), undefined);
    if (process.platform === 'linux') {
      suspended = restarted.pid;
      process.kill(suspended, 'SIGSTOP');
      assert.equal((await probeService(url, 100)).kind, 'unreachable');
      await cli('restart');
      assert.notEqual((await identity()).pid, suspended);
      suspended = 0;
    }
    await cli('stop');
    assert.equal((await probeService(url)).kind, 'stopped');
    // 故意放入复用 PID 的旧状态；不得停止这个无关进程。
    innocent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await once(innocent, 'spawn');
    const statePath = join(paths, 'server.yaml');
    await writeFile(statePath, stringify({ pid: innocent.pid, stamp: 'stale-stamp', instanceId: 'stale', url }));
    await cli('stop');
    assert(await processStamp(innocent.pid!));
  } finally {
    if (suspended) { try { process.kill(suspended, 'SIGCONT'); } catch {} }
    await cli('stop').catch(() => {});
    innocent?.kill();
    await rm(root, { recursive: true, force: true });
  }
});

test('占用端口的其他服务不能被 CLI 管理，客户端也不运行启动命令', async () => {
  const server = createServer((_req, res) => { res.end('other application'); });
  const url = await listening(server);
  try {
    await assert.rejects(ensureService(url, { cliPath: '/missing/web-terminal' }), /端口/);
    assert.equal(await (await fetch(url)).text(), 'other application');
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
