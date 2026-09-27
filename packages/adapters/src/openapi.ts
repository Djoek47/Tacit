/**
 * An HTTP API becomes acts, without anybody writing an MCP server.
 *
 * Most projects a developer brings already describe themselves: an OpenAPI
 * document is the shape of the backend they have. Reading it is the shortest
 * path from "here is my repo" to something a person can talk to.
 *
 * What it costs is decided by the same policy the MCP bridge uses, not a
 * second one invented here. A description written by whoever wrote the API is
 * exactly as trustworthy as a tool annotation from a server, so it may make an
 * operation look MORE dangerous and never less:
 *
 *   GET, HEAD           a source the aggregator may read. Never an act.
 *   DELETE              irreversible unless an undo is supplied. External.
 *   POST, PUT, PATCH    external until the person lowers it, and only as far
 *                       as the floor allows.
 *
 * The adapter performs no network call of its own: `call` is supplied, so a
 * host keeps its own auth, retries and base URL, and a test runs without a
 * server. Nothing here can commit — an act commits, through the contract, once
 * the person has said yes.
 */

import { defineAct, type ActDef, type Option } from '@intermenu/aiuic-core';
import type { Finding, Source } from '@intermenu/aiuic-pyramid';
import { classify, slotsFromSchema, type Annotations, type Classification, type JsonSchema } from '@intermenu/aiuic-mcp';

export type HttpRequest = {
  method: string;
  /** The path with its parameters already substituted. */
  path: string;
  query: Record<string, unknown>;
  body: Record<string, unknown> | null;
};

export type HttpCall = (req: HttpRequest) => Promise<{ ok: boolean; status: number; body: unknown }>;

type Param = { name: string; in?: string; required?: boolean; schema?: JsonSchema; description?: string };
type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Param[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> };
  /** Vendor extension: an operation that undoes this one. */
  'x-aiuic-undo'?: string;
  'x-aiuic-domain'?: string;
};
export type OpenAPIDoc = {
  openapi?: string;
  info?: { title?: string };
  paths?: Record<string, Record<string, Operation | unknown>>;
};

export type ImportOptions = {
  call: HttpCall;
  /** Which part of the app an operation belongs to. Defaults to its first tag. */
  domainFor?: (op: Operation, path: string, method: string) => string | undefined;
  /** Catalogs for slots whose values come from somewhere the schema cannot say. */
  catalogs?: Record<string, () => Option[]>;
};

export type Imported = {
  acts: ActDef[];
  sources: Source[];
  /** What each act costs and why, so a host can show it before delegating. */
  costs: Record<string, Classification>;
  /** Operations that could not be imported, and the reason. */
  problems: string[];
};

const WRITE = new Set(['post', 'put', 'patch', 'delete']);
const READ = new Set(['get', 'head']);

const nameOf = (op: Operation, path: string, method: string) =>
  (op.operationId ?? `${method}_${path}`)
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

/** The words a person might say for this operation, taken from its own summary. */
function phrasesFor(op: Operation, name: string): string[] {
  const words = (op.summary ?? op.description ?? name.replace(/_/g, ' '))
    .toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  return [...new Set([name.split('_')[0]!, ...words.slice(0, 4)])].filter(Boolean);
}

/** Fill a path template from the values a person gave: /tasks/{id} → /tasks/7. */
export function fillPath(path: string, args: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_m, key: string) => {
    const v = args[key];
    return v === undefined || v === null ? `{${key}}` : encodeURIComponent(String(v));
  });
}

