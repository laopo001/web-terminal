import { useEffect } from 'react';
import type { Terminal } from '@xterm/xterm';

function isEditingField(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  return element instanceof HTMLInputElement && !element.readOnly && !element.disabled
    && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'range', 'color'].includes(element.type);
}

/** 点击非输入区域时结束编辑；不阻止按钮获得正常的键盘导航焦点。 */
export function useInputFocusPolicy() {
  useEffect(() => {
    const leaveEditing = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (isEditingField(target?.closest('input,textarea,[contenteditable]') ?? null)) return;
      const active = document.activeElement;
      const button = target?.closest('button');
      // 桌面标签拖动需要浏览器默认的 pointerdown；触屏继续延后收起键盘。
      const nativeDrag = target?.closest('[draggable="true"]') && event instanceof PointerEvent && event.pointerType !== 'touch';
      // 抬手产生 click 后再结束编辑，避免键盘提前收起改变按钮位置。
      if (event.type === 'pointerdown' && button && !button.disabled && isEditingField(active) && !nativeDrag) {
        event.preventDefault(); return;
      }
      if (button?.closest('[data-preserve-input-focus]')) return;
      if (active?.matches('.xterm-helper-textarea') && target?.closest('.xterm')?.contains(active)) return;
      if (isEditingField(active)) active.blur();
    };
    document.addEventListener('pointerdown', leaveEditing, true);
    document.addEventListener('click', leaveEditing, true);
    return () => { document.removeEventListener('pointerdown', leaveEditing, true); document.removeEventListener('click', leaveEditing, true); };
  }, []);
}

/** 普通模式保留 xterm 输入；复制模式只允许非编辑的键盘焦点。 */
export function manageTerminalInputFocus(term: Terminal, copyMode: () => boolean) {
  const element = term.element!, textarea = term.textarea!;
  const previous = { readOnly: textarea.readOnly, inputMode: textarea.inputMode, tabIndex: element.getAttribute('tabindex') };
  element.tabIndex = 0;
  const update = () => {
    textarea.readOnly = copyMode() || previous.readOnly;
    textarea.inputMode = copyMode() ? 'none' : previous.inputMode;
    if (copyMode() && document.activeElement === textarea) textarea.blur();
  };
  update();
  const focus = (event: FocusEvent) => {
    if (!copyMode()) return;
    event.stopImmediatePropagation();
    textarea.blur(); element.focus({ preventScroll: true });
  };
  const blur = (event: FocusEvent) => { if (copyMode()) event.stopImmediatePropagation(); };
  textarea.addEventListener('focus', focus, true); textarea.addEventListener('blur', blur, true);
  const keyboard = (event: KeyboardEvent) => {
    if (event.target !== element || event.isComposing) return;
    const forwarded = new KeyboardEvent(event.type, {
      bubbles: true, cancelable: true, key: event.key, code: event.code, location: event.location,
      ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
      repeat: event.repeat, keyCode: event.keyCode, charCode: event.charCode,
    });
    textarea.dispatchEvent(forwarded);
    if (forwarded.defaultPrevented) { event.preventDefault(); event.stopPropagation(); }
  };
  for (const type of ['keydown', 'keypress', 'keyup'] as const) element.addEventListener(type, keyboard);
  return { update, dispose() {
    textarea.removeEventListener('focus', focus, true); textarea.removeEventListener('blur', blur, true);
    for (const type of ['keydown', 'keypress', 'keyup'] as const) element.removeEventListener(type, keyboard);
    textarea.readOnly = previous.readOnly; textarea.inputMode = previous.inputMode;
    if (previous.tabIndex === null) element.removeAttribute('tabindex'); else element.setAttribute('tabindex', previous.tabIndex);
  } };
}
