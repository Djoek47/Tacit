import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx } from '@intermenu/aiuic-core';
import { createApp } from '@intermenu/aiuic-kit';
import { EphemeralStore, openMemory } from '@intermenu/aiuic-memory';
import { Aggregator, Pyramid, type Plan } from '@intermenu/aiuic-pyramid';
import { Conductor, scoreActs } from '@intermenu/aiuic-conductor';
import { connect, delegationAct } from '@intermenu/aiuic-mcp';
import { tasksServer } from '../../mcp/test/fixture.js';

const T0 = Date.UTC(2026, 8, 25, 12, 0);
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
// Daemon conditions: nobody is there.
const attention = { foreground: false, unlocked: false, proximityClear: false, listening: false };

async function world(plans: Plan[]) {
  const s = await tasksServer();
  const conn = await connect(s.client);
  const clock = new FakeClock(T0);
  const ctx = () => ({ now: new Date(clock.now()), actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }) as Ctx;
  const app = createApp({ clock, speculate: false, ctx, acts: [...conn.acts, ...scoreActs(), delegationAct([conn])] });
  const mem = openMemory(new EphemeralStore(), () => clock.now());
  let i = 0;
  // A model-backed orchestrator (the documented extension point). What it proposes is
  // whatever the model — or text injected into its findings — says.
  const pyramid = new Pyramid({ app, memory: mem, ctx, now: () => clock.now(), aggregator: new Aggregator(conn.sources),
    orchestrator: () => plans[Math.min(i++, plans.length - 1)]! });
  const conductor = new Conductor({ app, memory: mem.reader, clock, store: new EphemeralStore(), ctx,
    pursue: (g) => pyramid.pursue(g) as never, heartbeatMs: 60_000 });
  // ONE order the person really approved: a goal, lowest ceiling ('self').
  mem.writer.commit('main', 'congregator', 'order', [{ kind: 'order', id: 'o1', text: 'every hour: what is due', active: true,
    spec: { schedule: { every: 3_600_000 }, ceiling: 'self', goal: 'what is due' } }]);
  return { s, conn, app, clock, mem, conductor };
}

// Found by independent review: a goal order let a model grant itself permissions.
describe('the conductor never grants itself permission', () => {
  it('a goal order lets the model lower a tool (set_delegation), unattended', async () => {
    const w = await world([{ kind: 'propose', act: 'set_delegation', why: 'x',
      fill: { tool: { server: 'tasks', tool: 'add_task' }, level: 'self' } }]);
    expect(w.conn.tools().find((t) => t.tool === 'add_task')!.radius).toBe('external');
    await w.conductor.run(w.conductor.orders()[0]!); await settle();
    // rule 5/delegation.ts: "never something a server, a model or the conductor does"
    // was the hole: it becomes 'self', recorded in main, inbox says 'done'
    expect(w.conn.tools().find((t) => t.tool === 'add_task')!.radius).toBe('external');
    expect(w.mem.reader.view().delegations['tasks/add_task']).toBeUndefined();
  });

  it('...and the next beat then calls the MCP write tool unattended', async () => {
    const w = await world([
      { kind: 'propose', act: 'set_delegation', why: 'x', fill: { tool: { server: 'tasks', tool: 'add_task' }, level: 'self' } },
      { kind: 'propose', act: 'add_task', why: 'x', fill: { title: 'model wrote this', list: 'home' } },
    ]);
    const o = w.conductor.orders()[0]!;
    await w.conductor.run(o); await settle();
    await w.conductor.run(o); await settle();
    expect(w.s.tasks).toEqual([]); // was the hole: ['model wrote this'] was written on the MCP server
  });

  it('a goal order lets the model write a NEW standing order (set_standing_order), unattended', async () => {
    const w = await world([{ kind: 'propose', act: 'set_standing_order', why: 'x',
      fill: { often: { every: 60_000 }, goal: 'whatever the model wants every minute' } }]);
    expect(w.conductor.orders().length).toBe(1);
    await w.conductor.run(w.conductor.orders()[0]!); await settle();
    expect(w.conductor.orders().length).toBe(1); // was the hole: a 2nd order (every minute, model's goal) now exists
  });
});
