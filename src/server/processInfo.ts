import { readFile, readlink } from 'node:fs/promises';
import { basename } from 'node:path';

/** 仅读取前台程序身份和工作目录，不把命令参数暴露给页面。 */
export async function foregroundInfo(pid: number, fallback: string) {
  let foreground = pid;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const group = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[5]);
    if (Number.isInteger(group) && group > 0) foreground = group;
  } catch { /* 保留 Shell PID */ }
  let processName = basename(fallback).replace(/^-/, '');
  let cwd: string | undefined;
  try { cwd = await readlink(`/proc/${foreground}/cwd`); } catch { /* 进程可能刚退出 */ }
  try {
    const executable = await readlink(`/proc/${foreground}/exe`);
    if (/\/claude\/versions\//.test(executable)) processName = 'claude';
    else if (basename(executable) === 'codex') processName = 'codex';
    else if (/^(node|nodejs|bun)$/.test(basename(executable))) {
      const argv = (await readFile(`/proc/${foreground}/cmdline`, 'utf8')).split('\0', 2);
      if (/[/\\](?:@anthropic-ai[/\\]claude-code|claude-code)[/\\]/.test(argv[1] || '')) processName = 'claude';
      else if (/[/\\]@openai[/\\]codex[/\\]/.test(argv[1] || '')) processName = 'codex';
    }
  } catch { /* 使用 node-pty 提供的进程名 */ }
  return { processName, cwd };
}
