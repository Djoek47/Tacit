/**
 * aiuic-kit — the front door.
 *
 * Spec v0.1, locked decision 5: "The SDK takes text, not audio. `ui.hear(string)`."
 * That line has been quoted in every document about this project and did not
 * exist in the code. What existed was the assembly instructions for it, and
 * every app followed them separately:
 *
 *   score the text, pick an act, start it, fill its slots from the same text,
 *   evaluate, then wire a presenter and work out `optionsFor` on the way
 *
 * Four apps, four copies, and the eval runner had a fifth that routed
 * differently from the one the apps shipped — which is how it came to measure
 * a router nobody used. A front door is not sugar here. It is the thing that
 * makes "the app routes the way the harness says it does" true by
 * construction.
 *
 * `hear()` lives here rather than on `AIUIC` because the core imports nothing
 * from the other packages, and routing is the resolve layer's job. That
 * boundary is worth more than matching the spec's exact spelling, so the spec
 * should read `app.hear(string)`.
 */

import {
  createAIUIC,
  defineAct,
  type ActDef,
  type ActRun,
  type Clock,
  type Ctx,
  type Option,
  type AIUIC,
} from '@intermenu/aiuic-core';
import {
  LocalResolver,
  pickAct,
  DEFAULT_ROUTING,
  type RouteDecision,
  type RoutingConfig,
} from '@intermenu/aiuic-resolve';
import { Speculator, type Speculation } from '@intermenu/hepta';
import { attachPresenters, toView, type Presenter, type StageView } from '@intermenu/aiuic-present';
import { lintActs, type Lint } from '@intermenu/aiuic-devtools';
import { lintDomains, type CustomDomains } from '@intermenu/aiuic-eui';

export type AppConfig = {
  acts: ActDef[];
  ctx: () => Omit<Ctx, 'now'> & { now?: Date };
  clock?: Clock;
  /** Drawn on every change. Add more later with `mount()`. */
  presenters?: Presenter[];
  /**
   * Keep candidate acts alive on partial text. On by default: a host that
   * passes `final: false` has told us the speaker is still going, and
   * committing on that is the failure the contract exists to prevent.
   */
  speculate?: boolean;
  routing?: RoutingConfig;
  /**
   * Where a slot's options come from, when the act does not say. Most apps
   * declare `options` on the slot and never need this.
   */
  optionsFor?: (act: ActDef, slot: string) => Option[];
  /** Domains the app declares in its shape, so the lint knows them. */
  domains?: CustomDomains;
};

export type HearResult = {
  text: string;
  final: boolean;
  /** What the router decided. 'none' is an answer, not a failure. */
  decision: RouteDecision;
  act: string | null;
  run: ActRun | null;
  /** The stage as a renderer sees it. Null when nothing is on it. */
  view: StageView | null;
  /** Present only while speculating. */
  speculation: Speculation | null;
};

/**
 * A speculation reported in the same shape as a route.
 *
 * The tracks already carry the scores that chose the leader, so reporting them
 * is a matter of naming the fields rather than inventing any: the earlier
 * version handed back an empty score list and a non-null assertion on a leader
 * that can be null, which type-checked through a cast and described a decision
 * that had not been made that way.
 */
function decisionOf(spec: Speculation): RouteDecision {
  const scores = spec.tracks.map((t) => ({
    act: t.act, score: t.score, phraseMatch: t.phraseMatch, requiredCoverage: t.coverage,
  }));
  return spec.leader ? { kind: 'start', act: spec.leader, scores } : { kind: 'none', scores };
}

/** Slot options, from the slot itself unless the host overrides. */
function defaultOptionsFor(act: ActDef, slot: string, ctx: Ctx): Option[] {
  const sd = act.slots[slot];
  if (!sd?.options) return [];
  const got = sd.options(ctx, {});
  // A slot may load its options; the local tier cannot wait for that, and a
  // promise here means the act was built for a tier that can.
  return Array.isArray(got) ? got : [];
}

export class App {
  readonly ui: AIUIC;
  readonly resolver: LocalResolver;
  readonly speculator: Speculator | null;
  private presenters: Presenter[] = [];
  private wired: { update: () => void } | null = null;
  private boundRun: ActRun | null = null;

  constructor(private readonly config: AppConfig) {
    this.ui = createAIUIC({
      ...(config.clock ? { clock: config.clock } : {}),
      ctx: () => config.ctx() as Ctx,
    });
    for (const a of config.acts) this.ui.defineAct(a);

    this.resolver = new LocalResolver(config.routing ?? DEFAULT_ROUTING);
    this.speculator = config.speculate === false
      ? null
      : new Speculator(this.ui, this.resolver, (act, slot) => this.optionsFor(act, slot));

    this.presenters = config.presenters ?? [];
  }

  private ctx(): Ctx {
    const base = this.config.ctx();
    return { ...base, now: base.now ?? new Date() } as Ctx;
  }

  optionsFor(act: ActDef, slot: string): Option[] {
    return this.config.optionsFor
      ? this.config.optionsFor(act, slot)
      : defaultOptionsFor(act, slot, this.ctx());
  }

