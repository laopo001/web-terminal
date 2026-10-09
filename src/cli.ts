import { fileURLToPath } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadConfig } from './server/config.ts';
import { defaultServerUrl, normalizeServerUrl } from './shared/clientUrl.ts';
import { serviceName, serviceVersion } from './shared/service.ts';
import { manageService, servicePaths, readState, writeState } from './service/manager.ts';
import { processStamp } from './service/process.ts';
import { probeService } from './service/probe.ts';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    url: { type: 'string', default: defaultServerUrl }, home: { type: 'string' }, config: { type: 'string' },
    version: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.version) { console.log(JSON.stringify({ service: serviceName, version: serviceVersion })); return; }
  const action = positionals[0] || 'start';
  if (values.help) {
    console.log('web-terminal [start|restart|stop|status] [--url http://localhost:3840] [--config /path/config.yaml] [--home /path/state]\n配置、token、进程状态和日志默认位于 ~/.web-terminal/。重启会结束普通 Shell 会话。'); return;
  }
  const url = normalizeServerUrl(values.url!);
  if (action === 'status') { console.log(JSON.stringify(await probeService(url))); return; }
  if (action !== 'serve') {
    if (!['start', 'restart', 'stop'].includes(action)) throw new Error(`未知命令：${action}`);
    const identity = await manageService(action as 'start' | 'restart' | 'stop', { url, entry: fileURLToPath(import.meta.url), home: values.home, config: values.config });
    console.log(JSON.stringify({ ok: true, url, identity })); return;
  }
  const paths = servicePaths(url, values.home);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const configFile = resolve(values.config || process.env.WEB_TERMINAL_CONFIG || paths.config);
  process.env.WEB_TERMINAL_CONFIG = configFile;
  // 全局安装不依赖客户端的工作目录，配置中的相对路径以配置文件目录为准。
  process.chdir(dirname(configFile));
  const config = loadConfig({ dataDir: join(paths.directory, 'data'), uploadDir: join(paths.base, 'uploads') });
  // CLI 的连接地址是管理目标，优先于配置文件或继承的 PORT/HOST。
  config.host = new URL(url).hostname === 'localhost' ? '127.0.0.1' : new URL(url).hostname.replace(/^\[|\]$/g, '');
  config.port = Number(new URL(url).port || 80);
  const instanceId = randomUUID();
  const { createApp } = await import('./server/app.ts');
  const runtime = await createApp(config, { managed: true, instanceId, staticDir: fileURLToPath(new URL('../dist/', import.meta.url)) });
  const stamp = await processStamp(process.pid);
  if (!stamp) throw new Error('无法取得进程启动标识，拒绝启动不可安全管理的后台');
  await new Promise<void>((done, reject) => { runtime.server.once('error', reject); runtime.server.listen(config.port, config.host, done); });
  await writeState(paths.state, { pid: process.pid, stamp, instanceId, url, config: configFile });
  console.log(`Web Terminal ${serviceVersion}: ${url}\ntoken 文件：${join(config.dataDir, 'token')}`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (closing) return;
    closing = true;
    void (async () => {
      await runtime.close();
      if ((await readState(paths.state))?.instanceId === instanceId) await rm(paths.state, { force: true });
    })().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
  });
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
