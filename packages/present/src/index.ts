/**
 * The presenter boundary. Spec v0.3 §10.
 *
 * "Renderer-agnostic" was a claim with nothing holding it up: every app read
 * `run.state()` and rendered by hand, which meant each one re-derived the same
 * things — what a slot's options are, how a value reads as text, which controls
 * are live, what sentence the user is actually agreeing to.
 *
 * `toView()` does that once. What comes out is everything a renderer needs and
 * nothing it has to work out, so a presenter is a small function over data
 * rather than a second copy of the rules. Two of them ship here: one that draws
 * text and one that drives the DOM. If a rule ever has to be restated inside a
 * presenter, the boundary is in the wrong place.
 */

import type {
  ActRun,
  AssentChannel,
  Ctx,
  Option,
  Phase,
  PrimitiveName,
  Radius,
  ActStatus,
  SlotSource,
} from '@intermenu/aiuic-core';
import { slotOrder } from '@intermenu/aiuic-core';

export type OptionsFor = (run: ActRun, slot: string) => Option[];

export type SlotView = {
  name: string;
  primitive: PrimitiveName;
  /** What to call it on screen. The slot's own name, humanised. */
  label: string;
  status: 'empty' | 'narrowed' | 'filled';
  value?: unknown;
  /** The value as a person reads it — the word they said, never a timestamp. */
  display: string;
  /**
   * Where the value came from. Renderers draw this: a slot the person spoke is
   * settled and never re-asked, a default is a suggestion, and a model fill is
   * a guess that a spoken value outranks. Dropping it here forced every host to
   * ask the run directly, which is the boundary leaking.
   */
  source: SlotSource | null;
  provisional: boolean;
  stale: boolean;
  required: boolean;
  focused: boolean;
  /** Empty when the slot takes free input rather than a choice. */
  options: Option[];
  /** Live only when narrowed: what it is deciding between. */
  candidates: Array<{ value: unknown; display: string; score: number }>;
};

export type StageView = {
  act: string | null;
  /** The act's `domain` tag, passed through untouched. */
  domain: string | null;
  status: ActStatus | 'idle';
  phase: Phase;
  radius: Radius | null;
  assent: AssentChannel | null;
  holdRemainingMs: number | null;
  holdTotalMs: number | null;
  slots: SlotView[];
  /** One line naming what is about to happen. This is what consent is given to. */
  preview: string;
  /** Present only when silence is unavailable and the user should know why. */
  gateFailures: string[];
  canAssent: boolean;
  canUndo: boolean;
  canResume: boolean;
};

export type Handlers = {
  touch(slot: string, value: unknown): void;
  assent(): void;
  discard(): void;
  undo(): void;
  freeze(): void;
  resume(): void;
};

export interface Presenter {
  mount?(handlers: Handlers): void;
  render(view: StageView): void;
  unmount?(): void;
}

// ------------------------------------------------------------------- shaping

const humanise = (s: string) => s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** How a value reads. Objects with a label use it; that is the whole contract. */
export function display(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.label === 'string') return o.label;
    if (typeof o.name === 'string') return o.name;
    return JSON.stringify(v);
  }
  return String(v);
}

export const IDLE_VIEW: StageView = {
  act: null, domain: null, status: 'idle', phase: 'idle', radius: null, assent: null,
  holdRemainingMs: null, holdTotalMs: null, slots: [], preview: '',
  gateFailures: [], canAssent: false, canUndo: false, canResume: false,
};

export function toView(run: ActRun | null, optionsFor: OptionsFor, _ctx?: Ctx): StageView {
  if (!run) return { ...IDLE_VIEW };
  const s = run.state();
  const def = run.def;

  const slots: SlotView[] = slotOrder(def).map((name) => {
    const sd = def.slots[name]!;
    const st = s.slots[name]!;
    return {
      name,
      primitive: sd.primitive,
      label: humanise(name),
      status: st.status,
      ...(st.value !== undefined ? { value: st.value } : {}),
      display: st.status === 'filled' ? display(st.value) : '',
      source: st.source ?? null,
      provisional: st.provisional,
      stale: st.stale === true,
      required: sd.required === true,
      focused: s.focus === name,
      options: optionsFor(run, name),
      candidates: (st.candidates ?? []).map((c) => ({
        value: c.value, display: c.label ?? display(c.value), score: c.score,
      })),
    };
  });

  return {
    act: def.name,
    domain: def.domain ?? null,
    status: s.status,
    phase: s.phase,
    radius: s.radius,
    assent: s.assent,
    holdRemainingMs: s.status === 'hold' ? Math.round(s.holdRemainingMs ?? 0) : null,
    holdTotalMs: s.status === 'hold' ? run.holdDurationMsValue : null,
    slots,
    preview: previewLine(run, slots),
    gateFailures: s.gateFailures ?? [],
    canAssent: s.status === 'explicit' || s.status === 'frozen',
    canUndo: run.undoAvailable,
    canResume: s.status === 'frozen',
  };
}

/**
 * What the user is agreeing to, as one line. A host `preview()` wins; otherwise
 * the filled slots in declared order, which is honest but rarely as good — a
 * row of chips does not say "$12 to 214 people".
 */
export function previewLine(run: ActRun, slots: SlotView[]): string {
  const def = run.def;
  if (def.preview) {
    try {
      const parts = def.preview(run.filled, {} as Ctx);
      const text = parts.map((p) => (typeof p === 'string' ? p : display(p))).filter(Boolean).join(' · ');
      if (text) return text;
    } catch {
      // A host preview that throws must not take the stage down with it.
    }
  }
  const filled = slots.filter((s) => s.status === 'filled' && s.display);
  if (filled.length === 0) return humanise(def.name);
  return humanise(def.name) + ': ' + filled.map((s) => s.display).join(' · ');
}

