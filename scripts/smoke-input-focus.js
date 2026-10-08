// playwright-cli run-code --filename=scripts/smoke-input-focus.js
// 在本任务创建并登录测试服务的 ?check=input-focus 页面运行。
async page => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  check(/[?&]check=input-focus(?:&|$)/.test(page.url()), '不是本任务的焦点测试页面');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.setViewportSize({ width: 390, height: 844 }); await page.bringToFront();
  await page.addInitScript(() => {
    if (window.__focusTest) return;
    window.__focusTest = { sockets: [], editingFocus: [] };
    document.addEventListener('focusin', event => {
      const el = event.target;
      if (el.isContentEditable || ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.readOnly)) window.__focusTest.editingFocus.push(el.className || el.tagName);
    });
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) { super(...args); this.focusEntry = { id: null, sent: [] }; window.__focusTest.sockets.push(this.focusEntry); }
      send(data) { try { const m = JSON.parse(data); if (m.type === 'auth') this.focusEntry.id = m.sessionId; this.focusEntry.sent.push(m); } catch {} super.send(data); }
    };
  });
  await page.reload(); await page.locator('.app').waitFor();
  const session = await page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('web-terminal.token')}`, 'Content-Type': 'application/json' };
    const info = await (await fetch('/api/info', { headers })).json();
    const r = await fetch('/api/sessions', { method: 'POST', headers, body: JSON.stringify({ name: 'focus-test', cwd: info.defaultCwd }) });
    if (!r.ok) throw Error(await r.text()); return r.json();
  });
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id, radiusX: 1, radiusY: 1 })) });
  const notEditing = () => page.evaluate(() => { const el = document.activeElement; return !el.isContentEditable && !((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.readOnly); });
  const sent = () => page.evaluate(id => window.__focusTest.sockets.filter(s => s.id === id).flatMap(s => s.sent).filter(m => m.type === 'input').map(m => m.data), session.id);
  try {
    await page.locator(`.session[data-session-id="${session.id}"] .session-select`).click();
    await page.locator(`.session[data-session-id="${session.id}"] .dot.live`).waitFor();
    const pane = page.locator(`.session-pane[data-session-id="${session.id}"]`), draft = pane.getByRole('textbox', { name: '待发送文字' });
    const focusDraft = async () => {
      await draft.click(); check(await draft.evaluate(el => el === document.activeElement), '点击输入框不能聚焦');
      await page.evaluate(() => { window.__focusTest.editingFocus.length = 0; });
    };
    const clickTool = async button => {
      await focusDraft(); await button.click(); check(await notEditing(), '工具栏保留了编辑焦点');
      check(await page.evaluate(() => window.__focusTest.editingFocus.length) === 0, '工具栏主动聚焦了编辑框');
    };
    const screen = await pane.locator('.xterm-screen').boundingBox();
    const tapTerminal = async () => {
      await touch('touchStart', [{ x: screen.x + 30, y: screen.y + 30 }]); await touch('touchEnd', []);
    };
    await focusDraft(); await tapTerminal();
    check(await pane.locator('.xterm-helper-textarea').evaluate(el => el === document.activeElement && !el.readOnly), '普通模式触摸终端未聚焦输入');
    await focusDraft(); await pane.locator('.xterm-screen').click({ position: { x: 30, y: 30 } });
    check(await pane.locator('.xterm-helper-textarea').evaluate(el => el === document.activeElement && !el.readOnly), '普通模式鼠标点击终端未聚焦输入');
    await draft.fill('保留的草稿');
    await clickTool(pane.getByRole('button', { name: '复制模式', exact: true }));
    check(await draft.innerText() === '保留的草稿', '复制模式清空草稿');
    let before = (await sent()).length;
    await clickTool(pane.getByRole('button', { name: 'Esc', exact: true }));
    check((await sent()).slice(before).includes('\x1b'), 'Esc 按钮失效');
    before = (await sent()).length;
    await clickTool(pane.getByRole('button', { name: '中断当前程序', exact: true }));
    check((await sent()).slice(before).includes('\x03'), 'Ctrl C 按钮失效');
    await focusDraft(); await draft.fill("printf 'focus-send-test\\n'");
    await pane.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(id => document.querySelector(`.session-pane[data-session-id="${id}"] .draft-input`)?.textContent === '', session.id);
    check(await notEditing() && await page.evaluate(() => window.__focusTest.editingFocus.length) === 0, '发送后重新聚焦输入框');
    before = (await sent()).length;
    await clickTool(pane.getByRole('button', { name: '上方向键', exact: true }));
    check((await sent()).slice(before).some(data => data === '\x1b[A' || data === '\x1bOA'), '方向按钮失效');
    await clickTool(pane.getByRole('button', { name: '中断当前程序', exact: true }));
    await clickTool(page.getByRole('button', { name: '设置', exact: true }));
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByLabel('终端字体', { exact: true }).click();
    check(await settings.getByLabel('终端字体', { exact: true }).evaluate(el => el === document.activeElement), '设置里的显式输入也被禁用');
    await settings.getByRole('button', { name: '取消', exact: true }).click(); check(await notEditing(), '取消设置恢复了编辑焦点');
    await clickTool(page.getByRole('button', { name: '创建会话', exact: true }));
    await page.getByRole('button', { name: '关闭路径选择器' }).click(); check(await notEditing(), '关闭目录选择器聚焦输入框');
    // 兼容复制必须完成，但结束后不能恢复原来输入框的焦点。
    await page.evaluate(async () => {
      const { writeClipboardText } = await import('/src/client/terminalClipboard.ts');
      window.__focusCopy = { done: false, error: '', descriptor: Object.getOwnPropertyDescriptor(navigator, 'clipboard') };
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      const button = document.createElement('button'); button.textContent = '兼容复制测试'; button.id = 'focus-copy-test'; button.style.cssText = 'position:fixed;top:50px;right:5px;z-index:1000';
      button.onclick = () => void writeClipboardText('focus-copy-test').then(() => window.__focusCopy.done = true).catch(error => window.__focusCopy.error = String(error));
      document.body.append(button);
    });
    await focusDraft(); await page.getByRole('button', { name: '兼容复制测试', exact: true }).click();
    await page.waitForFunction(() => window.__focusCopy.done || window.__focusCopy.error);
    check(await page.evaluate(() => window.__focusCopy.done), '兼容复制失败');
    check(await notEditing() && await page.evaluate(() => window.__focusTest.editingFocus.length) === 0, '兼容复制恢复了编辑焦点');
    await page.evaluate(() => { const previous = window.__focusCopy.descriptor; if (previous) Object.defineProperty(navigator, 'clipboard', previous); else delete navigator.clipboard; document.getElementById('focus-copy-test').remove(); });
    await focusDraft();
    await tapTerminal();
    check(await notEditing() && await page.evaluate(() => window.__focusTest.editingFocus.length) === 0, '触摸终端聚焦了编辑框');
    check(await pane.locator('.xterm').evaluate(el => el === document.activeElement), '终端没有获得非编辑的键盘焦点');
    before = (await sent()).length;
    await page.keyboard.type('Abc'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Control+C');
    const hardware = (await sent()).slice(before);
    check(hardware.slice(0, 3).join('') === 'Abc', `硬件键盘文字失效：${JSON.stringify(hardware)}`);
    check(hardware.some(data => data === '\x1b[B' || data === '\x1bOB') && hardware.includes('\x03'), '硬件快捷键失效');
    await page.keyboard.press('Control+V');
    await page.waitForFunction(id => window.__focusTest.sockets.filter(s => s.id === id).flatMap(s => s.sent).some(m => m.type === 'input' && m.data.includes('focus-copy-test')), session.id);
    check(await notEditing(), '硬件快捷键重新聚焦编辑框');
    await pane.getByRole('button', { name: '复制模式', exact: true }).click();
    check(await notEditing(), '退出复制模式主动聚焦');
    await tapTerminal();
    check(await pane.locator('.xterm-helper-textarea').evaluate(el => el === document.activeElement && !el.readOnly), '退出复制模式未恢复终端输入焦点');
    return { normalTerminalFocus: true, exitCopyRestoresFocus: true, inputClickFocus: true, toolbarDoesNotFocus: true, shortcutsWork: true, sendDoesNotRefocus: true, dialogsDoNotRefocus: true, clipboardFallbackDoesNotRefocus: true, terminalTouchDoesNotEdit: true, hardwareKeyboardAndPaste: true };
  } finally {
    await page.evaluate(async id => { await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('web-terminal.token')}` } }); }, session.id);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
  }
}
