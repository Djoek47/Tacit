/**
 * Review 2: the provider's error message is cut to 160 characters BEFORE the
 * key is removed from it. redact() removes the exact header value and things
 * shaped like "sk-…"/"key-…"/"api-…". A key without one of those prefixes
 * (an OpenAI-compatible endpoint set through `baseUrl`), echoed near the end of
 * a long message, is cut in half by the slice; the half no longer matches the
 * exact value and goes into the answer, and the answer is written to memory.
 */
import { describe, expect, it } from 'vitest';
import { openaiOrchestrator } from '../src/index.js';
import { build, stubFetch } from './fixture.js';

const KEY = '3f9a2b7c4d1e8f60a5b9c2d7e4f1a8b3c6d9e2f5a8b1c4d7e0f3a6b9c2d5e8f1';

describe('review2: no part of the key reaches the answer', () => {
  it('a key echoed across the 160-character cut is still removed', async () => {
    const message = 'The credentials supplied with this request could not be validated by the gateway for the requested deployment; key received: ' + KEY;
    const f = stubFetch({ error: { message } }, 401);
    const h = build((acts) => openaiOrchestrator({ apiKey: KEY, model: 'm', acts, fetch: f.fetch, baseUrl: 'https://gateway.example' }));
    const out = await h.pyramid.pursue('set my groceries budget') as { answer?: string };
    // Any 12 consecutive characters of the key is too much.
    const leaked = [...Array(KEY.length - 11).keys()].some((i) => out.answer!.includes(KEY.slice(i, i + 12)));
    expect(leaked).toBe(false);
  });
});
