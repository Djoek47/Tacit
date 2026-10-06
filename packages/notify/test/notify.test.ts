import { describe, expect, it, vi } from 'vitest';
import { FakeClock, type ActDef, type Ctx } from '@intermenu/aiuic-core';

const radiusOf = (act: ActDef, f: Record<string, unknown>) =>
  typeof act.radius === 'string' ? act.radius : act.radius.of(f, {} as Ctx);
import { createApp } from '@intermenu/aiuic-kit';
import { ContextMemory, Desk, brief, notifyAct, type Notice, type WorldSource } from '../src/index.js';

const H = 3_600_000;
const NOON = Date.UTC(2026, 9, 6, 12);
const hourOf = (t: number) => new Date(t).getUTCHours();
let n = 0;
const notice = (p: Partial<Notice>): Notice => ({ id: `n${++n}`, from: 'app:bank', title: 'x', topics: ['money'], urgency: 0.9, at: NOON, ...p });

describe('the desk may delay a notice; it may never hide one', () => {
  it('keeps every notice it is given, whatever it decides about interrupting', () => {
    const d = new Desk(undefined, hourOf);
    const given = Array.from({ length: 12 }, (_, i) => notice({ urgency: i % 2 ? 0.95 : 0.1, at: NOON + i }));
    for (const g of given) d.ingest(g);
    expect(d.all().map((x) => x.id).sort()).toEqual(given.map((g) => g.id).sort());
  });

  it('offers no way to delete, hide or filter a notice', () => {
    const names = Object.getOwnPropertyNames(Desk.prototype);
    expect(names.filter((x) => /delete|remove|hide|drop|clear|dismiss|filter|suppress/i.test(x))).toEqual([]);
  });

  it('sends what is not urgent to the briefing instead of interrupting', () => {
    expect(new Desk(undefined, hourOf).ingest(notice({ urgency: 0.2 })).delivery).toBe('briefing');
  });

  it('holds the hour budget: the fourth urgent notice in an hour waits', () => {
    const d = new Desk(undefined, hourOf);
    const out = [0, 1, 2, 3].map((i) => d.ingest(notice({ at: NOON + i * 60_000 })).delivery);
    expect(out).toEqual(['now', 'now', 'now', 'bundle']);
    // An hour later the budget is back.
    expect(d.ingest(notice({ at: NOON + H + 5 * 60_000 })).delivery).toBe('now');
  });

  it('keeps quiet hours, except for a person, who may break through', () => {
    const d = new Desk(undefined, hourOf);
    const night = Date.UTC(2026, 9, 6, 23);
    expect(d.ingest(notice({ at: night })).delivery).toBe('bundle');
    expect(d.ingest(notice({ at: night, from: 'person:maya' })).delivery).toBe('now');
  });

  it('does not let the same story interrupt twice', () => {
    const d = new Desk(undefined, hourOf);
    expect(d.ingest(notice({ groupKey: 'storm' })).delivery).toBe('now');
    expect(d.ingest(notice({ groupKey: 'storm', at: NOON + 60_000 })).delivery).toBe('bundle');
    expect(d.bundles().find((b) => b.key === 'storm')!.notices).toHaveLength(2);
  });
});

describe('sending to somebody is an act, with a blast radius', () => {
  const people = [{ value: 'maya', label: 'Maya' }];
  const ctx = () => ({ actor: { id: 'me', basePauseMs: 850 },
    attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
    reachLimit: 1, undoWindowMs: 5000 }) as Omit<Ctx, 'now'>;

  it('costs nothing to send to yourself, other-person to send to anybody else', () => {
    const act = notifyAct({ send: async () => ({ id: '1' }), retract: async () => {} }, people);
    const of = (f: Record<string, unknown>) => radiusOf(act, f);
    expect(of({ to: 'me' })).toBe('self');
    expect(of({ to: 'maya' })).toBe('other-person');
  });

  it('is external when the channel cannot take a message back', () => {
    const act = notifyAct({ send: async () => ({ id: '1' }) }, people);
    expect(radiusOf(act, { to: 'maya' })).toBe('external');
    expect(act.undo).toBeUndefined();
  });

  it('sends nothing while it sits on the stage', () => {
    const send = vi.fn(async () => ({ id: '1' }));
    const app = createApp({ clock: new FakeClock(NOON), ctx, acts: [notifyAct({ send, retract: async () => {} }, people)] });
    app.pick('send_notification');
    expect(send).not.toHaveBeenCalled();
    expect(app.view()!.canAssent).toBe(false);
  });
});

