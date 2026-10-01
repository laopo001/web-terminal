export function arrowSequence(direction: 'up' | 'down' | 'left' | 'right', applicationMode: boolean): string {
  const suffix = { up: 'A', down: 'B', left: 'D', right: 'C' }[direction];
  return `\x1b${applicationMode ? 'O' : '['}${suffix}`;
}
