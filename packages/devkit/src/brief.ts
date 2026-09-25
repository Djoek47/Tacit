/**
 * The brief: a project explained the way its author already writes notes.
 *
 * From the notes this was built from: "explain the entire project —
 * exceptions, features, design, references — like an intuitive mood board;
 * explain how menus follow one another; a map of expectations." That is a
 * document people write anyway. So the brief is Markdown with a handful of
 * recognised headings, and everything else in it is kept, not rejected:
 *
 *   # Name
 *   One or two lines on what it is.        -> purpose
 *   Audience: who it is for                 -> audience
 *
 *   ## Features       - Add a task for someone — asks who, what, when
 *   ## Menus          - Home -> Tasks, Calendar, Settings
 *   ## Design         - mood: calm, glass   - colour: #5B6CFF   - font: …
 *   ## References     - https://…  or free text
 *   ## Exceptions     - kids cannot approve their own rewards
 *   ## Expectations   - adding a task takes one sentence
 *
 * Headings are matched loosely (French too: Fonctionnalités, Menus, Design,
 * Références, Exceptions, Attentes), bullets may be -, * or •, and a heading
 * nobody recognises goes to `other` with its lines intact.
 */

export type Feature = {
  /** The line as written. */
  text: string;
  /** The words after "asks" / "needs" / "demande": what it has to know. */
  asks: string[];
};

export type Menu = { name: string; leadsTo: string[] };

export type Brief = {
  name: string;
  purpose: string;
  audience: string;
  features: Feature[];
  menus: Menu[];
  design: { mood: string[]; colours: string[]; fonts: string[]; notes: string[] };
  references: string[];
  exceptions: string[];
  expectations: string[];
  other: Record<string, string[]>;
};

const SECTION: Record<string, keyof Brief | 'design'> = {
  features: 'features', feature: 'features', fonctionnalites: 'features', fonctionnalités: 'features', proposal: 'features',
  menus: 'menus', menu: 'menus', navigation: 'menus', flow: 'menus', logic: 'menus',
  design: 'design', look: 'design', style: 'design',
  references: 'references', reference: 'references', références: 'references', inspiration: 'references', moodboard: 'references',
  exceptions: 'exceptions', exception: 'exceptions', rules: 'exceptions', règles: 'exceptions',
  expectations: 'expectations', expectation: 'expectations', attentes: 'expectations', testing: 'expectations', tests: 'expectations',
};

const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
const clean = (s: string) => s.replace(bullet, '').trim();

function parseAsks(line: string): string[] {
  const m = /(?:—|--|-|:)\s*(?:asks?|needs?|demande|wants?)\s+(.+)$/i.exec(line)
    ?? /\b(?:asks?|needs?|demande)\s+(.+)$/i.exec(line);
  if (!m) return [];
  return m[1]!.split(/,|\band\b|\bet\b/).map((s) => s.trim().replace(/[.;]$/, '').toLowerCase()).filter(Boolean);
}

export function parseBrief(md: string): Brief {
  const b: Brief = {
    name: '', purpose: '', audience: '', features: [], menus: [],
    design: { mood: [], colours: [], fonts: [], notes: [] },
    references: [], exceptions: [], expectations: [], other: {},
  };
  let section: string | null = null;
  const intro: string[] = [];

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const h1 = /^#\s+(.+)/.exec(line);
    if (h1 && !b.name) { b.name = h1[1]!.trim(); section = null; continue; }
    const h = /^#{2,4}\s+(.+)/.exec(line) ?? (/^([A-Za-zÀ-ÿ ]{3,30}):?\s*$/.exec(line.trim()) && !bullet.test(line) ? /^(.+?):?\s*$/.exec(line.trim()) : null);
    if (h) {
      const key = h[1]!.trim().toLowerCase().replace(/[^a-zà-ÿ ]/g, '').trim();
      const first = key.split(' ')[0]!;
      section = SECTION[key] ?? SECTION[first] ?? `other:${h[1]!.trim()}`;
      continue;
    }

    const text = clean(line);
    if (!section) {
      const aud = /^(?:audience|for|pour|public)\s*:\s*(.+)/i.exec(text);
      if (aud) b.audience = aud[1]!.trim();
      else intro.push(text);
      continue;
    }

    switch (section) {
      case 'features': b.features.push({ text, asks: parseAsks(text) }); break;
      case 'menus': {
        const m = /^(.+?)\s*(?:->|→|=>|leads to|mène à)\s*(.+)$/i.exec(text);
        if (m) b.menus.push({ name: m[1]!.trim(), leadsTo: m[2]!.split(/,|\band\b/).map((s) => s.trim()).filter(Boolean) });
        else b.menus.push({ name: text, leadsTo: [] });
        break;
      }
      case 'design': {
        const kv = /^(mood|colou?rs?|couleurs?|fonts?|police|typeface)\s*:\s*(.+)$/i.exec(text);
        const hexes = text.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
        if (kv && /^mood/i.test(kv[1]!)) b.design.mood.push(...kv[2]!.split(',').map((s) => s.trim()).filter(Boolean));
        else if (kv && /^(font|police|typeface)/i.test(kv[1]!)) b.design.fonts.push(...kv[2]!.split(',').map((s) => s.trim()).filter(Boolean));
        else if (hexes.length) b.design.colours.push(...hexes.map((h) => h.toUpperCase()));
        else b.design.notes.push(text);
        break;
      }
      case 'references': b.references.push(text); break;
      case 'exceptions': b.exceptions.push(text); break;
      case 'expectations': b.expectations.push(text); break;
      default: {
        const k = section.replace(/^other:/, '');
        (b.other[k] ??= []).push(text);
      }
    }
  }

  b.purpose = intro.join(' ');
  return b;
}
