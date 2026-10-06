import { describe, expect, it } from 'vitest';
import type { WorldSource } from '@intermenu/aiuic-notify';
import { worldRoute } from '../src/world.js';

const KEY = 'wm_SECRETSECRETSECRET';
function counting(fail = false) {
  let calls = 0;
  const src: WorldSource & { lastErrors: string[] } = {
    name: 'wm', lastErrors: [],
    pull: async () => {
      calls++;
      if (fail) { src.lastErrors = [`conflict: answered 401 for key ${KEY}`]; return []; }
      return [{ id: 'a', source: 'wm', title: 'Oil supply note', topics: ['trading'], at: 1000 }];
    },
  };
  return { src, calls: () => calls };
}

describe('the world route', () => {
  it('serves many callers from one refresh, then refreshes after the window', async () => {
    let t = 10_000;
    const c = counting();
    const get = worldRoute({ sources: [c.src], refreshMs: 60_000, now: () => t });
    await Promise.all([get(), get(), get()]);
    expect(c.calls()).toBe(1);
    t += 61_000;
    expect((await get()).body.items).toHaveLength(1);
    expect(c.calls()).toBe(2);
  });

  it('never repeats the key, even inside an upstream error', async () => {
    const c = counting(true);
    const r = await worldRoute({ sources: [c.src], secrets: [KEY], now: () => 5000 })();
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r.body.errors[0]).toMatch(/\[key\]/);
  });

  it('filters by topic', async () => {
    const c = counting();
    const get = worldRoute({ sources: [c.src], now: () => 5000 });
    expect((await get({ topics: ['ai'] })).body.items).toEqual([]);
    expect((await get({ topics: ['trading'] })).body.items).toHaveLength(1);
  });
});
