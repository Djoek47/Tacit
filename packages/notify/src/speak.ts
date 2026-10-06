/**
 * The briefing, as an act the conversation can route to — "brief me", "what
 * did I miss", "morning report" — and as words to read aloud.
 *
 * Asking for a briefing writes nothing, so it costs nothing: radius 'self',
 * and its undo has nothing to put back. That is what lets it happen on
 * silence the moment it is asked for, which is the whole experience: you say
 * "brief me" and it starts talking.
 */

import { defineAct, type ActDef } from '@intermenu/aiuic-core';
import { brief, type Briefing, type ContextMemory, type Desk, type Profile } from './index.js';

export const LENGTHS = [
  { value: 5, label: 'Short', aliases: ['quick', 'short', 'brief', 'five minutes'] },
  { value: 15, label: 'Standard', aliases: ['normal', 'standard', 'usual'] },
  { value: 20, label: 'Long', aliases: ['long', 'full', 'everything', 'twenty minutes'] },
];

/** A briefing written to be heard, not read: short sentences, the reason said aloud, sections announced. */
export function script(b: Briefing, name?: string): string {
  if (!b.sections.length) return `${name ? `${name}, n` : 'N'}othing needs you this morning, and nothing moved in what you follow.`;
  // The number said and the number the plural is chosen by must be the same
  // number: "About 1 minutes" came from rounding 0.4 for one and not the other.
  const m = Math.max(1, Math.round(b.minutes));
  const lines: string[] = [`${name ? `Good morning, ${name}. ` : ''}Here is your briefing. About ${m} minute${m === 1 ? '' : 's'}.`];
  for (const s of b.sections) {
    lines.push(`${s.name}.`);
    for (const it of s.items) lines.push(`${it.title}${/[.!?]$/.test(it.title) ? '' : '.'}`);
  }
  if (b.leftOut) lines.push(`I left out ${b.leftOut} more to keep it short. Ask for the long version to hear them.`);
  return lines.join(' ');
}

export type BriefingDeps = {
  desk: Desk;
  context: ContextMemory;
  profile: () => Profile & { name?: string };
  now?: () => number;
  /** Where the words go: a voice, a screen, both. */
  speak?: (text: string, b: Briefing) => void | Promise<void>;
};

export function briefingAct(d: BriefingDeps): ActDef {
  return defineAct({
    name: 'get_briefing',
    domain: 'briefing',
    phrases: ['brief me', 'briefing', 'what did i miss', 'morning report', 'catch me up', 'update me'],
    slots: {
      length: { primitive: 'chip', options: () => LENGTHS, default: () => 15, required: true, order: 1 },
    },
    radius: 'self',
    commit: async (f) => {
      const p = d.profile();
      const b = brief({ ...p, minutes: Number(f.length) || p.minutes || 15 }, d.desk, d.context, (d.now ?? Date.now)());
      const text = script(b, p.name);
      await d.speak?.(text, b);
      return { id: `briefing:${(d.now ?? Date.now)()}`, text, briefing: b };
    },
    // Nothing was written, so there is nothing to put back.
    undo: () => {},
  });
}
