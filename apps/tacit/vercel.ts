// The Vercel function. Every /api/* request is rewritten here (see vercel.json).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from './api.js';

export default async function tacit(req: IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> }, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const q = req.query?.p ?? url.searchParams.get('p') ?? url.pathname.replace(/^\/api\/?/, '');
  const path = Array.isArray(q) ? q.join('/') : q;
  let body: Record<string, unknown> = {};
  if (req.body && typeof req.body === 'object') body = req.body as Record<string, unknown>;
  else if (typeof req.body === 'string' && req.body) { try { body = JSON.parse(req.body); } catch { /* empty */ } }
  const out = await handle({ method: req.method ?? 'GET', path, headers: req.headers, body }, process.env);
  res.statusCode = out.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(out.body));
}
