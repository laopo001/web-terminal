import { connect } from 'node:net';
import { normalizeServerUrl } from '../shared/clientUrl.ts';
import { serviceName, serviceProtocol, type ServiceIdentity } from '../shared/service.ts';

export type ServiceProbe =
  | { kind: 'ready'; identity: ServiceIdentity }
  | { kind: 'stopped' }
  | { kind: 'conflict' | 'incompatible' | 'unreachable'; message: string };

export function isLocalServer(input: string): boolean {
  const url = new URL(normalizeServerUrl(input));
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

async function portState(url: URL, timeout: number): Promise<'open' | 'closed' | 'unknown'> {
  return new Promise(resolve => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) });
    const finish = (state: 'open' | 'closed' | 'unknown') => { socket.destroy(); resolve(state); };
    socket.setTimeout(timeout, () => finish('unknown'));
    socket.once('connect', () => finish('open'));
    socket.once('error', error => finish((error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? 'closed' : 'unknown'));
  });
}

export async function probeService(input: string, timeout = 1500): Promise<ServiceProbe> {
  const root = normalizeServerUrl(input);
  const url = new URL(root);
  try {
    const response = await fetch(`${root}/health`, { signal: AbortSignal.timeout(timeout), redirect: 'manual' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      return { kind: 'conflict', message: `${root} 端口已有服务，但没有返回 Web Terminal 身份（HTTP ${response.status}）。请检查端口占用或升级旧服务。` };
    }
    // 不读取陌生服务返回的无限响应体。
    const reader = response.body!.getReader();
    let body = '';
    try {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
        if (body.length > 8192) throw new Error('身份响应过大');
      }
      body += decoder.decode();
    } finally { await reader.cancel(); }
    let identity: ServiceIdentity;
    try { identity = JSON.parse(body); } catch { return { kind: 'conflict', message: `${root} 返回的服务身份无效。` }; }
    if (identity?.service !== serviceName || typeof identity.version !== 'string' || typeof identity.instanceId !== 'string' || !Number.isInteger(identity.pid) || typeof identity.managed !== 'boolean') {
      return { kind: 'conflict', message: `${root} 端口被其他服务占用，未启动或停止任何进程。` };
    }
    if (identity.protocol !== serviceProtocol) return { kind: 'incompatible', message: `Web Terminal ${identity.version} 的服务协议不兼容，请升级服务或客户端。` };
    return { kind: 'ready', identity };
  } catch {
    const state = await portState(url, timeout);
    if (state === 'closed') return { kind: 'stopped' };
    if (state === 'open') return { kind: 'unreachable', message: `${root} 端口已占用但身份检查无响应；服务可能挂起。未启动其他服务。` };
    return { kind: 'unreachable', message: `无法访问 ${root}，请检查网络、地址或转发配置。` };
  }
}
