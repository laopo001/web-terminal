import assert from 'node:assert/strict';
import test from 'node:test';
import { findPaths, isImagePath, isTextPath, quoteForShell, unwrapTerminalRows } from '../src/client/paths.ts';

test('recognizes markdown, Chinese and quoted paths with spaces', () => {
  assert.deepEqual(findPaths('![图](/home/张三/图片.png)')[0]?.path, '/home/张三/图片.png');
  assert.deepEqual(findPaths('open "/home/me/my images/a b.webp"')[0]?.path, '/home/me/my images/a b.webp');
  assert.deepEqual(findPaths('see ./结果/图像.jpeg, now')[0]?.path, './结果/图像.jpeg');
  assert.equal(findPaths('~/pictures/test.png')[0]?.path, '~/pictures/test.png');
  assert.equal(findPaths('file:///tmp/100%.png')[0]?.path, '/tmp/100%.png');
});
test('joins soft wraps without changing hard line boundaries', () => {
  assert.equal(unwrapTerminalRows(['/home/me/im', 'age.png', 'next'], [false, true, false]), '/home/me/image.png\nnext');
});
test('distinguishes images and safely quotes shell paths', () => {
  assert.equal(isImagePath('/tmp/a.svg'), true);
  assert.equal(isImagePath('/tmp/a.txt'), false);
  assert.equal(quoteForShell("/tmp/a b'c.png"), "'/tmp/a b'\\''c.png'");
  assert.equal(quoteForShell('/tmp/$(whoami).png'), "'/tmp/$(whoami).png'");
});

test('maps wide Chinese and emoji glyphs to terminal cells', async () => {
  const { terminalLineMap } = await import('../src/client/links.ts');
  const cells = [
    { chars: '/', width: 1 }, { chars: '图', width: 2 }, { chars: '', width: 0 },
    { chars: '😀', width: 2 }, { chars: '', width: 0 }, { chars: '.', width: 1 },
    { chars: 'p', width: 1 }, { chars: 'n', width: 1 }, { chars: 'g', width: 1 },
  ];
  const fake = { buffer: { active: { getLine: () => ({ length: cells.length, getCell: (i: number) => ({ getChars: () => cells[i].chars, getWidth: () => cells[i].width }) }) } } };
  const result = terminalLineMap(fake as never, 0, 0);
  assert.equal(result.text, '/图😀.png');
  assert.deepEqual(result.positions[1], { x: 2, y: 1 });
  assert.deepEqual(result.positions[2], { x: 4, y: 1 });
  assert.deepEqual(result.positions[3], { x: 4, y: 1 });
  assert.deepEqual(result.positions[4], { x: 6, y: 1 });
});


test('文本预览识别 Markdown、代码与配置文件，不将常见二进制当作文本', () => {
  for (const path of ['/home/me/browser.md', '/tmp/script.tsx', '/tmp/adapter.yaml', '/tmp/a.TXT']) assert.equal(isTextPath(path), true);
  for (const path of ['/tmp/archive.zip', '/tmp/picture.png', '/tmp/movie.mp4']) assert.equal(isTextPath(path), false);
});
