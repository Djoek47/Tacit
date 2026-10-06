import { describe, expect, it } from 'vitest';
import { Conversation, DOMAINS, ITEMS, Person, THREADS, agreement, describe as words, traits } from '../src/index.js';

function talk(start = Date.UTC(2026, 9, 6, 14)) {
  let t = start;
  const person = new Person(() => t);
  const c = new Conversation({ person, now: () => t });
  const say = (s: string, minutes = 0.5) => { t += minutes * 60_000; return c.hear(s); };
  return { c, person, say, advance: (m: number) => { t += m * 60_000; } };
}
const LONG = 'well it is a long story honestly because my family moved twice when I was small and I kept changing schools';

describe('the map', () => {
  it('has a reason for every area and a use for every thread', () => {
    for (const d of DOMAINS) expect(d.why.length).toBeGreaterThan(10);
    for (const th of THREADS) { expect(th.uses.length).toBeGreaterThan(0); expect(th.open.length).toBeGreaterThan(0); }
    expect(new Set(THREADS.map((t) => t.id)).size).toBe(THREADS.length);
    expect(THREADS.length).toBeGreaterThanOrEqual(80);
  });

  it('asks before entering a private area, in every private area', () => {
    for (const d of DOMAINS.filter((x) => x.private)) expect(d.ask).toMatch(/\?/);
  });
});

