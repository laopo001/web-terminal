import { execFile } from 'node:child_process';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serviceVersion } from './shared/service.ts';

const execute = promisify(execFile);
const extensionId = 'dadigua.web-terminal';
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
interface Launcher { label: string; file: string; args: string[] }
export interface InstalledExtension { target: string; extension: string }
export interface InstallVSCodeOptions {
  vsixPath?: string;
  codeCommand?: string;
  codeInsidersCommand?: string;
  installWindowsHost?: boolean;
  onInstalled?: (result: InstalledExtension) => void;
}

async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}

// 新版 CLI 与旧版 bin 布局共存；优先使用 CLI 的最近使用记录。
export async function findServerLauncher(root: string): Promise<{ file: string; args: string[] } | undefined> {
  const cliRoot = join(root, 'cli/servers');
  let recent: string[] = [];
  try {
    const value: unknown = JSON.parse(await readFile(join(cliRoot, 'lru.json'), 'utf8'));
    if (Array.isArray(value)) recent = value.filter((item): item is string => typeof item === 'string' && !item.includes('/') && !item.includes('\\'));
  } catch {}
  const candidates = [
    ...(await readdir(cliRoot).catch(() => [])).map(name => ({ name, path: join(cliRoot, name, 'server') })),
    ...(await readdir(join(root, 'bin')).catch(() => [])).map(name => ({ name, path: join(root, 'bin', name) })),
  ];
  const available = [];
  for (const candidate of candidates) {
    const entry = join(candidate.path, 'out/server-main.js');
    if (!await exists(entry)) continue;
    available.push({ ...candidate, entry, mtime: (await stat(candidate.path)).mtimeMs });
  }
  available.sort((a, b) => {
    const rank = (name: string) => recent.includes(name) ? recent.indexOf(name) : Infinity;
    return rank(a.name) - rank(b.name) || b.mtime - a.mtime;
  });
  const server = available[0];
  if (!server) return undefined;
  const node = join(server.path, 'node');
  return { file: await exists(node) ? node : process.execPath, args: [server.entry, '--extensions-dir', join(root, 'extensions')] };
}

async function findCommand(command: string) {
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const candidate = resolve(directory, command);
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  return undefined;
}

async function isWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  return (await readFile('/proc/version', 'utf8').catch(() => '')).toLowerCase().includes('microsoft');
}

async function localLaunchers(options: InstallVSCodeOptions, wsl: boolean): Promise<Launcher[]> {
  const launchers: Launcher[] = [];
  for (const [channel, command, override, folder] of [
    ['Stable', 'code', options.codeCommand, '.vscode-server'],
    ['Insiders', 'code-insiders', options.codeInsidersCommand, '.vscode-server-insiders'],
  ] as const) {
    if (override) { launchers.push({ label: `本机 ${channel}`, file: override, args: [] }); continue; }
    if (process.platform === 'linux') {
      const defaultRoot = join(homedir(), folder);
      const agentRoot = process.env.VSCODE_AGENT_FOLDER;
      const root = agentRoot && agentRoot.includes('insiders') === (channel === 'Insiders') ? agentRoot : defaultRoot;
      const server = await findServerLauncher(root);
      if (server) { launchers.push({ label: `${wsl ? 'WSL' : 'Remote'} ${channel}`, ...server }); continue; }
    }
    const file = await findCommand(command);
    // WSL 的 Windows 包装器和 remote-cli 不能代替本机扩展宿主。
    if (file && !(wsl && (file.startsWith('/mnt/') || file.includes('/remote-cli/')))) {
      launchers.push({ label: `本机 ${channel}`, file, args: [] });
    }
  }
  return launchers;
}

