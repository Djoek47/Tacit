/**
 * A seed suite. Forty sentences a household actually says, labelled with what
 * they mean.
 *
 * It is not enough to tune on — a few hundred from real users is — but it is
 * enough to catch a regression and to show what the numbers look like. The
 * hard cases are deliberate: names that sound alike, chores named by alias,
 * amounts in words, and sentences that should route nowhere at all.
 */

import type { Case } from '../src/index.js';

export const DRAKO = { id: 'drako', label: 'Drako' };
export const DRACO = { id: 'draco', label: 'Draco' };
export const MAYA = { id: 'maya', label: 'Maya' };
export const SAM = { id: 'sam', label: 'Sam' };

export const PEOPLE = [
  { value: DRAKO, label: 'Drako' },
  { value: DRACO, label: 'Draco' },
  { value: MAYA, label: 'Maya' },
  { value: SAM, label: 'Sam' },
];

export const CHORES = [
  // A bilingual household's catalog: the French names are aliases, as the app would declare them.
  { value: 'dishes', label: 'dishes', aliases: ['washing up', 'vaisselle'] },
  { value: 'trash', label: 'trash', aliases: ['bins', 'garbage', 'poubelles'] },
  { value: 'laundry', label: 'laundry', aliases: ['washing', 'lessive'] },
  { value: 'vacuum', label: 'vacuum', aliases: ['hoover', 'aspirateur'] },
];

export const household: Case[] = [
  // plain, both slots present
  { text: 'dishes for Maya', act: 'assign_chore', slots: { assignee: MAYA, chore: 'dishes' } },
  { text: 'trash for Sam', act: 'assign_chore', slots: { assignee: SAM, chore: 'trash' } },
  { text: 'laundry for Maya tomorrow', act: 'assign_chore', slots: { assignee: MAYA, chore: 'laundry', due: { label: 'tomorrow' } } },
  { text: 'vacuum for Sam on Friday', act: 'assign_chore', slots: { assignee: SAM, chore: 'vacuum', due: { label: 'Friday' } } },
  { text: 'assign the dishes to Sam', act: 'assign_chore', slots: { assignee: SAM, chore: 'dishes' } },

  // aliases
  { text: 'bins for Maya', act: 'assign_chore', slots: { assignee: MAYA, chore: 'trash' }, note: 'alias' },
  { text: 'Sam can do the washing up', act: 'assign_chore', slots: { assignee: SAM, chore: 'dishes' }, note: 'alias' },
  { text: 'garbage for Sam tonight', act: 'assign_chore', slots: { assignee: SAM, chore: 'trash', due: { label: 'tonight' } }, note: 'alias' },
  { text: 'hoover for Maya', act: 'assign_chore', slots: { assignee: MAYA, chore: 'vacuum' }, note: 'alias' },

  // the hard ones: two names one edit apart
  { text: 'dishes for Drako', act: 'assign_chore', slots: { assignee: DRAKO, chore: 'dishes' }, note: 'near-twin name' },
  { text: 'dishes for Draco', act: 'assign_chore', slots: { assignee: DRACO, chore: 'dishes' }, note: 'near-twin name' },
  { text: 'trash for Drako tomorrow', act: 'assign_chore', slots: { assignee: DRAKO, chore: 'trash', due: { label: 'tomorrow' } }, note: 'near-twin name' },

  // transcription noise
  { text: 'dishes for Dracko', act: 'assign_chore', slots: { chore: 'dishes' }, unsure: ['assignee'], note: 'misheard name — should not confirm either twin' },
  { text: 'dishes for Maia', act: 'assign_chore', slots: { chore: 'dishes' }, unsure: ['assignee'], note: 'misheard name' },

  // only one slot named
  { text: 'Maya', act: null, note: 'a bare name is not an act' },
  { text: 'do the laundry', act: 'assign_chore', slots: { chore: 'laundry' }, note: 'no assignee' },
  { text: 'Sam should help out', act: 'assign_chore', slots: { assignee: SAM }, note: 'no chore' },

  // money, digits and words
  { text: 'pay Maya twelve dollars', act: 'settle_up', slots: { payee: MAYA, amount: { n: 12 } } },
  { text: 'pay Sam back 20', act: 'settle_up', slots: { payee: SAM, amount: { n: 20 } } },
  { text: 'send Maya $19.99', act: 'settle_up', slots: { payee: MAYA, amount: { n: 19.99 } } },
  { text: 'pay back Sam forty', act: 'settle_up', slots: { payee: SAM, amount: { n: 40 } } },
  { text: 'pay Maya twenty five dollars', act: 'settle_up', slots: { payee: MAYA, amount: { n: 25 } } },
  { text: 'settle up with Sam for thirty', act: 'settle_up', slots: { payee: SAM, amount: { n: 30 } } },

  // should route nowhere
  { text: 'what is the weather', act: null },
  { text: 'play something', act: null },
  { text: 'how long until dinner', act: null },
  { text: 'thanks', act: null },
  { text: 'never mind', act: null },
];
