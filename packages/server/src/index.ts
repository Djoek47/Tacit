/**
 * Hepta from the outside: the four roles and the memory, as an MCP server.
 *
 * AIUIC works two ways. INSIDE, your app connects its own MCP servers and the
 * bridge turns them into acts (aiuic-mcp). OUTSIDE — this package — any MCP
 * client (Claude, Cursor, another agent, another AIUIC app) connects to Hepta
 * and works with it: reads the stage, the inbox, the score and the memory;
 * proposes acts; pursues goals; thinks on a branch.
 *
 * The rule, and the reason for every tool's shape: WHOEVER CALLS IN IS A
 * MODEL, NOT THE PERSON. So:
 *
 *   - there is no `assent` tool. Nothing an outside caller does commits.
 *     A proposal lands on the stage as a system-initiated act, which the
 *     engagement rule already keeps from committing on silence; the person
 *     says yes in the app, or it does not happen.
 *   - there is no `hear`. Text from outside is not the person speaking, and
 *     spoken fills are what mark an act as engaged. A caller that could
 *     "hear" could make a silence-commit happen from outside.
 *   - `think` writes to a branch, never to main, and only thoughts.
 *   - `propose` refuses acts that are not in the app, and drops slots that
 *     the act does not have.
 *
 * Every tool is annotated honestly, and the ones that do not change anything
 * say readOnlyHint — which a well-behaved client will use to run them freely.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { App } from '@intermenu/aiuic-kit';
import type { Conductor } from '@intermenu/aiuic-conductor';
import type { Pyramid } from '@intermenu/aiuic-pyramid';
import type { MemoryReader } from '@intermenu/aiuic-memory';
import { toView } from '@intermenu/aiuic-present';
import { explain } from '@intermenu/aiuic-devtools';
import type { Ctx } from '@intermenu/aiuic-core';

export type HeptaServerConfig = {
  name?: string;
  version?: string;
  app: App;
  memory: MemoryReader;
  ctx: () => Ctx;
  conductor?: Conductor;
  pyramid?: Pyramid;
  /** This app's own shape, served at aiuic://shape so another app can bridge to it. */
  shape?: unknown;
};

const json = (v: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }],
  structuredContent: (v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }) as Record<string, unknown>,
});
const fail = (msg: string) => ({ isError: true, content: [{ type: 'text' as const, text: msg }] });

export function createHeptaServer(cfg: HeptaServerConfig): McpServer {
  const server = new McpServer({ name: cfg.name ?? 'hepta', version: cfg.version ?? '1.0.0' });
  const { app } = cfg;
  const optionsFor = (r: { def: { slots: Record<string, { options?: (c: Ctx, f: object) => unknown }> } }, slot: string) => {
    const o = r.def.slots[slot]?.options?.(cfg.ctx(), {});
    return Array.isArray(o) ? o : [];
  };

  // ------------------------------------------------------------------- reads
  server.registerTool('stage', {
    title: 'What is on the stage',
    description: 'The act the person is looking at now: slots, what is filled, what it costs, and whether it is waiting for them.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const run = app.act;
    return json(run ? toView(run, optionsFor as never) : { act: null });
  });

  server.registerTool('why_not_committing', {
    title: 'Why the act on stage has not happened',
    description: 'Plain reasons, in order: missing slots, guesses, radius, the attention gate.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const run = app.act;
    if (!run) return json({ summary: 'nothing is on the stage' });
    return json(explain(run, cfg.ctx()));
  });

  server.registerTool('acts', {
    title: 'What this app can do',
    description: 'Every act, with its domain, trigger phrases and slots. Proposals must name one of these.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => json({
    acts: app.ui.definitions.map((d) => ({
      name: d.name, domain: d.domain ?? null, phrases: d.phrases ?? [],
      slots: Object.entries(d.slots).map(([n, s]) => ({ name: n, primitive: s.primitive, required: !!s.required })),
      radius: typeof d.radius === 'string' ? d.radius : `up to ${d.radius.max}`,
    })),
  }));

  server.registerTool('memory_search', {
    title: 'Search memory',
    description: 'Facts the person stated, findings, decisions and thoughts whose words match. Facts are only ever what the person said.',
    inputSchema: { query: z.string().min(1).max(200), branch: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, branch }) => {
    try { return json({ results: cfg.memory.search(query, branch) }); } catch (e) { return fail((e as Error).message); }
  });

  server.registerTool('memory_branches', {
    title: 'Lines of thought',
    description: 'The branches of memory. main is what is believed; the others are lines of thought.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => json({ branches: cfg.memory.branches() }));

  if (cfg.conductor) {
    const c = cfg.conductor;
    server.registerTool('inbox', {
      title: 'The conductor\'s inbox',
      description: 'What it did on its own (with undo), what is waiting for a yes, and what it could not do.',
      inputSchema: { unreadOnly: z.boolean().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ unreadOnly }) => json({ items: c.inbox().filter((i) => !unreadOnly || !i.read) }));

    server.registerTool('score', {
      title: 'The standing orders',
      description: 'What the conductor may do while the person is away, and the most each order may commit.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => json({ orders: c.orders() }));
  }

  // ---------------------------------------------------- proposals, never commits
  server.registerTool('propose', {
    title: 'Put an act on the stage',
    description: 'Prepares an act with values filled. It does NOT happen: it waits on the person\'s stage for their yes. There is no way to say yes from here.',
    inputSchema: { act: z.string(), fill: z.record(z.string(), z.unknown()).default({}) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ act, fill }) => {
    const def = app.ui.definitions.find((d) => d.name === act);
    if (!def) return fail(`no act "${act}". Call "acts" for the list.`);
    app.reset();
    const run = app.ui.start(act);
    const dropped: string[] = [];
    for (const [k, v] of Object.entries(fill)) {
      if (!def.slots[k]) { dropped.push(k); continue; }
      run.setValue(k, v, 'model');
    }
    run.evaluate();
    app.draw();
    return json({ status: run.status, waitingFor: 'the person', dropped, stage: toView(run, optionsFor as never) });
  });

  if (cfg.pyramid) {
    const p = cfg.pyramid;
    server.registerTool('pursue', {
      title: 'Pursue a goal',
      description: 'Runs the loop: gather, plan, split if needed. May end in an answer, or a proposal waiting on the stage — never in a commit.',
      inputSchema: { goal: z.string().min(1).max(500) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    }, async ({ goal }) => json({ outcome: await p.pursue(goal) }));

    server.registerTool('think', {
      title: 'Think on a branch',
      description: 'Adds a line of thought to a memory branch (never main). Thoughts only: facts are what the person says.',
      inputSchema: { branch: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,48}$/i), topic: z.string().min(1).max(120), text: z.string().min(1).max(2000) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ branch, topic, text }) => {
      if (branch === 'main') return fail('main holds what is believed. Think on a branch.');
      const ok = p.congregator.think(branch, topic, text);
      return ok ? json({ branch, written: true }) : fail('memory refused the thought');
    });
  }

  if (cfg.shape) {
    server.registerResource('shape', 'aiuic://shape', { mimeType: 'application/json', description: 'This app\'s shape' },
      async (uri) => ({ contents: [{ uri: String(uri), mimeType: 'application/json', text: JSON.stringify(cfg.shape) }] }));
  }

  return server;
}

/** The names a caller will find. Kept here so docs and tests agree with the code. */
export const TOOL_NAMES = {
  always: ['stage', 'why_not_committing', 'acts', 'memory_search', 'memory_branches', 'propose'],
  withConductor: ['inbox', 'score'],
  withPyramid: ['pursue', 'think'],
} as const;
