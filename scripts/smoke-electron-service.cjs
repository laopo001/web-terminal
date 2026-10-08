// 用独立端口和数据目录验证真实 Electron 的自动启动与菜单重启。
const { app, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);
const root = path.resolve(__dirname, '..');
const home = path.join(root, '.data', 'electron-service-test');
process.env.WEB_TERMINAL_CLIENT_DATA_DIR = path.join(home, 'profile');
process.env.WEB_TERMINAL_HOME = home;
let base;
let before;
let checking = false;
let finished = false;
const timeout = setTimeout(() => finish(new Error('Electron 服务测试超时')), 40000);

async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (base) await execute('web-terminal', ['stop', '--url', base]).catch(console.error);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', async () => {
    if (checking) return;
    checking = true;
    try {
      const web = window.webContents;
      const identity = await (await fetch(base + '/health')).json();
      assert.equal(identity.service, '@dadigua/web-terminal');
      assert.equal(web.getURL(), base + '/');
      assert.equal(await web.executeJavaScript('document.title'), 'Web Terminal');
      const prefs = web.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration, false);
      assert.equal(prefs.sandbox, true);
      if (!before) {
        before = identity;
        checking = false;
        const restart = Menu.getApplicationMenu().getMenuItemById('restart-server');
        assert(restart, '菜单缺少重启入口');
        restart.click(restart, window);
        return;
      }
      assert.notEqual(identity.instanceId, before.instanceId, '菜单重启没有替换进程');
      await web.executeJavaScript(`new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          if (document.querySelector('#token') || document.querySelector('.app')) { clearInterval(timer); resolve(); }
          else if (Date.now() - started > 10000) { clearInterval(timer); reject(new Error('登录页面未就绪')); }
        }, 100);
      })`);
      fs.writeFileSync(path.join(root, '.data/electron-service-smoke.json'), JSON.stringify({
        autoStarted: true, restartMenu: true, before: before.instanceId, after: identity.instanceId,
        page: web.getURL(), sandbox: prefs.sandbox,
      }, null, 2));
      fs.writeFileSync(path.join(root, '.data/electron-service-smoke.png'), (await web.capturePage()).toPNG());
      console.log('Electron 服务测试通过：自动启动、服务身份、真实页面、菜单重启、隔离渲染器');
      await finish();
    } catch (error) { await finish(error); }
  });
});

const port = net.createServer();
port.listen(0, '127.0.0.1', () => {
  base = `http://127.0.0.1:${port.address().port}`;
  process.env.WEB_TERMINAL_URL = base;
  port.close(() => require(path.join(root, 'dist-clients/electron/main.cjs')));
});
