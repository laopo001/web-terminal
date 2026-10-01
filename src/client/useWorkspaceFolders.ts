import { useEffect, useState } from 'react';
import type { WorkspaceFolder } from '../shared/protocol';

export function useWorkspaceFolders() {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  useEffect(() => {
    if (window.parent === window || new URLSearchParams(location.search).get('embed') !== 'vscode') return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'web-terminal:workspace-folders' || !Array.isArray(event.data.folders)) return;
      setFolders(event.data.folders.filter((item: WorkspaceFolder) => typeof item?.name === 'string' && typeof item?.path === 'string').slice(0, 100));
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'web-terminal:request-workspace-folders' }, '*');
    return () => window.removeEventListener('message', receive);
  }, []);
  return folders;
}
