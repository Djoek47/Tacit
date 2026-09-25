/**
 * Context: what the aggregator reads for a developer.
 *
 * From the notes: "remember conversations to keep context; re-read multiple
 * GitHub repositories or project changes; remember the entire chat." Each is
 * a source the pyramid's aggregator can gather from, so a question like "why
 * did we drop the second card?" searches the code, the history and the chat
 * together.
 *
 * Local and read-only: files on disk, `git log`, transcripts. Nothing here
 * writes, and nothing leaves the machine.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

export type Finding = { source: string; claim: string; value?: unknown; confidence: number; calibrated: boolean };
export type Source = { readonly name: string; readonly local: boolean; read(query: string): Promise<Finding[]> };

const TEXT = new Set(['.md', '.mdx', '.txt', '.ts', '.tsx', '.js', '.mjs', '.jsx', '.json', '.html', '.css', '.py', '.swift', '.kt', '.go', '.rs', '.yml', '.yaml', '.toml']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo', '.cache']);
const MAX_FILE = 200_000;
const MAX_FILES = 3000;

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter((w) => w.length > 2));

function* walk(dir: string, root = dir, n = { count: 0 }): Generator<string> {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (n.count >= MAX_FILES) return;
    if (SKIP.has(e) || e.startsWith('.') && e !== '.github') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p, root, n);
    else if (TEXT.has(extname(e)) && st.size <= MAX_FILE) { n.count++; yield p; }
  }
}

type Line = { where: string; text: string; bag: Set<string> };

function score(q: Set<string>, bag: Set<string>): number {
  let s = 0;
  for (const w of q) if (bag.has(w)) s++;
  return s;
}

function rank(lines: Line[], query: string, source: string, limit: number): Finding[] {
  const q = words(query);
  if (!q.size) return [];
  return lines
    .map((l) => ({ l, s: score(q, l.bag) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ l, s }) => ({ source, claim: `${l.where}: ${l.text.slice(0, 240)}`, confidence: Math.min(1, s / q.size), calibrated: false }));
}

/** A repository: its files and its commit history, searched by words. */
export function repoSource(dir: string, opts: { limit?: number } = {}): Source {
  const name = `repo/${basename(dir)}`;
  let cache: Line[] | null = null;
  const load = (): Line[] => {
    if (cache) return cache;
    const lines: Line[] = [];
    for (const file of walk(dir)) {
      let text = '';
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      const rel = relative(dir, file);
      text.split('\n').forEach((t, i) => {
        const trimmed = t.trim();
        if (trimmed.length > 3) lines.push({ where: `${rel}:${i + 1}`, text: trimmed, bag: words(`${rel} ${trimmed}`) });
      });
    }
    for (const c of gitLog(dir, 500)) lines.push({ where: `commit ${c.hash} (${c.date})`, text: c.subject, bag: words(c.subject + ' ' + c.body) });
    cache = lines;
    return lines;
  };
  return { name, local: true, async read(query) { return rank(load(), query, name, opts.limit ?? 6); } };
}

/**
 * A chat transcript: Markdown, plain text or JSONL (one {role, content} per
 * line). "Remember the entire chat" — every turn is searchable, with who said it.
 */
export function transcriptSource(path: string, opts: { limit?: number } = {}): Source {
  const name = `chat/${basename(path)}`;
  let cache: Line[] | null = null;
  const load = (): Line[] => {
    if (cache) return cache;
    const raw = readFileSync(path, 'utf8');
    const turns: { who: string; text: string }[] = [];
    if (path.endsWith('.jsonl')) {
      for (const l of raw.split('\n')) {
        try {
          const o = JSON.parse(l) as { role?: string; type?: string; content?: unknown; message?: { role?: string; content?: unknown } };
          const role = o.role ?? o.message?.role ?? o.type ?? 'unknown';
          const c = o.content ?? o.message?.content;
          const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p?.text ?? '').join(' ') : '';
          if (text.trim()) turns.push({ who: role, text });
        } catch { /* not a JSON line */ }
      }
    } else {
      let who = 'note';
      let buf: string[] = [];
      const flush = () => { if (buf.join(' ').trim()) turns.push({ who, text: buf.join(' ') }); buf = []; };
      for (const l of raw.split('\n')) {
        const m = /^(?:#+\s*)?(user|assistant|human|claude|me|you|moi|[A-Z][a-z]+)\s*:\s*(.*)$/i.exec(l.trim());
        if (m) { flush(); who = m[1]!.toLowerCase(); buf.push(m[2]!); }
        else if (!l.trim()) flush();
        else buf.push(l.trim());
      }
      flush();
    }
    cache = turns.flatMap((t, i) => t.text.split(/(?<=[.!?])\s+/).map((s) => ({ where: `turn ${i + 1} (${t.who})`, text: s, bag: words(s) })));
    return cache;
  };
  return { name, local: true, async read(query) { return rank(load(), query, name, opts.limit ?? 6); } };
}

// ------------------------------------------------------------------- history

export type Commit = { hash: string; date: string; author: string; subject: string; body: string; files: number; added: number; removed: number };

export function gitLog(dir: string, max = 2000): Commit[] {
  let out = '';
  try {
    out = execFileSync('git', ['-C', dir, 'log', `-${max}`, '--date=short', '--numstat', '--pretty=format:\u001e%h\u001f%ad\u001f%an\u001f%s\u001f%b\u001f'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return [];
  }
  const commits: Commit[] = [];
  for (const chunk of out.split('\u001e').filter((c) => c.trim())) {
    const [hash, date, author, subject, body, stats = ''] = chunk.split('\u001f');
    let files = 0, added = 0, removed = 0;
    for (const l of stats.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t/.exec(l);
      if (!m) continue;
      files++;
      added += m[1] === '-' ? 0 : Number(m[1]);
      removed += m[2] === '-' ? 0 : Number(m[2]);
    }
    commits.push({ hash: hash!.trim(), date: date!, author: author!, subject: subject!, body: (body ?? '').trim(), files, added, removed });
  }
  return commits;
}

export type Day = { date: string; commits: Commit[]; added: number; removed: number };

/**
 * "Understand evolution": the project as a timeline, day by day, oldest
 * first — what changed, how much, and in the commits' own words.
 */
export function evolution(dir: string): Day[] {
  const byDay = new Map<string, Day>();
  for (const c of gitLog(dir).reverse()) {
    const d = byDay.get(c.date) ?? { date: c.date, commits: [], added: 0, removed: 0 };
    d.commits.push(c); d.added += c.added; d.removed += c.removed;
    byDay.set(c.date, d);
  }
  return [...byDay.values()];
}

export function formatEvolution(days: Day[], opts: { perDay?: number } = {}): string {
  if (!days.length) return 'No history: this is not a git repository, or it has no commits.';
  const lines: string[] = [];
  for (const d of days) {
    lines.push(`${d.date} — ${d.commits.length} commit${d.commits.length === 1 ? '' : 's'}, +${d.added} −${d.removed}`);
    for (const c of d.commits.slice(0, opts.perDay ?? 5)) lines.push(`  ${c.hash} ${c.subject}`);
    if (d.commits.length > (opts.perDay ?? 5)) lines.push(`  … ${d.commits.length - (opts.perDay ?? 5)} more`);
  }
  return lines.join('\n');
}
