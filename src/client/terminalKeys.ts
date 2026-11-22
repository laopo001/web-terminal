export type MobileKeyId = 'tab' | 'slash' | 'left' | 'up' | 'down' | 'right';

export const MOBILE_TERMINAL_KEYS: readonly { id: MobileKeyId; label: string; title?: string; ariaLabel?: string }[] = [
  { id: 'tab', label: 'Tab' },
  { id: 'slash', label: '/', title: '发送 /' },
  { id: 'left', label: '←', title: '左方向键', ariaLabel: '左方向键' },
  { id: 'up', label: '↑', title: '上方向键', ariaLabel: '上方向键' },
  { id: 'down', label: '↓', title: '下方向键', ariaLabel: '下方向键' },
  { id: 'right', label: '→', title: '右方向键', ariaLabel: '右方向键' },
];

export function arrowSequence(direction: 'up' | 'down' | 'left' | 'right', applicationMode: boolean): string {
  const suffix = { up: 'A', down: 'B', left: 'D', right: 'C' }[direction];
  return `\x1b${applicationMode ? 'O' : '['}${suffix}`;
}

export function mobileKeySequence(id: MobileKeyId, applicationMode: boolean): string {
  if (id === 'tab') return '\t';
  if (id === 'slash') return '/';
  return arrowSequence(id, applicationMode);
}
