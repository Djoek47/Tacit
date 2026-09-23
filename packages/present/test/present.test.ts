import { describe, expect, it } from 'vitest';
import { createAIUIC, defineAct, FakeClock, type ActRun, type Option } from '@intermenu/aiuic-core';
import {
  DomPresenter, TextPresenter, attachPresenters, display, toView, type Handlers, type StageView,
} from '../src/index.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));

const SAM = { id: 'sam', label: 'Sam' };
const MAYA = { id: 'maya', label: 'Maya' };
const PEOPLE: Option[] = [{ value: SAM, label: 'Sam' }, { value: MAYA, label: 'Maya' }];
const ERRANDS: Option[] = [{ value: 'parcel', label: 'the parcel' }];

const optionsFor = (_run: ActRun, slot: string) =>
  slot === 'assignee' || slot === 'payee' ? PEOPLE : slot === 'errand' ? ERRANDS : [];

function build(attention = { foreground: true, unlocked: true, proximityClear: true, listening: true }) {
  const clock = new FakeClock(T0);
  const ui = createAIUIC({
    clock,
    ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }),
  });

  ui.defineAct(defineAct({
    name: 'assign_errand',
    slots: {
      assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      errand: { primitive: 'chip', options: () => ERRANDS, required: true, order: 2 },
      dueDate: { primitive: 'when', options: () => [], order: 3 },
    },
    radius: { max: 'other-person', of: () => 'other-person' },
    commit: () => ({ id: 'e1' }), undo: () => {},
    preview: (f) => [`give ${display(f.assignee)} ${display(f.errand)}`],
  }));

  ui.defineAct(defineAct({
    name: 'settle_up',
    slots: { payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 } },
    radius: 'external',
    commit: () => ({ id: 'p1' }),
  }));

  return { ui, clock, async advance(ms: number) { clock.advance(ms); await tick(); } };
}

/* A DOM stand-in. Nothing here needs a browser, which is the point. */
type FakeEl = {
  tag: string;
  textContent: string | null;
  className: string;
  children: FakeEl[];
  listeners: Array<() => void>;
  appendChild(c: FakeEl): void;
  addEventListener(t: string, fn: () => void): void;
  replaceChildren(): void;
  click(): void;
  find(cls: string): FakeEl[];
  text(): string;
};

function makeEl(tag: string): FakeEl {
  const node: FakeEl = {
    tag,
    textContent: null,
    className: '',
    children: [],
    listeners: [],
    appendChild(c) { node.children.push(c); },
    addEventListener(_t, fn) { node.listeners.push(fn); },
    replaceChildren() { node.children.length = 0; },
    click() { for (const fn of node.listeners) fn(); },
    find(cls) {
      const hit: FakeEl[] = node.className.split(' ').includes(cls) ? [node] : [];
      for (const c of node.children) hit.push(...c.find(cls));
      return hit;
    },
    text() {
      return [node.textContent ?? '', ...node.children.map((c) => c.text())].join(' ').trim();
    },
  };
  return node;
}

function fakeDom() {
  return { root: makeEl('div'), doc: { createElement: makeEl } };
}

