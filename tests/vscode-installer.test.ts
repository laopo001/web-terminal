import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findServerLauncher, installVSCodeExtension, type InstalledExtension } from '../src/vscodeInstaller.ts';

test('VS Code Server 使用有效的最近记录，支持旧 bin 布局及独立的 extensions 目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-terminal-server-'));
  const modern = join(root, 'cli/servers/Stable-current/server');
  const legacy = join(root, 'bin/legacy');
  try {
    for (const directory of [modern, legacy]) {
      await mkdir(join(directory, 'out'), { recursive: true });
      await writeFile(join(directory, 'out/server-main.js'), '');
    }
    await writeFile(join(modern, 'node'), '');
    await writeFile(join(root, 'cli/servers/lru.json'), JSON.stringify(['Stable-removed', 'Stable-current']));
    assert.deepEqual(await findServerLauncher(root), {
      file: join(modern, 'node'), args: [join(modern, 'out/server-main.js'), '--extensions-dir', join(root, 'extensions')],
    });
    await rm(modern, { recursive: true });
    assert.deepEqual(await findServerLauncher(root), {
      file: process.execPath, args: [join(legacy, 'out/server-main.js'), '--extensions-dir', join(root, 'extensions')],
    });
    await rm(legacy, { recursive: true });
    assert.equal(await findServerLauncher(root), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'web-terminal installer-'));
  const vsix = join(root, "插件's file.vsix");
  await writeFile(vsix, 'fixture');
  const command = async (name: string, mode = 'ok') => {
    const path = join(root, name);
    const log = join(root, `${name}.jsonl`);
    await writeFile(path, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (${JSON.stringify(mode)} === 'fail' && args.includes('--install-extension')) { console.error('installation denied'); process.exit(7); }
if (${JSON.stringify(mode)} === 'shim') console.log('Command is only available in WSL or inside a Visual Studio Code terminal');
else if (args.includes('--list-extensions')) console.log(${JSON.stringify(mode === 'missing' ? 'other.extension@1.0.0' : 'dadigua.web-terminal@0.1.3')});
`, { mode: 0o755 });
    return { path, calls: async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
  };
  return { root, vsix, command, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('安装和验装独立执行，空格与引号路径完整传给两个 VS Code 通道', { skip: process.platform === 'win32' }, async () => {
  const f = await fixture();
  try {
    const stable = await f.command('code stable');
    const insiders = await f.command('code insiders');
    const result = await installVSCodeExtension({ vsixPath: f.vsix, codeCommand: stable.path, codeInsidersCommand: insiders.path, installWindowsHost: false });
    assert.equal(result.length, 2);
    for (const command of [stable, insiders]) assert.deepEqual(await command.calls(), [
      ['--install-extension', f.vsix, '--force'], ['--list-extensions', '--show-versions'],
    ]);
  } finally { await f.cleanup(); }
});

test('一个通道失败仍安装另一个通道，退出失败且不将旧扩展列表当作安装成功', { skip: process.platform === 'win32' }, async () => {
  const f = await fixture();
  try {
    const stable = await f.command('code stable', 'fail');
    const insiders = await f.command('code insiders');
    const installed: InstalledExtension[] = [];
    await assert.rejects(installVSCodeExtension({ vsixPath: f.vsix, codeCommand: stable.path, codeInsidersCommand: insiders.path, installWindowsHost: false, onInstalled: result => installed.push(result) }), /installation denied/);
    assert.equal((await stable.calls()).length, 1);
    assert.deepEqual(installed, [{ target: '本机 Insiders', extension: 'dadigua.web-terminal@0.1.3' }]);
  } finally { await f.cleanup(); }
});

test('扩展列表缺少目标或 remote-cli 空成功时拒绝报告成功', { skip: process.platform === 'win32' }, async () => {
  const f = await fixture();
  try {
    const stable = await f.command('code stable', 'missing');
    const insiders = await f.command('code insiders', 'shim');
    await assert.rejects(installVSCodeExtension({ vsixPath: f.vsix, codeCommand: stable.path, codeInsidersCommand: insiders.path, installWindowsHost: false }), error => {
      assert.match((error as Error).message, /安装后未找到 dadigua.web-terminal/);
      assert.match((error as Error).message, /Command is only available/);
      return true;
    });
    await assert.rejects(installVSCodeExtension({ vsixPath: join(f.root, 'missing.vsix') }), /未找到 VSIX/);
  } finally { await f.cleanup(); }
});
