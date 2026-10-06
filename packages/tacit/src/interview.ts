/**
 * The first conversation: Tacit learns who it is working for.
 *
 * Seven questions, about two minutes, all by voice. Each one exists because
 * something downstream reads the answer — the briefing reads interests and
 * place, the desk reads who may reach you at night, the settings read the
 * time and the length. Nothing is asked that nothing uses.
 *
 * Three promises:
 *   - Every question can be skipped ("skip", "pass", "I'd rather not"), and a
 *     skipped answer keeps its default. Nobody is stuck in an interview.
 *   - Nothing is applied while it is being asked. At the end Tacit says back
 *     what it heard, and only a yes applies it. Several settings at once is
 *     not a cheap act, so silence does not commit it.
 *   - What it learns stays with the person: the profile and the settings.
 *     The shared world context has no door that accepts any of it.
 */
import { normalize } from '@intermenu/aiuic-resolve';

export type Learned = {
  name?: string;
  interests?: string[];
  place?: string;
  briefing_time?: string;
  briefing_length?: number;
  people?: string[];
  quiet_hours?: boolean;
};

type Q = { id: keyof Learned; ask: string; hint: string; read: (words: string) => Learned[keyof Learned] | undefined };

const list = (s: string) => s.split(/\s*(?:,|;|\band\b|\bthen\b|\balso\b|\bplus\b)\s*/i)
  .map((x) => x.replace(/^(i follow|mostly|mainly|probably|maybe|like|the)\s+/i, '').trim()).filter((x) => x.length > 1);

const NUM: Record<string, number> = { five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function readTime(s: string): string | undefined {
  const t = normalize(s);
  if (/\b(off|never|no briefing|none|don t)\b/.test(t)) return 'off';
  const m = t.match(/\b(\d{1,2})(?:[: ](\d{2}))?\b/) ?? null;
  const h = m ? Number(m[1]) : Object.entries(NUM).find(([w]) => new RegExp(`\\b${w}\\b`).test(t))?.[1];
  if (h === undefined) return undefined;
  // Only the times the briefing offers; anything else goes to the nearest.
  const near = [6, 7, 8].reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a));
  return `0${near}:00`;
}
function readLength(s: string): number | undefined {
  const t = normalize(s);
  if (/\b(short|quick|five|5)\b/.test(t)) return 5;
  if (/\b(long|full|twenty|20|everything)\b/.test(t)) return 20;
  if (/\b(standard|normal|medium|fifteen|15|usual)\b/.test(t)) return 15;
  return undefined;
}
function readYes(s: string): boolean | undefined {
  const t = normalize(s);
  if (/^(yes|yeah|yep|sure|keep|ok|okay|that s fine|fine|sounds good)\b/.test(t)) return true;
  if (/^(no|nope|nah|turn it off|off|don t)\b/.test(t)) return false;
  return undefined;
}

