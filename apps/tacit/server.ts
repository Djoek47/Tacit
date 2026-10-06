/**
 * The Tacit server: the web app, and the world without the key.
 *
 *   WORLDMONITOR_API_KEY=… node apps/tacit/server.mjs     → http://127.0.0.1:7373
 *
 * It listens on this machine only. Putting it on the internet comes with sign-in,
 * which is the next piece; until then nothing here should face the open web.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldMonitorFetch, worldMonitorSource, type WorldSource } from '../../packages/notify/src/index.js';
import { worldRoute } from '../../packages/tacit/src/world.js';

const here = dirname(fileURLToPath(import.meta.url));
const key = process.env.WORLDMONITOR_API_KEY ?? '';
const port = Number(process.env.PORT ?? 7373);

const sources: WorldSource[] = key ? [worldMonitorSource(worldMonitorFetch(key))] : [];
const world = worldRoute({ sources, secrets: [key] });
const page = () => readFileSync(join(here, 'index.html'));

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  try {
    if (req.method === 'GET' && url.pathname === '/api/world') {
      if (!key) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ items: [], refreshedAt: null, errors: ['no World Monitor key on this server'] })); return; }
      const topics = url.searchParams.get('topics')?.split(',').filter(Boolean) ?? [];
      const r = await world({ topics });
      res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(r.body));
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page()); return;
    }
    res.writeHead(404); res.end('not here');
  } catch (e) {
    res.writeHead(500); res.end('something broke; the details are in the server log');
    console.error(String((e as Error).message).split(key || '\u0000').join('[key]'));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Tacit on http://127.0.0.1:${port}  (world: ${key ? 'World Monitor' : 'none — set WORLDMONITOR_API_KEY'})`);
});
