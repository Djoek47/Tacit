/**
 * From a brief to a first structure: acts, the shape, and an MCP server to
 * fill in. "Ability to structure the project; ability to create a prototype
 * from the proposal."
 *
 * Everything here is a DRAFT, and says so. Which slot a word becomes, what an
 * act costs, which domain it sits in — each is a guess from the words in the
 * brief, and each carries the reason it was made so a developer can overrule
 * it in one edit. Two guesses lean one way on purpose:
 *
 *   cost    any hint of money makes an act external; any person in it makes it
 *           at least other-person. A draft that is too careful costs a tap; one
 *           that is too loose sends money on silence.
 *   undo    every drafted write gets a paired undo tool in the scaffold, because
 *           without one the act can never be quiet, and the developer should see
 *           that choice rather than discover it.
 */

import type { Brief, Feature } from './brief.js';

export type SlotDraft = {
  primitive: 'face' | 'when' | 'quantity' | 'ghostField' | 'chip';
  order: number;
  required: boolean;
  /** For chips and faces: the name of the list it picks from. */
  catalog?: string;
  why: string;
};

export type ActDraft = {
  name: string;
  feature: string;
  phrases: string[];
  domain: string | null;
  radius: 'self' | 'shared' | 'other-person' | 'external';
  slots: Record<string, SlotDraft>;
  preview: string;
  why: string[];
};

export type Draft = {
  acts: ActDraft[];
  catalogs: string[];
  /** aiuic.shape/1, ready to serve from the scaffold's MCP server. */
  shape: Record<string, unknown>;
  notes: string[];
};

const STOP = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'my', 'our', 'their', 'some', 'with', 'on', 'in', 'into', 'and', 'or', 'un', 'une', 'le', 'la', 'les', 'des', 'pour']);
const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const PERSON = /\b(who|whom|someone|somebody|person|people|child|kid|kids|member|assignee|recipient|to whom|qui)\b/;
const TIME = /\b(when|date|time|due|day|deadline|quand|at what time)\b/;
const MONEY = /\b(amount|how much|price|cost|money|pay|payment|dollars?|\$|€|budget|combien|montant)\b/;
const FREE = /\b(what|title|name|text|note|message|description|quoi|details?)\b/;

const MONEY_ACT = /\b(pay|send money|transfer|buy|purchase|charge|refund|payer|acheter|virement|invoice|bill)\b/i;
const SEND_ACT = /\b(send|email|post|publish|share|message|text|notify|invite|envoyer|publier)\b/i;

const DOMAIN_WORDS: [RegExp, string][] = [
  [/\b(chore|chores|task|tasks|todo|to-do|tâche)\b/i, 'chores'],
  [/\b(homework|devoir|assignment)\b/i, 'homework'],
  [/\b(grocery|groceries|shopping list|milk|épicerie)\b/i, 'groceries'],
  [/\b(event|meeting|appointment|calendar|rendez-vous|schedule)\b/i, 'calendar'],
  [/\b(trip|travel|route|voyage)\b/i, 'trips'],
  [/\b(place|address|location|lieu)\b/i, 'places'],
  [/\b(reward|points|badge|récompense)\b/i, 'rewards'],
  [/\b(allowance|pay|money|budget|transfer|argent)\b/i, 'allowance'],
  [/\b(how do i|teach|explain|tutorial|comment)\b/i, 'teaching'],
];

function slotFor(word: string, order: number): [string, SlotDraft] {
  const w = word.toLowerCase().trim();
  if (PERSON.test(w)) return ['who', { primitive: 'face', order, required: true, catalog: 'people', why: `"${word}" names a person, so it picks a face from a list of people` }];
  if (TIME.test(w)) return ['when', { primitive: 'when', order, required: true, why: `"${word}" is a time; "tomorrow at 9" fills it without a model` }];
  if (MONEY.test(w)) return ['amount', { primitive: 'quantity', order, required: true, why: `"${word}" is an amount; "$12" and "twelve dollars" fill it` }];
  if (FREE.test(w)) return ['what', { primitive: 'ghostField', order, required: true, why: `"${word}" is free text: the rest of the sentence, marked as a guess until confirmed` }];
  const name = snake(w).slice(0, 32) || `choice_${order}`;
  return [name, { primitive: 'chip', order, required: true, catalog: name, why: `"${word}" is a choice from a list you provide (catalog "${name}")` }];
}

