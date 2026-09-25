import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx } from '@intermenu/aiuic-core';
import { createApp } from '@intermenu/aiuic-kit';
import { connect, DelegationError } from '../src/index.js';
import { tasksServer } from './fixture.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const attention = { foreground: true, unlocked: true, proximityClear: true, listening: true };

async function appFor(opts: Parameters<typeof tasksServer>[0] = {}) {
  const s = await tasksServer(opts);
  const conn = await connect(s.client);
  await conn.approve(); // what a host does once the person says yes to preview()
  const clock = new FakeClock(T0);
  const app = createApp({
    clock, acts: conn.acts, speculate: false,
    ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }),
  });
  return { ...s, conn, app, clock, async advance(ms: number) { clock.advance(ms); await settle(); } };
}

describe('connecting', () => {
  it('turns write tools into acts and read tools into sources', async () => {
    const h = await appFor();
    // delete_task is add_task's undo: machinery, not an act a person asks for
    expect(h.conn.acts.map((a) => a.name).sort()).toEqual(['add_task', 'archive_all', 'send_invoice']);
    expect(h.conn.sources.map((s) => s.name).sort()).toEqual(['tasks/list_lists', 'tasks/list_tasks']);
  });

  it('says what the person is approving, before anything is trusted', async () => {
    const h = await appFor();
    const p = h.conn.preview();
    expect(p).toContain('Connect Tasks.');
    expect(p).toContain('do 3 things and look up 2');
    expect(p).toContain('All 3 ask you first');
    expect(p).toContain('1 can be undone');
    // it names what it will trust to only read, and says what trusting it means
    expect(p).toContain('It looks things up with list_tasks, list_lists');
    expect(p).toMatch(/approving means trusting that/);
  });

  it('reads the shape the server publishes', async () => {
    const h = await appFor();
    expect(h.conn.shape.app.name).toBe('Tasks');
    expect(h.conn.shape.settings?.[0]?.key).toBe('weekly');
    expect(h.conn.acts.find((a) => a.name === 'add_task')!.domain).toBe('tasks');
  });

  it('fills a slot from the options a list tool returns', async () => {
    const h = await appFor();
    const add = h.conn.acts.find((a) => a.name === 'add_task')!;
    const opts = add.slots.list!.options!({} as Ctx, {}) as { label: string }[];
    expect(opts.map((o) => o.label)).toEqual(['Home', 'Work']);
  });
});

describe('what a server cannot say about itself', () => {
  it('starts every write at external, whatever its annotations claim', async () => {
    const h = await appFor();
    for (const t of h.conn.tools().filter((t) => t.kind === 'write')) expect(t.radius).toBe('external');
  });

  it('keeps a tool with no declared undo irreversible, even when it claims to be harmless', async () => {
    const h = await appFor();
    const archive = h.conn.tools().find((t) => t.tool === 'archive_all')!;
    expect(archive.lowerable).toBe(false);
    expect(() => h.conn.delegate('archive_all', 'self')).toThrow(DelegationError);
  });

  it('never lets an unannotated tool be lowered: MCP assumes it is destructive and reaches out', async () => {
    const h = await appFor();
    expect(() => h.conn.delegate('send_invoice', 'other-person')).toThrow(/cannot be lowered/);
  });

  it('never lets a destructive tool be lowered', async () => {
    const h = await appFor();
    expect(() => h.conn.delegate('delete_task', 'self')).toThrow(DelegationError);
  });

  it('refuses a shape that tries to set a radius, and still connects, plainly', async () => {
    const h = await appFor({ shape: {
      schema: 'aiuic.shape/1', app: { name: 'Sneaky' },
      tools: { send_invoice: { phrases: ['bill'], radius: 'self' } },
    } });
    expect(h.conn.shapeProblems.join()).toMatch(/radius/);
    expect(h.conn.shape.app.name).toBe('tasks'); // derived, from the server name
    expect(h.conn.tools().find((t) => t.tool === 'send_invoice')!.radius).toBe('external');
  });

  it('refuses a colour that means something everywhere else', async () => {
    const h = await appFor({ shape: {
      schema: 'aiuic.shape/1', app: { name: 'Green' },
      domains: { money: { kicker: 'MONEY', colour: '#34D399' } },
    } });
    expect(h.conn.shapeProblems.join()).toMatch(/success/);
  });

  it('refuses an undo that is a read-only tool', async () => {
    const h = await appFor({ shape: {
      schema: 'aiuic.shape/1', app: { name: 'Fake undo' },
      tools: { archive_all: { undo: { tool: 'list_tasks', arg: 'id', from: 'id' } } },
    } });
    expect(h.conn.shapeProblems.join()).toMatch(/read-only/);
    expect(() => h.conn.delegate('archive_all', 'self')).toThrow(DelegationError);
  });

  it('with no shape at all, derives a plain one and invents no undo', async () => {
    const h = await appFor({ withShape: false });
    expect(h.conn.shapeProblems).toEqual([]);
    expect(h.conn.tools().filter((t) => t.kind === 'write').every((t) => !t.lowerable)).toBe(true);
  });
});

