import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { HTMLAttributes } from 'react';

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children'> & {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

/** 按实际显示行判断，包含自动折行；选中文字时保留原生方向键行为。 */
export function isDraftHistoryBoundary(element: HTMLDivElement, direction: 'up' | 'down'): boolean {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return false;
  if (!element.innerText) return true;
  let caret = range.getBoundingClientRect();
  const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
  let marker: HTMLSpanElement | undefined;
  let probe: Range | undefined;
  // contenteditable 的空行或元素节点边界可能没有 caret rect。
  if (!caret.height || prefix.toString().endsWith('\n')) {
    marker = document.createElement('span'); marker.textContent = '\u200b';
    probe = range.cloneRange(); probe.insertNode(marker);
    caret = marker.getBoundingClientRect();
  }
  const css = getComputedStyle(element);
  const lineHeight = parseFloat(css.lineHeight);
  const top = element.getBoundingClientRect().top + element.clientTop - element.scrollTop;
  const boundary = direction === 'up'
    ? caret.top < top + parseFloat(css.paddingTop) + lineHeight
    : caret.bottom > top + element.scrollHeight - parseFloat(css.paddingBottom) - lineHeight;
  if (marker && probe) {
    probe.setStartBefore(marker); probe.collapse(true);
    selection.removeAllRanges(); selection.addRange(probe);
    marker.remove(); element.normalize();
  }
  return boundary;
}

/** 命令草稿是纯文本编辑区，不作为密码、付款或地址表单字段。 */
export const DraftInput = forwardRef<HTMLDivElement, Props>(function DraftInput({ value, onChange, placeholder, ...props }, ref) {
  const editor = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => editor.current!);
  useLayoutEffect(() => {
    const element = editor.current!;
    if (element.innerText === value && (value || !element.firstChild)) return;
    element.textContent = value;
    if (document.activeElement === element) {
      const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    }
  }, [value]);
  return <div {...props} ref={editor} className="draft-input" role="textbox" aria-multiline="true"
    aria-autocomplete="none" aria-placeholder={placeholder} data-placeholder={placeholder}
    contentEditable="plaintext-only" suppressContentEditableWarning enterKeyHint="send"
    autoCorrect="off" autoCapitalize="off" spellCheck={false}
    onInput={event => onChange(event.currentTarget.textContent ? event.currentTarget.innerText : '')} />;
});
