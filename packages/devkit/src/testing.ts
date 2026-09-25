/**
 * Using the app the way a person would, and saying what is wrong the way a
 * person would.
 *
 * From the notes: "the AI uses the created project on phone and PC; sees the
 * design live, finds what is wrong and explains it like a human; checks that
 * menus are properly laid out on every device and small screen, usable and
 * up to standard; sees errors from the console; uses the site as a user to
 * find bugs."
 *
 * So: open the app in a real browser at a phone, a tablet and a desktop size;
 * optionally walk it (click this, type that); then look for the things a
 * careful tester would flag, and write each one as a sentence with where it is.
 *
 *   console      errors, uncaught exceptions, requests that failed
 *   sideways     the page scrolls horizontally, and which element is too wide
 *   fingertips   tap targets smaller than 44 px on touch sizes
 *   cut off      text clipped by its box
 *   tiny text    below 12 px on a phone
 *   alt          images with no description
 *   cards        a card inside a card (the EUI rule)
 *   steps        a step that could not be done — the bug a user would hit
 *
 * Playwright is loaded when this runs, not when the package loads, so the
 * rest of the devkit works where no browser is installed.
 */

export type Viewport = { name: string; width: number; height: number; touch: boolean };

export const VIEWPORTS: Viewport[] = [
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
];

export type Step =
  | { click: string }
  | { fill: [selector: string, text: string] }
  | { press: string }
  | { wait: number };

export type TestFinding = {
  rule: 'console' | 'sideways' | 'fingertips' | 'cut-off' | 'tiny-text' | 'alt' | 'cards' | 'step' | 'load';
  severity: 'error' | 'warn' | 'note';
  /** A sentence a person would say. */
  says: string;
  where?: string;
};

export type ViewReport = { viewport: Viewport; findings: TestFinding[]; screenshot?: string };
export type TestReport = { url: string; views: ViewReport[]; clean: boolean };

export type TestOptions = {
  steps?: Step[];
  viewports?: Viewport[];
  /** Where to write one screenshot per viewport. Omit for none. */
  screenshotDir?: string;
  /** Browser binary. Defaults to $HEPTA_CHROMIUM, then Playwright's own. */
  executablePath?: string;
  /** Extra time after load and after each step, for animations to settle. */
  settleMs?: number;
};

type Probe = {
  overflow: { width: number; offenders: { what: string; right: number }[] };
  small: { what: string; w: number; h: number }[];
  clipped: string[];
  tiny: string[];
  noAlt: string[];
  nestedCards: number;
};

/**
 * Runs inside the page. Self-contained: it is serialised and sent to the browser.
 *
 * `vw` is the device's real width, passed in. On a phone the browser zooms
 * out to fit content that is too wide, so `innerWidth` grows to match the
 * mistake and nothing looks wide from inside the page.
 */
