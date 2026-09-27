/**
 * One element, so the language works wherever the app is written.
 *
 * `<eui-stage>` is a custom element, which React, Vue, Svelte, Angular, Astro
 * and a plain HTML file all already know how to place. That is the whole
 * reason for the choice: one renderer that every framework accepts beats four
 * bindings that each drift, and nobody has to wait for the binding for the
 * framework they picked.
 *
 * It puts its own stylesheet inside a shadow root, so the host's CSS cannot
 * reach in and break the language, and the language cannot reach out and
 * restyle the host's app. A design system that only looks right in its own
 * demo is not universal, and open styles are how that happens.
 *
 * Nothing here decides anything. The element draws a menu and a stage, and
 * emits what the person did; the contract upstream still owns the hold, the
 * blast radius and the yes. This package has no DOM dependency either — the
 * browser globals are read here, at the one edge that needs them, so the rest
 * of the language stays testable without a browser.
 */

import type { MenuView } from '@intermenu/aiuic-menu';
import type { Handlers, StageView } from '@intermenu/aiuic-present';
import { stylesheet } from './css.js';
import type { CustomDomains } from './domain.js';
import { MenuPresenter } from './menu.js';
import { StagePresenter, type Doc, type El } from './stage.js';

export const TAG = 'eui-stage';

/** Everything the element emits, and what rides along with it. */
export type EuiEvents = {
  'eui-choose': { id: string };
  'eui-back': Record<string, never>;
  'eui-touch': { slot: string; value: unknown };
  'eui-assent': Record<string, never>;
  'eui-discard': Record<string, never>;
  'eui-undo': Record<string, never>;
  'eui-freeze': Record<string, never>;
  'eui-resume': Record<string, never>;
};

/** What the element needs from a browser, and nothing more. */
type Browser = {
  HTMLElement: new () => {
    attachShadow(init: { mode: 'open' | 'closed' }): El & { appendChild(c: El): void };
    dispatchEvent(e: unknown): boolean;
    getAttribute(k: string): string | null;
  };
  customElements: { define(name: string, c: unknown): void; get(name: string): unknown };
  document: Doc & { createElement(tag: string): El & { textContent: string | null } };
  CustomEvent: new (type: string, init: { detail: unknown; bubbles: boolean; composed: boolean }) => unknown;
};

export type ElementOptions = {
  /** Register under another name, for two versions on one page. */
  tag?: string;
  accent?: string;
  domains?: CustomDomains;
};

/**
 * The element's own surface, for a host holding a reference to it. Every
 * framework can reach this: a ref in React, `this.$refs` in Vue, `bind:this`
 * in Svelte, a template reference in Angular.
 */
export type EuiStageElement = {
  showMenu(view: MenuView | null): void;
  showStage(view: StageView): void;
  /** The stage presenter, for a host that drives `toView` itself. */
  readonly presenter: { render(v: StageView): void; mount?(h: Handlers): void };
  setAccent(accent: string | null): void;
};

/**
 * Register `<eui-stage>`. Safe to call more than once, and safe to leave
 * unregistered: on a server there is no browser to register it with, and this
 * returns false instead of throwing.
 */
export function defineStageElement(opts: ElementOptions = {}): boolean {
  const g = globalThis as unknown as Partial<Browser>;
  if (!g.HTMLElement || !g.customElements || !g.document || !g.CustomEvent) return false;
  const tag = opts.tag ?? TAG;
  if (g.customElements.get(tag)) return true;

  const { HTMLElement, document, CustomEvent } = g as Browser;

  class EuiStage extends HTMLElement implements EuiStageElement {
    private readonly shadow = this.attachShadow({ mode: 'open' });
    private readonly menuRoot: El;
    private readonly stageRoot: El;
    private readonly menuPresenter: MenuPresenter;
    readonly presenter: StagePresenter;
    private accent: string | undefined = opts.accent;

    constructor() {
      super();
      const style = document.createElement('style');
      style.textContent = stylesheet();
      this.shadow.appendChild(style);

      this.menuRoot = document.createElement('div');
      this.stageRoot = document.createElement('div');
      this.shadow.appendChild(this.menuRoot);
      this.shadow.appendChild(this.stageRoot);

      const emit = <K extends keyof EuiEvents>(type: K, detail: EuiEvents[K]) => {
        // Composed, so a host outside the shadow root hears it at all.
        this.dispatchEvent(new CustomEvent(type as string, { detail, bubbles: true, composed: true }));
      };

      this.menuPresenter = new MenuPresenter(this.menuRoot, document, {
        ...(this.accent ? { accent: this.accent } : {}),
        ...(opts.domains ? { domains: opts.domains } : {}),
      });
      this.menuPresenter.mount({
        choose: (id) => emit('eui-choose', { id }),
        back: () => emit('eui-back', {}),
      });

      this.presenter = new StagePresenter(this.stageRoot, document, {
        ...(this.accent ? { accent: this.accent } : {}),
        ...(opts.domains ? { domains: opts.domains } : {}),
      });
      this.presenter.mount({
        touch: (slot, value) => emit('eui-touch', { slot, value }),
        assent: () => emit('eui-assent', {}),
        discard: () => emit('eui-discard', {}),
        undo: () => emit('eui-undo', {}),
        freeze: () => emit('eui-freeze', {}),
        resume: () => emit('eui-resume', {}),
      });
    }

    showMenu(view: MenuView | null): void {
      if (!view) { this.menuRoot.replaceChildren(); return; }
      this.menuPresenter.render(view);
    }

    showStage(view: StageView): void { this.presenter.render(view); }

    setAccent(accent: string | null): void { this.accent = accent ?? undefined; }
  }

  g.customElements.define(tag, EuiStage);
  return true;
}
