/**
 * Smart notifications: how the system speaks to a person when they are not
 * speaking to it.
 *
 * Everything else in this repository answers. This is the half that starts a
 * conversation — and starting one costs the person their attention, which is
 * the scarcest thing a "tool for thinkers" has to protect. So the design
 * question is not how to send more, it is when not to interrupt.
 *
 * Four rules, each held by a test:
 *
 *   1. The AI may delay a notice; it may never hide one. Every notice that
 *      arrives stays readable on the desk. What the AI decides is only WHEN
 *      it interrupts: now, in a bundle, in the next briefing. Same rule as
 *      the menus, for the same reason — quietly dropping something is taking
 *      a decision away from the person without writing anything.
 *   2. Interrupting has a budget. Quiet hours and an hourly cap; only what is
 *      marked urgent by its source AND clears the bar breaks through.
 *   3. Sending to somebody else is an act. It goes through the contract with
 *      radius 'other-person', so it never happens on silence or while the
 *      person is away. Sending to yourself is 'self'.
 *   4. The shared context memory flows one way: from the world to every user,
 *      never from any user into it. Nothing a person says can reach it,
 *      because it has no door that takes anything about a person.
 */

import { defineAct, type ActDef } from '@intermenu/aiuic-core';

// ----------------------------------------------------------------- a notice

export type Notice = {
  id: string;
  /** Where it came from: 'app:bank', 'world', 'conductor', 'person:maya'. */
  from: string;
  title: string;
  body?: string;
  /** What it is about, for bundling and for matching the person's interests. */
  topics: string[];
  /** The source's own claim, 0..1. A claim, not a verdict: see `decide`. */
  urgency: number;
  at: number;
  /** After this it is no longer news. */
  expiresAt?: number;
  /** Notices sharing a key are one story told several times. */
  groupKey?: string;
  /** Where it happened, when that matters. */
  place?: { lat: number; lon: number; label?: string };
};

export type Delivery = 'now' | 'bundle' | 'briefing';

export type Decided = { notice: Notice; delivery: Delivery; why: string };

export type Budget = {
  /** Interruptions allowed per rolling hour. */
  perHour: number;
  /** Local hours [from, to) when nothing interrupts. Wraps midnight. */
  quiet?: [number, number];
  /** How urgent a notice must be to interrupt at all. */
  bar: number;
  /** Sources allowed to break quiet hours, if urgent enough. 'person:*' matches any person. */
  breakthrough?: string[];
};

export const DEFAULT_BUDGET: Budget = { perHour: 3, quiet: [22, 7], bar: 0.7, breakthrough: ['person:*'] };

const inQuiet = (hour: number, q?: [number, number]) => {
  if (!q) return false;
  const [a, b] = q;
  return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
};

const matches = (from: string, patterns: string[] = []) =>
  patterns.some((p) => p === from || (p.endsWith(':*') && from.startsWith(p.slice(0, -1))));

// --------------------------------------------------------------------- desk

/**
 * Where notices land. It keeps every one of them, and decides only when each
 * one is allowed to interrupt.
 */
export class Desk {
  private readonly notices: Notice[] = [];
  private readonly interrupted: number[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly budget: Budget = DEFAULT_BUDGET, private readonly hourOf: (t: number) => number = (t) => new Date(t).getHours()) {}

  /** Take a notice in. Duplicates (same id) are kept once; nothing is ever discarded. */
  ingest(n: Notice): Decided {
    if (this.seen.has(n.id)) {
      return { notice: n, delivery: 'briefing', why: 'already on the desk' };
    }
    this.seen.add(n.id);
    this.notices.push(n);
    return this.decide(n);
  }

