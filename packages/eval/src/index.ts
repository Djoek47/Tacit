/**
 * Measuring the thing that decides whether silence-assent is safe.
 *
 * τ_fill, δ and the routing weights are guesses. They will stay guesses until
 * somebody runs real sentences through them and counts what happened. This is
 * the counting.
 *
 * One number matters more than the rest:
 *
 *   FALSE CONFIRM RATE — how often a slot is filled CONFIDENTLY and WRONGLY.
 *
 * A confident miss is the only failure the contract cannot catch. A provisional
 * miss holds and waits; an empty slot asks. A confident miss silence-commits
 * the wrong thing, and the user finds out afterwards. Everything else here is
 * context for that number.
 */

import type { ActDef, Candidate, Ctx, Option } from '@intermenu/aiuic-core';
import { classify } from '@intermenu/aiuic-core';

export type OptionsFor = (act: ActDef, slot: string) => Option[];

/** One labelled sentence. `slots` holds what the right answer is. */
export type Case = {
  text: string;
  /** The act it should route to, or null when it should route to nothing. */
  act: string | null;
  slots?: Record<string, unknown>;
  /** Free-text note explaining what this case is probing. */
  note?: string;
};

export type Resolve = {
  /**
   * Must apply the host's own routing thresholds. Handing back raw scores makes
   * the suite measure a router nobody ships — the first version of this file
   * did exactly that and reported two routing misses that were not misses.
   */
  score(text: string, acts: ActDef[], ctx: Ctx, optionsFor: OptionsFor): { act: string; score: number }[];
  fill(text: string, act: ActDef, ctx: Ctx, optionsFor: OptionsFor): Record<string, Candidate[]>;
};

export type SlotOutcome =
  /** Filled, confirmed, correct. The good case. */
  | 'confirmed-right'
  /** Filled, confirmed, WRONG. The only outcome the contract cannot catch. */
  | 'confirmed-wrong'
  /** Filled but flagged unsure, correct. Costs a beat, costs nothing else. */
  | 'provisional-right'
  | 'provisional-wrong'
  /** Narrowed — it declined to choose. Safe. */
  | 'narrowed'
  /** Nothing found, and something was expected. */
  | 'missed'
  /** Something found where nothing was expected. */
  | 'spurious';

export type CaseResult = {
  case: Case;
  routedTo: string | null;
  routedRight: boolean;
  topScore: number;
  slots: Record<string, { outcome: SlotOutcome; expected?: unknown; got?: unknown; score: number }>;
};

export type Report = {
  cases: number;
  routing: { right: number; wrong: number; accuracy: number };
  slots: Record<SlotOutcome, number> & { total: number };
  /** The headline. Confident and wrong, over everything confidently filled. */
  falseConfirmRate: number;
  /** Cases where a confident miss happened, so you can read them. */
  dangerous: CaseResult[];
  results: CaseResult[];
};

const EMPTY_SLOTS = (): Report['slots'] => ({
  'confirmed-right': 0, 'confirmed-wrong': 0,
  'provisional-right': 0, 'provisional-wrong': 0,
  narrowed: 0, missed: 0, spurious: 0, total: 0,
});

/**
 * Does `got` satisfy `expected`?
 *
 * An expectation is a PARTIAL spec, not a deep equal. Labelling a case as
 * `{ n: 12 }` says "twelve, and I do not care what else the grammar attaches" —
 * writing out `{ n: 12, label: '$12', unit: 'USD' }` in forty cases would only
 * test that the formatter has not changed. Identity wins where there is one:
 * two options with the same `id` are the same option whatever their labels say.
 */
export function satisfies(got: unknown, expected: unknown): boolean {
  if (got === expected) return true;

  if (expected && typeof expected === 'object' && got && typeof got === 'object') {
    const g = got as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    if (typeof e.id === 'string' && typeof g.id === 'string') return e.id === g.id;
    return Object.keys(e).every((k) => satisfies(g[k], e[k]));
  }

  if (expected && typeof expected === 'object') return false;
  return String(got) === String(expected);
}

