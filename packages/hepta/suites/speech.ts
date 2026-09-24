/**
 * Sentences as people actually start them.
 *
 * The point of this suite is not that Hepta gets the act right — the eval
 * suite already measures routing on finished text. It is that Hepta gets there
 * EARLY, without the stage flickering on the way, and without ever committing
 * while the speaker is still going.
 *
 * So the useful cases are the ones where the first few words are genuinely
 * ambiguous and the sentence only resolves late. A suite of sentences whose
 * first word names the act would report a wonderful number and tell us nothing.
 */

import type { ReplayCase } from '../src/replay.js';

export const speech: ReplayCase[] = [
  // Resolves early: the verb names the domain in word one.
  { text: 'add milk and jam to the list', act: 'add_items', note: 'verb-first, should lead immediately' },
  { text: 'pay Sam twelve dollars', act: 'settle_up', note: 'verb-first' },

  // Resolves late: everything before the last word fits two acts.
  { text: 'Maya needs to do the laundry', act: 'assign_chore',
    note: 'a name first — fits the chore act and the payment act equally' },
  { text: 'Sam should get twenty dollars', act: 'settle_up',
    note: 'a name first, and the money only arrives at the end' },

  // The recognizer is wrong for the first half of the sentence.
  { text: 'the dishes for Maya tomorrow', act: 'assign_chore',
    revisions: [{ from: 'my a', to: 'Maya', after: 4 }],
    note: 'recognizer hears "my a" and corrects to "Maya"' },
  { text: 'add bread and eggs', act: 'add_items',
    revisions: [{ from: 'red', to: 'bread', after: 2 }],
    note: 'a revised noun in the middle' },

  // A false start. The speaker changes their mind mid-sentence, which is the
  // case that punishes a speculator with no switch margin.
  { text: 'pay Maya no actually give Maya the laundry', act: 'assign_chore',
    note: 'changes act mid-sentence — expect one switch, not four' },

  // Should route nowhere and stay nowhere.
  { text: 'what is the weather like', act: null, note: 'not an act' },
];
