import { describe, expect, it } from 'vitest';
import { createAIUIC, defineAct, FakeClock, type ActDef, type ActRun, type Option } from '@intermenu/aiuic-core';
import { toView, attachPresenters } from '@intermenu/aiuic-present';
import {
  BUDGET_MS, BudgetMonitor, DOMAINS, DOMAIN_COLOUR, MIN_TARGET_PX, SPRING,
  StagePresenter, beatOf, domainColour, lintDomains, resolveColours, skipsShow,
  stylesheet, type DomainName,
} from '../src/index.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));

const SAM = { id: 'sam', label: 'Sam' };
const MAYA = { id: 'maya', label: 'Maya' };
const PEOPLE: Option[] = [{ value: SAM, label: 'Sam' }, { value: MAYA, label: 'Maya' }];
const CHORES: Option[] = [{ value: 'dishes', label: 'Dishes' }, { value: 'laundry', label: 'Laundry' }];
const ITEMS: Option[] = [{ value: 'milk', label: 'Milk' }, { value: 'jam', label: 'Jam' }];

const optionsFor = (_r: ActRun, slot: string) =>
  slot === 'assignee' ? PEOPLE : slot === 'chore' ? CHORES : slot === 'item' ? ITEMS : [];

function build(attention = { foreground: true, unlocked: true, proximityClear: true, listening: true }) {
  const clock = new FakeClock(T0);
  const ui = createAIUIC({
    clock,
    ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }),
  });
  ui.defineAct(defineAct({
    name: 'assign_chore',
    domain: 'chores',
    slots: {
      chore: { primitive: 'chip', options: () => CHORES, required: true, order: 1 },
      assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 2 },
    },
    radius: { max: 'other-person', of: () => 'other-person' },
    commit: () => ({ id: 'c1' }), undo: () => {},
    preview: () => ['Dishes for Maya'],
  }));
  ui.defineAct(defineAct({
    name: 'add_item',
    domain: 'groceries',
    slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
    radius: 'self',
    commit: () => ({ id: 'g1' }), undo: () => {},
  }));
  return { ui, clock, async advance(ms: number) { clock.advance(ms); await tick(); } };
}

/* A DOM stand-in with style support, since the card sets --eui-domain. */
type FakeEl = {
  tag: string; textContent: string | null; className: string;
  attrs: Record<string, string>; vars: Record<string, string>;
  children: FakeEl[]; listeners: Array<() => void>;
  appendChild(c: FakeEl): void;
  addEventListener(t: string, fn: () => void): void;
  replaceChildren(): void;
  setAttribute(k: string, v: string): void;
  style: Record<string, string> & { setProperty(k: string, v: string): void };
  click(): void;
  find(cls: string): FakeEl[];
  depth(cls: string, d?: number): number;
  text(): string;
};

function makeEl(tag: string): FakeEl {
  const vars: Record<string, string> = {};
  const style = Object.assign({} as Record<string, string>, {
    setProperty(k: string, v: string) { vars[k] = v; },
  });
  const node: FakeEl = {
    tag, textContent: null, className: '', attrs: {}, vars, style,
    children: [], listeners: [],
    appendChild(c) { node.children.push(c); },
    addEventListener(_t, fn) { node.listeners.push(fn); },
    replaceChildren() { node.children.length = 0; },
    setAttribute(k, v) { node.attrs[k] = v; },
    click() { for (const fn of node.listeners) fn(); },
    find(cls) {
      const hit: FakeEl[] = node.className.split(' ').includes(cls) ? [node] : [];
      for (const c of node.children) hit.push(...c.find(cls));
      return hit;
    },
    /** Deepest nesting of `cls` inside itself, anywhere in the subtree. */
    depth(cls, d = 0) {
      const here = node.className.split(' ').includes(cls) ? d + 1 : d;
      return node.children.reduce((m, c) => Math.max(m, c.depth(cls, here)), here);
    },
    text() { return [node.textContent ?? '', ...node.children.map((c) => c.text())].join(' ').trim(); },
  };
  return node;
}

const fakeDom = () => ({ root: makeEl('div'), doc: { createElement: makeEl } });

// ------------------------------------------------------------------ material

