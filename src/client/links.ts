import type { Terminal, ILink, ILinkProvider } from '@xterm/xterm';
import { findPaths, isImagePath } from './paths';

/** Map UTF-16 string offsets to terminal cell columns, including wide and combined glyphs. */
export function terminalLineMap(term: Terminal, first: number, last: number) {
  const buffer = term.buffer.active;
  let text = '';
  const positions: { x: number; y: number }[] = [];
  for (let row = first; row <= last; row++) {
    const line = buffer.getLine(row); if (!line) continue;
    for (let col = 0; col < line.length; col++) {
      const cell = line.getCell(col); if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || ' ';
      for (let i = 0; i < chars.length; i++) positions.push({ x: col + 1, y: row + 1 });
      text += chars;
    }
  }
  return { text, positions };
}
export function pathLinkProvider(term: Terminal, handlers: {
  activate: (path: string, base: string) => void;
  hover: (path: string, base: string, point: { x: number; y: number }) => void;
  leave: () => void;
  base: (row: number) => string;
}): ILinkProvider {
  return { provideLinks(lineNumber, callback) {
    const buffer = term.buffer.active;
    if (!buffer.getLine(lineNumber - 1)) { callback([]); return; }
    let first = lineNumber - 1, last = first;
    while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
    while (buffer.getLine(last + 1)?.isWrapped) last++;
    const { text, positions } = terminalLineMap(term, first, last);
    const links: ILink[] = [];
    for (const match of findPaths(text)) {
      const start = positions[match.start], lastChar = positions[match.end - 1];
      if (!start || !lastChar) continue;
      const lastCell = buffer.getLine(lastChar.y - 1)?.getCell(lastChar.x - 1);
      const end = { x: lastChar.x + Math.max(1, lastCell?.getWidth() ?? 1) - 1, y: lastChar.y };
      const base = handlers.base(start.y - 1);
      links.push({ text: match.path, range: { start, end }, activate: () => handlers.activate(match.path, base), hover: event => {
        if (isImagePath(match.path)) handlers.hover(match.path, base, { x: event.clientX, y: event.clientY });
      }, leave: handlers.leave });
    }
    callback(links);
  } };
}
