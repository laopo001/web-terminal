import { mkdirSync, readFileSync, existsSync, realpathSync, writeFileSync, chmodSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { resolve, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { parseDocument } from 'yaml';

export interface Config {
  host: string; port: number; dataDir: string; uploadDir: string; token: string;
  defaultCwd: string; shell: string; machineId: string; maxUploadBytes: number;
}
export function loadConfig(defaults: { configFile?: string; dataDir?: string; uploadDir?: string; host?: string } = {}): Config & { configFile: string } {
  const home = resolve(process.env.WEB_TERMINAL_HOME || resolve(homedir(), '.web-terminal'));
  const configFile = resolve(process.env.WEB_TERMINAL_CONFIG || defaults.configFile || resolve(home, 'config.yaml'));
  const directory = dirname(configFile);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // 不同端口也共享配置文件，首次生成或迁移 token 时串行写入。
  const lock = `${configFile}.lock`;
  const deadline = Date.now() + 5000;
  let descriptor: number;
  for (;;) {
    try { descriptor = openSync(lock, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`配置文件正在被使用，请稍后重试：${configFile}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const document = parseDocument(existsSync(configFile) ? readFileSync(configFile, 'utf8') : '');
    if (document.errors.length) throw new Error('config.yaml 必须是有效的 YAML 配置对象');
    const raw = document.toJS();
    if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('config.yaml 必须是配置对象');
    const input = raw || {};
    const port = Number(process.env.PORT || input.port || 3840);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port 无效');
    const dataDir = resolve(directory, process.env.WEB_TERMINAL_DATA_DIR || input.dataDir || defaults.dataDir || resolve('.data'));
    let token = process.env.WEB_TERMINAL_TOKEN?.trim();
    let saveToken = false;
    if (!token) {
      if (input.token !== undefined) {
        if (typeof input.token !== 'string') throw new Error('token 必须是字符串；纯数字密码请加引号');
        token = input.token.trim();
      } else {
        const legacyFiles = [resolve(dataDir, 'token')];
        if (configFile === resolve(home, 'config.yaml')) {
          legacyFiles.push(resolve(home, '.data/token'), resolve('.data/token'));
        }
        const legacy = legacyFiles.find(file => existsSync(file));
        token = legacy ? readFileSync(legacy, 'utf8').trim() : randomBytes(32).toString('base64url');
        saveToken = true;
      }
    }
    if (!token || token.length > 1024) throw new Error('token 不能为空，且最多 1024 个字符');
    const config = {
      configFile,
      host: String(process.env.HOST || input.host || defaults.host || '127.0.0.1'), port, dataDir, token,
      uploadDir: resolve(directory, input.uploadDir || defaults.uploadDir || resolve(home, 'uploads')),
      defaultCwd: realpathSync(resolve(directory, input.defaultCwd || homedir())),
      shell: String(input.shell || process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')),
      machineId: `${hostname()}-${createHash('sha256').update(dataDir).digest('hex').slice(0, 8)}`,
      maxUploadBytes: 20 * 1024 * 1024,
    };
    if (saveToken) {
      document.set('token', token);
      const temporary = `${configFile}.${process.pid}.tmp`;
      try {
        writeFileSync(temporary, document.toString(), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, configFile);
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    }
    if (existsSync(configFile)) chmodSync(configFile, 0o600);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    return config;
  } finally {
    closeSync(descriptor);
    unlinkSync(lock);
  }
}
