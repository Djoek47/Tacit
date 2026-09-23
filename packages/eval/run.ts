/**
 * Run the seed suite against the current local resolver and print the numbers.
 *
 *   npm run eval
 *
 * The false-confirm rate is the one to watch. Everything else is context.
 */

import { defineAct, type ActDef, type Ctx } from '@intermenu/aiuic-core';
import { LocalResolver, pickAct, resolveQuantity, resolveWhen } from '@intermenu/aiuic-resolve';
import { formatReport, runSuite, sweep, type Resolve } from './src/index.js';
import { CHORES, PEOPLE, household } from './suites/household.js';

const optionsFor = (_a: ActDef, slot: string) =>
  slot === 'assignee' || slot === 'payee' ? PEOPLE : slot === 'chore' ? CHORES : [];

const ACTS: ActDef[] = [
  defineAct({
    name: 'assign_chore', phrases: ['for', 'assign', 'can do', 'should'],
    slots: {
      assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      chore: { primitive: 'chip', options: () => CHORES, required: true, order: 2 },
      due: { primitive: 'when', resolve: resolveWhen, order: 3 },
    },
    radius: { max: 'other-person', of: () => 'other-person' },
    commit: () => ({ id: '1' }), undo: () => {},
  }),
  defineAct({
    name: 'settle_up', phrases: ['pay', 'pay back', 'send', 'settle up'],
    slots: {
      payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      amount: { primitive: 'quantity', resolve: resolveQuantity, required: true, order: 2 },
    },
    radius: 'external',
    commit: () => ({ id: '2' }),
  }),
];

const ctx = { now: new Date(), actor: { id: 'me' } } as Ctx;
const local = new LocalResolver();
const resolve: Resolve = {
  // Route the way the app routes: thresholds applied, ties narrowed, and
  // nothing returned when nothing clears the bar.
  score: (t, a, c, o) => {
    const scores = local.scoreSync(t, a, c, o);
    const d = pickAct(scores);
    if (d.kind === 'none') return [];
    const top = d.kind === 'start' ? d.act : d.acts[0]!;
    return scores.filter((s) => s.act === top).map((s) => ({ act: s.act, score: s.score }));
  },
  fill: (t, a, c, o) => local.fillSync(t, a, {}, c, o),
};

const report = runSuite(household, ACTS, resolve, optionsFor, ctx);
console.log(formatReport(report));

console.log('\nrouting misses:');
for (const r of report.results.filter((x) => !x.routedRight)) {
  console.log(`  "${r.case.text}"  -> ${r.routedTo ?? 'nothing'}  (want ${r.case.act ?? 'nothing'}, ${r.topScore.toFixed(2)})`);
}

console.log('\nthreshold sweep  (tau / delta -> false-confirm, confirmed-right, extra beats)');
const grid = [0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1].flatMap((tauFill) =>
  [0.1, 0.15, 0.25].map((deltaFill) => ({ tauFill, deltaFill })),
);
for (const row of sweep(household, ACTS, resolve, optionsFor, ctx, grid)) {
  console.log(
    `  ${row.tauFill.toFixed(2)} / ${row.deltaFill.toFixed(2)}` +
    `   ${(row.falseConfirmRate * 100).toFixed(1).padStart(5)}%` +
    `   ${String(row.confirmedRight).padStart(3)}` +
    `   ${String(row.extraBeats).padStart(3)}`,
  );
}
