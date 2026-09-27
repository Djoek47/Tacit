import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx, type Option } from '@intermenu/aiuic-core';
import { TextPresenter } from '@intermenu/aiuic-present';
import { createApp, defineAct } from '../src/index.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));

const PEOPLE: Option[] = [
  { value: { id: 'maya', label: 'Maya' }, label: 'Maya', aliases: ['maya'] },
  { value: { id: 'sam', label: 'Sam' }, label: 'Sam', aliases: ['sam'] },
];
const CHORES: Option[] = [
  { value: 'dishes', label: 'Dishes', aliases: ['the dishes'] },
  { value: 'laundry', label: 'Laundry', aliases: ['the laundry'] },
];
const ITEMS: Option[] = [
  { value: 'milk', label: 'Milk' }, { value: 'jam', label: 'Jam' },
];

const attention = { foreground: true, unlocked: true, proximityClear: true, listening: true };

function app(over: Partial<Parameters<typeof createApp>[0]> = {}) {
  const clock = new FakeClock(T0);
  const written: string[] = [];
  const a = createApp({
    clock,
    ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }),
    acts: [
      defineAct({
        name: 'assign_chore', domain: 'chores', phrases: ['for', 'assign', 'needs to do'],
        slots: {
          chore: { primitive: 'chip', options: () => CHORES, required: true, order: 1 },
          assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 2 },
        },
        radius: { max: 'other-person', of: () => 'other-person' },
        commit: (f) => { written.push('chore:' + String(f.chore)); return { id: 'c1' }; },
        undo: () => { written.pop(); },
      }),
      defineAct({
        name: 'add_item', domain: 'groceries', phrases: ['add', 'we need'],
        slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
        radius: 'self',
        commit: (f) => { written.push('item:' + String(f.item)); return { id: 'g1' }; },
        undo: () => { written.pop(); },
      }),
    ],
    ...over,
  });
  return { a, clock, written, async advance(ms: number) { clock.advance(ms); await tick(); } };
}

describe('hear', () => {
  it('routes, starts and fills from one string', () => {
    const { a } = app();
    const r = a.hear('the dishes for Maya');
    expect(r.act).toBe('assign_chore');
    expect(r.run).not.toBeNull();
    const v = r.view!;
    expect(v.slots.find((s) => s.name === 'chore')!.display).toBe('Dishes');
    expect(v.slots.find((s) => s.name === 'assignee')!.display).toBe('Maya');
  });

  it('commits on silence and writes once', async () => {
    const h = app();
    h.a.hear('the dishes for Maya');
    expect(h.written).toEqual([]);
    await h.advance(1400);
    expect(h.written).toEqual(['chore:dishes']);
  });

  it('routes nowhere rather than guessing, and says so', () => {
    const { a } = app();
    const r = a.hear('what is the weather like');
    expect(r.decision.kind).toBe('none');
    expect(r.act).toBeNull();
    expect(r.run).toBeNull();
  });

  it('treats empty text as nothing happening', () => {
    const { a } = app();
    const r = a.hear('   ');
    expect(r.act).toBeNull();
    expect(r.decision.kind).toBe('none');
  });
});

describe('partial text', () => {
  it('never commits while the speaker is still going, however long the pause', async () => {
    const h = app();
    h.a.hear('the dishes for Maya', { final: false });
    await h.advance(60_000);
    expect(h.written).toEqual([]);
    expect(h.a.act?.status).toBe('speculating');
  });

  it('commits once the same text is final', async () => {
    const h = app();
    h.a.hear('the dishes for', { final: false });
    h.a.hear('the dishes for Maya', { final: false });
    h.a.hear('the dishes for Maya', { final: true });
    await h.advance(1400);
    expect(h.written).toEqual(['chore:dishes']);
  });

  it('hands back the speculation so a host can show the tracks', () => {
    const { a } = app();
    const r = a.hear('the dishes', { final: false });
    expect(r.speculation).not.toBeNull();
    expect(r.speculation!.tracks.length).toBeGreaterThan(0);
  });

  it('can be turned off, and then partial text routes like any other', () => {
    const { a } = app({ speculate: false });
    const r = a.hear('the dishes for Maya', { final: false });
    expect(r.speculation).toBeNull();
    expect(a.act?.status).not.toBe('speculating');
  });
});

