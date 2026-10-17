/**
 * Tacit's server side, as one handler that runs the same on Vercel and on a laptop.
 *
 * Nothing about a person is stored here. Each request carries what it needs:
 * which model to use, an optional key of the visitor's own, the MCP server to
 * reach. The site owner's keys come from environment variables only, and an
 * access code (TACIT_ACCESS_CODE) decides who may spend them.
 *
 * Environment:
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY   the owner's models (any or none)
 *   WORLDMONITOR_API_KEY                             the real world feed
 *   TACIT_ACCESS_CODE                                required to use the owner's keys and tools
 */
import { timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { worldMonitorFetch, worldMonitorSource } from '../../packages/notify/src/index.js';
import { worldRoute } from '../../packages/tacit/src/world.js';
import { PROVIDERS, ModelError, answerPrompt, chat, phrasePrompt, summaryPrompt, type ModelConfig, type Msg, type Provider } from '../../packages/tacit/src/model.js';
import { classify } from '../../packages/mcp/src/policy.js';

export type Env = Record<string, string | undefined>;
export type Req = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> };
export type Res = { status: number; body: unknown };

const header = (r: Req, k: string) => { const v = r.headers[k]; return (Array.isArray(v) ? v[0] : v) ?? ''; };
const ENV_KEY: Record<Provider, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', xai: 'XAI_API_KEY' };

function sameCode(given: string, want: string): boolean {
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** May this request spend the owner's keys and reach out to servers? */
function unlocked(r: Req, env: Env): boolean {
  const code = env.TACIT_ACCESS_CODE;
  if (!code) return true; // no code set: the owner chose an open site (local runs)
  return sameCode(header(r, 'x-tacit-code'), code);
}

/** The model for this request: the visitor's own key if they sent one, else the owner's. */
function modelFor(r: Req, env: Env): ModelConfig | { error: string; status: number } {
  const provider = (String(r.body.provider ?? header(r, 'x-tacit-provider')) || firstHosted(env) || 'anthropic') as Provider;
  if (!PROVIDERS[provider]) return { error: 'unknown provider', status: 400 };
  const model = String(r.body.model ?? header(r, 'x-tacit-model') ?? '').trim() || PROVIDERS[provider].models[0]!;
  const own = header(r, 'x-tacit-key').trim();
  if (own) return { provider, key: own, model };
  const hosted = env[ENV_KEY[provider]];
  if (!hosted) return { error: `no ${PROVIDERS[provider].label} key on this site: add your own in Settings`, status: 409 };
  if (!unlocked(r, env)) return { error: 'enter the access code in Settings to use this site’s AI', status: 401 };
  return { provider, key: hosted, model };
}
const firstHosted = (env: Env) => (Object.keys(ENV_KEY) as Provider[]).find((p) => env[ENV_KEY[p]]);

function scrubber(r: Req, env: Env) {
  const secrets = [header(r, 'x-tacit-key'), String(r.body.token ?? ''), ...Object.values(ENV_KEY).map((k) => env[k]), env.WORLDMONITOR_API_KEY, env.TACIT_ACCESS_CODE].filter((s): s is string => !!s && s.length > 3);
  return (s: string) => secrets.reduce((t, k) => t.split(k).join('[key]'), s);
}

// ------------------------------------------------------------------ world

let world: { key: string; get: ReturnType<typeof worldRoute> } | null = null;
function worldOf(env: Env) {
  const key = env.WORLDMONITOR_API_KEY ?? '';
  if (!world || world.key !== key) world = { key, get: worldRoute({ sources: key ? [worldMonitorSource(worldMonitorFetch(key))] : [], secrets: [key] }) };
  return world;
}

// -------------------------------------------------------------------- MCP

/** A public server must not become a way into private networks. */
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? privateAddress(m[1]!) : false;
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
export async function checkTarget(raw: string, env: Env): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('that is not a web address'); }
  const local = env.TACIT_LOCAL === '1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('only https servers can be connected');
  if (u.username || u.password) throw new Error('put credentials in the token field, not the address');
  if (!local) {
    const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
    if (addrs.some((a) => privateAddress(a.address))) throw new Error('that address points inside a private network');
  }
  return u;
}

async function openClient(url: URL, token: string): Promise<Client> {
  const init = token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined;
  const client = new Client({ name: 'tacit', version: '0.1.0' });
  try { await client.connect(new StreamableHTTPClientTransport(url, init)); return client; } catch {
    const legacy = new Client({ name: 'tacit', version: '0.1.0' });
    await legacy.connect(new SSEClientTransport(url, init));
    return legacy;
  }
}
const RPC = new Set(['listTools', 'callTool', 'readResource', 'getServerCapabilities', 'getServerVersion']);

