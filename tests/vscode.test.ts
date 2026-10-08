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

test('iframe queues text until a composer is ready and checks sender origin', async () => {
  const { runInNewContext } = await import('node:vm');
  const html = iframeHtml('http://localhost:3840/?embed=vscode', 'test');
  const source = html.match(/<script nonce="test">([\s\S]*?)<\/script>/)![1];
  let receive: (event: unknown) => void = () => {};
  let load: () => void = () => {};
  const delivered: any[] = [];
  const host: any[] = [];
  const frame = { src: 'http://localhost:3840/?embed=vscode', contentWindow: { postMessage: (message: unknown) => delivered.push(message) }, addEventListener: (_: string, fn: () => void) => { load = fn; } };
  const window = { origin: 'vscode-webview://test-host', addEventListener: (_: string, fn: typeof receive) => { receive = fn; } };
  runInNewContext(source, { window, document: { querySelector: () => frame }, URL, acquireVsCodeApi: () => ({ setState() {}, postMessage: (message: unknown) => host.push(message) }) });
  assert.equal(host[0].type, 'web-terminal:bridge-ready');
  const openFile = { type: 'web-terminal:open-file', path: '/home/me/file.ts' };
  receive({ source: frame.contentWindow, origin: 'https://untrusted.example', data: openFile });
  receive({ source: {}, origin: 'http://localhost:3840', data: openFile });
  assert.equal(host.length, 1);
  receive({ source: frame.contentWindow, origin: 'http://localhost:3840', data: openFile });
  assert.deepEqual(JSON.parse(JSON.stringify(host[1])), openFile);
  const attachment = { id: '1', name: 'code.ts', text: 'example' };
  const outerFrame = {}; // VS Code 的外层 frame，与 window、null 均不同。
  receive({ source: outerFrame, origin: 'https://untrusted.example', data: { type: 'web-terminal:text-attachment', attachment: { ...attachment, id: 'forged' } } });
  receive({ source: outerFrame, origin: window.origin, data: { type: 'web-terminal:text-attachment', attachment } });
  assert.equal(delivered.length, 0);
  receive({ source: frame.contentWindow, origin: 'https://untrusted.example', data: { type: 'web-terminal:composer-ready' } });
  assert.equal(delivered.length, 0);
  load();
  receive({ source: frame.contentWindow, origin: 'http://localhost:3840', data: { type: 'web-terminal:composer-ready' } });
  assert.equal(delivered.filter(m => m.type === 'web-terminal:text-attachment').length, 1);
  receive({ source: frame.contentWindow, origin: 'http://localhost:3840', data: { type: 'web-terminal:attachment-received', id: '1' } });
  receive({ source: frame.contentWindow, origin: 'http://localhost:3840', data: { type: 'web-terminal:composer-ready' } });
  assert.equal(delivered.filter(m => m.type === 'web-terminal:text-attachment').length, 1);
});
