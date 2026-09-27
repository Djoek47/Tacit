import { describe, expect, it, vi } from 'vitest';
import { FakeClock, defineAct } from '@intermenu/aiuic-core';
import { collect, mount } from '../src/index.js';

const params = { type: 'object' as const, properties: { q: { type: 'string' } }, required: ['q'] };
const fn = (name: string, domain: string) => ({ name, domain, parameters: params, run: () => ({ id: '1' }), undo: () => {} });
const clock = () => new FakeClock(1_700_000_000_000);

const DOC = { paths: { '/tasks': {
  get: { operationId: 'list_tasks', tags: ['tasks'] },
  post: { operationId: 'add_task', tags: ['tasks'], requestBody: { content: { 'application/json': { schema: params } } } },
} } };

describe('four doors in, one contract out', () => {
  it('adds up acts and sources from every door at once', () => {
    const r = collect({
      acts: [defineAct({ name: 'hand_written', domain: 'misc', slots: { q: { primitive: 'chip', options: () => [{ value: 'a', label: 'A' }], required: true, order: 1 } }, radius: 'self', commit: () => ({ id: '1' }), undo: () => {} })],
      functions: [fn('from_function', 'local')],
      openapi: { doc: DOC, call: async () => ({ ok: true, status: 200, body: {} }) },
      connections: [{ acts: [defineAct({ name: 'from_mcp', domain: 'remote', slots: { q: { primitive: 'chip', options: () => [{ value: 'a', label: 'A' }], required: true, order: 1 } }, radius: 'external', commit: () => ({ id: '1' }) })] }],
    });
    expect(r.acts.map((a) => a.name).sort()).toEqual(['add_task', 'from_function', 'from_mcp', 'hand_written']);
    expect(r.sources.map((s) => s.name)).toEqual(['list_tasks']);
    expect(r.problems).toEqual([]);
  });

  it('says so out loud when two doors bring the same name, rather than letting one win quietly', () => {
    const r = collect({
      functions: [fn('add_task', 'local')],
      openapi: { doc: DOC, call: async () => ({ ok: true, status: 200, body: {} }) },
    });
    expect(r.acts.filter((a) => a.name === 'add_task')).toHaveLength(1);
    expect(r.problems.join(' ')).toMatch(/two acts are called "add_task"/);
  });
});

describe('mounting without anything to draw on', () => {
  it('still gives a whole app, which is how a test or a voice-only host uses it', () => {
    const ui = mount({ functions: [fn('add_task', 'tasks'), fn('drop_task', 'tasks')], clock: clock() });
    expect(ui.menus.view().items.map((i) => i.id)).toEqual(['tasks']);
    expect(ui.app.ui.definitions.map((d) => d.name)).toEqual(['add_task', 'drop_task']);
  });

  it('puts a picked act on the stage empty, and commits nothing on its own', () => {
    const run = vi.fn(() => ({ id: '1' }));
    const ui = mount({ functions: [{ ...fn('add_task', 'tasks'), run }], clock: clock() });
    ui.pick('add_task');
    expect(ui.app.view()!.slots.every((s) => s.status === 'empty')).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('hears a sentence and routes it, with nothing drawn', () => {
    const ui = mount({ functions: [{ ...fn('add_task', 'tasks'), phrases: ['add'] }], clock: clock() });
    expect(ui.hear('add the milk', { final: true }).act).toBe('add_task');
  });
});

describe('mounting onto an element', () => {
  /** The surface `mount` needs from `<eui-stage>`, and nothing more. */
  const fakeElement = () => {
    const handlers: Record<string, ((e: unknown) => void)[]> = {};
    const drawn: { menus: unknown[]; stages: unknown[] } = { menus: [], stages: [] };
    return {
      drawn, handlers,
      showMenu: (v: unknown) => drawn.menus.push(v),
      showStage: (v: unknown) => drawn.stages.push(v),
      setAccent: () => {},
      presenter: { render: () => {}, mount: () => {} },
      addEventListener: (t: string, fn: (e: unknown) => void) => { (handlers[t] ??= []).push(fn); },
      removeEventListener: (t: string, fn: (e: unknown) => void) => {
        handlers[t] = (handlers[t] ?? []).filter((f) => f !== fn);
      },
      emit(t: string, detail: unknown) { for (const f of handlers[t] ?? []) f({ detail }); },
    };
  };

  it('draws the menu as soon as it is mounted', () => {
    const el = fakeElement();
    mount({ el, functions: [fn('add_task', 'tasks'), fn('drop_task', 'tasks')], clock: clock() });
    expect(el.drawn.menus).toHaveLength(1);
  });

  it('opens a menu when one is chosen, and starts nothing', () => {
    const el = fakeElement();
    const run = vi.fn(() => ({ id: '1' }));
    const ui = mount({ el, functions: [{ ...fn('add_task', 'tasks'), run }, fn('drop_task', 'tasks')], clock: clock() });
    el.emit('eui-choose', { id: 'tasks' });
    expect(ui.menus.view().id).toBe('tasks');
    expect(run).not.toHaveBeenCalled();
    expect(ui.app.act).toBeNull();
  });

  it('puts a chosen act on the stage, waiting, without calling the function behind it', () => {
    const el = fakeElement();
    const run = vi.fn(() => ({ id: '1' }));
    const ui = mount({ el, functions: [{ ...fn('add_task', 'tasks'), run }, fn('drop_task', 'tasks')], clock: clock() });
    el.emit('eui-choose', { id: 'tasks' });
    el.emit('eui-choose', { id: 'add_task' });
    expect(ui.app.act!.def.name).toBe('add_task');
    expect(ui.app.view()!.canAssent).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('goes back when the way out is used', () => {
    const el = fakeElement();
    const ui = mount({ el, functions: [fn('add_task', 'tasks'), fn('drop_task', 'tasks')], clock: clock() });
    el.emit('eui-choose', { id: 'tasks' });
    el.emit('eui-back', {});
    expect(ui.menus.view().atRoot).toBe(true);
  });

  it('stops listening when it is destroyed, and leaves the app alone', () => {
    const el = fakeElement();
    const ui = mount({ el, functions: [fn('add_task', 'tasks'), fn('drop_task', 'tasks')], clock: clock() });
    ui.destroy();
    el.emit('eui-choose', { id: 'tasks' });
    expect(ui.menus.view().atRoot).toBe(true);
    expect(ui.app.ui.definitions).toHaveLength(2);
  });
});
