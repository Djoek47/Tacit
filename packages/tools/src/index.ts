/**
 * Tool schemas, generated from act definitions. Decision 6: never hand-written.
 *
 * The closed enum only stays closed if it is derived. The moment someone types
 * a tool list by hand it drifts from the acts, and the model starts asking for
 * things the engine cannot do.
 */

import type { ActDef, Ctx, Filled, Option, SlotDef } from '@intermenu/aiuic-core';
import type { AIUIC, ActRun } from '@intermenu/aiuic-core';

export type Dialect = 'openai' | 'anthropic' | 'openai-realtime' | 'json-schema';

export type OptionsFor = (act: ActDef, slot: string) => Option[];

/** Beyond this an enum is noise in the prompt; the slot takes free text instead. */
export const MAX_ENUM = 50;

export type JsonSchema = {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties: false;
};

function labelOf(o: Option, i: number): string {
  return o.label || String(o.value ?? i);
}

function slotSchema(slot: SlotDef, options: Option[]): Record<string, unknown> | null {
  const p = slot.primitive;
  if (p === 'peek' || p === 'holdRing' || p === 'resultMark') return null;

  if (p === 'quantity') {
    const params = (slot.params ?? {}) as { min?: number; max?: number; unit?: { code?: string; kind?: string } };
    const out: Record<string, unknown> = { type: 'number' };
    if (typeof params.min === 'number') out.minimum = params.min;
    if (typeof params.max === 'number') out.maximum = params.max;
    const unit = params.unit?.code ?? params.unit?.kind;
    out.description = unit ? `A number in ${unit}.` : 'A number.';
    return out;
  }

  if (p === 'when') {
    const gran = ((slot.params ?? {}) as { granularity?: string }).granularity ?? 'day';
    return {
      type: 'string',
      description:
        gran === 'minute'
          ? 'A time, as the user said it ("nine", "tonight") or ISO 8601.'
          : 'A date, as the user said it ("Friday", "tomorrow") or ISO 8601 (YYYY-MM-DD).',
    };
  }

  if (p === 'ghostField') return { type: 'string', description: 'Free text.' };

  // face, chip, objectCard and any host primitive: a choice, if it is bounded.
  if (options.length > 0 && options.length <= MAX_ENUM) {
    return { type: 'string', enum: options.map(labelOf), description: 'One of the listed options, exactly as written.' };
  }
  return { type: 'string' };
}

export function actSchema(act: ActDef, optionsFor: OptionsFor): JsonSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  const ordered = Object.entries(act.slots).sort(([, a], [, b]) => a.order - b.order);
  for (const [name, slot] of ordered) {
    const s = slotSchema(slot, optionsFor(act, name));
    if (!s) continue;
    properties[name] = s;
    if (slot.required) required.push(name);
  }

  const out: JsonSchema = { type: 'object', properties, additionalProperties: false };
  if (required.length) out.required = required;
  return out;
}

export function describeAct(act: ActDef): string {
  const radius = typeof act.radius === 'string' ? act.radius : act.radius.max;
  const cost =
    radius === 'external'
      ? 'Irreversible or costly: the user must explicitly agree before it runs.'
      : radius === 'other-person'
        ? 'Touches somebody else.'
        : radius === 'shared'
          ? 'Changes shared state. Reversible.'
          : 'Affects only the user. Reversible.';
  const trigger = act.phrases?.length ? ` Said like: ${act.phrases.join(', ')}.` : '';
  return `${act.name.replace(/_/g, ' ')}. ${cost}${trigger}`;
}

export function toolSchema(
  acts: ActDef[],
  optionsFor: OptionsFor,
  dialect: Dialect = 'openai',
): unknown[] {
  return acts.map((act) => {
    const parameters = actSchema(act, optionsFor);
    const description = describeAct(act);
    if (dialect === 'anthropic') return { name: act.name, description, input_schema: parameters };
    if (dialect === 'openai-realtime') return { type: 'function', name: act.name, description, parameters };
    if (dialect === 'json-schema') return { name: act.name, description, schema: parameters };
    return { type: 'function', function: { name: act.name, description, parameters } };
  });
}

// ------------------------------------------------------------------- apply

export type ToolCall = { name: string; arguments: Record<string, unknown> | string };

export type ApplyResult = { run: ActRun; unknownSlots: string[]; unmatched: string[] };

/**
 * Bring a model's tool call onto the stage. Values are matched back to host
 * objects through the same option list the schema was generated from, so a
 * model that echoes a label cannot smuggle in a value the host never offered.
 */
export function applyToolCall(
  ui: AIUIC,
  call: ToolCall,
  optionsFor: OptionsFor,
  _ctx?: Ctx,
): ApplyResult {
  const args: Record<string, unknown> =
    typeof call.arguments === 'string' ? (JSON.parse(call.arguments) as Record<string, unknown>) : call.arguments;

  const def = ui.definitions.find((d) => d.name === call.name);
  if (!def) throw new Error(`unknown act "${call.name}"`);

  const run = ui.start(call.name);
  const unknownSlots: string[] = [];
  const unmatched: string[] = [];

  for (const [slot, raw] of Object.entries(args ?? {})) {
    const sd = def.slots[slot];
    if (!sd) { unknownSlots.push(slot); continue; }

    const options = optionsFor(def, slot);
    if (options.length > 0) {
      const hit = options.find(
        (o, i) => labelOf(o, i) === raw || o.value === raw || String(o.value) === String(raw),
      );
      if (!hit) { unmatched.push(slot); continue; }
      run.setValue(slot, hit.value, 'model');
    } else {
      run.setValue(slot, raw, 'model');
    }
  }

  return { run, unknownSlots, unmatched };
}

/** The whole tool plane for a session, ready to hand to a provider. */
export function toolPlane(ui: AIUIC, optionsFor: OptionsFor, dialect: Dialect = 'openai'): unknown[] {
  return toolSchema(ui.definitions, optionsFor, dialect);
}

export type { Filled };
