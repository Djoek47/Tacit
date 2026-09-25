/**
 * An orchestrator backed by the Claude Messages API.
 *
 * Request shape, as documented (checked 25 Sep 2026):
 *   POST https://api.anthropic.com/v1/messages
 *   headers  x-api-key, anthropic-version: 2023-06-01, content-type: application/json
 *   body     { model, max_tokens, system, messages: [{ role: 'user', content }],
 *              tools: [{ name, description, input_schema }], tool_choice }
 *   reply    { content: [{ type: 'text', text } | { type: 'tool_use', id, name, input }], stop_reason }
 *   https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
 *   https://platform.claude.com/docs/en/api/messages
 *
 * tool_choice defaults to { type: 'auto' }. The same page says some current
 * models reject forced tool use ('any' / 'tool') with a 400, so forcing is
 * opt-in, and a reply in plain text is accepted as an answer instead.
 */

import type { ActDef } from '@intermenu/aiuic-core';
import type { Orchestrator } from '@intermenu/aiuic-pyramid';
import { actCards, checkPlan, couldNot, describeInput, planTools, post, SYSTEM, LIMITS, type Fetch } from './plan.js';

export type AnthropicOptions = {
  apiKey: string;
  model: string;
  /** The app's acts, read on every plan, so newly connected servers are included. */
  acts: () => readonly ActDef[];
  fetch?: Fetch;
  baseUrl?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** 'auto' (default) or 'any'. Some models refuse 'any'; see the note above. */
  toolChoice?: 'auto' | 'any';
  /** Let the model propose acts that grant authority. Off by default. */
  includeAuthority?: boolean;
};

const WHO = 'the Claude API';

export function anthropicOrchestrator(opts: AnthropicOptions): Orchestrator {
  const fetch = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
  const url = `${(opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;

  return async (input) => {
    const acts = actCards(opts.acts(), { includeAuthority: !!opts.includeAuthority });
    const tools = planTools(acts).map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
    const res = await post(fetch, url, { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: describeInput(input, acts) }],
      tools,
      tool_choice: { type: opts.toolChoice ?? 'auto' },
    }, opts.timeoutMs ?? 30_000);
    if (!res.ok) return couldNot(WHO, res.problem);

    const body = res.json as { content?: unknown; stop_reason?: unknown };
    if (body.stop_reason === 'refusal') return couldNot(WHO, 'declined to plan this');
    if (!Array.isArray(body.content)) return couldNot(WHO, 'answered without any content');

    const blocks = body.content as { type?: unknown; name?: unknown; input?: unknown; text?: unknown }[];
    const calls = blocks.filter((b) => b?.type === 'tool_use');
    if (calls.length > 1) return couldNot(WHO, `asked for ${calls.length} things at once; a plan is one`);
    if (calls.length === 1) {
      const c = checkPlan(calls[0]!.name, calls[0]!.input, acts);
      return c.ok ? c.plan : couldNot(WHO, c.problem);
    }
    // No tool call: under 'auto' a model may simply answer in words.
    const text = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('\n').trim();
    if (body.stop_reason === 'max_tokens') return couldNot(WHO, 'ran out of room before finishing');
    if (!text) return couldNot(WHO, 'answered with nothing');
    return { kind: 'answer', answer: text.slice(0, LIMITS.answer) };
  };
}
