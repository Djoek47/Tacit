/**
 * @intermenu/sdk — the front door.
 *
 * Everything under it is separable on purpose: a host can take the core alone,
 * or the language alone, or the bridge alone. This is the other end of that —
 * one call, for the developer who wants the whole thing and does not want to
 * learn how the pieces fit before seeing it work.
 *
 *   import { mount } from '@intermenu/sdk';
 *
 *   const ui = mount({ el: '#app', functions: myFunctions });
 *   ui.hear('add milk and eggs');
 *
 * Four doors in, and they compose — an app with an API document and a few
 * local functions passes both:
 *
 *   acts        already written with defineAct
 *   functions   the project's own functions
 *   openapi     the backend's own document
 *   connections MCP servers, already approved
 *
 * All four end at `ActDef`, so the contract downstream is the same code for
 * all of them, and none of them can talk their way into a cheaper commit.
 *
 * What this does NOT do is decide anything. `mount` wires a menu to a stage
 * and events to a contract. Whether something happens is still the hold, the
 * blast radius, the attention gate and the person's yes.
 */

import type { ActDef, Clock, Ctx, Option } from '@intermenu/aiuic-core';
import { defineStageElement, type ElementOptions, type EuiStageElement } from '@intermenu/aiuic-eui';
import { createApp, type App } from '@intermenu/aiuic-kit';
import type { Menus, MenusOptions } from '@intermenu/aiuic-menu';
import { fromFunctions, fromOpenAPI, type FunctionSpec, type HttpCall, type OpenAPIDoc } from '@intermenu/aiuic-adapters';
import type { Source } from '@intermenu/aiuic-pyramid';

export type Sources = {
  acts?: ActDef[];
  functions?: FunctionSpec[];
  openapi?: { doc: OpenAPIDoc; call: HttpCall };
  /** Already-approved MCP connections. Approval is the person's, upstream. */
  connections?: { acts: ActDef[]; sources?: Source[] }[];
};

export type MountOptions = Sources & {
  /**
   * Where to draw: an element, or a selector to find one. Left out, nothing is
   * drawn and the app is still whole — which is how a test, a server or a
   * voice-only host uses this.
   */
  el?: unknown;
  ctx?: () => Omit<Ctx, 'now'> & { now?: Date };
  clock?: Clock;
  menus?: MenusOptions;
  element?: ElementOptions;
  /** The person's own accent. Never painted over a domain colour. */
  accent?: string;
  catalogs?: Record<string, () => Option[]>;
  /** Called after every redraw, for a host that wants to react. */
  onDraw?: (app: App) => void;
};

export type Mounted = {
  app: App;
  menus: Menus;
  /** Read-only sources the aggregator may use. Reads; never writes. */
  sources: Source[];
  /** Say something, as the person. */
  hear: App['hear'];
  /** Put an act on the stage from the menu, empty, waiting. */
  pick: App['pick'];
  /** Redraw the menu and the stage. Called for you on every change. */
  draw(): void;
  /** Stop listening to the element. The app itself is untouched. */
  destroy(): void;
};

/** Attention nobody has described yet: present, and not pretending otherwise. */
const DEFAULT_CTX = () => ({
  actor: { id: 'me', basePauseMs: 850 },
  attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
  reachLimit: 1,
  undoWindowMs: 5000,
});

/** Everything the four doors add up to, before anything is drawn. */
export function collect(s: Sources, catalogs?: Record<string, () => Option[]>): { acts: ActDef[]; sources: Source[]; problems: string[] } {
  const acts: ActDef[] = [...(s.acts ?? [])];
  const sources: Source[] = [];
  const problems: string[] = [];

  if (s.functions?.length) acts.push(...fromFunctions(s.functions, catalogs ? { catalogs } : {}));
  if (s.openapi) {
    const r = fromOpenAPI(s.openapi.doc, { call: s.openapi.call, ...(catalogs ? { catalogs } : {}) });
    acts.push(...r.acts);
    sources.push(...r.sources);
    problems.push(...r.problems);
  }
  for (const c of s.connections ?? []) {
    acts.push(...c.acts);
    sources.push(...(c.sources ?? []));
  }

  // Two acts with one name is the person being asked to agree to something
  // ambiguous, so it is a problem said out loud rather than a silent last-wins.
  const seen = new Set<string>();
  const kept: ActDef[] = [];
  for (const a of acts) {
    if (seen.has(a.name)) { problems.push(`two acts are called "${a.name}"; the second was left out`); continue; }
    seen.add(a.name);
    kept.push(a);
  }
  return { acts: kept, sources, problems };
}

function resolveElement(el: unknown): (EuiStageElement & { addEventListener(t: string, fn: (e: unknown) => void): void; removeEventListener(t: string, fn: (e: unknown) => void): void }) | null {
  if (!el) return null;
  const g = globalThis as unknown as { document?: { querySelector(s: string): unknown } };
  const found = typeof el === 'string' ? g.document?.querySelector(el) : el;
  if (!found || typeof (found as { showMenu?: unknown }).showMenu !== 'function') return null;
  return found as never;
}

export function mount(opts: MountOptions): Mounted {
  const { acts, sources, problems } = collect(opts, opts.catalogs);
  const app = createApp({
    acts,
    ctx: opts.ctx ?? DEFAULT_CTX,
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.menus ? { menus: opts.menus } : {}),
    ...(opts.catalogs ? { optionsFor: (act, slot) => opts.catalogs?.[`${act.name}.${slot}`]?.() ?? [] } : {}),
  });

  // Registering is safe to attempt anywhere: on a server it simply answers no.
  defineStageElement({ ...(opts.element ?? {}), ...(opts.accent ? { accent: opts.accent } : {}) });
  const el = resolveElement(opts.el);

  const draw = () => {
    el?.showMenu(app.menus.view());
    const v = app.view();
    if (v) el?.showStage(v);
    opts.onDraw?.(app);
  };

  const listeners: [string, (e: unknown) => void][] = [];
  if (el) {
    app.mount(el.presenter);
    const on = (type: string, fn: (detail: Record<string, unknown>) => void) => {
      const wrapped = (e: unknown) => { fn(((e as { detail?: Record<string, unknown> }).detail) ?? {}); draw(); };
      el.addEventListener(type, wrapped);
      listeners.push([type, wrapped]);
    };
    on('eui-choose', (d) => {
      const chosen = app.menus.choose(String(d.id));
      // A menu opens. An act goes to the stage empty and waits: picking a name
      // off a list is not consent to what the act does.
      if (chosen.kind === 'act') app.pick(chosen.act);
    });
    on('eui-back', () => { app.menus.back(); });
    draw();
  }

  for (const p of problems) {
    const warn = (globalThis as { console?: { warn(...a: unknown[]): void } }).console;
    warn?.warn(`[intermenu] ${p}`);
  }

  return {
    app,
    menus: app.menus,
    sources,
    hear: (text, o) => { const r = app.hear(text, o); draw(); return r; },
    pick: (name) => { const r = app.pick(name); draw(); return r; },
    draw,
    destroy() {
      for (const [type, fn] of listeners) el?.removeEventListener(type, fn);
      listeners.length = 0;
    },
  };
}

export { collect as sourcesOf };
export type { App, FunctionSpec, HttpCall, OpenAPIDoc };
