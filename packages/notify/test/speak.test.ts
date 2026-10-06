import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx } from '@intermenu/aiuic-core';
import { createApp } from '@intermenu/aiuic-kit';
import { ContextMemory, Desk, briefingAct, script, worldMonitorSource } from '../src/index.js';

const NOW = Date.UTC(2026, 9, 6, 11);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const call = async (path: string) => ({
  '/api/economic/v1/get-energy-prices': { prices: [{ commodity: 'WTI', name: 'WTI crude', price: 88.4, unit: 'USD/bbl', change: 3.6 }] },
  '/api/economic/v1/get-economic-calendar': { events: [{ event: 'CPI release', country: 'US', estimate: '3.1%' }] },
} as Record<string, unknown>)[path] ?? {};

async function setup() {
  const clock = new FakeClock(NOW);
  const context = new ContextMemory([worldMonitorSource(call, ['energy', 'calendar'], () => NOW)]);
  await context.refresh(NOW);
  const said: string[] = [];
  const app = createApp({
    clock,
    ctx: () => ({ actor: { id: 'me', basePauseMs: 850 },
      attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
      reachLimit: 1, undoWindowMs: 5000 }) as Omit<Ctx, 'now'>,
    acts: [briefingAct({ desk: new Desk(), context, profile: () => ({ name: 'Cicentos', interests: ['trading'] }), now: () => NOW, speak: (t) => { said.push(t); } })],
  });
  return { app, clock, said };
}

describe('"brief me", in the conversation', () => {
  it('routes the ways people ask for it', async () => {
    const { app } = await setup();
    for (const s of ['brief me', 'what did I miss', 'catch me up', 'give me the morning report']) {
      app.reset();
      expect([s, app.hear(s, { final: true }).act]).toEqual([s, 'get_briefing']);
    }
  });

  it('hears the length asked for', async () => {
    const { app } = await setup();
    app.hear('brief me, the quick version', { final: true });
    expect(app.view()!.slots.find((s) => s.name === 'length')!.value).toBe(5);
  });

  it('starts talking on silence, because asking for one writes nothing', async () => {
    const { app, clock, said } = await setup();
    app.hear('brief me', { final: true });
    expect(app.view()!.radius).toBe('self');
    clock.advance(5_000); await tick(); await tick();
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^Good morning, Cicentos\. Here is your briefing\./);
    expect(said[0]).toMatch(/About 1 minute\./);
    expect(said[0]).toMatch(/What you follow\. .*US: CPI release\./);
    expect(said[0]).toMatch(/WTI crude 88\.4 USD\/bbl \(\+3\.6\)\./);
  });
});

describe('the words, written to be heard', () => {
  it('says so plainly when there is nothing', () => {
    expect(script({ sections: [], words: 0, minutes: 0, leftOut: 0 }, 'Cicentos')).toBe('Cicentos, nothing needs you this morning, and nothing moved in what you follow.');
  });

  it('says what it left out, and how to hear it', () => {
    const t = script({ sections: [{ name: 'For you', items: [{ title: 'Rent paid', why: '', source: 'app:bank', at: 0, words: 2 }] }], words: 2, minutes: 0.1, leftOut: 4 });
    expect(t).toMatch(/I left out 4 more to keep it short\. Ask for the long version/);
  });
});
