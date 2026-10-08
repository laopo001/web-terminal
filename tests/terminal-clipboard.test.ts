import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import type { Terminal } from '@xterm/xterm';
import { enableTerminalClipboard } from '../src/client/terminalClipboard.ts';

const osc = (text: string) => `\x1b]52;c;${Buffer.from(text).toString('base64')}\x1b\\`;

test('OSC 52 分块解码中文，写入剪贴板且不泄漏读取内容', async () => {
  const term = new headless.Terminal({ allowProposedApi: true });
  const copied: string[] = [], responses: string[] = [], errors: unknown[] = [];
  const clipboard = enableTerminalClipboard(term as unknown as Terminal, {
    canWrite: () => true, writeText: async text => { copied.push(text); }, onError: error => errors.push(error),
  });
  term.onData(data => responses.push(data));
  const write = (data: string) => new Promise<void>(resolve => term.write(data, resolve));
  const data = osc('你好！有什么需要我帮忙的？');
  await write(data.slice(0, 13)); await write(data.slice(13));
  await write('\x1b]52;c;?\x07');
  assert.deepEqual(copied, ['你好！有什么需要我帮忙的？']);
  assert.deepEqual(responses, []); assert.deepEqual(errors, []);
  clipboard.dispose(); term.dispose();
});

test('快照及非活动窗口不复制，拒绝和无效数据反馈错误，释放后停止处理', async () => {
  const term = new headless.Terminal({ allowProposedApi: true });
  let active = false;
  const copied: string[] = [], errors: unknown[] = [];
  const clipboard = enableTerminalClipboard(term as unknown as Terminal, {
    canWrite: () => active,
    writeText: async text => { if (text === 'denied') throw new Error('denied'); copied.push(text); },
    onError: error => errors.push(error),
  });
  const write = (data: string) => new Promise<void>(resolve => term.write(data, resolve));
  await write(osc('历史内容'));
  assert.deepEqual(copied, []);
  active = true;
  await write(osc('实时复制')); await write(osc('denied')); await write('\x1b]52;c;not base64!\x07');
  assert.deepEqual(copied, ['实时复制']); assert.equal(errors.length, 2);
  clipboard.dispose(); await write(osc('已释放'));
  assert.deepEqual(copied, ['实时复制']);
  term.dispose();
});
