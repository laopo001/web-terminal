const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');

exports.run = async function () {
  const extension = vscode.extensions.getExtension('dadigua.web-terminal');
  assert(extension, '未加载 Web Terminal 开发扩展');
  await extension.activate();
  const base = vscode.workspace.getConfiguration('webTerminal').get('serverUrl', 'http://localhost:3840');
  await vscode.commands.executeCommand('webTerminal.open');
  await new Promise(resolve => setTimeout(resolve, 4000));
  const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.label === 'Web Terminal');
  assert(tab, '未创建 Web Terminal Webview 标签');
  assert(tab.input instanceof vscode.TabInputWebview);
  let before;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { before = await (await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).json(); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert(before, '后台未自动启动');
  assert.equal(before.service, '@dadigua/web-terminal');
  await vscode.commands.executeCommand('webTerminal.restartServer');
  const after = await (await fetch(base + '/health')).json();
  assert.notEqual(after.instanceId, before.instanceId, '重启命令未替换后台进程');
  await vscode.commands.executeCommand('webTerminal.showSidebar');
  await vscode.window.tabGroups.close(tab);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const root = path.resolve(__dirname, '..');
  const result = { extensionActive: extension.isActive, tabTitle: tab.label, webview: true, sidebarCommand: true, restartCommand: true, before: before.instanceId, after: after.instanceId };
  fs.writeFileSync(path.join(root, '.data', 'vscode-smoke.json'), JSON.stringify(result, null, 2));
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'capture-vscode-smoke.ps1'), '-Output', path.join(root, '.data', 'vscode-client.png')], { timeout: 15000, stdio: 'pipe' });
  }
};
