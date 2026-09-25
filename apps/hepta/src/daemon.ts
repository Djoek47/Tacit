/**
 * Hepta, running on its own.
 *
 *   node hepta.mjs                      always on; MCP over HTTP on 127.0.0.1
 *   node hepta.mjs --stdio              MCP over stdio, for Claude / Cursor to launch
 *   node hepta.mjs --once               one beat of the conductor, then exit
 *   node hepta.mjs --config path.json   default: ./hepta.config.json
 *
 * What it does, in order: reads the config; connects every MCP server listed
 * there (INSIDE mode — your tools become acts and sources); opens memory from
 * disk; starts the conductor on the score it finds there; and serves Hepta's
 * own MCP server (OUTSIDE mode) so any client can see the stage, the inbox,
 * the score and the memory, propose, pursue and think — and never say yes.
 *
 * No person is present here, so the attention gate always fails: nothing in
 * this process commits on silence. The only commits that happen here are the
 * conductor's, under a standing order, through `authorise()`.
 *
 * The HTTP endpoint serves your memory, so it binds to 127.0.0.1 and wants a
 * bearer token. One is generated on first run and written next to the data.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { realClock, type Ctx } from '../../../packages/core/src/index.js';
import { createApp } from '../../../packages/kit/src/index.js';
import { openMemory } from '../../../packages/memory/src/index.js';
import { Aggregator, Pyramid, type Orchestrator } from '../../../packages/pyramid/src/index.js';
import { Conductor, ConsoleNotifier, scoreActs, type InboxItem, type Notifier } from '../../../packages/conductor/src/index.js';
import { connect, delegationAct, applyDelegations, type Connection } from '../../../packages/mcp/src/index.js';
import { createHeptaServer } from '../../../packages/server/src/index.js';

type ServerEntry = { name?: string; command: string; args?: string[]; env?: Record<string, string>; prefix?: string };
type Config = {
  dataDir?: string;
  servers?: ServerEntry[];
  http?: { port?: number };
  notify?: { url?: string };
};

// ------------------------------------------------------------------ storage

/** Written to a temp file and renamed, so a crash mid-write never leaves half a memory. */
class FileStore {
  constructor(private readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }
  load(): string | null { try { return readFileSync(this.path, 'utf8'); } catch { return null; } }
  save(v: string): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, v, { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}

const log = (...a: unknown[]) => process.stderr.write(`[hepta] ${a.join(' ')}\n`); // stdout is the protocol in --stdio

function expand(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

// ------------------------------------------------------------- orchestrator

/**
 * Tier 0: no model. It answers with what the sources and memory said, and
 * proposes nothing. A model-backed orchestrator is a function with the same
 * signature — see the developer docs — and nothing else here changes.
 */
const localOrchestrator: Orchestrator = ({ findings }) => {
  const useful = findings.filter((f) => f.confidence > 0).slice(0, 5);
  if (!useful.length) return { kind: 'answer', answer: 'I found nothing about that.' };
  return { kind: 'answer', answer: useful.map((f) => `${f.source}: ${f.claim}`).join('\n') };
};

// ----------------------------------------------------------------- notifier

class WebhookNotifier implements Notifier {
  constructor(private readonly url: string) {}
  async notify(i: InboxItem): Promise<void> {
    const mark = { done: 'Done', waiting: 'Waiting for you', notice: 'Note', failed: 'Could not' }[i.kind];
    await fetch(this.url, { method: 'POST', body: `${mark}: ${i.title}${i.why ? ' — ' + i.why[0] : ''}` }).catch(() => {});
  }
}

// --------------------------------------------------------------------- main

export async function start(argv: string[]) {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const configPath = resolve(arg('--config') ?? 'hepta.config.json');
  const cfg: Config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const dataDir = expand(cfg.dataDir ?? '~/.hepta');
  mkdirSync(dataDir, { recursive: true });

  // INSIDE: your servers become acts and sources.
  const connections: Connection[] = [];
  const clients: Client[] = [];
  for (const s of cfg.servers ?? []) {
    try {
      const client = new Client({ name: 'hepta', version: '1.0.0' });
      await client.connect(new StdioClientTransport({
        command: s.command, args: s.args ?? [], stderr: 'ignore',
        ...(s.env ? { env: { ...process.env as Record<string, string>, ...s.env } } : {}),
      }));
      const conn = await connect(client, s.prefix ? { prefix: s.prefix } : {});
      connections.push(conn);
      clients.push(client);
      log(`connected ${conn.shape.app.name}: ${conn.preview()}`);
      for (const p of conn.shapeProblems) log(`  shape: ${p}`);
    } catch (e) {
      log(`could not connect ${s.name ?? s.command}: ${(e as Error).message}`);
    }
  }

  const memory = openMemory(new FileStore(join(dataDir, 'memory.json')));
  for (const s of applyDelegations(connections, memory.reader.view().delegations)) log(`delegation skipped: ${s}`);

  // Nobody is at this process. The gate fails; nothing commits on silence here.
  const ctx = () => ({
    now: new Date(), actor: { id: 'owner', basePauseMs: 850 }, reachLimit: 1, undoWindowMs: 5000,
    attention: { foreground: false, unlocked: false, proximityClear: false, listening: false },
  }) as Ctx;

  const domains = Object.assign({}, ...connections.map((c) => c.shape.domains ?? {}));
  const app = createApp({
    ctx, speculate: false, domains,
    acts: [...connections.flatMap((c) => c.acts), ...scoreActs(), ...(connections.length ? [delegationAct(connections)] : [])],
  });

  const pyramid = new Pyramid({
    app, memory, ctx,
    aggregator: new Aggregator(connections.flatMap((c) => c.sources)),
    orchestrator: localOrchestrator,
  });

  const notifiers: Notifier[] = [new ConsoleNotifier((s) => log(s))];
  if (cfg.notify?.url) notifiers.push(new WebhookNotifier(cfg.notify.url));
  const conductor = new Conductor({
    app, memory: memory.reader, clock: realClock, ctx,
    store: new FileStore(join(dataDir, 'conductor.json')),
    pursue: (g) => pyramid.pursue(g) as never,
    notifier: { notify: async (i) => { for (const n of notifiers) await n.notify(i); } },
  });

  const shape = { schema: 'aiuic.shape/1', app: { name: 'Hepta' } };
  const serverFor = () => createHeptaServer({ app, memory: memory.reader, ctx, conductor, pyramid, shape });

  const shutdown = async () => {
    conductor.stop();
    for (const c of clients) await c.close().catch(() => {});
  };

  if (argv.includes('--once')) {
    await conductor.tick();
    log(`one beat: ${conductor.orders().length} orders, ${conductor.inbox().filter((i) => !i.read).length} unread`);
    await shutdown();
    return { app, memory, conductor, connections };
  }

  conductor.start();
  log(`conductor running: ${conductor.orders().length} standing order(s)`);

  if (argv.includes('--stdio')) {
    await serverFor().connect(new StdioServerTransport());
    log('serving MCP on stdio');
  } else {
    const port = Number(arg('--port') ?? cfg.http?.port ?? 8790);
    const tokenPath = join(dataDir, 'token');
    if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(24).toString('hex'), { mode: 0o600 });
    const token = readFileSync(tokenPath, 'utf8').trim();
    const authorised = (req: IncomingMessage) => {
      const got = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
      const want = Buffer.from(token);
      return got.length === want.length && timingSafeEqual(got, want);
    };

    const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, orders: conductor.orders().length, unread: conductor.inbox().filter((i) => !i.read).length }));
        return;
      }
      if (!req.url?.startsWith('/mcp')) { res.writeHead(404); res.end(); return; }
      if (!authorised(req)) { res.writeHead(401, { 'www-authenticate': 'Bearer' }); res.end('token required'); return; }
      // Stateless: one server object per request, all sharing the same app and memory.
      const server = serverFor();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    http.listen(port, '127.0.0.1', () => {
      log(`serving MCP on http://127.0.0.1:${port}/mcp`);
      log(`token: ${tokenPath}`);
    });
  }

  process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
  return { app, memory, conductor, connections };
}

if (process.argv[1] && /hepta(\.mjs)?$/.test(process.argv[1])) {
  start(process.argv.slice(2)).catch((e) => { log(`fatal: ${(e as Error).stack ?? e}`); process.exit(1); });
}
