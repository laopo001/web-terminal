export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  processName?: string;
  title?: string;
  createdAt: string;
  running: boolean;
}
export interface ServerInfo {
  machineId: string;
  defaultCwd: string;
  roots: string[];
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
  | { type: 'auth'; token: string; sessionId: string; cols: number; rows: number }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };
export type ServerMessage =
  | { type: 'ready'; session: SessionInfo }
  | { type: 'replay'; data: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string };

export interface WorkspaceFolder { name: string; path: string }
export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: WorkspaceFolder[];
}
