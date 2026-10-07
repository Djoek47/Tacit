/**
 * The Tacit server: the web app, your model, your connections, and the world.
 *
 *   npm run tacit            → http://127.0.0.1:7373
 *
 * It listens on this computer only. Keys you paste in Settings are kept in a
 * file only you can read (~/.tacit/config.json) and never sent back to the
 * page: the page learns that a model is connected, never what the key is.
 * Environment variables still work and win over the file:
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, WORLDMONITOR_API_KEY
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { worldMonitorFetch, worldMonitorSource, type WorldSource } from '../../packages/notify/src/index.js';
import { worldRoute } from '../../packages/tacit/src/world.js';
import { PROVIDERS, ModelError, answerPrompt, chat, phrasePrompt, summaryPrompt, type ModelConfig, type Msg, type Provider } from '../../packages/tacit/src/model.js';
import { classify } from '../../packages/mcp/src/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 7373);
const dir = join(homedir(), '.tacit');
const file = join(dir, 'config.json');

// ----------------------------------------------------------------- config

type McpEntry = { id: string; url: string; token?: string; approved: boolean; name?: string };
type Config = { model?: ModelConfig; worldKey?: string; mcp: McpEntry[] };

function load(): Config {
  try { const c = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>; return { ...c, mcp: c.mcp ?? [] }; } catch { return { mcp: [] }; }
}
function save(c: Config): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows: the file sits in the user's own profile */ }
}
let config = load();

const ENV_KEYS: Record<Provider, string | undefined> = {
  anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY, xai: process.env.XAI_API_KEY,
};
function model(): ModelConfig | null {
  if (config.model?.key) return config.model;
  for (const p of Object.keys(ENV_KEYS) as Provider[]) {
    const key = ENV_KEYS[p];
    if (key) return { provider: p, key, model: PROVIDERS[p].models[0]! };
  }
  return null;
}
const secrets = () => [config.model?.key, config.worldKey, process.env.WORLDMONITOR_API_KEY, ...Object.values(ENV_KEYS), ...config.mcp.map((m) => m.token)].filter(Boolean) as string[];
const scrub = (s: string) => secrets().reduce((t, k) => t.split(k).join('[key]'), s);

// ------------------------------------------------------------------ world

let world = buildWorld();
function buildWorld() {
  const key = process.env.WORLDMONITOR_API_KEY ?? config.worldKey ?? '';
  const sources: WorldSource[] = key ? [worldMonitorSource(worldMonitorFetch(key))] : [];
  return { key, get: worldRoute({ sources, secrets: [key] }) };
}

// -------------------------------------------------------------------- MCP

type Live = { client: Client; tools: { name: string; description?: string; annotations?: Record<string, unknown> }[] };
const live = new Map<string, Live>();

async function open(e: McpEntry): Promise<Live> {
  const have = live.get(e.id);
  if (have) return have;
  const headers = e.token ? { authorization: `Bearer ${e.token}` } : undefined;
  const url = new URL(e.url);
  if (!/^https?:$/.test(url.protocol)) throw new Error('only http and https servers can be connected');
  const client = new Client({ name: 'tacit', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, headers ? { requestInit: { headers } } : undefined));
  } catch {
    // Older servers speak SSE.
    const legacy = new Client({ name: 'tacit', version: '0.1.0' });
    await legacy.connect(new SSEClientTransport(url, headers ? { requestInit: { headers } } : undefined));
    return remember(e, legacy);
  }
  return remember(e, client);
}
async function remember(e: McpEntry, client: Client): Promise<Live> {
  const tools: Live['tools'] = [];
  let cursor: string | undefined;
  do { const page = await client.listTools(cursor ? { cursor } : {}); tools.push(...(page.tools as Live['tools'])); cursor = page.nextCursor; } while (cursor);
  const l = { client, tools };
  live.set(e.id, l);
  e.name = client.getServerVersion()?.name ?? e.name;
  return l;
}

