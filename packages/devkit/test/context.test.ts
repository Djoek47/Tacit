import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EphemeralStore, openMemory } from '@intermenu/aiuic-memory';
import { repoSource, transcriptSource, evolution, formatEvolution, dossier, parseBrief } from '../src/index.js';
import { FAMILY_BRIEF } from './fixtures.js';

const REPO = resolve(__dirname, '../../..'); // this repository, history and all

describe('context from a real repository', () => {
  it('finds code and commits by what they are about', async () => {
    const f = await repoSource(REPO).read('no undo no silence runtime');
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((x) => /radius\.ts|commit /.test(x.claim))).toBe(true);
  });

  it('reads the history as a timeline, oldest first', () => {
    const days = evolution(REPO);
    expect(days.length).toBeGreaterThan(0);
    expect(days[0]!.date <= days[days.length - 1]!.date).toBe(true);
    expect(formatEvolution(days)).toMatch(/\d{4}-\d{2}-\d{2} — \d+ commits?/);
  });

  it('says so plainly when there is no history', () => {
    expect(formatEvolution(evolution('/tmp'))).toMatch(/No history/);
  });
});

describe('the whole chat', () => {
  it('finds what was said, and who said it', async () => {
    const dir = join(__dirname, '.chat'); mkdirSync(dir, { recursive: true });
    const p = join(dir, 'talk.md');
    writeFileSync(p, 'User: the conductor should keep working when the app is closed.\n\nAssistant: then it may only commit what a standing order allows.\n');
    const f = await transcriptSource(p).read('conductor closed');
    expect(f[0]!.claim).toMatch(/turn 1 \(user\)/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the rebuild dossier', () => {
  it('starts a rebuild from the record, not from a blank page', () => {
    const mem = openMemory(new EphemeralStore());
    mem.writer.commit('main', 'congregator', 'x', [
      { kind: 'decision', act: 'add_chore', id: '1', summary: '1 item: dishes' },
      { kind: 'delegation', tool: 'tasks/add_task', radius: 'self' },
      { kind: 'order', id: 'o', text: 'every morning: what is due', active: true },
    ]);
    mem.writer.branch('what-if');
    const md = dossier({ brief: parseBrief(FAMILY_BRIEF), repoDir: REPO, memory: mem.reader });
    for (const h of ['What it is', 'How it got here', 'What was decided', 'What is still open', 'What to keep', 'Rebuild order']) expect(md).toContain(`## ${h}`);
    expect(md).toMatch(/nobody can reach it/);                     // Archive
    expect(md).toMatch(/Lines of thought never merged: what-if/);
    expect(md).toMatch(/\d+ test cases in \d+ files/);
    // the cheapest act to get wrong is rebuilt first, money last
    const order = md.split('## Rebuild order')[1]!;
    expect(order.indexOf('add_groceries')).toBeLessThan(order.indexOf('pay_allowance'));
  });
});
