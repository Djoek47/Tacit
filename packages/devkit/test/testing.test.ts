import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
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
