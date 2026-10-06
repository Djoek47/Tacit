/**
 * Short rounds that keep a long conversation light. Built for people whose
 * attention moves fast: three quick choices, a change of pace, back to talking.
 */
import { normalize } from '@intermenu/aiuic-resolve';

/** A choice, and the thread its answer belongs to. */
export type Pair = { a: string; b: string; thread: string };

export const PAIRS: Pair[] = [
  { a: 'coffee', b: 'tea', thread: 'rhythm.energy' },
  { a: 'sunrise', b: 'midnight', thread: 'rhythm.wake' },
  { a: 'mountains', b: 'beach', thread: 'tastes.places' },
  { a: 'call', b: 'text', thread: 'talk.length' },
  { a: 'plan everything', b: 'figure it out on the way', thread: 'decisions.style' },
  { a: 'big party', b: 'dinner for four', thread: 'people.social' },
  { a: 'book', b: 'podcast', thread: 'knowledge.sources' },
  { a: 'headline', b: 'whole story', thread: 'talk.length' },
  { a: 'safe bet', b: 'long shot', thread: 'decisions.risk' },
  { a: 'cook at home', b: 'go out', thread: 'tastes.food' },
  { a: 'city', b: 'nature', thread: 'tastes.places' },
  { a: 'history', b: 'science fiction', thread: 'knowledge.history' },
  { a: 'gut', b: 'data', thread: 'decisions.style' },
  { a: 'gift you can hold', b: 'an experience', thread: 'tastes.gifts_you_like' },
  { a: 'markets', b: 'sports', thread: 'interests.follow' },
  { a: 'jokes', b: 'straight talk', thread: 'talk.humour' },
];

/** Reads which side of a pair was picked; `null` when it is unclear. */
export function picked(p: Pair, text: string): 'a' | 'b' | 'both' | null {
  const t = ` ${normalize(text)} `;
  const has = (s: string) => t.includes(` ${normalize(s)} `) || t.includes(` ${normalize(s).split(' ')[0]} `);
  if (/\b(both|either|depends)\b/.test(t)) return 'both';
  const A = has(p.a), B = has(p.b);
  if (A && !B) return 'a';
  if (B && !A) return 'b';
  if (/\b(first|former|the first one)\b/.test(t)) return 'a';
  if (/\b(second|latter|the second one|last one)\b/.test(t)) return 'b';
  return null;
}

/**
 * Ten statements from the Mini-IPIP (Donnellan et al., 2006), drawn from the
 * public-domain International Personality Item Pool. Self-report only; the
 * result is shown to the person and kept only if they agree with it.
 */
export type Trait = 'outgoing' | 'warm' | 'organised' | 'calm' | 'curious';
export const ITEMS: { text: string; trait: Trait; reverse: boolean }[] = [
  { text: 'I am the life of the party.', trait: 'outgoing', reverse: false },
  { text: 'I sympathise with other people’s feelings.', trait: 'warm', reverse: false },
  { text: 'I get chores done right away.', trait: 'organised', reverse: false },
  { text: 'I am relaxed most of the time.', trait: 'calm', reverse: false },
  { text: 'I have a vivid imagination.', trait: 'curious', reverse: false },
  { text: 'I don’t talk a lot.', trait: 'outgoing', reverse: true },
  { text: 'I am not really interested in other people’s problems.', trait: 'warm', reverse: true },
  { text: 'I often forget to put things back in their place.', trait: 'organised', reverse: true },
  { text: 'My mood swings a lot.', trait: 'calm', reverse: true },
  { text: 'Abstract ideas do not interest me much.', trait: 'curious', reverse: true },
];

/** 1..5 from ordinary words; `null` when it is unclear. */
export function agreement(text: string): number | null {
  const t = normalize(text.replace(/[\u2019']/g, ' '));
  if (/\b(strongly disagree|totally disagree|not at all|absolutely not|never)\b/.test(t)) return 1;
  if (/\b(strongly agree|totally|absolutely|definitely|completely|so me|that s so me|100)\b/.test(t)) return 5;
  if (/\b(sometimes|kind of|kinda|sort of|depends|in between|half|meh|neutral|so so)\b/.test(t)) return 3;
  if (/\b(disagree|not really|nah|not me|rarely)\b|^no\b/.test(t)) return 2;
  if (/\b(agree|yes|yeah|true|mostly|usually|pretty much|that s me)\b/.test(t)) return 4;
  return null;
}

export const TRAIT_WORDS: Record<Trait, [string, string]> = {
  outgoing: ['you recharge on your own', 'you get energy from people'],
  warm: ['you keep a cool distance', 'you feel what others feel'],
  organised: ['you go with the flow', 'you like things done and in order'],
  calm: ['things get to you', 'you stay steady under pressure'],
  curious: ['you like the concrete', 'your mind wanders into ideas'],
};

export function traits(answers: number[]): Record<Trait, number> {
  const sum: Record<string, number[]> = {};
  ITEMS.forEach((it, i) => {
    const v = answers[i];
    if (v === undefined) return;
    (sum[it.trait] ??= []).push(it.reverse ? 6 - v : v);
  });
  const out = {} as Record<Trait, number>;
  for (const k of Object.keys(TRAIT_WORDS) as Trait[]) {
    const xs = sum[k] ?? [];
    out[k] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 3;
  }
  return out;
}

/** In words, never as a score: "you get energy from people". Middle scores say nothing. */
export function describe(t: Record<Trait, number>): string[] {
  return (Object.keys(t) as Trait[]).filter((k) => Math.abs(t[k] - 3) >= 1).map((k) => TRAIT_WORDS[k][t[k] > 3 ? 1 : 0]);
}
