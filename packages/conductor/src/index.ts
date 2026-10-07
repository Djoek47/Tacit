/**
 * The conductor. Always on; works with the app closed.
 *
 * The idea as it was given: one AI is always there, keeping the rhythm, even
 * when you are not connected. The other three roles work only when there is
 * something to do; with no instructions they build nothing and cost nothing.
 *
 * The part that had to change on the way to code: an always-on AI that could
 * commit whatever it liked would break the one promise the rest of the system
 * makes — nothing becomes true without the person. So the metaphor gains a
 * composer:
 *
 *   YOU WRITE THE SCORE.  Standing orders — "every morning, add what is due
 *                         to my list" — each written through an act you
 *                         approved, stored in memory as real.
 *   IT KEEPS THE RHYTHM.  Around the clock it runs what the score says, and
 *                         it may COMMIT only when all of these hold:
 *
 *     - an active order covers it
 *     - its radius is at or under that order's ceiling
 *     - the ceiling is never `external`: money and anything irreversible are
 *       never done unattended, whatever an order says
 *     - it can be undone (it has an undo)
 *     - no slot holds a guess (nothing provisional, nothing missing)
 *
 *   Everything else it PREPARES and leaves in the inbox, waiting for a yes.
 *   Every unattended commit is in the inbox too, with an undo on it.
 *
 * This check is the whole safety boundary for work done while you sleep:
 * `assent()` in the core commits whatever it is pointed at. So `authorise()`
 * below is small, explicit, and the most heavily tested function in the
 * package.
 *
 * Offline, it keeps going with what it can reach: an order that fails is
 * retried with backoff instead of abandoned, and after three failures the
 * inbox says so.
 */

import {
  radiusRank, type ActRun, type Clock, type CommitResult, type Ctx, type Filled, type Radius, type TimerId,
} from '@intermenu/aiuic-core';
import type { App } from '@intermenu/aiuic-kit';
import type { MemoryReader } from '@intermenu/aiuic-memory';
import { defineAct, type ActDef } from '@intermenu/aiuic-core';

// --------------------------------------------------------------------- score

export type Schedule = { every: number } | { daily: string };

export type OrderSpec = {
  schedule: Schedule;
  /** The most it may commit on its own for this order. Never external. */
  ceiling: Radius;
  /** A question for the pyramid to pursue. */
  goal?: string;
  /** Or an act to run with these values. */
  act?: { name: string; fill: Filled };
  /**
   * Acts this order may commit on its own, by name. An `act` order covers its
   * own act. A `goal` order covers nothing unless it lists something here:
   * whatever the loop proposes from a goal waits for the person, because
   * letting a model choose WHICH act to commit unattended is letting it write
   * its own orders.
   */
  allow?: string[];
};

export type Order = { id: string; text: string; spec: OrderSpec; at: number };

/** The highest ceiling an order may carry. Anything higher is refused when it is written. */
export const MAX_CEILING: Radius = 'other-person';

export function checkOrder(spec: OrderSpec): string[] {
  const out: string[] = [];
  if (radiusRank(spec.ceiling) > radiusRank(MAX_CEILING)) {
    out.push(`a standing order cannot reach "${spec.ceiling}": money and anything irreversible are never done unattended`);
  }
  if (!spec.goal && !spec.act) out.push('an order needs a goal or an act');
  if ('every' in spec.schedule && spec.schedule.every < 60_000) out.push('an order runs at most once a minute');
  if ('daily' in spec.schedule && !/^([01]\d|2[0-3]):[0-5]\d$/.test(spec.schedule.daily)) out.push('daily needs HH:MM');
  return out;
}

// --------------------------------------------------------------------- inbox

export type InboxItem = {
  id: string;
  at: number;
  orderId?: string;
  /** done: committed on its own. waiting: needs a yes. notice: something to know. failed: could not. */
  kind: 'done' | 'waiting' | 'notice' | 'failed';
  title: string;
  detail: string;
  act?: string;
  fill?: Filled;
  /** For `done`: what the commit returned, so it can be undone later. */
  result?: CommitResult;
  /** For `waiting`: why it did not go ahead on its own. */
  why?: string[];
  read: boolean;
};

