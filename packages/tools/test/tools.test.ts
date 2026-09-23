import { describe, expect, it } from 'vitest';
import { createAIUIC, defineAct, FakeClock, type ActDef, type Option } from '@intermenu/aiuic-core';
import { actSchema, applyToolCall, describeAct, toolSchema } from '../src/index.js';

const SAM = { id: 'sam' }, MAYA = { id: 'maya' };
const PEOPLE: Option[] = [{ value: SAM, label: 'Sam' }, { value: MAYA, label: 'Maya' }];
const optionsFor = (_a: ActDef, slot: string) => (slot === 'assignee' || slot === 'payee' ? PEOPLE : []);

const assign = defineAct({
  name: 'assign_errand',
  phrases: ['picks up'],
  slots: {
    assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    errand: { primitive: 'ghostField', required: true, options: () => [], order: 2 },
    due: { primitive: 'when', params: { granularity: 'day' }, options: () => [], order: 3 },
  },
  radius: { max: 'other-person', of: () => 'other-person' },
  commit: () => ({ id: 'e1' }), undo: () => {},
});

const pay = defineAct({
  name: 'settle_up',
  slots: {
    payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    amount: { primitive: 'quantity', params: { min: 1, max: 500, unit: { code: 'CAD' } }, options: () => [], required: true, order: 2 },
    receipt: { primitive: 'peek', options: () => [], order: 3 },
  },
  radius: 'external',
  commit: () => ({ id: 'p1' }),
});

describe('tool schema generation', () => {
  it('turns a bounded slot into an enum of labels', () => {
    const s = actSchema(assign, optionsFor);
    expect(s.properties.assignee).toEqual({
      type: 'string', enum: ['Sam', 'Maya'],
      description: 'One of the listed options, exactly as written.',
    });
  });

  it('carries units and bounds onto a quantity', () => {
    const s = actSchema(pay, optionsFor);
    expect(s.properties.amount).toMatchObject({ type: 'number', minimum: 1, maximum: 500 });
    expect(String(s.properties.amount!.description)).toMatch(/CAD/);
  });

  it('leaves read-only primitives out of the schema entirely', () => {
    const s = actSchema(pay, optionsFor);
    expect(s.properties.receipt).toBeUndefined();
  });

  it('marks required slots and forbids extras', () => {
    const s = actSchema(assign, optionsFor);
    expect(s.required).toEqual(['assignee', 'errand']);
    expect(s.additionalProperties).toBe(false);
  });

  it('tells the model what the act costs', () => {
    expect(describeAct(pay)).toMatch(/must explicitly agree/);
    expect(describeAct(assign)).toMatch(/Touches somebody else/);
  });

  it('emits each provider dialect', () => {
    const [oa] = toolSchema([assign], optionsFor, 'openai') as Array<{ type: string; function: { name: string } }>;
    expect(oa!.type).toBe('function');
    expect(oa!.function.name).toBe('assign_errand');

    const [an] = toolSchema([assign], optionsFor, 'anthropic') as Array<{ name: string; input_schema: unknown }>;
    expect(an!.name).toBe('assign_errand');
    expect(an!.input_schema).toBeTruthy();

    const [rt] = toolSchema([assign], optionsFor, 'openai-realtime') as Array<{ type: string; name: string }>;
    expect(rt!.type).toBe('function');
    expect(rt!.name).toBe('assign_errand');
  });
});

describe('applying a tool call', () => {
  function ui() {
    const u = createAIUIC({
      clock: new FakeClock(1_700_000_000_000),
      ctx: () => ({
        actor: { id: 'me' },
        attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
        reachLimit: 1,
      }),
    });
    u.defineAct(assign); u.defineAct(pay);
    return u;
  }

  it('matches a label back to the host object', () => {
    const u = ui();
    const { run } = applyToolCall(u, { name: 'assign_errand', arguments: { assignee: 'Maya', errand: 'the parcel' } }, optionsFor);
    expect(run.slots.assignee?.value).toBe(MAYA);
    expect(run.slots.assignee?.source).toBe('model');
  });

  it('accepts arguments as a JSON string, as providers send them', () => {
    const u = ui();
    const { run } = applyToolCall(u, { name: 'assign_errand', arguments: '{"assignee":"Sam"}' }, optionsFor);
    expect(run.slots.assignee?.value).toBe(SAM);
  });

  it('refuses a value the host never offered', () => {
    const u = ui();
    const { run, unmatched } = applyToolCall(u, { name: 'assign_errand', arguments: { assignee: 'Gregor' } }, optionsFor);
    expect(unmatched).toEqual(['assignee']);
    expect(run.slots.assignee?.status).toBe('empty');
  });

  it('reports a slot the act does not have instead of inventing one', () => {
    const u = ui();
    const { unknownSlots } = applyToolCall(u, { name: 'assign_errand', arguments: { wormhole: true } }, optionsFor);
    expect(unknownSlots).toEqual(['wormhole']);
  });

  it('throws on an act that was never defined', () => {
    const u = ui();
    expect(() => applyToolCall(u, { name: 'drop_database', arguments: {} }, optionsFor)).toThrow(/unknown act/);
  });

  it('a model-filled external act still cannot silence-commit', () => {
    const u = ui();
    const { run } = applyToolCall(u, { name: 'settle_up', arguments: { payee: 'Sam', amount: 20 } }, optionsFor);
    expect(run.radius).toBe('external');
    expect(run.status).toBe('explicit');
  });
});
