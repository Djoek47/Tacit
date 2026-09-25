import { describe, expect, it } from 'vitest';
import { FakeClock, defineAct, type Ctx, type Option } from '@intermenu/aiuic-core';
import { createApp } from '@intermenu/aiuic-kit';
import { EphemeralStore, openMemory } from '@intermenu/aiuic-memory';
import { resolveQuantity } from '@intermenu/aiuic-resolve';
import { Aggregator, Pyramid, type Plan } from '@intermenu/aiuic-pyramid';
import { Conductor, authorise, checkOrder, scoreActs, type InboxItem, type OrderSpec } from '../src/index.js';

const T0 = Date.UTC(2026, 8, 25, 12, 0);
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const attention = { foreground: false, unlocked: false, proximityClear: false, listening: false }; // the app is closed

const PEOPLE: Option[] = [{ value: 'maya', label: 'Maya' }, { value: 'sam', label: 'Sam' }];
const ITEMS: Option[] = [{ value: 'milk', label: 'Milk' }, { value: 'eggs', label: 'Eggs' }];

function world(opts: { orchestrator?: (i: { goal: string }) => Plan; pursueThrows?: boolean } = {}) {
  const clock = new FakeClock(T0);
  const list: string[] = [];
  const paid: unknown[] = [];
  const chores: unknown[] = [];
  const app = createApp({
    clock, speculate: false,
    ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }),
    acts: [
      defineAct({ name: 'add_item', domain: 'groceries', phrases: ['add'],
        slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
        radius: 'self', commit: (f) => { list.push(String(f.item)); return { id: 'g' + list.length }; },
        undo: () => { list.pop(); }, preview: (f) => [`${String(f.item)} on the list`] }),
      defineAct({ name: 'assign_chore', domain: 'chores', phrases: ['assign'],
        slots: { who: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
                 what: { primitive: 'chip', options: () => [{ value: 'dishes', label: 'Dishes' }], required: true, order: 2 } },
        radius: 'other-person', commit: (f) => { chores.push(f); return { id: 'c' + chores.length }; }, undo: () => { chores.pop(); } }),
      defineAct({ name: 'pay', domain: 'allowance', phrases: ['pay'],
        slots: { who: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
                 amount: { primitive: 'quantity', resolve: resolveQuantity, required: true, order: 2 } },
        radius: 'external', commit: (f) => { paid.push(f); return { id: 'p' + paid.length }; } }),
      defineAct({ name: 'archive', phrases: ['archive'],
        slots: { what: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
        radius: { max: 'external', of: () => 'self' }, // claims self; has no undo
        commit: () => ({ id: 'a' }) }),
      ...scoreActs(),
    ],
  });
  const mem = openMemory(new EphemeralStore(), () => clock.now());
  const pyramid = new Pyramid({
    app, memory: mem, aggregator: new Aggregator([]),
    orchestrator: (i) => (opts.orchestrator ?? (() => ({ kind: 'answer', answer: 'nothing due' } as Plan)))(i),
    ctx: () => ({ now: new Date(clock.now()) }) as Ctx, now: () => clock.now(),
  });
  const store = new EphemeralStore();
  const notes: InboxItem[] = [];
  const make = () => new Conductor({
    app, memory: mem.reader, clock, store, ctx: () => ({ now: new Date(clock.now()), actor: { id: 'me' }, attention }) as Ctx,
    pursue: async (g) => { if (opts.pursueThrows) throw new Error('offline'); return pyramid.pursue(g) as never; },
    notifier: { notify: (i) => { notes.push(i); } },
    heartbeatMs: 60_000,
    localTime: (ms) => { const d = new Date(ms); return { hours: d.getUTCHours(), minutes: d.getUTCMinutes(), dayStart: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }; },
  });
  // Writing the score directly, as the congregator would after the person approved it.
  const order = (id: string, spec: OrderSpec, text = id) =>
    mem.writer.commit('main', 'congregator', 'order', [{ kind: 'order', id, text, active: true, spec }]);
  return { app, clock, mem, list, paid, chores, conductor: make(), make, order, notes, store,
    /** A real clock moves a minute at a time, and every beat gets to finish. */
    async advance(ms: number) {
      for (let left = ms; left > 0; left -= 60_000) {
        clock.advance(Math.min(60_000, left));
        for (let i = 0; i < 12; i++) await Promise.resolve();
      }
      await settle();
    } };
}

const hourly = { every: 60 * 60_000 };