export interface Notifier {
  notify(item: InboxItem): void | Promise<void>;
}

export interface StateStore {
  load(): string | null;
  save(v: string): void;
}

/** Written before an unattended commit, removed after it settles. One left behind means the commit was cut off. */
export type Claim = { orderId: string; title: string; act: string; fill: Record<string, unknown>; at: number };
type State = { version: 1; inbox: InboxItem[]; lastRun: Record<string, number>; failures: Record<string, number>; seq: number; claims?: Record<string, Claim> };

// ---------------------------------------------------------------- authorise

export type Verdict = { ok: true } | { ok: false; why: string[] };

/**
 * May the conductor commit this run on the person's behalf, under this order?
 * Pure, synchronous, and every reason it says no is reported.
 */
export function authorise(run: ActRun, order: Order): Verdict {
  const why: string[] = [];
  const s = run.state();
  const radius = s.radius ?? 'external';

  // Found by independent review: a goal order let a model propose "let this
  // tool go ahead" or a new standing order, and both are cheap, undoable acts
  // that passed every other check. An order covers only the acts it names,
  // and nothing that grants authority is ever committed unattended.
  if (run.def.grantsAuthority) why.push('it changes what may happen without you, so only you can say yes to it');
  const allowed = order.spec.act ? [order.spec.act.name, ...(order.spec.allow ?? [])] : (order.spec.allow ?? []);
  if (!allowed.includes(run.def.name)) {
    why.push(order.spec.act ? `this order covers ${order.spec.act.name}, not ${run.def.name}` : `this order is a question; it does not cover doing ${run.def.name.replace(/_/g, ' ')}`);
  }
  if (radius === 'external') why.push('it is external: money and anything irreversible always wait for you');
  if (radiusRank(radius) > radiusRank(order.spec.ceiling)) why.push(`it reaches "${radius}", above what this order allows ("${order.spec.ceiling}")`);
  if (radiusRank(order.spec.ceiling) > radiusRank(MAX_CEILING)) why.push('the order itself asks for more than any order may');
  if (!run.def.undo) why.push('it cannot be undone');

  const missing = Object.entries(run.def.slots).filter(([n, d]) => d.required && s.slots[n]?.status !== 'filled').map(([n]) => n);
  if (missing.length) why.push(`it is missing ${missing.join(', ')}`);
  const guessed = Object.entries(s.slots).filter(([, st]) => st.status === 'filled' && st.provisional).map(([n]) => n);
  if (guessed.length) why.push(`${guessed.join(', ')} ${guessed.length === 1 ? 'is a guess' : 'are guesses'}`);
  if (s.status !== 'explicit' && s.status !== 'hold') why.push(`it is not ready (${s.status})`);

  return why.length ? { ok: false, why } : { ok: true };
}

// --------------------------------------------------------------- conductor

export type ConductorConfig = {
  app: App;
  memory: MemoryReader;
  clock: Clock;
  store: StateStore;
  ctx: () => Ctx;
  /** Pursues an order's goal. Usually `(g) => pyramid.pursue(g)`. */
  pursue?: (goal: string) => Promise<{ kind: string; answer?: string; act?: string; reason?: string; then?: unknown }>;
  notifier?: Notifier;
  heartbeatMs?: number;
  /** When a local wall-clock time is needed for daily orders. */
  localTime?: (ms: number) => { hours: number; minutes: number; dayStart: number };
};

export const DEFAULT_HEARTBEAT_MS = 60_000;
export const MAX_FAILURES = 3;

function defaultLocal(ms: number) {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { hours: d.getHours(), minutes: d.getMinutes(), dayStart: start };
}

export class Conductor {
  private state: State;
  private timer: TimerId | null = null;
  private running = false;
  private busy = false;

