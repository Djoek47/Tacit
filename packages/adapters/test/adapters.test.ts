import { describe, expect, it, vi } from 'vitest';
import { FakeClock, type Ctx } from '@intermenu/aiuic-core';
import { createApp } from '@intermenu/aiuic-kit';
import { fromFunctions, fromOpenAPI, costOf, fillPath, type OpenAPIDoc } from '../src/index.js';

const DOC: OpenAPIDoc = {
  openapi: '3.1.0',
  info: { title: 'Tasks' },
  paths: {
    '/tasks': {
      get: { operationId: 'list_tasks', summary: 'List every task', tags: ['tasks'] },
      post: {
        operationId: 'add_task', summary: 'Add a task', tags: ['tasks'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } } },
        'x-aiuic-undo': '/tasks/{id}/restore',
      },
    },
    '/tasks/{id}': {
      delete: { operationId: 'delete_task', summary: 'Delete a task', tags: ['tasks'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] },
    },
  },
};

const call = vi.fn(async () => ({ ok: true, status: 200, body: { id: '7' } }));

describe('an HTTP API becomes acts', () => {
  it('makes writes into acts and reads into sources, never the other way round', () => {
    const r = fromOpenAPI(DOC, { call });
    expect(r.acts.map((a) => a.name).sort()).toEqual(['add_task', 'delete_task']);
    expect(r.sources.map((s) => s.name)).toEqual(['list_tasks']);
  });

  it('starts every write at external, whatever the document says', () => {
    const r = fromOpenAPI(DOC, { call });
    expect(r.acts.every((a) => a.radius === 'external')).toBe(true);
  });

  it('refuses to let a delete be lowered, and allows it only where an undo exists', () => {
    const r = fromOpenAPI(DOC, { call });
    const del = r.costs.delete_task!;
    const add = r.costs.add_task!;
    expect(del.kind === 'write' && del.lowerable).toBe(false);
    expect(del.kind === 'write' && del.why.join(' ')).toMatch(/cannot be taken back|destructive/);
    // An operation that declares how to undo it may be lowered — but not below
    // the floor, because it still reaches a server somewhere.
    expect(add.kind === 'write' && add.lowerable).toBe(true);
    expect(add.kind === 'write' && add.floor).toBe('other-person');
  });

  it('groups by tag, so the menus come out of the document too', () => {
    const r = fromOpenAPI(DOC, { call });
    expect(r.acts.every((a) => a.domain === 'tasks')).toBe(true);
  });

  it('never lets two operations share a name a person would have to choose between', () => {
    const withBody = { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } } } } };
    const clash: OpenAPIDoc = { paths: {
      '/a': { post: { operationId: 'same', ...withBody } },
      '/b': { post: { operationId: 'same', ...withBody } },
    } };
    const r = fromOpenAPI(clash, { call });
    expect(r.acts).toHaveLength(1);
    expect(r.problems.join(' ')).toMatch(/second "same"/);
  });

  it('puts values into the path where the path asks for them', () => {
    expect(fillPath('/tasks/{id}/notes', { id: 'a b' })).toBe('/tasks/a%20b/notes');
    // Nothing given: the template survives rather than becoming "undefined".
    expect(fillPath('/tasks/{id}', {})).toBe('/tasks/{id}');
  });

  it('calls nothing while an act only sits on the stage', async () => {
    const quiet = vi.fn(async () => ({ ok: true, status: 200, body: {} }));
    const r = fromOpenAPI(DOC, { call: quiet });
    const app = createApp({
      clock: new FakeClock(1_700_000_000_000),
      ctx: () => ({ actor: { id: 'me', basePauseMs: 850 },
        attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
        reachLimit: 1, undoWindowMs: 5000 }) as Omit<Ctx, 'now'>,
      acts: r.acts,
    });
    app.pick('add_task');
    expect(quiet).not.toHaveBeenCalled();
    expect(app.view()!.canAssent).toBe(false);
  });
});

describe('a project\'s own functions become acts', () => {
  const params = { type: 'object' as const, properties: { q: { type: 'string' } }, required: ['q'] };
  const base = { run: () => ({ id: '1' }), parameters: params };

  it('takes the author at their word, because the author is the app', () => {
    expect(costOf({ name: 'a', ...base, undo: () => {} })).toBe('self');
    expect(costOf({ name: 'b', ...base, undo: () => {}, touchesSomeoneElse: true })).toBe('other-person');
    expect(costOf({ name: 'c', ...base, undo: () => {}, reachesOutside: true })).toBe('external');
  });

  it('does not take silence for a promise: no undo is external, whatever else is claimed', () => {
    expect(costOf({ name: 'd', ...base })).toBe('external');
    expect(costOf({ name: 'e', ...base, reachesOutside: false, touchesSomeoneElse: false })).toBe('external');
  });

  it('builds slots from the parameters, and runs the function on commit', async () => {
    const run = vi.fn(() => ({ id: '9' }));
    const [act] = fromFunctions([{
      name: 'add_task', domain: 'tasks', phrases: ['add'], run, undo: () => {},
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    }]);
    expect(Object.keys(act!.slots)).toEqual(['title']);
    expect(act!.radius).toBe('self');
    const out = await act!.commit({ title: 'call the bank' }, {} as Ctx);
    expect(run).toHaveBeenCalledWith({ title: 'call the bank' });
    expect(out.id).toBe('9');
  });

  it('refuses two functions with one name', () => {
    expect(() => fromFunctions([{ name: 'x', ...base }, { name: 'x', ...base }])).toThrow(/could not tell them apart/);
  });

  it('gives an app menus, grouped by the domain the functions declared', () => {
    const acts = fromFunctions([
      { name: 'add_task', domain: 'tasks', ...base, undo: () => {} },
      { name: 'drop_task', domain: 'tasks', ...base, undo: () => {} },
      { name: 'set_theme', domain: 'settings', ...base, undo: () => {} },
    ]);
    const app = createApp({
      clock: new FakeClock(1_700_000_000_000),
      ctx: () => ({ actor: { id: 'me', basePauseMs: 850 },
        attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
        reachLimit: 1, undoWindowMs: 5000 }) as Omit<Ctx, 'now'>,
      acts,
    });
    expect(app.menus.view().items.map((i) => i.id)).toEqual(['tasks', 'set_theme']);
  });
});
