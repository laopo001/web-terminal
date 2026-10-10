import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../shared/protocol';
import { loadTabLayout, parseTabLayout, reconcileTabLayout, saveTabLayout, tabLayoutStorageKey, updateTabLayout, type TabLayout, type TabLayoutAction } from './sessionGroups';

export function useSessionGroups(sessions: SessionInfo[], ready: boolean, onNotice: (message: string) => void) {
  const [layout, setLayout] = useState(loadTabLayout);
  const latest = useRef(layout);
  const ids = sessions.map(session => session.id);
  const signature = JSON.stringify(ids);
  const persist = useCallback((next: TabLayout) => {
    latest.current = next; setLayout(next);
    try { saveTabLayout(next); }
    catch { onNotice('标签布局暂时无法保存，当前窗口仍可使用。'); }
  }, [onNotice]);
  useEffect(() => {
    if (!ready) return;
    const next = reconcileTabLayout(latest.current, ids);
    if (JSON.stringify(next) !== JSON.stringify(latest.current)) persist(next);
  }, [signature, ready, persist]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== tabLayoutStorageKey) return;
      let next: TabLayout;
      try { next = parseTabLayout(JSON.parse(event.newValue || 'null')); } catch { return; }
      latest.current = next; setLayout(next);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const change = (action: TabLayoutAction) => persist(updateTabLayout(latest.current, ids, action));
  return { layout, change };
}
