/**
 * Is this sentence asking for something?
 *
 * A chore or a name in a sentence is not a request: "I love doing the dishes",
 * "did Sam take the bins out", "twenty dollars is a lot". Each of those scored
 * exactly at the routing threshold and opened a card nobody asked for. This is
 * the tier-0 answer: sentence shape, in English and French. It only ever
 * lowers an act that no trigger phrase spoke for, so a sentence that names the
 * act ("can you pay Maya back") is never held back by it.
 */

import { normalize } from './text.js';

export type Mood = 'request' | 'question' | 'statement';

/** Questions that are really requests. */
const POLITE = /^(please|can you|could you|would you|will you|can we|could we|let s|lets|peux tu|pourrais tu|tu peux|pouvez vous|est ce que tu peux|est ce que vous pouvez)\b/;
/** Wanting something is asking for it. */
const WANT = /^(i want|i need|i d like|id like|i would like|we need|we want|je veux|je voudrais|j ai besoin|jai besoin|il faut)\b/;
const QUESTION = /^(did|does|is|are|was|were|has|have|had|what|when|where|who|whom|whose|why|how|which|do (you|we|they|i)|est ce|qui|quand|ou est|pourquoi|comment|combien|quel|quelle|quels|quelles)\b/;
const STATEMENT_START = /^(i|we|it|that|this|there|he|she|they|je|j|on|c|ca|il|elle|nous)\b/;
const COPULA = /\b(is|are|was|were|s|est|sont|etait)\b/;

export function mood(text: string): Mood {
  const t = normalize(text.replace(/[\u2019'-]/g, ' '));
  if (!t) return 'statement';
  if (POLITE.test(t) || WANT.test(t)) return 'request';
  if (text.trim().endsWith('?') || QUESTION.test(t)) return 'question';
  if (STATEMENT_START.test(t)) return 'statement';
  // "twenty dollars is a lot", "Maya is at school": a sentence built on "is" describes.
  if (COPULA.test(t)) return 'statement';
  return 'request';
}
