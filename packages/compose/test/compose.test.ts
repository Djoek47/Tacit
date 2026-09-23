import { describe, expect, it } from 'vitest';
import { createAIUIC, FakeClock, type Ctx } from '@intermenu/aiuic-core';
import { ComposeError, Composer, type ActSpec, type Capability } from '../src/index.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));

function build() {
  const log: string[] = [];
  const clock = new FakeClock(T0);
  const ui = createAIUIC({
    clock,
    ctx: () => ({
      actor: { id: 'me', basePauseMs: 850 },
      attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
      reachLimit: 1, undoWindowMs: 5000,
    }),
  });

  const c = new Composer();

  const draft: Capability = {
    name: 'draft_plan',
    describe: 'Write a plan into the user’s own notes. Reversible, nobody else sees it.',
    radius: 'self',
    run: (f) => { log.push('draft:' + JSON.stringify(f)); return { id: 'd1' }; },
    undo: () => { log.pop(); },
    catalogs: { cities: () => [{ value: 'yul', label: 'Montréal' }, { value: 'nrt', label: 'Tokyo' }] },
  };

  const pay: Capability = {
    name: 'charge_card',
    describe: 'Take money from the stored card.',
    radius: 'external',
    requires: { amount: 'quantity' },
    run: () => ({ id: 'c1' }),
    effects: [{ name: 'settle', run: () => { log.push('charged'); }, radius: 'external', reversible: false, deferrable: false }],
  };

  c.register(draft);
  c.register(pay);
  return { ui, c, log, clock, async advance(ms: number) { clock.advance(ms); await tick(); } };
}

const ticketSpec: ActSpec = {
  name: 'book_tickets',
  capability: 'draft_plan',
  phrases: ['book', 'tickets', 'fly'],
  slots: {
    destination: { primitive: 'chip', catalog: 'cities', required: true, order: 1 },
    depart: { primitive: 'when', params: { granularity: 'day' }, required: true, order: 2 },
    travellers: { primitive: 'quantity', params: { min: 1, max: 9 }, order: 3 },
  },
};

describe('runtime act composition', () => {
  it('builds an act that did not exist a second ago', async () => {
    const h = build();
    const def = h.c.compose(ticketSpec);
    h.ui.defineAct(def);

    const run = h.ui.start('book_tickets');
    run.setValue('destination', 'nrt', 'spoken');
    run.setValue('depart', 'friday', 'spoken');

    expect(run.status).toBe('hold');
    await h.advance(900);
    expect(h.log[0]).toMatch(/^draft:/);
  });

  it('takes its options from a host catalog, not from the model', () => {
    const h = build();
    const def = h.c.compose(ticketSpec);
    const opts = def.slots.destination!.options!({} as Ctx, {});
    expect(opts).toEqual([
      { value: 'yul', label: 'Montréal' },
      { value: 'nrt', label: 'Tokyo' },
    ]);
  });

  it('refuses a capability the host never registered', () => {
    const h = build();
    expect(() => h.c.compose({ ...ticketSpec, capability: 'transfer_everything' }))
      .toThrow(/unknown capability/);
  });

  it('refuses a primitive outside the closed set', () => {
    const h = build();
    expect(() =>
      h.c.compose({
        name: 'weird', capability: 'draft_plan',
        slots: { x: { primitive: 'iframe', order: 1 } },
      }),
    ).toThrow(/primitive set is closed|not in the primitive set/);
  });

  it('refuses a spec that tries to declare its own cost', () => {
    const h = build();
    const sneaky = { ...ticketSpec, radius: 'self' } as unknown as ActSpec;
    expect(() => h.c.compose(sneaky)).toThrow(/may not set "radius"/);
  });

  it('refuses a spec carrying a function anywhere in it', () => {
    const h = build();
    const sneaky = {
      ...ticketSpec,
      slots: { ...ticketSpec.slots, evil: { primitive: 'chip', order: 4, params: { onTap: () => 'boom' } } },
    } as unknown as ActSpec;
    expect(() => h.c.compose(sneaky)).toThrow(/functions are not allowed/);
  });

  it('cannot lower blast radius by composing around it', async () => {
    const h = build();
    // The model asks for a tiny, friendly-looking act. The capability is a charge.
    const def = h.c.compose({
      name: 'just_a_little_one',
      capability: 'charge_card',
      slots: { amount: { primitive: 'quantity', order: 1 } },
    });
    expect(def.radius).toBe('external');

    h.ui.defineAct(def);
    const run = h.ui.start('just_a_little_one');
    run.setValue('amount', 4000, 'spoken');

    expect(run.radius).toBe('external');
    expect(run.status).toBe('explicit');
    await h.advance(60_000);
    expect(h.log).not.toContain('charged');
  });

  it('forces the slots a capability cannot run without', () => {
    const h = build();
    expect(() =>
      h.c.compose({ name: 'no_amount', capability: 'charge_card', slots: { note: { primitive: 'ghostField', order: 1 } } }),
    ).toThrow(/requires a "amount" slot/);
  });

  it('forces the right primitive for a required slot', () => {
    const h = build();
    expect(() =>
      h.c.compose({ name: 'wrong_kind', capability: 'charge_card', slots: { amount: { primitive: 'ghostField', order: 1 } } }),
    ).toThrow(/requires primitive "quantity"/);
  });

  it('rejects an unbounded option list', () => {
    const h = build();
    const many = Array.from({ length: 200 }, (_, i) => ({ value: i, label: 'x' + i }));
    expect(() =>
      h.c.compose({ name: 'huge', capability: 'draft_plan', slots: { x: { primitive: 'chip', order: 1, options: many } } }),
    ).toThrow(/at most 40 options/);
  });

  it('rejects a junk name, an empty act, and bad JSON', () => {
    const h = build();
    expect(() => h.c.compose({ ...ticketSpec, name: '../../etc/passwd' })).toThrow(/not a valid act name/);
    expect(() => h.c.compose({ name: 'empty', capability: 'draft_plan', slots: {} })).toThrow(/at least one slot/);
    expect(() => h.c.composeJson('{nope')).toThrow(ComposeError);
  });

  it('still runs every definition-time check on a composed act', () => {
    const h = build();
    const c = new Composer();
    // Reversible-looking capability below external, with no undo: defineAct catches it.
    c.register({ name: 'oops', describe: 'x', radius: 'shared', run: () => ({ id: '1' }) });
    expect(() => c.compose({ name: 'oops_act', capability: 'oops', slots: { a: { primitive: 'chip', order: 1 } } }))
      .toThrow(/no undo\(\)/);
  });

  it('offers the model a data-only menu of what it may build on', () => {
    const h = build();
    const menu = h.c.menu();
    expect(menu.map((m) => m.capability).sort()).toEqual(['charge_card', 'draft_plan']);
    expect(JSON.stringify(menu)).not.toMatch(/function/);
    expect(menu.find((m) => m.capability === 'draft_plan')!.catalogs).toEqual(['cities']);
  });
});
