export interface PathMatch { path: string; start: number; end: number }

const imageExt = /\.(?:png|jpe?g|webp|gif|bmp|svg|avif)$/i;
const pathExt = /\.[a-z0-9]{1,12}$/i;

export function isImagePath(path: string): boolean { return imageExt.test(path.split(/[?#]/, 1)[0]); }

export function isTextPath(path: string): boolean {
  return /\.(?:txt|md|mdx|markdown|log|json|jsonl|ya?ml|toml|ini|conf|cfg|csv|tsv|tsx?|jsx?|mjs|cjs|html?|css|scss|less|py|sh|bash|zsh|ps1|sql|xml|rs|go|java|kt|c|h|cpp|hpp|cs|rb|php|vue|svelte)$/i.test(path);
}

/** Parse one terminal logical line. Caller may join adjacent wrapped rows. */
export function findPaths(text: string): PathMatch[] {
  const matches: PathMatch[] = [];
  const seen = new Set<string>();
  const starts = /(?:^|[\s([:：])((?:file:\/\/)?\/(?:[^\s<>|`]+)|(?:~\/|\.\.?\/)[^\s<>|`]+|(?:[\w\u3400-\u9fff.-]+\/)[^\s<>|`]+)/gu;
  for (const m of text.matchAll(starts)) {
    let raw = m[1];
    let start = (m.index ?? 0) + m[0].lastIndexOf(raw);
    const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : '';
    if (quote) { raw = raw.slice(1); start++; }
    let end = start + raw.length;
    const trailing = /[),.;:，。；：!?！？\]}'"]+$/u.exec(raw)?.[0] ?? '';
    raw = raw.slice(0, raw.length - trailing.length);
    end -= trailing.length;
    if (raw.startsWith('file://')) { raw = raw.slice(7); try { raw = decodeURIComponent(raw); } catch { /* 保留包含字面百分号的路径 */ } start += 7; }
    if (!raw || !pathExt.test(raw) || seen.has(`${start}:${end}`)) continue;
    seen.add(`${start}:${end}`); matches.push({ path: raw, start, end });
  }
  // Quoted paths may contain spaces and take precedence over unquoted fragments.
  for (const m of text.matchAll(/(["'])(\/?(?:\.{1,2}\/)?[^\r\n]+?)\1/gu)) {
    const path = m[2];
    if (!pathExt.test(path) || (!path.includes('/') && !path.startsWith('.'))) continue;
    const start = (m.index ?? 0) + 1, end = start + path.length;
    for (let i = matches.length - 1; i >= 0; i--) if (matches[i].start >= start && matches[i].end <= end) matches.splice(i, 1);
    matches.push({ path, start, end });
  }
  return matches.sort((a, b) => a.start - b.start);
}

export function unwrapTerminalRows(rows: string[], wrapped: boolean[]): string {
  let result = '';
  rows.forEach((row, index) => { if (index && !wrapped[index]) result += '\n'; result += row; });
  return result;
}

export function quoteForShell(path: string): string {
  return /^[a-zA-Z0-9_./:-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}