describe('with no score, it does nothing at all', () => {
  it('starts no act, writes nothing, notifies no one', async () => {
    const w = world();
    w.conductor.start();
    await w.advance(24 * 60 * 60_000);
    expect(w.app.act).toBeNull();
    expect(w.conductor.inbox()).toEqual([]);
    expect(w.notes).toEqual([]);
    w.conductor.stop();
  });
});

describe('what it may do while you are away', () => {
  it('commits what an order covers, within its ceiling, and tells you, with an undo', async () => {
    const w = world();
    w.order('milk', { schedule: hourly, ceiling: 'self', act: { name: 'add_item', fill: { item: 'milk' } } });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    await settle();
    expect(w.list).toEqual(['milk']);
    const item = w.conductor.inbox()[0]!;
    expect(item).toMatchObject({ kind: 'done', title: 'milk on the list', act: 'add_item' });
    expect(item.result).toBeDefined();
    expect(w.notes).toHaveLength(1);
  });

  it('never moves money, whatever the order says', async () => {
    const w = world();
    w.order('allowance', { schedule: hourly, ceiling: 'other-person', act: { name: 'pay', fill: { who: 'maya', amount: { n: 10, label: '$10' } } } });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    expect(w.paid).toEqual([]);
    const item = w.conductor.inbox()[0]!;
    expect(item.kind).toBe('waiting');
    expect(item.why!.join()).toMatch(/external/);
  });

  it('ignores an order that asks for external outright — it is not an order', async () => {
    const w = world();
    w.order('forged', { schedule: hourly, ceiling: 'external', act: { name: 'pay', fill: { who: 'maya', amount: { n: 10, label: '$10' } } } });
    expect(w.conductor.orders()).toEqual([]);
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    expect(w.paid).toEqual([]);
    expect(checkOrder({ schedule: hourly, ceiling: 'external', goal: 'x' })[0]).toMatch(/never done unattended/);
  });

  it('waits for you when the act reaches above the order\'s ceiling', async () => {
    const w = world();
    w.order('chores', { schedule: hourly, ceiling: 'self', act: { name: 'assign_chore', fill: { who: 'maya', what: 'dishes' } } });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    expect(w.chores).toEqual([]);
    expect(w.conductor.inbox()[0]!.why!.join()).toMatch(/above what this order allows/);
  });

  it('does it when the ceiling allows another person, because you said so', async () => {
    const w = world();
    w.order('chores', { schedule: hourly, ceiling: 'other-person', act: { name: 'assign_chore', fill: { who: 'maya', what: 'dishes' } } });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    await settle();
    expect(w.chores).toHaveLength(1);
  });

  it('never does something that cannot be undone, even when it claims to be harmless', async () => {
    const w = world();
    w.order('arch', { schedule: hourly, ceiling: 'other-person', act: { name: 'archive', fill: { what: 'milk' } } });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    const why = w.conductor.inbox()[0]!.why!.join();
    expect(why).toMatch(/cannot be undone/);
  });

  it('waits when something is missing', async () => {
    const w = world();
    w.order('half', { schedule: hourly, ceiling: 'other-person', act: { name: 'assign_chore', fill: { who: 'maya' } } });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    expect(w.conductor.inbox()[0]!.why!.join()).toMatch(/missing what/);
  });

  it('refuses to commit a guess', () => {
    const w = world();
    const run = w.app.ui.start('add_item');
    run.offer('item', [{ value: 'milk', label: 'Milk', score: 0.5, calibrated: false }], 'model');
    run.evaluate();
    const v = authorise(run, { id: 'o', text: 'x', at: 0, spec: { schedule: hourly, ceiling: 'self', goal: 'x' } });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.why.join()).toMatch(/guess/);
  });
});

describe('a waiting item', () => {
  it('opens as a card that silence cannot commit, and a yes can', async () => {
    const w = world();
    w.order('chores', { schedule: hourly, ceiling: 'self', act: { name: 'assign_chore', fill: { who: 'maya', what: 'dishes' } } });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    const run = w.conductor.open(w.conductor.inbox()[0]!.id)!;
    expect(run.state().status).toBe('explicit');
    await w.advance(60_000);
    expect(w.chores).toEqual([]);
    await run.assent();
    await settle();
    expect(w.chores).toHaveLength(1);
  });
});

