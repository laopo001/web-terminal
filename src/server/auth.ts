import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function validToken(candidate: unknown, token: string): boolean {
  if (typeof candidate !== 'string' || candidate.length > 1024) return false;
  const hash = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(hash(candidate), hash(token));
}
export function authenticate(token: string): RequestHandler {
  const failures = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const key = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    for (const [ip, failure] of failures) if (failure.until < now) failures.delete(ip);
    const failure = failures.get(key);
    if (failure && failure.count >= 30) { res.status(429).json({ error: '尝试过于频繁，请稍后再试' }); return; }
    if (!validToken(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1], token)) {
      failures.set(key, { count: (failure?.count || 0) + 1, until: failure?.until || now + 60_000 });
      res.status(401).json({ error: 'token 无效，请重新输入' }); return;
    }
    failures.delete(key);
    next();
  };
}
