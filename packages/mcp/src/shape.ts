/**
 * The shape of an app: what an MCP server says it should look like once it
 * has been turned into one.
 *
 * Today no server publishes this, so there are two paths and both are real:
 *
 *   1. a server exposes the resource `aiuic://shape` — JSON matching
 *      `aiuic.shape/1` below — and the app is laid out the way its maker
 *      intended: which tools are cards, what they are called, what can be
 *      undone, which settings and notifications come preset
 *   2. it does not, and `deriveShape()` builds a plain one from the tool list
 *
 * A shape is UNTRUSTED. It arrives from a server someone else wrote, the same
 * way an act spec arrives from a model, and it gets the same treatment as the
 * composer gives a model: it may describe, it may not decide. In particular:
 *
 *   - it cannot set a radius. The keys `radius`, `commit`, `reversible` and
 *     `effects` are refused anywhere they appear, because a server that could
 *     declare its own tool harmless would do so.
 *   - it cannot claim an undo that does not exist. An undo must name a tool
 *     this same server lists, and that tool must not claim to be read-only.
 *   - it cannot repaint meaning. A colour is refused if it is one of the
 *     semantic colours (success, warning, danger) or the assistant's own.
 *   - templates may only name slots the tool actually has.
 *
 * What it CAN do is make the app good: phrases people actually say, a
 * sentence for the preview, the domain a tool belongs to, settings and
 * notifications that should be on from the start.
 */

import { z } from 'zod';

export const SHAPE_SCHEMA = 'aiuic.shape/1' as const;
export const SHAPE_URI = 'aiuic://shape';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour is #RRGGBB');
const name = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/, 'letters, digits, _ . - only');
const text = (max: number) => z.string().min(1).max(max);

/** Refused anywhere in a shape, however deep. */
export const RESERVED_KEYS = ['radius', 'commit', 'reversible', 'effects', 'undoFn', 'assent', 'silence'] as const;

const ToolShape = z.object({
  /** An EUI domain name, or a custom one declared under `domains`. */
  domain: name.optional(),
  /** What people say to mean this tool. Routing uses them. */
  phrases: z.array(text(60)).max(12).optional(),
  /** The card's kicker label, when the domain's is not right. */
  label: text(40).optional(),
  /** The headline: "Pay {amount} to {payee}". Only slot names in braces. */
  preview: text(120).optional(),
  /**
   * How to take it back. Without this a write is irreversible, and an
   * irreversible act never commits on silence — whatever else is claimed.
   */
  undo: z.object({
    tool: name,
    /** Argument of the undo tool that receives the id. */
    arg: name,
    /** Field of this tool's structured result that holds the id. */
    from: name,
  }).strict().optional(),
  /**
   * Where a slot's options come from: a read-only tool that lists them, and
   * which fields are the value and the label.
   */
  options: z.record(name, z.object({
    from: name,
    value: name,
    label: name,
    /** Field of the list tool's structured result holding the array. */
    list: name.optional(),
  }).strict()).optional(),
  hidden: z.boolean().optional(),
}).strict();

const Setting = z.object({
  key: name,
  label: text(60),
  type: z.enum(['toggle', 'choice']),
  default: z.union([z.boolean(), z.string()]),
  options: z.array(text(40)).max(12).optional(),
}).strict();

const Notification = z.object({
  key: name,
  label: text(80),
  /** On when the app is created. The person can turn it off; the shape cannot force it on later. */
  default: z.boolean(),
  /** A read tool the conductor may poll for this notification. */
  watch: name.optional(),
}).strict();

export const ShapeSchema = z.object({
  schema: z.literal(SHAPE_SCHEMA),
  app: z.object({
    name: text(40),
    /** The maker's brand. Drawn on the app's own chrome, never on a domain. */
    brand: z.object({ colour: hex.optional(), mark: text(3).optional() }).strict().optional(),
  }).strict(),
  domains: z.record(name, z.object({
    kicker: text(24),
    colour: hex,
  }).strict()).optional(),
  tools: z.record(name, ToolShape).optional(),
  settings: z.array(Setting).max(24).optional(),
  notifications: z.array(Notification).max(24).optional(),
  /** Tools shown first when the app opens. */
  home: z.array(name).max(8).optional(),
}).strict();

export type Shape = z.infer<typeof ShapeSchema>;
export type ToolShapeT = z.infer<typeof ToolShape>;

/** Colours a shape may not use: their meaning is fixed across every app. */
export const PROTECTED_COLOURS: Record<string, string> = {
  '#34D399': 'success', '#FB923C': 'warning', '#F87171': 'danger', '#06B6D4': 'the assistant',
};

export class ShapeError extends Error {
  constructor(readonly problems: string[]) {
    super('shape refused:\n  ' + problems.join('\n  '));
    this.name = 'ShapeError';
  }
}

function findReserved(v: unknown, path: string, out: string[]): void {
  if (!v || typeof v !== 'object') return;
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
    if ((RESERVED_KEYS as readonly string[]).includes(k)) out.push(`${path}.${k}: a shape may describe a tool, not decide what it costs`);
    findReserved(child, `${path}.${k}`, out);
  }
}

