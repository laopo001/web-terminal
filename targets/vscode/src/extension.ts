import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { defaultServerUrl, normalizeServerUrl, vscodeEmbedUrl } from '../../../src/shared/clientUrl.js';
import { forwardedEmbedUrl } from './html.js';
import { editorFilePath, workspacePath } from './workspace.js';
import { WebviewContent } from './content.js';
import { ensureService, ServiceNotInstalledError, type ServiceRuntime } from '../../../src/service/client.js';

const viewType = 'webTerminal.panel';
let panel: vscode.WebviewPanel | undefined;
let panelContent: WebviewContent | undefined;
let sidebarContent: WebviewContent | undefined;
const sidebarId = 'webTerminal.sidebar';
let restarting = false;
let lastSurface: 'panel' | 'sidebar' = 'sidebar';

function serviceSettings() {
  const config = vscode.workspace.getConfiguration('webTerminal');
  return {
    url: normalizeServerUrl(config.get<string>('serverUrl', defaultServerUrl)),
    options: { runtime: config.get<ServiceRuntime>('runtime', 'auto'), cliPath: config.get<string>('cliPath', ''), allowStart: vscode.workspace.isTrusted },
  };
}

async function reportServiceError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ServiceNotInstalledError) {
    if (await vscode.window.showErrorMessage(message, '复制安装命令') === '复制安装命令') await vscode.env.clipboard.writeText(error.installCommand);
  } else void vscode.window.showErrorMessage(`Web Terminal：${message}`);
}

async function restartServer(): Promise<void> {
  if (restarting) return;
  restarting = true;
  try {
    const { url, options } = serviceSettings();
    const confirm = await vscode.window.showWarningMessage(
      '确定重启 Web Terminal 后台服务？',
      { modal: true, detail: `服务地址：${url}\n重启会结束所有普通 Shell 会话及其中运行的程序，访问令牌会保留。` },
      '重启服务',
    );
    if (confirm !== '重启服务') return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Web Terminal：正在重启后台服务…' }, async () => {
      await ensureService(url, options, 'restart');
      await refresh(true);
    });
    void vscode.window.showInformationMessage('Web Terminal：后台服务已就绪，页面已重新加载。');
  } catch (error) {
    await reportServiceError(error);
  } finally { restarting = false; }
}

function workspaceFolders() {
  return (vscode.workspace.workspaceFolders || []).flatMap(folder => {
    const path = workspacePath(folder.uri);
    return path ? [{ name: folder.name, path }] : [];
  });
}

async function externalUrl(): Promise<string> {
  const { url, options } = serviceSettings();
  try { await ensureService(url, options); } catch (error) { await reportServiceError(error); throw error; }
  const embedded = new URL(vscodeEmbedUrl(url));
  const external = await vscode.env.asExternalUri(vscode.Uri.from({
    scheme: embedded.protocol.slice(0, -1), authority: embedded.host, path: embedded.pathname,
    query: embedded.search.slice(1),
  }));
  if (!['http:', 'https:'].includes(external.scheme + ':') || !external.authority) {
    throw new Error('VS Code 转发后返回了无效的 HTTP(S) 地址');
  }
  return forwardedEmbedUrl(external.toString());
}

async function refresh(force = false): Promise<void> {
  await Promise.all([panelContent?.update(force), sidebarContent?.update(force)]);
}

async function receiveMessage(content: WebviewContent, message: { type?: string; path?: unknown }): Promise<void> {
  content.receive(message);
  if (message?.type !== 'web-terminal:open-file' || typeof message.path !== 'string') return;
  try {
    const path = editorFilePath(message.path, process.platform, (vscode.workspace.workspaceFolders || []).map(folder => folder.uri));
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path));
  } catch (error) { void vscode.window.showErrorMessage(`Web Terminal：打开文件失败：${error instanceof Error ? error.message : String(error)}`); }
}

