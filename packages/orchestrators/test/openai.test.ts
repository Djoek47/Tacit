import { describe, expect, it } from 'vitest';
import { openaiOrchestrator, redact } from '../src/index.js';
import { build, stubFetch } from './fixture.js';

const KEY = 'sk-proj-SECRETSECRETSECRET';
const call = (name: string, args: unknown) => ({
  status: 'completed',
  output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name, arguments: typeof args === 'string' ? args : JSON.stringify(args), status: 'completed' }],
});

function withReply(reply: unknown, status = 200) {
  const f = stubFetch(reply, status);
  const h = build((acts) => openaiOrchestrator({ apiKey: KEY, model: 'gpt-5', acts, fetch: f.fetch }));
  return { ...h, sent: f.sent };
}

describe('what it sends to the OpenAI Responses API', () => {
  it('sends the documented shape, does not ask for the plan to be stored, and allows one call', async () => {
    const h = withReply(call('answer', { answer: 'ok' }));
    await h.pyramid.pursue('what is my grocery budget');
    const s = h.sent[0]!;
    expect(s.url).toBe('https://api.openai.com/v1/responses');
    expect(s.headers).toMatchObject({ authorization: `Bearer ${KEY}` });
    expect(s.body).toMatchObject({ model: 'gpt-5', tool_choice: 'auto', parallel_tool_calls: false, store: false, max_output_tokens: 1024 });
    expect(String(s.body.instructions)).toMatch(/You plan; you never act/);
    expect(String(s.body.input)).toMatch(/^GOAL: what is my grocery budget/);
    const tools = s.body.tools as { type: string; name: string; parameters: unknown }[];
    expect(tools.map((t) => `${t.type}:${t.name}`)).toEqual(['function:answer', 'function:propose', 'function:look', 'function:split']);
  });
});

describe('what it accepts back', () => {
  it('parses a function call and puts the proposal on the stage, waiting', async () => {
    const h = withReply(call('propose', { act: 'set_budget', fill: { category: 'groceries', amount: { n: 420, label: '$420' } }, why: 'averaged $412' }));
    expect(await h.pyramid.pursue('set my groceries budget')).toMatchObject({ kind: 'proposed', act: 'set_budget', status: 'explicit' });
    await h.advance(60_000);
    expect(h.written).toEqual([]);
  });

  it('splits a goal into parts, each going round the loop', async () => {
    let n = 0;
    const f = stubFetch(() => (++n === 1 ? call('split', { goals: ['groceries spend', 'rent spend'] }) : call('answer', { answer: `part ${n}` })));
    const h = build((acts) => openaiOrchestrator({ apiKey: KEY, model: 'm', acts, fetch: f.fetch }));
    const out = await h.pyramid.pursue('what do I spend each month');
    expect(out.kind).toBe('split');
    expect(String(f.sent[3]!.body.input)).toMatch(/PARTS[^]*groceries spend → part 2[^]*rent spend → part 3/);
  });

  it('takes a message as an answer', async () => {
    const h = withReply({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'About $412.' }] }] });
    expect(await h.pyramid.pursue('what do groceries cost')).toEqual({ kind: 'answered', answer: 'About $412.' });
  });

  const refused: [string, unknown, RegExp][] = [
    ['arguments that are not JSON', call('answer', '{"answer": "unterminated'), /arguments for "answer" that are not JSON/],
    ['an act it does not have', call('propose', { act: 'pay_rent', fill: {}, why: 'x' }), /act this app does not offer: "pay_rent"/],
    ['a refusal', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, /declined/],
    ['an incomplete reply', { status: 'incomplete', output: [] }, /ran out of room/],
    ['two calls', { output: [call('answer', { answer: 'a' }).output[0], call('answer', { answer: 'b' }).output[0]] }, /2 things at once/],
  ];
  for (const [what, reply, says] of refused) {
    it(`refuses ${what}, honestly`, async () => {
      const h = withReply(reply);
      const out = (await h.pyramid.pursue('set my groceries budget')) as { kind: string; answer: string };
      expect(out.kind).toBe('answered');
      expect(out.answer).toMatch(says);
      expect(h.app.act).toBeNull();
    });
  }

  it('keeps a partly masked key out of the answer, and so out of memory', async () => {
    const h = withReply({ error: { message: 'Incorrect API key provided: sk-proj-****************CRET. You can find your API key at…' } }, 401);
    const out = (await h.pyramid.pursue('set my budget')) as { answer: string };
    expect(out.answer).toMatch(/answered 401 \(Incorrect API key provided: \[key\]/);
    expect(redact(`Bearer ${KEY} leaked`, { authorization: `Bearer ${KEY}` })).toBe('Bearer [key] leaked');
  });
});

describe('Grok, through the same adapter', () => {
  it('posts to xAI\'s Responses endpoint, and names xAI when it fails', async () => {
    const { grokOrchestrator } = await import('../src/index.js');
    const f = stubFetch({ error: { message: 'bad key' } }, 401);
    const h = build((acts) => grokOrchestrator({ apiKey: 'xai-SECRETSECRET', model: 'grok-4', acts, fetch: f.fetch }));
    const out = (await h.pyramid.pursue('set my budget')) as { answer: string };
    expect(f.sent[0]!.url).toBe('https://api.x.ai/v1/responses');
    expect(out.answer).toMatch(/^I could not plan this: the xAI API answered 401/);
  });
});
