/**
 * The map of how menus follow one another, and what is wrong with it.
 *
 * "Ability to create a map detailing expectations; explain how menus follow
 * one another." The map is a graph, and a graph can be checked: a screen
 * nobody can reach, a screen named but never described, one that is five taps
 * deep. And one check this SDK exists to make: a menu whose only job is to
 * reach one thing is a menu the stage can replace — say the thing, and the
 * card for it appears.
 */

import type { Brief, Menu } from './brief.js';

export type MenuIssue = {
  level: 'error' | 'warn' | 'note';
  menu: string;
  message: string;
};

export type MenuMap = {
  root: string | null;
  nodes: string[];
  edges: [string, string][];
  /** Taps from the root. Missing = unreachable. */
  depth: Record<string, number>;
  issues: MenuIssue[];
};

export const MAX_DEPTH = 3;

export function mapMenus(menus: Menu[]): MenuMap {
  const declared = new Map(menus.map((m) => [m.name.toLowerCase(), m]));
  const nameOf = new Map<string, string>();
  for (const m of menus) { nameOf.set(m.name.toLowerCase(), m.name); for (const t of m.leadsTo) if (!nameOf.has(t.toLowerCase())) nameOf.set(t.toLowerCase(), t); }
  const nodes = [...nameOf.values()];
  const edges: [string, string][] = menus.flatMap((m) => m.leadsTo.map((t) => [m.name, nameOf.get(t.toLowerCase())!] as [string, string]));
  const root = menus[0]?.name ?? null;
  const issues: MenuIssue[] = [];

  const depth: Record<string, number> = {};
  if (root) {
    depth[root] = 0;
    const queue = [root];
    while (queue.length) {
      const n = queue.shift()!;
      for (const [a, b] of edges) if (a === n && depth[b] === undefined) { depth[b] = depth[n]! + 1; queue.push(b); }
    }
  }

  for (const n of nodes) {
    const key = n.toLowerCase();
    if (depth[n] === undefined) issues.push({ level: 'error', menu: n, message: `nothing leads to ${n} from ${root}, so nobody can reach it` });
    else if (depth[n]! > MAX_DEPTH) issues.push({ level: 'warn', menu: n, message: `${n} is ${depth[n]} taps from ${root}; more than ${MAX_DEPTH} and people stop looking` });
    if (!declared.has(key)) issues.push({ level: 'note', menu: n, message: `${n} is reached but never described — what is on it?` });
  }
  for (const m of menus) {
    if (m.leadsTo.length === 1 && m.name !== root) {
      issues.push({ level: 'note', menu: m.name, message: `${m.name} only leads to ${m.leadsTo[0]}. Say it instead: the stage can put that card up directly, and this menu can go` });
    }
    const dup = m.leadsTo.filter((t, i) => m.leadsTo.findIndex((x) => x.toLowerCase() === t.toLowerCase()) !== i);
    for (const d of dup) issues.push({ level: 'warn', menu: m.name, message: `${m.name} lists ${d} twice` });
  }
  return { root, nodes, edges, depth, issues };
}

/** The map as Mermaid, which renders natively in artifacts and most docs. */
export function mermaid(map: MenuMap): string {
  const id = (s: string) => 'n' + [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
  const lines = ['flowchart TD'];
  for (const n of map.nodes) lines.push(`  ${id(n)}["${n.replace(/"/g, "'")}"]`);
  for (const [a, b] of map.edges) lines.push(`  ${id(a)} --> ${id(b)}`);
  for (const i of map.issues.filter((x) => x.level === 'error')) lines.push(`  style ${id(i.menu)} stroke:#F87171,stroke-width:2px`);
  return lines.join('\n');
}

export function menusOf(b: Brief): MenuMap {
  return mapMenus(b.menus);
}
