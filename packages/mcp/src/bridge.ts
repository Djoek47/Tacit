/**
 * Any MCP server, turned into acts and sources.
 *
 * Connect a client, and what comes back is everything the rest of the SDK
 * already knows how to use:
 *
 *   acts      one per write tool, with slots from its input schema, a radius
 *             from `policy.ts`, and a commit that calls the tool
 *   sources   one per read tool, for the aggregator to gather from
 *   shape     the app's intended look, read from the server or derived
 *   preview   the sentence the person approves before any of it is trusted
 *
 * Nothing here decides when to commit. That is still the contract's, and a
 * bridged tool gets exactly the same HOLD, attention gate and undo window as
 * one a host wrote by hand. The bridge's job is to make sure the radius it
 * hands the contract is one the server could not talk down.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { defineAct, type ActDef, type CommitResult, type Ctx, type Option, type Radius } from '@intermenu/aiuic-core';
import { checkDelegation, classify, type Annotations, type Classification } from './policy.js';
import { slotsFromSchema, type JsonSchema } from './schema.js';
import { SHAPE_URI, ShapeError, deriveShape, readShape, type Shape, type ToolFacts } from './shape.js';

export type Tool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
  annotations?: Annotations;
};

/** The same shape the pyramid's aggregator takes. */
export type Finding = { source: string; claim: string; value?: unknown; confidence: number; calibrated: boolean };
export type Source = { readonly name: string; readonly local: boolean; read(query: string, ctx: Ctx): Promise<Finding[]> };

export type ToolStatus = {
  tool: string;
  kind: 'read' | 'write';
  /** What it costs right now, after any delegation. */
  radius: Radius | null;
  floor: Radius | null;
  lowerable: boolean;
  why: string[];
};

export type Connection = {
  /**
   * Who this connection is, as the HOST named it — a config entry, a prefix.
   * Never the name the server reports about itself: two servers can both
   * call themselves "tasks", and a delegation must not go to whichever one
   * happened to be listed first.
   */
  id: string;
  server: { name: string; version: string };
  /**
   * A hash of what the server offers — its tools, their annotations and
   * schemas, its shape. An approval is for this fingerprint: a server that
   * changes what it offers has to be approved again.
   */
  fingerprint: string;
  /** False until approve(). Until then nothing from the server is called. */
  readonly approved: boolean;
  /** The person said yes to preview(). Loads option lists and turns sources on. */
  approve(): Promise<void>;
  shape: Shape;
  /** Present when the server offered a shape and it was refused. The app still works, plainly. */
  shapeProblems: string[];
  acts: ActDef[];
  sources: Source[];
  tools(): ToolStatus[];
  /** What the person approves. Nothing from this server is trusted before they do. */
  preview(): string;
  /** The person lowers a tool's radius. Refused below its floor. */
  delegate(tool: string, to: Radius): Radius;
  /** Re-read the option lists that slots are filled from. */
  refreshCatalogs(): Promise<void>;
};

export type ConnectOptions = {
  /** Prefix act names, so two servers with an `add` tool do not collide. */
  prefix?: string;
  /** The host's name for this connection. Defaults to prefix + the server's name. */
  id?: string;
};

/** FNV-1a, twice, for a short stable fingerprint without a crypto dependency. */
function fingerprintOf(v: unknown): string {
  const text = JSON.stringify(v);
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
};

