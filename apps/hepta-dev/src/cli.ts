/**
 * hepta-dev — the developer tools on the command line, or as an MCP server.
 *
 *   hepta-dev init                       write a BRIEF.md to start from
 *   hepta-dev brief     [BRIEF.md]       read it; check how the menus connect
 *   hepta-dev draft     [BRIEF.md]       the acts it implies, and why
 *   hepta-dev scaffold  [BRIEF.md] [dir] a runnable MCP server   (--overwrite)
 *   hepta-dev prototype [BRIEF.md] [out] a clickable prototype   (--overwrite)
 *   hepta-dev test      <url>            use it like a person    (--steps file.json --shots dir)
 *   hepta-dev search    <words…>         the code, its history, the chats (--chat file)
 *   hepta-dev evolution [repo]           how it got here
 *   hepta-dev dossier   [repo]           what a rebuild starts from (--brief BRIEF.md)
 *   hepta-dev mcp                        serve all of the above over MCP (stdio)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  parseBrief, mapMenus, mermaid, draftFromBrief, scaffold, prototype, testApp, formatTest,
  repoSource, transcriptSource, evolution, formatEvolution, dossier, createDevServer, type Step,
} from '../../../packages/devkit/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const runtime = () => readFileSync(join(HERE, 'runtime.js'), 'utf8');

const TEMPLATE = `# Your app's name
One or two sentences: what it does, and why someone would want it.
Audience: who it is for

## Features
- Add a task for someone — asks who, what, when
- Pay allowance — asks who, amount
- Add groceries — asks what

## Menus
- Home -> Tasks, Settings
- Settings -> Members

## Design
- mood: calm, clear
- colour: #5B6CFF
- font: Bricolage Grotesque

## References
- an app or a page whose feel you want

## Exceptions
- things it must never do, or never let someone do

## Expectations
- adding a task takes one sentence
- works on a small phone
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const positional = (args: string[]) => args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--') && !['--overwrite'].includes(args[i - 1]!)));

function write(path: string, body: string, overwrite: boolean): void {
  if (existsSync(path) && !overwrite) throw new Error(`${path} exists. Add --overwrite to replace it.`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  console.log(`wrote ${path}`);
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const args = positional(rest);
  const overwrite = rest.includes('--overwrite');
  const briefAt = (p = 'BRIEF.md') => {
    if (!existsSync(p)) throw new Error(`No ${p} here. Run "hepta-dev init" to start one.`);
    return parseBrief(readFileSync(p, 'utf8'));
  };

  switch (cmd) {
    case 'init':
      write(args[0] ?? 'BRIEF.md', TEMPLATE, overwrite);
      console.log('Describe the app in your own words, then run "hepta-dev draft".');
      return;
    case 'brief': {
      const b = briefAt(args[0]);
      const m = mapMenus(b.menus);
      console.log(`${b.name}: ${b.features.length} features, ${b.menus.length} menus, ${b.expectations.length} expectations`);
      for (const i of m.issues) console.log(`  ${i.level.padEnd(5)} ${i.message}`);
      console.log('\n' + mermaid(m));
      return;
    }
    case 'draft': {
      const d = draftFromBrief(briefAt(args[0]));
      for (const a of d.acts) {
        console.log(`${a.name}  (${a.radius})  ${a.feature}`);
        console.log(`  slots  ${Object.entries(a.slots).map(([k, s]) => `${k}:${s.primitive}`).join(', ')}`);
        console.log(`  why    ${a.why.join(' ')}`);
      }
      if (d.notes.length) console.log('\nDecide:\n' + d.notes.map((n) => `  - ${n}`).join('\n'));
      return;
    }
    case 'scaffold': {
      const b = briefAt(args[0]);
      const dir = args[1] ?? 'app';
      const files = scaffold(b, draftFromBrief(b));
      if (!overwrite) for (const f of Object.keys(files)) if (existsSync(join(dir, f))) throw new Error(`${join(dir, f)} exists. Add --overwrite to replace it. Nothing was written.`);
      for (const [f, body] of Object.entries(files)) write(join(dir, f), body, overwrite);
      console.log(`\nNext: cd ${dir} && npm install && node ${resolve(HERE, '../hepta/hepta.mjs')} --config hepta.config.json`);
      return;
    }
    case 'prototype':
      write(args[1] ?? 'prototype.html', prototype(briefAt(args[0]), runtime()), overwrite);
      return;
    case 'test': {
      if (!args[0]) throw new Error('Which URL? e.g. hepta-dev test http://localhost:3000');
      const stepsFile = flag(rest, '--steps');
      const steps = stepsFile ? (JSON.parse(readFileSync(stepsFile, 'utf8')) as Step[]) : undefined;
      const shots = flag(rest, '--shots');
      if (shots) mkdirSync(shots, { recursive: true });
      const r = await testApp(args[0], { ...(steps ? { steps } : {}), ...(shots ? { screenshotDir: shots } : {}) });
      console.log(formatTest(r));
      process.exitCode = r.clean ? 0 : 1;
      return;
    }
    case 'search': {
      const chat = flag(rest, '--chat');
      const sources = [repoSource('.'), ...(chat ? [transcriptSource(chat)] : [])];
      const found = (await Promise.all(sources.map((s) => s.read(args.join(' '))))).flat().sort((a, b) => b.confidence - a.confidence).slice(0, 15);
      console.log(found.length ? found.map((f) => `${f.source}  ${f.claim}`).join('\n') : 'Nothing matched.');
      return;
    }
    case 'evolution':
      console.log(formatEvolution(evolution(args[0] ?? '.')));
      return;
    case 'dossier': {
      const bp = flag(rest, '--brief') ?? (existsSync('BRIEF.md') ? 'BRIEF.md' : undefined);
      console.log(dossier({ repoDir: args[0] ?? '.', ...(bp ? { brief: briefAt(bp) } : {}) }));
      return;
    }
    case 'mcp':
      await createDevServer({ root: process.cwd(), runtime, ...(process.env.HEPTA_CHROMIUM ? { executablePath: process.env.HEPTA_CHROMIUM } : {}) })
        .connect(new StdioServerTransport());
      return;
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)?.[1]?.replace(/^ \* ?/gm, '') ?? 'hepta-dev');
  }
}

main(process.argv.slice(2)).catch((e) => { console.error(`hepta-dev: ${(e as Error).message}`); process.exit(1); });
