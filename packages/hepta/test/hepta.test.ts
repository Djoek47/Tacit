import { describe, expect, it } from 'vitest';

import { createAIUIC, defineAct, FakeClock, type ActDef, type Ctx } from '@intermenu/aiuic-core';
import { LocalResolver, type OptionsFor } from '@intermenu/aiuic-resolve';
import { Speculator, explainTracks } from '../src/index.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));

const SAM = { id: 'sam', label: 'Sam' };
const MAYA = { id: 'maya', label: 'Maya' };
const PEOPLE = [
  { value: SAM, label: 'Sam' },
  { value: MAYA, label: 'Maya' },
];
const ERRANDS = [
  { value: 'parcel', label: 'the parcel', aliases: ['parcel'] },
  { value: 'recycling', label: 'the recycling', aliases: ['recycling'] },
];

const optionsFor: OptionsFor = (_a, slot) =>
  slot === 'assignee' || slot === 'payee' ? PEOPLE : slot === 'errand' ? ERRANDS : [];

function build() {
  const clock = new FakeClock(T0);
  const committed: string[] = [];
  const ctx = (): Ctx =>
    ({
      now: new Date(clock.now()),
      actor: { id: 'me', basePauseMs: 850 },
      attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
      reachLimit: 1,
      undoWindowMs: 5000,
    }) as Ctx;

  const ui = createAIUIC({ clock, ctx });

  const assign: ActDef = defineAct({
    name: 'assign_errand',
    phrases: ['picks up', 'grabs', 'assign'],
    slots: {
      assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      errand: { primitive: 'chip', options: () => ERRANDS, required: true, order: 2 },
    },
    radius: { max: 'other-person', of: () => 'other-person' },
    commit: () => { committed.push('assign'); return { id: 'e1' }; },
    undo: () => { committed.pop(); },
  });

  const pay: ActDef = defineAct({
    name: 'settle_up',
    phrases: ['pay', 'pay back', 'send money'],
    slots: {
      payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      amount: {
        primitive: 'quantity',
        resolve: (t) => {
          const m = /\b(\d+)\b/.exec(t);
          return m ? [{ value: Number(m[1]), score: 1 }] : [];
        },
        required: true,
        order: 2,
      },
    },
    radius: 'external',
    commit: () => { committed.push('pay'); return { id: 'p1' }; },
  });

  ui.defineAct(assign);
  ui.defineAct(pay);

  const spec = new Speculator(ui, new LocalResolver(), optionsFor);
  return { ui, clock, ctx, spec, committed, async advance(ms: number) { clock.advance(ms); await tick(); } };
}

describe('hepta — seven tongues', () => {
  it('paints the leader from a partial utterance', () => {
    const h = build();
    const s = h.spec.feed({ text: 'Sam picks up the parcel', final: false }, h.ctx());
    expect(s.leader).toBe('assign_errand');
    expect(h.spec.currentRun?.status).toBe('speculating');
    expect(h.spec.currentRun?.slots.assignee?.value).toBe(SAM);
    expect(h.spec.currentRun?.slots.errand?.value).toBe('parcel');
  });

  it('never reaches HOLD while the speaker is still talking', async () => {
    const h = build();
    for (const text of ['Sam', 'Sam picks', 'Sam picks up', 'Sam picks up the parcel']) {
      const s = h.spec.feed({ text, final: false }, h.ctx());
      expect(s.run).toBeNull();
      expect(h.spec.currentRun?.status).not.toBe('hold');
    }
    // A full second of "silence" mid-sentence commits nothing.
    await h.advance(2000);
    expect(h.committed).toHaveLength(0);
  });

  it('hands over to the commit contract the moment speech settles', async () => {
    const h = build();
    h.spec.feed({ text: 'Sam picks up the parcel', final: false }, h.ctx());
    const s = h.spec.feed({ text: 'Sam picks up the parcel', final: true }, h.ctx());

    expect(s.run).not.toBeNull();
    expect(s.run!.status).toBe('hold');
    expect(s.run!.holdDurationMsValue).toBe(1360); // other-person, not self

    await h.advance(1400);
    expect(h.committed).toEqual(['assign']);
  });

  it('keeps several acts alive at once, with only one on the stage', () => {
    const h = build();
    const early = h.spec.feed({ text: 'Sam', final: false }, h.ctx());
    expect(early.tracks.map((t) => t.act).sort()).toEqual(['assign_errand', 'settle_up']);

    // More words settle who leads, but a still-plausible act stays alive as a
    // shadow. That is the point: the tongue keeps turning on the alternative.
    const late = h.spec.feed({ text: 'Sam picks up the parcel', final: false }, h.ctx());
    expect(late.leader).toBe('assign_errand');
    expect(late.tracks.map((t) => t.act)).toContain('settle_up');
    expect(late.tracks.filter((t) => t.leading)).toHaveLength(1);
  });

  it('prunes a track once the words rule it out', () => {
    const h = build();
    h.spec.feed({ text: 'Sam', final: false }, h.ctx());
    const s = h.spec.feed({ text: 'the parcel', final: false }, h.ctx());
    expect(s.pruned).toContain('settle_up');
    expect(s.tracks.map((t) => t.act)).toEqual(['assign_errand']);
  });

  it('switches the stage only when a challenger is clearly ahead', () => {
    const h = build();
    h.spec.feed({ text: 'Sam', final: false }, h.ctx());
    const first = h.spec.leaderName;
    const s = h.spec.feed({ text: 'pay Sam 20', final: false }, h.ctx());
    expect(s.leader).toBe('settle_up');
    expect(s.switched).toBe(true);
    expect(first).not.toBe('settle_up');
  });

  it('still refuses to commit an external act once speech settles', async () => {
    const h = build();
    h.spec.feed({ text: 'pay Sam 20', final: false }, h.ctx());
    const s = h.spec.feed({ text: 'pay Sam 20', final: true }, h.ctx());
    expect(s.run!.radius).toBe('external');
    expect(s.run!.status).toBe('explicit');
    await h.advance(60_000);
    expect(h.committed).toHaveLength(0);
  });

  it('refuses to be assented to while still speculating', async () => {
    const h = build();
    h.spec.feed({ text: 'Sam picks up the parcel', final: false }, h.ctx());
    await expect(h.spec.currentRun!.assent()).rejects.toThrow(/settle it first/);
  });

  it('drops everything on reset', () => {
    const h = build();
    h.spec.feed({ text: 'Sam picks up the parcel', final: false }, h.ctx());
    h.spec.reset();
    expect(h.spec.currentRun).toBeNull();
  });

  it('explains its tracks for a readout', () => {
    const h = build();
    const s = h.spec.feed({ text: 'Sam', final: false }, h.ctx());
    const rows = explainTracks(s);
    expect(rows.length).toBe(s.tracks.length);
    expect(rows.some((r) => r.lead)).toBe(true);
    expect(rows[0]!.score).toMatch(/^\d\.\d\d$/);
  });
});
