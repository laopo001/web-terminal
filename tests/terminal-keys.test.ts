import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowSequence } from '../src/client/terminalKeys.ts';
import { draftSubmission } from '../src/shared/terminalInput.ts';

test('方向按钮遵循终端普通模式与应用光标模式', () => {
  for (const [direction, suffix] of [['up', 'A'], ['down', 'B'], ['left', 'D'], ['right', 'C']] as const) {
    assert.equal(arrowSequence(direction, false), `\x1b[${suffix}`);
    assert.equal(arrowSequence(direction, true), `\x1bO${suffix}`);
  }
});

test('底部发送显式提交一次，Enter 在粘贴标记之外', () => {
  assert.equal(draftSubmission('echo 123', false), 'echo 123\r');
  assert.equal(draftSubmission('你好', true), '\x1b[200~你好\x1b[201~\r');
  assert.equal(draftSubmission('第一行\n第二行', true), '\x1b[200~第一行\r第二行\x1b[201~\r');
});
