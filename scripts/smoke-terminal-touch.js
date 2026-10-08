// playwright-cli run-code --filename=scripts/smoke-terminal-touch.js
// 在本任务新建的 Vite 开发页 ?check=touch-routing 运行；使用同一页面验证统一交互设置对鼠标、手指和笔的效果。
async page => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  check(/[?&]check=touch-routing(?:&|$)/.test(page.url()), '不是本任务的触摸测试页面');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.setViewportSize({ width: 480, height: 820 });
  await page.bringToFront(); await page.reload();
  await page.evaluate(async () => {
    const xterm = await import('/node_modules/.vite/deps/@xterm_xterm.js');
    const { preferTextSelection, preferScrollback } = await import('/src/client/terminalInteraction.ts');
    const { enableTouchInteraction } = await import('/src/client/terminalTouch.ts');
    const { writeClipboardText } = await import('/src/client/terminalClipboard.ts');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div'); host.style.cssText = 'width:460px;height:480px;margin:10px;background:#101821'; document.body.append(host);
    const Terminal = xterm.Terminal || xterm.default.Terminal;
    const term = new Terminal({ cols: 40, rows: 20, fontSize: 16, fontFamily: 'Consolas, monospace', allowProposedApi: true }); term.open(host);
    const test = window.__touchTest = { term, sent: [], copied: [], errors: [], mode: 'native', copyMode: false };
    test.selection = preferTextSelection(term, () => test.mode === 'local'); test.scroll = preferScrollback(term);
    test.touch = enableTouchInteraction(term, {
      selectionMode: () => test.mode,
      copyMode: () => test.copyMode,
      sendScrollInput: data => test.sent.push(data),
      copyText: text => { void writeClipboardText(text).then(() => test.copied.push(text)).catch(error => test.errors.push(String(error))); },
    });
    term.onData(data => test.sent.push(data));
    await new Promise(resolve => term.write('alpha beta gamma delta\r\n中文复制测试 字符选择\r\nthird line selectable text\r\n\x1b[?1003h\x1b[?1006h', resolve));
  });
  const box = await page.locator('.xterm-screen').boundingBox(), w = box.width / 40, h = box.height / 20;
  const at = (col, row) => ({ x: box.x + w * (col + .5), y: box.y + h * (row + .5) });
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id, radiusX: 1, radiusY: 1 })) });
  const resetReports = () => page.evaluate(() => { window.__touchTest.sent.length = 0; });
  const selected = () => page.evaluate(() => window.__touchTest.term.getSelection());
  const reports = () => page.evaluate(() => window.__touchTest.sent);
  const hold = async p => { await resetReports(); await touch('touchStart', [p]); await page.waitForTimeout(500); };
  const tap = async p => { await touch('touchStart', [p]); await touch('touchEnd', []); };
  try {
    // 此页面同时具备触摸能力与鼠标，不能按设备能力全局切换。
    await page.mouse.move(at(0, 0).x, at(0, 0).y); await resetReports();
    await page.mouse.down(); await page.mouse.move(at(14, 0).x, at(14, 0).y, { steps: 8 }); await page.mouse.up();
    check((await reports()).some(data => /^\x1b\[<32;/.test(data)), '鼠标拖动没有交给 CLI');
    check(await selected() === '', '鼠标被切换成触摸选字');
    await page.evaluate(() => { window.__touchTest.mode = 'local'; window.__touchTest.copyMode = true; window.__touchTest.touch.cancel(); });
    await hold(at(7, 0));
    check(await selected() === 'beta', '手指长按未选择英文单词');
    await touch('touchEnd', []);
    check((await reports()).length === 0, '长按/兼容鼠标事件误发送到 CLI');
    check(await page.getByRole('button', { name: '调整选区起点' }).isVisible(), '缺少选区起点手柄');
    const end = await page.getByRole('button', { name: '调整选区终点' }).boundingBox();
    const endPoint = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
    await touch('touchStart', [endPoint]); await touch('touchMove', [{ x: endPoint.x + 6 * w, y: endPoint.y }]); await touch('touchEnd', []);
    check(await selected() === 'beta gamma', `终点手柄调整错误：${await selected()}`);
    const start = await page.getByRole('button', { name: '调整选区起点' }).boundingBox();
    const startPoint = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
    await touch('touchStart', [startPoint]); await touch('touchMove', [{ x: startPoint.x + w, y: startPoint.y }]); await touch('touchEnd', []);
    check(await selected() === 'eta gamma', `起点手柄调整错误：${await selected()}`);
    const actions = page.getByRole('toolbar', { name: '触屏选区操作' });
    const copy = await actions.getByRole('button', { name: '复制', exact: true }).boundingBox();
    await tap({ x: copy.x + copy.width / 2, y: copy.y + copy.height / 2 });
    await page.waitForFunction(() => window.__touchTest.copied.length === 1 || window.__touchTest.errors.length);
    check(await page.evaluate(() => window.__touchTest.copied[0]) === 'eta gamma', '触屏复制未写入选区文字');
    check((await reports()).length === 0, '调整手柄或复制误发送了 CLI 输入');
    await page.evaluate(() => { window.__touchClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard'); Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
    try {
      await tap({ x: copy.x + copy.width / 2, y: copy.y + copy.height / 2 });
      await page.waitForFunction(() => window.__touchTest.copied.length === 2 || window.__touchTest.errors.length);
      check(await page.evaluate(() => window.__touchTest.copied[1]) === 'eta gamma', 'HTTP 兼容复制失败');
      check(await selected() === 'eta gamma', '兼容复制清空选区');
    } finally {
      await page.evaluate(() => { const previous = window.__touchClipboardDescriptor; if (previous) Object.defineProperty(navigator, 'clipboard', previous); else delete navigator.clipboard; });
    }

    await page.screenshot({ path: '/tmp/web-terminal-touch-selection.png' });
    // 本地模式同时作用于鼠标；保存切回原生后，鼠标与触屏都恢复 CLI 报告。
    await page.mouse.move(at(0, 2).x, at(0, 2).y); await resetReports();
    await page.mouse.down(); await page.mouse.move(at(15, 2).x, at(15, 2).y, { steps: 8 }); await page.mouse.up();
    check((await selected()).startsWith('third line'), '本地模式没有同时应用到鼠标');
    check(!(await reports()).some(data => /^\x1b\[<0;/.test(data)), '本地鼠标选择仍发送 CLI 点击');
    await page.evaluate(() => { window.__touchTest.mode = 'native'; window.__touchTest.touch.cancel(); });
    await page.mouse.move(at(0, 2).x, at(0, 2).y); await resetReports();
    await page.mouse.down(); await page.mouse.move(at(15, 2).x, at(15, 2).y, { steps: 8 }); await page.mouse.up();
    check((await reports()).some(data => /^\x1b\[<32;/.test(data)), '手指切回鼠标后仍拦截 CLI 拖动');
    check(await selected() === '', '鼠标点击未结束触屏选区');
    await resetReports();
    const pen = at(5, 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pen.x, y: pen.y, pointerType: 'pen' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pen.x, y: pen.y, button: 'left', clickCount: 1, pointerType: 'pen' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pen.x, y: pen.y, button: 'left', clickCount: 1, pointerType: 'pen' });
    check((await reports()).filter(data => /^\x1b\[<0;/.test(data)).length === 2, '触控笔未保留原生点击');
    // 手指短按只产生一对报告，浏览器兼容鼠标事件不能再发送一次。
    await resetReports(); await tap(at(5, 2));
    check((await reports()).filter(data => /^\x1b\[<0;/.test(data)).length === 2, '手指短按重复或丢失点击');
    await resetReports(); await touch('touchStart', [at(5, 0)]); await touch('touchMove', [at(15, 0)]); await touch('touchEnd', []);
    check((await reports()).some(data => /^\x1b\[<32;/.test(data)), '原生模式触屏没有发送拖动');
    check(await selected() === '', '原生模式触屏仍建立本地选区');
    await page.evaluate(() => { window.__touchTest.mode = 'local'; window.__touchTest.copyMode = true; window.__touchTest.touch.cancel(); });
    await hold(at(2, 1)); await touch('touchEnd', []);
    check((await selected()).includes('中文复制测试'), '中文长按选字失败');
    await page.evaluate(() => { window.__touchTest.copyMode = false; window.__touchTest.touch.cancel(); });
    // 先滑动必须滚屏，不得在 450ms 后突然变成选字。
    await resetReports(); const p = at(20, 8);
    await touch('touchStart', [p]); await touch('touchMove', [{ x: p.x, y: p.y - 4 * h }]); await touch('touchEnd', []);
    await page.waitForTimeout(500);
    check(await selected() === '', '滑动后错误触发长按');
    check((await reports()).some(data => /^\x1b\[<6[45];/.test(data)), '手指滑动未继续发送应用滚轮');
    check(!(await reports()).some(data => /^\x1b\[<0;/.test(data)), '滚屏误发送点击');
    await resetReports(); await touch('touchStart', [at(5, 0)]); await touch('touchCancel', []); await page.waitForTimeout(500);
    check(await selected() === '', '取消触摸后仍触发长按');
    await touch('touchStart', [at(5, 0), at(12, 0)]); await page.waitForTimeout(500); await touch('touchEnd', []);
    check(await selected() === '', '多指触摸误触发选字');
    await page.evaluate(async () => { const t = window.__touchTest.term; await new Promise(resolve => t.write('\r\nhistory\r\n'.repeat(50), resolve)); });
    const before = await page.evaluate(() => window.__touchTest.term.buffer.active.viewportY);
    await resetReports(); await touch('touchStart', [p]); await touch('touchMove', [{ x: p.x, y: p.y + 4 * h }]); await touch('touchEnd', []);
    check(await page.evaluate(() => window.__touchTest.term.buffer.active.viewportY) < before, '本地历史不能触摸滚动');
    check((await reports()).length === 0, '本地滚动误发送应用鼠标输入');
    // 原生设置查看本地历史时，xterm 选区也必须能直接复制。
    await page.evaluate(() => { const t = window.__touchTest; t.mode = 'native'; t.copyMode = true; t.touch.cancel(); const b = t.term.buffer.active; for (let i = 0; i < b.length; i++) { if (b.getLine(i).translateToString(true).includes('history')) { t.term.scrollToLine(i); break; } } });
    await resetReports(); await touch('touchStart', [at(0, 0)]); await touch('touchMove', [at(6, 0)]); await touch('touchEnd', []);
    check((await selected()).startsWith('histor'), '原生设置的本地历史无法选字');
    check(await page.getByRole('toolbar', { name: '触屏选区操作' }).isVisible(), '原生设置的本地历史选区没有复制入口');
    check((await reports()).length === 0, '历史选字误操作了远端程序');

    return { manualModeSwitch: true, mouseLocal: true, nativeTouch: true, mouseNative: true, penNative: true, touchLongPress: true, bothHandles: true, touchCopy: true, clipboardFallback: true, noDuplicateClick: true, swipe: true, cancelledGesture: true, multiTouch: true, localHistory: true, historyCopyInNativeMode: true };
  } finally {
    await page.evaluate(() => { const t = window.__touchTest; t.touch.dispose(); t.selection.dispose(); t.scroll.dispose(); t.term.dispose(); });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
  }
}