describe('toView', () => {
  it('hands a renderer everything and makes it derive nothing', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    const v = toView(run, optionsFor);

    expect(v.act).toBe('assign_errand');
    expect(v.slots.map((s) => s.name)).toEqual(['assignee', 'errand', 'dueDate']);
    expect(v.slots[0]!.options).toEqual(PEOPLE);
    expect(v.slots[0]!.focused).toBe(true);
    expect(v.slots[2]!.required).toBe(false);
  });

  it('humanises slot names so a renderer never has to', () => {
    const h = build();
    const v = toView(h.ui.start('assign_errand'), optionsFor);
    expect(v.slots[2]!.label).toBe('due date');
  });

  it('reads a value the way the person said it', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    run.setValue('errand', { at: 123, label: 'Friday' }, 'spoken');
    const v = toView(run, optionsFor);
    expect(v.slots[0]!.display).toBe('Sam');
    expect(v.slots[1]!.display).toBe('Friday');
  });

  it('uses the host preview as the sentence consent is given to', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    run.setValue('errand', 'parcel', 'spoken');
    expect(toView(run, optionsFor).preview).toBe('give Sam parcel');
  });

  it('falls back to the filled slots when there is no host preview', () => {
    const h = build();
    const run = h.ui.start('settle_up');
    run.setValue('payee', MAYA, 'spoken');
    expect(toView(run, optionsFor).preview).toBe('settle up: Maya');
  });

  it('survives a host preview that throws', () => {
    const h = build();
    const bad = defineAct({
      name: 'bad_preview',
      slots: { x: { primitive: 'chip', options: () => [], required: true, order: 1 } },
      radius: 'self', commit: () => ({ id: '1' }), undo: () => {},
      preview: () => { throw new Error('boom'); },
    });
    h.ui.defineAct(bad);
    const run = h.ui.start('bad_preview');
    run.setValue('x', 'thing', 'touched');
    expect(toView(run, optionsFor).preview).toBe('bad preview: thing');
  });

  it('carries the hold clock and the reason silence is unavailable', () => {
    const open = build();
    const a = open.ui.start('assign_errand');
    a.setValue('assignee', SAM, 'spoken'); a.setValue('errand', 'parcel', 'spoken');
    const va = toView(a, optionsFor);
    expect(va.holdTotalMs).toBe(1360);
    expect(va.assent).toBe('silence');

    const shut = build({ foreground: true, unlocked: false, proximityClear: false, listening: true });
    const b = shut.ui.start('assign_errand');
    b.setValue('assignee', SAM, 'spoken'); b.setValue('errand', 'parcel', 'spoken');
    const vb = toView(b, optionsFor);
    expect(vb.holdRemainingMs).toBeNull();
    expect(vb.canAssent).toBe(true);
    expect(vb.gateFailures.join(' ')).toMatch(/device locked/);
  });

  it('shows a narrowed slot as what it is deciding between', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.offer('assignee', [{ value: SAM, score: 0.9 }, { value: MAYA, score: 0.88 }], 'spoken');
    const s = toView(run, optionsFor).slots[0]!;
    expect(s.status).toBe('narrowed');
    expect(s.candidates.map((c) => c.display)).toEqual(['Sam', 'Maya']);
  });

  it('returns an idle view rather than throwing when nothing is live', () => {
    expect(toView(null, optionsFor).act).toBeNull();
  });
});

describe('two presenters, one view', () => {
  function run3() {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.setValue('assignee', SAM, 'spoken');
    run.setValue('errand', 'parcel', 'spoken');
    return { h, run };
  }

  it('the text presenter draws the same facts the DOM one does', () => {
    const { run } = run3();
    const dom = fakeDom();
    const text = new TextPresenter();
    const domP = new DomPresenter(dom.root, dom.doc);
    attachPresenters(run, [text, domP], optionsFor);

    expect(text.last).toMatch(/assign_errand\s+\[hold · other-person\]/);
    expect(text.last).toMatch(/give Sam parcel/);
    expect(text.last).toMatch(/silence commits/);

    expect(dom.root.text()).toMatch(/give Sam parcel/);
    expect(dom.root.find('aiuic-slot').length).toBe(3);
    expect(dom.root.find('aiuic-hold').length).toBe(1);
  });

  it('a touch from the DOM goes through the same engine', () => {
    const { run } = run3();
    const dom = fakeDom();
    const p = new DomPresenter(dom.root, dom.doc);
    attachPresenters(run, [p], optionsFor);

    const before = run.slots.assignee?.value;
    const options = dom.root.find('aiuic-option');
    options[1]!.click();                       // "Maya" under assignee
    expect(before).toBe(SAM);
    expect(run.slots.assignee?.value).toBe(MAYA);
  });

  it('marks a provisional fill differently from a confirmed one', () => {
    const h = build();
    const run = h.ui.start('assign_errand');
    run.offer('assignee', [{ value: SAM, score: 0.6 }], 'spoken');
    const text = new TextPresenter();
    attachPresenters(run, [text], optionsFor);
    expect(text.last).toMatch(/\?\s+assignee: Sam/);
  });

  it('offers a yes, and never a hold clock, for an external act', () => {
    const h = build();
    const run = h.ui.start('settle_up');
    run.setValue('payee', SAM, 'spoken');
    const dom = fakeDom();
    const text = new TextPresenter();
    attachPresenters(run, [text, new DomPresenter(dom.root, dom.doc)], optionsFor);

    expect(text.last).toMatch(/cannot be taken back/);
    expect(dom.root.find('aiuic-assent').length).toBe(1);
    expect(dom.root.find('aiuic-hold').length).toBe(0);
  });

  it('offers undo while the window is open and stops when it closes', async () => {
    const { h, run } = run3();
    const text = new TextPresenter();
    const { update } = attachPresenters(run, [text], optionsFor);

    await h.advance(1400); update();
    expect(text.last).toMatch(/undo is live/);

    await h.advance(5100); update();
    expect(text.last).not.toMatch(/undo is live/);
  });

  it('unmounting clears the surface', () => {
    const { run } = run3();
    const dom = fakeDom();
    const p = new DomPresenter(dom.root, dom.doc);
    attachPresenters(run, [p], optionsFor);
    expect(dom.root.find('aiuic-slot').length).toBe(3);
    p.unmount();
    expect(dom.root.find('aiuic-slot').length).toBe(0);
  });
});
