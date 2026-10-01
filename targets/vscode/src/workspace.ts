/** 保留远程 URI 的服务端路径；Windows 打开的 WSL UNC 路径还原成 Linux 路径。 */
export function workspacePath(uri: { scheme: string; path: string; fsPath: string }): string | undefined {
  if (uri.scheme === 'vscode-remote') return uri.path;
  if (uri.scheme !== 'file') return undefined;
  const path = uri.fsPath;
  const wsl = /^\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+(\\.*)$/i.exec(path);
  if (wsl) return wsl[1].replaceAll('\\', '/');
  return path;
}
