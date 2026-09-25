/**
 * Amounts as people say them, in English and French.
 *
 * The first version read the first number it found and confirmed it. The
 * harder suite showed what that costs: "a hundred and twenty dollars" became
 * $20, "twelve dollars and fifty cents" became $12, "twenty, sorry, thirty"
 * became $20, and "fifteen fifty" became 65. All four were confident, and all
 * four would have committed on silence.
 *
 * So this finds every amount in the sentence first, then decides how sure to be:
 *
 *   one amount                          confident
 *   several, one of them has a currency that one, confident
 *   several, the speaker corrected      the last one, as a guess the stage shows
 *   several, nothing to tell them apart none; the person picks
 *   "fifteen fifty"                     both readings, equally; the person picks
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
  // French. "un"/"une" are also articles ("une pizza"), so they count only inside a number.
  deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, septante: 70, huitante: 80, nonante: 90,
};
const SCALE: Record<string, number> = { hundred: 100, cent: 100, cents: 100, thousand: 1000, mille: 1000 };
const ARTICLE = new Set(['a', 'an', 'un', 'une']);
const JOIN = new Set(['and', 'et']);

export const CURRENCY: Record<string, string> = {
  dollar: 'USD', dollars: 'USD', buck: 'USD', bucks: 'USD', usd: 'USD',
  euro: 'EUR', euros: 'EUR', eur: 'EUR', pound: 'GBP', pounds: 'GBP', quid: 'GBP', gbp: 'GBP',
  $: 'USD', '€': 'EUR', '£': 'GBP',
};
const SUBUNIT = new Set(['cents', 'cent', 'penny', 'pence', 'centimes', 'sous']);

/** Words that take back what was just said. */
const REVISION = ['no', 'sorry', 'i mean', 'actually', 'rather', 'make that', 'wait', 'non', 'pardon', 'plutot', 'je veux dire', 'enfin'];

export type Tok = { kind: 'num'; n: number; raw: string } | { kind: 'word'; w: string } | { kind: 'sym'; code: string } | { kind: 'break' };

function tokens(text: string): Tok[] {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const out: Tok[] = [];
  const re = /(\d+(?:[.,]\d{1,2})?)|([$€£])|([a-z]+)|([,;.!?]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    if (m[1]) out.push({ kind: 'num', n: parseFloat(m[1].replace(',', '.')), raw: m[1] });
    else if (m[2]) out.push({ kind: 'sym', code: CURRENCY[m[2]]! });
    else if (m[3]) out.push({ kind: 'word', w: m[3] });
    else out.push({ kind: 'break' });
  }
  return out;
}

const isNumberWord = (w: string) => ONES[w] !== undefined || TENS[w] !== undefined || SCALE[w] !== undefined;

/**
 * Read one spoken number starting at `i`. Stops where the words stop being one
 * number, and at a juxtaposition ("fifteen fifty"), which it reports.
 */
function readWords(toks: Tok[], i: number, subunit = false): { n: number; end: number; juxtaposed: boolean } | null {
  let total = 0, current = 0, seen = false, last: 'ones' | 'tens' | 'scale' | null = null;
  let j = i;
  const word = (k: number) => (toks[k]?.kind === 'word' ? (toks[k] as { w: string }).w : undefined);

  for (; j < toks.length; j++) {
    const w = word(j);
    if (w === undefined) break;
    const nextW = word(j + 1);
    if (ARTICLE.has(w)) {
      // "a hundred", "un million"… and "vingt et un".
      if (!seen && nextW && SCALE[nextW] !== undefined) { current = 1; seen = true; last = 'ones'; continue; }
      if (seen && (w === 'un' || w === 'une') && last === 'tens') { current += 1; last = 'ones'; continue; }
      break;
    }
    if (JOIN.has(w)) {
      // "a hundred and twenty", "vingt et un": only inside a number, before more of it.
      if (seen && nextW && (isNumberWord(nextW) || nextW === 'un' || nextW === 'une')) continue;
      break;
    }
    if (w === 'quatre' && (nextW === 'vingt' || nextW === 'vingts')) { current += 80; j++; seen = true; last = 'tens'; continue; }
    if (SCALE[w] !== undefined) {
      // After a currency, "cents" names the subunit ("fifty cents"); the caller reads it.
      if (subunit && (w === 'cents' || w === 'cent')) break;
      // French "cent" and "mille" need no article: "cent vingt" is 120.
      if (!seen && (w === 'cent' || w === 'mille')) { current = SCALE[w]!; seen = true; last = 'scale'; if (w === 'mille') { total = 1000; current = 0; } continue; }
      if (!seen) break;
      const s = SCALE[w]!;
      if (s >= 1000) { total += (current || 1) * s; current = 0; } else { current = (current || 1) * s; }
      last = 'scale';
      continue;
    }
    if (TENS[w] !== undefined) {
      if (seen && (last === 'tens' || (last === 'ones' && current % 100 !== 0))) {
        // "fifteen fifty", "twenty thirty": two numbers side by side.
        return { n: total + current, end: j, juxtaposed: true };
      }
      current += TENS[w]!; seen = true; last = 'tens'; continue;
    }
    if (ONES[w] !== undefined) {
      const v = ONES[w]!;
      if (seen && last === 'tens') {
        const tens = current % 100;
        // English tens take 1–9 ("twenty five"); French 60 and 80 take 10–19 ("soixante-douze").
        const ok = v < 10 || ((tens === 60 || tens === 80) && v >= 10 && v < 20);
        if (!ok) return { n: total + current, end: j, juxtaposed: true };
      } else if (seen && last === 'ones') {
        // "dix sept" is 17 in French; "twelve five" is two numbers.
        if (!(current % 100 === 10 && v < 10)) return { n: total + current, end: j, juxtaposed: true };
      }
      current += v; seen = true; last = 'ones'; continue;
    }
    break;
  }
  return seen ? { n: total + current, end: j, juxtaposed: false } : null;
}