export type ToolFacts = { name: string; readOnly: boolean; params: string[] };

/**
 * Parse and check a shape against the tools the server actually has.
 * Everything wrong is reported at once: a server author fixing one problem
 * per round trip will give up.
 */
export function readShape(raw: unknown, tools: ToolFacts[]): Shape {
  const problems: string[] = [];
  findReserved(raw, 'shape', problems);
  // Strip reserved keys before the structural parse so the two kinds of
  // problem are reported separately and clearly.
  if (problems.length) throw new ShapeError(problems);

  const parsed = ShapeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ShapeError(parsed.error.issues.map((i) => `${i.path.join('.') || 'shape'}: ${i.message}`));
  }
  const s = parsed.data;
  const byName = new Map(tools.map((t) => [t.name, t]));

  for (const [dom, d] of Object.entries(s.domains ?? {})) {
    const hit = PROTECTED_COLOURS[d.colour.toUpperCase()];
    if (hit) problems.push(`domains.${dom}.colour: ${d.colour} means "${hit}" everywhere and cannot be a domain`);
  }
  const brand = s.app.brand?.colour?.toUpperCase();
  if (brand && PROTECTED_COLOURS[brand]) problems.push(`app.brand.colour: ${brand} means "${PROTECTED_COLOURS[brand]}" everywhere`);

  for (const [tool, ts] of Object.entries(s.tools ?? {})) {
    const t = byName.get(tool);
    if (!t) { problems.push(`tools.${tool}: this server has no such tool`); continue; }

    if (ts.preview) {
      for (const m of ts.preview.matchAll(/\{([^}]*)\}/g)) {
        if (!t.params.includes(m[1]!)) problems.push(`tools.${tool}.preview: {${m[1]}} is not a parameter of ${tool}`);
      }
    }
    if (ts.undo) {
      const u = byName.get(ts.undo.tool);
      if (!u) problems.push(`tools.${tool}.undo: no tool "${ts.undo.tool}" on this server`);
      else if (u.readOnly) problems.push(`tools.${tool}.undo: "${ts.undo.tool}" says it is read-only, so it cannot undo anything`);
      else if (!u.params.includes(ts.undo.arg)) problems.push(`tools.${tool}.undo: "${ts.undo.tool}" has no parameter "${ts.undo.arg}"`);
      if (t.readOnly) problems.push(`tools.${tool}.undo: a read-only tool has nothing to undo`);
    }
    for (const [slot, o] of Object.entries(ts.options ?? {})) {
      if (!t.params.includes(slot)) problems.push(`tools.${tool}.options.${slot}: not a parameter of ${tool}`);
      const src = byName.get(o.from);
      if (!src) problems.push(`tools.${tool}.options.${slot}: no tool "${o.from}" to list options from`);
      else if (!src.readOnly) problems.push(`tools.${tool}.options.${slot}: "${o.from}" is not read-only, and listing options must not write`);
    }
    const custom = ts.domain && s.domains?.[ts.domain];
    if (ts.domain && !custom && !KNOWN_DOMAINS.has(ts.domain)) {
      problems.push(`tools.${tool}.domain: "${ts.domain}" is neither an EUI domain nor declared under domains`);
    }
  }
  for (const h of s.home ?? []) if (!byName.has(h)) problems.push(`home: no tool "${h}"`);
  for (const n of s.notifications ?? []) {
    if (n.watch) {
      const w = byName.get(n.watch);
      if (!w) problems.push(`notifications.${n.key}.watch: no tool "${n.watch}"`);
      else if (!w.readOnly) problems.push(`notifications.${n.key}.watch: the conductor only polls read-only tools`);
    }
  }

  if (problems.length) throw new ShapeError(problems);
  return s;
}

/** EUI's own domains. Kept as names here so this package need not import the renderer. */
export const KNOWN_DOMAINS = new Set([
  'chores', 'homework', 'groceries', 'calendar', 'trips', 'places',
  'rewards', 'allowance', 'ranks', 'household', 'teaching', 'memory',
]);

/**
 * A plain shape from nothing but the tool list. Honest about what it does not
 * know: no undo is invented, so every write stays irreversible and therefore
 * needs a spoken yes. A server that wants silence-commit has to say how its
 * writes are taken back.
 */
export function deriveShape(appName: string, tools: (ToolFacts & { title?: string; description?: string })[]): Shape {
  const words = (s: string) => s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  const shaped: Record<string, ToolShapeT> = {};
  for (const t of tools) {
    if (t.readOnly) continue;
    const phrase = words(t.name);
    const title = t.title ? words(t.title) : null;
    shaped[t.name] = { phrases: [...new Set([phrase, ...(title && title !== phrase ? [title] : [])])] };
  }
  return {
    schema: SHAPE_SCHEMA,
    app: { name: appName.slice(0, 40) || 'App' },
    tools: shaped,
  };
}
