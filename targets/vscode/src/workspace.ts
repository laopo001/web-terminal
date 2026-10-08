/** 保留远程 URI 的服务端路径；Windows 打开的 WSL UNC 路径还原成 Linux 路径。 */
export function workspacePath(uri: { scheme: string; path: string; fsPath: string }): string | undefined {
  if (uri.scheme === 'vscode-remote') return uri.path;
  if (uri.scheme !== 'file') return undefined;
  const path = uri.fsPath;
  const wsl = /^\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+(\\.*)$/i.exec(path);
  if (wsl) return wsl[1].replaceAll('\\', '/');
  return path;
}

/** Windows 本地宿主通过当前工作区的 WSL UNC 根打开服务端 Linux 文件。 */
export function editorFilePath(path: string, platform: string, folders: { fsPath: string }[]): string {
  if (!path || path.includes('\0')) throw new Error('文件路径无效');
  if (platform !== 'win32') { if (!path.startsWith('/')) throw new Error('需要绝对文件路径'); return path; }
  if (/^[a-z]:[\\/]|^\\\\/i.test(path)) return path;
  if (!path.startsWith('/')) throw new Error('需要绝对文件路径');
  const root = folders.map(folder => /^(\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+)(?:\\|$)/i.exec(folder.fsPath)?.[1]).find(Boolean);
  if (!root) throw new Error('请在对应的 WSL 工作区打开此文件');
  return root + path.replaceAll('/', '\\');
}