export type Amount = { n: number; code?: string; start: number; end: number; alternatives?: number[] };

/** Every amount in the sentence, in order. */
export function amounts(text: string): { found: Amount[]; toks: Tok[] } {
  const toks = tokens(text);
  const found: Amount[] = [];
  const currencyAt = (k: number): string | undefined => {
    const t = toks[k];
    if (!t) return undefined;
    if (t.kind === 'sym') return t.code;
    if (t.kind === 'word') return CURRENCY[t.w];
    return undefined;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    let a: Amount | null = null;

    if (t.kind === 'sym' && toks[i + 1]?.kind === 'num') {
      a = { n: (toks[i + 1] as { n: number }).n, code: t.code, start: i, end: i + 2 };
    } else if (t.kind === 'num') {
      // A time of day is not an amount: "5pm", "9 h".
      const nx = toks[i + 1];
      if (nx?.kind === 'word' && ['am', 'pm', 'h', 'oclock'].includes(nx.w)) continue;
      const code = currencyAt(i + 1);
      a = { n: t.n, ...(code ? { code } : {}), start: i, end: code ? i + 2 : i + 1 };
    } else if (t.kind === 'word' && (isNumberWord(t.w) || ARTICLE.has(t.w))) {
      const r = readWords(toks, i);
      if (!r || r.end === i) continue;
      if (r.juxtaposed) {
        const second = readWords(toks, r.end);
        if (second && !second.juxtaposed && r.n < 100 && second.n < 100) {
          const code = currencyAt(second.end);
          found.push({ n: r.n, ...(code ? { code } : {}), start: i, end: second.end + (code ? 1 : 0),
            alternatives: [r.n + second.n / 100, r.n * 100 + second.n] });
          i = second.end - 1 + (code ? 1 : 0);
          continue;
        }
      }
      const code = currencyAt(r.end);
      a = { n: r.n, ...(code ? { code } : {}), start: i, end: code ? r.end + 1 : r.end };
    }
    if (!a) continue;

    // "twelve dollars and fifty cents", "douze dollars cinquante".
    if (a.code) {
      let k = a.end;
      const w = toks[k]?.kind === 'word' ? (toks[k] as { w: string }).w : undefined;
      if (w && JOIN.has(w)) k++;
      const sub = toks[k]?.kind === 'num' ? { n: (toks[k] as { n: number }).n, end: k + 1 } : readWords(toks, k, true);
      const after = toks[sub?.end ?? -1];
      const named = after?.kind === 'word' && SUBUNIT.has(after.w);
      const french = !!sub && k === a.end && !named; // "douze dollars cinquante": no "and", no "cents"
      if (sub && sub.n > 0 && sub.n < 100 && Number.isInteger(a.n) && (named || french)) {
        a = { ...a, n: a.n + sub.n / 100, end: sub.end + (named ? 1 : 0) };
      }
    }
    found.push(a);
    i = a.end - 1;
  }
  return { found, toks };
}

/** Was something taken back between these two token positions? */
export function revisedBetween(toks: readonly Tok[], from: number, to: number): boolean {
  const between = toks.slice(from, to).filter((t) => t.kind === 'word').map((t) => (t as { w: string }).w).join(' ');
  return REVISION.some((r) => new RegExp(`(^|\\s)${r}(\\s|$)`).test(between));
}

/** Kept for other grammars (days, durations): a bare run of number words. */
export function wordsToNumber(words: string[]): number | null {
  // Leading words that are not a number are skipped: "for twenty minutes" is 20.
  const toks: Tok[] = words.map((w) => ({ kind: 'word', w }));
  for (let i = 0; i < toks.length; i++) {
    const r = readWords(toks, i);
    if (r && r.end > i) return r.n;
  }
  return null;
}

/**
 * Could the number at the end of this unfinished sentence still grow?
 * "going to be four" may become "four hundred"; a detector that compares
 * numbers must wait for the next word before it believes this one.
 */
export function endsInOpenNumber(text: string): boolean {
  const toks = tokens(text);
  const last = toks[toks.length - 1];
  if (!last) return false;
  const before = toks[toks.length - 2];
  const prev = before?.kind === 'word' ? before.w : '';
  if (last.kind === 'word') {
    if (isNumberWord(last.w)) return true;
    // "six hundred and…" and "vingt et…" are still growing; "fifty and…" and "650 and…" are not.
    if (last.w === 'and') return SCALE[prev] !== undefined;
    if (last.w === 'et') return SCALE[prev] !== undefined || TENS[prev] !== undefined;
    // "going to be a…" may be "a hundred"; "va être de…" is about to say one.
    return ARTICLE.has(last.w) || last.w === 'de';
  }
  // Digits arrive whole from a recognizer; a currency symbol waits for its number.
  return last.kind === 'sym';
}
