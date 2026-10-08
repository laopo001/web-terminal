import type { Terminal } from '@xterm/xterm';

export function isFocusReport(data: string): boolean {
  return data === '\x1b[I' || data === '\x1b[O';
}

export function isMouseReport(data: string): boolean {
  return /^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data) || /^\x1b\[M[\s\S]{3}$/.test(data);
}

/** 普通缓冲区滚动本地历史，全屏缓冲区继续交给应用处理。 */
export function preferScrollback(term: Terminal) {
  const element = term.element!;
  let remainder = 0;
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.shiftKey || !event.deltaY || term.buffer.active.type !== 'normal' || term.buffer.active.baseY === 0) return;
    const height = element.querySelector<HTMLElement>('.xterm-screen')?.offsetHeight || term.rows * 17;
    const lines = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * term.rows : event.deltaY / (height / term.rows);
    remainder += lines;
    const scroll = Math.trunc(remainder); remainder -= scroll;
    event.preventDefault(); event.stopImmediatePropagation();
    if (scroll) term.scrollLines(scroll);
  };
  element.addEventListener('wheel', wheel, { capture: true, passive: false });
  return { dispose() { element.removeEventListener('wheel', wheel, true); } };
}

/** 应用鼠标模式交给 CLI 原生处理；Shift（Mac Option）保留 xterm 本地选择。 */
export function preferTextSelection(term: Terminal) {
  const element = term.element!;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const previous = term.options.macOptionClickForcesSelection;
  if (mac) term.options.macOptionClickForcesSelection = true;
  const selectHistory = (event: MouseEvent) => {
    if ((event.target as Element).closest('.scrollbar')) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || term.modes.mouseTrackingMode === 'none') return;
    // 本地历史没有对应的远端位置，点击和拖选只作用于本地。
    if (term.buffer.active.viewportY < term.buffer.active.baseY) Object.defineProperty(event, mac ? 'altKey' : 'shiftKey', { value: true });
  };
  const preserveSelection = (event: MouseEvent) => {
    // ANY 悬停报告会被当作输入，既会清空本地选区，也会把本地历史滚回底部。
    if (!event.buttons && (term.hasSelection() || term.buffer.active.viewportY < term.buffer.active.baseY)) event.stopImmediatePropagation();
  };
  element.addEventListener('mousedown', selectHistory, true);
  element.addEventListener('mousemove', preserveSelection, true);
  return { dispose() {
    element.removeEventListener('mousedown', selectHistory, true);
    element.removeEventListener('mousemove', preserveSelection, true);
    if (mac) term.options.macOptionClickForcesSelection = previous;
  } };
}
