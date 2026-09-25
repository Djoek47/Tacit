/**
 * Reconstruction: the dossier a rebuild starts from.
 *
 * From the notes: "the ability to rebuild the concept after finishing the
 * MVP." A rebuild that starts from a blank page throws away every decision
 * and every bug already paid for. A rebuild that starts from the old code
 * keeps its mistakes. This starts from the record instead:
 *
 *   what it is        the brief, as it stands now
 *   how it got here   the history, day by day
 *   what was decided  from memory: the decisions, the delegations, the score
 *   what is open      menu problems, drafts' open questions, exceptions not
 *                     yet enforced, lines of thought never merged
 *   what to keep      the tests — every one is a bug somebody already found
 *   the order         the acts to rebuild, cheapest to be wrong first
 *
 * The conductor's job, in the metaphor: it keeps the rhythm across versions.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief } from './brief.js';
import { mapMenus } from './menus.js';
import { draftFromBrief } from './draft.js';
import { evolution } from './context.js';

type MemoryView = {
  decisions: { act: string; summary: string; undone: boolean }[];
  delegations: Record<string, string>;
  orders: Record<string, { text: string; active: boolean }>;
  thoughts: { topic: string; text: string }[];
};

export type DossierInput = {
  brief?: Brief;
  repoDir?: string;
  memory?: { view: () => MemoryView; branches: () => string[] };
};

function countTests(dir: string): { files: number; cases: number } {
  let files = 0, cases = 0;
  const walk = (d: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(d, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.(test|spec)\.[jt]sx?$/.test(e)) {
        files++;
        try { cases += (readFileSync(p, 'utf8').match(/\bit\(/g) ?? []).length; } catch { /* unreadable */ }
      }
    }
  };
  walk(dir);
  return { files, cases };
}

const RANK = { self: 0, shared: 1, 'other-person': 2, external: 3 } as const;

export function dossier(input: DossierInput): string {
  const out: string[] = [];
  const b = input.brief;
  out.push(`# Rebuild dossier${b?.name ? `: ${b.name}` : ''}`, '');

  out.push('## What it is', '');
  if (b) {
    out.push(b.purpose || '(no purpose line in the brief)', '');
    if (b.audience) out.push(`For: ${b.audience}`, '');
    if (b.features.length) out.push(...b.features.map((f) => `- ${f.text}`), '');
  } else out.push('No brief given. Write one: it is the only input a rebuild cannot recover from code.', '');

  if (input.repoDir) {
    const days = evolution(input.repoDir);
    out.push('## How it got here', '');
    if (!days.length) out.push('No git history found.', '');
    else {
      const total = days.reduce((s, d) => s + d.commits.length, 0);
      out.push(`${total} commits over ${days.length} day${days.length === 1 ? '' : 's'}, ${days[0]!.date} to ${days[days.length - 1]!.date}.`, '');
      for (const d of days.slice(-10)) out.push(`- **${d.date}** — ${d.commits.slice(0, 3).map((c) => c.subject).join('; ')}${d.commits.length > 3 ? `; and ${d.commits.length - 3} more` : ''}`);
      out.push('');
    }
  }

  if (input.memory) {
    const v = input.memory.view();
    out.push('## What was decided', '');
    const kept = v.decisions.filter((d) => !d.undone);
    if (!kept.length && !Object.keys(v.delegations).length && !Object.keys(v.orders).length) out.push('Nothing recorded yet.', '');
    for (const d of kept.slice(-15)) out.push(`- ${d.act.replace(/_/g, ' ')}: ${d.summary}`);
    for (const [t, r] of Object.entries(v.delegations)) out.push(`- allowed ${t} to go ahead at "${r}"`);
    for (const o of Object.values(v.orders).filter((o) => o.active)) out.push(`- standing order: ${o.text}`);
    out.push('');
  }

  out.push('## What is still open', '');
  const open: string[] = [];
  if (b) {
    for (const i of mapMenus(b.menus).issues.filter((x) => x.level !== 'note' || /stage can/.test(x.message))) open.push(i.message);
    open.push(...draftFromBrief(b).notes);
  }
  if (input.memory) {
    const unmerged = input.memory.branches().filter((x) => x !== 'main');
    if (unmerged.length) open.push(`Lines of thought never merged: ${unmerged.join(', ')} — keep, merge or drop each`);
  }
  out.push(...(open.length ? open.map((o) => `- ${o}`) : ['Nothing flagged.']), '');

  if (input.repoDir) {
    const t = countTests(input.repoDir);
    out.push('## What to keep', '');
    out.push(t.cases
      ? `${t.cases} test cases in ${t.files} files. Keep every one that still describes the product: each is a bug somebody already found. A rebuild that deletes them will find those bugs again.`
      : 'No tests found. The rebuild should start by writing down, as tests, the behaviour that must survive.', '');
  }

  if (b) {
    const d = draftFromBrief(b);
    out.push('## Rebuild order', '', 'Cheapest to be wrong first, so the costly acts are built on a tested base:', '');
    const order = [...d.acts].sort((x, y) => RANK[x.radius] - RANK[y.radius]);
    order.forEach((a, i) => out.push(`${i + 1}. **${a.name}** (${a.radius}) — ${a.feature}`));
    out.push('');
  }
  return out.join('\n');
}
