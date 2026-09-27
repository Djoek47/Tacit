/**
 * A project's own functions become acts.
 *
 * The shortest path for a developer who has code but no API document and no
 * MCP server: wrap the functions they already have. This is `defineAct` with
 * the boilerplate removed, not a second way of deciding what things cost.
 *
 * The trust here is different from the OpenAPI and MCP paths, and deliberately
 * so. A server's annotations are written by somebody else, so they may only
 * raise a cost. A function's declaration is written by the developer whose app
 * this is — the same person who would have called `defineAct` — so what they
 * declare is taken at face value. What is NOT taken on faith is silence: a
 * function that declares no undo is irreversible, and irreversible is external,
 * whatever else it says.
 */

import { defineAct, type ActDef, type Filled, type Option, type SlotDef } from '@intermenu/aiuic-core';
import { slotsFromSchema, type JsonSchema } from '@intermenu/aiuic-mcp';

export type FunctionSpec = {
  name: string;
  /** One line a person will read on the card. */
  describe?: string;
  /** Which part of the app this belongs to; it groups the menus. */
  domain?: string;
  phrases?: string[];
  /** What it takes, as JSON Schema. Slots are built from it. */
  parameters?: JsonSchema;
  /** Hand-written slots, when the schema cannot say enough. Wins over `parameters`. */
  slots?: Record<string, SlotDef>;
  run(args: Record<string, unknown>): unknown | Promise<unknown>;
  /** Puts it back. Without one, the act is external and stays there. */
  undo?(result: { id: string; [k: string]: unknown }): void | Promise<void>;
  /** True when it reaches beyond this device: money, mail, somebody else's day. */
  reachesOutside?: boolean;
  /** True when it touches somebody other than the person using the app. */
  touchesSomeoneElse?: boolean;
};

export type FunctionOptions = {
  catalogs?: Record<string, () => Option[]>;
};

/** What a function costs to get wrong, from what its author declared. */
export function costOf(fn: FunctionSpec): 'self' | 'shared' | 'other-person' | 'external' {
  // No way back is the one thing no declaration can talk its way out of.
  if (!fn.undo) return 'external';
  if (fn.reachesOutside) return 'external';
  if (fn.touchesSomeoneElse) return 'other-person';
  return 'self';
}

export function fromFunctions(fns: readonly FunctionSpec[], opts: FunctionOptions = {}): ActDef[] {
  const seen = new Set<string>();
  return fns.map((fn) => {
    if (seen.has(fn.name)) throw new Error(`two functions are called "${fn.name}"; a person could not tell them apart`);
    seen.add(fn.name);

    const phrases = fn.phrases ?? [fn.name.split('_')[0]!];
    const plan = fn.slots
      ? { slots: fn.slots, toArg: {} as Record<string, (v: unknown) => unknown> }
      : slotsFromSchema(fn.parameters, { phrases, catalogs: opts.catalogs ?? {} });

    const toArgs = (filled: Filled) => {
      const args: Record<string, unknown> = {};
      for (const [slot, value] of Object.entries(filled)) {
        const conv = plan.toArg[slot];
        args[slot] = conv ? conv(value) : value;
      }
      return args;
    };

    return defineAct({
      name: fn.name,
      ...(fn.domain ? { domain: fn.domain } : {}),
      phrases,
      slots: plan.slots,
      radius: costOf(fn),
      commit: async (filled) => {
        const out = await fn.run(toArgs(filled));
        const o = out as Record<string, unknown> | null;
        const id = o && typeof o === 'object' && (typeof o.id === 'string' || typeof o.id === 'number')
          ? String(o.id) : fn.name;
        return { id, result: out };
      },
      ...(fn.undo ? { undo: async (r) => { await fn.undo!(r as { id: string }); } } : {}),
    });
  });
}
