import packageInfo from '../../package.json' with { type: 'json' };

export const serviceName = '@dadigua/web-terminal';
export const serviceProtocol = 1;
export const serviceVersion = packageInfo.version;

export interface ServiceIdentity {
  service: typeof serviceName;
  version: string;
  protocol: number;
  instanceId: string;
  pid: number;
  managed: boolean;
}
