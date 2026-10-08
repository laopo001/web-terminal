import type { Terminal } from '@xterm/xterm';
import { arrowSequence } from './terminalKeys';
import type { InteractionMode } from './clientSettings';

type Gesture = {
  id: number; x: number; y: number; lastX: number; lastY: number; remainder: number; startedAt: number;
  mode: 'pending' | 'scroll-x' | 'scroll-y' | 'select' | 'bar' | 'native';
  edge?: 'start' | 'end'; anchorStart?: number; anchorEnd?: number;
  offsetX: number; offsetY: number;
  bar?: { viewport: number; travel: number; lines: number };
};

/** 手指按当前交互设置处理；pointerType 只用于区分输入事件，不决定交互模式。 */
export function enableTouchInteraction(term: Terminal, options: {
  selectionMode?: () => InteractionMode;
  copyMode: () => boolean;
  onCancelCopy?: () => void;
  sendScrollInput: (data: string) => void;
  copyText: (text: string) => void;
}) {
  const element = term.element!, document = element.ownerDocument, window = document.defaultView!;
  const oldAction = element.style.touchAction;
  const updateAction = () => { element.style.touchAction = options.copyMode() ? 'pinch-zoom' : 'pan-x pinch-zoom'; };
  updateAction();
  let gesture: Gesture | undefined;
  let ownedSelection = false, replayingTap = false, lastPointerType = '';
  const touches = new Set<number>();
  const startHandle = document.createElement('button'), endHandle = document.createElement('button');
  for (const [button, edge, label] of [[startHandle, 'start', '调整选区起点'], [endHandle, 'end', '调整选区终点']] as const) {
    button.type = 'button'; button.className = 'terminal-selection-handle'; button.dataset.edge = edge;
    button.setAttribute('aria-label', label); button.hidden = true; element.append(button);
  }
  const actions = document.createElement('div');
  actions.className = 'terminal-touch-actions'; actions.setAttribute('role', 'toolbar'); actions.setAttribute('aria-label', '触屏选区操作'); actions.hidden = true;
  const copy = document.createElement('button'), cancel = document.createElement('button');
  copy.type = cancel.type = 'button'; copy.textContent = '复制'; cancel.textContent = '取消';
  copy.addEventListener('click', () => { const text = term.getSelection(); if (text) options.copyText(text); });
  cancel.addEventListener('click', () => { clear(); options.onCancelCopy?.(); });
  actions.append(copy, cancel); element.append(actions);
  const screen = () => element.querySelector<HTMLElement>('.xterm-screen')!;
  const metrics = () => { const rect = screen().getBoundingClientRect(); return { rect, width: rect.width / term.cols, height: rect.height / term.rows }; };
  const hide = () => { startHandle.hidden = endHandle.hidden = actions.hidden = true; };
  const dispatchMouse = (type: string, x: number, y: number, buttons: number) => {
    replayingTap = true;
    try { screen().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1, button: 0, buttons, clientX: x, clientY: y })); }
    finally { replayingTap = false; }
  };
  const stopGesture = () => {
    const current = gesture; gesture = undefined;
    if (current?.mode === 'native') dispatchMouse('mouseup', current.lastX, current.lastY, 0);
    if (current && element.hasPointerCapture(current.id)) element.releasePointerCapture(current.id);
  };
  const clear = () => { stopGesture(); if (ownedSelection || options.copyMode()) { ownedSelection = false; term.clearSelection(); } hide(); };
  const point = (x: number, y: number) => {
    const { rect, width, height } = metrics(), buffer = term.buffer.active;
    let col = Math.max(0, Math.min(term.cols - 1, Math.floor((x - rect.left) / width)));
    const row = Math.max(0, Math.min(buffer.length - 1, buffer.viewportY + Math.max(0, Math.min(term.rows - 1, Math.floor((y - rect.top) / height)))));
    const line = buffer.getLine(row);
    while (col > 0 && line?.getCell(col)?.getWidth() === 0) col--;
    return { row, col, start: row * term.cols + col, end: row * term.cols + col + Math.max(1, line?.getCell(col)?.getWidth() || 1) };
  };
  const selectRange = (a: number, b: number) => {
    const start = Math.max(0, Math.min(a, b)), end = Math.min(term.buffer.active.length * term.cols, Math.max(a, b));
    ownedSelection = true;
    term.select(start % term.cols, Math.floor(start / term.cols), Math.max(1, end - start));
    renderControls();
  };
  const selectWord = () => {
    if (!gesture || gesture.mode !== 'pending') return;
    const p = point(gesture.x, gesture.y), line = term.buffer.active.getLine(p.row);
    let start = p.col, end = p.end - p.row * term.cols;
    const word = (col: number) => /[\p{L}\p{N}_]/u.test(line?.getCell(col)?.getChars() || '');
    if (word(p.col)) {
      while (start > 0 && (line?.getCell(start - 1)?.getWidth() === 0 || word(start - 1))) start--;
      while (end < term.cols && (line?.getCell(end)?.getWidth() === 0 || word(end))) end++;
    }
    gesture.mode = 'select'; gesture.anchorStart = p.row * term.cols + start; gesture.anchorEnd = p.row * term.cols + end;
    selectRange(gesture.anchorStart, gesture.anchorEnd);
  };
  const renderControls = () => {
    const range = term.getSelectionPosition();
    // 原生模式查看本地历史时也可能由 xterm 建立选区，同样提供复制入口。
    const localCopy = options.copyMode();
    if ((!ownedSelection && !localCopy) || !range || !term.hasSelection()) { ownedSelection = false; hide(); return; }
    ownedSelection = true;
    const { rect, width, height } = metrics(), root = element.getBoundingClientRect(), viewport = term.buffer.active.viewportY;
    for (const [handle, pos] of [[startHandle, range.start], [endHandle, range.end]] as const) {
      const row = pos.y - viewport;
      handle.hidden = row < 0 || row >= term.rows;
      handle.style.left = `${Math.max(0, rect.left - root.left + pos.x * width - 20)}px`;
      handle.style.top = `${rect.top - root.top + Math.min(rect.height - 44, (row + 1) * height)}px`;
    }
    actions.hidden = false;
    const host = element.parentElement!.getBoundingClientRect();
    const left = Math.max(rect.left, host.left), right = Math.min(rect.right, host.right, window.innerWidth);
    actions.style.left = `${Math.max(left, Math.min(right - actions.offsetWidth, rect.left + range.start.x * width)) - root.left}px`;
    const above = rect.top + (range.start.y - viewport) * height - actions.offsetHeight - 8;
    const actionTop = above >= rect.top ? above : rect.top + (range.end.y - viewport + 1) * height + 44;
    actions.style.top = `${Math.max(rect.top, Math.min(rect.bottom - actions.offsetHeight, actionTop)) - root.top}px`;
  };
  const down = (event: PointerEvent) => {
    if ((event.target as Element).closest('.terminal-touch-actions')) return;
    lastPointerType = event.pointerType;
    const edge = (event.target as HTMLElement).closest<HTMLElement>('.terminal-selection-handle')?.dataset.edge as 'start' | 'end' | undefined;
    if (event.pointerType !== 'touch' && !edge) { clear(); return; }
    if (event.pointerType === 'touch') touches.add(event.pointerId);
    if (touches.size > 1) { clear(); return; }
    stopGesture(); event.preventDefault(); event.stopImmediatePropagation();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, remainder: 0, startedAt: window.performance.now(), mode: 'pending', offsetX: 0, offsetY: 0 };
    element.setPointerCapture(event.pointerId);
    const range = term.getSelectionPosition();
    if (edge && range) {
      const { rect, width, height } = metrics(), pos = edge === 'start' ? range.start : range.end;
      gesture.mode = 'select'; gesture.edge = edge;
      gesture.anchorStart = range.start.y * term.cols + range.start.x; gesture.anchorEnd = range.end.y * term.cols + range.end.x;
      gesture.offsetX = event.clientX - (rect.left + pos.x * width + (edge === 'start' ? .1 : -.1));
      gesture.offsetY = event.clientY - (rect.top + (pos.y - term.buffer.active.viewportY + .5) * height);
      return;
    }
    const bar = (event.target as Element).closest<HTMLElement>('.scrollbar.vertical');
    if (!options.copyMode() && bar && term.buffer.active.type === 'normal' && term.buffer.active.baseY > 0) {
      gesture.mode = 'bar'; gesture.bar = { viewport: term.buffer.active.viewportY, travel: Math.max(1, bar.clientHeight - (bar.querySelector<HTMLElement>('.slider')?.offsetHeight || 0)), lines: term.buffer.active.baseY };
    } else if (options.copyMode() && options.selectionMode?.() === 'native') {
      gesture.mode = 'native'; dispatchMouse('mousedown', event.clientX, event.clientY, 1);
    } else if (options.copyMode()) selectWord();
  };
  const move = (event: PointerEvent) => {
    if (!gesture) { lastPointerType = event.pointerType; return; }
    if (event.pointerId !== gesture.id) return;
    if (gesture.mode === 'native') {
      gesture.lastX = event.clientX; gesture.lastY = event.clientY;
      event.preventDefault(); event.stopImmediatePropagation();
      dispatchMouse('mousemove', event.clientX, event.clientY, 1); return;
    }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (gesture.mode === 'pending') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 7) return;
      if (ownedSelection) { ownedSelection = false; term.clearSelection(); hide(); }
      gesture.mode = Math.abs(dx) > Math.abs(dy) ? 'scroll-x' : 'scroll-y';
    }
    if (gesture.mode === 'scroll-x') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (gesture.mode === 'select') {
      const p = point(event.clientX - gesture.offsetX, event.clientY - gesture.offsetY);
      if (gesture.edge === 'start') selectRange(p.start, gesture.anchorEnd!);
      else if (gesture.edge === 'end') selectRange(gesture.anchorStart!, p.end);
      else selectRange(Math.min(gesture.anchorStart!, p.start), Math.max(gesture.anchorEnd!, p.end));
      return;
    }
    if (gesture.mode === 'bar') {
      const bar = gesture.bar!;
      term.scrollToLine(Math.max(0, Math.min(bar.lines, Math.round(bar.viewport + dy * bar.lines / bar.travel)))); return;
    }
    const { height } = metrics();
    gesture.remainder += (gesture.lastY - event.clientY) / height; gesture.lastY = event.clientY;
    const lines = Math.trunc(gesture.remainder); gesture.remainder -= lines;
    if (!lines) return;
    if (term.buffer.active.type === 'normal' && term.buffer.active.baseY > 0) term.scrollLines(lines);
    else if (term.modes.mouseTrackingMode !== 'none') {
      for (let i = 0; i < Math.min(40, Math.abs(lines)); i++) screen().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 1, deltaY: Math.sign(lines), clientX: event.clientX, clientY: event.clientY }));
    } else if (term.buffer.active.type === 'alternate') options.sendScrollInput(arrowSequence(lines < 0 ? 'up' : 'down', term.modes.applicationCursorKeysMode).repeat(Math.min(40, Math.abs(lines))));
  };
  const up = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (!gesture || event.pointerId !== gesture.id) return;
    const tap = gesture.mode === 'pending' && window.performance.now() - gesture.startedAt < 450;
    if (gesture.mode === 'native') { gesture.lastX = event.clientX; gesture.lastY = event.clientY; }
    stopGesture();
    event.preventDefault(); event.stopImmediatePropagation();
    if (!tap) return;
    if (ownedSelection) { clear(); return; }
    // 只回放一次短按；浏览器随后生成的兼容鼠标事件由下面的 guard 拦截。
    dispatchMouse('mousedown', event.clientX, event.clientY, 1);
    dispatchMouse('mouseup', event.clientX, event.clientY, 0);
  };
  const cancelPointer = (event: PointerEvent) => { touches.delete(event.pointerId); if (gesture?.id === event.pointerId) stopGesture(); };
  const guardMouse = (event: MouseEvent) => {
    if (replayingTap || (event.type === 'click' && (event.target as Element).closest('.terminal-touch-actions'))) return;
    const compatibility = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities?.firesTouchEvents;
    if (compatibility || lastPointerType === 'touch' || (event.target as Element).closest('.terminal-selection-handle,.terminal-touch-actions')) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const guardTouch = (event: TouchEvent) => {
    if ((event.target as Element).closest('.terminal-touch-actions')) return;
    event.stopImmediatePropagation();
    if (event.touches.length > 1) { clear(); return; }
    if (gesture && !['pending', 'scroll-x'].includes(gesture.mode)) event.preventDefault();
  };
  const context = (event: Event) => { if (lastPointerType === 'touch') { event.preventDefault(); event.stopImmediatePropagation(); } };
  element.addEventListener('pointerdown', down, true); element.addEventListener('pointermove', move, true); element.addEventListener('pointerup', up, true);
  element.addEventListener('pointercancel', cancelPointer, true); element.addEventListener('lostpointercapture', cancelPointer, true);
  for (const type of ['mousedown', 'mousemove', 'mouseup', 'click'] as const) element.addEventListener(type, guardMouse, true);
  for (const type of ['touchstart', 'touchmove', 'touchend'] as const) element.addEventListener(type, guardTouch, { capture: true, passive: false });
  element.addEventListener('contextmenu', context, true); window.addEventListener('blur', stopGesture);
  const changed = term.onSelectionChange(renderControls), rendered = term.onRender(renderControls), scrolled = term.onScroll(renderControls);
  return { cancel() { clear(); updateAction(); }, dispose() {
    clear(); touches.clear(); changed.dispose(); rendered.dispose(); scrolled.dispose(); element.style.touchAction = oldAction;
    element.removeEventListener('pointerdown', down, true); element.removeEventListener('pointermove', move, true); element.removeEventListener('pointerup', up, true);
    element.removeEventListener('pointercancel', cancelPointer, true); element.removeEventListener('lostpointercapture', cancelPointer, true);
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'click'] as const) element.removeEventListener(type, guardMouse, true);
    for (const type of ['touchstart', 'touchmove', 'touchend'] as const) element.removeEventListener(type, guardTouch, true);
    element.removeEventListener('contextmenu', context, true); window.removeEventListener('blur', stopGesture);
    startHandle.remove(); endHandle.remove(); actions.remove();
  } };
}
