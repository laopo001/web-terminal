import { build, Platform, Arch } from 'electron-builder';
import { mkdtemp, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'yaml';

// 独立暂存目录阻止打包器向上寻找服务器的 pnpm 依赖树。
const staging = await mkdtemp(join(tmpdir(), 'web-terminal-desktop-'));
const require = createRequire(import.meta.url);
try {
  await cp('dist-clients/electron', staging, { recursive: true });
  const config = parse(await readFile('electron-builder.yaml', 'utf8'));
  await build({
    projectDir: staging, publish: 'never',
    targets: process.argv.includes('--win') ? Platform.WINDOWS.createTarget(['zip'], Arch.x64) : Platform.LINUX.createTarget(['dir'], Arch.x64),
    config: {
      ...config,
      electronVersion: require('electron/package.json').version,
      directories: { app: '.', output: resolve('release') },
    },
  });
} finally { await rm(staging, { recursive: true, force: true }); }