  private decide(n: Notice): Decided {
    const hourAgo = n.at - 3_600_000;
    while (this.interrupted.length && this.interrupted[0]! < hourAgo) this.interrupted.shift();

    if (n.urgency < this.budget.bar) {
      return { notice: n, delivery: 'briefing', why: 'not urgent enough to interrupt; it waits for the briefing' };
    }
    if (inQuiet(this.hourOf(n.at), this.budget.quiet) && !matches(n.from, this.budget.breakthrough)) {
      return { notice: n, delivery: 'bundle', why: 'quiet hours; it is held for when they end' };
    }
    // The same story arriving again does not get to interrupt twice.
    if (n.groupKey && this.notices.some((o) => o !== n && o.groupKey === n.groupKey && o.at > hourAgo)) {
      return { notice: n, delivery: 'bundle', why: 'part of a story already told this hour' };
    }
    if (this.interrupted.length >= this.budget.perHour) {
      return { notice: n, delivery: 'bundle', why: `already interrupted ${this.interrupted.length} times this hour` };
    }
    this.interrupted.push(n.at);
    return { notice: n, delivery: 'now', why: 'urgent, and within the budget' };
  }

  /** Everything on the desk, newest first. The AI cannot remove anything from this list. */
  all(): Notice[] {
    return [...this.notices].sort((a, b) => b.at - a.at);
  }

  /** Stories, not items: notices grouped by their key, or by their first topic. */
  bundles(): { key: string; notices: Notice[] }[] {
    const groups = new Map<string, Notice[]>();
    for (const n of this.notices) {
      const key = n.groupKey ?? n.topics[0] ?? n.from;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
    }
    return [...groups].map(([key, notices]) => ({ key, notices: notices.sort((a, b) => b.at - a.at) }))
      .sort((a, b) => b.notices[0]!.at - a.notices[0]!.at);
  }
}

// -------------------------------------------------------- sending, as an act

export type Channel = {
  send(to: string, title: string, body: string): Promise<{ id: string }>;
  /** Take it back, where the channel can. Without this, sending is external. */
  retract?(id: string): Promise<void>;
};

/**
 * Sending a notification to somebody is something done to them, so it is an
 * act with a blast radius, not a side effect of a plan. To yourself it is
 * 'self'; to anybody else 'other-person' — never on silence, never unattended.
 * A channel that cannot retract makes it external: there is no taking it back.
 */
export function notifyAct(channel: Channel, people: { value: string; label: string }[]): ActDef {
  return defineAct({
    name: 'send_notification',
    domain: 'notifications',
    phrases: ['notify', 'tell', 'remind', 'let know', 'send a note'],
    slots: {
      to: { primitive: 'face', options: () => [{ value: 'me', label: 'Me' }, ...people], required: true, order: 1 },
      message: { primitive: 'ghostField', resolve: (t) => (t.trim() ? [{ value: t.trim(), label: t.trim(), score: 0.6, calibrated: false }] : []), required: true, order: 2 },
    },
    radius: { max: channel.retract ? 'other-person' : 'external', of: (f) => (f.to === 'me' ? 'self' : channel.retract ? 'other-person' : 'external') },
    commit: async (f) => {
      const message = String(f.message);
      const r = await channel.send(String(f.to), message.slice(0, 80), message);
      return { id: r.id };
    },
    ...(channel.retract ? { undo: async (r: { id: string }) => { await channel.retract!(r.id); } } : {}),
  });
}

// ---------------------------------------------------------- context memory

/**
 * What the world knows, as opposed to what the person said.
 *
 * Personal memory holds the person's own words; this holds what can be found
 * outside them — feeds, events, markets, weather. It is shared by every user,
 * which is exactly why it must be one-way: items come in from world sources
 * and go out to briefings, and there is no method that accepts anything about
 * a person. A user's interests select FROM it; they are never written TO it.
 */
export type ContextItem = {
  id: string;
  source: string;
  title: string;
  summary?: string;
  topics: string[];
  at: number;
  place?: { lat: number; lon: number; label?: string };
  url?: string;
};

export interface WorldSource {
  readonly name: string;
  /** Everything new since `since`. Read-only, by construction. */
  pull(since: number): Promise<ContextItem[]>;
}

export class ContextMemory {
  private readonly items = new Map<string, ContextItem>();
  private lastPull = 0;

  constructor(private readonly sources: readonly WorldSource[], private readonly keepMs = 7 * 86_400_000) {}

