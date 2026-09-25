/**
 * Free text: the rest of the sentence once the trigger phrase and filler are
 * gone. Shared by every layer that has a free-text slot and no model — the
 * MCP bridge, composed acts, prototypes.
 */
import type { Candidate } from '@intermenu/aiuic-core';

const FILLER = new Set(['a', 'an', 'the', 'to', 'my', 'please', 'can', 'you', 'could', 'for', 'me', 'on', 'in', 'into', 'list', 'and', 'i', 'want', 'need', 'would', 'like']);

/**
 * The rest of the sentence, once the trigger phrase and filler are gone.
 * Uncalibrated by construction: it is a guess about where the free text is.
 *
 * Words that belong to a sibling slot are trimmed off the end only when they
 * sit in a prepositional tail — "buy milk to the home list" gives "buy milk",
 * because "to the home list" is where the list was named. "call home" keeps
 * "home", because nothing introduces it as somewhere else.
 */
export const PREP = new Set(['to', 'on', 'in', 'into', 'for', 'at', 'under', 'onto']);
const ARTICLE = new Set(['the', 'my', 'a', 'an', 'our']);

export function remainder(phrases: string[], siblingWords: () => Set<string> = () => new Set()) {
  const drop = new Set(phrases.flatMap((p) => p.toLowerCase().split(/\s+/)));
  return (text: string): Candidate[] => {
    const words = text.trim().split(/\s+/);
    const lower = words.map((w) => w.toLowerCase());
    const sib = siblingWords();
    let i = 0;
    while (i < words.length && (drop.has(lower[i]!) || FILLER.has(lower[i]!))) i++;
    let j = words.length;
    for (;;) {
      if (j <= i) break;
      const w = lower[j - 1]!;
      if (FILLER.has(w) || drop.has(w)) { j--; continue; }
      if (sib.has(w)) {
        let k = j - 2;
        while (k >= i && ARTICLE.has(lower[k]!)) k--;
        if (k >= i && PREP.has(lower[k]!)) { j = k; continue; }
      }
      break;
    }
    const value = words.slice(i, j).join(' ');
    if (!value) return [];
    return [{ value, label: value, score: 0.6, calibrated: false }];
  };
}

