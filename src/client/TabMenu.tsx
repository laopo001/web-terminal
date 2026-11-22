import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface TabMenuPosition { x: number; y: number; anchor: HTMLElement | null }
export function TabMenu({ position, onClose, children }: { position: TabMenuPosition; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current!;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [position]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); };
  }, [onClose]);
  return createPortal(<div ref={ref} role="menu" aria-label="标签分组菜单" className="tab-menu" style={{ left: position.x, top: position.y }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); position.anchor?.focus({ preventScroll: true }); return; }
      if (event.key === 'Tab') { onClose(); return; }
      const active = document.activeElement as HTMLButtonElement | null;
      const row = active?.closest<HTMLElement>('[data-menu-row]');
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (!row) return;
        event.preventDefault();
        const rowButtons = [...row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (!rowButtons.length) return;
        const index = active ? rowButtons.indexOf(active) : -1;
        const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + rowButtons.length) % rowButtons.length;
        rowButtons[next]?.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const stops: { contains: (element: Element | null) => boolean; focus: () => void }[] = [];
      for (const element of ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), [data-menu-row]')) {
        if (element.matches('button')) {
          if (element.closest('[data-menu-row]')) continue;
          stops.push({ contains: target => target === element, focus: () => element.focus() });
        } else {
          const rowButtons = [...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          if (!rowButtons.length) continue;
          stops.push({
            contains: target => !!target && element.contains(target),
            focus: () => (rowButtons.find(button => button.getAttribute('aria-checked') === 'true') || rowButtons[0]).focus(),
          });
        }
      }
      if (!stops.length) return;
      const current = stops.findIndex(stop => stop.contains(active));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? stops.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + stops.length) % stops.length;
      stops[next]?.focus();
    }}>{children}</div>, document.body);
}
