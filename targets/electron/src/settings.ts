import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { defaultServerUrl, normalizeServerUrl } from '../../../src/shared/clientUrl.ts';
import type { ServiceRuntime } from '../../../src/service/client.ts';

export function readClientSettings(dataDir: string, override?: string): { serverUrl: string; runtime: ServiceRuntime; cliPath: string } {
  const temporaryUrl = override ? normalizeServerUrl(override) : undefined;
  const file = join(dataDir, 'client.yaml');
  if (!existsSync(file)) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, stringify({ serverUrl: defaultServerUrl, runtime: 'auto', cliPath: '' }), { mode: 0o600, flag: 'wx' });
    return { serverUrl: temporaryUrl || defaultServerUrl, runtime: 'auto', cliPath: '' };
  }
  const config = parse(readFileSync(file, 'utf8'));
  if (!config || typeof config.serverUrl !== 'string') throw new Error('client.yaml 需要配置 serverUrl');
  if (config.runtime !== undefined && !['auto', 'native', 'wsl'].includes(config.runtime)) throw new Error('client.yaml 的 runtime 只能是 auto、native 或 wsl');
  if (config.cliPath !== undefined && typeof config.cliPath !== 'string') throw new Error('client.yaml 的 cliPath 必须是字符串');
  return { serverUrl: temporaryUrl || normalizeServerUrl(config.serverUrl), runtime: config.runtime || 'auto', cliPath: config.cliPath || '' };
}


export function sameServer(candidate: string, server: string): boolean {
  try { const url = new URL(candidate); return ['http:', 'https:'].includes(url.protocol) && url.origin === new URL(server).origin && !url.username && !url.password; } catch { return false; }
}