function textOf(r: CallResult): string {
  return (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
}

function structured(r: CallResult): Record<string, unknown> | undefined {
  if (r.structuredContent) return r.structuredContent;
  // Many servers still return JSON as text. Take it if it parses; otherwise there is none.
  try {
    const v = JSON.parse(textOf(r));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { items: v };
  } catch {
    return undefined;
  }
}


/**
 * Data as a sentence a person reads: "3 items: renew passport, call the bank,
 * buy milk" rather than the JSON behind it. Used wherever a tool's result
 * becomes words someone will see.
 */
export function describeData(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const nameOf = (x: unknown): string => {
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      for (const k of ['title', 'name', 'label', 'text', 'summary', 'id']) if (typeof o[k] === 'string' || typeof o[k] === 'number') return String(o[k]);
    }
    return describeData(x, depth + 1);
  };
  if (Array.isArray(v)) {
    if (v.length === 0) return 'nothing';
    const shown = v.slice(0, 6).map(nameOf).join(', ');
    return `${v.length} item${v.length === 1 ? '' : 's'}: ${shown}${v.length > 6 ? ', …' : ''}`;
  }
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.items)) return describeData(o.items, depth);
  if (depth > 1) return nameOf(o);
  const parts = Object.entries(o)
    .filter(([k, x]) => k !== 'memory' && x !== undefined && (typeof x !== 'object' || Array.isArray(x)))
    .slice(0, 6)
    .map(([k, x]) => `${k.replace(/_/g, ' ')} ${describeData(x, depth + 1)}`);
  return parts.join(' · ');
}

const words = (s: string) => s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'or', 'my', 'all', 'get', 'list', 'show', 'what', 'is', 'are', 'on', 'in']);
const meaningful = (s: string) => new Set(words(s).split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w)));