  constructor(private readonly config: ConductorConfig) {
    this.state = { version: 1, inbox: [], lastRun: {}, failures: {}, seq: 0 };
    const raw = config.store.load();
    if (raw) {
      try {
        const p = JSON.parse(raw) as State;
        if (p?.version === 1) this.state = p;
      } catch { /* start clean; a bad file must not stop the conductor */ }
    }
    // Claim before act (the idea is from Odysseus's effect log; no code from
    // it): a commit that was cut off by a crash or a restart is reported as
    // "may have happened" — never as done, never silently forgotten, and never
    // retried on its own, because doing it twice can be worse than once.
    const left = Object.values(this.state.claims ?? {});
    if (left.length) {
      this.state.claims = {};
      for (const c of left) {
        this.push({ orderId: c.orderId, kind: 'notice', title: c.title, act: c.act, fill: c.fill,
          detail: 'Tacit stopped while doing this, so it may or may not have happened. Please check before doing it again.' });
      }
      this.save();
    }
  }

  private save(): void {
    this.state.inbox = this.state.inbox.slice(-500);
    this.config.store.save(JSON.stringify(this.state));
  }

  /** The score, as memory holds it. Orders whose creating decision was undone are not in it. */
  orders(): Order[] {
    const v = this.config.memory.view();
    const undone = new Set(v.decisions.filter((d) => d.undone).map((d) => d.id));
    return Object.entries(v.orders)
      .filter(([id, o]) => o.active && !undone.has(id) && o.spec)
      .map(([id, o]) => ({ id, text: o.text, spec: o.spec as OrderSpec, at: o.at }))
      .filter((o) => checkOrder(o.spec).length === 0);
  }

