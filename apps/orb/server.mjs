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
const MODEL = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2.1';
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
 * Exchange the browser's SDP offer for an answer.
 *
 * Two hops, both of which changed when the Realtime beta was shut down in
 * May 2026 and none of which are guessable from the old shape:
 *
 *   1. mint an ephemeral client secret     POST /v1/realtime/client_secrets
 *      body {session:{type,model,audio}}, key read off `data.value`
 *   2. exchange the SDP with that secret   POST /v1/realtime/calls
 *      no ?model= query parameter; the model is set in step 1
 *
 * The old route was POST /v1/realtime?model=... with the API key and an
 * `openai-beta: realtime=v1` header. That header has been dead since
 * 2026-05-12 and the endpoint no longer exists, so the previous version of
 * this file could not have connected once.
 */
async function mintClientSecret() {
  const r = await fetch(`${BASE}/v1/realtime/client_secrets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: MODEL,
        audio: { output: { voice: VOICE } },
      },
    }),
  });
  const body = await r.text();
  if (!r.ok) throw Object.assign(new Error(body), { status: r.status });
  const data = JSON.parse(body);
  const value = data.value ?? data?.client_secret?.value;
  if (!value) throw Object.assign(new Error('no client secret in response: ' + body.slice(0, 300)), { status: 502 });
  return value;
}

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

  let secret;
  try {
    secret = await mintClientSecret();
  } catch (err) {
    console.error('[orb] could not mint a client secret:', err.status ?? '', String(err.message).slice(0, 400));
    return send(res, err.status ?? 502, String(err.message));
  }

  const upstream = await fetch(`${BASE}/v1/realtime/calls`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/sdp' },
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