describe('the rhythm', () => {
  it('runs an hourly order on the hour and not before', async () => {
    const w = world();
    w.order('milk', { schedule: hourly, ceiling: 'self', act: { name: 'add_item', fill: { item: 'milk' } } });
    w.conductor.start();
    await w.advance(59 * 60_000);
    expect(w.list).toEqual([]);
    await w.advance(2 * 60_000);
    expect(w.list).toEqual(['milk']);
    await w.advance(60 * 60_000);
    expect(w.list).toEqual(['milk', 'milk']);
    w.conductor.stop();
  });

  it('runs a morning order at eight', async () => {
    const w = world(); // T0 is 12:00 UTC; the localTime stub reads UTC
    w.order('m', { schedule: { daily: '08:00' }, ceiling: 'self', act: { name: 'add_item', fill: { item: 'eggs' } } });
    w.conductor.start();
    await w.advance(19 * 60 * 60_000); // 07:00 next day
    expect(w.list).toEqual([]);
    await w.advance(62 * 60_000);      // 08:02
    expect(w.list).toEqual(['eggs']);
    w.conductor.stop();
  });

  it('keeps trying when it cannot reach what it needs, and says so after three tries', async () => {
    const w = world({ pursueThrows: true });
    w.order('due', { schedule: hourly, ceiling: 'self', goal: 'what is due today' });
    w.conductor.start();
    await w.advance(60 * 60_000 + 1);
    expect(w.conductor.inbox()).toEqual([]);
    await w.advance(6 * 60 * 60_000);
    const failed = w.conductor.inbox().filter((i) => i.kind === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.detail).toMatch(/offline \(tried 3 times\)/);
    w.conductor.stop();
  });

  it('pursues a goal with the pyramid and brings back the answer', async () => {
    const w = world({ orchestrator: () => ({ kind: 'answer', answer: 'two things are due: rent, dentist' }) });
    w.order('due', { schedule: hourly, ceiling: 'self', goal: 'what is due today' });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    expect(w.conductor.inbox()[0]).toMatchObject({ kind: 'notice', detail: 'two things are due: rent, dentist' });
  });

  it('remembers its inbox and its rhythm across a restart', async () => {
    const w = world();
    w.order('milk', { schedule: hourly, ceiling: 'self', act: { name: 'add_item', fill: { item: 'milk' } } });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    const again = w.make();
    expect(again.inbox()).toHaveLength(1);
    await again.tick(); // not due again yet
    expect(w.list).toEqual(['milk']);
  });
});

describe('writing the score', () => {
  it('is an act the person approves, and undoing it retires the order', async () => {
    const w = world();
    const a = createApp; void a;
    w.app.ui.definitions; // score acts are part of the app
    w.app.hear('every morning tell me what is due');
    const run = w.app.act!;
    expect(run.def.name).toBe('set_standing_order');
    run.setValue('goal', 'tell me what is due', 'touched');
    run.evaluate();
    await run.assent(); // the person is here, and says yes
    await settle();
    const orders = w.conductor.orders();
    expect(orders).toHaveLength(1);
    expect(orders[0]!.spec).toMatchObject({ ceiling: 'self', schedule: { daily: '08:00' }, goal: 'tell me what is due' });

    await run.undo();
    await settle();
    expect(w.conductor.orders()).toEqual([]);
  });
});

describe('an order covers only what it names', () => {
  it('leaves whatever a goal order leads the loop to propose waiting for the person', async () => {
    const w = world({ orchestrator: () => ({ kind: 'propose', act: 'add_item', why: 'you are out', fill: { item: 'milk' } }) as Plan });
    w.order('due', { schedule: hourly, ceiling: 'self', goal: 'what do we need' });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    expect(w.list).toEqual([]);
    expect(w.conductor.inbox()[0]!.why!.join()).toMatch(/does not cover doing add item/);
  });

  it('commits a proposal the order names in allow', async () => {
    const w = world({ orchestrator: () => ({ kind: 'propose', act: 'add_item', why: 'you are out', fill: { item: 'milk' } }) as Plan });
    w.order('due', { schedule: hourly, ceiling: 'self', goal: 'what do we need', allow: ['add_item'] });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    await settle();
    expect(w.list).toEqual(['milk']);
  });

  it('never commits an act that grants authority, even when an order lists it', async () => {
    const w = world({ orchestrator: () => ({ kind: 'propose', act: 'set_standing_order', why: 'x', fill: { often: { every: 60_000 }, goal: 'more' } }) as Plan });
    w.order('sneaky', { schedule: hourly, ceiling: 'self', goal: 'anything', allow: ['set_standing_order'] });
    await w.clock.advance(60 * 60_000);
    await w.conductor.tick();
    expect(w.conductor.orders()).toHaveLength(1);
    expect(w.conductor.inbox()[0]!.why!.join()).toMatch(/only you can say yes/);
  });
});
