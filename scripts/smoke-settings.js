// playwright-cli run-code --filename=scripts/smoke-settings.js
// 在本任务新建并登录测试服务的 ?check=settings 页面运行。
async page => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  check(/[?&]check=settings(?:&|$)/.test(page.url()), '不是本任务的设置测试页面');
  const saved = await page.evaluate(() => ({ settings: localStorage.getItem('web-terminal.settings'), font: localStorage.getItem('web-terminal.fontFamily') }));
  let session;
  const cdp = await page.context().newCDPSession(page);
  await page.addInitScript(() => {
    if (window.__settingsSockets) return;
    window.__settingsSockets = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) { super(...args); this.settingsEntry = { socket: this, id: null, sent: [] }; window.__settingsSockets.push(this.settingsEntry); }
      send(data) { try { const m = JSON.parse(data); if (m.type === 'auth') this.settingsEntry.id = m.sessionId; this.settingsEntry.sent.push(m); } catch {} super.send(data); }
    };
  });
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.evaluate(() => { localStorage.removeItem('web-terminal.settings'); localStorage.setItem('web-terminal.fontFamily', 'Consolas'); });
  await page.reload(); await page.locator('.app').waitFor();
  const open = async () => { await page.getByRole('button', { name: '设置', exact: true }).click(); return page.getByRole('dialog', { name: '设置', exact: true }); };
  const saveMode = async mode => { const dialog = await open(); await dialog.getByLabel('交互模式').selectOption(mode); await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); };
  const leftReports = () => page.evaluate(id => window.__settingsSockets.filter(s => s.id === id).flatMap(s => s.sent).filter(m => m.type === 'input' && /^\x1b\[<0;/.test(m.data)).length, session.id);
  try {
    check(await page.getByRole('button', { name: '设置', exact: true }).locator('svg').count() === 1, '设置入口不是图标');
    let dialog = await open();
    check(await page.evaluate(() => document.activeElement?.textContent === '取消'), '打开设置时意外聚焦字体输入框');
    check(await dialog.getByLabel('终端字体', { exact: true }).inputValue() === 'Consolas', '旧字体未保留');
    check(await dialog.getByRole('combobox').count() === 1, '交互设置没有统一为一项');
    check(await dialog.getByLabel('交互模式').inputValue() === 'native', '默认不是 CLI 原生');
    await dialog.getByLabel('交互模式').selectOption('local'); await dialog.getByRole('button', { name: '取消', exact: true }).click();
    dialog = await open(); check(await dialog.getByLabel('交互模式').inputValue() === 'native', '取消仍保存了设置');
    await dialog.getByLabel('终端字体', { exact: true }).fill('Cascadia Code');
    await dialog.getByLabel('交互模式').selectOption('local'); await dialog.getByRole('button', { name: '保存', exact: true }).click();
    check(await page.evaluate(() => localStorage.getItem('web-terminal.fontFamily')) === null, '旧字体存储未迁移');
    await page.reload(); await page.locator('.app').waitFor(); dialog = await open();
    check(await dialog.getByLabel('交互模式').inputValue() === 'local' && await dialog.getByLabel('终端字体', { exact: true }).inputValue() === 'Cascadia Code', '设置未持久保存');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    session = await page.evaluate(async () => {
      const headers = { Authorization: `Bearer ${localStorage.getItem('web-terminal.token')}`, 'Content-Type': 'application/json' };
      const info = await (await fetch('/api/info', { headers })).json();
      const r = await fetch('/api/sessions', { method: 'POST', headers, body: JSON.stringify({ name: 'settings-test', cwd: info.defaultCwd }) });
      if (!r.ok) throw Error(await r.text()); return r.json();
    });
    await page.locator(`.session[data-session-id="${session.id}"] .session-select`).click();
    await page.locator(`.session[data-session-id="${session.id}"] .dot.live`).waitFor();
    const pane = page.locator(`.session-pane[data-session-id="${session.id}"]`), draft = pane.getByRole('textbox', { name: '待发送文字' });
    await draft.fill("printf '\\033[?1049h\\033[2J\\033[Halpha beta gamma\\r\\n中文测试\\r\\n\\033[?1003h\\033[?1006h'"); await draft.press('Enter');
    await page.waitForFunction(id => document.querySelector(`.session-pane[data-session-id="${id}"] .xterm-rows`)?.textContent.includes('中文测试'), session.id);
    await draft.fill('设置切换保留草稿'); await page.waitForTimeout(200);
    const terminal = await pane.locator('.xterm').elementHandle();
    const box = await pane.locator('.xterm-screen').boundingBox();
    const cell = await pane.locator('.xterm-width-cache-measure-container').evaluate(el => { const c = document.createElement('canvas').getContext('2d'), s = getComputedStyle(el); c.font = `${s.fontSize} ${s.fontFamily}`; return c.measureText('W').width; });
    const rowHeight = box.height / await pane.locator('.xterm-rows>div').count();
    const at = (col, row = 0) => ({ x: box.x + cell * (col + .2), y: box.y + rowHeight * (row + .5) });
    const copyToggle = pane.getByRole('button', { name: '复制模式', exact: true });
    const enterCopy = async () => { await copyToggle.click(); await page.waitForFunction(id => document.querySelector(`.session-pane[data-session-id="${id}"] .copy-mode-toggle`)?.getAttribute('aria-pressed') === 'true', session.id); };
    check(await copyToggle.isEnabled() && await copyToggle.getAttribute('aria-pressed') === 'false', '复制模式开关默认不可用或默认开启');
    await enterCopy();
    let count = await leftReports();
    await page.mouse.move(at(0).x, at(0).y); await page.mouse.down(); await page.mouse.move(at(10).x, at(10).y, { steps: 8 }); await page.mouse.up();
    await pane.getByRole('toolbar', { name: '触屏选区操作' }).waitFor();
    check(await leftReports() === count, '本地鼠标仍向 CLI 发送点击');
    await saveMode('native');
    check(await terminal.evaluate(el => el === document.querySelector('.session-pane:not([hidden]) .xterm')), '设置切换重建了终端');
    await page.mouse.click(at(8).x, at(8).y); check(await leftReports() === count + 2, `原生鼠标未恢复成对点击：before=${count}, after=${await leftReports()}`);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id, radiusX: 1, radiusY: 1 })) });
    check(await copyToggle.getAttribute('aria-pressed') === 'false', '切换设置后复制模式没有退出');
    const wheelCount = () => page.evaluate(id => window.__settingsSockets.filter(s => s.id === id).flatMap(s => s.sent).filter(m => m.type === 'input' && /^\x1b\[<6[45];/.test(m.data)).length, session.id);
    const scrollStart = at(20, 8), scrollEnd = at(20, 4);
    let wheelBefore = await wheelCount(); count = await leftReports();
    await touch('touchStart', [scrollStart]); await touch('touchMove', [scrollEnd]); await touch('touchEnd', []);
    check(await wheelCount() > wheelBefore && await leftReports() === count, 'CLI 原生模式平时滑动未滚屏或误发送了点击');
    await enterCopy(); wheelBefore = await wheelCount();
    count = await leftReports(); await touch('touchStart', [at(1)]); await touch('touchMove', [at(12)]); await touch('touchEnd', []);
    check(await wheelCount() === wheelBefore, '原生复制模式仍然发送滚屏');
    check(await leftReports() === count + 2, '原生模式没有同时应用到触屏');
    check(await pane.getByRole('toolbar', { name: '触屏选区操作' }).count() === 0, '原生模式仍显示本地手柄');
    await copyToggle.click();
    await page.waitForFunction(id => document.querySelector(`.session-pane[data-session-id="${id}"] .copy-mode-toggle`)?.getAttribute('aria-pressed') === 'false', session.id);
    wheelBefore = await wheelCount(); await touch('touchStart', [scrollStart]); await touch('touchMove', [scrollEnd]); await touch('touchEnd', []);
    check(await wheelCount() > wheelBefore, '再次点击复制开关后没有恢复滚屏');

    await saveMode('local'); await enterCopy(); count = await leftReports();
    await touch('touchStart', [at(7)]); await touch('touchEnd', []);
    await pane.getByRole('toolbar', { name: '触屏选区操作' }).waitFor();
    check(await leftReports() === count, '本地模式触屏仍发送点击');
    const localActions = pane.getByRole('toolbar', { name: '触屏选区操作' });
    const copyButton = await localActions.getByRole('button', { name: '复制', exact: true }).boundingBox();
    await touch('touchStart', [{ x: copyButton.x + copyButton.width / 2, y: copyButton.y + copyButton.height / 2 }]); await touch('touchEnd', []);
    await page.getByRole('status').filter({ hasText: '已复制 4 个字符' }).waitFor();
    check(await copyToggle.getAttribute('aria-pressed') === 'true', '复制后未保留复制模式');
    await page.screenshot({ path: '/tmp/web-terminal-copy-mode.png' });
    const cancelCopy = await localActions.getByRole('button', { name: '取消', exact: true }).boundingBox();
    await touch('touchStart', [{ x: cancelCopy.x + cancelCopy.width / 2, y: cancelCopy.y + cancelCopy.height / 2 }]); await touch('touchEnd', []);
    await page.waitForFunction(id => document.querySelector(`.session-pane[data-session-id="${id}"] .copy-mode-toggle`)?.getAttribute('aria-pressed') === 'false', session.id);
    wheelBefore = await wheelCount(); await touch('touchStart', [scrollStart]); await touch('touchMove', [scrollEnd]); await touch('touchEnd', []);
    check(await wheelCount() > wheelBefore, '退出复制模式后没有恢复滚屏');

    check(await draft.innerText() === '设置切换保留草稿', '设置切换清空草稿');
    check(await page.evaluate(id => window.__settingsSockets.filter(s => s.id === id).length === 1, session.id), '设置切换重连了 WebSocket');
    dialog = await open(); await page.screenshot({ path: '/tmp/web-terminal-settings.png' });
    await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
    check(await dialog.getByLabel('交互模式').inputValue() === 'native' && await dialog.getByLabel('终端字体', { exact: true }).inputValue() === '', '恢复默认失败');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 }); dialog = await open();
    const bounds = await dialog.boundingBox(); check(bounds.width <= 390 && bounds.height <= 844 && bounds.y >= 0, '手机设置面板越界');
    await page.screenshot({ path: '/tmp/web-terminal-settings-mobile.png' });
    return { gearIcon: true, fontMigration: true, unifiedMode: true, cancel: true, persistence: true, liveMouseAndTouchSwitch: true, copyModeToggle: true, scrollOutsideCopyMode: true, copyWithoutScroll: true, exitRestoresScroll: true, terminalAndSocketRetained: true, draftPreserved: true, restoreDefault: true, mobileLayout: true };
  } finally {
    if (session) await page.evaluate(async id => { await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('web-terminal.token')}` } }); }, session.id);
    await page.evaluate(saved => { for (const [key, value] of [['web-terminal.settings', saved.settings], ['web-terminal.fontFamily', saved.font]]) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } }, saved);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
  }
}
