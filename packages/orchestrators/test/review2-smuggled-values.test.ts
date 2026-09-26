/**
 * Review 2: a model's proposal can put a value on the card that the host never
 * offered, labelled as one it did. checkPlan accepts any one-level record with
 * a `label`, and Pyramid.propose writes it with setValue(…, 'model') without
 * matching it back to the slot's options (applyToolCall in packages/tools does
 * match, and says why: "a model that echoes a label cannot smuggle in a value
 * the host never offered"). The card reads the label; commit() gets the value.
 *
 * With findings from an MCP server in the prompt, the text that chooses these
 * values can come from anyone the server reads.
 */
import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx, type Option } from '@intermenu/aiuic-core';
import { createApp, defineAct } from '@intermenu/aiuic-kit';
import { resolveQuantity } from '@intermenu/aiuic-resolve';
import { Aggregator, Pyramid, tableSource } from '@intermenu/aiuic-pyramid';
import { anthropicOrchestrator, checkPlan, actCards } from '../src/index.js';
import { stubFetch } from './fixture.js';

const MAYA = { id: 'maya', label: 'Maya' };
const SAM = { id: 'sam', label: 'Sam' };
const PEOPLE: Option[] = [{ value: MAYA, label: 'Maya' }, { value: SAM, label: 'Sam' }];

function build(fill: Record<string, unknown>) {
  const clock = new FakeClock(1_700_000_000_000);
  const paid: Record<string, unknown>[] = [];
  const attention = { foreground: true, unlocked: true, proximityClear: true, listening: true };
  const ctxFn = () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 });
  const app = createApp({
    clock, ctx: ctxFn,
    acts: [defineAct({
      name: 'settle_up', domain: 'allowance', phrases: ['pay'],
      slots: {
        payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
        amount: { primitive: 'quantity', resolve: resolveQuantity, required: true, order: 2 },
      },
      radius: 'external',
      commit: (f) => { paid.push(f); return { id: 'p' + paid.length }; },
    })],
  });
  const f = stubFetch({ content: [{ type: 'tool_use', id: 't', name: 'propose',
    input: { act: 'settle_up', fill, why: 'Maya is owed $50 for the groceries.' } }], stop_reason: 'tool_use' });
  const pyramid = new Pyramid({
    app,
    aggregator: new Aggregator([tableSource('splitwise', [
      { claim: 'Maya is owed $50 for groceries', words: ['maya', 'owe'] },
    ])]),
    orchestrator: anthropicOrchestrator({ apiKey: 'sk-ant-api03-XXXXXXXXXXXX', model: 'm', acts: () => app.ui.definitions, fetch: f.fetch }),
    ctx: () => ({ ...ctxFn(), now: new Date(clock.now()) }) as Ctx,
    now: () => clock.now(),
  });
  return { app, pyramid, paid };
}

describe('review2: what the person says yes to is what is written', () => {
  it('a face slot only ever holds one of the people the host offered', async () => {
    const h = build({ payee: { id: 'mallory', label: 'Maya' }, amount: { n: 50, label: '$50' } });
    await h.pyramid.pursue('what do I owe Maya');
    // The smuggled value never reaches the card. The planner refuses the proposal outright
    // (checkPlan admits values through the slot's options); had one got past it, the pyramid
    // would have left the slot empty for the person. Either way there is nothing to say yes to.
    if (h.app.act) {
      expect(h.app.view()?.slots.find((s) => s.name === 'payee')?.value).toBeUndefined();
      await expect(h.app.act.assent()).rejects.toThrow(/nothing to assent to/);
    }
    expect(h.paid).toEqual([]);
  });

  it('a quantity whose label disagrees with its number is not accepted', async () => {
    const h = build({ payee: 'Maya', amount: { n: 5000, label: '$50' } });
    await h.pyramid.pursue('what do I owe Maya');
    const shown = h.app.view()?.slots.find((s) => s.name === 'amount')?.display;
    if (h.app.act) await h.app.act.assent(); // the card says "$50"
    const n = (h.paid[0]?.amount as { n?: number } | undefined)?.n;
    expect({ shown, paid: n }).not.toEqual({ shown: '$50', paid: 5000 });
  });

  it('checkPlan refuses a chip value that is not one of the options', () => {
    const cards = actCards([defineAct({
      name: 'set_budget', phrases: ['budget'],
      slots: { category: { primitive: 'chip', options: () => [{ value: 'groceries', label: 'Groceries' }], required: true, order: 1 } },
      radius: 'self', commit: () => ({ id: '1' }), undo: () => {},
    })]);
    const c = checkPlan('propose', { act: 'set_budget', fill: { category: { value: 'savings', label: 'Groceries' } }, why: 'x' }, cards);
    expect(c.ok).toBe(false);
  });
});
