/**
 * Devtools. Answering the only question a developer actually has:
 *
 *   "Why isn't it committing?"
 *
 * Everything else here — the recorder, the timeline — exists to answer that
 * question after the fact instead of in the moment. A contract that decides
 * things for you has to be able to say why, or it reads as flaky.
 */

import type {
  ActDef,
  ActRun,
  AIUIC,
  ActEvent,
  Ctx,
  Radius,
  StageState,
} from '@intermenu/aiuic-core';
import { attentionGate, explainRadius, holdDurationMs, radiusRank, slotOrder } from '@intermenu/aiuic-core';

// --------------------------------------------------------------- explaining

export type Reason =
  | { kind: 'missing'; slot: string }
  | { kind: 'narrowed'; slot: string; candidates: number }
  | { kind: 'stale'; slot: string }
  | { kind: 'provisional'; slot: string; radius: Radius }
  | { kind: 'gate'; failures: string[] }
  | { kind: 'external'; because: string }
  | { kind: 'frozen' }
  | { kind: 'settled' }
  | { kind: 'ready'; ms: number };

export type Explanation = {
  act: string;
  status: string;
  radius: Radius | null;
  /** Ordered: the first one is what to fix first. */
  reasons: Reason[];
  /** One line a developer can read without knowing the spec. */
  summary: string;
};

function phrase(r: Reason): string {
  switch (r.kind) {
    case 'missing': return `"${r.slot}" is empty and required`;
    case 'narrowed': return `"${r.slot}" has ${r.candidates} live candidates, so it is narrowed rather than filled`;
    case 'stale': return `"${r.slot}" went stale — its options or snapshot changed since it was chosen`;
    case 'provisional': return `"${r.slot}" was filled on a weak or uncalibrated match, and "${r.radius}" is too costly to commit on a guess`;
    case 'gate': return `the attention gate failed: ${r.failures.join('; ')}`;
    case 'external': return `the radius is "external" — ${r.because}`;
    case 'frozen': return 'it is frozen: someone said no, or the session was paused';
    case 'settled': return 'it already committed';
    case 'ready': return `it is holding — ${r.ms}ms of silence will commit it`;
  }
}

/**
 * Why this act is where it is. Reasons come back in the order they block, so
 * the first one is the one to fix.
 */
export function explain(run: ActRun, ctx: Ctx): Explanation {
  const s: StageState = run.state();
  const def: ActDef = run.def;
  const reasons: Reason[] = [];

  if (s.status === 'settled') reasons.push({ kind: 'settled' });
  if (s.status === 'frozen') reasons.push({ kind: 'frozen' });

  for (const name of slotOrder(def)) {
    const slot = s.slots[name];
    if (!slot) continue;
    if (def.slots[name]?.required && slot.status === 'empty') reasons.push({ kind: 'missing', slot: name });
    if (slot.status === 'narrowed') reasons.push({ kind: 'narrowed', slot: name, candidates: slot.candidates?.length ?? 0 });
    if (slot.stale) reasons.push({ kind: 'stale', slot: name });
  }

  const radius = s.radius;
  if (radius && radiusRank(radius) >= radiusRank('other-person')) {
    for (const name of slotOrder(def)) {
      if (def.slots[name]?.required && s.slots[name]?.provisional) {
        reasons.push({ kind: 'provisional', slot: name, radius });
      }
    }
  }

  if (radius === 'external') {
    const b = explainRadius(def, run.filled, ctx);
    const culprit = b.effects.find((e) => e.radius === 'external');
    const byEffect = culprit
      ? `effect "${culprit.name}" forces it (${culprit.why ?? 'declared external'})`
      : null;

    // Name every cause, not just the first. Lowering the act's own radius does
    // nothing while an effect still forces it, and that is exactly the thing a
    // developer tries next.
    const because =
      b.commit === 'external'
        ? byEffect
          ? `the act declares it, and ${byEffect} regardless`
          : 'the act itself declares it'
        : byEffect ?? 'something in it cannot be taken back';

    reasons.push({ kind: 'external', because });
  }

  const gate = attentionGate(ctx.attention, s.gateFailures === undefined);
  if (s.gateFailures?.length) reasons.push({ kind: 'gate', failures: s.gateFailures });
  else if (!gate.pass && s.status === 'explicit') reasons.push({ kind: 'gate', failures: gate.failures });

  if (reasons.length === 0 && s.status === 'hold') {
    reasons.push({ kind: 'ready', ms: Math.round(s.holdRemainingMs ?? holdDurationMs(radius ?? 'self', ctx)) });
  }

  const summary = reasons.length ? phrase(reasons[0]!) : `status "${s.status}" with nothing blocking it`;
  return { act: def.name, status: s.status, radius, reasons, summary };
}

// ---------------------------------------------------------------- recording

export type Frame = { at: number; event: ActEvent };

/**
 * Every event, with a timestamp. Small enough to keep in memory for a whole
 * session and to paste into a bug report.
 */
export class Recorder {
  readonly frames: Frame[] = [];
  private detach: (() => void) | null = null;
  private t0 = 0;

  constructor(private readonly now: () => number = () => Date.now(), private readonly limit = 2000) {}

  attach(ui: AIUIC): () => void {
    this.t0 = this.now();
    this.detach = ui.on((event) => {
      this.frames.push({ at: this.now() - this.t0, event });
      if (this.frames.length > this.limit) this.frames.shift();
    });
    return () => this.stop();
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
  }

  clear(): void {
    this.frames.length = 0;
    this.t0 = this.now();
  }

