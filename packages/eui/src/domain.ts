/**
 * Domains, and the structural rules that come with them. Board 12.
 *
 * A domain is not a colour. It is a claim about what an act is allowed to be,
 * and the colour falls out of it. That ordering is the entire reason this file
 * exists instead of a stylesheet:
 *
 *   "GROCERIES — items only, never a person"        → no `face` slot
 *   "money always confirms — no silent hold"        → radius external
 *   "teaching never costs an action"                → radius self, no writes
 *   "a child's claim waits for an adult"            → at least other-person
 *
 * Every one of those is a sentence in the design language and a check in
 * `lintDomains()`. A design rule that cannot fail a build is decoration.
 */

import type { ActDef, Radius } from '@intermenu/aiuic-core';
import { DOMAIN_COLOUR, type DomainColour } from './tokens.js';

export type DomainName =
  | 'chores' | 'homework' | 'groceries'
  | 'calendar' | 'trips' | 'places'
  | 'rewards' | 'allowance' | 'ranks'
  | 'household' | 'teaching'
  | 'memory';

export type DomainDef = {
  name: DomainName;
  colour: DomainColour;
  /** The kicker, in caps, over the card. */
  kicker: string;
  /** One line: what this part of the app does. Board 12's subtitle. */
  does: string;
  /** Board 12's shape line: the order slots are asked in. */
  shape: string;
  /** Primitives this domain must never use, with the reason. */
  forbids?: Partial<Record<string, string>>;
  /** The lowest radius an act here may declare. Below it, the act is wrong. */
  floor?: Radius;
  /** The highest radius an act here may declare. */
  ceiling?: Radius;
  /** True when the stage explains rather than writes. Teaching is free. */
  coachOnly?: boolean;
  /** True when this never takes the stage at all — it is a note, not a card. */
  noStage?: boolean;
};

export const DOMAINS: Record<DomainName, DomainDef> = {
  chores: {
    name: 'chores', colour: 'mint', kicker: 'CHORES',
    does: 'Assign, finish, ask for proof',
    shape: 'what → who → when · a photo request rides along',
  },
  homework: {
    name: 'homework', colour: 'mint', kicker: 'HOMEWORK',
    does: 'Set work, review it',
    shape: "subject → child → due · review lands in the adult's inbox",
  },
  groceries: {
    name: 'groceries', colour: 'mint', kicker: 'GROCERIES',
    does: 'Add, clear, shop',
    shape: 'items only — never a person · clothing is its own lane',
    // Board 13, NEVER: "A face on a grocery."
    forbids: { face: 'a grocery has no assignee — "items only, never a person"' },
  },
  calendar: {
    name: 'calendar', colour: 'planPurple', kicker: 'CALENDAR',
    does: 'Events, with the clash check',
    shape: 'what → when → who · leave-by time from the address',
  },
  trips: {
    name: 'trips', colour: 'planPurple', kicker: 'TRIPS',
    does: 'A run of stops, in order',
    shape: 'saved places first, then geocoded · the list joins a shop stop',
  },
  places: {
    name: 'places', colour: 'planPurple', kicker: 'PLACES',
    does: 'Remember where things are',
    shape: '"work is on René-Lévesque" becomes a saved place',
  },
  rewards: {
    name: 'rewards', colour: 'rewardsGold', kicker: 'REWARDS',
    does: 'Mint one, claim one, approve',
    shape: "a child's claim waits for an adult, never auto-settles",
    // A claim that silence-commits is a child approving their own reward.
    floor: 'other-person',
  },
  allowance: {
    name: 'allowance', colour: 'rewardsGold', kicker: 'ALLOWANCE',
    does: 'Grant, hold, pay out',
    shape: 'money always confirms — no silent hold on a payment',
    floor: 'external',
  },
  ranks: {
    name: 'ranks', colour: 'rewardsGold', kicker: 'RANKS',
    does: "Who's ahead, and why",
    shape: 'read-only on the stage; fairness notes stay in-app',
    ceiling: 'self',
  },
  household: {
    name: 'household', colour: 'cyan', kicker: 'HOUSEHOLD',
    does: 'People, iPad, house rules',
    shape: 'the stage explains and walks you there — it never edits people',
    coachOnly: true,
  },
  teaching: {
    name: 'teaching', colour: 'cyan', kicker: 'TEACHING',
    does: '"How do I…" and walk-throughs',
    shape: 'free, spotlighted on the real screen, stoppable at any step',
    coachOnly: true,
    ceiling: 'self',
  },
  memory: {
    name: 'memory', colour: 'neutral', kicker: 'MEMORY',
    does: 'What the house likes',
    shape: '"Noah hates mushrooms" · shown as a small note, never a card',
    noStage: true,
  },
};

