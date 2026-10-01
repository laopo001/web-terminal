export function pasteText(text: string, bracketedPaste: boolean): string {
  const normalized = text.replace(/\r?\n/g, '\r');
  return bracketedPaste ? `\x1b[200~${normalized}\x1b[201~` : normalized;
}

/** Enter 在粘贴结束标记之外，TUI 才会将其识别为提交。 */
export function draftSubmission(text: string, bracketedPaste: boolean): string {
  return pasteText(text, bracketedPaste) + '\r';
}
