/**
 * Runtime act composition. Spec v0.2 §7 of the brief, resolved.
 *
 * The ask is "if I want tickets, build me a ticket interface." The naive answer
 * is to let a model write UI at runtime, which throws away the closed enum and
 * with it the speed, the reviewability and the App Store story.
 *
 * What a model composes here is an ACT, not an interface: a name, some slots,
 * and which capability it binds to. Every primitive it may use already exists;
 * every function it may call was registered by the host at build time. So the
 * user sees a screen that did not exist a second ago, and nothing was generated
 * but JSON.
 *
 * The rule that makes this safe, and the reason radius lives on the capability:
 *
 *   A MODEL CANNOT LOWER BLAST RADIUS. It never writes commit, undo, effects or
 *   radius. It picks a capability, and the capability's cost comes with it.
 *
 * A composed act is then run through defineAct like any other, so all the
 * definition-time checks apply to it too.
 */

import { remainder, resolveQuantity, resolveWhen } from '@intermenu/aiuic-resolve';
import {
  defineAct,
  type ActDef,
  type CommitResult,
  type Ctx,
  type EffectDef,
  type Filled,
  type Option,
  type PrimitiveName,
  type RadiusSpec,
  type SlotDef,
} from '@intermenu/aiuic-core';

/** The closed set. A composed act may name these and nothing else. */
export const PRIMITIVES: readonly PrimitiveName[] = [
  'face', 'chip', 'when', 'quantity', 'ghostField', 'objectCard', 'peek',
] as const;

export const MAX_SLOTS = 8;
export const MAX_OPTIONS = 40;

export class ComposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeError';
  }
}

/**
 * Something the host can actually do. Registered in code, at build time, with
 * its cost declared once. This is the whole trust boundary.
 */
export type Capability<F extends Filled = Filled> = {
  name: string;
  /** Shown to the model so it can pick. Not executed, never eval'd. */
  describe: string;
  radius: RadiusSpec;
  run: (filled: F, ctx: Ctx) => CommitResult | Promise<CommitResult>;
  undo?: (r: CommitResult, ctx: Ctx) => void | Promise<void>;
  effects?: EffectDef[];
  /** Slots the capability cannot run without, and the primitive each must be. */
  requires?: Record<string, PrimitiveName>;
  /** Host data a composed slot may point at, by key. */
  catalogs?: Record<string, () => Option[]>;
};

/** Exactly what a model is allowed to emit. Data only — no functions anywhere. */
export type ActSpec = {
  name: string;
  capability: string;
  phrases?: string[];
  slots: Record<string, SlotSpec>;
};

export type SlotSpec = {
  primitive: PrimitiveName;
  order: number;
  required?: boolean;
  label?: string;
  /** Literal options, or the name of a host catalog. Never both. */
  options?: Option[];
  catalog?: string;
  params?: Record<string, unknown>;
};

const RESERVED = ['radius', 'commit', 'undo', 'effects', 'preview', 'reversible'];

function assertPlain(value: unknown, where: string): void {
  if (typeof value === 'function') throw new ComposeError(`${where}: functions are not allowed in a spec`);
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertPlain(v, `${where}.${k}`);
  }
}

export class Composer {
  private readonly caps = new Map<string, Capability>();

  register(cap: Capability): void {
    if (!cap.name) throw new ComposeError('a capability needs a name');
    if (typeof cap.run !== 'function') throw new ComposeError(`${cap.name}: capability needs run()`);
    this.caps.set(cap.name, cap as Capability);
  }

  get capabilities(): Capability[] {
    return [...this.caps.values()];
  }

  /** What the model is told it may pick from. Data, not code. */
  menu(): Array<{ capability: string; describe: string; requires: Record<string, PrimitiveName>; catalogs: string[] }> {
    return this.capabilities.map((c) => ({
      capability: c.name,
      describe: c.describe,
      requires: c.requires ?? {},
      catalogs: Object.keys(c.catalogs ?? {}),
    }));
  }

