// playwright-cli run-code --filename=scripts/smoke-input-focus.js
// 在本任务创建并登录测试服务的 ?check=input-focus 页面运行；需准备 /tmp/toolbar-check.png。
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
    const tapButton = async (button, editor = draft, preserve = false) => {
      await editor.click();
      await editor.evaluate(el => {
        document.documentElement.style.setProperty('--app-height', '540px');
        el.addEventListener('blur', () => document.documentElement.style.setProperty('--app-height', '844px'), { once: true });
      });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox(); check(box, '按钮不可见');
      await touch('touchStart', [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]);
      check(await editor.evaluate(el => el === document.activeElement), '按钮按下提前结束编辑');
      await touch('touchEnd', []);
      if (preserve) check(await editor.evaluate(el => el === document.activeElement), '快捷键结束了输入焦点');
      else check(await notEditing(), '按钮操作保留了编辑焦点');
      await page.evaluate(() => document.documentElement.style.setProperty('--app-height', '844px'));
    };
    const clickTool = async (button, preserve = false) => {
      await focusDraft(); await tapButton(button, draft, preserve);
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
    await clickTool(pane.getByRole('button', { name: 'Esc', exact: true }), true);
    check((await sent()).slice(before).includes('\x1b'), 'Esc 按钮失效');
    before = (await sent()).length;
    await clickTool(pane.getByRole('button', { name: '中断当前程序', exact: true }), true);
    check((await sent()).slice(before).includes('\x03'), 'Ctrl C 按钮失效');
    for (const [name, sequences] of [
      ['Tab', ['\t']], ['左方向键', ['\x1b[D', '\x1bOD']], ['上方向键', ['\x1b[A', '\x1bOA']],
      ['下方向键', ['\x1b[B', '\x1bOB']], ['右方向键', ['\x1b[C', '\x1bOC']],
    ]) {
      before = (await sent()).length;
      await clickTool(pane.getByRole('button', { name, exact: true }), true);
      const actual = (await sent()).slice(before);
      check(actual.length === 1 && sequences.includes(actual[0]), `${name} 未恰好发送一次：${JSON.stringify(actual)}`);
    }
    const fileInput = pane.locator('input[type=file]');
    // 原生文件框已单独核对；自动回归记录打开次数，再提供测试文件，避免 CLI 模态中断。
    await fileInput.evaluate(el => { el.__openCount = 0; el.click = () => el.__openCount++; });
    await clickTool(pane.getByRole('button', { name: '添加图片', exact: true }));
    check(await fileInput.evaluate(el => { const count = el.__openCount; delete el.click; return count; }) === 1, '附件入口未打开一次');
    const uploadPath = `**/api/sessions/${session.id}/uploads`;
    await page.route(uploadPath, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试上传失败' }) }));
    await fileInput.setInputFiles('/tmp/toolbar-check.png');
    await pane.getByRole('button', { name: '重试', exact: true }).waitFor();
    await page.unroute(uploadPath);
    await clickTool(pane.getByRole('button', { name: '重试', exact: true }));
    await pane.getByLabel('图片上传状态').getByText(/已插入路径/).waitFor();
    await clickTool(pane.getByRole('button', { name: '移除 toolbar-check.png', exact: true }));
    check(await pane.getByLabel('图片上传状态').count() === 0, '移除图片未执行');
    // 模拟键盘收起时视口变高：按下就 blur 会使按钮在抬手前移走，丢掉 click。
    await focusDraft(); await draft.fill("printf 'focus-send-test\\n'");
    await draft.evaluate(el => {
      document.documentElement.style.setProperty('--app-height', '540px');
      el.addEventListener('blur', () => document.documentElement.style.setProperty('--app-height', '844px'), { once: true });
    });
    const sendButton = pane.getByRole('button', { name: '发送', exact: true });
    const sendBox = await sendButton.boundingBox();
    const sendPoint = { x: sendBox.x + sendBox.width / 2, y: sendBox.y + sendBox.height / 2 };
    await touch('touchStart', [sendPoint]);
    check(await draft.evaluate(el => el === document.activeElement), '按下发送提前失焦，键盘收起会让按钮移位');
    await touch('touchEnd', []);
    await page.waitForFunction(id => document.querySelector(`.session-pane[data-session-id="${id}"] .draft-input`)?.textContent === '', session.id);
    check(await notEditing() && await page.evaluate(() => window.__focusTest.editingFocus.length) === 0, '发送后重新聚焦输入框');
    // 中文输入在失焦时提交最终文字；明确点击发送不受 Enter 的防误发时间窗限制。
    await focusDraft(); await draft.fill('输入法尚未提交');
    await draft.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '输入法尚未提交' }));
      el.addEventListener('blur', () => {
        el.textContent = '中文输入最终文字';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '中文输入最终文字', isComposing: false }));
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文输入最终文字' }));
      }, { once: true });
    });
    await sendButton.click();
    await page.waitForFunction(id => window.__focusTest.sockets.filter(s => s.id === id).flatMap(s => s.sent).some(m => m.type === 'paste' && m.text === '中文输入最终文字' && m.submit), session.id);
    check(await notEditing(), '中文发送后未退出输入焦点');
    const submissions = await page.evaluate(id => window.__focusTest.sockets.filter(s => s.id === id).flatMap(s => s.sent).filter(m => m.type === 'paste' && m.submit).map(m => m.text), session.id);
    check(submissions.length === 2 && submissions[0] === "printf 'focus-send-test\\n'" && submissions[1] === '中文输入最终文字', `发送重复或使用旧草稿：${JSON.stringify(submissions)}`);
    before = (await sent()).length;
    await clickTool(pane.getByRole('button', { name: '上方向键', exact: true }), true);
    check((await sent()).slice(before).some(data => data === '\x1b[A' || data === '\x1bOA'), '方向按钮失效');
    await clickTool(pane.getByRole('button', { name: '中断当前程序', exact: true }), true);
    await clickTool(page.getByRole('button', { name: '设置', exact: true }));
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByLabel('终端字体', { exact: true }).click();
    check(await settings.getByLabel('终端字体', { exact: true }).evaluate(el => el === document.activeElement), '设置里的显式输入也被禁用');
    const fontInput = settings.getByLabel('终端字体', { exact: true });
    const originalFont = await fontInput.inputValue();
    await fontInput.fill('temporary-toolbar-font');
    await tapButton(settings.getByRole('button', { name: '恢复默认', exact: true }), fontInput);
    check(await fontInput.inputValue() === '', '恢复默认未执行');
    await fontInput.fill(originalFont);
    await tapButton(settings.getByRole('button', { name: '保存', exact: true }), fontInput);
    check(await settings.count() === 0, '保存设置未执行');
    await clickTool(page.getByRole('button', { name: '设置', exact: true }));
    await tapButton(settings.getByRole('button', { name: '取消', exact: true }), settings.getByLabel('终端字体', { exact: true }));
    check(await settings.count() === 0, '取消设置未执行');
    await clickTool(page.getByRole('button', { name: '创建会话', exact: true }));
    const picker = page.locator('dialog.directory-picker'), path = picker.getByRole('textbox', { name: '工作目录', exact: true });
    const entries = picker.getByLabel('文件夹列表');
    await page.waitForFunction(() => document.querySelector('.directory-entries')?.getAttribute('aria-busy') === 'false');
    const homePath = await path.inputValue();
    for (const name of ['前往', '上级目录', '默认目录']) {
      const button = picker.getByRole('button', { name, exact: true });
      if (await button.isDisabled()) continue;
      const response = page.waitForResponse(r => r.url().includes('/api/directories?') && r.ok());
      await tapButton(button, path); await response;
      await page.waitForFunction(() => document.querySelector('.directory-entries')?.getAttribute('aria-busy') === 'false');
    }
    check(await path.inputValue() === homePath, '默认目录未恢复');
    if (await entries.getByRole('button').count()) {
      const folder = entries.getByRole('button').first(), destination = await folder.getAttribute('title');
      await tapButton(folder, picker.getByRole('textbox', { name: '筛选文件夹', exact: true }));
      await page.waitForFunction(value => document.querySelector('.directory-path input')?.value === value && document.querySelector('.directory-entries')?.getAttribute('aria-busy') === 'false', destination);
    }
    await tapButton(picker.getByRole('button', { name: '取消', exact: true }), path);
    check(await picker.count() === 0, '取消目录选择未执行');
    await clickTool(page.getByRole('button', { name: '创建会话', exact: true }));
    await tapButton(page.getByRole('button', { name: '关闭路径选择器' }), page.getByRole('textbox', { name: '工作目录', exact: true }));
    check(await picker.count() === 0, '关闭目录选择未执行');
    const currentTab = page.locator(`.session[data-session-id="${session.id}"]`);
    await clickTool(currentTab.locator('.session-select'));
    check(await currentTab.locator('.session-select').getAttribute('aria-pressed') === 'true', '会话标签未选中');
    await clickTool(currentTab.locator('.end'));
    const closeDialog = page.locator('.session-close-dialog[open]').filter({ hasText: '结束会话' });
    await closeDialog.getByRole('button', { name: '取消', exact: true }).click();
    check(await closeDialog.count() === 0 && await notEditing(), '取消结束会话未执行或恢复输入焦点');
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
    return { shortcutsPreserveInputFocus: true, allShortcutButtonsSendOnce: true, attachmentRetryAndRemove: true, settingsButtons: true, directoryButtons: true, sessionButtons: true, singleTouchSendWithKeyboardResize: true, compositionSendOnce: true, normalTerminalFocus: true, exitCopyRestoresFocus: true, inputClickFocus: true, toolbarDoesNotFocus: true, shortcutsWork: true, sendDoesNotRefocus: true, dialogsDoNotRefocus: true, clipboardFallbackDoesNotRefocus: true, terminalTouchDoesNotEdit: true, hardwareKeyboardAndPaste: true };
  } finally {
    await page.evaluate(async id => { await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('web-terminal.token')}` } }); }, session.id);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
  }
}
