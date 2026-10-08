// playwright-cli run-code --filename=scripts/smoke-terminal-mouse.js
// 在本任务新建的 Vite 开发页 ?check=mouse 运行，不连接或操作真实 CLI 会话。
async page => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  check(/[?&]check=mouse(?:&|$)/.test(page.url()), '不是本任务的鼠标测试页面');
  await page.reload();
  await page.evaluate(async () => {
    const xterm = await import('/node_modules/.vite/deps/@xterm_xterm.js');
    const { preferTextSelection, preferScrollback } = await import('/src/client/terminalInteraction.ts');
    const { enableTerminalClipboard } = await import('/src/client/terminalClipboard.ts');
    const { enableTouchInteraction } = await import('/src/client/terminalTouch.ts');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div');
    host.style.cssText = 'width:900px;height:500px;padding:20px;background:#101821';
    document.body.appendChild(host);
    const Terminal = xterm.Terminal || xterm.default.Terminal;
    window.__mouseTest = { host, Terminal, preferTextSelection, preferScrollback, enableTerminalClipboard, enableTouchInteraction };
  });
  const setup = async (mode, alternate = false) => {
    await page.evaluate(async ({ mode, alternate }) => {
      const test = window.__mouseTest;
      test.touch?.dispose(); test.selection?.dispose(); test.scrolling?.dispose(); test.clipboard?.dispose(); test.term?.dispose();
      test.host.replaceChildren();
      const term = test.term = new test.Terminal({ cols: 80, rows: 24, fontSize: 16, fontFamily: 'Consolas, monospace', allowProposedApi: true });
      term.open(test.host);
      test.selection = test.preferTextSelection(term); test.scrolling = test.preferScrollback(term);
      test.sent = []; test.copied = []; test.errors = []; test.live = true; test.active = true;
      test.touch = test.enableTouchInteraction(term, { copyMode: () => false, sendScrollInput: data => test.sent.push(data), copyText: text => test.copied.push(text) });
      test.clipboard = test.enableTerminalClipboard(term, {
        canWrite: () => test.live && test.active,
        writeText: async text => { test.copied.push(text); },
        onError: error => test.errors.push(String(error)),
      });
      term.onData(data => {
        test.sent.push(data);
        // 模拟 CLI 原生选区：只有收到按下/拖动/松开，才由应用产生复制请求和提示。
        const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
        if (!mouse) return;
        const [, button, col, row, state] = mouse;
        if (button === '0' && row === '1' && state === 'M') test.start = Number(col) - 1;
        if (button === '0' && row === '1' && state === 'm' && test.start !== undefined) {
          const text = 'Drag select this text'.slice(test.start, Number(col) - 1);
          test.start = undefined;
          if (text) term.write(`\x1b]52;c;${btoa(text)}\x1b\\\x1b[6;1HCopied ${text.length} chars to host clipboard`);
        }
        if (button === '0' && row === '2' && state === 'M') term.write('\x1b[2;1HReturned to bottom');
      });
      await new Promise(resolve => term.write((alternate ? '\x1b[?1049h' : '') + 'Drag select this text\r\nBack to bottom\r\n中文文字选择\r\n' + (mode ? `\x1b[?${mode}h\x1b[?1006h` : ''), resolve));
    }, { mode, alternate });
    const box = await page.locator('.xterm-screen').boundingBox();
    return { x: box.x, y: box.y, w: box.width / 80, h: box.height / 24 };
  };
  const selection = () => page.evaluate(() => window.__mouseTest.term.getSelection());
  const clearReports = () => page.evaluate(() => { window.__mouseTest.sent.length = 0; });
  const reports = () => page.evaluate(() => window.__mouseTest.sent);
  const drag = async (p, row = 0, end = 15) => {
    await page.mouse.move(p.x + p.w * .2, p.y + p.h * (row + .5));
    await clearReports(); await page.mouse.down();
    await page.mouse.move(p.x + p.w * end, p.y + p.h * (row + .5), { steps: 12 });
    await page.mouse.up();
  };
  const results = [];
  for (const alternate of [false, true]) {
    for (const mode of [0, 1000, 1002, 1003]) {
      const p = await setup(mode, alternate);
      await drag(p);
      if (mode) {
        await page.waitForFunction(() => window.__mouseTest.copied.length === 1);
        check(await selection() === '', '普通拖动被错误转换成本地选区');
        check(await page.evaluate(() => window.__mouseTest.copied[0].startsWith('Drag select')), 'CLI 原生复制请求未到达剪贴板');
        await page.waitForFunction(() => window.__mouseTest.term.buffer.active.getLine(5).translateToString(true).includes('chars to host clipboard'));
        const sent = await reports();
        check(sent.some(data => /^\x1b\[<0;/.test(data)), 'CLI 没有收到鼠标按下');
        check(sent.some(data => /^\x1b\[<0;.*m$/.test(data)), 'CLI 没有收到鼠标松开');
        if (mode !== 1000) check(sent.some(data => /^\x1b\[<32;/.test(data)), 'CLI 没有收到鼠标拖动');
        await page.mouse.click(p.x + p.w * 5, p.y + p.h * 1.5);
        await page.waitForFunction(() => window.__mouseTest.term.buffer.active.getLine(1).translateToString(true).startsWith('Returned to bottom'));
        await page.keyboard.down('Shift'); await drag(p); await page.keyboard.up('Shift');
      }
      check((await selection()).startsWith('Drag select'), '本地拖选失败');
      check((await reports()).length === 0, '本地选字泄漏鼠标报告');
      const selected = await selection();
      await page.mouse.move(p.x + p.w * 25, p.y + p.h * 4);
      check(await selection() === selected, '移动鼠标清空本地选区');
      check((await reports()).length === 0, '本地选区存在时仍发送悬停');
      results.push({ mode, alternate, nativeSelectionAndCopy: !!mode, localSelectionPersists: true });
    }
  }
  const p = await setup(1003);
  await page.keyboard.down('Shift'); await drag(p, 2, 12); await page.keyboard.up('Shift');
  check((await selection()).includes('中文文字选择'), '中文本地拖选失败');
  await page.evaluate(async () => {
    const test = window.__mouseTest;
    await new Promise(resolve => test.term.write('\r\nHistory\r\n'.repeat(40), resolve));
    test.term.scrollToTop(); test.sent.length = 0;
  });
  await page.mouse.click(p.x + p.w * 5, p.y + p.h * 1.5);
  check(!(await reports()).some(data => /^\x1b\[<0;/.test(data)), '点击本地历史误发送远端点击');
  await page.evaluate(async () => {
    const test = window.__mouseTest;
    test.live = false;
    await new Promise(resolve => test.term.write('\x1b]52;c;cmVwbGF5\x07', resolve));
    test.live = true; test.active = false;
    await new Promise(resolve => test.term.write('\x1b]52;c;aGlkZGVu\x07', resolve));
    test.active = true;
    await new Promise(resolve => test.term.write('\x1b]52;c;?\x07', resolve));
  });
  check(await page.evaluate(() => window.__mouseTest.copied.length === 0), '快照、隐藏会话或查询触发了剪贴板写入');
  await page.evaluate(() => { const test = window.__mouseTest; test.touch.dispose(); test.selection.dispose(); test.scrolling.dispose(); test.clipboard.dispose(); test.term.dispose(); });
  return { cases: results, chineseSelection: true, localHistorySafe: true, clipboardGuards: true };
}
