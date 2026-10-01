import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultServerUrl, normalizeServerUrl, vscodeEmbedUrl } from '../src/shared/clientUrl.ts';
import { errorHtml, forwardedEmbedUrl, iframeHtml } from '../targets/vscode/src/html.ts';

test('VS Code embed URL uses the validated server root', () => {
  assert.equal(vscodeEmbedUrl(defaultServerUrl), 'http://localhost:3840/?embed=vscode');
  for (const input of ['https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=x', 'file:///tmp/a']) {
    assert.throws(() => normalizeServerUrl(input));
  }
});

test('iframe binds CSP frame origin and escapes attributes', () => {
  const html = iframeHtml('https://example.com/?embed=vscode&x=%22', 'test-nonce');
  assert.match(html, /default-src 'none'; frame-src https:\/\/example\.com; style-src 'nonce-test-nonce'; script-src 'nonce-test-nonce'/);
  assert.match(html, /src="https:\/\/example\.com\/\?embed=vscode&amp;x=%22"/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"/);
  assert.match(html, /allow="clipboard-read; clipboard-write"/);
  assert.match(html, /const api = acquireVsCodeApi\(\); api.setState/);
  assert.doesNotMatch(html, /connect-src/);
  assert.match(html, /event.source === frame.contentWindow && event.origin === origin/);
  assert.throws(() => iframeHtml('javascript:alert(1)'));
});

test('error page escapes server errors', () => {
  const html = errorHtml('<script>alert(1)</script>', 'test-nonce');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /script-src 'nonce-test-nonce'/);
  assert.match(html, /acquireVsCodeApi\(\)\.setState\(\{\}\)/);
});

test('forwarded URL retains other parameters and forces VS Code embed mode', () => {
  assert.equal(forwardedEmbedUrl('https://forwarded.example/path?token=route&embed=old'),
    'https://forwarded.example/path?token=route&embed=vscode');
  assert.equal(forwardedEmbedUrl('https://forwarded.example/path?route=1'),
    'https://forwarded.example/path?route=1&embed=vscode');
  assert.throws(() => forwardedEmbedUrl('file:///tmp/a'));
});
