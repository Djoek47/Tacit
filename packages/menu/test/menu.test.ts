import { describe, expect, it } from 'vitest';
import { defineAct, type ActDef } from '@intermenu/aiuic-core';
import { Menus, menusFromActs, everyActReachable, ROOT, type MenuSpec } from '../src/index.js';

const act = (name: string, domain?: string, radius: 'self' | 'shared' | 'other-person' | 'external' = 'self'): ActDef =>
  defineAct({
    name, ...(domain ? { domain } : {}), phrases: [name.split('_')[0]!],
    slots: { what: { primitive: 'chip', options: () => [{ value: 'x', label: 'X' }], required: true, order: 1 } },
    radius, commit: () => ({ id: '1' }), ...(radius === 'external' ? {} : { undo: () => {} }),
  });

/** A household app: two chores, three groceries, one lonely settings act. */
const ACTS = [
  act('assign_chore', 'chores', 'other-person'),
  act('swap_chore', 'chores'),
  act('add_item', 'groceries'),
  act('remove_item', 'groceries'),
  act('clear_list', 'groceries'),
  act('set_quiet_hours', 'settings'),
];

describe('menus are a projection of capability', () => {
  it('generates them from the acts, grouped by the domain the acts already carry', () => {
    const specs = menusFromActs(ACTS);
    const root = specs.find((s) => s.id === ROOT)!;
    expect(root.menus).toEqual(['chores', 'groceries']);
    expect(specs.find((s) => s.id === 'groceries')!.acts).toEqual(['add_item', 'clear_list', 'remove_item']);
  });

  it('gives a domain of one act no menu of its own: the act sits at the top', () => {
    const specs = menusFromActs(ACTS);
    expect(specs.find((s) => s.id === ROOT)!.acts).toEqual(['set_quiet_hours']);
    expect(specs.some((s) => s.id === 'settings')).toBe(false);
  });

  it('reaches every act, always', () => {
    expect(everyActReachable(menusFromActs(ACTS), ACTS)).toEqual([]);
    const odd = [act('lonely'), act('a', 'z'), act('b', 'z')];
    expect(everyActReachable(menusFromActs(odd), odd)).toEqual([]);
  });

  it('says the same thing twice: the same acts give the same menus', () => {
    expect(menusFromActs(ACTS)).toEqual(menusFromActs([...ACTS].reverse()));
  });

  it('drops an act that has left the app, rather than offering what cannot happen', () => {
    const specs = menusFromActs(ACTS);
    const m = new Menus(ACTS.filter((a) => a.name !== 'clear_list'), { specs });
    m.open('groceries');
    expect(m.view().items.map((i) => i.id)).toEqual(['add_item', 'remove_item']);
  });
});

describe('what a menu shows', () => {
  it('carries what an act costs, so the person sees it before they pick it', () => {
    const m = new Menus(ACTS);
    m.open('chores');
    expect(m.view().items.find((i) => i.id === 'assign_chore')!.radius).toBe('other-person');
  });

  it('leaves a way back from anywhere', () => {
    const m = new Menus(ACTS);
    expect(m.view().atRoot).toBe(true);
    m.open('groceries');
    const v = m.view();
    expect(v.atRoot).toBe(false);
    expect(v.trail.map((t) => t.id)).toEqual([ROOT]);
    expect(m.back()).toBe(true);
    expect(m.view().atRoot).toBe(true);
    expect(m.back()).toBe(false);
  });

  it('finds an act by name, domain or the words people say for it', () => {
    const m = new Menus(ACTS);
    expect(m.find('item').map((i) => i.id)).toEqual(['add_item', 'remove_item']);
    expect(m.find('chores').map((i) => i.id)).toEqual(['assign_chore', 'swap_chore']);
    expect(m.find('')).toEqual([]);
  });

  it('refuses to make a menu its own ancestor', () => {
    const specs: MenuSpec[] = [
      { id: ROOT, title: 'Home', acts: [], menus: ['a'] },
      { id: 'a', title: 'A', acts: ['add_item'], menus: [ROOT] },
    ];
    const m = new Menus(ACTS, { specs });
    m.open('a');
    expect(m.open(ROOT)).toBe(false);
    expect(everyActReachable(specs, [act('add_item', 'groceries')])).toEqual([]);
  });
});

describe('the AI may raise and annotate; it may never hide', () => {
  it('raises what it spotlights without removing anything else', () => {
    const m = new Menus(ACTS);
    m.open('groceries');
    m.spotlight(['remove_item'], 'you added milk twice');
    const v = m.view();
    expect(v.items[0]!.id).toBe('remove_item');
    expect(v.items.map((i) => i.id).sort()).toEqual(['add_item', 'clear_list', 'remove_item']);
    expect(v.note).toBe('you added milk twice');
  });

  it('keeps every act reachable whatever the AI does to the menu', () => {
    const m = new Menus(ACTS);
    m.spotlight(['add_item']);
    m.annotate('chores', 'nothing due');
    m.say('here is what I would do');
    m.spotlight([]);
    const reachable = new Set<string>();
    const walk = () => {
      for (const i of m.view().items) {
        if (i.kind === 'act') reachable.add(i.id);
        else { m.open(i.id); walk(); m.back(); }
      }
    };
    walk();
    expect([...reachable].sort()).toEqual(ACTS.map((a) => a.name).sort());
  });

  it('offers no way to hide, filter or remove an item', () => {
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(new Menus(ACTS)));
    expect(names.filter((n) => /hide|remove|filter|only|exclude|drop|suppress/i.test(n))).toEqual([]);
  });

  it('cannot spotlight an act the app does not have', () => {
    const m = new Menus(ACTS);
    m.spotlight(['drain_account']);
    expect(m.view().items.some((i) => i.spotlit)).toBe(false);
  });
});

describe('a menu writes nothing', () => {
  it('hands back what was chosen and commits nothing itself', () => {
    const m = new Menus(ACTS);
    expect(m.choose('groceries')).toEqual({ kind: 'menu', menu: 'groceries' });
    expect(m.view().id).toBe('groceries');
    expect(m.choose('add_item')).toEqual({ kind: 'act', act: 'add_item' });
    expect(m.choose('nonsense')).toEqual({ kind: 'unknown', id: 'nonsense' });
  });

  it('holds nothing it could commit with, and names no way to try', () => {
    const m = new Menus(ACTS);
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(m));
    expect(names.filter((n) => /commit|assent|start|run|write|undo/i.test(n))).toEqual([]);
    // No app, no engine, no run: the acts are definitions, and a definition cannot fire.
    for (const v of Object.values(m as unknown as Record<string, unknown>)) {
      expect(typeof (v as { commit?: unknown })?.commit).not.toBe('function');
    }
  });
});
