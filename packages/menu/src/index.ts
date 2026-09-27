/**
 * Menus: what the AI may show, and what it may never do to what it shows.
 *
 * The project is named for this — an interface the AI controls, reached
 * through menus — and until now the runtime had one card and no menu at all.
 * Menus lived in the devkit as analysis of a written brief, which checks a
 * drawing of a house rather than a house.
 *
 * Two decisions hold everything else up.
 *
 * **A menu is a projection of capability, never a drawing of one.** Menus are
 * generated from the acts an app actually has, grouped by the `domain` tag the
 * acts already carry. Nobody writes a menu by hand, so a menu cannot promise
 * something the app cannot do, and an act added on Tuesday is in the menu on
 * Tuesday. The same rule the devkit applies to a brief applies here: a domain
 * holding one act gets no menu of its own — that act sits at the top, because
 * a menu whose only job is to reach one thing is a menu the stage can replace.
 *
 * **The AI may raise and annotate. It may never hide.** `spotlight()` reorders
 * and `say()` explains; there is no `hide()`, no `only()`, no filter the AI can
 * reach. An assistant that can quietly drop "cancel" or "refund" from a menu
 * has taken a decision away from the person without ever writing anything, and
 * that is the same harm this system exists to prevent, arriving by a door the
 * commit contract does not watch. `everyActReachable()` is the test that holds
 * it.
 *
 * And a menu writes nothing. `choose()` hands back what was chosen; starting
 * the act is the host's to do, through the ordinary contract, with its hold
 * and its blast radius intact. Nothing in this file can commit — there is no
 * app handle here to commit with.
 */

import type { ActDef, Radius } from '@intermenu/aiuic-core';

// ------------------------------------------------------------------- the view

export type MenuItem = {
  kind: 'act' | 'menu';
  /** An act's name, or a menu's id. */
  id: string;
  label: string;
  domain: string | null;
  /** What it costs to be wrong, as the act declares it. Menus cost nothing. */
  radius: Radius | null;
  /** Acts inside, for a menu. */
  count: number;
  /** One line the AI attached. Never invented here. */
  note: string | null;
  /** The AI raised this as worth seeing now. */
  spotlit: boolean;
};

export type MenuView = {
  id: string;
  title: string;
  /** The way back: every menu above this one, root first. */
  trail: { id: string; title: string }[];
  items: MenuItem[];
  /** Why this menu is open, when the AI opened it. */
  note: string | null;
  atRoot: boolean;
};

/** What `choose()` hands back. Starting the act is the host's job. */
export type Chosen =
  | { kind: 'menu'; menu: string }
  | { kind: 'act'; act: string }
  | { kind: 'unknown'; id: string };

// ------------------------------------------------------------- the structure

export type MenuSpec = {
  id: string;
  title: string;
  /** Act names, in the order they are shown. */
  acts: string[];
  /** Child menu ids. */
  menus: string[];
};

export const ROOT = 'root';
export const OTHER = 'other';

const humanise = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();

const title = (s: string) => {
  const h = humanise(s);
  return h.charAt(0).toUpperCase() + h.slice(1);
};

/** The cost an act declares, before any runtime narrowing. */
export function declaredRadius(act: ActDef): Radius {
  return typeof act.radius === 'string' ? act.radius : act.radius.max;
}

export type GenerateOptions = {
  /** What the root is called on screen. */
  title?: string;
  /** Nicer names for domains: { groceries: 'Shopping' }. */
  names?: Record<string, string>;
};

/**
 * Menus for an app, from the acts it has. Deterministic: the same acts always
 * give the same menus, so a menu cannot drift from the app behind it.
 */
export function menusFromActs(acts: readonly ActDef[], opts: GenerateOptions = {}): MenuSpec[] {
  const byDomain = new Map<string, ActDef[]>();
  for (const a of acts) {
    const key = a.domain ?? OTHER;
    const list = byDomain.get(key);
    if (list) list.push(a); else byDomain.set(key, [a]);
  }

  const root: MenuSpec = { id: ROOT, title: opts.title ?? 'Home', acts: [], menus: [] };
  const out: MenuSpec[] = [root];

  for (const [domain, group] of byDomain) {
    const sorted = [...group].sort((a, b) => a.name.localeCompare(b.name));
    // One act is not a menu. The devkit says this of a brief; it is true of a
    // running app for the same reason, so the act sits at the top instead.
    if (sorted.length === 1) { root.acts.push(sorted[0]!.name); continue; }
    const id = domain;
    root.menus.push(id);
    out.push({ id, title: opts.names?.[domain] ?? title(domain), acts: sorted.map((a) => a.name), menus: [] });
  }

  root.acts.sort((a, b) => a.localeCompare(b));
  root.menus.sort((a, b) => a.localeCompare(b));
  // The menus themselves are sorted too, not just the names inside them: built
  // from a map keyed by domain, the list came back in whatever order the acts
  // happened to be declared, so the same app gave two different answers.
  return [root, ...out.slice(1).sort((a, b) => a.id.localeCompare(b.id))];
}

