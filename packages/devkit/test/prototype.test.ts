import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseBrief, prototype, testApp, formatTest, draftFromBrief } from '../src/index.js';
import { FAMILY_BRIEF } from './fixtures.js';

const exe = ['/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', process.env.HEPTA_CHROMIUM ?? ''].find((p) => p && existsSync(p));
const runtime = readFileSync(join(__dirname, '../runtime/runtime.js'), 'utf8');

describe('a prototype from the proposal', () => {
  const b = parseBrief(FAMILY_BRIEF);
  const html = prototype(b, runtime);

  it('carries the mood board, the menu map and every drafted act', () => {
    expect(html).toContain('<title>Family Tasks</title>');
    for (const m of ['calm', 'glass', '2030']) expect(html).toContain(`>${m}<`);
    expect(html).toContain('nobody can reach it');
    for (const a of draftFromBrief(b).acts) expect(html).toContain(`<b>${a.name}</b>`);
  });

  (exe ? it : it.skip)('works in a browser: every example lands a card, money waits, and the tester finds nothing to fix', async () => {
    const dir = join(__dirname, '.proto'); mkdirSync(dir, { recursive: true });
    const file = join(dir, 'index.html'); writeFileSync(file, html);
    const acts = draftFromBrief(b).acts;
    try {
      const r = await testApp('file://' + file, {
        executablePath: exe!, settleMs: 120,
        steps: acts.map((_, i) => ({ click: `#scenes button:nth-child(${i + 1})` })),
      });
      const serious = r.views.flatMap((v) => v.findings).filter((f) => f.severity !== 'note');
      expect(serious, formatTest(r)).toEqual([]);

      // Every example lands its own act, with the free text left clean.
      const pw0 = await import('playwright');
      const br = await pw0.chromium.launch({ executablePath: exe! });
      const pg = await br.newPage();
      await pg.goto('file://' + file);
      for (const [i, a] of acts.entries()) {
        await pg.click(`#scenes button:nth-child(${i + 1})`);
        await pg.waitForTimeout(60);
        const stage = await pg.locator('#stage').innerText();
        expect(stage, `example for ${a.name}`).not.toMatch(/Nothing in the proposal answers/);
      }
      await pg.click('#scenes button:nth-child(1)'); await pg.waitForTimeout(60);
      const first = (await pg.locator('#stage').innerText()).replace(/\s+/g, ' ');
      await br.close();
      expect(first).toContain('CHORES');
      expect(first).toContain('Add dishes for Maya tomorrow');

      // And a money example waits for a yes rather than "paying".
      const pw = await import('playwright');
      const browser = await pw.chromium.launch({ executablePath: exe! });
      const page = await browser.newPage();
      await page.goto('file://' + file);
      await page.fill('#say', 'pay Maya 20 dollars'); await page.click('button.say');
      await page.waitForTimeout(2500);
      const text = await page.locator('#stage').innerText();
      const log = await page.locator('#log').innerText();
      await browser.close();
      expect(text).toMatch(/needs a yes|Do it/);
      expect(log).not.toMatch(/pay allowance —/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