describe('the material', () => {
  it('has one mint, and the stylesheet emits that one', () => {
    expect(DOMAIN_COLOUR.mint).toBe('#76C4AE');
    const css = stylesheet();
    expect(css).toContain('--eui-mint: #76C4AE;');
    // Three domains share mint. A second literal anywhere would mean a fork.
    expect(css.split('#76C4AE').length - 1).toBe(1);
  });

  it('gives every domain a colour it does not choose for itself', () => {
    for (const name of Object.keys(DOMAINS) as DomainName[]) {
      expect(DOMAIN_COLOUR[DOMAINS[name].colour]).toMatch(/^#[0-9A-F]{6}$/i);
    }
    // Board 13: poppinsCyan is the assistant's tab and nothing else.
    const users = (Object.keys(DOMAINS) as DomainName[]).filter((d) => DOMAINS[d].colour === 'poppinsCyan');
    expect(users).toEqual([]);
  });

  it('keeps three springs and no fourth', () => {
    expect(Object.keys(SPRING)).toEqual(['snappy', 'smooth', 'settle']);
    expect(SPRING.snappy.approxMs).toBeLessThan(SPRING.smooth.approxMs);
    expect(SPRING.smooth.approxMs).toBeLessThan(SPRING.settle.approxMs);
  });

  it('keeps the timing under Reduce Motion and only drops the movement', () => {
    const css = stylesheet();
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).toContain('transition-property: opacity, background, color');
    // If it zeroed the durations it would be a different feel, not a calmer one.
    expect(block).not.toContain('transition-duration: 0');
    expect(block).not.toContain('0s');
  });
});

// -------------------------------------------------------------- domain rules

describe('domain rules', () => {
  const act = (over: Partial<ActDef> & { domain?: string }): ActDef =>
    defineAct({
      name: 'x', slots: { a: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
      radius: 'self', commit: () => ({ id: '1' }), undo: () => {}, ...over,
    } as ActDef);

  it('refuses a face on a grocery', () => {
    const errs = lintDomains([act({
      domain: 'groceries',
      slots: {
        item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 },
        who: { primitive: 'face', options: () => PEOPLE, required: true, order: 2 },
      },
    })]);
    expect(errs.some((e) => e.level === 'error' && /face/.test(e.message))).toBe(true);
  });

  it('refuses a silent hold on a payment', () => {
    const errs = lintDomains([act({ domain: 'allowance', radius: 'other-person' })]);
    expect(errs.some((e) => e.level === 'error' && /external/.test(e.message))).toBe(true);
    expect(lintDomains([act({ domain: 'allowance', radius: 'external' })]
      .map((a) => a)).filter((e) => e.level === 'error')).toEqual([]);
  });

  it("refuses a reward that settles without an adult", () => {
    const errs = lintDomains([act({ domain: 'rewards', radius: 'self' })]);
    expect(errs.some((e) => e.level === 'error' && /other-person/.test(e.message))).toBe(true);
  });

  it('refuses teaching that costs anything', () => {
    const errs = lintDomains([act({ domain: 'teaching', radius: 'other-person' })]);
    expect(errs.some((e) => e.level === 'error')).toBe(true);
  });

  it('refuses a domain nobody owns', () => {
    const errs = lintDomains([act({ domain: 'vibes' })]);
    expect(errs[0]!.level).toBe('error');
  });

  it('passes the acts the app actually ships', () => {
    const h = build();
    expect(lintDomains(h.ui.definitions).filter((e) => e.level === 'error')).toEqual([]);
  });
});

describe('an accent never repaints a domain', () => {
  it('hands back the domain colour untouched, whatever the person picked', () => {
    const plain = resolveColours('chores');
    const accented = resolveColours('chores', '#FF00AA');
    expect(accented.domain).toBe(plain.domain);
    expect(accented.domain).toBe(DOMAIN_COLOUR.mint);
    expect(accented.accent).toBe('#FF00AA');
  });

  it('paints the card with the domain even when an accent is set', () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc, { accent: '#FF00AA' });
    attachPresenters(run, [p], optionsFor);
    const card = root.find('eui-card')[0]!;
    expect(card.vars['--eui-domain']).toBe(DOMAIN_COLOUR.mint);
  });
});

// --------------------------------------------------------------- the beats

