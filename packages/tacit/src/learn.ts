/**
 * From what was said to what Tacit does differently.
 *
 * Harmless things apply at once: the name it uses, what the briefing leads
 * with, where "around you" is. Anything that changes behaviour — when the
 * briefing is ready, who may wake you — comes back as an offer, and waits
 * for the person to accept it.
 */
import { normalize } from '@intermenu/aiuic-resolve';
import type { Fact } from '@intermenu/knowing';
import type { Settings, SettingValue } from '@intermenu/aiuic-settings';

export type Offer =
  | { kind: 'setting'; key: string; value: SettingValue; say: string }
  | { kind: 'people'; value: string[]; say: string };

type Profile = { name?: string; interests: string[]; place?: string; people?: string[] };

export const personKey = (name: string) => `person:${normalize(name).replace(/\s+/g, '-')}`;

const list = (s: string) => s.split(/\s*(?:,|;|\band\b|\bthen\b|\balso\b|\bplus\b|\bor\b)\s*/i)
  .map((x) => x.replace(/^(i follow|i watch|mostly|mainly|probably|maybe|like|the|my|definitely|honestly)\s+/i, '').replace(/[.!?]+$/, '').trim())
  .filter((x) => x.length > 1 && x.split(' ').length <= 4);

function hourIn(s: string): number | null {
  const t = normalize(s);
  const m = t.match(/\b(\d{1,2})(?:[: ]\d{2})?\b/);
  if (m) return Number(m[1]);
  const w = ['five', 'six', 'seven', 'eight', 'nine', 'ten'].findIndex((x) => new RegExp(`\\b${x}\\b`).test(t));
  return w >= 0 ? w + 5 : null;
}

export function learnFrom(facts: Fact[], profile: Profile, settings: Settings): { profile: Profile; offers: Offer[] } {
  let p = { ...profile };
  const offers: Offer[] = [];
  for (const f of facts) {
    if (f.kind !== 'stated') continue;
    switch (f.thread) {
      case 'basics.name': {
        const name = f.text.replace(/^Goes by /, '').split(/\s*(?:,|\bor\b)\s*/)[0]!.trim();
        if (name) p = { ...p, name };
        break;
      }
      case 'basics.home':
        if (f.depth === 1) p = { ...p, place: f.quote.replace(/^(i['’ ]?m in|i live in|in|near)\s+/i, '').split(/[,.]/)[0]!.trim() };
        break;
      case 'interests.follow': case 'interests.markets': case 'interests.tech': case 'interests.sports': {
        if (f.depth !== 1) break;
        const got = list(f.quote);
        if (got.length) p = { ...p, interests: [...new Set([...got, ...p.interests])].slice(0, 7) };
        break;
      }
      case 'rhythm.wake': {
        const h = hourIn(f.quote);
        if (h === null || f.depth !== 1) break;
        // The briefing is ready an hour after waking, within what it offers.
        const at = Math.min(8, Math.max(6, h + 1));
        const value = `0${at}:00`;
        if (settings.get('briefing_time') !== value) offers.push({ kind: 'setting', key: 'briefing_time', value, say: `Have your briefing ready at ${at}:00?` });
        break;
      }
      case 'people.reach': {
        if (f.depth !== 1) break;
        const names = /\b(nobody|no one|none)\b/i.test(f.quote) ? [] : list(f.quote).filter((x) => /^[A-ZÀ-ſ]/.test(x) || /\b(mom|dad|mother|father|brother|sister|wife|husband|partner)\b/i.test(x));
        offers.push({ kind: 'people', value: names, say: names.length ? `Let ${names.join(' and ')} through at night?` : 'Let nobody through at night?' });
        break;
      }
      case 'talk.length': {
        const t = normalize(f.quote);
        const v = /\b(short|headline|quick|tldr|brief)\b/.test(t) ? 5 : /\b(whole|long|detail|everything|full)\b/.test(t) ? 20 : null;
        if (v !== null && settings.get('briefing_length') !== v) offers.push({ kind: 'setting', key: 'briefing_length', value: v, say: v === 5 ? 'Keep your briefing short, about 5 minutes?' : 'Make your briefing the long one, about 20 minutes?' });
        break;
      }
    }
  }
  return { profile: p, offers };
}
