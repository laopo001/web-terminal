export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  processName?: string;
  title?: string;
  createdAt: string;
  running: boolean;
  outputActive?: boolean;
}
export interface ServerInfo {
  machineId: string;
  defaultCwd: string;
  maxUploadBytes: number;
}
export interface FileInfo {
  path: string;
  name: string;
  size: number;
  mime: string;
  isImage: boolean;
  width?: number;
  height?: number;
}
export type ClientMessage =
  | { type: 'auth'; protocol: 2; token: string; sessionId: string; cols: number; rows: number }
  | { type: 'auth'; protocol: 2; token: string; scope: 'sessions' }
  | { type: 'input'; data: string }
  | { type: 'paste'; text: string; submit: boolean }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'claim'; cols: number; rows: number };
export type ServerMessage =
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'ready'; session: SessionInfo }
  | { type: 'snapshot'; data: string; cols: number; rows: number; controller: boolean }
  | { type: 'control'; controller: boolean }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string };

export interface WorkspaceFolder { name: string; path: string }
export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: WorkspaceFolder[];
}
