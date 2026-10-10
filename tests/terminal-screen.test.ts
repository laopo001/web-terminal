import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import { TerminalScreen } from '../src/server/terminalScreen.ts';
import { EscapeTail } from '../src/server/escapeTail.ts';
import type { TerminalProgress } from '../src/shared/protocol.ts';
const write = (term: headless.Terminal, data: string) => new Promise<void>(resolve => term.write(data, resolve));
const text = (term: headless.Terminal) => Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true));

test('OSC 9;4 支持分块、BEL/ST、进度状态、清除和终端重置', async () => {
  const progress: (TerminalProgress | undefined)[] = [], titles: string[] = [];
  const screen = new TerminalScreen(title => titles.push(title), () => {}, value => progress.push(value));
  try {
    await screen.write('\x1b]9;4;1;', () => {});
    assert.equal(progress.length, 0);
    await screen.write('35\x07', () => {});
    assert.deepEqual(progress.at(-1), { state: 1, value: 35 });
    await screen.write('\x1b]9;4;2\x1b\\\x1b]9;4;3;90\x07\x1b]9;4;4;120\x07', () => {});
    assert.deepEqual(progress.slice(-3), [{ state: 2, value: 35 }, { state: 3, value: 35 }, { state: 4, value: 100 }]);
    const count = progress.length;
    await screen.write('\x1b]9;通知\x07\x1b]9;4;9;50\x07\x1b]9;4;1;bad\x07\x1b]9;4;1;-1\x07\x1b]2;⠋ 任意 CLI\x07', () => {});
    assert.equal(progress.length, count); assert.deepEqual(titles, ['⠋ 任意 CLI']);
    await screen.write('\x1b]9;4;0\x07', () => {}); assert.equal(progress.at(-1), undefined);
    await screen.write('\x1b]9;4;1\x07', () => {}); assert.deepEqual(progress.at(-1), { state: 1, value: 0 });
    await screen.write('\x1bc', () => {}); assert.equal(progress.at(-1), undefined);
    assert(!text(screen.terminal).some(line => line?.includes('4;')));
  } finally { await screen.dispose(); }
});

test('快照保持全屏、中文、样式、光标、输入模式，清除的文字不会回放', async () => {
  const titles: string[] = [], replies: string[] = [];
  const screen = new TerminalScreen(title => titles.push(title), data => replies.push(data));
  const restored = new headless.Terminal({ allowProposedApi: true, cols: 40, rows: 12 });
  try {
    await screen.run(() => screen.resize(40, 12));
    await screen.write('OLD\x1b[2J\x1b[H\x1b[?1049h\x1b[31m中文 new\x1b[4;8Hposition\x1b[?2004h\x1b[?1h\x1b[?25l\x1b]2;对话标题\x07\x1b[6n', () => {});
    const snapshot = screen.snapshot();
    assert(!snapshot.data.includes('OLD'));
    await write(restored, snapshot.data);
    assert.deepEqual(text(restored), text(screen.terminal));
    assert.equal(restored.buffer.active.type, 'alternate');
    assert.equal(restored.buffer.active.cursorX, screen.terminal.buffer.active.cursorX);
    assert.equal(restored.buffer.active.cursorY, screen.terminal.buffer.active.cursorY);
    assert(restored.modes.bracketedPasteMode); assert(restored.modes.applicationCursorKeysMode);
    assert.deepEqual(titles, ['对话标题']); assert.deepEqual(replies, ['\x1b[4;16R']);
  } finally { restored.dispose(); await screen.dispose(); }
});

test('分块控制序列、换行边界与后续增量在快照恢复后保持一致', async () => {
  for (const [before, after] of [['1234567890', 'X'], ['\x1b[3', '1mRED'], ['\x1b]2;对话', '标题\x1b\\OK'], ['\x1bP$q', 'm\x1b\\OK']]) {
    const screen = new TerminalScreen(() => {}, () => {});
    const restored = new headless.Terminal({ cols: 10, rows: 5, allowProposedApi: true });
    try {
      await screen.run(() => screen.resize(10, 5));
      await screen.write(before, () => {}); await write(restored, screen.snapshot().data);
      await screen.write(after, () => {}); await write(restored, after);
      assert.deepEqual(text(restored), text(screen.terminal), JSON.stringify(before));
      assert.equal(restored.buffer.active.cursorX, screen.terminal.buffer.active.cursorX);
    } finally { restored.dispose(); await screen.dispose(); }
  }
});

test('控制序列尾部限制内存，完成或取消后恢复', () => {
  const tail = new EscapeTail(); tail.push('\x1b]2;' + 'x'.repeat(70000));
  assert.throws(() => tail.value()); tail.push('\x07'); assert.equal(tail.value(), '');
  tail.push('\x1b[12'); assert.equal(tail.value(), '\x1b[12'); tail.push('\x18'); assert.equal(tail.value(), '');
});

test('滚动区域、历史和后续绘制在恢复前后相同', async () => {
  const screen = new TerminalScreen(() => {}, () => {}), restored = new headless.Terminal({ cols: 20, rows: 8, allowProposedApi: true });
  try {
    await screen.run(() => screen.resize(20, 8));
    await screen.write(Array.from({ length: 30 }, (_, i) => `line-${i}\r\n`).join('') + '\x1b[2;6r\x1b[3;2Hhere', () => {});
    await write(restored, screen.snapshot().data);
    const next = '\x1b[6;1Hnext\nmore\n';
    await screen.write(next, () => {}); await write(restored, next);
    assert.deepEqual(text(restored), text(screen.terminal));
  } finally { restored.dispose(); await screen.dispose(); }
});

test('快照恢复鼠标编码，Codex 全屏重连后仍能识别滚轮', async () => {
  const screen = new TerminalScreen(() => {}, () => {});
  const restored = new headless.Terminal({ cols: 100, rows: 30, allowProposedApi: true });
  const replies: string[] = []; restored.onData(data => replies.push(data));
  try {
    for (const mode of [1006, 1016]) {
      await screen.write(`\x1b[?1049h\x1b[?1003h\x1b[?${mode}h`, () => {});
      restored.reset(); await write(restored, screen.snapshot().data);
      await write(restored, `\x1b[?${mode}$p`);
      assert.equal(replies.at(-1), `\x1b[?${mode};1$y`);
      assert.equal(restored.modes.mouseTrackingMode, 'any');
      await screen.write(`\x1b[?${mode}l`, () => {});
      restored.reset(); await write(restored, screen.snapshot().data); await write(restored, `\x1b[?${mode}$p`);
      assert.equal(replies.at(-1), `\x1b[?${mode};2$y`);
    }
  } finally { restored.dispose(); await screen.dispose(); }
});
