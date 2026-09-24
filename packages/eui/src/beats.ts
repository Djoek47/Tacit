/**
 * The grammar. Board 10: seven beats, always in this order.
 *
 * "Groceries, chores, events, trips and teaching all play the same phrase.
 * Learn it once and the whole app is one motion."
 *
 * The beats are derived from the act's own state, never set by a caller. That
 * is what makes the claim true: a renderer cannot decide to skip UNFOLD for a
 * domain it finds fiddly, because it does not choose the beat at all.
 */

import type { Clock } from '@intermenu/aiuic-core';
import type { StageView } from '@intermenu/aiuic-present';
import { BUDGET_MS, SPRING, type SpringName } from './tokens.js';
import { domainOf, type DomainDef } from './domain.js';

export type Beat =
  | 'show'    // 1 · the card lands, ≤150 ms
  | 'narrow'  // 2 · two readings, never a list
  | 'unfold'  // 3 · slots fill in the order they were spoken
  | 'hold'    // 4 · silence agrees
  | 'settle'  // 5 · one mark for the whole card
  | 'chain'   // 6 · the next act waits, dimmed
  | 'coach';  // 7 · it points instead of acting

export const BEAT_ORDER: Beat[] = ['show', 'narrow', 'unfold', 'hold', 'settle', 'chain', 'coach'];

/** Which spring a beat moves on. Board 13's three, mapped to board 10's seven. */
export const BEAT_SPRING: Record<Beat, SpringName> = {
  show: 'smooth',    // the card grows
  narrow: 'snappy',  // two chips drop in
  unfold: 'smooth',  // a row comes in
  hold: 'settle',    // the ring
  settle: 'settle',  // the mark
  chain: 'snappy',   // the dimmed row
  coach: 'smooth',
};

export function springFor(beat: Beat) {
  return SPRING[BEAT_SPRING[beat]];
}

export type BeatContext = {
  /** Acts waiting behind this one. Board 10, beat 6: they never restart it. */
  queued?: number;
  /** The domain, if the caller already has it. */
  domain?: DomainDef | null;
};

/**
 * Precedence, not a lookup. Several beats can be true of one view — a held card
 * with something queued behind it is both HOLD and CHAIN — and the card is
 * drawn in the earlier one, because that is the beat the user is in.
 */
export function beatOf(view: StageView, ctx: BeatContext = {}): Beat | null {
  if (!view.act) return null;

  const domain = ctx.domain;
  if (domain?.coachOnly) return 'coach';

  switch (view.status) {
    case 'committing':
    case 'settled':
      return 'settle';
    case 'hold':
    case 'explicit':
    case 'frozen':
      return 'hold';
    default:
      break;
  }

  if (view.slots.some((s) => s.status === 'narrowed')) return 'narrow';

  // A card whose slots are all still empty has only just landed. The moment one
  // is filled it is unfolding, whatever else is true of it.
  const anyFilled = view.slots.some((s) => s.status === 'filled');
  if (!anyFilled) return (ctx.queued ?? 0) > 0 ? 'chain' : 'show';
  return 'unfold';
}

/**
 * Board 10, beat 1: "Skipped when the thing was already named."
 *
 * SHOW exists to tell the person the card heard them. If they got here by
 * touching the thing, the card is already in front of them and playing SHOW
 * animates something that did not happen — so the card appears at rest.
 *
 * "Named" means the act's opening value did not come out of speech. A spoken
 * fill, a remembered one and a model guess all deserve the beat, because in
 * each of those the person is finding out what was heard.
 */
export function skipsShow(view: StageView): boolean {
  const opening = view.slots.find((s) => s.status === 'filled');
  return opening?.source === 'touched';
}

// ------------------------------------------------------------------ budget

export type BudgetMark = 'heard' | 'shown' | 'committed' | 'undoRequested' | 'undone';

export type BudgetBreach = {
  span: 'show' | 'commit' | 'undo';
  tookMs: number;
  budgetMs: number;
};

/**
 * "Miss these and it stops feeling like a reflex."
 *
 * A budget written in a design doc is a wish. This one is measured on a clock
 * the tests control, so a regression that adds 90 ms between the words ending
 * and the card landing fails a test rather than being noticed in six months by
 * someone who says the app feels heavier than it used to.
 */
export class BudgetMonitor {
  private marks = new Map<BudgetMark, number>();
  readonly breaches: BudgetBreach[] = [];

  constructor(private readonly clock: Clock) {}

  mark(m: BudgetMark): void {
    this.marks.set(m, this.clock.now());
    if (m === 'shown') this.check('show', 'heard', 'shown', BUDGET_MS.show);
    if (m === 'committed') this.check('commit', 'shown', 'committed', BUDGET_MS.commit);
    if (m === 'undone') this.check('undo', 'undoRequested', 'undone', BUDGET_MS.undo);
  }

  /** A new utterance starts a new budget; old marks would measure the wrong gap. */
  reset(): void {
    this.marks.clear();
  }

  private check(span: BudgetBreach['span'], from: BudgetMark, to: BudgetMark, budgetMs: number) {
    const a = this.marks.get(from);
    const b = this.marks.get(to);
    if (a === undefined || b === undefined) return;
    const tookMs = b - a;
    if (tookMs > budgetMs) this.breaches.push({ span, tookMs, budgetMs });
  }

  get ok(): boolean {
    return this.breaches.length === 0;
  }

  report(): string {
    if (this.ok) return 'within budget';
    return this.breaches
      .map((b) => `${b.span}: ${b.tookMs}ms over a ${b.budgetMs}ms budget`)
      .join('\n');
  }
}

/** Convenience: the beat a live act is in, resolving the domain itself. */
export function beatForAct(view: StageView, def: { slots: unknown } | null, queued = 0): Beat | null {
  return beatOf(view, {
    queued,
    domain: def ? domainOf(def as Parameters<typeof domainOf>[0]) : null,
  });
}
