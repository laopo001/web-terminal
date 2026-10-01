import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeServerUrl, vscodeEmbedUrl } from '../src/shared/clientUrl.ts';
import { embeddingHeaders } from '../src/server/embedding.ts';
import { readServerUrl, sameServer } from '../targets/electron/src/settings.ts';

test('客户端地址只接受无凭据的HTTP(S)根地址', () => {
  assert.equal(normalizeServerUrl(' http://localhost:3840/ '), 'http://localhost:3840');
  assert.equal(vscodeEmbedUrl('https://terminal.example.com'), 'https://terminal.example.com/?embed=vscode');
  for (const input of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#token', 'https://example.com/app', '//example.com']) assert.throws(() => normalizeServerUrl(input));
  assert.equal(sameServer('https://other.example.com', 'https://example.com'), false);
  assert.equal(sameServer('https://example.com.evil.test', 'https://example.com'), false);
  assert.equal(sameServer('https://example.com/?page=1', 'https://example.com'), true);
});

test('只为明确VS Code页面开放限定iframe祖先，API和普通入口仍禁止嵌入', () => {
  const plain = embeddingHeaders('/', undefined, false);
  assert.equal(plain['X-Frame-Options'], 'DENY');
  assert.match(plain['Content-Security-Policy'], /frame-ancestors 'none'/);
  const embedded = embeddingHeaders('/', 'vscode', false);
  assert.equal(embedded['X-Frame-Options'], undefined);
  assert.match(embedded['Content-Security-Policy'], /vscode-webview:/);
  assert.match(embedded['Content-Security-Policy'], /vscode-file:/);
  assert.doesNotMatch(embedded['Content-Security-Policy'], /frame-ancestors \*/);
  assert.equal(embeddingHeaders('/api/auth', 'vscode', false)['X-Frame-Options'], 'DENY');
  assert.equal(embeddingHeaders('/', 'other', true)['X-Frame-Options'], 'DENY');
});

test('Electron连接配置持久保存地址，环境覆盖不写入凭据', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'web-terminal-client-'));
  try {
    assert.equal(readServerUrl(directory), 'http://localhost:3840');
    const initial = await readFile(join(directory, 'client.yaml'), 'utf8');
    assert.doesNotMatch(initial, /token/i);
    assert.equal(readServerUrl(directory, 'https://terminal.example.com'), 'https://terminal.example.com');
    assert.equal(await readFile(join(directory, 'client.yaml'), 'utf8'), initial);
    await writeFile(join(directory, 'client.yaml'), 'serverUrl: https://private.example.com\n');
    assert.equal(readServerUrl(directory), 'https://private.example.com');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
