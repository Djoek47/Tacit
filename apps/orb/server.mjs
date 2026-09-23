#!/usr/bin/env node
/**
 * The only piece that needs a secret.
 *
 * The browser cannot hold an API key, so it sends its WebRTC offer here and we
 * exchange it with OpenAI using the key from the environment. The key never
 * reaches the client, and this process does nothing else — no model calls, no
 * business logic, no state. Everything that decides anything runs in the page.
 *
 *   OPENAI_API_KEY=sk-... node apps/orb/server.mjs
 *   open http://localhost:8787
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8787);
const KEY = process.env.OPENAI_API_KEY ?? '';
const BASE = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com').replace(/\/$/, '');
const MODEL = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime';
const VOICE = process.env.OPENAI_VOICE ?? 'cedar';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Exchange the browser's SDP offer for an answer. Same shape as the route in
 * Creatix (`app/api/ai/mimic-test-realtime`), minus the auth and the database.
 */
async function realtime(req, res) {
  if (!KEY.startsWith('sk-')) {
    return send(res, 503, 'Set OPENAI_API_KEY (an sk-... key) before starting the server.');
  }
  let sdp;
  try {
    sdp = await readBody(req);
  } catch (err) {
    return send(res, 413, String(err.message));
  }
  if (!sdp.trim()) return send(res, 400, 'Missing SDP offer.');

  const url = `${BASE}/v1/realtime?model=${encodeURIComponent(MODEL)}&voice=${encodeURIComponent(VOICE)}`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/sdp',
      'openai-beta': 'realtime=v1',
    },
    body: sdp,
  });

  const answer = await upstream.text();
  if (!upstream.ok) {
    console.error('[orb] realtime refused:', upstream.status, answer.slice(0, 400));
    return send(res, upstream.status, answer);
  }
  send(res, 200, answer, 'application/sdp');
}

async function serveStatic(req, res) {
  const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = normalize(raw === '/' ? '/index.html' : raw).replace(/^(\.\.[/\\])+/, '');
  const file = join(HERE, rel);
  if (!file.startsWith(HERE)) return send(res, 403, 'no');
  try {
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'not found');
  }
}

createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url?.startsWith('/realtime')) return await realtime(req, res);
    if (req.method === 'GET' && req.url?.startsWith('/health')) {
      return send(res, 200, JSON.stringify({ ok: KEY.startsWith('sk-'), model: MODEL, voice: VOICE }),
        'application/json; charset=utf-8');
    }
    if (req.method === 'GET') return await serveStatic(req, res);
    send(res, 405, 'method not allowed');
  } catch (err) {
    console.error('[orb]', err);
    send(res, 500, 'server error');
  }
}).listen(PORT, () => {
  console.log(`[orb] http://localhost:${PORT}`);
  console.log(`[orb] model ${MODEL}, voice ${VOICE}`);
  if (!KEY.startsWith('sk-')) console.log('[orb] no OPENAI_API_KEY — the page will load but the mic will not connect');
});