  /** Stage events are noise in a timeline; the decisions are the signal. */
  get decisions(): Frame[] {
    return this.frames.filter((f) => f.event.type !== 'stage');
  }

  /**
   * A timeline you can read in a terminal. HOLD durations are shown against
   * what actually happened, which is how you catch a clock that restarted.
   */
  timeline(): string {
    const rows: string[] = [];
    for (const f of this.decisions) {
      const t = String(f.at).padStart(6, ' ') + 'ms';
      const e = f.event;
      switch (e.type) {
        case 'hold-start': rows.push(`${t}  HOLD      ${e.act}  ${e.ms}ms at ${e.radius}`); break;
        case 'hold-cancel': rows.push(`${t}  cancel    ${e.act}  ${e.reason}`); break;
        case 'commit': rows.push(`${t}  COMMIT    ${e.act}  -> ${e.result.id}`); break;
        case 'undo': rows.push(`${t}  undo      ${e.act}`); break;
        case 'failed': rows.push(`${t}  FAILED    ${e.act}  ${String(e.error)}`); break;
        case 'frozen': rows.push(`${t}  freeze    ${e.act}  ${e.reason}`); break;
        case 'discarded': rows.push(`${t}  discard   ${e.act}`); break;
        case 'blocked': rows.push(`${t}  blocked   ${e.act}  ${e.reason}${e.failures ? ' [' + e.failures.join('; ') + ']' : ''}`); break;
        default: break;
      }
    }
    return rows.join('\n');
  }

  /** Counts that tend to matter when something feels wrong. */
  stats(): { holds: number; commits: number; cancels: number; undos: number; blocked: number; medianHoldMs: number | null } {
    const holds = this.decisions.filter((f) => f.event.type === 'hold-start');
    const durations = holds
      .map((f) => (f.event as { ms: number }).ms)
      .sort((a, b) => a - b);
    return {
      holds: holds.length,
      commits: this.decisions.filter((f) => f.event.type === 'commit').length,
      cancels: this.decisions.filter((f) => f.event.type === 'hold-cancel').length,
      undos: this.decisions.filter((f) => f.event.type === 'undo').length,
      blocked: this.decisions.filter((f) => f.event.type === 'blocked').length,
      medianHoldMs: durations.length ? durations[Math.floor(durations.length / 2)]! : null,
    };
  }

  toJSON(): string {
    return JSON.stringify({ version: 1, frames: this.frames }, null, 2);
  }
}

// ------------------------------------------------------------------ linting

export type Lint = { act: string; level: 'error' | 'warn' | 'note'; message: string };

/**
 * One report out of several audits.
 *
 * The contract audit below and a design-language audit are deliberately
 * separate functions: a contract smell is a warning about something that will
 * surprise you, while a language violation is an error about something that
 * makes a colour a lie. Merging the two would flatten that. Concatenating
 * their output should still be one readable list, so the formatting lives
 * here and both feed it.
 */
export function formatLints(lints: Lint[]): string {
  if (lints.length === 0) return 'clean';
  const rank = { error: 0, warn: 1, note: 2 } as const;
  return [...lints]
    .sort((a, b) => rank[a.level] - rank[b.level] || a.act.localeCompare(b.act))
    .map((l) => `${l.level.padEnd(5)} ${l.act}: ${l.message}`)
    .join('\n');
}

/**
 * Definition-time checks in `defineAct` are the ones that must fail loudly.
 * These are the softer ones: shapes that compile and will still surprise
 * somebody.
 */
export function lintActs(acts: ActDef[]): Lint[] {
  const out: Lint[] = [];
  const seenPhrases = new Map<string, string>();

  for (const act of acts) {
    const slots = Object.entries(act.slots);
    const required = slots.filter(([, s]) => s.required);
    const max = typeof act.radius === 'string' ? act.radius : act.radius.max;

    if (required.length === 0) {
      out.push({ act: act.name, level: 'warn',
        message: 'no required slots — this act reaches HOLD the instant it starts' });
    }
    if (!act.phrases?.length) {
      out.push({ act: act.name, level: 'note',
        message: 'no trigger phrases — routing has only slot coverage to go on' });
    }
    for (const p of act.phrases ?? []) {
      const owner = seenPhrases.get(p.toLowerCase());
      if (owner && owner !== act.name) {
        out.push({ act: act.name, level: 'note',
          message: `shares the phrase "${p}" with "${owner}" — expect a NARROW between them` });
      }
      seenPhrases.set(p.toLowerCase(), act.name);
    }
    if (required.some(([, s]) => s.fill === 'model')) {
      out.push({ act: act.name, level: 'warn',
        message: 'a required slot is model-filled, so this act has no offline path' });
    }
    if (max !== 'external' && !act.undo) {
      out.push({ act: act.name, level: 'warn', message: 'below external with no undo' });
    }
    if (act.effects?.length && !act.effects.some((e) => e.when) && max === 'other-person') {
      out.push({ act: act.name, level: 'note',
        message: 'an unconditional effect at other-person — if it can ever be a no-op, give it when() so it stops costing radius' });
    }
    const orders = slots.map(([, s]) => s.order);
    if (new Set(orders).size !== orders.length) {
      out.push({ act: act.name, level: 'warn', message: 'duplicate slot order' });
    }
    if (!act.preview) {
      out.push({ act: act.name, level: 'note',
        message: 'no preview — the user agrees to a row of slots rather than a sentence' });
    }
  }

  return out;
}