  inbox(): readonly InboxItem[] {
    return this.state.inbox;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Fixed rate: the next beat is booked before this one runs, so a slow
    // order cannot stretch the rhythm. A beat that lands while the last is
    // still running is skipped by `busy`, not queued behind it.
    const beat = () => {
      if (!this.running) return;
      this.timer = this.config.clock.setTimeout(beat, this.config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
      void this.tick();
    };
    beat();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.config.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** When an order is next due. */
  nextRun(o: Order): number {
    const last = this.state.lastRun[o.id];
    const fails = this.state.failures[o.id] ?? 0;
    const backoff = fails > 0 ? Math.min(60 * 60_000, (this.config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS) * 2 ** fails) : 0;
    if ('every' in o.spec.schedule) {
      const base = last ?? o.at;
      return (fails > 0 && last !== undefined ? last + backoff : base + o.spec.schedule.every);
    }
    const [h, m] = o.spec.schedule.daily.split(':').map(Number) as [number, number];
    const from = last ?? o.at;
    const local = (this.config.localTime ?? defaultLocal)(from);
    let at = local.dayStart + (h * 60 + m) * 60_000;
    if (at <= from) at += 24 * 60 * 60_000;
    return fails > 0 && last !== undefined ? last + backoff : at;
  }

  /** One beat. Runs every order that is due. With no orders, it does nothing at all. */
  async tick(): Promise<void> {
    if (this.busy) return; // a slow order must not stack beats on top of itself
    this.busy = true;
    try {
      const now = this.config.clock.now();
      for (const o of this.orders()) {
        if (now < this.nextRun(o)) continue;
        await this.run(o);
      }
    } finally {
      this.busy = false;
    }
  }

  private push(item: Omit<InboxItem, 'id' | 'at' | 'read'>): InboxItem {
    const full: InboxItem = { ...item, id: `i${++this.state.seq}`, at: this.config.clock.now(), read: false };
    this.state.inbox.push(full);
    this.save();
    void Promise.resolve(this.config.notifier?.notify(full)).catch(() => {});
    return full;
  }

  /** Run one order now, whatever its schedule. */
  async run(o: Order): Promise<void> {
    const now = this.config.clock.now();
    try {
      let run: ActRun | null = null;

      if (o.spec.act) {
        const def = this.config.app.ui.definitions.find((d) => d.name === o.spec.act!.name);
        if (!def) throw new OrderError(`there is no "${o.spec.act.name}" in this app any more`);
        this.config.app.reset();
        run = this.config.app.ui.start(def.name);
        for (const [slot, v] of Object.entries(o.spec.act.fill)) if (def.slots[slot]) run.setValue(slot, v, 'model');
        run.evaluate();
      } else if (o.spec.goal) {
        if (!this.config.pursue) throw new OrderError('this conductor has no pyramid to pursue goals with');
        const out = await this.config.pursue(o.spec.goal);
        const final = (out.kind === 'split' ? out.then : out) as { kind: string; answer?: string; reason?: string };
        if (final.kind === 'answered') {
          this.push({ orderId: o.id, kind: 'notice', title: o.text, detail: final.answer ?? '' });
        } else if (final.kind === 'stopped') {
          this.push({ orderId: o.id, kind: 'failed', title: o.text, detail: final.reason ?? 'stopped' });
        } else if (final.kind === 'proposed') {
          run = this.config.app.act;
        }
      }

      if (run) await this.settle(run, o);
      this.state.lastRun[o.id] = now;
      delete this.state.failures[o.id];
      this.save();
    } catch (err) {
      const n = (this.state.failures[o.id] ?? 0) + 1;
      this.state.failures[o.id] = n;
      this.state.lastRun[o.id] = now;
      // Said once, when it first crosses the line — then it keeps retrying
      // quietly. Posting on every retry would wake someone every backoff step
      // all night, for news they already have.
      if (n === MAX_FAILURES || err instanceof OrderError) {
        this.push({ orderId: o.id, kind: 'failed', title: o.text, detail: `${(err as Error).message}${n > 1 ? ` (tried ${n} times)` : ''}` });
        if (err instanceof OrderError) this.state.failures[o.id] = 0;
      }
      this.save();
    }
  }

  private async settle(run: ActRun, o: Order): Promise<void> {
    const v = authorise(run, o);
    const title = this.titleOf(run);
    if (!v.ok) {
      const fill = { ...run.filled };
      run.discard();
      this.push({ orderId: o.id, kind: 'waiting', title, detail: o.text, act: run.def.name, fill, why: v.why });
      return;
    }
    // Not assent(): that is a person's tap, and it counts as the person
    // engaging. This is the order's assent, given in advance, and the core
    // refuses it for anything that grants authority.
    const claimId = `c${this.config.clock.now().toString(36)}${(this.state.seq + 1).toString(36)}`;
    (this.state.claims ??= {})[claimId] = { orderId: o.id, title, act: run.def.name, fill: { ...run.filled }, at: this.config.clock.now() };
    this.save();
    try {
      await run.assentUnattended();
    } finally {
      delete this.state.claims[claimId];
    }
    if (run.status === 'settled' && run.result) {
      this.push({ orderId: o.id, kind: 'done', title, detail: o.text, act: run.def.name, fill: { ...run.filled }, result: run.result });
    } else {
      this.push({ orderId: o.id, kind: 'failed', title, detail: 'the app refused it', act: run.def.name });
    }
  }

  private titleOf(run: ActRun): string {
    try {
      const p = run.def.preview?.(run.filled, this.config.ctx());
      if (p?.length) return p.map((x) => (typeof x === 'string' ? x : String((x as { label?: unknown })?.label ?? x))).join(' ');
    } catch { /* fall through */ }
    return run.def.name.replace(/_/g, ' ');
  }

  /**
   * Open a waiting item: its act goes on the stage with the values prepared,
   * as a system-initiated act — which by the engagement rule cannot commit on
   * silence. It needs the person's yes.
   */
  open(id: string): ActRun | null {
    const item = this.state.inbox.find((i) => i.id === id);
    if (!item || item.kind !== 'waiting' || !item.act) return null;
    const def = this.config.app.ui.definitions.find((d) => d.name === item.act);
    if (!def) return null;
    this.config.app.reset();
    const run = this.config.app.ui.start(def.name);
    for (const [slot, v] of Object.entries(item.fill ?? {})) if (def.slots[slot]) run.setValue(slot, v, 'model');
    run.evaluate();
    this.config.app.draw();
    item.read = true;
    this.save();
    return run;
  }

  markRead(id: string): void {
    const item = this.state.inbox.find((i) => i.id === id);
    if (item) { item.read = true; this.save(); }
  }
}

export class OrderError extends Error {
  constructor(message: string) { super(message); this.name = 'OrderError'; }
}

// ------------------------------------------------------------ the score acts

const HOW_OFTEN: { value: Schedule; label: string; aliases: string[] }[] = [
  { value: { every: 60 * 60_000 }, label: 'every hour', aliases: ['hourly'] },
  { value: { daily: '08:00' }, label: 'every morning', aliases: ['each morning', 'mornings'] },
  { value: { daily: '18:00' }, label: 'every evening', aliases: ['each evening', 'evenings', 'every night'] },
  { value: { every: 7 * 24 * 60 * 60_000 }, label: 'every week', aliases: ['weekly', 'each week'] },
];

/**
 * Writing the score is an act like any other: previewed, held, undoable. An
 * order written by anyone but the person is not an order.
 *
 * Orders written by voice carry a goal ("what is due") and the lowest ceiling:
 * self. Raising an order's ceiling is a deliberate setting, not a sentence.
 */
export function scoreActs(): ActDef[] {
  let n = 0;
  return [defineAct({
    name: 'set_standing_order',
    domain: 'teaching',
    // Writing the score is permission to act while the person is away. Only
    // the person may commit it — never the conductor, never a model.
    grantsAuthority: true,
    phrases: ['every morning', 'every evening', 'every hour', 'every week', 'each morning', 'from now on'],
    slots: {
      often: {
        primitive: 'chip', required: true, order: 1,
        options: () => HOW_OFTEN.map((h) => ({ value: h.value, label: h.label, aliases: h.aliases })),
      },
      goal: {
        primitive: 'ghostField', required: true, order: 2, fill: 'either',
        resolve: (text) => {
          const words = text.split(/\s+/);
          const drop = new Set(['every', 'each', 'morning', 'evening', 'night', 'hour', 'week', 'from', 'now', 'on', 'please', 'can', 'you']);
          let i = 0;
          while (i < words.length && drop.has(words[i]!.toLowerCase().replace(/[,.]/g, ''))) i++;
          const value = words.slice(i).join(' ').replace(/^[,\s]+/, '');
          return value ? [{ value, label: value, score: 0.6, calibrated: false }] : [];
        },
      },
    },
    radius: 'self',
    commit: (f) => {
      const id = `order-${Date.now().toString(36)}-${++n}`;
      const often = HOW_OFTEN.find((h) => JSON.stringify(h.value) === JSON.stringify(f.often));
      const spec: OrderSpec = { schedule: f.often as Schedule, ceiling: 'self', goal: String(f.goal) };
      const text = `${often?.label ?? 'regularly'}: ${String(f.goal)}`;
      return { id, memory: [{ kind: 'order', id, text, active: true, spec }] };
    },
    // The decision being undone is what retires the order: the conductor
    // reads only orders whose creating decision stands.
    undo: () => {},
    preview: (f) => [`${HOW_OFTEN.find((h) => JSON.stringify(h.value) === JSON.stringify(f.often))?.label ?? 'Regularly'}, ${f.goal ? String(f.goal) : '…'}`],
  })];
}

declare const console: { log(s: string): void };

/** Prints. The default when nothing better is wired. */
export class ConsoleNotifier implements Notifier {
  constructor(private readonly write: (s: string) => void = (s) => console.log(s)) {}
  notify(i: InboxItem): void {
    const mark = { done: '✓', waiting: '?', notice: '·', failed: '!' }[i.kind];
    this.write(`${mark} ${i.title} — ${i.why ? 'waiting: ' + i.why.join('; ') : i.detail}`);
  }
}