/** What each tool would cost, as Tacit will treat it. Shown before the person approves the server. */
function costs(l: Live) {
  return l.tools.map((t) => {
    const c = classify(t.annotations as never, false);
    return { name: t.name, description: (t.description ?? '').slice(0, 160), radius: c.kind === 'read' ? 'read' : c.start, why: c.kind === 'read' ? c.why : c.why.join('; ') };
  });
}

// ---------------------------------------------------------------- helpers

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 200_000) throw new Error('too large'); }
  return s ? JSON.parse(s) : {};
}
function send(res: ServerResponse, status: number, v: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(v));
}
/** The page only ever learns whether a model is there, and which. */
function status() {
  const m = model();
  return {
    model: m ? { provider: m.provider, label: PROVIDERS[m.provider].label, model: m.model, from: config.model?.key ? 'settings' : 'environment' } : null,
    providers: PROVIDERS,
    world: !!world.key,
    mcp: config.mcp.map((e) => ({ id: e.id, url: e.url, name: e.name ?? e.url, approved: e.approved, connected: live.has(e.id), tools: live.get(e.id)?.tools.length ?? 0 })),
  };
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'server';

// Only these, and only for approved servers: the page's stand-in client needs nothing else.
const RPC = new Set(['listTools', 'callTool', 'readResource', 'getServerCapabilities', 'getServerVersion']);

// ----------------------------------------------------------------- routes

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const p = url.pathname;
  const post = req.method === 'POST';

  if (!post && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(join(here, 'index.html')));
    return;
  }
  if (!post && p === '/api/status') return send(res, 200, status());

  if (!post && p === '/api/world') {
    if (!world.key) return send(res, 503, { items: [], refreshedAt: null, errors: ['no World Monitor key'] });
    const topics = url.searchParams.get('topics')?.split(',').filter(Boolean) ?? [];
    const r = await world.get({ topics });
    return send(res, r.status, r.body);
  }

  if (!post) return send(res, 404, { error: 'not here' });

  // Every write must come from this page: a request from another site carries its own Origin.
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'not from Tacit' });
  const b = await body(req);

  // --- model
  if (p === '/api/model') {
    const provider = b.provider as Provider;
    if (!PROVIDERS[provider]) return send(res, 400, { error: 'unknown provider' });
    const key = String(b.key ?? '').trim() || (config.model?.provider === provider ? config.model.key : '');
    const name = String(b.model ?? '').trim() || PROVIDERS[provider].models[0]!;
    if (!key) return send(res, 400, { error: 'paste a key first' });
    const cand: ModelConfig = { provider, key, model: name };
    try {
      const said = await chat(cand, 'Reply with exactly: ready', [{ role: 'user', content: 'Are you there?' }], { maxTokens: 16 });
      config.model = cand; save(config);
      return send(res, 200, { ok: true, said: said.slice(0, 60), status: status() });
    } catch (e) {
      return send(res, 200, { ok: false, error: scrub((e as Error).message) });
    }
  }
  if (p === '/api/model/forget') { delete config.model; save(config); return send(res, 200, status()); }

  if (p === '/api/say' || p === '/api/answer' || p === '/api/summary') {
    const m = model();
    if (!m) return send(res, 409, { error: 'no model connected' });
    try {
      const pr = p === '/api/say'
        ? phrasePrompt({ said: String(b.said ?? ''), question: String(b.question ?? ''), move: String(b.move ?? 'ask'), topic: String(b.topic ?? ''), known: String(b.known ?? '') })
        : p === '/api/answer'
          ? answerPrompt({ question: String(b.question ?? ''), known: String(b.known ?? ''), world: String(b.world ?? ''), recent: (Array.isArray(b.recent) ? b.recent : []) as Msg[] })
          : summaryPrompt({ said: String(b.said ?? ''), topic: String(b.topic ?? ''), question: String(b.question ?? '') });
      const text = await chat(m, pr.system, pr.messages, { maxTokens: p === '/api/answer' ? 400 : 120 });
      return send(res, 200, { text });
    } catch (e) {
      return send(res, 502, { error: scrub(e instanceof ModelError ? e.message : 'the model did not answer') });
    }
  }

  // --- world key
  if (p === '/api/world/key') { config.worldKey = String(b.key ?? '').trim() || undefined; save(config); world = buildWorld(); return send(res, 200, status()); }

  // --- MCP
  if (p === '/api/mcp/add') {
    const raw = String(b.url ?? '').trim();
    let id = '';
    try { id = slug(new URL(raw).hostname.split('.')[0] ?? 'server'); } catch { return send(res, 400, { error: 'that is not a web address' }); }
    while (config.mcp.some((e) => e.id === id)) id += '2';
    const entry: McpEntry = { id, url: raw, ...(b.token ? { token: String(b.token) } : {}), approved: false };
    try {
      const l = await open(entry);
      // Name it after the server itself when it says who it is: "notes_demo", not "127".
      let named = slug(entry.name ?? id);
      while (config.mcp.some((e) => e.id === named)) named += '2';
      if (named !== id) { live.set(named, l); live.delete(id); entry.id = id = named; }
      // Connecting reads the list of tools and calls none of them.
      config.mcp.push(entry); save(config);
      return send(res, 200, { ok: true, id, name: entry.name, tools: costs(l) });
    } catch (e) {
      return send(res, 200, { ok: false, error: scrub(`could not connect: ${(e as Error).message}`).slice(0, 300) });
    }
  }
  if (p === '/api/mcp/approve' || p === '/api/mcp/remove') {
    const e = config.mcp.find((x) => x.id === b.id);
    if (!e) return send(res, 404, { error: 'no such connection' });
    if (p.endsWith('approve')) e.approved = true;
    else { config.mcp = config.mcp.filter((x) => x !== e); await live.get(e.id)?.client.close().catch(() => {}); live.delete(e.id); }
    save(config);
    return send(res, 200, status());
  }
  if (p === '/api/mcp/tools') {
    const e = config.mcp.find((x) => x.id === b.id);
    if (!e) return send(res, 404, { error: 'no such connection' });
    try { return send(res, 200, { tools: costs(await open(e)) }); } catch (err) { return send(res, 200, { error: scrub((err as Error).message) }); }
  }
  const rpc = p.match(/^\/api\/mcp\/([a-z0-9_]+)\/rpc$/);
  if (rpc) {
    const e = config.mcp.find((x) => x.id === rpc[1]);
    if (!e || !e.approved) return send(res, 403, { error: 'this server has not been approved' });
    const method = String(b.method);
    if (!RPC.has(method)) return send(res, 400, { error: 'not allowed' });
    try {
      const l = await open(e);
      const fn = (l.client as unknown as Record<string, (a?: unknown) => unknown>)[method]!.bind(l.client);
      const out = await fn(b.params);
      return send(res, 200, { result: out ?? null });
    } catch (err) {
      return send(res, 200, { error: scrub((err as Error).message).slice(0, 300) });
    }
  }

  return send(res, 404, { error: 'not here' });
}

createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(scrub(String((e as Error).message)));
    if (!res.headersSent) send(res, 500, { error: 'something broke on the server; details are in its window' });
  });
}).listen(port, '127.0.0.1', () => {
  const m = model();
  console.log(`\n  Tacit is running:  http://127.0.0.1:${port}\n`);
  console.log(`  Model:  ${m ? `${PROVIDERS[m.provider].label} (${m.model})` : 'none yet — add one in Settings'}`);
  console.log(`  World:  ${world.key ? 'World Monitor' : 'sample'}`);
  console.log(`  MCP:    ${config.mcp.filter((e) => e.approved).length} approved\n`);
});
