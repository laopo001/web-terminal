export function arrowSequence(direction: 'up' | 'down' | 'left' | 'right', applicationMode: boolean): string {
  const suffix = { up: 'A', down: 'B', left: 'D', right: 'C' }[direction];
  return `\x1b${applicationMode ? 'O' : '['}${suffix}`;
}

/** Enter 必须在粘贴结束标记之外，TUI 才会将它作为提交键。 */
export function draftSubmission(text: string, bracketedPaste: boolean): string {
  const normalized = text.replace(/\r?\n/g, '\r');
  return (bracketedPaste ? `\x1b[200~${normalized}\x1b[201~` : normalized) + '\r';
}
