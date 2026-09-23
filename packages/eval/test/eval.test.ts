import { describe, expect, it } from 'vitest';
import { defineAct, type ActDef, type Ctx, type Option } from '@intermenu/aiuic-core';
import { LocalResolver } from '@intermenu/aiuic-resolve';
import { resolveQuantity, resolveWhen } from '@intermenu/aiuic-resolve';
import {
  applyTemperature, calibrationError, fitTemperature, formatReport, reliability, runSuite, sweep,
  type Case, type Resolve,
} from '../src/index.js';

/* A household with two people whose names sound alike on purpose: that is where
   confident mistakes come from, and confident mistakes are what this measures. */
const DRAKO = { id: 'drako', label: 'Drako' };
const DRACO = { id: 'draco', label: 'Draco' };
const MAYA = { id: 'maya', label: 'Maya' };

const PEOPLE: Option[] = [
  { value: DRAKO, label: 'Drako' },
  { value: DRACO, label: 'Draco' },
  { value: MAYA, label: 'Maya' },
];
const CHORES: Option[] = [
  { value: 'dishes', label: 'dishes' },
  { value: 'trash', label: 'trash', aliases: ['bins'] },
];

const optionsFor = (_a: ActDef, slot: string) =>
  slot === 'assignee' || slot === 'payee' ? PEOPLE : slot === 'chore' ? CHORES : [];

const assign = defineAct({
  name: 'assign_chore', phrases: ['for', 'assign'],
  slots: {
    assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    chore: { primitive: 'chip', options: () => CHORES, required: true, order: 2 },
    due: { primitive: 'when', resolve: resolveWhen, order: 3 },
  },
  radius: { max: 'other-person', of: () => 'other-person' },
  commit: () => ({ id: '1' }), undo: () => {},
});

const pay = defineAct({
  name: 'settle_up', phrases: ['pay', 'pay back'],
  slots: {
    payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    amount: { primitive: 'quantity', resolve: resolveQuantity, required: true, order: 2 },
  },
  radius: 'external',
  commit: () => ({ id: '2' }),
});

const ACTS = [assign, pay];
const ctx = { now: new Date('2026-09-23T14:00:00'), actor: { id: 'me' } } as Ctx;

const local = new LocalResolver();
const resolve: Resolve = {
  score: (text, acts, c, o) => local.scoreSync(text, acts, c, o).map((s) => ({ act: s.act, score: s.score })),
  fill: (text, act, c, o) => local.fillSync(text, act, {}, c, o),
};

const CASES: Case[] = [
  { text: 'dishes for Maya', act: 'assign_chore', slots: { assignee: MAYA, chore: 'dishes' } },
  { text: 'trash for Maya tomorrow', act: 'assign_chore', slots: { assignee: MAYA, chore: 'trash' } },
  { text: 'take the bins out, Maya', act: 'assign_chore', slots: { assignee: MAYA, chore: 'trash' } },
  { text: 'pay Maya twelve dollars', act: 'settle_up', slots: { payee: MAYA, amount: { n: 12 } } },
  { text: 'pay Maya back 20', act: 'settle_up', slots: { payee: MAYA, amount: { n: 20 } } },
  { text: 'what is the weather', act: null },
];

describe('running a suite', () => {
  it('counts routing and every slot outcome', () => {
    const r = runSuite(CASES, ACTS, resolve, optionsFor, ctx);
    expect(r.cases).toBe(6);
    expect(r.routing.right).toBeGreaterThanOrEqual(5);
    expect(r.slots.total).toBeGreaterThan(0);
    expect(r.slots['confirmed-right']).toBeGreaterThan(0);
  });

  it('keeps a confident miss apart from every other kind of miss', () => {
    // "Drako" and "Draco" differ by one character, so a confident pick between
    // them is exactly the failure the contract cannot catch.
    const hard: Case[] = [{ text: 'dishes for Draco', act: 'assign_chore', slots: { assignee: DRACO, chore: 'dishes' } }];
    const r = runSuite(hard, ACTS, resolve, optionsFor, ctx);
    const outcome = r.results[0]!.slots.assignee!.outcome;
    // Either it narrows (safe) or it is provisional (safe). It must not confirm
    // the wrong one, and if it confirms it must be right.
    expect(['narrowed', 'provisional-right', 'provisional-wrong', 'confirmed-right']).toContain(outcome);
  });

  it('reports a false confirm rate and names the sentences behind it', () => {
    const wrong: Case[] = [
      { text: 'dishes for Maya', act: 'assign_chore', slots: { assignee: DRAKO } }, // deliberately mislabelled
    ];
    const r = runSuite(wrong, ACTS, resolve, optionsFor, ctx);
    expect(r.slots['confirmed-wrong']).toBe(1);
    expect(r.falseConfirmRate).toBe(1);
    expect(r.dangerous).toHaveLength(1);
    expect(formatReport(r)).toMatch(/confident and wrong/);
  });

  it('flags a slot found where none was expected', () => {
    const r = runSuite(
      [{ text: 'dishes for Maya', act: 'assign_chore', slots: { chore: 'dishes' } }],
      ACTS, resolve, optionsFor, ctx,
    );
    expect(r.results[0]!.slots.assignee?.outcome).toBe('spurious');
  });

  it('formats a report a person can read', () => {
    const out = formatReport(runSuite(CASES, ACTS, resolve, optionsFor, ctx));
    expect(out).toMatch(/FALSE CONFIRM/);
    expect(out).toMatch(/silence-commits a mistake/);
  });
});