describe('using it', () => {
  it('asks first by default, and a minute of silence writes nothing', async () => {
    const h = await appFor();
    const r = h.app.hear('add buy milk to the home list');
    expect(r.act).toBe('add_task');
    await h.advance(60_000);
    expect(h.tasks).toEqual([]);
    // The title is a guess (uncalibrated), and the act is external, so it is
    // held before it can even ask: a yes has to be a yes to the right words.
    expect(h.app.act!.status).toBe('resolving');
    expect(r.view!.slots.find((s) => s.name === 'title')!.provisional).toBe(true);

    // The person confirms the words; now it asks, and still writes nothing.
    h.app.act!.setValue('title', 'buy milk', 'touched');
    h.app.act!.evaluate();
    expect(h.app.act!.status).toBe('explicit');
    await h.advance(60_000);
    expect(h.tasks).toEqual([]);

    await h.app.act!.assent();
    await settle();
    expect(h.tasks.map((t) => t.title)).toEqual(['buy milk']);
  });

  it('commits on silence once the person has delegated it, and undo reaches the server', async () => {
    const h = await appFor();
    h.conn.delegate('add_task', 'self');
    const r = h.app.hear('add buy milk to the home list');
    const v = r.view!;
    expect(v.slots.find((s) => s.name === 'title')!.display).toBe('buy milk');
    expect(v.slots.find((s) => s.name === 'list')!.display).toBe('Home');
    expect(v.preview).toBe('Add buy milk to Home');

    await h.advance(1000);
    expect(h.tasks).toEqual([{ id: 't1', title: 'buy milk', list: 'home' }]);

    await h.app.act!.undo();
    await settle();
    expect(h.tasks).toEqual([]);
  });

  it('turns a server error into a failed act, not a silent success', async () => {
    const h = await appFor();
    h.conn.delegate('add_task', 'self');
    h.app.hear('add FAIL now to the work list');
    await h.advance(1000);
    expect(h.app.act!.status).toBe('failed');
    expect(h.tasks).toEqual([]);
  });

  it('answers a question from a read tool, and stays out of questions it knows nothing about', async () => {
    const h = await appFor();
    const tasksSrc = h.conn.sources.find((s) => s.name === 'tasks/list_tasks')!;
    expect((await tasksSrc.read('what tasks do I have', {} as Ctx)).length).toBe(1);
    expect(await tasksSrc.read('what is the weather', {} as Ctx)).toEqual([]);
  });
});

describe('the free-text guess', () => {
  it('stops before a slot that is introduced as somewhere else, and keeps one that is not', async () => {
    const { remainder } = await import('../src/schema.js');
    const r = remainder(['add'], () => new Set(['home', 'work']));
    expect(r('add buy milk to the home list')[0]!.value).toBe('buy milk');
    expect(r('add call home')[0]!.value).toBe('call home');
    expect(r('add finish the deck for work')[0]!.value).toBe('finish the deck');
  });
});

describe('delegating is the person\'s act', () => {
  it('offers only tools that can be lowered, and records the choice', async () => {
    const { delegationAct } = await import('../src/index.js');
    const h = await appFor();
    const act = delegationAct([h.conn]);
    const opts = act.slots.tool!.options!({} as Ctx, {}) as { label: string }[];
    expect(opts.map((o) => o.label)).toEqual(['Tasks: add task']);
    const r = await act.commit({ tool: { server: 'tasks', tool: 'add_task' }, level: 'self' }, {} as Ctx);
    expect(h.conn.tools().find((t) => t.tool === 'add_task')!.radius).toBe('self');
    expect((r as unknown as { memory: unknown[] }).memory).toEqual([{ kind: 'delegation', tool: 'tasks/add_task', radius: 'self' }]);
    await act.undo!(r, {} as Ctx);
    expect(h.conn.tools().find((t) => t.tool === 'add_task')!.radius).toBe('external');
  });

  it('re-applies what was remembered, and skips what is no longer allowed', async () => {
    const { applyDelegations } = await import('../src/index.js');
    const h = await appFor();
    const skipped = applyDelegations([h.conn], { 'tasks/add_task': 'self', 'tasks/send_invoice': 'self', 'gone/x': 'self' });
    expect(h.conn.tools().find((t) => t.tool === 'add_task')!.radius).toBe('self');
    expect(skipped).toHaveLength(2);
  });
});

describe('data a person reads', () => {
  it('describes a tool result in words, not JSON', async () => {
    const { describeData } = await import('../src/index.js');
    expect(describeData({ items: [{ id: 't1', title: 'buy milk' }, { id: 't2', title: 'call the bank' }] })).toBe('2 items: buy milk, call the bank');
    expect(describeData({ chequing: 2140.55, savings_total: 8800 })).toBe('chequing 2140.55 · savings total 8800');
    expect(describeData({ items: [] })).toBe('nothing');
  });
});
