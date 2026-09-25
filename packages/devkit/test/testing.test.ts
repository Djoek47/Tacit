import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { testApp, formatTest, VIEWPORTS } from '../src/index.js';

const exe = ['/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', process.env.HEPTA_CHROMIUM ?? '']
  .find((p) => p && existsSync(p));
const url = (f: string) => 'file://' + join(__dirname, 'pages', f);
const run = exe ? describe : describe.skip;

run('testing an app like a person would', () => {
  it('finds everything wrong with a broken page, and says it in sentences', async () => {
    const r = await testApp(url('broken.html'), { executablePath: exe!, settleMs: 50 });
    const phone = r.views.find((v) => v.viewport.name === 'phone')!;
    const rules = new Set(phone.findings.map((f) => f.rule));
    for (const rule of ['console', 'sideways', 'fingertips', 'cut-off', 'tiny-text', 'alt', 'cards']) expect(rules.has(rule as never)).toBe(true);
    const sideways = phone.findings.find((f) => f.rule === 'sideways')!;
    expect(sideways.says).toMatch(/scrolls sideways/);
    expect(sideways.says).toMatch(/div\.hero/);
    expect(phone.findings.find((f) => f.rule === 'fingertips')!.says).toMatch(/button#send "Go" is 30×24/);
    // The same console error is reported once, not once per size.
    expect(r.views.flatMap((v) => v.findings).filter((f) => f.rule === 'console').length).toBe(1);
    // Desktop is wide enough that the banner fits, and no one taps with a mouse.
    const desk = r.views.find((v) => v.viewport.name === 'desktop')!;
    expect(desk.findings.some((f) => f.rule === 'sideways' || f.rule === 'fingertips')).toBe(false);
    expect(r.clean).toBe(false);
    expect(formatTest(r)).toMatch(/Not clean yet/);
  });

  it('calls a clean page clean, after using it', async () => {
    const r = await testApp(url('clean.html'), {
      executablePath: exe!, settleMs: 50,
      steps: [{ fill: ['#say', 'buy milk'] }, { click: '#go' }],
    });
    expect(r.clean).toBe(true);
    expect(formatTest(r)).toMatch(/Clean: nothing a person would trip on/);
  });

  it('says where a user would get stuck', async () => {
    const r = await testApp(url('clean.html'), { executablePath: exe!, settleMs: 20, viewports: [VIEWPORTS[0]!], steps: [{ click: 'text=Checkout' }] });
    expect(r.views[0]!.findings[0]!.says).toMatch(/step 1 \(click text=Checkout\) could not be done.*stuck/);
  });
});

run('what a page served without a charset does', () => {
  it('names the missing charset, reports the crash it causes, and does not count a missing picture as broken', async () => {
    // Served over HTTP with no charset, the way a plain static server does it. (Chrome guesses
    // UTF-8 for file:// pages, which hides the bug.)
    const dir = join(__dirname, 'pages');
    const server = createServer((req, res) => {
      const file = join(dir, (req.url ?? '/').replace(/^\//, ''));
      if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': file.endsWith('.png') ? 'image/png' : 'text/html' });
      res.end(readFileSync(file));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;
    let r;
    try { r = await testApp(`http://127.0.0.1:${port}/nocharset.html`, { executablePath: exe!, settleMs: 20, viewports: [VIEWPORTS[2]!] }); }
    finally { server.close(); }
    const f = r.views[0]!.findings;
    expect(f.some((x) => x.severity === 'error' && /read as windows-1252, not UTF-8.*meta charset/.test(x.says))).toBe(true);
    expect(f.some((x) => /script on the page crashed/.test(x.says))).toBe(true);
    const picture = f.find((x) => /404 for .*missing\.png/.test(x.says))!;
    expect(picture.severity).toBe('warn');
    // Chrome's own "Failed to load resource" line would say the same thing twice.
    expect(f.some((x) => /Failed to load resource/.test(x.says))).toBe(false);
  });
});
