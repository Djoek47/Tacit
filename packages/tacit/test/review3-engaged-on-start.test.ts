import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx } from '@intermenu/aiuic-core';
import { createTacit } from '../src/index.js';

declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));
const ctx = () => ({ actor: { id: 'me', basePauseMs: 850 },
  attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
  reachLimit: 1, undoWindowMs: 5000 }) as Omit<Ctx, 'now'>;

async function say(s: string) {
  const clock = new FakeClock(Date.UTC(2026, 9, 6, 23));
  const said: string[] = [];
  const t = createTacit({ profile: { interests: ['trading'] }, clock, ctx, now: () => clock.now(), speak: (x) => { said.push(x); } });
  const r = t.hear(s, { final: true });
  clock.advance(5_000); await tick(); await tick();
  return { status: r.run?.status, said };
}

describe('review3: markEngaged on a routed start commits sentences that refuse or defer the act', () => {
  for (const s of ["don't brief me", 'cancel the briefing', "don't update me", 'no briefing today', 'catch me up after lunch', 'update me later']) {
    it(`"${s}" does not speak a briefing on silence`, async () => {
      const { status, said } = await say(s);
      expect(said).toHaveLength(0);
      expect(status).not.toBe('settled');
    });
  }
});