describe('the beats', () => {
  it('lands on SHOW, unfolds, holds, settles — in that order', async () => {
    const h = build();
    const run = h.ui.start('assign_chore');
    const seen: string[] = [];
    const push = () => { const b = beatOf(toView(run, optionsFor), { domain: DOMAINS.chores }); if (b && seen.at(-1) !== b) seen.push(b); };

    push();
    run.setValue('chore', 'dishes', 'spoken'); push();
    run.setValue('assignee', MAYA, 'spoken'); await tick(); push();
    await h.advance(1400); push();

    expect(seen).toEqual(['show', 'unfold', 'hold', 'settle']);
  });

  it('skips SHOW when the thing was already named by a tap', () => {
    const h = build();
    const run = h.ui.start('assign_chore');
    run.setValue('chore', 'dishes', 'touched');
    expect(skipsShow(toView(run, optionsFor))).toBe(true);

    const spoken = build().ui.start('assign_chore');
    spoken.setValue('chore', 'dishes', 'spoken');
    expect(skipsShow(toView(spoken, optionsFor))).toBe(false);
  });

  it('is COACH for a teaching act, whatever else is true of it', () => {
    const v = toView(build().ui.start('assign_chore'), optionsFor);
    expect(beatOf(v, { domain: DOMAINS.teaching })).toBe('coach');
  });

  it('draws the earlier beat when two are true', () => {
    const h = build();
    const run = h.ui.start('assign_chore');
    run.setValue('chore', 'dishes', 'spoken');
    // Queued work does not demote a card the person is in the middle of.
    expect(beatOf(toView(run, optionsFor), { queued: 3, domain: DOMAINS.chores })).toBe('unfold');
  });
});

describe('the budget', () => {
  it('fails when the card is late, not six months later in a review', () => {
    const clock = new FakeClock(T0);
    const m = new BudgetMonitor(clock);
    m.mark('heard');
    clock.advance(BUDGET_MS.show + 40);
    m.mark('shown');
    expect(m.ok).toBe(false);
    expect(m.report()).toContain('show');
  });

  it('passes a reflex-speed run end to end', () => {
    const clock = new FakeClock(T0);
    const m = new BudgetMonitor(clock);
    m.mark('heard'); clock.advance(110);
    m.mark('shown'); clock.advance(1200);
    m.mark('committed');
    m.mark('undoRequested'); clock.advance(400);
    m.mark('undone');
    expect(m.ok).toBe(true);
  });

  it('measures the current utterance, not the one before it', () => {
    const clock = new FakeClock(T0);
    const m = new BudgetMonitor(clock);
    m.mark('heard'); clock.advance(5000);
    m.reset();
    m.mark('heard'); clock.advance(90); m.mark('shown');
    expect(m.ok).toBe(true);
  });
});

// ------------------------------------------------------- ALWAYS and NEVER

describe('board 13 ALWAYS', () => {
  it('draws one card at a time, however many times it renders', () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc);
    const { update } = attachPresenters(run, [p], optionsFor);
    run.setValue('chore', 'dishes', 'spoken'); update();
    run.setValue('assignee', MAYA, 'spoken'); update();
    expect(root.find('eui-card').length).toBe(1);
  });

  it('puts their words above the card, not inside it', () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc, { said: () => 'dishes for Maya' });
    attachPresenters(run, [p], optionsFor);
    expect(root.find('eui-said').length).toBe(1);
    const card = root.find('eui-card')[0]!;
    expect(card.find('eui-said').length).toBe(0);
  });

  it('offers a way out in every state', async () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc);
    const { update } = attachPresenters(run, [p], optionsFor);

    const states: string[] = [];
    const check = () => {
      states.push(toView(run, optionsFor).status);
      expect(root.find('eui-out').length).toBeGreaterThan(0);
    };
    check();
    run.setValue('chore', 'dishes', 'spoken'); update(); check();
    run.setValue('assignee', MAYA, 'spoken'); await tick(); update(); check();
    await h.advance(1400); update(); check();

    expect(new Set(states).size).toBeGreaterThan(2);
  });

  it('shows the count before it happens, not after', async () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc);
    const { update } = attachPresenters(run, [p], optionsFor);
    run.setValue('chore', 'dishes', 'spoken');
    run.setValue('assignee', MAYA, 'spoken');
    await tick(); update();

    expect(root.find('eui-count').length).toBe(1);
    expect(root.find('eui-count')[0]!.text()).toContain('all 2');

    await h.advance(1400); update();
    expect(root.find('eui-count').length).toBe(0);
    expect(root.find('eui-mark').length).toBe(1);
  });

  it('keeps every target at 44px, the row × included', () => {
    expect(MIN_TARGET_PX).toBe(44);
    const css = stylesheet();
    expect(css).toContain('--eui-target-min: 44px;');
    for (const cls of ['.eui-row', '.eui-chip, .eui-drop', '.eui-out']) {
      const block = css.slice(css.indexOf(cls));
      expect(block.slice(0, 260)).toContain('min-height: var(--eui-target-min)');
    }
  });
});

