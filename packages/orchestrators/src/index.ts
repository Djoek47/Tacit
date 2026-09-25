/**
 * @intermenu/aiuic-orchestrators — optional. A model plans; it never writes.
 *
 *   const pyramid = new Pyramid({
 *     app, aggregator, ctx,
 *     orchestrator: anthropicOrchestrator({ apiKey, model: 'claude-opus-5', acts: () => app.ui.definitions }),
 *   });
 *
 * Each adapter returns the pyramid's Orchestrator: copies in, a Plan out.
 * A proposal lands on the stage and waits for the person like any other.
 * Every failure is an honest answer, never an exception, so an unreachable
 * provider cannot stop the conductor.
 */
export { anthropicOrchestrator, type AnthropicOptions } from './anthropic.js';
export { openaiOrchestrator, type OpenAIOptions } from './openai.js';
export { actCards, checkPlan, planTools, describeInput, couldNot, redact, SYSTEM, LIMITS, type ActCard, type Checked, type Fetch } from './plan.js';
