import { describe, expect, it } from 'vitest';
import { mood } from '../src/mood.js';

describe('is this sentence asking for something', () => {
  it('hears requests, including polite questions and wants', () => {
    for (const s of ['do the laundry', 'dishes for Maya', 'Sam should help out', 'Sam can do the washing up',
      'can you pay Maya back', 'I need Maya to do the dishes', 'la vaisselle pour Maya', 'peux-tu payer Sam',
      'pay Maya twenty, sorry, thirty dollars', 'uh the the dishes for Maya'])
      expect([s, mood(s)]).toEqual([s, 'request']);
  });
  it('hears questions', () => {
    for (const s of ['did Sam already take the bins out', 'what is the weather', 'do you know where Maya is',
      'is the laundry done?', 'est-ce que Sam a fait la vaisselle', 'quel temps fait-il'])
      expect([s, mood(s)]).toEqual([s, 'question']);
  });
  it('hears statements', () => {
    for (const s of ['I love doing the dishes', 'twenty dollars is a lot', 'Maya is at school', "c'est trop cher", "it's Sam's turn"])
      expect([s, mood(s)]).toEqual([s, 'statement']);
  });
});