  /** The daily gulp. A source that fails is skipped; the others still land. */
  async refresh(now: number): Promise<{ added: number; failed: string[] }> {
    let added = 0;
    const failed: string[] = [];
    for (const s of this.sources) {
      try {
        for (const it of await s.pull(this.lastPull)) {
          if (!this.items.has(it.id)) added++;
          this.items.set(it.id, it);
        }
      } catch { failed.push(s.name); }
    }
    for (const [id, it] of this.items) if (it.at < now - this.keepMs) this.items.delete(id);
    this.lastPull = now;
    return { added, failed };
  }

  /** What matches these topics, or lies within `km` of a place. */
  query(q: { topics?: string[]; near?: { lat: number; lon: number; km: number }; since?: number }): ContextItem[] {
    const want = (q.topics ?? []).map((t) => t.toLowerCase());
    return [...this.items.values()].filter((it) => {
      if (q.since && it.at < q.since) return false;
      const topical = want.length > 0 && it.topics.some((t) => want.includes(t.toLowerCase()));
      const local = !!q.near && !!it.place && km(q.near, it.place) <= q.near.km;
      return topical || local;
    }).sort((a, b) => b.at - a.at);
  }

  get size(): number { return this.items.size; }
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------- briefing

export type Profile = {
  /** What they care about, in their words. Ranked: first matters most. */
  interests: string[];
  /** Where they are, so "around you" means something. */
  home?: { lat: number; lon: number; km: number; label?: string };
  /** Minutes they want it to take. Briefings are read aloud at ~130 words a minute. */
  minutes?: number;
};

export type BriefingItem = { title: string; why: string; source: string; at: number; words: number };
export type Briefing = { sections: { name: string; items: BriefingItem[] }[]; words: number; minutes: number; leftOut: number };

const WPM = 130;

/**
 * The morning report. Three sections, in this order, because this is the
 * order a person needs them in: what is waiting for YOU (your own desk),
 * what is happening AROUND you, then what moved in the things you follow.
 * World items appear only when they touch an interest or a place the person
 * gave — never because they are loud. Every line says why it is there.
 */
export function brief(profile: Profile, desk: Desk, context: ContextMemory, now: number): Briefing {
  const budget = (profile.minutes ?? 15) * WPM;
  const since = now - 86_400_000;
  const rank = (topics: string[]) => {
    const i = profile.interests.findIndex((x) => topics.some((t) => t.toLowerCase() === x.toLowerCase()));
    return i < 0 ? Infinity : i;
  };
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

  const mine = desk.all().filter((n) => n.at >= since && n.from !== 'world').map((n) => ({
    title: n.title, why: n.urgency >= 0.7 ? 'it was marked urgent' : `from ${n.from}`,
    source: n.from, at: n.at, words: words(`${n.title} ${n.body ?? ''}`),
  }));

  const around = profile.home
    ? context.query({ near: profile.home, since }).map((it) => ({
      title: it.title, why: `near ${profile.home!.label ?? 'you'}`, source: it.source, at: it.at,
      words: words(`${it.title} ${it.summary ?? ''}`),
    }))
    : [];
  const aroundIds = new Set(around.map((a) => a.title));

  const followed = context.query({ topics: profile.interests, since })
    .filter((it) => !aroundIds.has(it.title))
    .sort((a, b) => rank(a.topics) - rank(b.topics) || b.at - a.at)
    .map((it) => {
      const hit = profile.interests.find((x) => it.topics.some((t) => t.toLowerCase() === x.toLowerCase()))!;
      return { title: it.title, why: `you follow ${hit}`, source: it.source, at: it.at, words: words(`${it.title} ${it.summary ?? ''}`) };
    });

  let used = 0, leftOut = 0;
  const take = (xs: BriefingItem[]) => xs.filter((x) => {
    if (used + x.words > budget) { leftOut++; return false; }
    used += x.words; return true;
  });
  const sections = [
    { name: 'For you', items: take(mine) },
    { name: 'Around you', items: take(around) },
    { name: 'What you follow', items: take(followed) },
  ].filter((s) => s.items.length);

  return { sections, words: used, minutes: Math.round((used / WPM) * 10) / 10, leftOut };
}
export * from './worldmonitor.js';
