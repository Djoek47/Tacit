import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx } from '@intermenu/aiuic-core';
import type { Notice, WorldSource } from '@intermenu/aiuic-notify';
import { createTacit } from '../src/index.js';

declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));
const NIGHT = Date.UTC(2026, 9, 6, 23);
const hourOf = (t: number) => new Date(t).getUTCHours();
const ctx = () => ({ actor: { id: 'me', basePauseMs: 850 },
  attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
  reachLimit: 1, undoWindowMs: 5000 }) as Omit<Ctx, 'now'>;

const world: WorldSource = { name: 'world', pull: async () => Array.from({ length: 80 }, (_, i) => ({
  id: `w${i}`, source: 'world', title: `Market note ${i} about crude oil supply and the central bank outlook this quarter`,
  topics: ['trading'], at: NIGHT - 3_600_000,
})) };

function setup() {
  const clock = new FakeClock(NIGHT);
  const said: string[] = [];
  const t = createTacit({
    profile: { name: 'Cicentos', interests: ['trading'] },
    world: [world], clock, ctx, now: () => clock.now(), hourOf,
    speak: (s) => { said.push(s); },
  });
  const say = async (s: string) => { t.hear(s, { final: true }); clock.advance(5_000); await tick(); await tick(); };
  let n = 0;
  const notice = (p: Partial<Notice> = {}): Notice => ({ id: `n${++n}`, from: 'app:bank', title: 'Card used abroad', topics: ['money'], urgency: 0.95, at: clock.now(), ...p });
  return { t, clock, said, say, notice };
}

describe('the parts agree with each other', () => {
  it('a quiet-hours change said aloud changes what the very next notice does', async () => {
    const { t, say, notice } = setup();
    expect(t.receive(notice()).delivery).toBe('bundle');
    await say('turn off quiet hours');
    expect(t.settings.get('quiet_hours')).toBe(false);
    expect(t.receive(notice()).delivery).toBe('now');
  });

  it('the interruption budget follows the setting', async () => {
    const { t, say, notice, clock } = setup();
    await say('turn off quiet hours');
    await say('interruptions per hour one');
    expect(t.settings.get('interruptions_per_hour')).toBe(1);
    expect(t.receive(notice()).delivery).toBe('now');
    expect(t.receive(notice({ at: clock.now() + 1000 })).delivery).toBe('bundle');
  });

  it('the briefing runs as long as the setting says', async () => {
    const { t, say, said } = setup();
    await t.refresh();
    await say('brief me');
    const standard = said.at(-1)!;
    await say('set the briefing length to short');
    expect(t.settings.get('briefing_length')).toBe(5);
    t.app.reset();
    await say('brief me');
    const short = said.at(-1)!;
    expect(short.length).toBeLessThan(standard.length);
    expect(short).toMatch(/I left out \d+ more/);
  });

  it('does not speak when spoken replies are off, and still builds the briefing', async () => {
    const { t, say, said } = setup();
    await t.refresh();
    await say('turn off speak replies');
    t.app.reset();
    await say('brief me');
    expect(said).toEqual([]);
    expect(t.app.act!.def.name).toBe('get_briefing');
  });

  it('asks rather than guesses when a sentence could mean the setting or a briefing now', () => {
    const { t } = setup();
    const r = t.hear('make the briefing short', { final: true });
    expect(r.decision.kind).toBe('narrow');
    expect(r.decision.kind === 'narrow' && r.decision.acts.sort()).toEqual(['get_briefing', 'set_briefing_length']);
  });

  it('gives every part a place in the menus, with nobody writing one', () => {
    const { t } = setup();
    expect(t.menus.view().items.map((i) => i.id)).toEqual(expect.arrayContaining(['settings', 'get_briefing']));
  });
});
