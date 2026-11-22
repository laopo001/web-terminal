import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowSequence, MOBILE_TERMINAL_KEYS, mobileKeySequence } from '../src/client/terminalKeys.ts';
import { draftSubmission } from '../src/shared/terminalInput.ts';

test('方向按钮遵循终端普通模式与应用光标模式', () => {
  for (const [direction, suffix] of [['up', 'A'], ['down', 'B'], ['left', 'D'], ['right', 'C']] as const) {
    assert.equal(arrowSequence(direction, false), `\x1b[${suffix}`);
    assert.equal(arrowSequence(direction, true), `\x1bO${suffix}`);
  }
});

test('触屏快捷键包含斜杠并按顺序发送对应按键序列', () => {
  assert.deepEqual(
    MOBILE_TERMINAL_KEYS.map(key => [key.id, key.label]),
    [['tab', 'Tab'], ['slash', '/'], ['left', '←'], ['up', '↑'], ['down', '↓'], ['right', '→']],
  );
  for (const applicationMode of [false, true]) {
    assert.equal(mobileKeySequence('tab', applicationMode), '\t');
    assert.equal(mobileKeySequence('slash', applicationMode), '/');
    for (const direction of ['left', 'up', 'down', 'right'] as const) {
      assert.equal(mobileKeySequence(direction, applicationMode), arrowSequence(direction, applicationMode));
    }
  }
});

test('底部发送显式提交一次，Enter 在粘贴标记之外', () => {
  assert.equal(draftSubmission('echo 123', false), 'echo 123\r');
  assert.equal(draftSubmission('你好', true), '\x1b[200~你好\x1b[201~\r');
  assert.equal(draftSubmission('第一行\n第二行', true), '\x1b[200~第一行\r第二行\x1b[201~\r');
});
