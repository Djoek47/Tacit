import { describe, expect, it } from 'vitest';
import { classify, type Ctx } from '@intermenu/aiuic-core';
import { resolveDuration, resolveQuantity, resolveWhen, wordsToNumber } from '../src/grammar.js';

// A Wednesday, 2pm.
const NOW = new Date('2026-09-23T14:00:00');
const ctx = { now: NOW } as Ctx;

const q = (t: string) => resolveQuantity(t)[0]?.value as { n: number; label: string; unit?: string } | undefined;
const w = (t: string) => resolveWhen(t, ctx)[0]?.value as { at: number; label: string; granularity: string } | undefined;
const d = (t: string) => resolveDuration(t)[0]?.value as { ms: number; label: string } | undefined;
const day = (v?: { at: number }) => (v ? new Date(v.at).toDateString() : '');

describe('numbers', () => {
  it('reads number words', () => {
    expect(wordsToNumber(['twenty', 'five'])).toBe(25);
    expect(wordsToNumber(['twelve'])).toBe(12);
    expect(wordsToNumber(['ninety', 'nine'])).toBe(99);
    expect(wordsToNumber(['banana'])).toBeNull();
  });

  it('reads the utterance the spec has been failing on since day one', () => {
    expect(q('twelve dollars')).toEqual({ n: 12, label: '$12', unit: 'USD' });
  });

  it('takes digits, decimals and symbols', () => {
    expect(q('pay 20')?.n).toBe(20);
    expect(q('$19.99')).toEqual({ n: 19.99, label: '$19.99', unit: 'USD' });
    expect(q('£5')).toEqual({ n: 5, label: '£5', unit: 'GBP' });
    expect(q('€40')?.unit).toBe('EUR');
  });

  it('keeps the currency the speaker used', () => {
    expect(q('forty euros')).toEqual({ n: 40, label: '€40', unit: 'EUR' });
    expect(q('thirty quid')?.unit).toBe('GBP');
  });

  it('leaves a plain count unitless', () => {
    expect(q('three travellers')).toEqual({ n: 3, label: '3' });
  });

  it('finds nothing where there is nothing', () => {
    expect(resolveQuantity('move the parcel')).toEqual([]);
  });
});

describe('dates and times', () => {
  it('handles today, tomorrow and tonight', () => {
    expect(w('tomorrow')?.label).toBe('tomorrow');
    expect(day(w('tomorrow'))).toBe('Thu Sep 24 2026');
    expect(w('tonight')?.granularity).toBe('minute');
    expect(new Date(w('tonight')!.at).getHours()).toBe(20);
  });

  it('resolves a weekday to the one coming, never the one gone', () => {
    expect(day(w('friday'))).toBe('Fri Sep 25 2026');
    // Wednesday said on a Wednesday means next week, not this morning.
    expect(day(w('wednesday'))).toBe('Wed Sep 30 2026');
  });

  it('shows the word that was said, not a timestamp', () => {
    expect(w('dishes for Drako friday')?.label).toBe('Friday');
    expect(w('next monday')?.label).toBe('next Monday');
  });

  it('counts forward in days and weeks', () => {
    expect(day(w('in 3 days'))).toBe('Sat Sep 26 2026');
    expect(day(w('in two weeks'))).toBe('Wed Oct 07 2026');
  });

  it('takes a month and a day, rolling to next year when it has passed', () => {
    expect(day(w('march 4'))).toBe('Thu Mar 04 2027');
    expect(day(w('december 1'))).toBe('Tue Dec 01 2026');
  });

  it('takes ISO dates', () => {
    expect(day(w('2026-11-05'))).toBe('Thu Nov 05 2026');
  });

  it('reads a clock time, colon and all', () => {
    expect(new Date(w('at 9pm')!.at).getHours()).toBe(21);
    expect(new Date(w('9:30am')!.at).getHours()).toBe(9);
    expect(new Date(w('9:30am')!.at).getMinutes()).toBe(30);
    expect(w('9:30am')?.label).toBe('9:30am');
  });

  it('refuses to guess a bare hour, and narrows instead', () => {
    const all = resolveWhen('move the post to nine', ctx);
    expect(all.map((c) => c.label).sort()).toEqual(['9am', '9pm']);
    // Equal scores, so classify() lands the slot in NARROW rather than filling it.
    expect(all[0]!.score).toBe(all[1]!.score);
    // The engine's own classifier agrees: this is a narrowed slot, not a fill.
    expect(classify(all).outcome).toBe('narrowed');
  });

  it('narrows a bare digit hour the same way', () => {
    expect(resolveWhen('at 7', ctx).map((c) => c.label).sort()).toEqual(['7am', '7pm']);
  });

  it('offers every reading it found, best first', () => {
    const all = resolveWhen('friday or saturday', ctx);
    expect(all.map((c) => c.label)).toEqual(['Friday', 'Saturday']);
  });

  it('finds nothing where there is nothing', () => {
    expect(resolveWhen('pay Sam back', ctx)).toEqual([]);
  });
});

describe('durations', () => {
  it('reads words and digits', () => {
    expect(d('twenty minutes')).toEqual({ ms: 1_200_000, label: '20 minutes' });
    expect(d('for 2 hours')?.ms).toBe(7_200_000);
    expect(d('half an hour')?.ms).toBe(1_800_000);
  });
  it('finds nothing where there is nothing', () => {
    expect(resolveDuration('go to the shop')).toEqual([]);
  });
});

describe('everything here is calibrated', () => {
  it('a grammar match is right by construction, so it may confirm a slot', () => {
    for (const c of [...resolveQuantity('twelve dollars'), ...resolveWhen('friday', ctx), ...resolveDuration('20 minutes')]) {
      expect(c.calibrated).toBe(true);
      expect(c.score).toBe(1);
    }
  });
});