function attach(current: vscode.WebviewPanel): void {
  panel = current;
  const content = new WebviewContent(current.webview, externalUrl, workspaceFolders);
  panelContent = content;
  current.onDidChangeViewState(() => { if (current.active) lastSurface = 'panel'; });
  current.webview.onDidReceiveMessage(message => void receiveMessage(content, message));
  current.onDidDispose(() => {
    content.dispose();
    if (panel === current) { panel = undefined; panelContent = undefined; }
  });
  void content.update();
}

function open(): void {
  if (panel) { panel.reveal(); return; }
  const current = vscode.window.createWebviewPanel(viewType, 'Web Terminal', vscode.ViewColumn.Active, {
    enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true,
  });
  attach(current);
}

async function sendSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) { void vscode.window.showInformationMessage('请先选中要发送的文本'); return; }
  const document = editor.document;
  const text = editor.selections.filter(selection => !selection.isEmpty).map(selection => document.getText(selection)).join('\n');
  const path = workspacePath(document.uri) || document.uri.toString();
  const attachment = { id: randomUUID(), name: path.split(/[\\/]/).pop() || '选中文本', text: `Path: ${path}\nLanguage: ${document.languageId}\nLines: ${editor.selection.start.line + 1}-${editor.selection.end.line + 1}\n\n${text}` };
  if (lastSurface === 'panel' && panelContent) { panel?.reveal(undefined, true); panelContent.sendAttachment(attachment); }
  else {
    await vscode.commands.executeCommand(`${sidebarId}.focus`);
    if (sidebarContent) sidebarContent.sendAttachment(attachment);
    else { open(); panelContent?.sendAttachment(attachment); }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(sidebarId, {
      resolveWebviewView(view) {
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        const content = new WebviewContent(view.webview, externalUrl, workspaceFolders);
        sidebarContent?.dispose();
        sidebarContent = content;
        view.webview.onDidReceiveMessage(message => void receiveMessage(content, message));
        view.onDidChangeVisibility(() => { if (view.visible) lastSurface = 'sidebar'; });
        view.onDidDispose(() => {
          content.dispose();
          if (sidebarContent === content) sidebarContent = undefined;
        });
        void content.update();
      },
    }, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('webTerminal.showSidebar', () => vscode.commands.executeCommand(`${sidebarId}.focus`)),
    vscode.commands.registerCommand('webTerminal.open', () => { lastSurface = 'panel'; open(); }),
    vscode.commands.registerCommand('webTerminal.sendSelection', sendSelection),
    vscode.commands.registerCommand('webTerminal.restartServer', restartServer),
    vscode.commands.registerCommand('webTerminal.reload', () => {
      if (!panelContent && !sidebarContent) { void vscode.commands.executeCommand(`${sidebarId}.focus`); return; }
      void refresh(true);
    }),
    vscode.commands.registerCommand('webTerminal.setServerUrl', async () => {
      const config = vscode.workspace.getConfiguration('webTerminal');
      const input = await vscode.window.showInputBox({
        title: 'Web Terminal Server URL', prompt: 'HTTP(S) 服务器根地址',
        value: config.get<string>('serverUrl', defaultServerUrl),
        validateInput: (value) => { try { normalizeServerUrl(value); return undefined; } catch (error) { return error instanceof Error ? error.message : String(error); } },
      });
      if (input === undefined) return;
      await config.update('serverUrl', normalizeServerUrl(input), vscode.ConfigurationTarget.Global);
    }),
    vscode.window.registerWebviewPanelSerializer(viewType, {
      async deserializeWebviewPanel(restored) {
        restored.webview.options = { enableScripts: true, localResourceRoots: [] };
        attach(restored);
      },
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { panelContent?.updateFolders(); sidebarContent?.updateFolders(); }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (['webTerminal.serverUrl', 'webTerminal.runtime', 'webTerminal.cliPath'].some(key => event.affectsConfiguration(key))) void refresh();
    }),
  );
}

export function deactivate(): void { panelContent?.dispose(); sidebarContent?.dispose(); }
