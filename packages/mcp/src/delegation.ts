/**
 * Letting a tool go ahead without asking is itself something the person does
 * — never something a server, a model or the conductor does. So it is an
 * act: previewed ("Let Tasks add tasks without asking"), held, undoable, and
 * recorded in memory as a delegation, which is real and lives on main.
 *
 * Only tools that CAN be lowered are offered: ones with a declared undo that
 * do not claim to be destructive. The rest never appear as options, so there
 * is nothing to say yes to.
 */

import { defineAct, type ActDef, type Radius } from '@intermenu/aiuic-core';
import type { Connection } from './bridge.js';

const LEVELS: { value: Radius; label: string; aliases: string[] }[] = [
  { value: 'self', label: 'without asking', aliases: ['go ahead', 'on its own', 'quietly'] },
  { value: 'other-person', label: 'without asking, even when it involves someone else', aliases: ['for others too'] },
  { value: 'external', label: 'only when I say yes', aliases: ['ask me', 'ask first', 'always ask'] },
];

export function delegationAct(connections: Connection[]): ActDef {
  const lowerable = () => connections.flatMap((c) => c.tools()
    .filter((t) => t.kind === 'write' && t.lowerable)
    .map((t) => ({ value: { server: c.server.name, tool: t.tool }, label: `${c.shape.app.name}: ${t.tool.replace(/_/g, ' ')}`, aliases: [t.tool.replace(/_/g, ' ')] })));
  const find = (v: { server: string; tool: string }) => connections.find((c) => c.server.name === v.server);

  return defineAct({
    name: 'set_delegation',
    domain: 'household',
    phrases: ['let it', 'without asking', 'stop asking', 'always ask', 'ask me first'],
    slots: {
      tool: { primitive: 'chip', options: () => lowerable(), required: true, order: 1 },
      level: { primitive: 'chip', options: () => LEVELS, required: true, order: 2 },
    },
    radius: 'self',
    commit: (f) => {
      const t = f.tool as { server: string; tool: string };
      const conn = find(t);
      if (!conn) throw new Error(`${t.server} is not connected`);
      const before = conn.tools().find((x) => x.tool === t.tool)?.radius ?? 'external';
      const to = conn.delegate(t.tool, f.level as Radius); // refuses below the floor
      return {
        id: `${t.server}/${t.tool}`, previous: before,
        memory: [{ kind: 'delegation', tool: `${t.server}/${t.tool}`, radius: to }],
      };
    },
    undo: (r) => {
      const [server, tool] = r.id.split('/') as [string, string];
      find({ server, tool })?.delegate(tool, (r.previous as Radius) ?? 'external');
    },
    preview: (f) => {
      const t = f.tool as { tool?: string } | undefined;
      const lvl = LEVELS.find((l) => l.value === f.level);
      return [`Let ${t?.tool?.replace(/_/g, ' ') ?? 'it'} go ${lvl ? lvl.label : '…'}`];
    },
  });
}

/** Re-apply delegations remembered from before a restart. Anything no longer allowed is skipped. */
export function applyDelegations(connections: Connection[], remembered: Record<string, string>): string[] {
  const skipped: string[] = [];
  for (const [key, radius] of Object.entries(remembered)) {
    const [server, tool] = key.split('/');
    const conn = connections.find((c) => c.server.name === server);
    try {
      if (!conn || !tool) throw new Error('not connected');
      conn.delegate(tool, radius as Radius);
    } catch (e) {
      skipped.push(`${key}: ${(e as Error).message}`);
    }
  }
  return skipped;
}
