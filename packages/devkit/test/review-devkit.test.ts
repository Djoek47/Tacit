import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDevServer } from '../src/index.js';
import { FAMILY_BRIEF } from './fixtures.js';

async function dev() {
  const root = mkdtempSync(join(tmpdir(), 'zz-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'zz-outside-'));
  writeFileSync(join(root, 'BRIEF.md'), FAMILY_BRIEF);
  const server = createDevServer({ root, runtime: () => '/*rt*/' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'x', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { root, outside, call, client };
}

// Found by independent review. Each test asserts the fixed behaviour.
describe('hepta-dev stays inside the project, physically', () => {
  it('refuses to write through a symlinked folder that leads outside', async () => {
    const d = await dev();
    symlinkSync(d.outside, join(d.root, 'docs'));           // root/docs -> somewhere else
    const r = await d.call('prototype', { out: 'docs/escape.html' });
    expect(r.isError).toBe(true);
    expect(existsSync(join(d.outside, 'escape.html'))).toBe(false);
  });

  it('refuses to create a file through a dangling link', async () => {
    const d = await dev();
    const target = join(d.outside, 'created-by-dangling.txt');
    symlinkSync(target, join(d.root, 'prototype.html'));   // dangling: existsSync() follows it and says false
    const r = await d.call('prototype', {});
    expect(r.isError).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  const exe = ['/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'].find((p) => existsSync(p));
  (exe ? it : it.skip)('test_app says it writes, and never overwrites a file with a screenshot', async () => {
    const d = await dev();
    mkdirSync(join(d.root, 'src'));
    writeFileSync(join(d.root, 'src', 'phone.png'), 'MY OWN FILE');
    const listed = (await d.client.listTools()).tools.find((t) => t.name === 'test_app')!;
    expect(listed.annotations?.readOnlyHint).toBe(false);
    // executablePath is only configurable on the server; the default server has none, so point env at it.
    process.env.HEPTA_CHROMIUM = exe!;
    writeFileSync(join(d.root, 'p.html'), '<html><body>hi</body></html>');
    const r = await d.call('test_app', { url: 'file://' + join(d.root, 'p.html'), screenshots: 'src' });
    expect(r.isError).toBe(true);                            // src is not empty
    expect(readFileSync(join(d.root, 'src', 'phone.png'), 'utf8')).toBe('MY OWN FILE');
    const ok = await d.call('test_app', { url: 'file://' + join(d.root, 'p.html'), screenshots: 'shots' });
    expect(ok.isError).toBeFalsy();                          // a new folder is fine
    expect(existsSync(join(d.root, 'shots', 'phone.png'))).toBe(true);
  }, 60000);
});
