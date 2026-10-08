import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebviewContent } from '../targets/vscode/src/content.ts';

test('侧栏与编辑器并行加载，互不取消请求，同地址不重绘', async () => {
  let firstWrites = 0;
  let secondWrites = 0;
  const first = new WebviewContent({ set html(_value: string) { firstWrites++; } }, async () => 'http://localhost:3840/?embed=vscode');
  const second = new WebviewContent({ set html(_value: string) { secondWrites++; } }, async () => 'http://localhost:3840/?embed=vscode');
  await Promise.all([first.update(), second.update()]);
  await Promise.all([first.update(), second.update()]);
  assert.equal(firstWrites, 1); assert.equal(secondWrites, 1);
  await first.update(true);
  assert.equal(firstWrites, 2); assert.equal(secondWrites, 1);
});

test('慢的旧地址响应和已销毁视图都不会覆盖页面', async () => {
  const target = { html: '' };
  const resolvers: ((url: string) => void)[] = [];
  const content = new WebviewContent(target, () => new Promise(resolve => resolvers.push(resolve)));
  const old = content.update();
  const latest = content.update();
  resolvers[1]('https://current.example.com'); await latest;
  resolvers[0]('https://old.example.com'); await old;
  assert.match(target.html, /current.example.com/);
  assert.doesNotMatch(target.html, /old.example.com/);
  const pending = content.update(); content.dispose();
  resolvers[2]('https://disposed.example.com'); await pending;
  assert.doesNotMatch(target.html, /disposed.example.com/);
});

test('选中文本等待 bridge 就绪，只投递一次，重新加载时继续等待', async () => {
  const messages: unknown[] = [];
  const content = new WebviewContent({ html: '', postMessage: message => messages.push(message) }, async () => 'http://localhost:3840');
  const attachment = { id: 'selection-1', name: 'example.ts', text: 'const value = 1;' };
  content.sendAttachment(attachment);
  await content.update();
  assert.deepEqual(messages, []);
  content.receive({ type: 'web-terminal:bridge-ready' });
  assert.deepEqual(messages, [{ type: 'web-terminal:text-attachment', attachment }]);
  content.receive({ type: 'web-terminal:bridge-ready' });
  assert.equal(messages.length, 1);
  await content.update(true);
  content.sendAttachment({ ...attachment, id: 'selection-2' });
  assert.equal(messages.length, 1);
  content.receive({ type: 'web-terminal:bridge-ready' });
  assert.equal(messages.length, 2);
  content.dispose();
  content.sendAttachment(attachment);
  assert.equal(messages.length, 2);
});
