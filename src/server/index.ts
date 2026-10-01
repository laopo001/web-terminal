import { loadConfig } from './config.ts';
import { createApp } from './app.ts';
import { join } from 'node:path';

const config = loadConfig();
const runtime = await createApp(config, { dev: process.argv.includes('--dev') });
runtime.server.listen(config.port, config.host, () => {
  console.log(`Web Terminal: http://${config.host}:${config.port}`);
  console.log(`首次登录 token 文件：${join(config.dataDir, 'token')}（或 WEB_TERMINAL_TOKEN）`);
  console.log('会话保留：进程内，支持浏览器重连');
});
runtime.server.on('error', error => { console.error(error.message); process.exit(1); });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (closing) return; closing = true;
  await runtime.close(); process.exit(0);
});
