/**
 * hepta-dev as an MCP server: the developer tools, handed to whatever
 * assistant the developer already uses (Cursor, Claude, any MCP client).
 *
 * Mostly readers. Two tools write files — the scaffold and the prototype —
 * and both stay inside the folder the server was started in, and neither
 * overwrites a file unless asked to in so many words. An assistant that
 * could quietly replace someone's server.mjs is the kind of help nobody
 * asked for.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseBrief } from './brief.js';
import { mapMenus, mermaid } from './menus.js';
import { draftFromBrief, scaffold } from './draft.js';
import { prototype } from './prototype.js';
import { repoSource, transcriptSource, evolution, formatEvolution } from './context.js';
import { dossier } from './reconstruct.js';
import { testApp, formatTest, type Step } from './testing.js';

export type DevServerConfig = {
  /** Every path is resolved against this, and writes may not leave it. */
  root: string;
  /** The prototype runtime's source. */
  runtime: () => string;
  executablePath?: string;
};

const text = (t: string, data?: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: t }], ...(data ? { structuredContent: data } : {}) });
const fail = (t: string) => ({ isError: true, content: [{ type: 'text' as const, text: t }] });

export function createDevServer(cfg: DevServerConfig): McpServer {
  const server = new McpServer({ name: 'hepta-dev', version: '1.0.0' });
  const root = resolve(cfg.root);
  const inRoot = (p: string) => {
    const abs = resolve(root, p);
    const rel = relative(root, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${p} is outside ${root}; hepta-dev only reads and writes inside the project`);
    return abs;
  };
  const brief = (p: string) => parseBrief(readFileSync(inRoot(p), 'utf8'));
  const write = (p: string, body: string, overwrite: boolean) => {
    const abs = inRoot(p);
    if (existsSync(abs) && !overwrite) throw new Error(`${p} exists. Pass overwrite: true to replace it.`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    return relative(root, abs);
  };
  const guard = async (fn: () => Promise<ReturnType<typeof text>> | ReturnType<typeof text>) => {
    try { return await fn(); } catch (e) { return fail((e as Error).message); }
  };

  server.registerTool('read_brief', {
    title: 'Read a brief',
    description: 'Parses BRIEF.md (features, menus, design, references, exceptions, expectations) and checks the menu map.',
    inputSchema: { path: z.string().default('BRIEF.md') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ path }) => guard(() => {
    const b = brief(path);
    const map = mapMenus(b.menus);
    return text([
      `${b.name}: ${b.features.length} features, ${b.menus.length} menus, ${b.expectations.length} expectations.`,
      ...map.issues.map((i) => `${i.level}: ${i.message}`),
      '', 'menu map (mermaid):', mermaid(map),
    ].join('\n'), { brief: b, issues: map.issues });
  }));

  server.registerTool('draft_app', {
    title: 'Draft the app from a brief',
    description: 'One act per feature: slots, domain, cost, and the reason for every guess. Plus the aiuic shape and the decisions left open.',
    inputSchema: { path: z.string().default('BRIEF.md') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ path }) => guard(() => {
    const d = draftFromBrief(brief(path));
    return text([
      ...d.acts.map((a) => `${a.name} (${a.radius}) — ${a.feature}\n  slots: ${Object.entries(a.slots).map(([k, s]) => `${k}:${s.primitive}`).join(', ')}\n  why: ${a.why.join(' ')}`),
      ...(d.notes.length ? ['', 'Decide:', ...d.notes.map((n) => `- ${n}`)] : []),
    ].join('\n'), d as unknown as Record<string, unknown>);
  }));

  server.registerTool('scaffold_app', {
    title: 'Write a runnable MCP server from a brief',
    description: 'Writes server.mjs, hepta.config.json, package.json and README.md into outDir. Never overwrites unless overwrite is true.',
    inputSchema: { path: z.string().default('BRIEF.md'), outDir: z.string().default('app'), overwrite: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ path, outDir, overwrite }) => guard(() => {
    const b = brief(path);
    const files = scaffold(b, draftFromBrief(b));
    // Check every target first, so a refusal writes nothing at all.
    if (!overwrite) for (const f of Object.keys(files)) if (existsSync(inRoot(`${outDir}/${f}`))) throw new Error(`${outDir}/${f} exists. Pass overwrite: true to replace it.`);
    const written = Object.entries(files).map(([f, body]) => write(`${outDir}/${f}`, body, overwrite));
    return text(`Wrote ${written.join(', ')}.`, { written });
  }));

  server.registerTool('prototype', {
    title: 'Build a clickable prototype from a brief',
    description: 'One HTML file: the mood board, the menu map, and a working stage for every drafted act.',
    inputSchema: { path: z.string().default('BRIEF.md'), out: z.string().default('prototype.html'), overwrite: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ path, out, overwrite }) => guard(() => text(`Wrote ${write(out, prototype(brief(path), cfg.runtime()), overwrite)}.`)));

  server.registerTool('test_app', {
    title: 'Use the app like a person and say what is wrong',
    description: 'Opens a URL at phone, tablet and desktop sizes, runs optional steps, and reports console errors, sideways scrolling, small tap targets, cut-off text and more, in sentences.',
    inputSchema: {
      url: z.string(),
      steps: z.array(z.union([
        z.object({ click: z.string() }), z.object({ fill: z.tuple([z.string(), z.string()]) }),
        z.object({ press: z.string() }), z.object({ wait: z.number().max(10_000) }),
      ])).max(40).optional(),
      screenshots: z.string().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url, steps, screenshots }) => guard(async () => {
    const r = await testApp(url, {
      ...(steps ? { steps: steps as Step[] } : {}),
      ...(screenshots ? { screenshotDir: inRoot(screenshots) } : {}),
      ...(cfg.executablePath ? { executablePath: cfg.executablePath } : {}),
    });
    return text(formatTest(r), r as unknown as Record<string, unknown>);
  }));

  server.registerTool('search_context', {
    title: 'Search the code, its history and the chats',
    description: 'Finds lines in repositories, commits, and chat transcripts that match a question.',
    inputSchema: { query: z.string().min(2), repos: z.array(z.string()).default(['.']), transcripts: z.array(z.string()).default([]) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, repos, transcripts }) => guard(async () => {
    const sources = [...repos.map((r) => repoSource(inRoot(r))), ...transcripts.map((t) => transcriptSource(inRoot(t)))];
    const found = (await Promise.all(sources.map((s) => s.read(query)))).flat().sort((a, b) => b.confidence - a.confidence).slice(0, 15);
    return text(found.length ? found.map((f) => `${f.source} — ${f.claim}`).join('\n') : 'Nothing matched.', { found });
  }));

  server.registerTool('evolution', {
    title: 'How the project got here',
    description: 'The git history as a timeline, day by day.',
    inputSchema: { repo: z.string().default('.') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ repo }) => guard(() => text(formatEvolution(evolution(inRoot(repo))))));

  server.registerTool('rebuild_dossier', {
    title: 'What a rebuild starts from',
    description: 'What it is, how it got here, what is open, what to keep, and the order to rebuild in.',
    inputSchema: { repo: z.string().default('.'), brief: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ repo, brief: bp }) => guard(() => text(dossier({ repoDir: inRoot(repo), ...(bp ? { brief: brief(bp) } : {}) }))));

  return server;
}

export const DEV_TOOLS = ['read_brief', 'draft_app', 'scaffold_app', 'prototype', 'test_app', 'search_context', 'evolution', 'rebuild_dossier'] as const;
