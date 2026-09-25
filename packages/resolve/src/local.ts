/**
 * Tier 0: the local matcher. Offline, synchronous, no model.
 *
 * This is what makes "the app still works when the model is slow, wrong or
 * absent" a mechanism rather than a hope.
 */

import type { ActDef, Candidate, Ctx, Filled, Option } from '@intermenu/aiuic-core';
import { matchPhrase, tokenize, type Token } from './text.js';
import {
  DEFAULT_ROUTING,
  type ActScore,
  type OptionsFor,
  type Resolver,
  type RoutingConfig,
  type SlotCandidates,
} from './types.js';

function candidatesForOptions(tokens: Token[], options: Option[]): Candidate[] {
  const out: Candidate[] = [];
  for (const opt of options) {
    const needles = [opt.label, ...(opt.aliases ?? [])];
    let best: { score: number; span: [number, number] } | null = null;
    for (const n of needles) {
      const m = matchPhrase(tokens, n);
      if (m && (!best || m.score > best.score)) best = m;
    }
    if (best && best.score > 0) out.push({ value: opt.value, label: opt.label, ...best });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * §6. Two slots can claim the same words ("Maya's room"). The longer span wins;
 * the loser drops that candidate rather than both filling from one phrase.
 */
export function arbitrateSpans(slots: SlotCandidates): SlotCandidates {
  type Claim = { slot: string; index: number; span: [number, number]; score: number };
  const claims: Claim[] = [];
  for (const [slot, cands] of Object.entries(slots)) {
    cands.forEach((c, index) => {
      if (c.span) claims.push({ slot, index, span: c.span, score: c.score });
    });
  }

  const dropped = new Set<string>();
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i]!;
      const b = claims[j]!;
      if (a.slot === b.slot) continue;
      const overlap = a.span[0] < b.span[1] && b.span[0] < a.span[1];
      if (!overlap) continue;
      const aLen = a.span[1] - a.span[0];
      const bLen = b.span[1] - b.span[0];
      const loser = aLen !== bLen ? (aLen < bLen ? a : b) : a.score < b.score ? a : b;
      dropped.add(`${loser.slot}:${loser.index}`);
    }
  }

  const out: SlotCandidates = {};
  for (const [slot, cands] of Object.entries(slots)) {
    const kept = cands.filter((_, index) => !dropped.has(`${slot}:${index}`));
    if (kept.length > 0) out[slot] = kept;
  }
  return out;
}

export class LocalResolver implements Resolver {
  readonly name = 'local';
  readonly local = true;
  /** An exact string match is right by construction, so its 1.0 means 1.0. */
  readonly calibrated = true;

  constructor(private readonly routing: RoutingConfig = DEFAULT_ROUTING) {}

  async score(text: string, acts: ActDef[], ctx: Ctx, optionsFor: OptionsFor): Promise<ActScore[]> {
    return this.scoreSync(text, acts, ctx, optionsFor);
  }

  async fill(
    text: string,
    act: ActDef,
    filled: Filled,
    ctx: Ctx,
    optionsFor: OptionsFor,
  ): Promise<SlotCandidates> {
    return this.fillSync(text, act, filled, ctx, optionsFor);
  }

  /** Synchronous by design: tier 0 must settle before anything is painted. */
  scoreSync(text: string, acts: ActDef[], ctx: Ctx, optionsFor: OptionsFor): ActScore[] {
    const tokens = tokenize(text);
    const scores: ActScore[] = [];

    for (const act of acts) {
      let phraseMatch = 0;
      for (const p of act.phrases ?? []) {
        const m = matchPhrase(tokens, p);
        if (m && m.score > phraseMatch) phraseMatch = m.score;
      }

      // Coverage counts only the required slots THIS tier can evaluate. A
      // quantity or a date has no option list, so the option matcher can say
      // nothing about it either way; counting it as a miss would depress every
      // act that mentions a number, which is nearly all of them.
      // Free text is left out too: the rest of a sentence always matches
      // something, so it is never evidence of which act was meant. Counting
      // it as coverage made every act whose only slot is free text lose to
      // its own trigger phrase.
      const evaluable = Object.entries(act.slots).filter(
        ([name, s]) => s.required && s.primitive !== 'ghostField' && (s.resolve || optionsFor(act, name).length > 0),
      );
      let covered = 0;
      for (const [name, s] of evaluable) {
        const cands = s.resolve
          ? s.resolve(text, ctx, {})
          : candidatesForOptions(tokens, optionsFor(act, name));
        if ((cands[0]?.score ?? 0) < this.routing.tauFill) continue;

        // A matched slot is evidence for THIS act only as far as it is not
        // evidence for every other one. "laundry" belongs to the chore act;
        // "Maya" is a person both acts have a slot for, and on its own it
        // means nothing about which act was meant. Without this, the two
        // score identically and the router has to guess.
        covered += this.discrimination(act, name, text, acts, ctx, optionsFor, tokens);
      }

      const requiredCoverage = evaluable.length ? covered / evaluable.length : 0;

      // Score over the signals that actually spoke, not over every signal that
      // could have. A trigger phrase nobody used is absence of evidence, the
      // same as a slot this tier cannot evaluate — and dividing by a weight
      // nothing filled is what buried "do the laundry" at 0.30.
      let weight = 0;
      let total = 0;
      if (phraseMatch >= this.routing.phraseFloor) {
        weight += this.routing.phraseWeight;
        total += this.routing.phraseWeight * phraseMatch;
      }
      weight += this.routing.coverageWeight;
      total += this.routing.coverageWeight * (evaluable.length > 0 ? requiredCoverage : this.routing.uncheckableCoverage);

      scores.push({
        act: act.name,
        phraseMatch,
        requiredCoverage,
        score: weight > 0 ? total / weight : 0,
      });
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * 1 when only this act could have matched those words, falling toward 0 as
   * more acts could have matched them just as well.
   */
  private discrimination(
    act: ActDef,
    slot: string,
    text: string,
    acts: ActDef[],
    ctx: Ctx,
    optionsFor: OptionsFor,
    tokens: Token[],
  ): number {
    let rivals = 0;
    for (const other of acts) {
      if (other.name === act.name) continue;
      for (const [name, sd] of Object.entries(other.slots)) {
        if (!sd.required || sd.primitive === 'ghostField') continue;
        const cands = sd.resolve
          ? sd.resolve(text, ctx, {})
          : candidatesForOptions(tokens, optionsFor(other, name));
        if ((cands[0]?.score ?? 0) >= this.routing.tauFill) { rivals++; break; }
      }
    }
    return 1 / (1 + rivals);
  }

  fillSync(
    text: string,
    act: ActDef,
    filled: Filled,
    ctx: Ctx,
    optionsFor: OptionsFor,
  ): SlotCandidates {
    const tokens = tokenize(text);
    const out: SlotCandidates = {};

    for (const [name, def] of Object.entries(act.slots)) {
      if (name in filled) continue;
      if (def.fill === 'model') continue; // a local matcher cannot write free text

      if (def.resolve) {
        const c = def.resolve(text, ctx, filled);
        if (c.length > 0) out[name] = [...c].sort((a, b) => b.score - a.score);
        continue;
      }

      const cands = candidatesForOptions(tokens, optionsFor(act, name));
      if (cands.length > 0) out[name] = cands;
    }

    return arbitrateSpans(out);
  }
}
