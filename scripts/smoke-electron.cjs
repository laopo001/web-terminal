// 用 Electron 自身的 WebContents 验证加载，不启动服务器、不连接其他浏览器。
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = path.join(root, '.data', 'electron-smoke-profile');
process.env.WEB_TERMINAL_CLIENT_DATA_DIR = profile;
process.env.WEB_TERMINAL_URL = 'http://localhost:3840';
const token = fs.readFileSync(path.join(root, '.data', 'token'), 'utf8').trim();
const timeout = setTimeout(() => { console.error('Electron smoke timeout'); app.exit(1); }, 30_000);
let checking = false;
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', async () => {
    if (checking) return;
    checking = true;
    try {
      const web = window.webContents;
      assert.equal(web.getURL(), 'http://localhost:3840/');
      const prefs = web.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration, false);
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.sandbox, true);
      const saved = await web.executeJavaScript('localStorage.getItem("web-terminal.token")');
      if (saved !== token) {
        await web.executeJavaScript(`localStorage.setItem('web-terminal.token', ${JSON.stringify(token)})`);
        checking = false;
        web.reload(); return;
      }
      const result = await web.executeJavaScript(`new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (document.querySelector('.app') && (!document.querySelector('.session.active .dot.live') || document.querySelector('.connection')?.textContent.includes('已连接'))) { clearInterval(timer); resolve({connected: document.querySelector('.connection')?.textContent, title: document.title, authenticated: !document.querySelector('#token'), nodeExposed: typeof window.require !== 'undefined', embedded: location.href}); }
          else if (Date.now() - start > 10000) { clearInterval(timer); reject(new Error('Web页面未完成认证加载')); }
        }, 100);
      })`);
      assert.equal(result.title, 'Web Terminal');
      assert.equal(result.authenticated, true);
      assert.equal(result.nodeExposed, false);
      const screenshot = await web.capturePage();
      fs.writeFileSync(path.join(root, '.data', 'electron-client.png'), screenshot.toPNG());
      fs.writeFileSync(path.join(root, '.data', 'electron-smoke.json'), JSON.stringify({ ...result, sandbox: true, persistentStorage: true }, null, 2));
      console.log('Electron Webview smoke passed: real Web page, saved token, isolated renderer');
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require(path.join(root, 'dist-clients', 'electron', 'main.cjs'));
