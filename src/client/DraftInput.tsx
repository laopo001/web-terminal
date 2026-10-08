import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { HTMLAttributes } from 'react';

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children'> & {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

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
