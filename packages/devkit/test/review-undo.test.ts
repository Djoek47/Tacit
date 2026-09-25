import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx } from '@intermenu/aiuic-core';
import { createApp } from '@intermenu/aiuic-kit';
import { EphemeralStore, openMemory } from '@intermenu/aiuic-memory';
import { Aggregator, Pyramid } from '@intermenu/aiuic-pyramid';
import { connect, delegationAct, applyDelegations } from '@intermenu/aiuic-mcp';
import { tasksServer } from '../../mcp/test/fixture.js';

declare const setTimeout: (fn: () => void, ms: number) => unknown;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(() => r(), 0)); };

// Found by independent review.
describe('an undone delegation stays undone after a restart', () => {
  it('undo reverts it live, but memory still says "self" and applyDelegations re-applies it', async () => {
    const s = await tasksServer();
    const conn = await connect(s.client);
    const clock = new FakeClock(1_700_000_000_000);
    const attention = { foreground: true, unlocked: true, proximityClear: true, listening: true };
    const ctx = () => ({ now: new Date(clock.now()), actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }) as Ctx;
    const app = createApp({ clock, speculate: false, ctx, acts: [...conn.acts, delegationAct([conn])] });
    const store = new EphemeralStore();
    const mem = openMemory(store, () => clock.now());
    new Pyramid({ app, memory: mem, ctx, aggregator: new Aggregator([]), orchestrator: () => ({ kind: 'answer', answer: '' }) });

    // The person delegates, by touch, and assents.
    const run = app.ui.start('set_delegation');
    run.setValue('tool', { server: 'tasks', tool: 'add_task' }, 'touched');
    run.setValue('level', 'self', 'touched');
    await run.assent(); await settle();
    expect(conn.tools().find((t) => t.tool === 'add_task')!.radius).toBe('self');

    // ...then changes their mind and taps Undo.
    expect(await run.undo()).toBe(true); await settle();
    expect(conn.tools().find((t) => t.tool === 'add_task')!.radius).toBe('external');
    expect(mem.reader.view().decisions.find((d) => d.act === 'set_delegation')!.undone).toBe(true);

    // Restart: a fresh connection, delegations re-applied from memory as the daemon does.
    const s2 = await tasksServer();
    const conn2 = await connect(s2.client);
    const mem2 = openMemory(store);
    applyDelegations([conn2], mem2.reader.view().delegations);
    expect(conn2.tools().find((t) => t.tool === 'add_task')!.radius).toBe('external'); // was the hole: 'self' again
  });
});
