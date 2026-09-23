import { describe, expect, it } from 'vitest';
import { createAIUIC, defineAct, FakeClock, type ActDef, type Ctx } from '@intermenu/aiuic-core';
import { Recorder, explain, lintActs } from '../src/index.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));

const SAM = { id: 'sam', label: 'Sam' };
const MAYA = { id: 'maya', label: 'Maya' };
const PEOPLE = [{ value: SAM, label: 'Sam' }, { value: MAYA, label: 'Maya' }];

function build(attention = { foreground: true, unlocked: true, proximityClear: true, listening: true }) {
  const clock = new FakeClock(T0);
  const ctx = (): Ctx =>
    ({ now: new Date(clock.now()), actor: { id: 'me', basePauseMs: 850 }, attention,
       reachLimit: 1, undoWindowMs: 5000 }) as Ctx;
  const ui = createAIUIC({ clock, ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }) });

  ui.defineAct(defineAct({
    name: 'assign_errand', phrases: ['picks up'],
    slots: {
      assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      errand: { primitive: 'chip', options: () => [], required: true, order: 2 },
    },
    radius: { max: 'other-person', of: () => 'other-person' },
    commit: () => ({ id: 'e1' }), undo: () => {},
    effects: [{ name: 'notify', run: () => {}, radius: 'other-person', reversible: true, deferrable: true, reach: () => 1 }],
  }));

  ui.defineAct(defineAct({
    name: 'settle_up', phrases: ['pay'],
    slots: { payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 } },
    radius: 'external',
    commit: () => ({ id: 'p1' }),
    effects: [{ name: 'transfer', run: () => {}, radius: 'external', reversible: false, deferrable: false }],
  }));

  return { ui, ctx, clock, async advance(ms: number) { clock.advance(ms); await tick(); } };
}

describe('explain', () => {
  it('names the slot to fill first, in declared order', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    const e = explain(run, h.ctx());
    expect(e.reasons[0]).toEqual({ kind: 'missing', slot: 'assignee' });
    expect(e.summary).toMatch(/"assignee" is empty and required/);
  });

  it('moves on to the next gap once the first is filled', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    expect(explain(run, h.ctx()).reasons[0]).toEqual({ kind: 'missing', slot: 'errand' });
  });

  it('says how long the silence has to last once nothing is blocking', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    run.setValue('errand', 'parcel', 'spoken');
    const e = explain(run, h.ctx());
    expect(e.reasons[0]?.kind).toBe('ready');
    expect(e.summary).toMatch(/silence will commit it/);
  });

  it('explains a weak match as too weak for this radius', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.offer('assignee', [{ value: SAM, score: 0.6 }], 'spoken');
    run.setValue('errand', 'parcel', 'spoken');
    const r = explain(run, h.ctx()).reasons.find((x) => x.kind === 'provisional');
    expect(r).toBeTruthy();
    expect(explain(run, h.ctx()).summary + '').toBeTruthy();
  });

  it('names the effect that forced external, not just the verdict', () => {
    const h = build();
    const run = h.ui.start('settle_up');
    run.setValue('payee', SAM, 'spoken');
    const r = explain(run, h.ctx()).reasons.find((x) => x.kind === 'external');
    expect(r && 'because' in r && r.because).toMatch(/transfer/);
  });

  it('reports gate failures rather than a bare refusal', () => {
    const h = build({ foreground: true, unlocked: false, proximityClear: false, listening: true });
    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    run.setValue('errand', 'parcel', 'spoken');
    const r = explain(run, h.ctx()).reasons.find((x) => x.kind === 'gate');
    expect(r && 'failures' in r && r.failures.join(' ')).toMatch(/device locked/);
  });

  it('says so when it already committed', async () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    run.setValue('errand', 'parcel', 'spoken');
    await h.advance(1400);
    expect(explain(run, h.ctx()).reasons[0]).toEqual({ kind: 'settled' });
  });
});

describe('recorder', () => {
  it('writes a timeline you can read', async () => {
    const h = build();
    const rec = new Recorder(() => h.clock.now());
    rec.attach(h.ui);

    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    run.setValue('errand', 'parcel', 'spoken');
    await h.advance(1400);

    const t = rec.timeline();
    expect(t).toMatch(/HOLD\s+assign_errand\s+1360ms at other-person/);
    expect(t).toMatch(/COMMIT\s+assign_errand/);
    expect(t).not.toMatch(/stage/);
  });

  it('counts the things that matter when something feels wrong', async () => {
    const h = build();
    const rec = new Recorder(() => h.clock.now());
    rec.attach(h.ui);

    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    run.setValue('errand', 'parcel', 'spoken');
    run.setValue('assignee', MAYA, 'touched');   // restarts the clock
    await h.advance(1400);

    const s = rec.stats();
    expect(s.commits).toBe(1);
    expect(s.cancels).toBeGreaterThanOrEqual(1);
    expect(s.medianHoldMs).toBe(1360);
  });

  it('stops cleanly and exports', () => {
    const h = build();
    const rec = new Recorder(() => h.clock.now());
    const off = rec.attach(h.ui);
    h.ui.start('assign_errand');
    off();
    h.ui.start('settle_up');
    expect(JSON.parse(rec.toJSON()).version).toBe(1);
  });
});

describe('lint', () => {
  const bad: ActDef[] = [
    defineAct({
      name: 'instant',
      slots: { note: { primitive: 'ghostField', options: () => [], order: 1 } },
      radius: 'self', commit: () => ({ id: '1' }), undo: () => {},
    }),
    defineAct({
      name: 'needs_model',
      phrases: ['draft'],
      slots: { body: { primitive: 'ghostField', fill: 'model', options: () => [], required: true, order: 1 } },
      radius: 'self', commit: () => ({ id: '2' }), undo: () => {},
    }),
  ];

  it('flags an act that holds the instant it starts', () => {
    expect(lintActs(bad).some((l) => l.act === 'instant' && /no required slots/.test(l.message))).toBe(true);
  });

  it('flags an act with no offline path', () => {
    expect(lintActs(bad).some((l) => l.act === 'needs_model' && /no offline path/.test(l.message))).toBe(true);
  });

  it('notices two acts fighting over a phrase', () => {
    const a = defineAct({ name: 'a', phrases: ['move'], slots: { x: { primitive: 'chip', options: () => [], required: true, order: 1 } }, radius: 'self', commit: () => ({ id: '1' }), undo: () => {} });
    const b = defineAct({ name: 'b', phrases: ['move'], slots: { y: { primitive: 'chip', options: () => [], required: true, order: 1 } }, radius: 'self', commit: () => ({ id: '2' }), undo: () => {} });
    expect(lintActs([a, b]).some((l) => /shares the phrase "move"/.test(l.message))).toBe(true);
  });

  it('separates what will bite from what is merely worth knowing', () => {
    const ls = lintActs(bad);
    expect(ls.some((l) => l.level === 'warn')).toBe(true);
    expect(ls.some((l) => l.level === 'note')).toBe(true);
  });
});