function draftAct(f: Feature, taken: Set<string>): ActDraft {
  const words = f.text.replace(/\s*(?:—|--|:).*$/, '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, '')).filter(Boolean);
  const verb = (words[0] ?? 'do').toLowerCase();
  const noun = words.slice(1).find((w) => !STOP.has(w.toLowerCase()) && w.length > 2)?.toLowerCase();
  let name = snake(noun ? `${verb}_${noun}` : verb) || 'act';
  for (let i = 2; taken.has(name); i++) name = `${snake(noun ? `${verb}_${noun}` : verb)}_${i}`;
  taken.add(name);

  const why: string[] = [];
  const slots: Record<string, SlotDraft> = {};
  let order = 0;
  const asks = f.asks.length ? f.asks : ['what'];
  if (!f.asks.length) why.push('the feature does not say what it asks, so it gets one free-text slot; add "— asks who, when" to the line to shape it');
  for (const a of asks) {
    const [k, s] = slotFor(a, ++order);
    let key = k;
    for (let i = 2; slots[key]; i++) key = `${k}_${i}`;
    slots[key] = { ...s, order };
  }

  let radius: ActDraft['radius'] = 'self';
  if (MONEY_ACT.test(f.text) || Object.values(slots).some((s) => s.primitive === 'quantity') && /\b(pay|send|transfer|give)\b/i.test(f.text)) {
    radius = 'external'; why.push('it moves money, so it always asks for a yes — no draft may make money quiet');
  } else if (SEND_ACT.test(f.text)) {
    radius = 'external'; why.push('it sends something outside the app, which cannot be unsent');
  } else if (Object.values(slots).some((s) => s.primitive === 'face') || /\bfor (someone|somebody|them|him|her)\b/i.test(f.text)) {
    radius = 'other-person'; why.push('it involves another person, so it holds longer and never commits on a guess');
  } else {
    why.push('it only affects the person asking; with an undo it can go ahead on silence');
  }

  const domain = DOMAIN_WORDS.find(([re]) => re.test(f.text))?.[1] ?? null;
  if (domain === 'allowance' && radius !== 'external') { radius = 'external'; why.push('allowance means money: external'); }

  const phrase = words.slice(0, Math.min(3, words.length)).join(' ').toLowerCase();
  const phrases = [...new Set([verb, phrase].filter((p) => p.length > 1))];
  const preview = [words[0], ...Object.keys(slots).map((k) => `{${k}}`)].join(' ');
  return { name, feature: f.text, phrases, domain, radius, slots, preview, why };
}

export function draftFromBrief(b: Brief): Draft {
  const taken = new Set<string>();
  const acts = b.features.map((f) => draftAct(f, taken));
  const catalogs = [...new Set(acts.flatMap((a) => Object.values(a.slots).map((s) => s.catalog).filter((x): x is string => !!x)))];
  const notes: string[] = [];
  const colour = b.design.colours.find((c) => !['#34D399', '#FB923C', '#F87171', '#06B6D4'].includes(c.toUpperCase()));
  const customDomain = snake(b.name || 'app').slice(0, 24) || 'app';

  for (const e of b.exceptions) {
    const hit = acts.filter((a) => a.feature.toLowerCase().split(/\W+/).some((w) => w.length > 3 && e.toLowerCase().includes(w)));
    if (hit.length) notes.push(`Exception "${e}" touches ${hit.map((a) => a.name).join(', ')} — check its radius and who may run it`);
    else notes.push(`Exception "${e}" matches no feature yet — decide which act enforces it`);
  }
  if (!b.features.length) notes.push('No features yet. Add a "## Features" list: one line per thing a person asks for.');

  const tools: Record<string, unknown> = {};
  for (const a of acts) {
    tools[a.name] = {
      ...(a.domain ? { domain: a.domain } : colour ? { domain: customDomain } : {}),
      phrases: a.phrases,
      preview: a.preview,
      ...(a.radius !== 'external' ? { undo: { tool: `undo_${a.name}`, arg: 'id', from: 'id' } } : {}),
      ...Object.fromEntries([]),
    };
  }
  const shape: Record<string, unknown> = {
    schema: 'aiuic.shape/1',
    app: { name: (b.name || 'App').slice(0, 40), ...(colour ? { brand: { colour } } : {}) },
    ...(colour && acts.some((a) => !a.domain) ? { domains: { [customDomain]: { kicker: (b.name || 'APP').toUpperCase().slice(0, 24), colour } } } : {}),
    tools,
    home: acts.slice(0, 3).map((a) => a.name),
  };
  return { acts, catalogs, shape, notes };
}

// ------------------------------------------------------------------ scaffold

const zodFor = (s: SlotDraft) =>
  s.primitive === 'quantity' ? 'z.number()'
  : s.primitive === 'when' ? 'z.string().describe("ISO date or date-time")'
  : 'z.string()';

/**
 * A runnable MCP server skeleton with the drafted tools, their undo pairs,
 * list tools for every catalog, and the shape as a resource. Every handler
 * says TODO and stores into memory, so it runs from the first minute.
 */
export function scaffold(b: Brief, d: Draft): Record<string, string> {
  const lines: string[] = [
    '#!/usr/bin/env node',
    `// ${b.name || 'App'} — MCP server drafted from BRIEF.md by hepta-dev.`,
    '// Every handler below stores into memory so the app runs today. Replace each TODO with your real logic.',
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';",
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';",
    "import { z } from 'zod';",
    '',
    `const server = new McpServer({ name: ${JSON.stringify(snake(b.name || 'app') || 'app')}, version: '0.1.0' });`,
    'const out = (v) => ({ content: [{ type: "text", text: JSON.stringify(v) }], structuredContent: v });',
    'const store = new Map();',
    'let seq = 0;',
    '',
  ];
  for (const c of d.catalogs) {
    lines.push(`// TODO: return the real ${c}.`);
    lines.push(`server.registerTool('list_${c}', { title: ${JSON.stringify(`List ${c}`)}, annotations: { readOnlyHint: true } },`);
    lines.push(`  async () => out({ items: [{ id: '${c}-1', name: 'Example ${c.replace(/_/g, ' ')}' }] }));`);
    lines.push('');
  }
  for (const a of d.acts) {
    const quiet = a.radius !== 'external';
    const ann = quiet
      ? `{ destructiveHint: false, openWorldHint: ${a.radius === 'other-person' ? 'true' : 'false'} }`
      : '{ destructiveHint: true, openWorldHint: true }';
    lines.push(`// ${a.feature}`);
    lines.push(`// Draft cost: ${a.radius}. ${a.why.join(' ')}`);
    lines.push(`server.registerTool(${JSON.stringify(a.name)}, {`);
    lines.push(`  title: ${JSON.stringify(a.feature.replace(/\s*(?:—|--).*$/, ''))},`);
    lines.push(`  inputSchema: { ${Object.entries(a.slots).map(([k, s]) => `${k}: ${zodFor(s)}`).join(', ')} },`);
    lines.push(`  annotations: ${ann},`);
    lines.push(`}, async (args) => {`);
    lines.push(`  // TODO: do it for real.`);
    lines.push(`  const id = ${JSON.stringify(a.name)} + ':' + (++seq);`);
    lines.push(`  store.set(id, args);`);
    lines.push(`  return out({ id });`);
    lines.push(`});`);
    if (quiet) {
      lines.push(`server.registerTool('undo_${a.name}', { title: 'Undo', inputSchema: { id: z.string() }, annotations: { destructiveHint: true, openWorldHint: false } },`);
      lines.push(`  async ({ id }) => { store.delete(id); return out({ undone: id }); }); // TODO: undo it for real`);
    }
    lines.push('');
  }
  const shape = JSON.parse(JSON.stringify(d.shape)) as { tools: Record<string, Record<string, unknown>> };
  for (const a of d.acts) {
    const opts: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(a.slots)) if (s.catalog) opts[k] = { from: `list_${s.catalog}`, value: 'id', label: 'name' };
    if (Object.keys(opts).length) shape.tools[a.name]!.options = opts;
  }
  lines.push(`const shape = ${JSON.stringify(shape, null, 2)};`);
  lines.push(`server.registerResource('shape', 'aiuic://shape', { mimeType: 'application/json' },`);
  lines.push(`  async (uri) => ({ contents: [{ uri: String(uri), mimeType: 'application/json', text: JSON.stringify(shape) }] }));`);
  lines.push('');
  lines.push('await server.connect(new StdioServerTransport());');

  const config = { dataDir: '~/.hepta', servers: [{ name: snake(b.name || 'app') || 'app', command: 'node', args: ['server.mjs'] }] };
  const readme = [
    `# ${b.name || 'App'}`,
    '',
    b.purpose,
    '',
    '## Run it',
    '',
    '```bash',
    'npm install @modelcontextprotocol/sdk zod',
    'node path/to/hepta.mjs --config hepta.config.json',
    '```',
    '',
    '## What was drafted, and why',
    '',
    ...d.acts.map((a) => `- **${a.name}** (${a.radius}) — ${a.feature}\n  ${a.why.join(' ')}`),
    '',
    ...(d.notes.length ? ['## Decide these', '', ...d.notes.map((n) => `- ${n}`), ''] : []),
  ].join('\n');

  return {
    'server.mjs': lines.join('\n') + '\n',
    'hepta.config.json': JSON.stringify(config, null, 2) + '\n',
    'README.md': readme,
    'package.json': JSON.stringify({ name: snake(b.name || 'app') || 'app', private: true, type: 'module', dependencies: { '@modelcontextprotocol/sdk': '1.30.1', zod: '^3.25.0' } }, null, 2) + '\n',
  };
}