describe('the conversation', () => {
  it('speaks first, introduces itself once, and starts with the name', () => {
    const { c } = talk();
    const l = c.open({ hour: 14 });
    expect(l.say).toMatch(/^Hi — I'm Tacit/);
    expect(l.thread).toBe('basics.name');
  });

  it('records what was said in the person’s own words', () => {
    const { c, person, say } = talk();
    c.open({ hour: 14 });
    say('Call me Cicentos');
    expect(person.about('basics.name')[0]).toMatchObject({ text: 'Goes by Cicentos', quote: 'Call me Cicentos', kind: 'stated' });
  });

  it('stays with a long answer: why, then the story', () => {
    const { c, say } = talk();
    c.open({ hour: 14 });
    say('Cicentos');
    const a = say(LONG);
    expect(a.move).toBe('deeper');
    expect(say(LONG).move).toBe('story');
  });

  it('moves on from short answers instead of digging', () => {
    const { c, say } = talk();
    c.open({ hour: 14 });
    say('Cicentos');
    const a = say('Montreal');
    expect(a.move).toBe('switch');
    expect(a.thread).not.toBe('basics.home');
  });

  it('picks up something mentioned in passing', () => {
    const { c, say } = talk();
    c.open({ hour: 14 });
    say('Cicentos');
    const a = say('Montreal, I moved for the hockey');
    expect(a.move).toBe('bridge');
    expect(a.thread).toBe('interests.sports');
    expect(a.say).toMatch(/You mentioned hockey/);
  });

  it('follows the person when they answer about something else', () => {
    const { c, person, say } = talk();
    c.open({ hour: 14 }); say('Cicentos');
    const l = say('honestly I mostly think about my startup and the next product launch these days');
    expect(person.about('basics.home')).toEqual([]);
    expect(person.all().filter((f) => f.domain === 'work')).toHaveLength(1);
    expect(l.thread).toMatch(/^work\./);
    expect(l.move).toBe('deeper');
  });

  it('does not jump topics on ordinary words', () => {
    const { c, say } = talk();
    c.open({ hour: 14 }); say('Cicentos');
    expect(say('Montreal right now').move).not.toBe('bridge');
  });

  it('lets a game go after one unclear answer', () => {
    const { c, say } = talk();
    c.open({ hour: 14 });
    let l = say('Cicentos');
    for (let i = 0; i < 10 && l.move !== 'game'; i++) l = say('fine');
    expect(say('hmm what').move).toBe('again');
    expect(say('I would rather keep talking about work').say).toMatch(/no games right now/);
    expect(c.waitingFor).toBe('talk');
  });

  it('never asks the same opener the same way twice', () => {
    const { c, say } = talk();
    const said = new Set<string>();
    said.add(c.open({ hour: 14 }).say);
    for (let i = 0; i < 40; i++) {
      const l = say('ok sure');
      if (l.move === 'game' || l.move === 'again') { say('coffee'); say('sunrise'); say('mountains'); continue; }
      expect(said.has(l.say)).toBe(false);
      said.add(l.say);
    }
  });

  it('skips without recording, and explains why it asks when asked', () => {
    const { c, person, say } = talk();
    c.open({ hour: 14 });
    expect(say('skip').move).toBe('switch');
    expect(person.all()).toEqual([]);
    const w = say('why do you want to know?');
    expect(w.move).toBe('why');
    expect(w.say).toMatch(/So /);
  });

  it('plays a quick round every so often, and records the picks', () => {
    const { c, person, say } = talk();
    c.open({ hour: 14 });
    let l = say('Cicentos');
    for (let i = 0; i < 10 && l.move !== 'game'; i++) l = say('fine');
    expect(l.move).toBe('game');
    expect(l.say).toMatch(/Coffee or tea\?/i);
    say('coffee, obviously');
    expect(person.about('rhythm.energy').some((f) => /Picks coffee/.test(f.text))).toBe(true);
  });

  it('offers a break at half an hour, and remembers where it stopped', () => {
    const { c, say } = talk();
    c.open({ hour: 14 });
    say('Cicentos');
    const l = say('Montreal', 31);
    expect(l.move).toBe('break');
    const p = say('let’s stop there');
    expect(p.move).toBe('park');
    const back = c.open({ hour: 20, name: 'Cicentos' });
    expect(back.say).toMatch(/^Evening, Cicentos\. Last time we were on/);
  });

  it('opens the morning with the briefing when one is ready', () => {
    const { c, say } = talk();
    c.open({ hour: 14 }); say('Cicentos');
    const m = c.open({ hour: 7, name: 'Cicentos', briefingReady: true });
    expect(m.say).toMatch(/Your briefing is ready/);
    expect(say('yes please').move).toBe('briefing');
  });

  it('asks before any private area, takes no for an answer, and never asks again', () => {
    const { c, person, say } = talk();
    c.open({ hour: 14 });
    // Answers whatever is asked: games and statements get a plain answer, traits a no.
    const reply = () => (c.waitingFor === 'pairs' ? 'the first' : c.waitingFor === 'items' ? 'agree' : c.waitingFor === 'traits' ? 'no' : 'ok fine');
    let consent: ReturnType<typeof say> | null = null;
    for (let i = 0; i < 120 && !consent; i++) { const l = say(reply()); if (l.move === 'consent') consent = l; }
    expect(consent?.say).toMatch(/health/i);
    say('no');
    expect(person.consentFor('health')).toBe('no');
    for (let i = 0; i < 80; i++) {
      const l = say(c.waitingFor === 'consent' ? 'no' : reply());
      expect(l.thread?.startsWith('health.')).not.toBe(true);
      expect(l.say).not.toMatch(/part about health/);
    }
  });

  it('keeps ambient curiosity within a daily budget, and quiet when busy', () => {
    const { c, person } = talk();
    person.record({ thread: 'basics.name', depth: 1, text: 'Goes by C', quote: 'C' });
    expect(c.ambient({ busy: true, day: 'd1' })).toBeNull();
    expect([1, 2, 3, 4].map(() => c.ambient({ busy: false, day: 'd1' }) !== null)).toEqual([true, true, true, false]);
    expect(c.ambient({ busy: false, day: 'd2' })).not.toBeNull();
  });
});

describe('the personality round', () => {
  it('reads ordinary agreement words', () => {
    expect(['strongly agree', 'yeah', 'kind of', 'not really', 'not at all'].map(agreement)).toEqual([5, 4, 3, 2, 1]);
  });

  it('describes in words, says nothing about the middle, and reverses reversed items', () => {
    const outgoing = ITEMS.map((it) => (it.trait === 'outgoing' ? (it.reverse ? 1 : 5) : 3));
    expect(words(traits(outgoing))).toEqual(['you get energy from people']);
  });

  it('keeps an inferred trait only after the person agrees', () => {
    const { c, person, say } = talk();
    c.open({ hour: 14 });
    let l = say('Cicentos');
    let games = 0;
    for (let i = 0; i < 80 && c.waitingFor !== 'items'; i++) {
      l = say('fine');
      if (l.move === 'game' && c.waitingFor === 'pairs') { games++; say('the first'); say('the first'); say('the first'); }
      if (l.move === 'consent') say('no');
    }
    expect(c.waitingFor).toBe('items');
    ITEMS.forEach((it) => say(it.trait === 'outgoing' ? (it.reverse ? 'not at all' : 'totally') : 'kind of'));
    expect(person.pending().map((f) => f.text)).toEqual(['You get energy from people']);
    expect(person.all().some((f) => f.thread === 'values.self_view')).toBe(false);
    say('yes, that’s me');
    expect(person.all().some((f) => f.text === 'You get energy from people' && f.confirmed)).toBe(true);
  });
});

describe('the person', () => {
  it('measures coverage honestly: depth over depth possible, without penalising a no', () => {
    const p = new Person(() => 1);
    expect(p.coverage().overall).toBe(0);
    const before = p.coverage().domains.length;
    p.setConsent('health', 'no');
    expect(p.coverage().domains.length).toBe(before);
    p.setConsent('faith', 'yes');
    expect(p.coverage().domains.length).toBe(before + 1);
    p.record({ thread: 'basics.name', depth: 3, text: 'x', quote: 'x' });
    const basics = p.coverage().domains.find((d) => d.id === 'basics')!;
    expect(basics.covered).toBeCloseTo(1 / basics.threads);
  });

  it('hands a model a compact card, filtered by purpose, and survives a round trip', () => {
    const p = new Person(() => 1);
    p.record({ thread: 'people.birthdays', depth: 1, text: 'Mom’s birthday is in March', quote: 'march for my mom' });
    p.record({ thread: 'tastes.food', depth: 1, text: 'Loves pho', quote: 'pho' });
    expect(p.card({ use: 'gifts' })).toMatch(/Dates that matter: Mom/);
    expect(p.card({ use: 'briefing' })).toBe('');
    const q = Person.restore(JSON.parse(JSON.stringify(p.snapshot())));
    expect(q.card()).toBe(p.card());
  });

  it('forgets an area entirely when the person says no to it', () => {
    const p = new Person(() => 1);
    p.setConsent('health', 'yes');
    p.record({ thread: 'health.movement', depth: 1, text: 'Runs', quote: 'I run' });
    p.setConsent('health', 'no');
    expect(p.all()).toEqual([]);
  });
});