// ---------------------------------------------------------------- handler

export async function handle(r: Req, env: Env): Promise<Res> {
  const scrub = scrubber(r, env);
  const p = r.path.replace(/^\/+|\/+$/g, '');

  if (r.method === 'GET' && p === 'status') {
    const providers = Object.fromEntries((Object.keys(PROVIDERS) as Provider[]).map((k) => [k, { ...PROVIDERS[k], hosted: !!env[ENV_KEY[k]] }]));
    return { status: 200, body: { v: 2, providers, hosted: firstHosted(env) ?? null, locked: !!env.TACIT_ACCESS_CODE, unlocked: unlocked(r, env), world: !!env.WORLDMONITOR_API_KEY } };
  }
  if (r.method === 'GET' && p === 'world') {
    const w = worldOf(env);
    if (!w.key) return { status: 503, body: { items: [], errors: ['no World Monitor key'] } };
    const out = await w.get({});
    return { status: out.status, body: out.body };
  }
  if (r.method !== 'POST') return { status: 404, body: { error: 'not here' } };

  if (p === 'unlock') return { status: 200, body: { ok: unlocked(r, env) } };

  if (p === 'model/test' || p === 'say' || p === 'answer' || p === 'summary') {
    const m = modelFor(r, env);
    if ('error' in m) return { status: m.status, body: { ok: false, error: m.error } };
    const b = r.body;
    try {
      if (p === 'model/test') {
        await chat(m, 'Reply with exactly: ready', [{ role: 'user', content: 'Are you there?' }], { maxTokens: 16 });
        return { status: 200, body: { ok: true, label: PROVIDERS[m.provider].label, model: m.model } };
      }
      const pr = p === 'say'
        ? phrasePrompt({ said: String(b.said ?? ''), question: String(b.question ?? ''), move: String(b.move ?? 'ask'), topic: String(b.topic ?? ''), known: String(b.known ?? '') })
        : p === 'answer'
          ? answerPrompt({ question: String(b.question ?? ''), known: String(b.known ?? ''), world: String(b.world ?? ''), recent: (Array.isArray(b.recent) ? b.recent : []).slice(-8) as Msg[] })
          : summaryPrompt({ said: String(b.said ?? ''), topic: String(b.topic ?? ''), question: String(b.question ?? '') });
      const text = await chat(m, pr.system, pr.messages, { maxTokens: p === 'answer' ? 400 : 120 });
      return { status: 200, body: { text } };
    } catch (e) {
      return { status: 502, body: { ok: false, error: scrub(e instanceof ModelError ? e.message : 'the model did not answer') } };
    }
  }

  if (p === 'mcp/preview' || p === 'mcp/rpc') {
    if (!unlocked(r, env)) return { status: 401, body: { error: 'enter the access code in Settings to connect tools' } };
    let client: Client | null = null;
    try {
      const url = await checkTarget(String(r.body.url ?? ''), env);
      client = await openClient(url, String(r.body.token ?? ''));
      if (p === 'mcp/preview') {
        const tools: { name: string; description?: string; annotations?: Record<string, unknown> }[] = [];
        let cursor: string | undefined;
        do { const page = await client.listTools(cursor ? { cursor } : {}); tools.push(...(page.tools as typeof tools)); cursor = page.nextCursor; } while (cursor && tools.length < 200);
        // Reading the list calls none of the tools.
        return { status: 200, body: { ok: true, name: client.getServerVersion()?.name ?? url.hostname, tools: tools.map((t) => {
          const c = classify(t.annotations as never, false);
          return { name: t.name, description: (t.description ?? '').slice(0, 160), radius: c.kind === 'read' ? 'read' : c.start };
        }) } };
      }
      const method = String(r.body.method);
      if (!RPC.has(method)) return { status: 400, body: { error: 'not allowed' } };
      const fn = (client as unknown as Record<string, (a?: unknown) => unknown>)[method]!.bind(client);
      return { status: 200, body: { result: (await fn(r.body.params)) ?? null } };
    } catch (e) {
      return { status: 200, body: { ok: false, error: scrub(String((e as Error).message)).slice(0, 300) } };
    } finally {
      await client?.close().catch(() => {});
    }
  }

  return { status: 404, body: { error: 'not here' } };
}