describe('the shared context memory flows one way', () => {
  const world = (items: { id: string; topics: string[]; place?: { lat: number; lon: number } }[]): WorldSource => ({
    name: 'world', pull: async () => items.map((i) => ({ ...i, source: 'world', title: i.id, at: NOON - H })),
  });

  it('has no door that takes anything about a person', () => {
    const names = Object.getOwnPropertyNames(ContextMemory.prototype);
    expect(names.filter((x) => /add|put|write|set|insert|remember|learn|user|person|profile/i.test(x))).toEqual([]);
  });

  it('keeps the other sources when one fails', async () => {
    const broken: WorldSource = { name: 'broken', pull: async () => { throw new Error('down'); } };
    const c = new ContextMemory([broken, world([{ id: 'a', topics: ['oil'] }])]);
    expect(await c.refresh(NOON)).toEqual({ added: 1, failed: ['broken'] });
  });

  it('finds by topic, and by distance from a place', async () => {
    const c = new ContextMemory([world([
      { id: 'montreal-storm', topics: ['weather'], place: { lat: 45.5, lon: -73.57 } },
      { id: 'tokyo-quake', topics: ['earthquake'], place: { lat: 35.68, lon: 139.69 } },
      { id: 'oil-up', topics: ['oil'] },
    ])]);
    await c.refresh(NOON);
    expect(c.query({ topics: ['oil'] }).map((i) => i.id)).toEqual(['oil-up']);
    expect(c.query({ near: { lat: 45.5, lon: -73.6, km: 50 } }).map((i) => i.id)).toEqual(['montreal-storm']);
  });

  it('forgets what is older than a week', async () => {
    const c = new ContextMemory([world([{ id: 'old', topics: ['oil'] }])]);
    await c.refresh(NOON);
    await c.refresh(NOON + 8 * 24 * H);
    expect(c.size).toBe(0);
  });
});

describe('the briefing', () => {
  const ctxFor = async () => {
    const c = new ContextMemory([{ name: 'world', pull: async () => [
      { id: '1', source: 'world', title: 'Storm warning for Montreal tonight', topics: ['weather'], at: NOON - H, place: { lat: 45.5, lon: -73.57 } },
      { id: '2', source: 'world', title: 'Crude oil up four percent', topics: ['oil'], at: NOON - H },
      { id: '3', source: 'world', title: 'Celebrity wedding announced', topics: ['celebrities'], at: NOON - H },
      { id: '4', source: 'world', title: 'New AI chip export rules', topics: ['ai'], at: NOON - H },
    ] }]);
    await c.refresh(NOON);
    return c;
  };

  it('puts the person first, then around them, then what they follow, and says why each line is there', async () => {
    const d = new Desk(undefined, hourOf);
    d.ingest(notice({ title: 'Rent paid', urgency: 0.3, at: NOON - 2 * H }));
    const b = brief({ interests: ['ai', 'oil'], home: { lat: 45.5, lon: -73.6, km: 50, label: 'Montreal' } }, d, await ctxFor(), NOON);
    expect(b.sections.map((s) => s.name)).toEqual(['For you', 'Around you', 'What you follow']);
    expect(b.sections[1]!.items[0]!.why).toBe('near Montreal');
    // Ranked by the order the person gave their interests: ai before oil.
    expect(b.sections[2]!.items.map((i) => i.why)).toEqual(['you follow ai', 'you follow oil']);
  });

  it('leaves out the loud thing nobody asked about', async () => {
    const b = brief({ interests: ['ai'] }, new Desk(undefined, hourOf), await ctxFor(), NOON);
    expect(b.sections.flatMap((s) => s.items).some((i) => /Celebrity/.test(i.title))).toBe(false);
  });

  it('stays inside the time asked for, and says how much it left out', async () => {
    const b = brief({ interests: ['ai', 'oil'], minutes: 0.05 }, new Desk(undefined, hourOf), await ctxFor(), NOON);
    expect(b.words).toBeLessThanOrEqual(0.05 * 130);
    expect(b.leftOut).toBeGreaterThan(0);
  });
});
