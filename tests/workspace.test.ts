import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { workspacePath } from '../targets/vscode/src/workspace.ts';
import { iframeHtml } from '../targets/vscode/src/html.ts';
import { WebviewContent } from '../targets/vscode/src/content.ts';

test('工作区支持远程、多根与 Windows WSL UNC 路径', () => {
  assert.equal(workspacePath({ scheme: 'vscode-remote', path: '/home/me/project', fsPath: 'ignored' }), '/home/me/project');
  assert.equal(workspacePath({ scheme: 'file', path: '', fsPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\project' }), '/home/me/project');
  assert.equal(workspacePath({ scheme: 'untitled', path: '/x', fsPath: '/x' }), undefined);
});

test('工作区桥接校验 iframe 来源，传递全部目录并阻止 HTML 注入', async () => {
  const folders = [{ name: '</script><script>bad()</script>', path: '/a' }, { name: 'B', path: '/b' }];
  const html = iframeHtml('https://terminal.example/?embed=vscode', 'nonce', folders);
  assert.doesNotMatch(html, /<script>bad/);
  const sent: unknown[] = [];
  const child = { postMessage: (message: unknown, origin: string) => sent.push({ message, origin }) };
  let listener: (event: unknown) => void = () => {};
  const window = { origin: 'vscode-webview://workspace-host', addEventListener: (_: string, fn: typeof listener) => { listener = fn; } };
  runInNewContext(html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)![1], {
    acquireVsCodeApi: () => ({ setState() {}, postMessage() {} }), URL, window,
    document: { querySelector: () => ({ src: 'https://terminal.example/?embed=vscode', contentWindow: child, addEventListener() {} }) },
  });
  listener({ source: {}, origin: 'https://terminal.example', data: { type: 'web-terminal:request-workspace-folders' } });
  listener({ source: child, origin: 'https://evil.example', data: { type: 'web-terminal:request-workspace-folders' } });
  assert.equal(sent.length, 0);
  listener({ source: child, origin: 'https://terminal.example', data: { type: 'web-terminal:request-workspace-folders' } });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ message: { type: 'web-terminal:workspace-folders', folders }, origin: 'https://terminal.example' }]);
  listener({ source: {}, origin: window.origin, data: { type: 'web-terminal:workspace-folders', folders: [] } });
  assert.equal(sent.length, 2);
  const updates: unknown[] = [];
  let current = folders;
  const content = new WebviewContent({ html: '', postMessage: message => updates.push(message) }, async () => 'https://terminal.example', () => current);
  await content.update(); current = []; content.updateFolders();
  assert.deepEqual(updates, [{ type: 'web-terminal:workspace-folders', folders: [] }]);
  content.dispose(); content.updateFolders(); assert.equal(updates.length, 1);
});
