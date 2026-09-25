import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDevServer, DEV_TOOLS } from '../src/index.js';
import { FAMILY_BRIEF } from './fixtures.js';

async function dev() {
  const root = mkdtempSync(join(tmpdir(), 'hepta-dev-'));
  writeFileSync(join(root, 'BRIEF.md'), FAMILY_BRIEF);
  const server = createDevServer({ root, runtime: () => readFileSync(join(__dirname, '../runtime/runtime.js'), 'utf8') });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cursor-like', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { root, call, client, done: () => rmSync(root, { recursive: true, force: true }) };
}

describe('hepta-dev, from inside a developer\'s assistant', () => {
  it('offers exactly the documented tools', async () => {
    const d = await dev();
    expect((await d.client.listTools()).tools.map((t) => t.name).sort()).toEqual([...DEV_TOOLS].sort());
    d.done();
  });

  it('reads the brief and reports the menu problems', async () => {
    const d = await dev();
    const r = await d.call('read_brief');
    expect(r.content[0]!.text).toMatch(/Family Tasks: 5 features/);
    expect(r.content[0]!.text).toMatch(/nobody can reach it/);
    d.done();
  });

  it('scaffolds once, and refuses to overwrite without being told to — writing nothing on refusal', async () => {
    const d = await dev();
    expect((await d.call('scaffold_app', { outDir: 'app' })).content[0]!.text).toMatch(/Wrote app\/server\.mjs/);
    writeFileSync(join(d.root, 'app/server.mjs'), '// my own edits');
    const again = await d.call('scaffold_app', { outDir: 'app' });
    expect(again.isError).toBe(true);
    expect(readFileSync(join(d.root, 'app/server.mjs'), 'utf8')).toBe('// my own edits');
    expect((await d.call('scaffold_app', { outDir: 'app', overwrite: true })).isError).toBeFalsy();
    d.done();
  });

  it('never reads or writes outside the project', async () => {
    const d = await dev();
    expect((await d.call('read_brief', { path: '../../etc/passwd' })).content[0]!.text).toMatch(/outside/);
    expect((await d.call('prototype', { out: '/tmp/escape.html' })).isError).toBe(true);
    expect(existsSync('/tmp/escape.html')).toBe(false);
    d.done();
  });

  it('writes a prototype and a dossier', async () => {
    const d = await dev();
    await d.call('prototype');
    expect(readFileSync(join(d.root, 'prototype.html'), 'utf8')).toContain('<title>Family Tasks</title>');
    const dos = await d.call('rebuild_dossier', { brief: 'BRIEF.md' });
    expect(dos.content[0]!.text).toMatch(/## Rebuild order/);
    d.done();
  });
});
