import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { loadConfig } from '../src/server/config.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'web-terminal-config-'));
  const cwd = process.cwd();
  process.chdir(dir);
  const keys = ['HOST', 'PORT', 'WEB_TERMINAL_HOME', 'WEB_TERMINAL_CONFIG', 'WEB_TERMINAL_DATA_DIR', 'WEB_TERMINAL_TOKEN'] as const;
  const previous = keys.map(key => process.env[key]);
  for (const key of keys) delete process.env[key];
  process.env.WEB_TERMINAL_HOME = dir;
  // 显式测试配置，避免读取开发项目的旧 token。
  const file = join(dir, 'settings.yaml');
  process.env.WEB_TERMINAL_CONFIG = file;
  return { dir, file, cwd, read: () => parse(readFileSync(file, 'utf8')), close() {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  } };
}

test('监听地址优先使用 HOST、配置、管理地址默认值，未配置时仅监听本机', () => {
  const f = fixture();
  try {
    assert.equal(loadConfig().host, '127.0.0.1');
    assert.equal(loadConfig({ host: '::1' }).host, '::1');
    writeFileSync(f.file, 'host: 0.0.0.0\ntoken: secret\n');
    assert.equal(loadConfig({ host: '127.0.0.1' }).host, '0.0.0.0');
    process.env.HOST = '127.0.0.1';
    assert.equal(loadConfig({ host: '::1' }).host, '127.0.0.1');
  } finally { f.close(); }
});

test('默认读取全局配置，按配置目录解析路径，两种启动入口共享配置和密码', () => {
  const f = fixture();
  try {
    delete process.env.WEB_TERMINAL_CONFIG;
    const file = join(f.dir, 'config.yaml');
    writeFileSync(file, 'host: 0.0.0.0\nport: 3841\ntoken: shared-secret\nuploadDir: uploads\ndataDir: shared-data\n');
    const standalone = loadConfig();
    const cli = loadConfig({ configFile: file, dataDir: join(f.dir, 'servers/3841/data'), uploadDir: join(f.dir, 'uploads'), host: '127.0.0.1' });
    assert.deepEqual(standalone, cli);
    assert.equal(standalone.configFile, file);
    assert.equal(standalone.token, 'shared-secret');
    assert.equal(standalone.dataDir, join(f.dir, 'shared-data'));
    assert.equal(standalone.uploadDir, join(f.dir, 'uploads'));
    writeFileSync(file, 'token: shared-secret\ndataDir: custom-data\ndefaultCwd: .\n');
    assert.equal(loadConfig().dataDir, join(f.dir, 'custom-data'));
    assert.equal(loadConfig().defaultCwd, f.dir);
  } finally { f.close(); }
});

test('新密码只写入 YAML，保留配置和注释，并限制文件权限', () => {
  const f = fixture();
  try {
    writeFileSync(f.file, '# 用户的配置\nhost: 0.0.0.0 # 局域网\n');
    const config = loadConfig();
    assert.equal(f.read().token, config.token);
    assert.equal(loadConfig().token, config.token);
    assert.match(readFileSync(f.file, 'utf8'), /# 用户的配置/);
    assert.match(readFileSync(f.file, 'utf8'), /# 局域网/);
    assert.equal(existsSync(join(config.dataDir, 'token')), false);
    if (process.platform !== 'win32') assert.equal(statSync(f.file).mode & 0o777, 0o600);
  } finally { f.close(); }
});

test('旧数据目录密码迁入 YAML；后续只使用 YAML，环境变量覆盖不落盘', () => {
  const f = fixture();
  try {
    const data = join(f.dir, 'old-data');
    mkdirSync(data);
    writeFileSync(f.file, 'dataDir: old-data\n');
    writeFileSync(join(data, 'token'), '123456\n');
    assert.equal(loadConfig().token, '123456');
    assert.equal(f.read().token, '123456');
    assert.equal(readFileSync(join(data, 'token'), 'utf8'), '123456\n');
    writeFileSync(join(data, 'token'), 'old-token-changed\n');
    assert.equal(loadConfig().token, '123456');
    process.env.WEB_TERMINAL_TOKEN = 'temporary-override';
    assert.equal(loadConfig().token, 'temporary-override');
    assert.equal(f.read().token, '123456');
  } finally { f.close(); }
});

test('兼容全局配置原有 .data/token，拒绝空密码、非字符串密码和无效配置', () => {
  const f = fixture();
  try {
    delete process.env.WEB_TERMINAL_CONFIG;
    mkdirSync(join(f.dir, '.data'));
    writeFileSync(join(f.dir, '.data/token'), 'legacy-global-token\n');
    assert.equal(loadConfig().token, 'legacy-global-token');
    process.env.WEB_TERMINAL_CONFIG = f.file;
    for (const content of ['token: ""\n', 'token: "  "\n', 'token: 123456\n', '[]\n', 'host: [\n']) {
      writeFileSync(f.file, content);
      assert.throws(() => loadConfig(), /token|配置对象/);
      assert.equal(readFileSync(f.file, 'utf8'), content);
    }
    writeFileSync(f.file, 'dataDir: empty-data\n');
    mkdirSync(join(f.dir, 'empty-data'));
    writeFileSync(join(f.dir, 'empty-data/token'), ' \n');
    assert.throws(() => loadConfig(), /不能为空/);
    assert.equal(f.read().token, undefined);
  } finally { f.close(); }
});

test('不同端口并发首次启动共享同一个持久 token', async () => {
  const f = fixture();
  try {
    const execute = promisify(execFile);
    const script = "import {loadConfig} from './src/server/config.ts'; console.log(loadConfig().token)";
    const [first, second] = await Promise.all([3840, 3841].map(port => execute(process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: f.cwd, env: { ...process.env, WEB_TERMINAL_DATA_DIR: join(f.dir, 'data'), PORT: String(port) } })));
    assert.equal(first.stdout.trim(), second.stdout.trim());
    assert.equal(f.read().token, first.stdout.trim());
  } finally { f.close(); }
});
