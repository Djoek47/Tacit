import { describe, expect, it } from 'vitest';
import { FakeClock } from '@intermenu/aiuic-core';
import { createTacit } from '../src/index.js';

const DAY = Date.UTC(2026, 9, 6, 14);
const hourOf = (t: number) => new Date(t).getUTCHours();

function setup(restore?: Parameters<typeof createTacit>[0]['restore']) {
  const clock = new FakeClock(DAY);
  const t = createTacit({ profile: { interests: ['news'] }, clock, now: () => clock.now(), hourOf, ...(restore ? { restore } : {}) });
  return { t, clock };
}

describe('Tacit is a conversation first', () => {
  it('speaks first, then learns as it listens', () => {
    const { t } = setup();
    expect(t.open().say).toMatch(/I'm Tacit/);
    t.talk('Call me Cicentos');
    expect(t.profile.name).toBe('Cicentos');
    expect(t.person.about('basics.name')[0]!.quote).toBe('Call me Cicentos');
  });

  it('turns what you follow into what the briefing leads with', () => {
    const { t } = setup();
    t.open();
    t.talk('Cicentos'); t.talk('Montreal'); t.talk('around six');
    const before = t.profile.interests;
    // Drive to the "what you follow" thread, answering whatever comes.
    for (let i = 0; i < 6 && !t.person.about('interests.follow').length; i++) t.talk('markets, AI and hockey');
    expect(t.profile.interests.slice(0, 3)).toEqual(['markets', 'AI', 'hockey']);
    expect(before).toEqual(['news']);
  });

  it('suggests, but does not change, when your briefing is ready', () => {
    const { t } = setup();
    t.open(); t.talk('Cicentos'); t.talk('Montreal');
    const r = t.talk('around five usually');
    expect(r.offers).toEqual([{ kind: 'setting', key: 'briefing_time', value: '06:00', say: 'Have your briefing ready at 6:00?' }]);
    expect(t.settings.get('briefing_time')).toBe('07:00');
  });

  it('applies an offer about who may wake you only when accepted', () => {
    const { t } = setup();
    let asked = t.open().thread;
    let offer = null as null | ReturnType<typeof t.talk>['offers'][number];
    for (let i = 0; i < 30 && !offer; i++) {
      const r = t.talk(asked === 'people.reach' ? 'Sylla and Vincent' : 'hard to say honestly');
      asked = r.line?.thread;
      offer = r.offers.find((o) => o.kind === 'people') ?? null;
    }
    expect(offer).toMatchObject({ kind: 'people', value: ['Sylla', 'Vincent'] });
    const night = Date.UTC(2026, 9, 6, 23);
    expect(t.receive({ id: 'x', from: 'person:stranger', title: 'hi', topics: [], urgency: 0.9, at: night }).delivery).toBe('now');
    t.accept(offer!);
    expect(t.receive({ id: 'y', from: 'person:stranger', title: 'hi', topics: [], urgency: 0.9, at: night }).delivery).toBe('bundle');
    expect(t.receive({ id: 'z', from: 'person:sylla', title: 'hi', topics: [], urgency: 0.9, at: night }).delivery).toBe('now');
  });

  it('lets a command through to the Stage in the middle of the conversation', () => {
    const { t } = setup();
    t.open();
    const r = t.talk('turn off quiet hours');
    expect(r.line).toBeNull();
    expect(r.act).toBe('set_quiet_hours');
  });

  it('remembers across sessions and picks up where it left off', () => {
    const a = setup();
    a.t.open(); a.t.talk('Cicentos'); a.t.talk('stop');
    const b = setup(JSON.parse(JSON.stringify(a.t.snapshot())));
    expect(b.t.person.about('basics.name')).toHaveLength(1);
    expect(b.t.open().say).not.toMatch(/I'm Tacit/);
  });
});

describe('coming back', () => {
  it('knows your name again after a restart, and greets the hour honestly', () => {
    const a = setup();
    a.t.open(); a.t.talk('Call me Cicentos');
    const b = setup(JSON.parse(JSON.stringify(a.t.snapshot())));
    expect(b.t.profile.name).toBe('Cicentos');
    expect(b.t.open({ hour: 2 }).say).toMatch(/^Still up, Cicentos\?/);
  });
});

describe('the settings screen and the conversation agree', () => {
  it('lets the person correct their profile, and says what the conversation expects', () => {
    const { t } = setup();
    t.open();
    expect(t.waiting()).toBe('talk');
    t.updateProfile({ name: 'Cisse', interests: ['markets', ' AI ', ''] });
    expect(t.profile.name).toBe('Cisse');
    expect(t.profile.interests).toEqual(['markets', 'AI']);
  });
});
