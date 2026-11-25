import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import type { Terminal } from '@xterm/xterm';
import { suppressTerminalResponses } from '../src/client/terminalResponses.ts';
import { isFocusReport } from '../src/client/terminalInteraction.ts';
import { sessionLabel, sessionTooltip } from '../src/client/SessionTabs.tsx';

test('浏览器不重复回答终端查询，输入模式照常更新', async () => {
  const term = new headless.Terminal({ allowProposedApi: true });
  const guard = suppressTerminalResponses(term as unknown as Terminal);
  const responses: string[] = []; term.onData(data => responses.push(data));
  await new Promise<void>(resolve => term.write('\x1b[c\x1b[>c\x1b[6n\x1b[?6n\x1bP$qm\x1b\\\x1b[?2004h', resolve));
  assert.deepEqual(responses, []); assert(term.modes.bracketedPasteMode);
  guard.dispose(); term.dispose();
});

test('标题采用 OSC 原文，保留动画字符并支持任意 CLI', () => {
  const base = { id: 'test', name: '终端', cwd: '/home/me/project', createdAt: '', running: true };
  assert.equal(sessionLabel({ ...base, processName: 'claude', title: 'DISABLE_AUTOUPDATER=1 claude --name test' }).name, 'DISABLE_AUTOUPDATER=1 claude --name test');
  assert.equal(sessionLabel({ ...base, processName: 'codex', title: '⠋ 实现图片预览 | project' }).name, '⠋ 实现图片预览 | project');
  assert.equal(sessionLabel({ ...base, processName: 'codex', title: '⠋ project' }).name, '⠋ project');
  assert.equal(sessionLabel({ ...base, processName: 'some-cli', title: '⠋ 正在构建' }).name, '⠋ 正在构建');
  assert.equal(sessionLabel({ ...base, processName: 'zsh', title: 'Shell 提供的标题' }).name, 'Shell 提供的标题');
  assert.equal(sessionLabel({ ...base, processName: 'some-cli' }).name, 'some-cli');
  assert.equal(sessionLabel({ ...base, processName: 'claude', title: '终端画面验证' }).command, 'claude');
  assert.equal(sessionLabel({ ...base, processName: 'agy', title: '终端画面验证' }).command, 'agy');
  assert.equal(sessionLabel({ ...base, processName: '/usr/bin/zsh', title: 'Shell 提供的标题' }).command, 'zsh');
  assert.equal('agent' in sessionLabel({ ...base, processName: 'claude', title: '终端画面验证' }), false);
});

test('悬停提示补充运行中会话的前台进程名', () => {
  const base = { id: 'test', name: '终端', cwd: '/home/me/project', createdAt: '', running: true };
  assert.equal(
    sessionTooltip({ ...base, processName: 'claude', title: '✳ 终端画面验证' }, '会话运行中', '蓝色'),
    '✳ 终端画面验证\n/home/me/project\n前台进程：claude\n会话运行中\n标签颜色：蓝色\n拖动可排序，拖到组名加入分组',
  );
  assert.equal(
    sessionTooltip({ ...base, processName: '/usr/local/bin/agy', title: '任务讨论' }, '会话运行中'),
    '任务讨论\n/home/me/project\n前台进程：agy\n会话运行中\n拖动可排序，拖到组名加入分组',
  );
  assert(!sessionTooltip({ ...base, running: false, processName: 'claude' }, '会话已结束').includes('前台进程：'));
  assert(!sessionTooltip({ ...base, title: '终端' }, '会话运行中').includes('前台进程：'));
});

test('焦点报告与真实输入分开识别', () => {
  assert(isFocusReport('\x1b[I')); assert(isFocusReport('\x1b[O'));
  for (const input of ['hello', '\r', '\x1b[A', 'I', 'O', '\x1b[200~hello\x1b[201~']) assert(!isFocusReport(input));
});

test('鼠标报告不会被当作键盘输入重新接管尺寸', async () => {
  const { isMouseReport } = await import('../src/client/terminalInteraction.ts');
  assert(isMouseReport('\x1b[<64;10;5M'));
  assert(isMouseReport('\x1b[M !!'));
  assert(!isMouseReport('\x1b[A'));
  assert(!isMouseReport('hello'));
});
