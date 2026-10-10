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
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>{children}</div>, document.body);
}
