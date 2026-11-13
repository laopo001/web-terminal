import { parseExternalUrl, parseFileUriPath } from '../shared/externalUrl';

export interface PathMatch { path: string; start: number; end: number }
export interface UrlMatch { url: string; start: number; end: number }
export type TerminalLink =
  | ({ kind: 'path'; path: string } & { start: number; end: number })
  | ({ kind: 'url'; url: string } & { start: number; end: number });

const imageExt = /\.(?:png|jpe?g|webp|gif|bmp|svg|avif)$/i;
const pathExt = /\.[a-z0-9]{1,12}$/i;

const CJK_STOP_PUNCT = '，。；：！？（）【】「」《》、〈〉『』〔〕“”‘’';
const URL_BODY = `[^\\s<>|"'` + '`' + `${CJK_STOP_PUNCT}]+`;
const PATH_BODY = `[^\\s<>|` + '`' + `${CJK_STOP_PUNCT}]+`;
const NON_FILE_SCHEME_RE = new RegExp(`(?:^|[^a-zA-Z0-9+.-])([a-zA-Z][a-zA-Z0-9+.-]*:\\/\\/${URL_BODY})`, 'gu');
const MAILTO_RE = /(?:^|[^a-zA-Z0-9+.-])(mailto:[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/giu;
const PATH_START_RE = new RegExp(
  `(?:^|[\\s(["'（:：=])((?:file:\\/\\/[^/\\s<>|` + '`' + `]*\\/|\\/)${PATH_BODY}|(?:~\\/|\\.\\.?\\/)${PATH_BODY}|(?:[\\w\\u3400-\\u9fff.-]+\\/)${PATH_BODY})`,
  'gu',
);

const CLOSE_TO_OPEN: Record<string, string> = {
  ')': '(', ']': '[', '}': '{', '）': '（', '】': '【', '」': '「', '》': '《',
};
const TRAILING_PUNCT = /[,.;:，。；：!?！？'"`、\s]$/;

function countChar(text: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === ch) count++;
  return count;
}

function trimLinkEnd(raw: string): string {
  let value = raw;
  while (value.length > 0) {
    const last = value[value.length - 1];
    if (TRAILING_PUNCT.test(last)) {
      value = value.slice(0, -1);
      continue;
    }
    const open = CLOSE_TO_OPEN[last];
    if (open && countChar(value, last) > countChar(value, open)) {
      value = value.slice(0, -1);
      continue;
    }
    break;
  }
  return value;
}

interface TextSpan { raw: string; start: number; end: number }

function findNonFileUriSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const m of text.matchAll(NON_FILE_SCHEME_RE)) {
    const raw = trimLinkEnd(m[1]);
    if (!raw || /^file:\/\//i.test(raw)) continue;
    const start = (m.index ?? 0) + (m[0].length - m[1].length);
    spans.push({ raw, start, end: start + raw.length });
  }
  for (const m of text.matchAll(MAILTO_RE)) {
    const raw = m[1];
    const start = (m.index ?? 0) + (m[0].length - raw.length);
    const end = start + raw.length;
    if (spans.some(span => start < span.end && end > span.start)) continue;
    spans.push({ raw, start, end });
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function isImagePath(path: string): boolean { return imageExt.test(path.split(/[?#]/, 1)[0]); }

export function isTextPath(path: string): boolean {
  return /\.(?:txt|md|mdx|markdown|log|json|jsonl|ya?ml|toml|ini|conf|cfg|csv|tsv|tsx?|jsx?|mjs|cjs|html?|css|scss|less|py|sh|bash|zsh|ps1|sql|xml|rs|go|java|kt|c|h|cpp|hpp|cs|rb|php|vue|svelte)$/i.test(path);
}

export function findUrls(text: string): UrlMatch[] {
  const matches: UrlMatch[] = [];
  for (const span of findNonFileUriSpans(text)) {
    if (!parseExternalUrl(span.raw)) continue;
    matches.push({ url: span.raw, start: span.start, end: span.end });
  }
  return matches;
}

function resolveMatchedPath(raw: string, requireSlashOrDot: boolean): string | null {
  if (/^file:\/\//i.test(raw)) return parseFileUriPath(raw);
  if (!pathExt.test(raw)) return null;
  if (requireSlashOrDot && !raw.includes('/') && !raw.startsWith('.')) return null;
  return raw;
}

/** Parse one terminal logical line. Caller may join adjacent wrapped rows. */
export function findPaths(text: string): PathMatch[] {
  const matches: PathMatch[] = [];
  const seen = new Set<string>();
  const uriSpans = findNonFileUriSpans(text);
  const overlapsUri = (start: number, end: number) => uriSpans.some(span => start < span.end && end > span.start);

  for (const m of text.matchAll(PATH_START_RE)) {
    const matched = m[1];
    const start = (m.index ?? 0) + (m[0].length - matched.length);
    const raw = trimLinkEnd(matched);
    if (!raw) continue;
    const end = start + raw.length;
    if (overlapsUri(start, end)) continue;

    const path = resolveMatchedPath(raw, false);
    if (!path || seen.has(`${start}:${end}`)) continue;
    seen.add(`${start}:${end}`);
    matches.push({ path, start, end });
  }
  // Quoted paths may contain spaces and take precedence over unquoted fragments.
  for (const m of text.matchAll(/(["'])((?:file:\/\/[^/\r\n]*\/|\/?(?:\.{1,2}\/)?)[^\r\n]+?)\1/gu)) {
    const raw = m[2];
    const start = (m.index ?? 0) + 1;
    const end = start + raw.length;
    if (overlapsUri(start, end)) continue;

    const path = resolveMatchedPath(raw, true);
    if (!path) continue;

    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i].start >= start && matches[i].end <= end) matches.splice(i, 1);
    }
    matches.push({ path, start, end });
  }
  return matches.sort((a, b) => a.start - b.start);
}

export function findLinks(text: string): TerminalLink[] {
  const urls = findUrls(text).map((item): TerminalLink => ({ kind: 'url', ...item }));
  const paths = findPaths(text).map((item): TerminalLink => ({ kind: 'path', ...item }));
  return [...urls, ...paths].sort((a, b) => a.start - b.start);
}

export function unwrapTerminalRows(rows: string[], wrapped: boolean[]): string {
  let result = '';
  rows.forEach((row, index) => { if (index && !wrapped[index]) result += '\n'; result += row; });
  return result;
}

export function quoteForShell(path: string): string {
  return /^[a-zA-Z0-9_./:-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}
