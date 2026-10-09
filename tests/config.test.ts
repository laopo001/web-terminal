import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/server/config.ts';

test('读取用户指定的非空短令牌，仍拒绝空令牌文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-terminal-config-'));
  const keys = ['WEB_TERMINAL_CONFIG', 'WEB_TERMINAL_DATA_DIR', 'WEB_TERMINAL_TOKEN'] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.WEB_TERMINAL_CONFIG = join(dir, 'config.yaml');
    process.env.WEB_TERMINAL_DATA_DIR = dir;
    delete process.env.WEB_TERMINAL_TOKEN;
    writeFileSync(join(dir, 'config.yaml'), '{}\n');
    writeFileSync(join(dir, 'token'), '123456\n');
    assert.equal(loadConfig().token, '123456');
    assert.equal(loadConfig({ uploadDir: join(dir, 'uploads') }).uploadDir, join(dir, 'uploads'));
    writeFileSync(join(dir, 'config.yaml'), 'uploadDir: custom-uploads\n');
    assert.equal(loadConfig({ uploadDir: join(dir, 'uploads') }).uploadDir, join(process.cwd(), 'custom-uploads'));
    writeFileSync(join(dir, 'token'), '  \n');
    assert.throws(() => loadConfig(), /不能为空/);
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    rmSync(dir, { recursive: true, force: true });
  }
});
