import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakeClock, defineAct, type Ctx, type Option } from '@intermenu/aiuic-core';
import { createApp } from '@intermenu/aiuic-kit';
import { EphemeralStore, openMemory } from '@intermenu/aiuic-memory';
import { Aggregator, Pyramid } from '@intermenu/aiuic-pyramid';
import { Conductor } from '@intermenu/aiuic-conductor';
import { connect } from '@intermenu/aiuic-mcp';
import { createHeptaServer, TOOL_NAMES } from '../src/index.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(() => r(), 0)); };
// The person is right there, looking, listening. Silence would commit a spoken act.
const attention = { foreground: true, unlocked: true, proximityClear: true, listening: true };
const ITEMS: Option[] = [{ value: 'milk', label: 'Milk' }, { value: 'eggs', label: 'Eggs' }];

async function hepta() {
  const clock = new FakeClock(T0);
  const list: string[] = [];
  const ctx = () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 });
  const app = createApp({
    clock, speculate: false, ctx,
    acts: [defineAct({ name: 'add_item', domain: 'groceries', phrases: ['add'],
      slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
      radius: 'self', commit: (f) => { list.push(String(f.item)); return { id: 'g' + list.length }; }, undo: () => { list.pop(); } })],
  });
  const memory = openMemory(new EphemeralStore(), () => clock.now());
  memory.writer.commit('main', 'congregator', 'heard', [{ kind: 'fact', key: 'grocery budget', value: '400', said: 'my grocery budget is 400' }]);
  const pyramid = new Pyramid({ app, memory, aggregator: new Aggregator([]),
    orchestrator: () => ({ kind: 'propose', act: 'add_item', why: 'you are out', fill: { item: 'eggs' } }),
    ctx: () => ({ ...ctx(), now: new Date(clock.now()) }) as Ctx, now: () => clock.now() });
  const conductor = new Conductor({ app, memory: memory.reader, clock, store: new EphemeralStore(),
    ctx: () => ({ ...ctx(), now: new Date(clock.now()) }) as Ctx });
  const server = createHeptaServer({
    app, memory: memory.reader, pyramid, conductor, ctx: () => ({ ...ctx(), now: new Date(clock.now()) }) as Ctx,
    shape: { schema: 'aiuic.shape/1', app: { name: 'My Hepta' } },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'outside', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] };
    return r;
  };
  return { clock, app, list, memory, client, call, async advance(ms: number) { clock.advance(ms); await settle(); } };
}

describe('what an outside caller can reach', () => {
  it('lists exactly the documented tools, and none that says yes', async () => {
    const h = await hepta();
    const names = (await h.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES.always, ...TOOL_NAMES.withConductor, ...TOOL_NAMES.withPyramid].sort());
    // no tool whose name is a way of saying yes, or of speaking as the person
    expect(names.filter((n) => /^(assent|confirm|approve|commit|accept|yes|hear|say|speak)/i.test(n))).toEqual([]);
  });

  it('marks every tool that changes nothing as read-only', async () => {
    const h = await hepta();
    const tools = (await h.client.listTools()).tools;
    const ro = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(ro).toEqual(['acts', 'inbox', 'memory_branches', 'memory_search', 'score', 'stage', 'why_not_committing']);
  });
});

describe('propose', () => {
  it('puts an act on the stage and it does not happen, even with the person right there and silent', async () => {
    const h = await hepta();
    const r = await h.call('propose', { act: 'add_item', fill: { item: 'milk' } });
    expect(r.structuredContent).toMatchObject({ status: 'explicit', waitingFor: 'the person' });
    await h.advance(60_000);
    expect(h.list).toEqual([]);
    // the person, in the app, says yes
    await h.app.act!.assent();
    await settle();
    expect(h.list).toEqual(['milk']);
  });

  it('refuses an act the app does not have, and drops slots it does not know', async () => {
    const h = await hepta();
    expect((await h.call('propose', { act: 'wire_money', fill: {} })).isError).toBe(true);
    const r = await h.call('propose', { act: 'add_item', fill: { item: 'eggs', radius: 'self', commit: true } });
    expect(r.structuredContent!.dropped).toEqual(['radius', 'commit']);
  });

  it('explains why the act on stage is waiting', async () => {
    const h = await hepta();
    await h.call('propose', { act: 'add_item', fill: { item: 'milk' } });
    const r = await h.call('why_not_committing');
    expect(JSON.stringify(r.structuredContent)).toMatch(/touched or spoken/);
  });
});

describe('pursue and think', () => {
  it('pursues a goal to a proposal that still waits for the person', async () => {
    const h = await hepta();
    const r = await h.call('pursue', { goal: 'do we need eggs' });
    expect(r.structuredContent!.outcome).toMatchObject({ kind: 'proposed', act: 'add_item', status: 'explicit' });
    await h.advance(60_000);
    expect(h.list).toEqual([]);
  });

  it('thinks on a branch, never on main', async () => {
    const h = await hepta();
    expect((await h.call('think', { branch: 'main', topic: 'x', text: 'y' })).isError).toBe(true);
    const r = await h.call('think', { branch: 'budget-ideas', topic: 'groceries', text: 'bulk buying would save about 40 a month' });
    expect(r.structuredContent).toMatchObject({ written: true });
    expect(h.memory.reader.view('budget-ideas').thoughts).toHaveLength(1);
    expect(h.memory.reader.view('main').thoughts.filter((t) => t.topic === 'groceries')).toEqual([]);
  });

  it('finds what the person said', async () => {
    const h = await hepta();
    const r = await h.call('memory_search', { query: 'grocery budget' });
    expect(JSON.stringify(r.structuredContent)).toContain('my grocery budget is 400');
  });
});

describe('Hepta inside Hepta', () => {
  it('bridges into another app with every write asking first, including propose itself', async () => {
    const h = await hepta();
    const outer = await connect(h.client);
    expect(outer.shape.app.name).toBe('My Hepta');
    const write = outer.tools().filter((t) => t.kind === 'write');
    expect(write.map((t) => t.tool).sort()).toEqual(['propose', 'pursue', 'think']);
    expect(write.every((t) => t.radius === 'external' && !t.lowerable)).toBe(true);
    expect(outer.sources.map((s) => s.name)).toContain('hepta/memory_search');
  });
});
