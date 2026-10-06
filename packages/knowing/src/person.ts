/**
 * What Tacit knows about one person, and how much of the map that covers.
 *
 * Every fact keeps the person's own words next to Tacit's summary of them, so
 * the summary can always be checked against what was said. A fact Tacit
 * inferred (a trait from a game, say) is kept apart from what was said, and is
 * never used until the person has seen it and agreed.
 *
 * The person can read all of it, change any of it, and forget any of it.
 */
import { DOMAINS, THREADS, domainById, threadById, type Use } from './map.js';

export type Depth = 1 | 2 | 3;
export type Fact = {
  id: string;
  thread: string;
  domain: string;
  depth: Depth;
  /** Tacit's one-line summary. */
  text: string;
  /** What the person actually said. */
  quote: string;
  at: number;
  kind: 'stated' | 'inferred';
  /** Inferred facts start unconfirmed and are not used until confirmed. */
  confirmed: boolean;
};

export type Consent = 'yes' | 'no';
export type Snapshot = { version: 1; facts: Fact[]; consent: Record<string, Consent>; minutes: number };

export class Person {
  private facts: Fact[] = [];
  private consent: Record<string, Consent> = {};
  /** Minutes of conversation so far. Reported, never used to pressure. */
  minutes = 0;
  private n = 0;

  constructor(private readonly now: () => number = Date.now) {}

  record(f: Omit<Fact, 'id' | 'at' | 'domain' | 'confirmed' | 'kind'> & Partial<Pick<Fact, 'kind' | 'confirmed'>>): Fact {
    const th = threadById.get(f.thread);
    const domain = th?.domain ?? f.thread.split('.')[0]!;
    const kind = f.kind ?? 'stated';
    const fact: Fact = { ...f, id: `f${this.now().toString(36)}${(++this.n).toString(36)}`, domain, at: this.now(), kind, confirmed: f.confirmed ?? kind === 'stated' };
    this.facts.push(fact);
    return fact;
  }

  /** The person corrects Tacit. The quote stays; the summary changes. */
  edit(id: string, text: string): Fact | undefined {
    const f = this.facts.find((x) => x.id === id);
    if (f) { f.text = text; f.confirmed = true; }
    return f;
  }
  confirm(id: string): void { const f = this.facts.find((x) => x.id === id); if (f) f.confirmed = true; }
  forget(id: string): boolean { const before = this.facts.length; this.facts = this.facts.filter((x) => x.id !== id); return this.facts.length < before; }
  forgetThread(thread: string): number { const before = this.facts.length; this.facts = this.facts.filter((x) => x.thread !== thread); return before - this.facts.length; }

  setConsent(domain: string, c: Consent): void {
    this.consent[domain] = c;
    if (c === 'no') this.facts = this.facts.filter((f) => f.domain !== domain);
  }
  consentFor(domain: string): Consent | undefined { return this.consent[domain]; }

  /** Facts in use: everything stated, and inferences the person agreed to. */
  all(): Fact[] { return this.facts.filter((f) => f.kind === 'stated' || f.confirmed); }
  pending(): Fact[] { return this.facts.filter((f) => f.kind === 'inferred' && !f.confirmed); }
  about(thread: string): Fact[] { return this.all().filter((f) => f.thread === thread); }
  depthOf(thread: string): number { return this.about(thread).reduce((m, f) => Math.max(m, f.depth), 0); }

  /** Which threads count: everything open, and private areas the person said yes to. */
  private inScope(domain: string): boolean {
    const d = domainById.get(domain);
    return !d?.private || this.consent[domain] === 'yes';
  }

  /**
   * How much of the map is covered, 0..1. Honest about what it is: depth
   * reached over depth possible, on the threads in scope. A person who says
   * no to an area is not penalised for it.
   */
  coverage(): { overall: number; domains: { id: string; name: string; covered: number; threads: number }[] } {
    const domains = DOMAINS.filter((d) => this.inScope(d.id)).map((d) => {
      const ts = THREADS.filter((t) => t.domain === d.id);
      const got = ts.reduce((s, t) => s + this.depthOf(t.id), 0);
      return { id: d.id, name: d.name, covered: ts.length ? got / (ts.length * 3) : 0, threads: ts.length };
    });
    const total = domains.reduce((s, d) => s + d.threads * 3, 0);
    const got = domains.reduce((s, d) => s + d.covered * d.threads * 3, 0);
    return { overall: total ? got / total : 0, domains };
  }

  /**
   * What any model needs to know, fast: one line per thread, deepest summary
   * first, filtered to what a purpose uses. This is what Claude, GPT, Grok or
   * Jev get handed — never the raw transcript.
   */
  card(o: { use?: Use; maxChars?: number } = {}): string {
    const max = o.maxChars ?? 2000;
    const lines: string[] = [];
    for (const t of THREADS) {
      if (o.use && !t.uses.includes(o.use)) continue;
      const fs = this.about(t.id).sort((a, b) => b.depth - a.depth || b.at - a.at);
      if (!fs.length) continue;
      lines.push(`${t.topic}: ${fs.map((f) => f.text).slice(0, 2).join(' — ')}`);
    }
    let out = '';
    for (const l of lines) { if (out.length + l.length + 1 > max) break; out += (out ? '\n' : '') + l; }
    return out;
  }

  snapshot(): Snapshot { return { version: 1, facts: [...this.facts], consent: { ...this.consent }, minutes: this.minutes }; }
  static restore(s: Snapshot, now?: () => number): Person {
    const p = new Person(now);
    if (s?.version === 1) { p.facts = [...s.facts]; p.consent = { ...s.consent }; p.minutes = s.minutes ?? 0; }
    return p;
  }
}