const same = satisfies;

export function runSuite(
  cases: Case[],
  acts: ActDef[],
  resolve: Resolve,
  optionsFor: OptionsFor,
  ctx: Ctx,
): Report {
  const results: CaseResult[] = [];
  const slots = EMPTY_SLOTS();
  let right = 0;

  for (const c of cases) {
    const scores = resolve.score(c.text, acts, ctx, optionsFor);
    const top = scores[0];
    const routedTo = top && top.score > 0 ? top.act : null;
    const routedRight = routedTo === c.act;
    if (routedRight) right++;

    const slotResults: CaseResult['slots'] = {};
    const def = acts.find((a) => a.name === (c.act ?? routedTo));

    if (def && c.slots) {
      const filled = resolve.fill(c.text, def, ctx, optionsFor);
      const names = new Set([...Object.keys(c.slots), ...Object.keys(filled)]);

      for (const name of names) {
        const expected = c.slots[name];
        const cands = filled[name] ?? [];
        const verdict = classify(cands);
        const score = cands[0]?.score ?? 0;

        let outcome: SlotOutcome;
        if (expected === undefined) {
          outcome = verdict.outcome === 'empty' ? 'narrowed' : 'spurious';
        } else if (verdict.outcome === 'empty') {
          outcome = 'missed';
        } else if (verdict.outcome === 'narrowed') {
          outcome = 'narrowed';
        } else {
          const correct = satisfies(verdict.value, expected);
          outcome = verdict.provisional
            ? (correct ? 'provisional-right' : 'provisional-wrong')
            : (correct ? 'confirmed-right' : 'confirmed-wrong');
        }

        slots[outcome]++;
        slots.total++;
        slotResults[name] = {
          outcome, score,
          ...(expected !== undefined ? { expected } : {}),
          ...(verdict.value !== undefined ? { got: verdict.value } : {}),
        };
      }
    }

    results.push({
      case: c, routedTo, routedRight,
      topScore: top?.score ?? 0,
      slots: slotResults,
    });
  }

  const confirmed = slots['confirmed-right'] + slots['confirmed-wrong'];
  return {
    cases: cases.length,
    routing: { right, wrong: cases.length - right, accuracy: cases.length ? right / cases.length : 0 },
    slots,
    falseConfirmRate: confirmed ? slots['confirmed-wrong'] / confirmed : 0,
    dangerous: results.filter((r) => Object.values(r.slots).some((s) => s.outcome === 'confirmed-wrong')),
    results,
  };
}

// ------------------------------------------------------------- calibration

export type Sample = { score: number; correct: boolean };
export type Bin = { from: number; to: number; n: number; claimed: number; actual: number };

/**
 * The reliability curve. For everything the matcher scored around 0.9, how
 * often was it right? If `claimed` and `actual` track each other, the score
 * means something and may confirm a slot. If they diverge, it does not — and
 * `Candidate.calibrated` should be false for that producer.
 */
export function reliability(samples: Sample[], bins = 10): Bin[] {
  const out: Bin[] = [];
  for (let i = 0; i < bins; i++) {
    const from = i / bins;
    const to = (i + 1) / bins;
    const inBin = samples.filter((s) => s.score >= from && (i === bins - 1 ? s.score <= to : s.score < to));
    out.push({
      from, to,
      n: inBin.length,
      claimed: inBin.length ? inBin.reduce((a, s) => a + s.score, 0) / inBin.length : 0,
      actual: inBin.length ? inBin.filter((s) => s.correct).length / inBin.length : 0,
    });
  }
  return out;
}

/** Expected calibration error: the gap, weighted by how much lives in each bin. */
export function calibrationError(samples: Sample[], bins = 10): number {
  if (samples.length === 0) return 0;
  return reliability(samples, bins)
    .filter((b) => b.n > 0)
    .reduce((acc, b) => acc + (b.n / samples.length) * Math.abs(b.claimed - b.actual), 0);
}

