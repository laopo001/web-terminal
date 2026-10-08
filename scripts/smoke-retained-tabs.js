// playwright-cli run-code --filename=scripts/smoke-retained-tabs.js
// 在本任务创建并已登录的 ?check=retained-tabs 页面运行；CLI cwd 下需有 retained-upload.png。
// 可传 fixtureRoot 查询参数，并在该目录预建 retention-A/B/C 子目录。
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  check(page.url().includes('check=retained-tabs'), '不是本任务的测试页面');
  const token = await page.evaluate(() => localStorage.getItem('web-terminal.token'));
  check(token, '请先登录测试服务');
  await page.addInitScript(() => {
    if (window.__retention) return;
    const Native = window.WebSocket;
    window.__retention = { Native, sockets: [], nodes: {} };
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.entry = { socket: this, sessionId: null, sent: [], messages: [], closes: 0 };
        window.__retention.sockets.push(this.entry);
        this.addEventListener('message', event => {
          try { this.entry.messages.push(JSON.parse(event.data)); } catch {}
        });
      }
      send(data) {
        const message = JSON.parse(data);
        if (message.type === 'auth') this.entry.sessionId = message.sessionId;
        this.entry.sent.push(message);
        super.send(data);
      }
      close(...args) { this.entry.closes++; super.close(...args); }
    };
  });
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.reload();
  await page.waitForSelector('.app');
  const created = await page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('web-terminal.token')}`, 'Content-Type': 'application/json' };
    const info = await (await fetch('/api/info', { headers })).json();
    const fixtureRoot = new URLSearchParams(location.search).get('fixtureRoot');
    const list = [];
    for (const name of ['retention-A', 'retention-B', 'retention-C']) {
      const response = await fetch('/api/sessions', { method: 'POST', headers, body: JSON.stringify({ name, cwd: fixtureRoot ? `${fixtureRoot}/${name}` : info.defaultCwd }) });
      if (!response.ok) throw new Error(await response.text());
      list.push(await response.json());
    }
    return list;
  });
  const [a, b] = created;
  const pane = id => page.locator(`.session-pane[data-session-id="${id}"]`);
  const editor = id => pane(id).getByRole('textbox', { name: '待发送文字' });
  const select = async session => {
    await page.locator(`.session[data-session-id="${session.id}"] .session-select`).click();
    await page.waitForFunction(id => {
      const p = document.querySelector(`.session-pane[data-session-id="${id}"]`);
      return p && !p.hidden && window.__retention.sockets.some(s => s.sessionId === id && s.messages.some(m => m.type === 'ready'));
    }, session.id);
  };
  const result = {};
  let releaseUpload;
  let routedUpload;
  try {
    await page.locator(`.session[data-session-id="${a.id}"]`).waitFor();
    check(await page.locator('.session-pane').count() === 0, '未访问会话被提前加载');
    await select(a);
    await editor(a.id).fill("for i in $(seq 1 160); do printf 'scroll-%03d\\n' $i; done");
    await editor(a.id).press('Enter');
    await page.waitForFunction(id => window.__retention.sockets.find(s => s.sessionId === id)?.messages.some(m => m.type === 'output' && m.data.includes('scroll-160')), a.id);
    await editor(a.id).fill('A 的独立草稿');
    await pane(a.id).locator('.terminal-host').hover();
    const bottom = await pane(a.id).locator('.xterm-rows').textContent();
    await page.mouse.wheel(0, -500);
    await page.waitForFunction(({ id, bottom }) => document.querySelector(`.session-pane[data-session-id="${id}"] .xterm-rows`).textContent !== bottom, { id: a.id, bottom });
    const scrollText = await pane(a.id).locator('.xterm-rows > div').evaluateAll(rows => rows.slice(0, 5).map(row => row.textContent).join('\n'));
    await page.evaluate(id => {
      const p = document.querySelector(`.session-pane[data-session-id="${id}"]`);
      window.__retention.nodes[id] = { terminal: p.querySelector('.xterm'), editor: p.querySelector('[role="textbox"]') };
    }, a.id);
    await select(b);
    check(await page.locator('.session-pane').count() === 2, '第三个未访问会话被提前加载');
    check(await editor(b.id).textContent() === '', 'B 继承了 A 的草稿');
    await editor(b.id).fill('B 的独立草稿');
    // 用独立测试连接触发输出，验证隐藏的 UI 连接仍在接收它。
    await page.evaluate(({ id, token }) => new Promise((resolve, reject) => {
      const Native = window.__retention.Native;
      const socket = new Native(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      const auth = window.__retention.sockets.find(s => s.sessionId === id).sent.find(m => m.type === 'auth');
      let output = '';
      const timer = setTimeout(() => { socket.close(); reject(new Error('后台输出超时')); }, 5000);
      socket.onopen = () => socket.send(JSON.stringify({ ...auth, token }));
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') socket.send(JSON.stringify({ type: 'paste', text: "printf 'BACKGROUND_''A_READY\\n'", submit: true }));
        if (message.type === 'output') output += message.data;
        if (output.includes('BACKGROUND_A_READY')) { clearTimeout(timer); socket.close(); resolve(); }
      };
      socket.onerror = () => { clearTimeout(timer); socket.close(); reject(new Error('后台测试连接失败')); };
    }), { id: a.id, token });
    await page.waitForFunction(id => window.__retention.sockets.find(s => s.sessionId === id).messages.some(m => m.type === 'output' && m.data.includes('BACKGROUND_A_READY')), a.id);
    result.backgroundOutput = true;
    const hiddenSent = await page.evaluate(id => window.__retention.sockets.find(s => s.sessionId === id).sent.length, a.id);
    await page.setViewportSize({ width: 1024, height: 720 });
    await page.waitForTimeout(250);
    check(await page.evaluate(({ id, count }) => window.__retention.sockets.find(s => s.sessionId === id).sent.length === count, { id: a.id, count: hiddenSent }), '隐藏终端发送了尺寸或焦点输入');
    await select(a);
    check(await editor(a.id).textContent() === 'A 的独立草稿', 'A 草稿丢失');
    await page.waitForTimeout(200);
    const restoredText = await pane(a.id).locator('.xterm-rows > div').evaluateAll(rows => rows.slice(0, 5).map(row => row.textContent).join('\n'));
    check(restoredText === scrollText, `切换后滚动位置改变：${JSON.stringify({before:scrollText,after:restoredText})}`);
    check(await page.evaluate(id => {
      const p = document.querySelector(`.session-pane[data-session-id="${id}"]`), nodes = window.__retention.nodes[id];
      return nodes.terminal === p.querySelector('.xterm') && nodes.editor === p.querySelector('[role="textbox"]');
    }, a.id), '切换重建了终端或输入框 DOM');
    check(await page.evaluate(() => window.__retention.sockets.length === 2 && window.__retention.sockets.every(s => s.closes === 0)), '切换时重建了 WebSocket');
    result.lazyMount = result.domRetained = result.draftsIndependent = result.scrollRetained = result.noReconnectOnSwitch = result.hiddenDoesNotResize = true;

    // 上传途中切换：完成的图片路径只能进入原会话草稿。
    const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
    const uploadPath = `**/api/sessions/${a.id}/uploads`;
    routedUpload = uploadPath;
    await page.route(uploadPath, async route => { await uploadGate; await route.continue(); });
    await pane(a.id).locator('input[type="file"]').setInputFiles('retained-upload.png');
    await select(b);
    releaseUpload();
    await page.waitForFunction(id => document.querySelector(`.session-pane[data-session-id="${id}"] [role="textbox"]`).textContent.includes('.png'), a.id);
    check(await editor(b.id).textContent() === 'B 的独立草稿', '后台上传污染了 B 的草稿');
    await page.unroute(uploadPath);
    result.backgroundUploadIsolated = true;

    // 后台断线继续重连，但不应发送 resize/claim/input。
    await page.evaluate(id => window.__retention.sockets.find(s => s.sessionId === id).socket.close(), a.id);
    await page.waitForFunction(id => window.__retention.sockets.filter(s => s.sessionId === id).length === 2 && window.__retention.sockets.filter(s => s.sessionId === id).at(-1).messages.some(m => m.type === 'ready'), a.id);
    check(await page.evaluate(id => window.__retention.sockets.filter(s => s.sessionId === id).at(-1).sent.every(m => m.type === 'auth'), a.id), '隐藏终端重连后发送了交互消息');
    result.hiddenReconnect = true;

    await select(a);
    await page.screenshot({ path: 'retained-tabs.png' });
    await select(b);
    const bTab = page.locator(`.session[data-session-id="${b.id}"]`);
    await bTab.locator('.end').click();
    await page.getByRole('dialog').getByRole('button', { name: '结束会话', exact: true }).click();
    await pane(b.id).waitFor({ state: 'detached' });
    check(await page.evaluate(id => window.__retention.sockets.find(s => s.sessionId === id).closes > 0, b.id), '关闭会话未释放连接');
    result.closeReleasesResources = true;
    // 验证鉴权失效路径释放全部保留会话。
    await page.evaluate(id => window.__retention.sockets.filter(s => s.sessionId === id).at(-1).socket.dispatchEvent(new CloseEvent('close', { code: 4401 })), a.id);
    await page.waitForSelector('#token');
    check(await page.locator('.session-pane').count() === 0, '退出登录后仍保留会话');
    check(await page.evaluate(() => window.__retention.sockets.every(s => s.closes > 0)), '退出登录未释放连接');
    result.logoutReleasesResources = true;
    return result;
  } finally {
    releaseUpload?.();
    if (routedUpload) await page.unroute(routedUpload);
    await page.evaluate(async ({ token, ids }) => {
      const headers = { Authorization: `Bearer ${token}` };
      const remaining = await (await fetch('/api/sessions', { headers })).json();
      for (const id of ids) if (remaining.some(session => session.id === id)) await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers });
    }, { token, ids: created.map(s => s.id) });
  }
}
