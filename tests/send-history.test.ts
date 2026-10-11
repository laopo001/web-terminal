import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSendHistory, loadSendHistory } from '../src/client/sendHistory.ts';

test('发送历史保留重复、多行和最近 100 条，跨读取恢复', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  } });
  try {
    assert.deepEqual(loadSendHistory(), []);
    appendSendHistory('第一行\n第二行'); appendSendHistory('第一行\n第二行');
    assert.deepEqual(loadSendHistory(), ['第一行\n第二行', '第一行\n第二行']);
    appendSendHistory('  ');
    assert.equal(loadSendHistory().length, 2);
    for (let i = 0; i < 105; i++) appendSendHistory(`命令 ${i}`);
    const entries = loadSendHistory();
    assert.equal(entries.length, 100); assert.equal(entries[0], '命令 5'); assert.equal(entries.at(-1), '命令 104');
    data.set('web-terminal.sendHistory', JSON.stringify([null, 7, '', '保留']));
    assert.deepEqual(loadSendHistory(), ['保留']);
    for (const raw of ['broken', '{}', 'null']) {
      data.set('web-terminal.sendHistory', raw); assert.deepEqual(loadSendHistory(), []);
      appendSendHistory('恢复'); assert.deepEqual(loadSendHistory(), ['恢复']);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('存储不可用时读取安全回退，保存失败可由发送流程提示', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage denied'); } });
  try { assert.deepEqual(loadSendHistory(), []); assert.throws(() => appendSendHistory('命令'), /storage denied/); }
  finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
