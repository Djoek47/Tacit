/**
 * An orchestrator backed by the OpenAI Responses API.
 *
 * Request shape, as documented (checked 25 Sep 2026):
 *   POST https://api.openai.com/v1/responses
 *   headers  authorization: Bearer <key>, content-type: application/json
 *   body     { model, instructions, input, tools: [{ type: 'function', name, description, parameters, strict }],
 *              tool_choice, parallel_tool_calls, max_output_tokens, store }
 *   reply    { output: [{ type: 'function_call', call_id, name, arguments: '<json string>' }
 *                       | { type: 'message', content: [{ type: 'output_text', text }] }] }
 *   https://developers.openai.com/api/reference/resources/responses/methods/create
 *
 * `strict` is left off: strict mode needs every property required and a closed
 * schema, and `fill` is open on purpose (see planTools). The reply is checked
 * here instead, which is stricter than the schema could be.
 * `store: false`: a plan is built from the person's data; it is not kept there.
 */

import type { ActDef, Ctx } from '@intermenu/aiuic-core';
import type { Orchestrator } from '@intermenu/aiuic-pyramid';
import { actCards, checkPlan, couldNot, describeInput, planTools, post, SYSTEM, LIMITS, type Fetch } from './plan.js';

export type OpenAIOptions = {
  apiKey: string;
  model: string;
  acts: () => readonly ActDef[];
  fetch?: Fetch;
  baseUrl?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** 'auto' (default) or 'required'. */
  toolChoice?: 'auto' | 'required';
  includeAuthority?: boolean;
  /** The app's context, for reading slot options and checking proposed values against them. */
  ctx?: () => Ctx;
};

const WHO = 'the OpenAI API';

export function openaiOrchestrator(opts: OpenAIOptions): Orchestrator {
  const fetch = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
  const url = `${(opts.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '')}/v1/responses`;

  return async (input) => {
    const acts = actCards(opts.acts(), { includeAuthority: !!opts.includeAuthority, ...(opts.ctx ? { ctx: opts.ctx() } : {}) });
    const tools = planTools(acts).map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema }));
    const res = await post(fetch, url, { authorization: `Bearer ${opts.apiKey}` }, {
      model: opts.model,
      instructions: SYSTEM,
      input: describeInput(input, acts),
      tools,
      tool_choice: opts.toolChoice ?? 'auto',
      parallel_tool_calls: false,
      max_output_tokens: opts.maxOutputTokens ?? 1024,
      store: false,
    }, opts.timeoutMs ?? 30_000);
    if (!res.ok) return couldNot(WHO, res.problem);

    const body = res.json as { output?: unknown; status?: unknown };
    if (!Array.isArray(body.output)) return couldNot(WHO, 'answered without any output');

    const items = body.output as { type?: unknown; name?: unknown; arguments?: unknown; content?: unknown }[];
    const calls = items.filter((i) => i?.type === 'function_call');
    if (calls.length > 1) return couldNot(WHO, `asked for ${calls.length} things at once; a plan is one`);
    if (calls.length === 1) {
      const raw = calls[0]!.arguments;
      let args: unknown;
      try { args = typeof raw === 'string' ? JSON.parse(raw) : undefined; } catch { args = undefined; }
      if (args === undefined) return couldNot(WHO, `sent arguments for "${String(calls[0]!.name).slice(0, 40)}" that are not JSON`);
      const c = checkPlan(calls[0]!.name, args, acts);
      return c.ok ? c.plan : couldNot(WHO, c.problem);
    }

    const refusal = items.flatMap((i) => (i?.type === 'message' && Array.isArray(i.content) ? i.content : []))
      .some((c: { type?: unknown }) => c?.type === 'refusal');
    if (refusal) return couldNot(WHO, 'declined to plan this');
    if (body.status === 'incomplete') return couldNot(WHO, 'ran out of room before finishing');
    const text = items
      .flatMap((i) => (i?.type === 'message' && Array.isArray(i.content) ? i.content : []))
      .filter((c: { type?: unknown; text?: unknown }) => c?.type === 'output_text' && typeof c.text === 'string')
      .map((c: { text: string }) => c.text).join('\n').trim();
    if (!text) return couldNot(WHO, 'answered with nothing');
    return { kind: 'answer', answer: text.slice(0, LIMITS.answer) };
  };
}
