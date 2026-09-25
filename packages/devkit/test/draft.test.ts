import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connect } from '@intermenu/aiuic-mcp';
import { parseBrief, mapMenus, mermaid, draftFromBrief, scaffold } from '../src/index.js';
import { FAMILY_BRIEF } from './fixtures.js';

describe('the brief', () => {
  it('reads notes the way they are written, French headings included', () => {
    const b = parseBrief(FAMILY_BRIEF);
    expect(b.name).toBe('Family Tasks');
    expect(b.purpose).toContain('runs the house by voice');
    expect(b.audience).toBe('parents with kids under 14');
    expect(b.features).toHaveLength(5);
    expect(b.features[0]!.asks).toEqual(['who', 'what', 'when']);
    expect(b.design).toMatchObject({ mood: ['calm', 'glass', '2030'], colours: ['#5B6CFF'], fonts: ['Bricolage Grotesque'] });
    expect(b.references).toHaveLength(2);
    expect(b.exceptions).toEqual(['kids cannot approve their own allowance']);
    expect(b.expectations).toHaveLength(2);
  });
});

describe('the menu map', () => {
  it('finds what nobody can reach, what is too deep, and what the stage can replace', () => {
    const m = mapMenus(parseBrief(FAMILY_BRIEF).menus);
    const msg = m.issues.map((i) => `${i.level}:${i.menu}`);
    expect(msg).toContain('error:Archive');                 // declared, never linked
    expect(msg).toContain('warn:Advanced');                 // four taps deep
    expect(msg).toContain('note:Calendar');                 // reached, never described
    expect(m.issues.find((i) => i.menu === 'Chores')!.message).toMatch(/stage can put that card up directly/);
    expect(mermaid(m)).toMatch(/^flowchart TD/);
  });
});

describe('the draft', () => {
  const d = draftFromBrief(parseBrief(FAMILY_BRIEF));
  const act = (n: string) => d.acts.find((a) => a.name === n)!;

  it('turns each feature into an act, with slots from what it asks', () => {
    expect(d.acts.map((a) => a.name)).toEqual(['add_chore', 'pay_allowance', 'add_groceries', 'plan_event', 'send_weekly']);
    expect(Object.entries(act('add_chore').slots).map(([k, s]) => `${k}:${s.primitive}`)).toEqual(['who:face', 'what:ghostField', 'when:when']);
    expect(act('pay_allowance').slots.amount!.primitive).toBe('quantity');
  });

  it('leans careful on cost, and says why', () => {
    expect(act('pay_allowance').radius).toBe('external');
    expect(act('send_weekly').radius).toBe('external');
    expect(act('add_chore').radius).toBe('other-person');
    expect(act('add_groceries').radius).toBe('self');
    for (const a of d.acts) expect(a.why.length).toBeGreaterThan(0);
  });

  it('turns the exception into something to decide', () => {
    expect(d.notes.join()).toMatch(/pay_allowance/);
  });
});

describe('the scaffold runs', () => {
  it('is a real MCP server whose shape the bridge accepts without a single problem', async () => {
    const d = draftFromBrief(parseBrief(FAMILY_BRIEF));
    const files = scaffold(parseBrief(FAMILY_BRIEF), d);
    // Written next to a node_modules that has the SDK, the way a developer would have it.
    const dir = join(process.cwd(), '.scaffold-test');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const client = new Client({ name: 't', version: '0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(dir, 'server.mjs')], stderr: 'ignore' }));
      const conn = await connect(client);
      await conn.approve(); // option lists load only once the person has approved
      expect(conn.shapeProblems).toEqual([]);
      expect(conn.shape.app.name).toBe('Family Tasks');
      const tools = Object.fromEntries(conn.tools().map((t) => [t.tool, t]));
      expect(tools.add_groceries!.lowerable).toBe(true);     // it has its undo pair
      expect(tools.pay_allowance!.lowerable).toBe(false);    // money: never quiet
      expect(tools.list_people!.kind).toBe('read');
      const chore = conn.acts.find((a) => a.name === 'add_chore')!;
      const people = chore.slots.who!.options!({} as never, {}) as { label: string }[];
      expect(people[0]!.label).toBe('Example people');
    } finally {
      await client.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
