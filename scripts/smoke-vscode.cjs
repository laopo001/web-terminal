const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');

exports.run = async function () {
  const extension = vscode.extensions.getExtension('dadigua.web-terminal');
  assert(extension, '未加载 Web Terminal 开发扩展');
  await extension.activate();
  await vscode.commands.executeCommand('webTerminal.open');
  await new Promise(resolve => setTimeout(resolve, 4000));
  const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.label === 'Web Terminal');
  assert(tab, '未创建 Web Terminal Webview 标签');
  assert(tab.input instanceof vscode.TabInputWebview);
  await vscode.commands.executeCommand('webTerminal.showSidebar');
  await vscode.window.tabGroups.close(tab);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const root = path.resolve(__dirname, '..');
  const result = { extensionActive: extension.isActive, tabTitle: tab.label, webview: true, sidebarCommand: true };
  fs.writeFileSync(path.join(root, '.data', 'vscode-smoke.json'), JSON.stringify(result, null, 2));
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'capture-vscode-smoke.ps1'), '-Output', path.join(root, '.data', 'vscode-client.png')], { timeout: 15000, stdio: 'pipe' });
  }
};
