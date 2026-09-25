/**
 * The pyramid. One conductor, three roles, and a loop.
 *
 *            conductor          the person. The only one who can make a thing true.
 *               │
 *          congregator          the record of everything done. The only writer.
 *           ╱        ╲
 *   orchestrator    aggregator  proposes / reads
 *
 * The idea as it was given: three agents working recursively, each needed for
 * anything to be fully built, as a triple check.
 *
 * The part changed on the way to code: three agents checking each other is
 * not three checks if they are the same model underneath. Their errors are
 * correlated, and three votes for a wrong answer read as one confident wrong
 * answer. So the roles here do not vote. They hold different AUTHORITY, and
 * the check is that nothing can cross from one to the next except through an
 * interface the next one owns:
 *
 *   aggregator    reads. Returns findings. Has no handle to propose or write.
 *   orchestrator  decides what is needed. Returns a plan. Has no handle to write.
 *   congregator   records. Has no public write method at all — it records what
 *                 the contract reports as committed, and what the loop did.
 *   conductor     assents. A proposal becomes a commit only through the act
 *                 contract, and a proposal nobody spoke into cannot pass the
 *                 engagement gate, so it waits for an explicit yes.
 *
 * A mistake then has to get past three different kinds of gate, not three
 * copies of the same judgment. That is what "triple check" can honestly mean.
 *
 * The recursion is real and bounded: a plan may split a goal into subgoals,
 * each pursued with the same three roles one level down, and their results
 * come back up through the congregator. It stops at a depth budget and on a
 * goal it has already seen in the current chain — otherwise "recursive" means
 * "loops until the bill arrives".
 */

import type { Ctx, Filled } from '@intermenu/aiuic-core';
import type { App } from '@intermenu/aiuic-kit';

// ----------------------------------------------------------------- aggregator

export type Finding = {
  source: string;
  claim: string;
  value?: unknown;
  confidence: number;
  /** Same meaning as a Candidate's: an uncalibrated score informs, never decides. */
  calibrated: boolean;
};

export interface Source {
  readonly name: string;
  /** True when it runs without a network. The loop must work with only these. */
  readonly local: boolean;
  read(query: string, ctx: Ctx): Finding[] | Promise<Finding[]>;
}

export class Aggregator {
  constructor(private readonly sources: Source[]) {}

  /**
   * Gather what every source can say about a query. A source that throws is
   * reported as a finding with zero confidence rather than taking the loop
   * down — a missing source is information too.
   */
  async gather(query: string, ctx: Ctx, opts: { localOnly?: boolean } = {}): Promise<readonly Finding[]> {
    const out: Finding[] = [];
    for (const s of this.sources) {
      if (opts.localOnly && !s.local) continue;
      try {
        out.push(...(await s.read(query, ctx)));
      } catch (err) {
        out.push({ source: s.name, claim: `unavailable: ${String((err as Error)?.message ?? err)}`,
          confidence: 0, calibrated: true });
      }
    }
    return Object.freeze(out.sort((a, b) => b.confidence - a.confidence));
  }
}

// ---------------------------------------------------------------- congregator

export type Entry =
  | { kind: 'goal'; goal: string; depth: number; at: number }
  | { kind: 'findings'; goal: string; findings: readonly Finding[]; at: number }
  | { kind: 'plan'; goal: string; plan: Plan; at: number }
  | { kind: 'proposed'; goal: string; act: string; fill: Filled; at: number }
  /** Only ever written from the contract's own commit event. */
  | { kind: 'committed'; act: string; id: string; at: number }
  | { kind: 'undone'; act: string; at: number }
  | { kind: 'stopped'; goal: string; reason: string; at: number }
  | { kind: 'answer'; goal: string; answer: string; at: number };

/** What the other roles may see. A copy; holding it gives no write access. */
export type Ledger = readonly Readonly<Entry>[];

/**
 * The loop's bookkeeping key. Module-private: it is never exported, so code
 * outside this file holding a Congregator has no name to call a write by.
 * A comment saying "internal" is a wish; an unexported symbol is a fact.
 */
const WRITE = Symbol('congregator.write');

export class Congregator {
  private entries: Entry[] = [];

  /**
   * Bind to an app. From here on every commit and undo the contract reports
   * is recorded — and only those. There is no `record(decision)`: a decision
   * that did not go through the contract is not a decision.
   */
  constructor(app: App, private readonly now: () => number) {
    app.ui.on((e) => {
      if (e.type === 'commit') this[WRITE]({ kind: 'committed', act: e.act, id: e.result.id, at: this.now() });
      if (e.type === 'undo') this[WRITE]({ kind: 'undone', act: e.act, at: this.now() });
    });
  }

  [WRITE](e: Entry): void {
    this.entries.push(e);
  }

  view(): Ledger {
    return this.entries.map((e) => Object.freeze({ ...e }));
  }

  /** Everything decided, which is to say everything the conductor let through. */
  decisions(): Ledger {
    return this.view().filter((e) => e.kind === 'committed' || e.kind === 'undone');
  }
}

// --------------------------------------------------------------- orchestrator

export type Plan =
  /** Enough is known; here is what to say. */
  | { kind: 'answer'; answer: string }
  /** Something should happen. A proposal, never a write. */
  | { kind: 'propose'; act: string; fill: Filled; why: string }
  /** Not enough is known; look again with a sharper question. */
  | { kind: 'look'; query: string }
  /** Too big for one step; each part goes round the loop on its own. */
  | { kind: 'split'; goals: string[] };