export function fromOpenAPI(doc: OpenAPIDoc, opts: ImportOptions): Imported {
  const acts: ActDef[] = [];
  const sources: Source[] = [];
  const costs: Record<string, Classification> = {};
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, raw] of Object.entries(item ?? {})) {
      const verb = method.toLowerCase();
      if (!WRITE.has(verb) && !READ.has(verb)) continue;
      const op = raw as Operation;
      if (!op || typeof op !== 'object') continue;

      let name = nameOf(op, path, verb);
      if (!name) { problems.push(`${verb.toUpperCase()} ${path} has no usable name`); continue; }
      if (seen.has(name)) {
        // Two operations cannot share a name: the person would have no way to
        // tell which one they were agreeing to.
        problems.push(`${verb.toUpperCase()} ${path} would be a second "${name}"; it was left out`);
        continue;
      }
      seen.add(name);

      const bodySchema = op.requestBody?.content?.['application/json']?.schema;
      const params = op.parameters ?? [];
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          ...Object.fromEntries(params.map((p) => [p.name, p.schema ?? { type: 'string', description: p.description }])),
          ...(bodySchema?.properties ?? {}),
        },
        required: [
          ...params.filter((p) => p.required).map((p) => p.name),
          ...(bodySchema?.required ?? []),
        ],
      };

      const phrases = phrasesFor(op, name);
      const plan = slotsFromSchema(schema, { phrases, catalogs: opts.catalogs ?? {} });
      for (const d of plan.dropped) problems.push(`${name}: "${d}" was left out; an act shows at most eight`);
      const domain = opts.domainFor?.(op, path, verb) ?? op['x-aiuic-domain'] ?? op.tags?.[0];

      const toArgs = (filled: Record<string, unknown>) => {
        const args: Record<string, unknown> = {};
        for (const [slot, value] of Object.entries(filled)) {
          const conv = plan.toArg[slot];
          args[slot] = conv ? conv(value) : value;
        }
        return args;
      };
      const split = (args: Record<string, unknown>) => {
        const inPath = new Set([...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!));
        const query: Record<string, unknown> = {};
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(args)) {
          if (inPath.has(k)) continue;
          if (params.some((p) => p.name === k && p.in === 'query')) query[k] = v;
          else if (params.some((p) => p.name === k && p.in !== 'query')) query[k] = v;
          else body[k] = v;
        }
        return { query, body };
      };

      if (READ.has(verb)) {
        sources.push({
          name,
          local: false,
          async read(query: string): Promise<Finding[]> {
            const res = await opts.call({ method: verb.toUpperCase(), path: fillPath(path, {}), query: {}, body: null })
              .catch(() => null);
            if (!res || !res.ok) return [];
            return [{
              source: name,
              claim: `${op.summary ?? name}: ${describe(res.body)}`,
              value: res.body,
              confidence: 0.5,
              // Nothing measured this against what the person meant by `query`.
              calibrated: false,
            }];
          },
        });
        continue;
      }

      // A write. What it costs comes from the same rule an MCP tool gets.
      const undoOp = op['x-aiuic-undo'];
      const annotations: Annotations = {
        readOnlyHint: false,
        // Naming the operation that undoes this one is the document's author
        // saying it is reversible, so it counts as the claim of
        // non-destructiveness — which is what lets the person lower it later.
        // A delete is destructive even where something can restore the row:
        // it is gone between the two calls, and anything reading in between
        // sees it gone. Silence stays unstated, which the policy already reads
        // as "assume the worst".
        ...(verb === 'delete' ? { destructiveHint: true }
          : undoOp ? { destructiveHint: false } : {}),
        openWorldHint: true,
      };
      const cost = classify(annotations, !!undoOp);
      costs[name] = cost;

      acts.push(defineAct({
        name,
        ...(domain ? { domain } : {}),
        phrases,
        slots: plan.slots,
        radius: 'external',
        commit: async (filled) => {
          const args = toArgs(filled);
          const { query, body } = split(args);
          const res = await opts.call({
            method: verb.toUpperCase(), path: fillPath(path, args), query,
            body: Object.keys(body).length ? body : null,
          });
          if (!res.ok) throw new Error(`${name} answered ${res.status}`);
          return { id: idOf(res.body) ?? name, ...(undoOp ? { undoOp, args } : {}) };
        },
        ...(undoOp ? {
          undo: async (r) => {
            const args = (r.args ?? {}) as Record<string, unknown>;
            await opts.call({ method: 'POST', path: fillPath(undoOp, args), query: {}, body: null });
          },
        } : {}),
      }));
    }
  }

  return { acts, sources, costs, problems };
}

function idOf(body: unknown): string | null {
  const o = body as Record<string, unknown> | null;
  const v = o && typeof o === 'object' ? o.id ?? o.uuid ?? o.name : null;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

function describe(body: unknown): string {
  if (Array.isArray(body)) return `${body.length} result${body.length === 1 ? '' : 's'}`;
  if (body && typeof body === 'object') return Object.keys(body).slice(0, 5).join(', ');
  return String(body ?? 'nothing');
}
