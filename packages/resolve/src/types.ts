/**
 * The resolver contract. Spec v0.2 §3 and §8.
 *
 * Resolution runs in tiers, and the tier is what makes the local-first claim
 * true or false:
 *
 *   tier 0  local      0 ms      offline   exact and fuzzy over declared options
 *   tier 1  Jev        70-500ms  network   typed decisions with calibrated confidence
 *   tier 2  LLM        seconds   network   free text, novel intent, escalation
 *
 * `local: false` marks a resolver the degraded path must never depend on.
 */

import type { ActDef, Candidate, Ctx, Filled, Option } from '@intermenu/aiuic-core';

export type ActScore = {
  act: string;
  score: number;
  phraseMatch: number;
  requiredCoverage: number;
};

export type SlotCandidates = Record<string, Candidate[]>;

export type OptionsFor = (act: ActDef, slot: string) => Option[];

export interface Resolver {
  readonly name: string;
  /** True only if it runs on device with no network. */
  readonly local: boolean;
  score(text: string, acts: ActDef[], ctx: Ctx, optionsFor: OptionsFor): Promise<ActScore[]>;
  fill(
    text: string,
    act: ActDef,
    filled: Filled,
    ctx: Ctx,
    optionsFor: OptionsFor,
  ): Promise<SlotCandidates>;
}

/** §3 routing thresholds. Defaults to tune against real utterances, not claims. */
export type RoutingConfig = {
  tauAct: number;
  deltaAct: number;
  /** Coverage counts a slot only when a candidate clears this. */
  tauFill: number;
  phraseWeight: number;
  coverageWeight: number;
};

export const DEFAULT_ROUTING: RoutingConfig = {
  tauAct: 0.5,
  deltaAct: 0.15,
  tauFill: 0.85,
  phraseWeight: 0.4,
  coverageWeight: 0.6,
};

export type RouteDecision =
  | { kind: 'start'; act: string; scores: ActScore[] }
  | { kind: 'narrow'; acts: string[]; scores: ActScore[] }
  | { kind: 'none'; scores: ActScore[] };
