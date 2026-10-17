/**
 * Tacit on your own computer: the same page and the same handler as on Vercel.
 *   npm run tacit   →  http://127.0.0.1:7373
 * Keys come from environment variables, or each browser brings its own in Settings.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './api.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 7373);
const env = { ...process.env, TACIT_LOCAL: '1' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  try {
    if (!url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(join(here, 'public', 'index.html')));
      return;
    }
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 200_000) throw new Error('too large'); }
    const out = await handle({ method: req.method ?? 'GET', path: url.pathname.slice(5), headers: req.headers, body: raw ? JSON.parse(raw) : {} }, env);
    res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(out.body));
  } catch {
    res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"something broke"}');
  }
}).listen(port, '127.0.0.1', () => console.log(`\n  Tacit is running:  http://127.0.0.1:${port}\n`));
