import { mkdirSync, readFileSync, existsSync, realpathSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { parse } from 'yaml';

export interface Config {
  host: string; port: number; dataDir: string; token: string;
  defaultCwd: string; shell: string; machineId: string; maxUploadBytes: number;
}
export function loadConfig(defaults: { configFile?: string; dataDir?: string } = {}): Config {
  const configFile = resolve(process.env.WEB_TERMINAL_CONFIG || defaults.configFile || 'config.yaml');
  const raw = existsSync(configFile) ? parse(readFileSync(configFile, 'utf8')) : {};
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('config.yaml 必须是配置对象');
  const input = raw || {};
  const dataDir = resolve(process.env.WEB_TERMINAL_DATA_DIR || input.dataDir || defaults.dataDir || '.data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tokenFile = resolve(dataDir, 'token');
  let token = process.env.WEB_TERMINAL_TOKEN?.trim();
  if (!token) {
    if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' });
    chmodSync(tokenFile, 0o600);
    token = readFileSync(tokenFile, 'utf8').trim();
  }
  if (!token || token.length > 1024) throw new Error('token 不能为空，且最多 1024 个字符');
  const port = Number(process.env.PORT || input.port || 3840);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port 无效');
  return {
    host: String(process.env.HOST || input.host || '127.0.0.1'), port, dataDir, token,
    defaultCwd: realpathSync(resolve(input.defaultCwd || homedir())),
    shell: String(input.shell || process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')),
    machineId: `${hostname()}-${createHash('sha256').update(dataDir).digest('hex').slice(0, 8)}`,
    maxUploadBytes: 20 * 1024 * 1024,
  };
}