function probePage(vw: number): Probe {
  const describe = (el: Element): string => {
    const h = el as HTMLElement;
    const text = (h.innerText || h.getAttribute('aria-label') || h.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const tag = el.tagName.toLowerCase();
    const id = h.id ? `#${h.id}` : '';
    const cls = !id && typeof h.className === 'string' && h.className.trim() ? '.' + h.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${tag}${id}${cls}${text ? ` "${text}"` : ''}`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const all = Array.from(document.querySelectorAll('body *'));

  const wide = all.filter((el) => visible(el)).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.right > vw + 1);
  // The outermost only: a wide child of a wide parent is one problem, not two.
  const offenders = wide.filter(({ el }) => !wide.some((o) => o.el !== el && o.el.contains(el)))
    .slice(0, 3).map(({ el, r }) => ({ what: describe(el), right: Math.round(r.right) }));

  const interactive = all.filter((el) => el.matches('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [onclick]') && visible(el));
  const small = interactive
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    // Links inside running text are exempt; the standard allows them.
    .filter(({ el }) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
    .slice(0, 8)
    .map(({ el, r }) => ({ what: describe(el), w: Math.round(r.width), h: Math.round(r.height) }));

  const clippedEls = all.filter((el) => {
    if (!visible(el) || !(el as HTMLElement).innerText?.trim()) return false;
    const s = getComputedStyle(el);
    const hides = ['hidden', 'clip'].includes(s.overflowX) || ['hidden', 'clip'].includes(s.overflowY);
    if (!hides) return false;
    const h = el as HTMLElement;
    return h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1;
  });
  const clipped = clippedEls.filter((el) => !clippedEls.some((o) => o !== el && o.contains(el))).slice(0, 5).map(describe);

  const tiny = vw < 600 ? all.filter((el) => {
    if (!visible(el)) return false;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 2);
    const cs = getComputedStyle(el);
    // Spaced capitals — a kicker, a label — are a deliberate small size, and
    // the EUI language sets its kicker at 11 px caps +1.3. Flagging them would
    // make the tester argue with the design system on every run.
    const kicker = cs.textTransform === 'uppercase' && parseFloat(cs.letterSpacing) >= 0.5;
    return own && !kicker && parseFloat(cs.fontSize) < 12;
  }).slice(0, 5).map(describe) : [];

  const noAlt = Array.from(document.images).filter((i) => visible(i) && !i.hasAttribute('alt')).slice(0, 5)
    .map((i) => {
      const src = i.getAttribute('src') ?? '';
      return src.startsWith('data:') ? 'an inline image' : src.split('/').pop()!.slice(0, 40) || 'an image';
    });
  const nestedCards = document.querySelectorAll('.eui-card .eui-card').length;

  return { overflow: { width: document.documentElement.scrollWidth, offenders }, small, clipped, tiny, noAlt, nestedCards };
}

function describeStep(s: Step): string {
  if ('click' in s) return `click ${s.click}`;
  if ('fill' in s) return `type "${s.fill[1]}" into ${s.fill[0]}`;
  if ('press' in s) return `press ${s.press}`;
  return `wait ${s.wait} ms`;
}

export async function testApp(url: string, opts: TestOptions = {}): Promise<TestReport> {
  const pw = await import('playwright');
  const executablePath = opts.executablePath ?? process.env.HEPTA_CHROMIUM;
  const browser = await pw.chromium.launch(executablePath ? { executablePath } : {});
  const settle = opts.settleMs ?? 300;
  const views: ViewReport[] = [];

  try {
    for (const vp of opts.viewports ?? VIEWPORTS) {
      const findings: TestFinding[] = [];
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch && vp.width < 600 });
      page.on('console', (m) => {
        if (m.type() === 'error') findings.push({ rule: 'console', severity: 'error', says: `The console shows an error: ${m.text().slice(0, 200)}` });
      });
      page.on('pageerror', (e) => findings.push({ rule: 'console', severity: 'error', says: `A script on the page crashed: ${e.message.slice(0, 200)}` }));
      page.on('requestfailed', (r) => findings.push({ rule: 'console', severity: 'warn', says: `Something failed to load: ${r.url().slice(0, 120)} (${r.failure()?.errorText ?? 'failed'})` }));
      page.on('response', (r) => { if (r.status() >= 400) findings.push({ rule: 'console', severity: 'warn', says: `The server answered ${r.status()} for ${r.url().slice(0, 120)}` }); });

      try {
        await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
      } catch (e) {
        findings.push({ rule: 'load', severity: 'error', says: `The page did not open: ${(e as Error).message.split('\n')[0]}` });
        views.push({ viewport: vp, findings });
        await page.close();
        continue;
      }
      await page.waitForTimeout(settle);

      for (const [i, s] of (opts.steps ?? []).entries()) {
        try {
          if ('click' in s) await page.click(s.click, { timeout: 3000 });
          else if ('fill' in s) await page.fill(s.fill[0], s.fill[1], { timeout: 3000 });
          else if ('press' in s) await page.keyboard.press(s.press);
          else await page.waitForTimeout(s.wait);
          await page.waitForTimeout(settle);
        } catch (e) {
          const why = /Timeout/.test((e as Error).message) ? 'it was not there, or could not be used' : (e as Error).message.split('\n')[0];
          findings.push({ rule: 'step', severity: 'error', says: `On a ${vp.name}, step ${i + 1} (${describeStep(s)}) could not be done: ${why}. A user would be stuck here.` });
          break;
        }
      }

      const p = (await page.evaluate(probePage, vp.width)) as Probe;
      const on = `On a ${vp.name} (${vp.width} px)`;
      if (p.overflow.width > vp.width + 1) {
        findings.push({ rule: 'sideways', severity: 'error',
          says: `${on}, the page scrolls sideways: it is ${p.overflow.width} px wide.${p.overflow.offenders.length ? ` Too wide: ${p.overflow.offenders.map((o) => `${o.what} reaches ${o.right} px`).join('; ')}.` : ''}`,
          ...(p.overflow.offenders[0] ? { where: p.overflow.offenders[0].what } : {}) });
      }
      if (vp.touch && p.small.length) {
        findings.push({ rule: 'fingertips', severity: 'warn',
          says: `${on}, ${p.small.length >= 8 ? 'at least 8' : p.small.length} thing${p.small.length === 1 ? ' is' : 's are'} smaller than a fingertip (44 px): ${p.small.slice(0, 4).map((s) => `${s.what} is ${s.w}×${s.h}`).join('; ')}.`,
          where: p.small[0]!.what });
      }
      for (const c of p.clipped) findings.push({ rule: 'cut-off', severity: 'warn', says: `${on}, text is cut off inside ${c}.`, where: c });
      if (p.tiny.length) findings.push({ rule: 'tiny-text', severity: 'note', says: `${on}, some text is under 12 px and hard to read: ${p.tiny.slice(0, 3).join('; ')}.` });
      if (p.noAlt.length) findings.push({ rule: 'alt', severity: 'note', says: `${p.noAlt.length} image${p.noAlt.length === 1 ? ' has' : 's have'} no description for screen readers: ${p.noAlt.join(', ')}.` });
      if (p.nestedCards) findings.push({ rule: 'cards', severity: 'warn', says: `${on}, a card sits inside a card (${p.nestedCards}×). Rows inside a card should be tints, not cards.` });

      let screenshot: string | undefined;
      if (opts.screenshotDir) {
        screenshot = `${opts.screenshotDir.replace(/\/$/, '')}/${vp.name}.png`;
        await page.screenshot({ path: screenshot, fullPage: true });
      }
      views.push({ viewport: vp, findings, ...(screenshot ? { screenshot } : {}) });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // The same console error on every size is one problem, said once.
  const seen = new Set<string>();
  for (const v of views) {
    v.findings = v.findings.filter((f) => {
      if (f.rule !== 'console') return true;
      if (seen.has(f.says)) return false;
      seen.add(f.says);
      return true;
    });
  }
  return { url, views, clean: views.every((v) => v.findings.every((f) => f.severity === 'note')) };
}

/** The report as a tester would write it. */
export function formatTest(r: TestReport): string {
  const lines = [`Tested ${r.url}`];
  for (const v of r.views) {
    lines.push('', `${v.viewport.name} — ${v.viewport.width}×${v.viewport.height}`);
    if (!v.findings.length) lines.push('  Nothing wrong that I could see.');
    for (const f of v.findings) lines.push(`  ${f.severity === 'error' ? '✗' : f.severity === 'warn' ? '!' : '·'} ${f.says}`);
    if (v.screenshot) lines.push(`  screenshot: ${v.screenshot}`);
  }
  lines.push('', r.clean ? 'Clean: nothing a person would trip on.' : 'Not clean yet.');
  return lines.join('\n');
}