const ORDER: Radius[] = ['self', 'shared', 'other-person', 'external'];
const rank = (r: Radius) => ORDER.indexOf(r);

export function domainOf(act: ActDef): DomainDef | null {
  const d = (act as { domain?: string }).domain;
  if (!d) return null;
  return DOMAINS[d as DomainName] ?? null;
}

/**
 * The only function that hands a renderer a colour.
 *
 * It takes `accent` so that it can visibly not use it. Board 13, NEVER: "A
 * personal accent repainting a domain." The accent goes on the person's own
 * chrome — their ring, their initial — and the domain colour is returned
 * untouched next to it.
 */
export function resolveColours(
  domain: DomainName | DomainDef | null,
  accent?: string,
): { domain: string; kicker: string; accent: string | null } {
  const def = typeof domain === 'string' ? DOMAINS[domain] : domain;
  const colour = def ? DOMAIN_COLOUR[def.colour] : DOMAIN_COLOUR.neutral;
  return { domain: colour, kicker: colour, accent: accent ?? null };
}

export type DomainLint = {
  act: string;
  domain: DomainName | null;
  level: 'error' | 'warn' | 'note';
  message: string;
};

/**
 * Board 12 and board 13, as checks. `error` means the act contradicts the
 * design language and shipping it makes the colour a lie.
 */
export function lintDomains(acts: ActDef[]): DomainLint[] {
  const out: DomainLint[] = [];

  for (const act of acts) {
    const raw = (act as { domain?: string }).domain;
    const def = domainOf(act);

    if (!raw) {
      out.push({ act: act.name, domain: null, level: 'note',
        message: 'no domain — the card has no kicker and falls back to neutral' });
      continue;
    }
    if (!def) {
      out.push({ act: act.name, domain: null, level: 'error',
        message: `unknown domain "${raw}" — a colour it does not own cannot be earned by meaning` });
      continue;
    }

    const max: Radius = typeof act.radius === 'string' ? act.radius : act.radius.max;

    for (const [name, sd] of Object.entries(act.slots)) {
      const why = def.forbids?.[sd.primitive];
      if (why) {
        out.push({ act: act.name, domain: def.name, level: 'error',
          message: `slot "${name}" uses \`${sd.primitive}\`, which ${def.name} forbids: ${why}` });
      }
    }

    if (def.floor && rank(max) < rank(def.floor)) {
      out.push({ act: act.name, domain: def.name, level: 'error',
        message: `declared ${max}, but ${def.name} floors at ${def.floor} — ${def.shape}` });
    }
    if (def.ceiling && rank(max) > rank(def.ceiling)) {
      out.push({ act: act.name, domain: def.name, level: 'error',
        message: `declared ${max}, but ${def.name} is capped at ${def.ceiling} — ${def.shape}` });
    }
    if (def.coachOnly && act.effects?.some((e) => !e.reversible)) {
      out.push({ act: act.name, domain: def.name, level: 'error',
        message: `${def.name} points at the real control; it does not make irreversible writes` });
    }
    if (def.noStage) {
      out.push({ act: act.name, domain: def.name, level: 'warn',
        message: `${def.name} is shown as a note, never a card — an act here will take the stage` });
    }
  }

  return out;
}
