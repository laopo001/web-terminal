import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultClientSettings, loadClientSettings, saveClientSettings } from '../src/client/clientSettings.ts';

function withStorage(run: (data: Map<string, string>) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { run(data); } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}

test('统一交互模式默认原生，保留旧字体并在保存后迁移', () => withStorage(data => {
  data.set('web-terminal.fontFamily', 'Consolas');
  assert.deepEqual(loadClientSettings(), { fontFamily: 'Consolas', interactionMode: 'native' });
  saveClientSettings({ fontFamily: 'Cascadia Code', interactionMode: 'local' });
  assert.deepEqual(loadClientSettings(), { fontFamily: 'Cascadia Code', interactionMode: 'local' });
  assert.equal(data.has('web-terminal.fontFamily'), false);
}));

test('无效设置回退默认值，未知模式不能启用本地选择', () => withStorage(data => {
  for (const value of ['null', '[]', 'broken']) {
    data.set('web-terminal.settings', value);
    assert.deepEqual(loadClientSettings(), defaultClientSettings);
  }
  data.set('web-terminal.settings', JSON.stringify({ fontFamily: 42, interactionMode: 'auto' }));
  assert.deepEqual(loadClientSettings(), defaultClientSettings);
}));

test('存储不可用时仍能加载默认设置，保存失败向界面抛出', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage denied'); } });
  try { assert.deepEqual(loadClientSettings(), defaultClientSettings); assert.throws(() => saveClientSettings(defaultClientSettings), /storage denied/); }
  finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