describe('board 13 NEVER', () => {
  it('never nests a card in a card', async () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc, { queued: () => 2 });
    const { update } = attachPresenters(run, [p], optionsFor);
    run.setValue('chore', 'dishes', 'spoken');
    run.setValue('assignee', MAYA, 'spoken');
    await tick(); update();
    expect(root.depth('eui-card')).toBe(1);
  });

  it('draws the act waiting behind as a row, not a second card', async () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    attachPresenters(run, [new StagePresenter(root, doc, { queued: () => 2 })], optionsFor);
    expect(root.find('eui-card').length).toBe(1);
    expect(root.find('eui-chained').length).toBe(1);
  });

  it('never puts a failure line over a finished act', async () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc);
    const { update } = attachPresenters(run, [p], optionsFor);
    run.setValue('chore', 'dishes', 'spoken');
    run.setValue('assignee', MAYA, 'spoken');
    await tick(); await h.advance(1400); update();

    expect(toView(run, optionsFor).status).toBe('settled');
    expect(root.find('eui-mark').length).toBe(1);
    expect(root.find('eui-explicit').length).toBe(0);
  });

  it('never draws a spinner, in any state', async () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc);
    const { update } = attachPresenters(run, [p], optionsFor);
    const noSpinner = () => {
      const all = root.find('eui-card').concat(root.find('eui-row'));
      for (const el of all) expect(el.className).not.toMatch(/spin|load|busy/);
    };
    noSpinner();
    run.setValue('chore', 'dishes', 'spoken'); update(); noSpinner();
    run.setValue('assignee', MAYA, 'spoken'); await tick(); update(); noSpinner();
    expect(stylesheet()).not.toMatch(/@keyframes|spinner/);
  });

  it('never re-asks a slot the person filled', () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    attachPresenters(run, [new StagePresenter(root, doc)], optionsFor);
    run.setValue('chore', 'dishes', 'spoken');
    const v = toView(run, optionsFor);
    const chore = v.slots.find((s) => s.name === 'chore')!;
    expect(chore.status).toBe('filled');
    expect(chore.focused).toBe(false);
    // Board 11: exactly one slot is in focus, and it is the first empty one.
    expect(v.slots.filter((s) => s.focused).map((s) => s.name)).toEqual(['assignee']);
  });
});

describe('the card follows the sentence', () => {
  it('offers chips for the focused slot only, so it never looks like a form', () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    attachPresenters(run, [new StagePresenter(root, doc)], optionsFor);
    const rows = root.find('eui-row');
    expect(rows.length).toBe(2);
    expect(rows[0]!.attrs['data-focused']).toBe('true');
    expect(rows[0]!.find('eui-chip').length).toBeGreaterThan(0);
    expect(rows[1]!.attrs['data-focused']).toBe('false');
    expect(rows[1]!.find('eui-chip').length).toBe(0);
  });

  it('marks a spoken fill so the renderer can tint it', () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc);
    const { update } = attachPresenters(run, [p], optionsFor);
    run.setValue('chore', 'dishes', 'spoken'); update();
    const row = root.find('eui-row')[0]!;
    expect(row.attrs['data-source']).toBe('spoken');
    expect(row.attrs['data-state']).toBe('filled');
  });

  it('lets one row be dropped without taking the card down', async () => {
    const h = build();
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc);
    const { update } = attachPresenters(run, [p], optionsFor);
    run.setValue('chore', 'dishes', 'spoken');
    run.setValue('assignee', MAYA, 'spoken');
    await tick(); update();

    const drop = root.find('eui-drop')[0]!;
    expect(drop.textContent).toBe('×');
    drop.click(); update();
    expect(root.find('eui-card').length).toBe(1);
  });
});

describe('explicit assent', () => {
  it('asks for a yes and says why, rather than counting down', () => {
    const h = build({ foreground: true, unlocked: true, proximityClear: false, listening: true });
    const { root, doc } = fakeDom();
    const run = h.ui.start('assign_chore');
    const p = new StagePresenter(root, doc);
    const { update } = attachPresenters(run, [p], optionsFor);
    run.setValue('chore', 'dishes', 'touched');
    run.setValue('assignee', MAYA, 'touched');
    update();

    const v = toView(run, optionsFor);
    expect(v.status).toBe('explicit');
    expect(root.find('eui-ring').length).toBe(0);
    expect(root.find('eui-explicit')[0]!.text()).toMatch(/needs a yes/);
  });
});

describe('domainColour', () => {
  it('falls back to neutral rather than guessing', () => {
    expect(domainColour('trips')).toBe(DOMAIN_COLOUR.planPurple);
    expect(domainColour(null)).toBe(DOMAIN_COLOUR.neutral);
  });
});
