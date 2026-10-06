import { describe, expect, it } from 'vitest';
import { Interview, QUESTIONS, createTacit } from '../src/index.js';

const NIGHT = Date.UTC(2026, 9, 6, 23);
const hourOf = (t: number) => new Date(t).getUTCHours();

function run(answers: string[]) {
  const iv = new Interview();
  let last = iv.step();
  for (const a of answers) last = iv.answer(a);
  return last;
}

describe('the first conversation', () => {
  it('asks seven things, each one read by something downstream', () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(['name', 'interests', 'place', 'briefing_time', 'briefing_length', 'people', 'quiet_hours']);
  });

  it('hears ordinary answers and says them back before anything applies', () => {
    const s = run(['Call me Cicentos', 'markets, AI and the Canadiens', "I'm in Montréal", 'seven', 'short', 'Sylla and Vincent', 'yes']);
    expect(s.kind).toBe('confirm');
    if (s.kind !== 'confirm') return;
    expect(s.learned).toEqual({ name: 'Cicentos', interests: ['markets', 'AI', 'Canadiens'], place: 'Montréal',
      briefing_time: '07:00', briefing_length: 5, people: ['Sylla', 'Vincent'], quiet_hours: true });
    expect(s.summary.join(' ')).toMatch(/Sylla and Vincent can always reach you/);
  });

  it('lets every question be skipped, and keeps the default', () => {
    const s = run(QUESTIONS.map(() => "I'd rather not"));
    expect(s.kind).toBe('confirm');
    if (s.kind === 'confirm') { expect(s.learned).toEqual({}); expect(s.summary[0]).toMatch(/defaults stay/); }
  });

  it('asks again, kindly, when it did not catch the answer', () => {
    const iv = new Interview();
    iv.answer('Cicentos'); iv.answer('markets'); iv.answer('Montreal');
    const s = iv.answer('whenever');
    expect(s).toMatchObject({ kind: 'ask', index: 3, hint: expect.stringMatching(/did not catch/) });
  });

  it('goes back, and stops when asked', () => {
    const iv = new Interview();
    iv.answer('Cicentos');
    expect(iv.answer('go back')).toMatchObject({ kind: 'ask', index: 0 });
    expect(iv.answer('stop')).toEqual({ kind: 'stopped' });
  });

  it('applies nothing until the confirmed result is handed over, then the desk and the briefing follow it', () => {
    const t = createTacit({ profile: { interests: ['news'] }, now: () => NIGHT, hourOf });
    const s = run(['Cicentos', 'markets', 'Montreal', 'eight', 'long', 'Sylla', 'yes']);
    expect(t.settings.get('briefing_time')).toBe('07:00');
    expect(t.receive({ id: 'a', from: 'person:stranger', title: 'hi', topics: [], urgency: 0.9, at: NIGHT }).delivery).toBe('now');
    if (s.kind !== 'confirm') throw new Error('expected a confirmation');
    t.learn(s.learned);
    expect(t.settings.get('briefing_time')).toBe('08:00');
    expect(t.settings.get('briefing_length')).toBe(20);
    expect(t.profile.interests).toEqual(['markets']);
    // Now only the named person breaks through at night.
    expect(t.receive({ id: 'b', from: 'person:stranger', title: 'hi', topics: [], urgency: 0.9, at: NIGHT }).delivery).toBe('bundle');
    expect(t.receive({ id: 'c', from: 'person:sylla', title: 'hi', topics: [], urgency: 0.9, at: NIGHT }).delivery).toBe('now');
    expect(t.settings.changes().every((c) => c.by === 'voice')).toBe(true);
  });
});
