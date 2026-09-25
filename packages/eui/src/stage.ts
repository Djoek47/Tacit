/**
 * The stage: one card, drawn in the visual language.
 *
 * This is a `Presenter` like the two in aiuic-present, so it goes through the
 * same `toView()` and restates no rule. What it adds is the language — the
 * kicker, the row tints, the ring, the mark, the seven beats — and, more
 * usefully, the ALWAYS and NEVER lists held as structure rather than as advice:
 *
 *   one card at a time      → `render` replaces the root's children; there is
 *                             no path that appends a second card
 *   their words above it    → `said` is drawn outside the card, always
 *   a way out in every state→ `wayOut()` is unconditional, and its absence
 *                             fails a test
 *   the count before it     → the count is drawn during HOLD, not after SETTLE
 *   a card never contains a card → rows are rows; nothing here makes a card
 *
 * Board 13's NEVER list is the interesting half. Four of the five are things a
 * renderer does by reaching for a component it should not have; the fifth — a
 * personal accent repainting a domain — is a colour decision, and that is why
 * the only way to get a colour out of this package is `resolveColours`, which
 * takes the accent and hands back the domain colour untouched.
 */

import type { Handlers, Presenter, StageView } from '@intermenu/aiuic-present';
import { beatOf, skipsShow, type Beat } from './beats.js';
import { DOMAINS, lookupDomain, resolveColours, type CustomDomains, type DomainDef, type DomainName } from './domain.js';
import { DOMAIN_COLOUR } from './tokens.js';

export type El = {
  textContent: string | null;
  className: string;
  appendChild(c: El): void;
  addEventListener(t: string, fn: () => void): void;
  replaceChildren(): void;
  setAttribute(k: string, v: string): void;
  style?: Record<string, string> & { setProperty?(k: string, v: string): void };
};
export type Doc = { createElement(tag: string): El };

export type StageOptions = {
  /** The person's accent pack. Drawn on their own chrome; never on a domain. */
  accent?: string;
  /** Acts waiting behind this one. Board 10, beat 6. */
  queued?: () => number;
  /** What they actually said. Board 13, ALWAYS: "Their words above it." */
  said?: () => string;
  /** Domains the app declares in its shape. Built-in names cannot be overridden. */
  domains?: CustomDomains;
};

export class StagePresenter implements Presenter {
  private handlers: Handlers | null = null;
  /** The last beat drawn. Exposed so a host can drive haptics off it. */
  lastBeat: Beat | null = null;

  constructor(
    private readonly root: El,
    private readonly doc: Doc,
    private readonly opts: StageOptions = {},
  ) {}

  mount(handlers: Handlers): void {
    this.handlers = handlers;
  }

  render(v: StageView): void {
    const d = this.doc;
    // One card at a time, structurally: the stage is replaced, never appended to.
    this.root.replaceChildren();
    this.root.className = 'eui-stage';
    if (!v.act) {
      this.lastBeat = null;
      return;
    }

    const domain = lookupDomain(v.domain, this.opts.domains);
    const colours = resolveColours(domain, this.opts.accent);
    const beat = beatOf(v, { queued: this.opts.queued?.() ?? 0, domain });
    this.lastBeat = beat;

    const said = this.opts.said?.();
    if (said) {
      const line = d.createElement('div');
      line.className = 'eui-said';
      line.textContent = `“${said}”`;
      this.root.appendChild(line);
    }

    const card = d.createElement('div');
    card.className = 'eui-card';
    card.setAttribute('data-beat', beat ?? '');
    card.setAttribute('data-domain', domain?.name ?? 'neutral');
    card.setAttribute('data-at-rest', String(beat === 'show' && skipsShow(v)));
    this.setVar(card, '--eui-domain', colours.domain);
    this.root.appendChild(card);

    if (domain) {
      const kicker = d.createElement('div');
      kicker.className = 'eui-kicker';
      kicker.textContent = domain.kicker;
      card.appendChild(kicker);
    }

    const head = d.createElement('div');
    head.className = 'eui-headline';
    head.textContent = v.preview;
    card.appendChild(head);

    if (beat === 'coach') {
      this.renderCoach(card, domain);
    } else {
      for (const s of v.slots) this.renderRow(card, s, v);
    }

    // "The count before it happens." During the hold, while it can still be
    // stopped — not on the mark, where it is a receipt.
    if (v.status === 'hold') {
      const rows = v.slots.filter((s) => s.status === 'filled').length;
      const count = d.createElement('div');
      count.className = 'eui-count';
      count.textContent = rows > 1
        ? `One hold for all ${rows} · tap × to drop one`
        : 'Quiet adds it · speak or tap to change';
      card.appendChild(count);

      const ring = d.createElement('div');
      ring.className = 'eui-ring';
      const left = v.holdRemainingMs ?? 0;
      const total = v.holdTotalMs || 1;
      this.setVar(ring, 'width', `${Math.max(0, Math.min(100, (left / total) * 100))}%`);
      card.appendChild(ring);
    }

    if (v.status === 'explicit') {
      const why = d.createElement('div');
      why.className = 'eui-explicit';
      why.textContent = v.radius === 'external'
        ? 'This one needs a yes — it cannot be taken back'
        : `This one needs a yes — ${v.gateFailures.join('; ')}`;
      card.appendChild(why);

      const yes = d.createElement('button');
      yes.className = 'eui-chip';
      yes.textContent = 'Do it';
      yes.addEventListener('click', () => this.handlers?.assent());
      card.appendChild(yes);
    }

    // Board 08's rule, held here: never a failure line on a turn where the
    // stage shows a success. `settled` draws the mark and nothing else.
    if (v.status === 'settled') {
      const mark = d.createElement('div');
      mark.className = 'eui-mark';
      mark.textContent = 'Added';
      card.appendChild(mark);
    }
    if (v.status === 'failed') {
      const fail = d.createElement('div');
      fail.className = 'eui-explicit';
      fail.textContent = "That didn't save. Everything else did.";
      card.appendChild(fail);
    }

    if ((this.opts.queued?.() ?? 0) > 0) {
      const next = d.createElement('div');
      next.className = 'eui-row eui-chained';
      next.textContent = `${this.opts.queued!()} more waiting`;
      this.root.appendChild(next);
    }

    this.wayOut(v);
  }

