// 已登录的本任务 ?check=composer 页面：playwright-cli run-code --filename=scripts/smoke-composer.js
// CLI cwd 下准备一张 retained-upload.png，仅创建并清理本脚本的测试会话。
async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  check(page.url().includes('check=composer'), '不是本任务的测试页面');
  await page.bringToFront();
  const token = await page.evaluate(() => localStorage.getItem('web-terminal.token'));
  check(token, '请先登录测试服务');
  await page.addInitScript(() => {
    if (window.__composer) return;
    const Native = window.WebSocket;
    window.__composer = { sockets: [] };
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.entry = { socket: this, id: null, sent: [], messages: [] };
        window.__composer.sockets.push(this.entry);
        this.addEventListener('message', event => this.entry.messages.push(JSON.parse(event.data)));
      }
      send(data) {
        const message = JSON.parse(data);
        if (message.type === 'auth') this.entry.id = message.sessionId;
        this.entry.sent.push(message);
        super.send(data);
      }
    };
  });
  await page.setViewportSize({ width: 1024, height: 840 });
  await page.reload();
  await page.waitForSelector('.app');
  const session = await page.evaluate(async token => {
    const response = await fetch('/api/sessions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'composer-smoke' }) });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, token);
  const pane = page.locator(`.session-pane[data-session-id="${session.id}"]`);
  const editor = pane.getByRole('textbox', { name: '待发送文字' });
  const result = {};
  const measure = () => pane.evaluate(p => {
    const editor = p.querySelector('.draft-input');
    const box = editor.getBoundingClientRect();
    const terminal = p.querySelector('.terminal-wrap').getBoundingClientRect();
    const panel = p.querySelector('.composer-panel').getBoundingClientRect();
    const css = getComputedStyle(editor);
    const socket = window.__composer.sockets.filter(s => s.id === p.dataset.sessionId).at(-1);
    const snapshot = socket.messages.filter(m => m.type === 'snapshot').at(-1);
    return { inputHeight: box.height, inputTop: box.top, scrollHeight: editor.scrollHeight, terminalHeight: terminal.height, terminalBottom: terminal.bottom, panelTop: panel.top, lineHeight: parseFloat(css.lineHeight), padding: parseFloat(css.paddingTop) + parseFloat(css.paddingBottom), rows: snapshot.rows, cols: snapshot.cols, resizes: socket.sent.filter(m => m.type === 'resize').length };
  });
  try {
    await page.locator(`.session[data-session-id="${session.id}"] .session-select`).click();
    await page.waitForFunction(id => window.__composer.sockets.some(s => s.id === id && s.messages.some(m => m.type === 'ready')), session.id);
    await page.waitForTimeout(250);
    const initial = await measure();
    check(initial.inputHeight <= initial.lineHeight + initial.padding + 1, '默认输入区不是一行');
    await editor.fill('第一行\n第二行\n第三行\n第四行');
    const expanded = await measure();
    check(expanded.inputHeight > initial.inputHeight && expanded.inputTop < initial.inputTop, '输入区没有向上展开');
    check(expanded.terminalHeight === initial.terminalHeight && expanded.panelTop < expanded.terminalBottom, '展开挤占了终端高度');
    await editor.fill(Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 行草稿`).join('\n'));
    const capped = await measure();
    check(Math.abs(capped.inputHeight - (capped.lineHeight * 10 + capped.padding)) <= 1, '没有在约 10 行封顶');
    check(capped.scrollHeight > capped.inputHeight, '超过 10 行没有内部滚动');
    check(capped.terminalHeight === initial.terminalHeight && capped.rows === initial.rows && capped.cols === initial.cols && capped.resizes === initial.resizes, '输入内容改变了终端行列数');
    result.geometry = { terminalHeight: initial.terminalHeight, rows: initial.rows, cols: initial.cols, oneLine: initial.inputHeight, maximum: capped.inputHeight };
    result.expandsUpward = result.tenLineLimit = result.scrollsAfterLimit = result.terminalSizeUnchanged = true;
    await page.screenshot({ path: 'composer-expanded.png' });

    const beforePaste = await page.evaluate(id => window.__composer.sockets.find(s => s.id === id).sent.filter(m => m.type === 'paste').length, session.id);
    await editor.fill('第一行');
    await editor.press('End');
    await editor.press('Shift+Enter');
    await editor.pressSequentially('第二行');
    check((await editor.innerText()).includes('第一行\n第二行'), 'Shift+Enter 未换行');
    check(await page.evaluate(({ id, count }) => window.__composer.sockets.find(s => s.id === id).sent.filter(m => m.type === 'paste').length === count, { id: session.id, count: beforePaste }), 'Shift+Enter 意外发送');
    result.shiftEnterInsertsNewline = true;
    const command = "printf 'COMPOSER_''LINE_1\\n'\nprintf 'COMPOSER_''LINE_2\\n'";
    await editor.fill(command);
    await editor.press('Enter');
    await page.waitForFunction(id => document.querySelector(`.session-pane[data-session-id="${id}"] .draft-input`).textContent === '', session.id);
    const collapsed = await measure();
    check(collapsed.inputHeight === initial.inputHeight && collapsed.terminalHeight === initial.terminalHeight, '发送后未缩回一行或终端高度改变');
    check(await page.evaluate(({ id, command }) => {
      const message = window.__composer.sockets.find(s => s.id === id).sent.filter(m => m.type === 'paste').at(-1);
      return message.text === command && message.submit === true;
    }, { id: session.id, command }), '多行发送内容发生变化');
    result.sendPreservesNewlines = result.collapsesAfterSend = true;

    await pane.getByRole('button', { name: '中断当前程序', exact: true }).click();
    await pane.getByRole('button', { name: 'Esc', exact: true }).click();
    check(await page.evaluate(id => {
      const keys = window.__composer.sockets.find(s => s.id === id).sent.filter(m => m.type === 'input').map(m => m.data);
      return keys.includes('\x03') && keys.includes('\x1b');
    }, session.id), '工具栏快捷键没有发送正确按键');
    result.shortcutsWork = true;
    await pane.locator('input[type="file"]').setInputFiles('retained-upload.png');
    await pane.locator('.upload-state').filter({ hasText: '已插入路径' }).waitFor();
    check((await measure()).terminalHeight === initial.terminalHeight, '上传状态挤占终端高度');
    result.attachmentWorksWithoutResizing = true;

    await editor.fill('断线时保留\n这一份草稿\n以及输入高度');
    const beforeDisconnect = await measure();
    await page.evaluate(id => window.__composer.sockets.find(s => s.id === id).socket.close(), session.id);
    await pane.locator('.composer-send').filter({ hasText: '未连接' }).waitFor();
    check(await pane.locator('.composer-send').isDisabled(), '断线时发送按钮未禁用');
    await editor.press('Enter');
    check((await editor.innerText()).includes('断线时保留'), '断线发送丢失文字');
    check((await measure()).inputHeight === beforeDisconnect.inputHeight, '断线发送错误收起输入区');
    result.disconnectedDraftRetained = true;
    await page.waitForFunction(id => window.__composer.sockets.filter(s => s.id === id).length >= 2 && window.__composer.sockets.filter(s => s.id === id).at(-1).socket.readyState === WebSocket.OPEN && window.__composer.sockets.filter(s => s.id === id).at(-1).messages.some(m => m.type === 'ready'), session.id);
    await editor.fill('');
    await pane.getByRole('button', { name: '移除 retained-upload.png', exact: true }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'composer-collapsed.png' });
    await page.setViewportSize({ width: 390, height: 740 });
    await editor.fill(Array.from({ length: 12 }, (_, i) => `窄窗口的第 ${i + 1} 行`).join('\n'));
    check(await pane.locator('.composer-hint').isHidden(), '窄窗口没有隐藏辅助说明');
    check(await pane.locator('.composer-send').isVisible(), '窄窗口发送按钮不可用');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '窄窗口横向溢出');
    await page.screenshot({ path: 'composer-narrow.png' });
    result.narrowLayout = true;
    return result;
  } finally {
    await page.evaluate(async ({ token, id }) => fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }), { token, id: session.id });
  }
}
