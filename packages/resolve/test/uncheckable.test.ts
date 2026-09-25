import { describe, expect, it } from 'vitest';
import { defineAct, type ActDef, type Ctx } from '@intermenu/aiuic-core';
import { LocalResolver, pickAct, remainder, resolveQuantity, resolveWhen } from '../src/index.js';

const PEOPLE = [{ value: 'maya', label: 'Maya' }, { value: 'sam', label: 'Sam' }];
const acts: ActDef[] = [
  defineAct({ name: 'add_chore', phrases: ['add', 'add a chore'], radius: 'external', commit: () => ({ id: '1' }), slots: {
    who: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    what: { primitive: 'ghostField', resolve: remainder(['add']), required: true, order: 2 },
    when: { primitive: 'when', resolve: resolveWhen, required: true, order: 3 } } }),
  defineAct({ name: 'add_groceries', phrases: ['add', 'add groceries'], radius: 'external', commit: () => ({ id: '2' }), slots: {
    what: { primitive: 'ghostField', resolve: remainder(['add']), required: true, order: 1 } } }),
  defineAct({ name: 'pay', phrases: ['pay'], radius: 'external', commit: () => ({ id: '3' }), slots: {
    who: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    amount: { primitive: 'quantity', resolve: resolveQuantity, required: true, order: 2 } } }),
  defineAct({ name: 'plan_event', phrases: ['plan'], radius: 'external', commit: () => ({ id: '4' }), slots: {
    what: { primitive: 'ghostField', resolve: remainder(['plan']), required: true, order: 1 },
    when: { primitive: 'when', resolve: resolveWhen, required: true, order: 2 },
    who: { primitive: 'face', options: () => PEOPLE, required: true, order: 3 } } }),
  defineAct({ name: 'send_weekly', phrases: ['send', 'send the weekly'], radius: 'external', commit: () => ({ id: '5' }), slots: {
    what: { primitive: 'ghostField', resolve: remainder(['send']), required: true, order: 1 } } }),
];
const ctx = { now: new Date(Date.UTC(2026, 8, 25, 12)), actor: { id: 'me' } } as Ctx;
const optionsFor = (a: ActDef, s: string) => (a.slots[s]?.options?.(ctx, {}) ?? []) as { value: unknown; label: string }[];
const route = (t: string) => {
  const d = pickAct(new LocalResolver().scoreSync(t, acts, ctx, optionsFor));
  return d.kind === 'start' ? d.act : d.kind === 'narrow' ? d.acts[0] : null;
};

describe('an act that asks only for free text', () => {
  it('routes on its phrase when nothing else claims the sentence', () => {
    expect(route('add milk')).toBe('add_groceries');
    expect(route('send the weekly summary')).toBe('send_weekly');
  });
  it('loses to an act whose slots are actually evidenced, when they share a phrase', () => {
    expect(route('add the dishes for Maya tomorrow')).toBe('add_chore');
  });
});