export const QUESTIONS: Q[] = [
  { id: 'name', ask: 'What should I call you?', hint: 'A first name is enough.',
    read: (s) => s.replace(/^(call me|it['’ ]?s|i['’ ]?m|i am|my name is|name['’ ]?s)\s+/i, '').replace(/[.!]$/, '').trim().split(/\s+/).slice(0, 3).join(' ') || undefined },
  { id: 'interests', ask: 'What do you follow closely? Say a few, most important first.', hint: 'For example: markets, AI, the Canadiens.',
    read: (s) => { const l = list(s); return l.length ? l.slice(0, 7) : undefined; } },
  { id: 'place', ask: 'Where are you, roughly? A city is enough.', hint: 'It decides what “around you” means in your briefing.',
    read: (s) => s.replace(/^(i['’ ]?m in|i am in|i live in|in|near)\s+/i, '').replace(/[.!]$/, '').trim() || undefined },
  { id: 'briefing_time', ask: 'When should your morning briefing be ready?', hint: '6, 7 or 8 — or off. It waits for you; it never starts talking by itself.', read: readTime },
  { id: 'briefing_length', ask: 'Short, standard or long? About 5, 15 or 20 minutes.', hint: 'You can change it any morning by saying so.', read: readLength },
  { id: 'people', ask: 'Who may always reach you, even at night?', hint: 'Names. Say “nobody” if no one.',
    read: (s) => (/\b(nobody|no one|none|noone)\b/i.test(s) ? [] : list(s).map((x) => x.replace(/^(my)\s+/i, '')).slice(0, 10)) },
  { id: 'quiet_hours', ask: 'From 10 at night to 7 in the morning, only those people get through. Keep that?', hint: 'Yes or no.', read: readYes },
];

const SKIP = /^(skip|pass|next|i d rather not|rather not|no comment|later|not now|i don t know|dunno)\b/;
const BACK = /^(go back|back|previous|undo that)\b/;

export type Step =
  | { kind: 'ask'; index: number; of: number; ask: string; hint: string; heard?: string }
  | { kind: 'confirm'; summary: string[]; learned: Learned }
  | { kind: 'done'; learned: Learned }
  | { kind: 'stopped' };

export class Interview {
  private i = 0;
  private learned: Learned = {};
  private state: 'asking' | 'confirming' | 'done' | 'stopped' = 'asking';

  step(heard?: string): Step {
    if (this.state === 'done') return { kind: 'done', learned: this.learned };
    if (this.state === 'stopped') return { kind: 'stopped' };
    if (this.state === 'confirming') return { kind: 'confirm', summary: summarize(this.learned), learned: this.learned };
    const q = QUESTIONS[this.i]!;
    return { kind: 'ask', index: this.i, of: QUESTIONS.length, ask: q.ask, hint: q.hint, ...(heard ? { heard } : {}) };
  }

  /** One thing the person said. Returns what Tacit says or shows next. */
  answer(text: string): Step {
    const t = normalize(text.replace(/[’']/g, ' '));
    if (/^(stop|cancel|quit|enough|stop the interview)\b/.test(t)) { this.state = 'stopped'; return this.step(); }

    if (this.state === 'confirming') {
      const y = readYes(text);
      if (y === true) { this.state = 'done'; return this.step(); }
      if (y === false || BACK.test(t)) { this.state = 'asking'; this.i = QUESTIONS.length - 1; return this.step(); }
      return this.step();
    }
    if (this.state !== 'asking') return this.step();

    if (BACK.test(t)) { this.i = Math.max(0, this.i - 1); return this.step(); }
    const q = QUESTIONS[this.i]!;
    if (!SKIP.test(t)) {
      const v = q.read(text);
      if (v === undefined) return { ...(this.step() as Extract<Step, { kind: 'ask' }>), hint: `I did not catch that. ${q.hint}` };
      (this.learned as Record<string, unknown>)[q.id] = v;
    } else {
      delete (this.learned as Record<string, unknown>)[q.id];
    }
    this.i++;
    if (this.i >= QUESTIONS.length) this.state = 'confirming';
    return this.step(text);
  }
}

const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

export function summarize(l: Learned): string[] {
  const out: string[] = [];
  if (l.name) out.push(`I will call you ${l.name}.`);
  if (l.interests?.length) out.push(`You follow ${and(l.interests)}${l.interests.length > 1 ? ', in that order' : ''}.`);
  if (l.place) out.push(`You are around ${l.place}.`);
  if (l.briefing_time) out.push(l.briefing_time === 'off' ? 'No morning briefing.' : `Your briefing is ready at ${Number(l.briefing_time.slice(0, 2))}:00.`);
  if (l.briefing_length) out.push(`It runs about ${l.briefing_length} minutes.`);
  if (l.people) out.push(l.people.length ? `${and(l.people)} can always reach you.` : 'Nobody breaks through at night.');
  if (l.quiet_hours !== undefined) out.push(l.quiet_hours ? 'Quiet hours stay on.' : 'No quiet hours.');
  if (!out.length) out.push('You skipped everything, which is fine: the defaults stay, and you can change any of it by saying so.');
  return out;
}

/** People's names as the desk knows them: 'person:maya'. */
export const personKey = (name: string) => `person:${normalize(name).replace(/\s+/g, '-')}`;
