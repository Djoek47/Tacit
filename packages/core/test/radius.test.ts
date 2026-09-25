import { describe, expect, it } from 'vitest';
import { defineAct, explainRadius, type Ctx } from '../src/index.js';

describe('an act with no undo', () => {
  it('cannot reach a silence commit through a function radius that returns low', () => {
    // max "external" passes the definition-time check, because nothing below
    // external is promised. of() then returns "self". Without a runtime rule
    // this act would HOLD and commit on silence with no way back.
    const def = defineAct({
      name: 'no_way_back',
      slots: { x: { primitive: 'chip', options: () => [{ value: 1, label: 'one' }], required: true, order: 1 } },
      radius: { max: 'external', of: () => 'self' },
      commit: () => ({ id: '1' }),
    });
    const b = explainRadius(def, { x: 1 }, { reachLimit: 1 } as Ctx);
    expect(b.radius).toBe('external');
    expect(b.why).toMatch(/no undo/);
  });
});
