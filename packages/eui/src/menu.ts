/**
 * A menu, drawn in the visual language.
 *
 * The stage draws one act. This draws the way to one — and it is the same
 * language, so a person never crosses a seam: the same domain colour, the same
 * kicker, the same shape, the same minimum target. Two rules it holds as
 * structure rather than as advice:
 *
 *   what it costs is on the item      an act that touches somebody else or
 *                                     spends money says so before it is
 *                                     picked, not after the card opens
 *   the way out is always drawn       a menu below the root always has its
 *                                     way back, and a test fails without it
 *
 * It decides nothing. Picking an item emits it; whether an act then opens, and
 * what that costs, belongs to the contract and not to a list.
 */

import type { MenuItem, MenuView } from '@intermenu/aiuic-menu';
import { lookupDomain, resolveColours, type CustomDomains } from './domain.js';
import type { Doc, El } from './stage.js';

export type MenuOptions = {
  accent?: string;
  domains?: CustomDomains;
  /** What to say when a menu has nothing in it. */
  empty?: string;
};

/** What an act's cost is called where a person will read it. */
export const COST_WORD: Record<string, string> = {
  self: '',
  shared: 'shared',
  'other-person': 'someone else',
  external: 'asks first',
};

export class MenuPresenter {
  private onChoose: ((id: string) => void) | null = null;
  private onBack: (() => void) | null = null;

  constructor(
    private readonly root: El,
    private readonly doc: Doc,
    private readonly opts: MenuOptions = {},
  ) {}

  mount(h: { choose(id: string): void; back(): void }): void {
    this.onChoose = (id) => h.choose(id);
    this.onBack = () => h.back();
  }

  render(v: MenuView): void {
    const d = this.doc;
    this.root.replaceChildren();
    this.root.className = 'eui-menu';
    this.root.setAttribute('data-menu', v.id);

    if (!v.atRoot) {
      // The way out, drawn before anything else so it is never below the fold.
      const back = d.createElement('button');
      back.className = 'eui-back';
      back.setAttribute('type', 'button');
      back.textContent = `← ${v.trail[v.trail.length - 1]?.title ?? 'Back'}`;
      back.addEventListener('click', () => this.onBack?.());
      this.root.appendChild(back);
    }

    const head = d.createElement('div');
    head.className = 'eui-menu-title';
    head.textContent = v.title;
    this.root.appendChild(head);

    if (v.note) {
      const note = d.createElement('div');
      note.className = 'eui-menu-note';
      note.textContent = v.note;
      this.root.appendChild(note);
    }

    if (v.items.length === 0) {
      const none = d.createElement('div');
      none.className = 'eui-menu-empty';
      none.textContent = this.opts.empty ?? 'Nothing here yet.';
      this.root.appendChild(none);
      return;
    }

    const list = d.createElement('div');
    list.className = 'eui-items';
    this.root.appendChild(list);
    for (const item of v.items) list.appendChild(this.item(item));
  }

  private item(item: MenuItem): El {
    const d = this.doc;
    const domain = lookupDomain(item.domain, this.opts.domains);
    const colours = resolveColours(domain, this.opts.accent);

    const el = d.createElement('button');
    el.className = 'eui-item';
    el.setAttribute('type', 'button');
    el.setAttribute('data-kind', item.kind);
    el.setAttribute('data-domain', domain?.name ?? 'neutral');
    if (item.spotlit) el.setAttribute('data-spotlit', 'true');
    el.style?.setProperty?.('--eui-domain', colours.domain);

    const label = d.createElement('span');
    label.className = 'eui-item-label';
    label.textContent = item.label;
    el.appendChild(label);

    // What it costs to be wrong, before it is picked.
    const cost = item.radius ? COST_WORD[item.radius] ?? '' : '';
    if (cost) {
      const tag = d.createElement('span');
      tag.className = 'eui-item-cost';
      tag.setAttribute('data-radius', item.radius!);
      tag.textContent = cost;
      el.appendChild(tag);
    }

    if (item.kind === 'menu') {
      const count = d.createElement('span');
      count.className = 'eui-item-count';
      count.textContent = `${item.count}`;
      el.appendChild(count);
    }

    if (item.note) {
      const note = d.createElement('span');
      note.className = 'eui-item-note';
      note.textContent = item.note;
      el.appendChild(note);
    }

    el.setAttribute('aria-label', [item.label, cost, item.note].filter(Boolean).join(', '));
    el.addEventListener('click', () => this.onChoose?.(item.id));
    return el;
  }
}