  /** Board 13, ALWAYS: "A way out in every state." No condition guards this. */
  private wayOut(v: StageView): void {
    const out = this.doc.createElement('button');
    out.className = 'eui-out';
    const undoable = v.canUndo;
    out.textContent = undoable ? 'Undo' : v.status === 'settled' ? 'Done' : 'Not that';
    out.addEventListener('click', () => {
      if (undoable) this.handlers?.undo();
      else this.handlers?.discard();
    });
    this.root.appendChild(out);
  }

  private renderRow(card: El, s: StageView['slots'][number], v: StageView): void {
    const d = this.doc;
    const row = d.createElement('div');
    row.className = 'eui-row';
    row.setAttribute('data-state', s.status);
    row.setAttribute('data-source', s.source ?? '');
    row.setAttribute('data-focused', String(s.focused));
    row.setAttribute('data-provisional', String(s.provisional));

    const label = d.createElement('span');
    label.className = 'eui-detail';
    label.textContent = s.label;

    if (s.status === 'filled') {
      const val = d.createElement('span');
      val.textContent = s.display;
      row.appendChild(val);
      row.appendChild(label);
      // A row's × is a 44px target like everything else. Board 09: "tap × to
      // drop one" — one row, not the whole card.
      if (v.status === 'hold' || v.status === 'resolving') {
        const drop = d.createElement('button');
        drop.className = 'eui-drop';
        drop.textContent = '×';
        drop.addEventListener('click', () => this.handlers?.touch(s.name, undefined));
        row.appendChild(drop);
      }
    } else if (s.status === 'narrowed') {
      // Beat 2. Two readings, never a list — and if a resolver ever hands back
      // more, the card shows the two it is actually deciding between.
      row.appendChild(label);
      for (const c of s.candidates.slice(0, 2)) {
        const chip = d.createElement('button');
        chip.className = 'eui-chip';
        chip.textContent = c.display;
        chip.addEventListener('click', () => this.handlers?.touch(s.name, c.value));
        row.appendChild(chip);
      }
    } else {
      row.appendChild(label);
      // "Still to come" stays dim and unlabelled until its turn, so the card
      // never looks like a form. Only the focused slot offers its chips.
      if (s.focused) {
        for (const o of s.options.slice(0, 4)) {
          const chip = d.createElement('button');
          chip.className = 'eui-chip';
          chip.textContent = o.label;
          chip.addEventListener('click', () => this.handlers?.touch(s.name, o.value));
          row.appendChild(chip);
        }
      }
    }

    card.appendChild(row);
  }

  /** Beat 7. It points at the real control instead of acting. Free. */
  private renderCoach(card: El, domain: DomainDef | null): void {
    const d = this.doc;
    const line = d.createElement('div');
    line.className = 'eui-detail';
    line.textContent = domain
      ? `${domain.does} — ${domain.shape}`
      : 'Walking you there.';
    card.appendChild(line);

    for (const label of ['Walk me through it', 'Just do it']) {
      const b = d.createElement('button');
      b.className = 'eui-chip';
      b.textContent = label;
      b.addEventListener('click', () => this.handlers?.assent());
      card.appendChild(b);
    }
  }

  private setVar(el: El, k: string, v: string): void {
    if (!el.style) return;
    if (k.startsWith('--') && el.style.setProperty) el.style.setProperty(k, v);
    else el.style[k] = v;
  }

  unmount(): void {
    this.root.replaceChildren();
    this.handlers = null;
  }
}

/** The colour a domain owns, for a host drawing something this package does not. */
export function domainColour(name: DomainName | null | undefined): string {
  const def = name ? DOMAINS[name] : null;
  return def ? DOMAIN_COLOUR[def.colour] : DOMAIN_COLOUR.neutral;
}
