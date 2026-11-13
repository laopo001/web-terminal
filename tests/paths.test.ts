import assert from 'node:assert/strict';
import test from 'node:test';
import headless from '@xterm/headless';
import type { Terminal } from '@xterm/xterm';
import { findLinks, findPaths, findUrls, isImagePath, isTextPath, quoteForShell, unwrapTerminalRows } from '../src/client/paths.ts';
import { createOscLinkHandler, terminalLinkProvider } from '../src/client/links.ts';
import { parseExternalUrl, parseFileUriPath } from '../src/shared/externalUrl.ts';

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

test('不把 URL 截断成 //path，并识别 HTTP(S) 与其他协议链接', () => {
  const gitRemote = 'origin  https://github.com/LoveRain1997/h3-prompt-journal.git (fetch)';
  assert.deepEqual(findPaths(gitRemote), []);
  assert.deepEqual(findUrls(gitRemote), [{ url: 'https://github.com/LoveRain1997/h3-prompt-journal.git', start: 8, end: 61 }]);

  const codexPreview = '导演预览已可打开：新粗模预览 (http://localhost:18173/?frame=0)。目前没有配音';
  assert.deepEqual(findUrls(codexPreview).map(item => item.url), ['http://localhost:18173/?frame=0']);
  assert.deepEqual(findUrls('[docs](https://en.wikipedia.org/wiki/Foo_(bar))').map(item => item.url), ['https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepEqual(findUrls('ipv6 http://[::1]:3840/api，端口3840').map(item => item.url), ['http://[::1]:3840/api']);

  const mixed = 'ws://127.0.0.1:3840/ws ftp://ftp.example.com/a.tar.gz ssh://git@github.com/org/repo.git git+https://github.com/org/repo.git vscode://file/home/laop/a.ts:10 mailto:dev@example.com';
  assert.deepEqual(findUrls(mixed).map(item => item.url), [
    'ws://127.0.0.1:3840/ws',
    'ftp://ftp.example.com/a.tar.gz',
    'ssh://git@github.com/org/repo.git',
    'git+https://github.com/org/repo.git',
    'vscode://file/home/laop/a.ts:10',
    'mailto:dev@example.com',
  ]);
  assert.deepEqual(findPaths(mixed), []);

  const quotedMixed = 'curl "https://github.com/a/b.git" -o /tmp/b.git';
  assert.deepEqual(findUrls(quotedMixed).map(item => item.url), ['https://github.com/a/b.git']);
  assert.deepEqual(findPaths(quotedMixed).map(item => item.path), ['/tmp/b.git']);
});

test('file:// 本地路径保持识别并支持无扩展名与带主机名 URI，同时拦截危险协议', () => {
  assert.deepEqual(findUrls('file:///tmp/100%.png file://localhost/tmp/README'), []);
  assert.deepEqual(findPaths('file:///tmp/100%.png file://localhost/tmp/README file://ubuntu/home/laop/Makefile "file:///tmp/my%20file.png"').map(item => item.path), [
    '/tmp/100%.png',
    '/tmp/README',
    '/home/laop/Makefile',
    '/tmp/my file.png',
  ]);
  assert.deepEqual(findLinks('见（/tmp/a.png）与https://example.com，继续').map(item => item.kind === 'url' ? item.url : item.path), [
    '/tmp/a.png',
    'https://example.com',
  ]);

  for (const invalid of ['javascript:alert(1)', 'javascript://comment/foo.js', 'data:text/html,hi', 'http://', 'https://...', 'error:123']) {
    assert.deepEqual(findUrls(invalid), []);
    assert.deepEqual(findPaths(invalid), []);
  }
  assert.equal(parseExternalUrl('ms-msdt:/id'), null);
  assert.equal(parseExternalUrl('smb://server/share'), null);
  assert.equal(parseExternalUrl('file:///etc/passwd'), null);
  assert.equal(parseFileUriPath('file:///C:/Users/me/a.txt'), 'C:/Users/me/a.txt');
  assert.equal(parseFileUriPath('file:///'), null);
});

test('终端 LinkProvider 与 OSC 8 LinkHandler 统一分发本地文件与外部协议', async () => {
  const term = new headless.Terminal({ cols: 120, rows: 6, allowProposedApi: true });
  await new Promise<void>(resolve => term.write('origin  https://github.com/LoveRain1997/h3-prompt-journal.git ./local.png\r\n', resolve));

  const activatedPaths: Array<{ path: string; base: string }> = [];
  const activatedUrls: string[] = [];
  const hovered: Array<{ path: string; base: string; point: { x: number; y: number } }> = [];
  let left = 0;
  const handlers = {
    base: (row: number) => (row === 0 ? '/work/repo' : ''),
    activatePath: (path: string, base: string) => activatedPaths.push({ path, base }),
    activateUrl: (url: string) => activatedUrls.push(url),
    hover: (path: string, base: string, point: { x: number; y: number }) => hovered.push({ path, base, point }),
    leave: () => { left++; },
  };

  const provider = terminalLinkProvider(term as unknown as Terminal, handlers);
  const links = await new Promise<NonNullable<Parameters<Parameters<typeof provider.provideLinks>[1]>[0]>>(resolve => {
    provider.provideLinks(1, items => resolve(items ?? []));
  });
  assert.equal(links.length, 2);
  assert.equal(links[0].text, 'https://github.com/LoveRain1997/h3-prompt-journal.git');
  assert.deepEqual(links[0].range, { start: { x: 9, y: 1 }, end: { x: 61, y: 1 } });
  assert.equal(links[1].text, './local.png');

  links[0].activate({} as MouseEvent, links[0].text);
  links[1].activate({} as MouseEvent, links[1].text);
  links[1].hover?.({ clientX: 12, clientY: 34 } as MouseEvent, links[1].text);
  links[1].leave?.({} as MouseEvent, links[1].text);

  const oscHandler = createOscLinkHandler(handlers);
  assert.equal(oscHandler.allowNonHttpProtocols, true);
  const range = { start: { x: 1, y: 1 }, end: { x: 10, y: 1 } };
  oscHandler.activate({} as MouseEvent, 'http://localhost:18173/?frame=0', range);
  oscHandler.activate({} as MouseEvent, 'vscode://file/home/laop/a.ts:10', range);
  oscHandler.activate({} as MouseEvent, 'file://myhost/tmp/pic.png', range);
  oscHandler.hover?.({ clientX: 50, clientY: 60 } as MouseEvent, 'file://myhost/tmp/pic.png', range);
  oscHandler.hover?.({ clientX: 50, clientY: 60 } as MouseEvent, 'https://example.com', range);
  oscHandler.leave?.({} as MouseEvent, 'https://example.com', range);

  assert.deepEqual(activatedUrls, [
    'https://github.com/LoveRain1997/h3-prompt-journal.git',
    'http://localhost:18173/?frame=0',
    'vscode://file/home/laop/a.ts:10',
  ]);
  assert.deepEqual(activatedPaths, [
    { path: './local.png', base: '/work/repo' },
    { path: '/tmp/pic.png', base: '/work/repo' },
  ]);
  assert.deepEqual(hovered, [
    { path: './local.png', base: '/work/repo', point: { x: 12, y: 34 } },
    { path: '/tmp/pic.png', base: '/work/repo', point: { x: 50, y: 60 } },
  ]);
  assert.equal(left, 3);
  term.dispose();

  const wrappedTerm = new headless.Terminal({ cols: 40, rows: 4, allowProposedApi: true });
  await new Promise<void>(resolve => wrappedTerm.write('origin  https://github.com/LoveRain1997/h3-prompt-journal.git', resolve));
  const wrappedProvider = terminalLinkProvider(wrappedTerm as unknown as Terminal, handlers);
  const wrappedLinks = await new Promise<NonNullable<Parameters<Parameters<typeof wrappedProvider.provideLinks>[1]>[0]>>(resolve => {
    wrappedProvider.provideLinks(2, items => resolve(items ?? []));
  });
  assert.equal(wrappedLinks.length, 1);
  assert.equal(wrappedLinks[0].text, 'https://github.com/LoveRain1997/h3-prompt-journal.git');
  assert.deepEqual(wrappedLinks[0].range, { start: { x: 9, y: 1 }, end: { x: 21, y: 2 } });
  wrappedTerm.dispose();
});
