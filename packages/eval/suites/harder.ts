/**
 * The harder suite: how people actually talk, not how a test is written.
 *
 * French (the household is bilingual), words taken back mid-sentence, false
 * starts, amounts said as words, two people in one sentence, and sentences
 * that mention a chore or a name without asking for anything.
 *
 * The labels say what a careful person would do, not what the resolver does.
 * Where a careful person would not be sure, the slot is marked `unsure`: it may
 * be left empty or held as a guess, and confirming it at all is a false confirm.
 *
 * The French phrases and chore names are the app's catalog (see run.ts), as a
 * French-speaking household app would declare them. Numbers, days and the
 * grammar of taking a word back belong to the resolver.
 */

import type { Case } from '../src/index.js';
import { MAYA, SAM } from './household.js';

export const harder: Case[] = [
  // ---- French
  { text: 'la vaisselle pour Maya', act: 'assign_chore', slots: { assignee: MAYA, chore: 'dishes' }, note: 'fr' },
  { text: 'les poubelles pour Sam demain', act: 'assign_chore', slots: { assignee: SAM, chore: 'trash', due: { label: 'demain' } }, note: 'fr + day' },
  { text: 'la lessive pour Maya vendredi', act: 'assign_chore', slots: { assignee: MAYA, chore: 'laundry', due: { label: 'Vendredi' } }, note: 'fr + weekday' },
  { text: 'payer Maya douze dollars', act: 'settle_up', slots: { payee: MAYA, amount: { n: 12 } }, note: 'fr number word' },
  { text: 'rembourser Sam vingt-cinq dollars', act: 'settle_up', slots: { payee: SAM, amount: { n: 25 } }, note: 'fr hyphenated number' },
  { text: 'envoie 40 $ à Maya', act: 'settle_up', slots: { payee: MAYA, amount: { n: 40 } }, note: 'fr currency after the number' },
  { text: 'quel temps fait-il', act: null, note: 'fr, no act' },

  // ---- revised words: the last word said is the one meant, or nobody is sure
  { text: 'dishes for Sam, no, Maya', act: 'assign_chore', slots: { chore: 'dishes' }, unsure: ['assignee'], note: 'revised name' },
  { text: 'pay Maya twenty, sorry, thirty dollars', act: 'settle_up', slots: { payee: MAYA }, unsure: ['amount'], note: 'revised amount' },
  { text: 'trash for Sam, I mean laundry', act: 'assign_chore', slots: { assignee: SAM }, unsure: ['chore'], note: 'revised chore' },
  { text: 'la vaisselle pour Sam, non, pour Maya', act: 'assign_chore', slots: { chore: 'dishes' }, unsure: ['assignee'], note: 'fr revised name' },

  // ---- false starts and fillers
  { text: 'uh the the dishes for Maya', act: 'assign_chore', slots: { assignee: MAYA, chore: 'dishes' }, note: 'false start' },
  { text: 'trash for, um, for Sam', act: 'assign_chore', slots: { assignee: SAM, chore: 'trash' }, note: 'false start' },
  { text: 'pay, uh, pay Maya back 15', act: 'settle_up', slots: { payee: MAYA, amount: { n: 15 } }, note: 'false start' },

  // ---- amounts said as words
  { text: 'pay Sam a hundred and twenty dollars', act: 'settle_up', slots: { payee: SAM, amount: { n: 120 } }, note: 'number words' },
  { text: 'pay Maya two hundred', act: 'settle_up', slots: { payee: MAYA, amount: { n: 200 } }, note: 'number words' },
  { text: 'pay Sam fifteen fifty', act: 'settle_up', slots: { payee: SAM }, unsure: ['amount'], note: '$15.50 or $1,550: not sure' },
  { text: 'pay Maya twelve dollars and fifty cents', act: 'settle_up', slots: { payee: MAYA, amount: { n: 12.5 } }, note: 'dollars and cents' },

  // ---- two people in one sentence
  { text: 'dishes for Maya and Sam', act: 'assign_chore', slots: { chore: 'dishes' }, unsure: ['assignee'], note: 'two people, one slot' },
  { text: 'Sam, give Maya the dishes', act: 'assign_chore', slots: { chore: 'dishes' }, unsure: ['assignee'], note: 'who is it for?' },
  { text: 'pay Maya what Sam paid', act: 'settle_up', slots: { payee: MAYA }, unsure: ['amount'], note: 'an amount by reference' },
  { text: 'trash for Drako or Sam', act: 'assign_chore', slots: { chore: 'trash' }, unsure: ['assignee'], note: 'either' },

  // ---- names and chores, no request
  { text: 'I love doing the dishes', act: null, note: 'mentions a chore, asks nothing' },
  { text: 'Maya is at school', act: null, note: 'mentions a person, asks nothing' },
  { text: 'twenty dollars is a lot', act: null, note: 'mentions money, asks nothing' },
  { text: 'did Sam already take the bins out', act: null, note: 'a question, not a request' },
];