async function allTools(client: Client): Promise<Tool[]> {
  const out: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    out.push(...(page.tools as Tool[]));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

async function loadShape(client: Client, name: string, facts: ToolFacts[], tools: Tool[]): Promise<{ shape: Shape; problems: string[] }> {
  const caps = client.getServerCapabilities();
  if (caps?.resources) {
    try {
      const res = await client.readResource({ uri: SHAPE_URI });
      const first = res.contents[0] as { text?: string } | undefined;
      if (first?.text) {
        try {
          return { shape: readShape(JSON.parse(first.text), facts), problems: [] };
        } catch (err) {
          const problems = err instanceof ShapeError ? err.problems : [`not JSON: ${(err as Error).message}`];
          return { shape: deriveShape(name, tools.map((t) => ({ ...toFacts(t), ...(t.title ? { title: t.title } : {}) }))), problems };
        }
      }
    } catch {
      // No shape resource. That is the common case, not an error.
    }
  }
  return { shape: deriveShape(name, tools.map((t) => ({ ...toFacts(t), ...(t.title ? { title: t.title } : {}) }))), problems: [] };
}

function toFacts(t: Tool): ToolFacts {
  return { name: t.name, readOnly: t.annotations?.readOnlyHint === true, params: Object.keys(t.inputSchema?.properties ?? {}) };
}

export async function connect(client: Client, opts: ConnectOptions = {}): Promise<Connection> {
  const info = client.getServerVersion() ?? { name: 'server', version: '0' };
  const server = { name: info.name, version: info.version };
  const id = opts.id ?? `${opts.prefix ?? ''}${server.name}`;
  let approved = false;
  const tools = await allTools(client);
  const facts = tools.map(toFacts);
  const { shape, problems } = await loadShape(client, server.name, facts, tools);

  const classes = new Map<string, Classification>();
  for (const t of tools) classes.set(t.name, classify(t.annotations, !!shape.tools?.[t.name]?.undo));
  const delegated = new Map<string, Radius>();

  // ---------------------------------------------------------------- catalogs
  const catalogs = new Map<string, Option[]>(); // key: tool.slot
  async function refreshCatalogs(): Promise<void> {
    if (!approved) return;
    for (const [tool, ts] of Object.entries(shape.tools ?? {})) {
      for (const [slot, o] of Object.entries(ts.options ?? {})) {
        try {
          const r = (await client.callTool({ name: o.from, arguments: {} })) as CallResult;
          const s = structured(r);
          const list = (s?.[o.list ?? 'items'] ?? []) as Record<string, unknown>[];
          catalogs.set(`${tool}.${slot}`, (Array.isArray(list) ? list : [])
            .filter((row) => row && row[o.value] !== undefined)
            .slice(0, 40)
            .map((row) => ({ value: row[o.value], label: String(row[o.label] ?? row[o.value]) })));
        } catch {
          catalogs.set(`${tool}.${slot}`, []);
        }
      }
    }
  }
  // No tool is called here. Option lists are loaded by approve(): a server
  // whose "read-only" list tool is not read-only must not get to run before
  // the person has seen, in the preview, that it will be trusted to.

  // -------------------------------------------------------------------- acts
  // A tool named as another tool's undo is machinery, not something a person
  // asks for: offered as an act, it would mean saying "undo add task t7" with
  // an id nobody has seen. Undo is reached from the card that made the change.
  const undoTools = new Set(Object.values(shape.tools ?? {}).map((ts) => ts.undo?.tool).filter((x): x is string => !!x));
  const acts: ActDef[] = [];
  const skipped: string[] = [];
  for (const t of tools) {
    const c = classes.get(t.name)!;
    if (c.kind === 'read') continue;
    const ts = shape.tools?.[t.name] ?? {};
    if (ts.hidden || undoTools.has(t.name)) continue;

    const phrases = ts.phrases ?? [words(t.name)];
    const cats: Record<string, () => Option[]> = {};
    for (const slot of Object.keys(ts.options ?? {})) cats[slot] = () => catalogs.get(`${t.name}.${slot}`) ?? [];
    const plan = slotsFromSchema(t.inputSchema, { phrases, catalogs: cats });

    // A tool that takes nothing still needs one slot to be an act. It is
    // the tool itself, matched by its own phrases.
    if (Object.keys(plan.slots).length === 0) {
      plan.slots.go = {
        primitive: 'chip', required: true, order: 1,
        options: () => [{ value: true, label: t.title ?? words(t.name), aliases: phrases }],
      };
    }

    const undo = ts.undo;
    let counter = 0;
    const name = (opts.prefix ?? '') + t.name;

    try {
      acts.push(defineAct({
        name,
        phrases,
        ...(ts.domain ? { domain: ts.domain } : {}),
        slots: plan.slots,
        radius: { max: 'external', of: () => delegated.get(t.name) ?? (c.kind === 'write' ? c.start : 'external') },
        commit: async (filled): Promise<CommitResult> => {
          if (!approved) throw new Error(`${server.name} has not been approved yet`);
          const args: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(filled)) {
            if (k === 'go' || v === undefined) continue;
            args[k] = plan.toArg[k] ? plan.toArg[k]!(v) : v;
          }
          const r = (await client.callTool({ name: t.name, arguments: args })) as CallResult;
          if (r.isError) throw new Error(`${t.name}: ${textOf(r) || 'the server refused'}`);
          const s = structured(r);
          const id = undo && s?.[undo.from] !== undefined ? String(s[undo.from]) : `${t.name}:${++counter}`;
          return { id, result: s ?? textOf(r) };
        },
        ...(undo ? {
          undo: async (res: CommitResult) => {
            const r = (await client.callTool({ name: undo.tool, arguments: { [undo.arg]: res.id } })) as CallResult;
            if (r.isError) throw new Error(`${undo.tool}: ${textOf(r) || 'undo refused'}`);
          },
        } : {}),
        ...(ts.preview ? {
          preview: (filled) => [ts.preview!.replace(/\{(\w+)\}/g, (_, k: string) => {
            const v = filled[k];
            if (v === undefined) return '…';
            if (v && typeof v === 'object' && 'label' in (v as object)) return String((v as { label: unknown }).label);
            const opt = (plan.slots[k]?.options?.({} as Ctx, {}) as Option[] | undefined)?.find((o) => o.value === v);
            return opt ? opt.label : String(v);
          })],
        } : {}),
      }));
    } catch (err) {
      skipped.push(`${t.name}: ${(err as Error).message}`);
    }
  }

  // ----------------------------------------------------------------- sources
  const sources: Source[] = [];
  for (const t of tools) {
    if (classes.get(t.name)!.kind !== 'read') continue;
    const req = t.inputSchema?.required ?? [];
    const props = t.inputSchema?.properties ?? {};
    const queryParam = req.length === 1 && props[req[0]!]?.type === 'string' ? req[0]! : null;
    if (req.length > 0 && !queryParam) continue; // it needs arguments a query cannot supply
    const about = meaningful(`${t.name} ${t.title ?? ''} ${t.description ?? ''}`);

    sources.push({
      name: `${server.name}/${t.name}`,
      local: false,
      async read(query: string): Promise<Finding[]> {
        if (!approved) return [];
        // Only asked when the question is about what this tool knows. A
        // source that answers every query with its whole table is noise.
        const q = meaningful(query);
        if (![...q].some((w) => about.has(w) || [...about].some((a) => a.startsWith(w) || w.startsWith(a)))) return [];
        const r = (await client.callTool({ name: t.name, arguments: queryParam ? { [queryParam]: query } : {} })) as CallResult;
        if (r.isError) return [{ source: `${server.name}/${t.name}`, claim: `error: ${textOf(r)}`, confidence: 0, calibrated: true }];
        const s = structured(r);
        return [{
          source: `${server.name}/${t.name}`,
          claim: (s !== undefined ? describeData(s) : textOf(r)).slice(0, 600),
          ...(s !== undefined ? { value: s } : {}),
          // The server's own data about itself. Calibrated in the sense that it
          // is not a model's guess — not in the sense that it is true.
          confidence: 1, calibrated: true,
        }];
      },
    });
  }

  const status = (): ToolStatus[] => tools.map((t) => {
    const c = classes.get(t.name)!;
    if (c.kind === 'read') return { tool: t.name, kind: 'read', radius: null, floor: null, lowerable: false, why: [c.why] };
    return {
      tool: t.name, kind: 'write',
      radius: delegated.get(t.name) ?? c.start, floor: c.floor, lowerable: c.lowerable, why: c.why,
    };
  });

  const fingerprint = fingerprintOf({
    tools: tools.map((t) => ({ n: t.name, a: t.annotations ?? {}, s: t.inputSchema ?? {} })).sort((x, y) => x.n.localeCompare(y.n)),
    shape,
  });

  return {
    id, server, fingerprint, shape, shapeProblems: [...problems, ...skipped], acts, sources,
    get approved() { return approved; },
    async approve() {
      approved = true;
      await refreshCatalogs();
    },
    tools: status,
    preview() {
      const st = status();
      const writes = st.filter((s) => s.kind === 'write' && !undoTools.has(s.tool));
      const reads = st.filter((s) => s.kind === 'read');
      const quietable = writes.filter((s) => s.lowerable).length;
      const parts = [
        `Connect ${shape.app.name}.`,
        `It can do ${writes.length} thing${writes.length === 1 ? '' : 's'} and look up ${reads.length}.`,
        writes.length === 1 ? 'It asks you first.' : writes.length === 2 ? 'Both ask you first.' : `All ${writes.length} ask you first.`,
        quietable
          ? `${quietable} can be undone, so you may later let ${quietable === 1 ? 'it' : 'them'} go ahead on silence.`
          : writes.length === 1 ? 'It cannot be undone, so it will always ask.' : 'None can be undone, so they will always ask.',
        reads.length === 0
          ? 'It looks nothing up.'
          : `It looks things up with ${reads.map((r) => r.tool).join(', ')}. The server says ${reads.length === 1 ? 'that tool only reads' : 'those only read'}; approving means trusting that, and they may be asked about anything you ask about.`,
      ];
      if (problems.length) parts.push(`Its layout was refused (${problems.length} problem${problems.length === 1 ? '' : 's'}), so it will look plain.`);
      return parts.join(' ');
    },
    delegate(tool, to) {
      const c = classes.get(tool);
      if (!c) throw new Error(`no tool "${tool}" on ${server.name}`);
      const r = checkDelegation(tool, c, to);
      delegated.set(tool, r);
      return r;
    },
    refreshCatalogs,
  };
}