/** Acts no menu reaches. Empty is the only acceptable answer; a test holds it. */
export function everyActReachable(specs: readonly MenuSpec[], acts: readonly ActDef[]): string[] {
  const seen = new Set<string>();
  const byId = new Map(specs.map((s) => [s.id, s]));
  const walk = (id: string, guard: Set<string>) => {
    if (guard.has(id)) return; // a menu cannot be its own ancestor
    guard.add(id);
    const spec = byId.get(id);
    if (!spec) return;
    for (const a of spec.acts) seen.add(a);
    for (const m of spec.menus) walk(m, guard);
  };
  walk(ROOT, new Set());
  return acts.map((a) => a.name).filter((n) => !seen.has(n));
}

// ------------------------------------------------------------- the navigation

export type MenusOptions = GenerateOptions & {
  /** Structure written by hand. Left out, it is generated from the acts. */
  specs?: MenuSpec[];
};

export class Menus {
  private readonly specs: Map<string, MenuSpec>;
  private readonly acts: Map<string, ActDef>;
  private path: string[] = [ROOT];
  private spotlitActs = new Set<string>();
  private notes = new Map<string, string>();
  private menuNote: string | null = null;

  constructor(acts: readonly ActDef[], opts: MenusOptions = {}) {
    this.acts = new Map(acts.map((a) => [a.name, a]));
    const specs = opts.specs ?? menusFromActs(acts, opts);
    this.specs = new Map(specs.map((s) => [s.id, s]));
  }

  /** Every menu, as generated or as given. */
  get structure(): MenuSpec[] { return [...this.specs.values()]; }

  get here(): string { return this.path[this.path.length - 1]!; }

  view(): MenuView {
    const spec = this.specs.get(this.here);
    const trail = this.path.slice(0, -1).map((id) => ({ id, title: this.specs.get(id)?.title ?? title(id) }));
    if (!spec) return { id: this.here, title: title(this.here), trail, items: [], note: this.menuNote, atRoot: this.path.length === 1 };

    const items: MenuItem[] = [
      ...spec.menus.map((id): MenuItem => {
        const child = this.specs.get(id);
        return {
          kind: 'menu', id, label: child?.title ?? title(id), domain: id, radius: null,
          count: child ? child.acts.length : 0, note: this.notes.get(id) ?? null,
          spotlit: child ? child.acts.some((a) => this.spotlitActs.has(a)) : false,
        };
      }),
      ...spec.acts.flatMap((name): MenuItem[] => {
        const act = this.acts.get(name);
        if (!act) return []; // an act that left the app leaves the menu with it
        return [{
          kind: 'act', id: name, label: title(name), domain: act.domain ?? null,
          radius: declaredRadius(act), count: 0, note: this.notes.get(name) ?? null,
          spotlit: this.spotlitActs.has(name),
        }];
      }),
    ];

    // Raised items rise; nothing is ever removed, and the order below them holds.
    const ordered = [...items.filter((i) => i.spotlit), ...items.filter((i) => !i.spotlit)];
    return { id: spec.id, title: spec.title, trail, items: ordered, note: this.menuNote, atRoot: this.path.length === 1 };
  }

  /** Move into a menu. Writes nothing. */
  open(id: string): boolean {
    if (!this.specs.has(id) || this.path.includes(id)) return false;
    this.path.push(id);
    this.menuNote = null;
    return true;
  }

  back(): boolean {
    if (this.path.length === 1) return false;
    this.path.pop();
    this.menuNote = null;
    return true;
  }

  home(): void { this.path = [ROOT]; this.menuNote = null; }

  /** What the person picked. Starting an act is the host's, through the contract. */
  choose(id: string): Chosen {
    if (this.specs.has(id)) { this.open(id); return { kind: 'menu', menu: id }; }
    if (this.acts.has(id)) return { kind: 'act', act: id };
    return { kind: 'unknown', id };
  }

  /** Every act, wherever it sits, for a person searching rather than walking. */
  find(query: string): MenuItem[] {
    const q = humanise(query);
    if (!q) return [];
    const words = q.split(/\s+/);
    return [...this.acts.values()]
      .filter((a) => {
        const hay = `${humanise(a.name)} ${a.domain ?? ''} ${(a.phrases ?? []).join(' ')}`;
        return words.every((w) => hay.includes(w));
      })
      .map((a): MenuItem => ({
        kind: 'act', id: a.name, label: title(a.name), domain: a.domain ?? null,
        radius: declaredRadius(a), count: 0, note: this.notes.get(a.name) ?? null,
        spotlit: this.spotlitActs.has(a.name),
      }));
  }

  // --------------------------------------------------------- what the AI may do

  /**
   * Raise these, and say why. The only control the AI has over a menu.
   * There is deliberately no counterpart that lowers or removes anything.
   */
  spotlight(acts: readonly string[], why?: string): void {
    this.spotlitActs = new Set(acts.filter((a) => this.acts.has(a)));
    if (why !== undefined) this.menuNote = why;
  }

  /** A line against one item. Replaces any line already there; never hides it. */
  annotate(id: string, note: string): void {
    if (this.acts.has(id) || this.specs.has(id)) this.notes.set(id, note);
  }

  /** One line about the menu now open. */
  say(note: string | null): void { this.menuNote = note; }

  /** Drop every annotation and every raised item. */
  clear(): void { this.spotlitActs.clear(); this.notes.clear(); this.menuNote = null; }
}
