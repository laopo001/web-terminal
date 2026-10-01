import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { defaultServerUrl, normalizeServerUrl } from '../../../src/shared/clientUrl.ts';

export function readServerUrl(dataDir: string, override?: string): string {
  const temporaryUrl = override ? normalizeServerUrl(override) : undefined;
  const file = join(dataDir, 'client.yaml');
  if (!existsSync(file)) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, stringify({ serverUrl: defaultServerUrl }), { mode: 0o600, flag: 'wx' });
    return temporaryUrl || defaultServerUrl;
  }
  if (temporaryUrl) return temporaryUrl;
  const config = parse(readFileSync(file, 'utf8'));
  if (!config || typeof config.serverUrl !== 'string') throw new Error('client.yaml 需要配置 serverUrl');
  return normalizeServerUrl(config.serverUrl);
}

export function sameServer(candidate: string, server: string): boolean {
  try { const url = new URL(candidate); return ['http:', 'https:'].includes(url.protocol) && url.origin === new URL(server).origin && !url.username && !url.password; } catch { return false; }
}
