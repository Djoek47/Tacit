/**
 * A person's own Hepta: the assistant's colour and their accent.
 *
 * "You can have your own Hepta that's personalised, with its own colours,
 * even though it is using something else." Two colours are the person's to
 * choose, and the rules for both are the same rule the rest of the language
 * runs on — colour is earned by meaning:
 *
 *   assistant  the orb when it is idle or speaking. Replaces the default cyan.
 *   accent     their own chrome: their ring, their initial.
 *
 * Neither may be a semantic colour. A green assistant would say "success"
 * every time it spoke; an orange one would look like a warning at rest. And
 * neither ever reaches a domain — `resolveColours` still refuses the accent,
 * and a domain's colour is its own or its app's.
 */

import { DOMAIN_COLOUR, ORB_TINT, SEMANTIC, type OrbState } from './tokens.js';

export type Theme = { assistant?: string; accent?: string };

const HEX = /^#[0-9a-fA-F]{6}$/;
const RESERVED: Record<string, string> = {
  [SEMANTIC.success.toUpperCase()]: 'success',
  [SEMANTIC.warning.toUpperCase()]: 'warning',
  [SEMANTIC.danger.toUpperCase()]: 'danger',
};

/** Channel distance, so near-copies of a semantic colour are caught too. */
function distance(a: string, b: string): number {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]!) ** 2, 0));
}

export function checkTheme(t: Theme): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(t)) {
    if (v === undefined) continue;
    if (!HEX.test(v)) { out.push(`${k}: a colour is #RRGGBB`); continue; }
    for (const [hex, meaning] of Object.entries(RESERVED)) {
      if (distance(v.toUpperCase(), hex) < 48) out.push(`${k}: ${v} is too close to ${meaning}, which means the same thing in every app`);
    }
  }
  return out;
}

/** The orb's tints under a person's theme. Listening, thinking and done keep their meaning. */
export function orbTints(t: Theme = {}): Record<OrbState, string> {
  const ok = t.assistant && checkTheme({ assistant: t.assistant }).length === 0;
  const a = ok ? t.assistant! : DOMAIN_COLOUR.poppinsCyan;
  return { ...ORB_TINT, idle: a, speaking: a };
}