// -------------------------------------------------------------- text output

/**
 * A presenter that draws with words. Useful in a terminal, in a test, and as
 * the reference a real renderer is checked against.
 */
export class TextPresenter implements Presenter {
  last = '';

  constructor(private readonly write: (s: string) => void = () => {}) {}

  render(v: StageView): void {
    this.last = TextPresenter.format(v);
    this.write(this.last);
  }

  static format(v: StageView): string {
    if (!v.act) return '(idle)';
    const lines: string[] = [];
    lines.push(`${v.act}  [${v.status}${v.radius ? ' · ' + v.radius : ''}]`);
    lines.push(v.preview);

    for (const s of v.slots) {
      const mark = s.status === 'filled' ? (s.provisional ? '?' : '*') : s.status === 'narrowed' ? '~' : ' ';
      const body =
        s.status === 'filled' ? s.display
        : s.status === 'narrowed' ? s.candidates.map((c) => c.display).join(' | ')
        : s.options.length ? s.options.map((o) => o.label).join(' | ')
        : '—';
      const flags = [s.required ? '' : 'optional', s.stale ? 'stale' : ''].filter(Boolean).join(', ');
      lines.push(`  ${mark} ${s.label}: ${body}${flags ? '   (' + flags + ')' : ''}`);
    }

    if (v.holdRemainingMs !== null) lines.push(`  hold ${v.holdRemainingMs}/${v.holdTotalMs}ms — silence commits`);
    if (v.status === 'explicit') {
      lines.push(v.radius === 'external'
        ? '  needs an explicit yes — this cannot be taken back'
        : '  needs an explicit yes — ' + v.gateFailures.join('; '));
    }
    if (v.canUndo) lines.push('  undo is live');
    return lines.join('\n');
  }
}

// --------------------------------------------------------------- DOM output

type El = {
  textContent: string | null;
  className: string;
  appendChild(c: El): void;
  addEventListener(t: string, fn: () => void): void;
  replaceChildren(): void;
};
type Doc = { createElement(tag: string): El };

/**
 * A generic DOM renderer over the same view. Deliberately unstyled: it proves
 * the boundary holds, and a host replaces it with something that looks like
 * their product.
 */
export class DomPresenter implements Presenter {
  private handlers: Handlers | null = null;

  constructor(private readonly root: El, private readonly doc: Doc) {}

  mount(handlers: Handlers): void {
    this.handlers = handlers;
  }

  render(v: StageView): void {
    const d = this.doc;
    this.root.replaceChildren();
    if (!v.act) return;

    const head = d.createElement('div');
    head.className = 'aiuic-head';
    head.textContent = v.preview;
    this.root.appendChild(head);

    for (const s of v.slots) {
      const row = d.createElement('div');
      row.className = ['aiuic-slot', `aiuic-${s.primitive}`, s.status,
        s.provisional ? 'provisional' : '', s.stale ? 'stale' : '',
        s.focused ? 'focused' : ''].filter(Boolean).join(' ');

      const label = d.createElement('span');
      label.className = 'aiuic-label';
      label.textContent = s.label;
      row.appendChild(label);

      if (s.status === 'filled') {
        const val = d.createElement('span');
        val.className = 'aiuic-value';
        val.textContent = s.display;
        row.appendChild(val);
      }

      const choices = s.status === 'narrowed' && s.candidates.length
        ? s.candidates.map((c) => ({ value: c.value, label: c.display }))
        : s.options;
      for (const o of choices) {
        const b = d.createElement('button');
        b.className = 'aiuic-option';
        b.textContent = o.label;
        b.addEventListener('click', () => this.handlers?.touch(s.name, o.value));
        row.appendChild(b);
      }
      this.root.appendChild(row);
    }

    if (v.status === 'hold') {
      const ring = d.createElement('div');
      ring.className = 'aiuic-hold';
      ring.textContent = String(v.holdRemainingMs);
      this.root.appendChild(ring);
    }

    if (v.canAssent) {
      const yes = d.createElement('button');
      yes.className = 'aiuic-assent';
      yes.textContent = 'Yes';
      yes.addEventListener('click', () => this.handlers?.assent());
      this.root.appendChild(yes);

      const no = d.createElement('button');
      no.className = 'aiuic-cancel';
      no.textContent = 'Cancel';
      no.addEventListener('click', () => this.handlers?.discard());
      this.root.appendChild(no);
    }

    if (v.canUndo) {
      const u = d.createElement('button');
      u.className = 'aiuic-undo';
      u.textContent = 'Undo';
      u.addEventListener('click', () => this.handlers?.undo());
      this.root.appendChild(u);
    }
  }

  unmount(): void {
    this.root.replaceChildren();
    this.handlers = null;
  }
}

/** Drive one or more presenters from a live act, with the handlers wired. */
export function attachPresenters(
  run: ActRun,
  presenters: Presenter[],
  optionsFor: OptionsFor,
): { update: () => void; handlers: Handlers } {
  const update = () => {
    const view = toView(run, optionsFor);
    for (const p of presenters) p.render(view);
  };
  const handlers: Handlers = {
    touch: (slot, value) => { run.setValue(slot, value, 'touched'); update(); },
    assent: () => { void run.assent().then(update); },
    discard: () => { run.discard(); update(); },
    undo: () => { void run.undo().then(update); },
    freeze: () => { run.freeze('presenter'); update(); },
    resume: () => { run.resume(); update(); },
  };
  for (const p of presenters) p.mount?.(handlers);
  update();
  return { update, handlers };
}
