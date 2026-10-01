import type { Terminal } from '@xterm/xterm';
import { arrowSequence } from './terminalKeys';

/** 手势绑定到稳定的终端容器，不随 TUI 重绘重新绑定。 */
export function enableTouchScroll(term: Terminal, sendScrollInput: (data: string) => void) {
  const element = term.element!;
  const oldAction = element.style.touchAction;
  element.style.touchAction = 'pan-x pinch-zoom';
  let gesture: { id: number; x: number; y: number; lastY: number; remainder: number; axis?: 'x' | 'y'; bar?: { viewport: number; travel: number; lines: number } } | undefined;
  const start = (event: TouchEvent) => {
    gesture = undefined;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, lastY: touch.clientY, remainder: 0 };
    const bar = (event.target as Element).closest<HTMLElement>('.scrollbar.vertical');
    if (bar && term.buffer.active.type === 'normal' && term.buffer.active.baseY > 0) {
      const thumb = bar.querySelector<HTMLElement>('.slider');
      gesture.bar = { viewport: term.buffer.active.viewportY, travel: Math.max(1, bar.clientHeight - (thumb?.offsetHeight || 0)), lines: term.buffer.active.baseY };
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const move = (event: TouchEvent) => {
    if (!gesture || event.touches.length !== 1) { gesture = undefined; return; }
    const touch = Array.from(event.touches).find(item => item.identifier === gesture!.id);
    if (!touch) return;
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
    if (gesture.bar) {
      event.preventDefault(); event.stopImmediatePropagation();
      const bar = gesture.bar;
      term.scrollToLine(Math.max(0, Math.min(bar.lines, Math.round(bar.viewport + dy * bar.lines / bar.travel))));
      return;
    }
    if (!gesture.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 7) return;
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (gesture.axis === 'x') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const screen = element.querySelector<HTMLElement>('.xterm-screen')!;
    const cellHeight = (screen.offsetHeight || term.rows * 17) / term.rows;
    gesture.remainder += (gesture.lastY - touch.clientY) / cellHeight;
    gesture.lastY = touch.clientY;
    const lines = Math.trunc(gesture.remainder); gesture.remainder -= lines;
    if (!lines) return;
    if (term.buffer.active.type === 'normal' && term.buffer.active.baseY > 0) {
      term.scrollLines(lines);
    } else if (term.modes.mouseTrackingMode !== 'none') {
      // 每个滚轮事件对应一行，沿用 xterm 当前的鼠标编码协议。
      for (let i = 0; i < Math.min(40, Math.abs(lines)); i++) screen.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaMode: 1, deltaY: Math.sign(lines), clientX: touch.clientX, clientY: touch.clientY,
      }));
    } else if (term.buffer.active.type === 'alternate') {
      sendScrollInput(arrowSequence(lines < 0 ? 'up' : 'down', term.modes.applicationCursorKeysMode).repeat(Math.min(40, Math.abs(lines))));
    }
  };
  const end = () => { gesture = undefined; };
  element.addEventListener('touchstart', start, { capture: true, passive: false });
  element.addEventListener('touchmove', move, { capture: true, passive: false });
  element.addEventListener('touchend', end, true);
  element.addEventListener('touchcancel', end, true);
  return { dispose() {
    element.style.touchAction = oldAction;
    element.removeEventListener('touchstart', start, true); element.removeEventListener('touchmove', move, true);
    element.removeEventListener('touchend', end, true); element.removeEventListener('touchcancel', end, true);
  } };
}