async function invoke(launcher: Launcher, args: string[]) {
  const { stdout } = await execute(launcher.file, [...launcher.args, ...args], {
    timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  if (stdout.includes('Command is only available in WSL or inside a Visual Studio Code terminal')) {
    throw new Error(stdout.trim());
  }
  return stdout;
}

function verifyExtension(output: string, version?: string) {
  const extension = output.split(/\r?\n/).map(line => line.trim()).find(line => line.toLowerCase().startsWith(`${extensionId}@`));
  if (!extension || (version && extension !== `${extensionId}@${version}`)) {
    throw new Error(`安装后未找到 ${extensionId}${version ? `@${version}` : ''}，扩展列表：\n${output.trim()}`);
  }
  return extension;
}

async function installWindows(vsix: string, wsl: boolean, version?: string): Promise<InstalledExtension[]> {
  const source = wsl ? (await execute('wslpath', ['-w', vsix])).stdout.trim() : vsix;
  const script = `
$ErrorActionPreference = 'Stop'
$temporary = $null
try {
  Set-Location $env:SystemDrive\\
  $vsix = ${psQuote(source)}
  if (${wsl ? '$true' : '$false'}) {
    $temporary = Join-Path $env:TEMP ('web-terminal-' + [guid]::NewGuid() + '.vsix')
    Copy-Item -LiteralPath $vsix -Destination $temporary
    $vsix = $temporary
  }
  $results = @()
  $failures = @()
  foreach ($channel in @(
    @{ Name = 'Stable'; Command = 'code.cmd'; Folder = 'Microsoft VS Code' },
    @{ Name = 'Insiders'; Command = 'code-insiders.cmd'; Folder = 'Microsoft VS Code Insiders' }
  )) {
    $command = (Get-Command $channel.Command -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $command) {
      foreach ($base in @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'))) {
        if (-not $base) { continue }
        $candidate = Join-Path $base ($channel.Folder + '\\bin\\' + $channel.Command)
        if (Test-Path -LiteralPath $candidate) { $command = $candidate; break }
      }
    }
    if (-not $command) { continue }
    try {
      & $command --install-extension $vsix --force | Out-Host
      if ($LASTEXITCODE -ne 0) { throw ('安装命令退出码：' + $LASTEXITCODE) }
      $extensions = & $command --list-extensions --show-versions
      if ($LASTEXITCODE -ne 0) { throw ('扩展列表命令退出码：' + $LASTEXITCODE) }
      $match = $extensions | Where-Object { $_ -like '${extensionId}@*' } | Select-Object -First 1
      if (-not $match${version ? ` -or $match -ne ${psQuote(`${extensionId}@${version}`)}` : ''}) { throw '安装后未找到指定版本的 Web Terminal 扩展' }
      $results += @{ target = ('Windows ' + $channel.Name); extension = $match }
    } catch { $failures += ('Windows ' + $channel.Name + ': ' + $_.Exception.Message) }
  }
  Write-Output ('WEB_TERMINAL_INSTALL::' + (ConvertTo-Json -Compress -Depth 4 -InputObject @{ installed = @($results); failures = @($failures) }))
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
finally { if ($temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue } }
`;
  const powershell = wsl ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : 'powershell.exe';
  const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const marker = stdout.split(/\r?\n/).find(line => line.startsWith('WEB_TERMINAL_INSTALL::'));
  if (!marker) throw new Error(`Windows 安装没有返回验证结果：\n${stdout.trim()}`);
  const result = JSON.parse(marker.slice('WEB_TERMINAL_INSTALL::'.length)) as { installed: InstalledExtension[]; failures: string[] };
  for (const installed of result.installed) verifyExtension(installed.extension, version);
  if (result.failures.length) throw new Error([...result.installed.map(item => `${item.target} 已安装 ${item.extension}`), ...result.failures].join('\n'));
  return result.installed;
}

export async function installVSCodeExtension(options: InstallVSCodeOptions = {}): Promise<InstalledExtension[]> {
  const path = options.vsixPath ? resolve(options.vsixPath) : fileURLToPath(new URL('../release/web-terminal.vsix', import.meta.url));
  if (!await exists(path)) throw new Error(`未找到 VSIX：${path}。本地开发请运行 pnpm package:vscode，或用 --vsix 指定文件。`);
  const version = options.vsixPath ? undefined : serviceVersion;
  const wsl = await isWsl();
  const installed: InstalledExtension[] = [];
  const failures: string[] = [];
  const record = (result: InstalledExtension) => { installed.push(result); options.onInstalled?.(result); };
  if (process.platform !== 'win32') {
    for (const launcher of await localLaunchers(options, wsl)) {
      try {
        await invoke(launcher, ['--install-extension', path, '--force']);
        const extension = verifyExtension(await invoke(launcher, ['--list-extensions', '--show-versions']), version);
        record({ target: launcher.label, extension });
      } catch (error) { failures.push(`${launcher.label}：${errorDetail(error)}`); }
    }
  }
  if (process.platform === 'win32' || (options.installWindowsHost ?? wsl)) {
    try { for (const result of await installWindows(path, wsl, version)) record(result); }
    catch (error) { failures.push(errorDetail(error)); }
  }
  if (failures.length) throw new Error(`插件安装未全部完成：\n${failures.join('\n')}`);
  if (!installed.length) throw new Error('未找到可用的 VS Code。请安装 VS Code 并将 code 加入 PATH；WSL 扩展宿主需先用 Remote WSL 连接一次。');
  return installed;
}

function errorDetail(error: unknown) {
  const failure = error as { stderr?: string; stdout?: string };
  return [error instanceof Error ? error.message : String(error), failure.stderr?.trim(), failure.stdout?.trim()].filter(Boolean).join('\n');
}