describe('one turn after another', () => {
  it('starts a fresh act once the last one has landed', async () => {
    const h = app();
    h.a.hear('the dishes for Maya');
    await h.advance(1400);
    expect(h.written).toEqual(['chore:dishes']);

    // The speculator goes on pointing at the settled run, and since the leader
    // has not changed it re-paints instead of starting anything — onto a run
    // that correctly refuses to be painted. Without clearing it, a second
    // sentence does nothing whatsoever.
    const r = h.a.hear('add milk');
    expect(r.act).toBe('add_item');
    expect(r.run?.status).not.toBe('settled');

    await h.advance(1400);
    expect(h.written).toEqual(['chore:dishes', 'item:milk']);
  });

  it('starts a fresh act after the last one was thrown away', () => {
    const h = app();
    h.a.hear('the dishes for Maya');
    h.a.act!.discard();
    const r = h.a.hear('add milk');
    expect(r.act).toBe('add_item');
  });
});

describe('presenters', () => {
  it('draws on every hear without the host asking', () => {
    const drawn: string[] = [];
    const { a } = app({ presenters: [new TextPresenter((s) => drawn.push(s))] });
    a.hear('add milk');
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn[drawn.length - 1]).toContain('add_item');
  });

  it('follows the act when it changes, rather than drawing the old one', () => {
    const drawn: string[] = [];
    const { a } = app({ presenters: [new TextPresenter((s) => drawn.push(s))] });
    a.hear('add milk');
    a.reset();
    a.hear('the dishes for Maya');
    expect(drawn[drawn.length - 1]).toContain('assign_chore');
  });
});

describe('lint', () => {
  it('reports the contract and the design language in one list', () => {
    const { a } = app();
    const out = a.lint();
    // These acts are clean on the language; the contract has notes.
    expect(out.filter((l) => l.level === 'error')).toEqual([]);
    expect(out.length).toBeGreaterThan(0);
  });

  it('catches a design violation through the front door', () => {
    const { a } = app({
      acts: [defineAct({
        name: 'shop_for', domain: 'groceries', phrases: ['shopping'],
        slots: {
          item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 },
          who: { primitive: 'face', options: () => PEOPLE, required: true, order: 2 },
        },
        radius: 'self', commit: () => ({ id: 'x' }), undo: () => {},
      })],
    });
    expect(a.lint().some((l) => l.level === 'error' && /face/.test(l.message))).toBe(true);
  });
});

describe('the routing a host gets is the routing the harness measures', () => {
  it('goes through pickAct, so nothing below tau ever starts', () => {
    const { a } = app();
    const r = a.hear('what is the weather like');
    expect(r.decision.kind).toBe('none');
    expect(r.run).toBeNull();
  });

  it('starts a half-filled card on a bare name, and asks for the rest', async () => {
    const h = app();
    // Board 11: "Mia's face is already lit at the top." A name alone is enough
    // to know the act and not enough to do it, which is a card with one row
    // filled and the next in focus — not a refusal, and not a commit.
    const r = h.a.hear('Maya');
    expect(r.act).toBe('assign_chore');
    const v = r.view!;
    expect(v.slots.find((s) => s.name === 'assignee')!.status).toBe('filled');
    expect(v.slots.filter((s) => s.focused).map((s) => s.name)).toEqual(['chore']);

    await h.advance(60_000);
    expect(h.written).toEqual([]);
  });
});

describe('menus come with the app', () => {
  const build = () => createApp({
    clock: new FakeClock(T0),
    ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }),
    acts: [
      defineAct({ name: 'add_item', domain: 'groceries', phrases: ['add'], radius: 'self',
        slots: { item: { primitive: 'chip', options: () => [{ value: 'milk', label: 'Milk' }], required: true, order: 1 } },
        commit: () => ({ id: '1' }), undo: () => {} }),
      defineAct({ name: 'clear_list', domain: 'groceries', phrases: ['clear'], radius: 'self',
        slots: { sure: { primitive: 'chip', options: () => [{ value: 'yes', label: 'Yes' }], required: true, order: 1 } },
        commit: () => ({ id: '2' }), undo: () => {} }),
      defineAct({ name: 'pay_allowance', domain: 'money', phrases: ['pay'], radius: 'external',
        slots: { amount: { primitive: 'chip', options: () => [{ value: 5, label: '$5' }], required: true, order: 1 } },
        commit: () => ({ id: '3' }) }),
    ],
  });

  it('generates them from the acts, with nobody writing one', () => {
    const app = build();
    expect(app.menus.view().items.map((i) => i.id)).toEqual(['groceries', 'pay_allowance']);
  });

  it('puts a picked act on the stage empty, waiting — picking a name is not consent', () => {
    const app = build();
    const run = app.pick('pay_allowance')!;
    expect(run.def.name).toBe('pay_allowance');
    expect(app.view()!.slots.every((s) => s.status === 'empty')).toBe(true);
    expect(app.view()!.canAssent).toBe(false);
  });

  it('starts nothing when what was picked is a menu, not an act', () => {
    const app = build();
    expect(app.pick('groceries')).toBeNull();
    expect(app.act).toBeNull();
  });
});