describe('calibration', () => {
  it('a perfectly calibrated set has almost no error', () => {
    const samples = [];
    for (let i = 0; i < 1000; i++) {
      const score = (i % 10) / 10 + 0.05;
      samples.push({ score, correct: (i % 100) / 100 < score });
    }
    expect(calibrationError(samples)).toBeLessThan(0.1);
  });

  it('catches a producer that is confidently wrong', () => {
    // Everything claims 0.95; only half are right. That is the SemIf problem.
    const samples = Array.from({ length: 200 }, (_, i) => ({ score: 0.95, correct: i % 2 === 0 }));
    expect(calibrationError(samples)).toBeGreaterThan(0.4);
  });

  it('bins the reliability curve with claimed against actual', () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ score: 0.9, correct: i < 50 }));
    const bins = reliability(samples).filter((b) => b.n > 0);
    expect(bins).toHaveLength(1);
    expect(bins[0]!.claimed).toBeCloseTo(0.9, 2);
    expect(bins[0]!.actual).toBeCloseTo(0.5, 2);
  });

  it('temperature pulls an over-confident score back', () => {
    expect(applyTemperature(0.95, 3)).toBeLessThan(0.95);
    expect(applyTemperature(0.95, 0.5)).toBeGreaterThan(0.95);
    expect(applyTemperature(0.5, 4)).toBeCloseTo(0.5, 6);
  });

  it('fits a temperature that lowers the error it was given', () => {
    const samples = Array.from({ length: 300 }, (_, i) => ({ score: 0.95, correct: i % 10 < 6 }));
    const before = calibrationError(samples);
    const T = fitTemperature(samples);
    const after = calibrationError(samples.map((s) => ({ ...s, score: applyTemperature(s.score, T) })));
    expect(T).toBeGreaterThan(1);
    expect(after).toBeLessThan(before);
  });

  it('refuses to fit on too little data rather than pretending', () => {
    expect(fitTemperature([{ score: 0.9, correct: true }])).toBe(1);
  });
});

describe('sweeping thresholds', () => {
  it('shows the trade rather than picking for you', () => {
    const grid = [
      { tauFill: 0.6, deltaFill: 0.1 },
      { tauFill: 0.85, deltaFill: 0.15 },
      { tauFill: 0.99, deltaFill: 0.3 },
    ];
    const rows = sweep(CASES, ACTS, resolve, optionsFor, ctx, grid,
      (c, tau, delta) => {
        const ranked = [...c].sort((a, b) => b.score - a.score);
        const best = ranked[0];
        if (!best) return { outcome: 'empty', provisional: false, ranked };
        const lead = best.score - (ranked[1]?.score ?? 0);
        if (best.score >= tau && lead >= delta) {
          return { outcome: 'filled', value: best.value, provisional: best.calibrated === false, ranked };
        }
        return { outcome: 'filled', value: best.value, provisional: true, ranked };
      });

    expect(rows).toHaveLength(3);
    // The strictest setting confirms least and asks most. That is the trade.
    expect(rows[2]!.confirmedRight).toBeLessThanOrEqual(rows[0]!.confirmedRight);
    expect(rows[2]!.extraBeats).toBeGreaterThanOrEqual(rows[0]!.extraBeats);
  });
});