  get act(): ActRun | null {
    return this.speculator?.currentRun ?? this.ui.act;
  }

  /**
   * Text in. The whole SDK, from a host's point of view.
   *
   * `final` is the only thing a caller has to get right, and it is not a
   * detail: false means the speaker is still going, and nothing may commit on
   * a sentence nobody has finished. A host with no notion of partial text
   * leaves it alone and every call is final.
   */
  hear(text: string, opts: { final?: boolean } = {}): HearResult {
    const final = opts.final ?? true;
    const ctx = this.ctx();
    const trimmed = text.trim();

    if (!trimmed) {
      return { text: trimmed, final, decision: { kind: 'none', scores: [] },
               act: null, run: null, view: null, speculation: null };
    }

    // A finished act is not something to speak into. The speculator keeps
    // pointing at its run after it settles, and because the leader has not
    // changed it re-paints rather than starting anything — and `paint()`
    // refuses to touch a settled run, correctly. The result is a second
    // sentence that does nothing at all. The turn is over; the next one starts
    // from nothing.
    const held = this.speculator?.currentRun;
    if (held && (held.status === 'settled' || held.status === 'failed' || held.status === 'discarded')) {
      this.speculator!.reset();
      this.boundRun = null;
    }

    // Partial text goes to Hepta, which keeps several acts alive and lets none
    // of them commit. This is the only path that may run before the speaker
    // has stopped.
    if (this.speculator && !final) {
      const spec = this.speculator.feed({ text: trimmed, final }, ctx);
      this.draw();
      return {
        text: trimmed, final,
        decision: decisionOf(spec),
        act: spec.leader, run: null, view: this.view(), speculation: spec,
      };
    }

    // A speculating run is already on the right act with its slots offered, so
    // settling it is cheaper and steadier than tearing it down to re-route
    // identical text.
    if (this.speculator?.currentRun) {
      const spec = this.speculator.feed({ text: trimmed, final: true }, ctx);
      this.draw();
      return {
        text: trimmed, final: true,
        decision: decisionOf(spec),
        act: spec.leader, run: spec.run, view: this.view(), speculation: spec,
      };
    }

    const defs = this.ui.definitions;
    const scores = this.resolver.scoreSync(trimmed, defs, ctx, (a, s) => this.optionsFor(a, s));
    const decision = pickAct(scores, this.config.routing ?? DEFAULT_ROUTING);

    if (decision.kind === 'none') {
      return { text: trimmed, final, decision, act: null, run: null, view: this.view(), speculation: null };
    }

    // A narrow is two acts the text cannot separate. Taking the first is the
    // host's call to make, not the kit's, so the decision is handed back whole
    // and the leader is started — the stage can offer the other.
    const name = decision.kind === 'start' ? decision.act : decision.acts[0]!;
    const def = defs.find((d) => d.name === name)!;
    const run = this.ui.start(name);

    const cands = this.resolver.fillSync(trimmed, def, {}, ctx, (a, s) => this.optionsFor(a, s));
    for (const [slot, list] of Object.entries(cands)) {
      if (list.length === 0) continue;
      // Everything is offered, and the core decides what it is.
      //
      // The first version of this picked the winner here — fill if it clears
      // tau and stands alone, otherwise offer — which is a weaker copy of
      // `classify()`, the function `offer()` already runs. It got "the dishes
      // for Maya" wrong: a rival option scoring a little above zero made the
      // list longer than one, so a clear winner was narrowed instead of
      // filled. tau, delta and calibration live in one place and this is not
      // it.
      run.offer(slot, list, 'spoken');
    }
    run.evaluate();
    this.draw();

    return { text: trimmed, final, decision, act: name, run, view: this.view(), speculation: null };
  }

  /** The stage as a renderer sees it. */
  view(): StageView | null {
    const run = this.act;
    return run ? toView(run, (r, slot) => this.optionsFor(r.def, slot)) : null;
  }

  mount(...presenters: Presenter[]): void {
    this.presenters.push(...presenters);
    this.boundRun = null;
    this.draw();
  }

  /** Re-draw. Called for you on every `hear`; call it yourself after a tick. */
  draw(): void {
    const run = this.act;
    if (!run || this.presenters.length === 0) return;
    if (run !== this.boundRun) {
      this.boundRun = run;
      this.wired = attachPresenters(run, this.presenters, (r, slot) => this.optionsFor(r.def, slot));
      return; // attachPresenters draws once itself
    }
    this.wired?.update();
  }

  /**
   * One audit over both rule sets: what the contract finds surprising, and
   * what the design language forbids outright.
   */
  lint(): Lint[] {
    const defs = this.ui.definitions;
    return [
      ...lintDomains(defs, this.config.domains).map((l) => ({ act: l.act, level: l.level, message: l.message } as Lint)),
      ...lintActs(defs),
    ];
  }

  reset(): void {
    this.speculator?.reset();
    this.boundRun = null;
  }
}

export function createApp(config: AppConfig): App {
  return new App(config);
}

/** Re-exported so a host can build acts without importing the core directly. */
export { defineAct };
export type { ActDef, ActRun, Ctx, Option, Presenter, StageView, Lint, RouteDecision };
