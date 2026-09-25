import { describe, expect, it } from 'vitest';
import { FakeClock, type Option } from '@intermenu/aiuic-core';
import { createApp, defineAct } from '../src/index.js';

declare const setTimeout: (fn: () => void, ms: number) => unknown;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(() => r(), 0)); };
const ITEMS: Option[] = [{ value: 'milk', label: 'Milk' }, { value: 'jam', label: 'Jam' }];
const attention = { foreground: true, unlocked: true, proximityClear: true, listening: true };

// Found by independent review: a hold that began on a final transcript kept
// running when the person started talking again, and committed mid-sentence.
describe('speech that resumes after a final transcript', () => {
  it('stops the hold, commits nothing while speech is partial, and commits once it ends', async () => {
    const clock = new FakeClock(1_700_000_000_000);
    const written: string[] = [];
    const app = createApp({
      clock,
      ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }),
      acts: [defineAct({ name: 'add_item', phrases: ['add'],
        slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
        radius: 'self', commit: (f) => { written.push(String(f.item)); return { id: 'x' }; }, undo: () => { written.pop(); } })],
    });
    app.hear('add milk', { final: false });
    app.hear('add milk', { final: true });          // recognizer endpoints on a short pause
    expect(app.act!.status).toBe('hold');
    // The person keeps talking ("add milk... no wait, jam"): partial text arrives.
    const r = app.hear('add milk no wait', { final: false });
    expect(r.final).toBe(false);
    expect(app.act!.speculative).toBe(true);        // back to a reading of speech in progress
    expect(app.act!.status).not.toBe('hold');
    clock.advance(5_000); await settle();
    expect(written).toEqual([]);                    // nothing committed mid-utterance
    app.hear('add jam', { final: true });           // the sentence ends
    clock.advance(900); await settle();
    expect(written).toEqual(['jam']);
  });
});
