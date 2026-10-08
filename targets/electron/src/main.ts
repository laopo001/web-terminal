import { app, BrowserWindow, dialog, Menu, shell, clipboard } from 'electron';
import { join, resolve } from 'node:path';
import { readClientSettings, sameServer } from './settings.ts';
import { ensureService, ServiceNotInstalledError } from '../../../src/service/client.ts';

app.setName('Web Terminal');
if (process.env.WEB_TERMINAL_CLIENT_DATA_DIR) app.setPath('userData', resolve(process.env.WEB_TERMINAL_CLIENT_DATA_DIR));
let window: BrowserWindow | null = null;
let target = '';
let loading = false;

async function loadServer(action: 'start' | 'restart' = 'start') {
  if (!window || loading) return;
  loading = true;
  try {
    const settings = readClientSettings(app.getPath('userData'), process.env.WEB_TERMINAL_URL);
    target = settings.serverUrl;
    await ensureService(target, settings, action);
    if (window && !window.isDestroyed()) await window.loadURL(target);
  } catch (error) {
    if (!window || window.isDestroyed()) return;
    const missing = error instanceof ServiceNotInstalledError;
    const answer = await dialog.showMessageBox(window, {
      type: 'error', title: '无法连接 Web Terminal',
      message: missing ? '请安装 Web Terminal 后重试。' : '服务检测或启动失败。',
      detail: `${target || ''}\n${error instanceof Error ? error.message : String(error)}`,
      buttons: missing ? ['复制安装命令', '打开连接配置', '关闭提示'] : ['打开连接配置', '关闭提示'], defaultId: 0, cancelId: missing ? 2 : 1,
    });
    if (missing && answer.response === 0) clipboard.writeText(error.installCommand);
    else if (answer.response === (missing ? 1 : 0)) await shell.openPath(join(app.getPath('userData'), 'client.yaml'));
  } finally { loading = false; }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 840, minWidth: 390, minHeight: 500,
    title: 'Web Terminal', backgroundColor: '#101821', show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      partition: 'persist:web-terminal',
    },
  });
  const contents = window.webContents;
  const clipboardPermissions = new Set(['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  contents.session.setPermissionRequestHandler((requester, permission, callback, details) => {
    callback(requester.id === contents.id && sameServer(details.requestingUrl || requester.getURL(), target) && clipboardPermissions.has(permission));
  });
  contents.session.setPermissionCheckHandler((requester, permission, requestingOrigin) =>
    requester?.id === contents.id && sameServer(requestingOrigin, target) && clipboardPermissions.has(permission));
  contents.on('will-navigate', (event, url) => { if (!sameServer(url, target)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!sameServer(url, target)) event.preventDefault(); });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '连接', submenu: [
      { label: '重新加载服务器', accelerator: process.platform === 'darwin' ? 'Cmd+R' : 'Ctrl+Shift+R', click: () => { void loadServer(); } },
      { id: 'restart-server', label: '重启后台服务（将结束普通 Shell 会话）', click: () => { void loadServer('restart'); } },
      { label: '打开连接配置', click: () => { void shell.openPath(join(app.getPath('userData'), 'client.yaml')); } },
      { type: 'separator' }, { role: 'quit', label: '退出' },
    ] },
    { label: '编辑', submenu: [
      { role: 'copy', label: '复制', accelerator: process.platform === 'darwin' ? 'Cmd+C' : 'Ctrl+Shift+C' },
      { role: 'paste', label: '粘贴', accelerator: process.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+Shift+V' },
      { role: 'selectAll', label: '全选', accelerator: process.platform === 'darwin' ? 'Cmd+A' : 'Ctrl+Shift+A' },
    ] },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }, { role: 'toggleDevTools', label: '开发者工具' }] },
  ]));
  // 先验证服务身份；本机服务缺失时通过全局 CLI 启动。
  void loadServer();
  window.show();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  void app.whenReady().then(createWindow);
  app.on('activate', () => { if (!window) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
