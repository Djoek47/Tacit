import { describe, expect, it } from 'vitest';
import { defineAct, type ActDef } from '@intermenu/aiuic-core';
import { Menus } from '@intermenu/aiuic-menu';
import { MenuPresenter, defineStageElement, stylesheet, TAG } from '../src/index.js';
import { fakeDom } from './fake-dom.js';



const act = (name: string, domain: string, radius: 'self' | 'other-person' | 'external'): ActDef =>
  defineAct({
    name, domain,
    slots: { what: { primitive: 'chip', options: () => [{ value: 'x', label: 'X' }], required: true, order: 1 } },
    radius, commit: () => ({ id: '1' }), ...(radius === 'external' ? {} : { undo: () => {} }),
  });

const ACTS = [
  act('add_item', 'groceries', 'self'),
  act('clear_list', 'groceries', 'self'),
  act('assign_chore', 'chores', 'other-person'),
  act('pay_allowance', 'chores', 'external'),
];

describe('a menu drawn in the language', () => {
  it('says what an act costs before it is picked, not after', () => {
    const { root, doc } = fakeDom();
    const m = new Menus(ACTS);
    m.open('chores');
    new MenuPresenter(root, doc).render(m.view());
    const costs = root.find('eui-item-cost');
    expect(costs.map((c) => c.textContent)).toEqual(['someone else', 'asks first']);
    expect(costs.map((c) => c.attrs['data-radius'])).toEqual(['other-person', 'external']);
    // A cheap, reversible act needs no warning and gets none.
    m.home(); m.open('groceries');
    const cheap = fakeDom();
    new MenuPresenter(cheap.root, cheap.doc).render(m.view());
    expect(cheap.root.find('eui-item-cost')).toEqual([]);
  });

  it('draws a way back from every menu below the root, and none at the root', () => {
    const { root, doc } = fakeDom();
    const m = new Menus(ACTS);
    const p = new MenuPresenter(root, doc);
    p.render(m.view());
    expect(root.find('eui-back')).toEqual([]);
    m.open('groceries');
    p.render(m.view());
    expect(root.find('eui-back')[0]!.textContent).toBe('← Home');
  });

  it('hands a pick back without deciding anything about it', () => {
    const { root, doc } = fakeDom();
    const m = new Menus(ACTS);
    const picked: string[] = [];
    const p = new MenuPresenter(root, doc);
    p.mount({ choose: (id) => picked.push(id), back: () => picked.push('<back>') });
    p.render(m.view());
    root.find('eui-item')[0]!.click();
    expect(picked).toEqual(['chores']);
  });

  it('carries the domain colour onto the item, and never a personal accent', () => {
    const { root, doc } = fakeDom();
    const m = new Menus(ACTS);
    m.open('chores');
    new MenuPresenter(root, doc, { accent: '#FF00FF' }).render(m.view());
    const item = root.find('eui-item')[0]!;
    expect(item.vars['--eui-domain']).toBeTruthy();
    expect(item.vars['--eui-domain']).not.toBe('#FF00FF');
  });

  it('gives every item a label a screen reader can read', () => {
    const { root, doc } = fakeDom();
    const m = new Menus(ACTS);
    m.open('chores');
    m.annotate('pay_allowance', 'due Friday');
    new MenuPresenter(root, doc).render(m.view());
    const labels = root.find('eui-item').map((i) => i.attrs['aria-label']);
    expect(labels).toContain('Pay allowance, asks first, due Friday');
  });

  it('replaces what was there, so two renders never stack two menus', () => {
    const { root, doc } = fakeDom();
    const m = new Menus(ACTS);
    const p = new MenuPresenter(root, doc);
    p.render(m.view());
    p.render(m.view());
    expect(root.find('eui-items')).toHaveLength(1);
  });
});

describe('the element, where a browser exists', () => {
  it('does not register, and does not throw, where there is no browser', () => {
    expect(defineStageElement()).toBe(false);
  });

  it('carries the whole stylesheet, so it needs nothing from the host page', () => {
    const css = stylesheet();
    expect(css).toContain('.eui-item');
    expect(css).toContain('.eui-card');
    expect(TAG).toBe('eui-stage');
  });

  it('declares its tokens where a shadow root can see them', () => {
    // `:root` alone never matches inside a shadow root, so every var() fell back
    // to nothing and rows came out under the minimum target. A browser found it.
    const css = stylesheet();
    expect(css).toMatch(/:root,\s*:host\s*\{/);
    expect(css).toContain('--eui-target-min');
  });
});