export type PlanInput = {
  goal: string;
  findings: readonly Finding[];
  /** Read-only. The orchestrator sees what was done; it cannot add to it. */
  ledger: Ledger;
  depth: number;
  /** Answers from subgoals, when this is the pass after a split. */
  parts?: readonly { goal: string; outcome: Outcome }[];
};

/**
 * The orchestrator is a function, not an object with state, and that is the
 * point: it receives copies and returns data. A model can sit behind it — it
 * usually will — and there is still nothing it can reach to write with.
 */
export type Orchestrator = (input: PlanInput) => Plan | Promise<Plan>;

// ------------------------------------------------------------------ the loop

export type Outcome =
  | { kind: 'answered'; answer: string }
  | { kind: 'proposed'; act: string; status: string }
  | { kind: 'split'; parts: { goal: string; outcome: Outcome }[]; then: Outcome }
  | { kind: 'stopped'; reason: string };

export type PyramidConfig = {
  app: App;
  aggregator: Aggregator;
  orchestrator: Orchestrator;
  ctx: () => Ctx;
  now?: () => number;
  /** How far a goal may split. Three levels is already a lot of fan-out. */
  maxDepth?: number;
  /** How many times one goal may ask to look again before it must decide. */
  maxLooks?: number;
};

export const DEFAULT_MAX_DEPTH = 3;
export const DEFAULT_MAX_LOOKS = 2;

export class Pyramid {
  readonly congregator: Congregator;
  private readonly now: () => number;

  constructor(private readonly config: PyramidConfig) {
    this.now = config.now ?? (() => Date.now());
    this.congregator = new Congregator(config.app, this.now);
  }

  /** Pursue a goal round the loop: aggregate, orchestrate, congregate, recurse. */
  pursue(goal: string): Promise<Outcome> {
    return this.step(goal, 0, []);
  }

  private async step(goal: string, depth: number, chain: string[]): Promise<Outcome> {
    const c = this.congregator;
    const key = goal.trim().toLowerCase();

    if (chain.includes(key)) return this.stop(goal, 'this goal is already being pursued further up — a cycle');
    if (depth > (this.config.maxDepth ?? DEFAULT_MAX_DEPTH)) return this.stop(goal, 'depth budget spent');

    c[WRITE]({ kind: 'goal', goal, depth, at: this.now() });
    const ctx = this.config.ctx();

    let query = goal;
    let looks = 0;
    let parts: { goal: string; outcome: Outcome }[] | undefined;

    for (;;) {
      const findings = await this.config.aggregator.gather(query, ctx);
      c[WRITE]({ kind: 'findings', goal, findings, at: this.now() });

      const plan = await this.config.orchestrator({
        goal, findings, ledger: c.view(), depth, ...(parts ? { parts } : {}),
      });
      c[WRITE]({ kind: 'plan', goal, plan, at: this.now() });

      switch (plan.kind) {
        case 'answer':
          c[WRITE]({ kind: 'answer', goal, answer: plan.answer, at: this.now() });
          return parts
            ? { kind: 'split', parts, then: { kind: 'answered', answer: plan.answer } }
            : { kind: 'answered', answer: plan.answer };

        case 'look':
          if (++looks > (this.config.maxLooks ?? DEFAULT_MAX_LOOKS)) {
            return this.stop(goal, 'asked to look again too many times without deciding');
          }
          query = plan.query;
          continue;

        case 'split': {
          if (parts) return this.stop(goal, 'split twice at one level — the plan is not converging');
          parts = [];
          for (const g of plan.goals) {
            parts.push({ goal: g, outcome: await this.step(g, depth + 1, [...chain, key]) });
          }
          continue; // one more pass, now with the parts in hand
        }

        case 'propose':
          return this.propose(goal, plan, parts);
      }
    }
  }

  /**
   * A proposal goes to the stage as a model fill. It is drawn, it can be
   * corrected, and it cannot commit on silence: nobody touched or spoke into
   * it, so the engagement gate fails and it waits for an explicit yes. That is
   * the conductor's gate, and the loop has no way round it.
   */
  private propose(goal: string, plan: Extract<Plan, { kind: 'propose' }>, parts?: { goal: string; outcome: Outcome }[]): Outcome {
    const def = this.config.app.ui.definitions.find((d) => d.name === plan.act);
    if (!def) return this.stop(goal, `proposed an act this app does not have: "${plan.act}"`);

    this.config.app.reset();
    const run = this.config.app.ui.start(plan.act);
    for (const [slot, value] of Object.entries(plan.fill)) {
      if (!def.slots[slot]) continue; // a model inventing slots gets nothing for it
      run.setValue(slot, value, 'model');
    }
    run.evaluate();
    this.config.app.draw();
    this.congregator[WRITE]({ kind: 'proposed', goal, act: plan.act, fill: plan.fill, at: this.now() });

    const out: Outcome = { kind: 'proposed', act: plan.act, status: run.status };
    return parts ? { kind: 'split', parts, then: out } : out;
  }

  private stop(goal: string, reason: string): Outcome {
    this.congregator[WRITE]({ kind: 'stopped', goal, reason, at: this.now() });
    return { kind: 'stopped', reason };
  }
}

/** A source over plain data, for tests and for the local tier. */
export function tableSource(name: string, rows: { claim: string; value?: unknown; words: string[] }[]): Source {
  return {
    name, local: true,
    read(query) {
      const q = query.toLowerCase();
      return rows
        .filter((r) => r.words.some((w) => q.includes(w.toLowerCase())))
        .map((r) => ({ source: name, claim: r.claim, value: r.value, confidence: 1, calibrated: true }));
    },
  };
}