/**
 * One parameter, fitted by search, that pulls over-confident scores back toward
 * the truth. T > 1 softens, T < 1 sharpens. This is how an uncalibrated tier
 * earns the right to confirm a slot — on your acts, not on a vendor benchmark.
 */
export function fitTemperature(samples: Sample[], steps = 200): number {
  if (samples.length < 20) return 1;
  let best = 1;
  let bestErr = Infinity;
  for (let i = 1; i <= steps; i++) {
    const T = 0.25 + (i / steps) * 3.75;
    const err = calibrationError(samples.map((s) => ({ score: applyTemperature(s.score, T), correct: s.correct })));
    if (err < bestErr) { bestErr = err; best = T; }
  }
  return Math.round(best * 100) / 100;
}

export function applyTemperature(score: number, T: number): number {
  const p = Math.min(Math.max(score, 1e-6), 1 - 1e-6);
  const logit = Math.log(p / (1 - p));
  return 1 / (1 + Math.exp(-logit / T));
}

// ------------------------------------------------------------------ sweeping

export type Thresholds = { tauFill: number; deltaFill: number };

/**
 * Try a grid of thresholds and report what each costs. There is no single best:
 * raising τ_fill trades confident mistakes for extra beats, and which side you
 * want depends on what your acts do.
 */
export function sweep(
  cases: Case[],
  acts: ActDef[],
  resolve: Resolve,
  optionsFor: OptionsFor,
  ctx: Ctx,
  grid: Thresholds[],
  classifyWith: (c: Candidate[], tau: number, delta: number) => ReturnType<typeof classify> = classify,
): Array<Thresholds & { falseConfirmRate: number; confirmedRight: number; extraBeats: number }> {
  return grid.map(({ tauFill, deltaFill }) => {
    let confirmedRight = 0, confirmedWrong = 0, extraBeats = 0;

    for (const c of cases) {
      const def = acts.find((a) => a.name === c.act);
      if (!def || !c.slots) continue;
      const filled = resolve.fill(c.text, def, ctx, optionsFor);
      for (const [name, expected] of Object.entries(c.slots)) {
        const v = classifyWith(filled[name] ?? [], tauFill, deltaFill);
        if (v.outcome === 'filled' && !v.provisional) {
          if (satisfies(v.value, expected)) confirmedRight++; else confirmedWrong++;
        } else {
          extraBeats++;
        }
      }
    }

    const total = confirmedRight + confirmedWrong;
    return {
      tauFill, deltaFill,
      falseConfirmRate: total ? confirmedWrong / total : 0,
      confirmedRight,
      extraBeats,
    };
  });
}

// -------------------------------------------------------------- reporting

export function formatReport(r: Report): string {
  const pct = (n: number) => (n * 100).toFixed(1) + '%';
  const lines = [
    `cases            ${r.cases}`,
    `routing          ${r.routing.right}/${r.cases}  (${pct(r.routing.accuracy)})`,
    '',
    `confirmed right  ${r.slots['confirmed-right']}`,
    `confirmed WRONG  ${r.slots['confirmed-wrong']}   <- the only one that silence-commits a mistake`,
    `provisional      ${r.slots['provisional-right'] + r.slots['provisional-wrong']}`,
    `narrowed         ${r.slots.narrowed}`,
    `missed           ${r.slots.missed}`,
    `spurious         ${r.slots.spurious}`,
    '',
    `FALSE CONFIRM    ${pct(r.falseConfirmRate)}`,
  ];
  if (r.dangerous.length) {
    lines.push('', 'confident and wrong:');
    for (const d of r.dangerous.slice(0, 10)) {
      const bad = Object.entries(d.slots).filter(([, s]) => s.outcome === 'confirmed-wrong');
      for (const [name, s] of bad) {
        lines.push(`  "${d.case.text}"  ${name}: got ${JSON.stringify(s.got)} want ${JSON.stringify(s.expected)} @ ${s.score.toFixed(2)}`);
      }
    }
  }
  return lines.join('\n');
}