  compose(spec: ActSpec): ActDef {
    if (!spec || typeof spec !== 'object') throw new ComposeError('spec must be an object');
    assertPlain(spec, 'spec');

    for (const key of RESERVED) {
      if (key in (spec as Record<string, unknown>)) {
        throw new ComposeError(`spec may not set "${key}" — that belongs to the capability`);
      }
    }

    if (!spec.name || !/^[a-z][a-z0-9_]{1,48}$/.test(spec.name)) {
      throw new ComposeError(`"${String(spec.name)}" is not a valid act name`);
    }

    const cap = this.caps.get(spec.capability);
    if (!cap) {
      throw new ComposeError(
        `unknown capability "${spec.capability}" — a composed act can only bind to one the host registered`,
      );
    }

    const entries = Object.entries(spec.slots ?? {});
    if (entries.length === 0) throw new ComposeError(`${spec.name}: needs at least one slot`);
    if (entries.length > MAX_SLOTS) throw new ComposeError(`${spec.name}: at most ${MAX_SLOTS} slots`);

    const slots: Record<string, SlotDef> = {};
    for (const [name, raw] of entries) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,32}$/.test(name)) {
        throw new ComposeError(`${spec.name}: "${name}" is not a valid slot name`);
      }
      if (!PRIMITIVES.includes(raw.primitive)) {
        throw new ComposeError(
          `${spec.name}.${name}: "${raw.primitive}" is not in the primitive set — the set is closed`,
        );
      }
      if (typeof raw.order !== 'number') throw new ComposeError(`${spec.name}.${name}: needs an order`);

      if (raw.options && raw.catalog) {
        throw new ComposeError(`${spec.name}.${name}: give options or a catalog, not both`);
      }

      let options: SlotDef['options'];
      if (raw.catalog) {
        const cat = cap.catalogs?.[raw.catalog];
        if (!cat) {
          throw new ComposeError(
            `${spec.name}.${name}: unknown catalog "${raw.catalog}" on capability "${cap.name}"`,
          );
        }
        options = () => cat();
      } else if (raw.options) {
        if (raw.options.length > MAX_OPTIONS) {
          throw new ComposeError(`${spec.name}.${name}: at most ${MAX_OPTIONS} options`);
        }
        const frozen = raw.options.map((o) => ({ ...o }));
        options = () => frozen;
      } else {
        options = () => [];
      }

      const slot: SlotDef = { primitive: raw.primitive, order: raw.order, options };
      // A composed slot gets the same local grammar a hand-written one would:
      // "tomorrow at 9", "$12", and the rest of the sentence for free text.
      // Without these it could only be filled by a tap or a model, which
      // makes a composed act useless offline.
      if (!raw.options && !raw.catalog) {
        if (raw.primitive === 'when') slot.resolve = (t, c) => resolveWhen(t, c);
        else if (raw.primitive === 'quantity') slot.resolve = (t) => resolveQuantity(t);
        else if (raw.primitive === 'ghostField') {
          const siblings = () => {
            const out = new Set<string>();
            for (const [k, sd] of Object.entries(slots)) {
              if (k === name || !sd.options) continue;
              const opts = sd.options({} as never, {});
              if (Array.isArray(opts)) for (const o of opts) for (const n of [o.label, ...(o.aliases ?? [])]) for (const w of String(n).toLowerCase().split(/\s+/)) out.add(w);
            }
            return out;
          };
          slot.resolve = remainder(spec.phrases ?? [], siblings);
          slot.fill = 'either';
        }
      }
      if (raw.required) slot.required = true;
      if (raw.params) slot.params = raw.params;
      slots[name] = slot;
    }

    for (const [need, prim] of Object.entries(cap.requires ?? {})) {
      const got = slots[need];
      if (!got) throw new ComposeError(`${spec.name}: capability "${cap.name}" requires a "${need}" slot`);
      if (got.primitive !== prim) {
        throw new ComposeError(
          `${spec.name}.${need}: capability "${cap.name}" requires primitive "${prim}", got "${got.primitive}"`,
        );
      }
      got.required = true;
    }

    // Cost comes from the capability. This line is the security boundary.
    const def: ActDef = {
      name: spec.name,
      slots,
      radius: cap.radius,
      commit: (f, ctx) => cap.run(f, ctx),
    };
    if (spec.phrases) def.phrases = spec.phrases.slice(0, 12).map(String);
    if (cap.undo) def.undo = (r, ctx) => cap.undo!(r, ctx);
    if (cap.effects) def.effects = cap.effects;

    return defineAct(def);
  }

  /** Parse and compose in one step, for a model reply that arrives as text. */
  composeJson(json: string): ActDef {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new ComposeError('spec is not valid JSON');
    }
    return this.compose(parsed as ActSpec);
  }
}
