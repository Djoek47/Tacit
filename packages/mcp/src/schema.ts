/**
 * A tool's JSON Schema turned into slots, and slot values turned back into
 * arguments.
 *
 * The primitive is chosen by what the local tier can fill, because an act the
 * phone cannot fill without a model is an act that does nothing offline:
 *
 *   enum, or options from a list tool   chip       matched against options
 *   number, integer                      quantity   "twelve", "$12", "12"
 *   string with format date/date-time    when       "tomorrow at 9"
 *   boolean                              chip       yes / no
 *   the first required free-text string  ghostField the rest of the sentence
 *   any other string                     ghostField model-filled
 *
 * "The rest of the sentence" is the one guess here, and it is marked as one:
 * uncalibrated, so it is always provisional. It fills "add buy milk to my
 * list" with "buy milk" and it will sometimes be wrong, which is why a
 * provisional fill cannot silence-commit anything that reaches another person.
 */

import type { Candidate, Option, SlotDef } from '@intermenu/aiuic-core';
import { resolveQuantity, resolveWhen } from '@intermenu/aiuic-resolve';

export type JsonSchemaProp = {
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  description?: string;
  title?: string;
};

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

export const MAX_SLOTS = 8;

const humanise = (v: unknown) => String(v).replace(/[_-]+/g, ' ');
const isType = (p: JsonSchemaProp, t: string) => p.type === t || (Array.isArray(p.type) && p.type.includes(t));

const FILLER = new Set(['a', 'an', 'the', 'to', 'my', 'please', 'can', 'you', 'could', 'for', 'me', 'on', 'in', 'into', 'list', 'and', 'i', 'want', 'need', 'would', 'like']);

/**
 * The rest of the sentence, once the trigger phrase and filler are gone.
 * Uncalibrated by construction: it is a guess about where the free text is.
 *
 * Words that belong to a sibling slot are trimmed off the end only when they
 * sit in a prepositional tail — "buy milk to the home list" gives "buy milk",
 * because "to the home list" is where the list was named. "call home" keeps
 * "home", because nothing introduces it as somewhere else.
 */
const PREP = new Set(['to', 'on', 'in', 'into', 'for', 'at', 'under', 'onto']);
const ARTICLE = new Set(['the', 'my', 'a', 'an', 'our']);

export function remainder(phrases: string[], siblingWords: () => Set<string> = () => new Set()) {
  const drop = new Set(phrases.flatMap((p) => p.toLowerCase().split(/\s+/)));
  return (text: string): Candidate[] => {
    const words = text.trim().split(/\s+/);
    const lower = words.map((w) => w.toLowerCase());
    const sib = siblingWords();
    let i = 0;
    while (i < words.length && (drop.has(lower[i]!) || FILLER.has(lower[i]!))) i++;
    let j = words.length;
    for (;;) {
      if (j <= i) break;
      const w = lower[j - 1]!;
      if (FILLER.has(w) || drop.has(w)) { j--; continue; }
      if (sib.has(w)) {
        let k = j - 2;
        while (k >= i && ARTICLE.has(lower[k]!)) k--;
        if (k >= i && PREP.has(lower[k]!)) { j = k; continue; }
      }
      break;
    }
    const value = words.slice(i, j).join(' ');
    if (!value) return [];
    return [{ value, label: value, score: 0.6, calibrated: false }];
  };
}

export type SlotPlan = {
  slots: Record<string, SlotDef>;
  /** Parameter name → how to turn a slot value into an argument. */
  toArg: Record<string, (v: unknown) => unknown>;
  /** Parameters left out because an act shows at most eight. */
  dropped: string[];
};

export function slotsFromSchema(
  schema: JsonSchema | undefined,
  opts: { phrases: string[]; catalogs: Record<string, () => Option[]> },
): SlotPlan {
  const props = Object.entries(schema?.properties ?? {});
  const required = new Set(schema?.required ?? []);
  // Required first, in declared order; then optional ones while there is room.
  const ordered = [...props.filter(([n]) => required.has(n)), ...props.filter(([n]) => !required.has(n))];
  const kept = ordered.slice(0, MAX_SLOTS);
  const dropped = ordered.slice(MAX_SLOTS).map(([n]) => n);

  const slots: Record<string, SlotDef> = {};
  const toArg: SlotPlan['toArg'] = {};
  let freeTextTaken = false;
  // Every word that names an option of some other slot in this act.
  const siblingWords = () => {
    const out = new Set<string>();
    for (const s of Object.values(slots)) {
      if (s.primitive !== 'chip' || !s.options) continue;
      const opts = s.options({} as never, {}) as Option[];
      for (const o of opts) for (const n of [o.label, ...(o.aliases ?? [])]) for (const w of n.toLowerCase().split(/\s+/)) out.add(w);
    }
    return out;
  };

  kept.forEach(([name, p], i) => {
    const order = i + 1;
    const req = required.has(name);
    const catalog = opts.catalogs[name];

    if (catalog || p.enum) {
      const list = catalog ?? (() => (p.enum ?? []).map((v) => ({ value: v, label: humanise(v) })));
      slots[name] = { primitive: 'chip', options: () => list(), required: req, order };
      toArg[name] = (v) => v;
    } else if (isType(p, 'number') || isType(p, 'integer')) {
      slots[name] = { primitive: 'quantity', resolve: (t) => resolveQuantity(t), required: req, order };
      toArg[name] = (v) => {
        const n = (v as { n?: number })?.n ?? v;
        return isType(p, 'integer') ? Math.round(Number(n)) : Number(n);
      };
    } else if (isType(p, 'string') && (p.format === 'date' || p.format === 'date-time')) {
      slots[name] = { primitive: 'when', resolve: (t, ctx) => resolveWhen(t, ctx), required: req, order };
      toArg[name] = (v) => {
        const at = (v as { at?: number })?.at;
        if (typeof at !== 'number') return v;
        const iso = new Date(at).toISOString();
        return p.format === 'date' ? iso.slice(0, 10) : iso;
      };
    } else if (isType(p, 'boolean')) {
      slots[name] = {
        primitive: 'chip', required: req, order,
        options: () => [{ value: true, label: 'yes', aliases: ['on', 'true'] }, { value: false, label: 'no', aliases: ['off', 'false'] }],
      };
      toArg[name] = (v) => v === true;
    } else if (req && !freeTextTaken) {
      freeTextTaken = true;
      slots[name] = { primitive: 'ghostField', resolve: remainder(opts.phrases, siblingWords), fill: 'either', required: true, order };
      toArg[name] = (v) => String(v);
    } else {
      slots[name] = { primitive: 'ghostField', fill: 'model', required: req, order,
        // A model-only slot still needs something the core can call; it
        // offers nothing, so the slot waits for a model or a touch.
        resolve: () => [] };
      toArg[name] = (v) => String(v);
    }
  });

  return { slots, toArg, dropped };
}
