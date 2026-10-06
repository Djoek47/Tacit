/**
 * Getting to know someone, as a conversation.
 *
 * Not a questionnaire with a voice. The rules a good listener follows:
 *   - one question at a time, and never the same words twice;
 *   - when someone has a lot to say, stay with it — ask why, ask for the story;
 *   - when they mention something in passing, pick it up ("you said hockey…");
 *   - when answers get short, change the subject or play something quick;
 *   - say back what you heard now and then, so they can correct you;
 *   - offer a break before they need one, and remember where you stopped;
 *   - ask before going anywhere private, and take no for an answer, once.
 *
 * Every move is a decision made from what was just said, so the same person
 * on a different day gets a different conversation. The decisions are plain
 * rules today; `classify` is where Jev (or any fast classifier) plugs in to
 * tell which thread a sentence touches, and `summarize` is where a model
 * turns a ramble into a clean line. Neither is needed for it to work.
 */
import { normalize } from '@intermenu/aiuic-resolve';
import { DOMAINS, THREADS, domainById, threadById, type Thread } from './map.js';
import { ITEMS, PAIRS, agreement, describe, picked, traits, type Pair } from './games.js';
import { Person, type Depth, type Fact } from './person.js';

export type Move =
  | 'greet' | 'ask' | 'deeper' | 'story' | 'bridge' | 'switch' | 'game' | 'recap'
  | 'consent' | 'why' | 'park' | 'break' | 'briefing' | 'traits' | 'again';

export type Line = { say: string; move: Move; thread?: string; recorded?: Fact[] };

export type ConversationOptions = {
  person: Person;
  now?: () => number;
  /** Which thread a sentence touches, among candidates. Jev-class; optional. */
  classify?: (text: string, candidates: Thread[]) => string | null;
  /** A clean one-line summary of an answer. A model's job; optional. */
  summarize?: (text: string, thread: Thread, depth: Depth) => string;
  /** Questions Tacit may ask, unprompted, in a day of ordinary use. */
  dailyCuriosity?: number;
};

/** The first few threads: what the rest of the product needs soonest. */
const FIRST = ['basics.name', 'basics.home', 'rhythm.wake', 'work.what', 'interests.follow', 'people.closest',
  'talk.length', 'rhythm.interruptions', 'people.reach', 'goals.year', 'people.birthdays'];
const LIGHT = new Set(['tastes', 'interests', 'talk']);

const STOP = /^(stop|that s enough|enough for now|let s stop|pause|bye|goodbye|later|gotta go|i have to go)\b/;
const SKIP = /^(skip|pass|next|next question|i d rather not|rather not|no comment|not that one|change the subject)\b/;
const WHY = /\bwhy (do|would|are) you (want to know|ask|asking)\b|\bwhat s that for\b/;
const YES = /^(yes|yeah|yep|sure|ok|okay|go ahead|let s do it|why not|alright|sounds good|let s go|keep going|go on|now)\b/;
const NO = /^(no|nope|nah|not now|skip it|rather not|later|i d rather not)\b/;

/** Cue words too ordinary to mean the person changed the subject. */
const VAGUE = new Set(['right', 'wrong', 'from', 'team', 'game', 'date', 'left', 'start', 'plan', 'today', 'never', 'give', 'help', 'rule', 'line',
  'short', 'long', 'detail', 'play', 'read', 'live', 'home', 'city', 'call me', 'name', 'work', 'good', 'matters', 'important', 'value', 'care about',
  'point', 'trust', 'future', 'world', 'going', 'dream', 'goal', 'habit', 'quit', 'show', 'model', 'code', 'tech', 'tool', 'money', 'save', 'spend',
  'back home', 'country', 'born', 'learn', 'study', 'people', 'family', 'friend', 'this year', 'this week', 'someday', 'fear', 'afraid', 'deserve',
  'risk', 'safe', 'decide', 'gift', 'present', 'surprise', 'music', 'party', 'design', 'voice', 'tone', 'questions', 'curious', 'switch', 'french', 'english']);

const FILLER = /^(ok|okay|sure|fine|yeah|yes|no|idk|i don t know|whatever|dunno|maybe|mhm|mm|eh|meh)\b/;

const ACK_SHORT = ['Okay.', 'Got it.', 'Noted.', 'Fair.', 'Right.'];
const ACK_LONG = ['That makes sense.', 'I can picture that.', 'Interesting.', 'Okay, that helps.', 'Huh.'];

export class Conversation {
  readonly person: Person;
  private readonly now: () => number;
  private current: { thread: Thread; depth: Depth } | null = null;
  private mode: 'talk' | 'pairs' | 'items' | 'traits' | 'consent' | 'briefing' | 'break' | 'parked' = 'talk';
  private consentFor: string | null = null;
  private pairs: Pair[] = [];
  private unclear = 0;
  private itemAnswers: number[] = [];
  private pendingTraits: Fact[] = [];
  private turns = 0;
  private onThread = 0;
  private sinceGame = 0;
  private sinceRecap = 0;
  private games = 0;
  private energy = 0.6;
  private started = 0;
  private last = 0;
  private offeredBreak = false;
  private asked = new Map<string, number>();
  private askedConsent = new Set<string>();
  private recent: Fact[] = [];
  private acks = 0;
  private ambientDay = '';
  private ambientCount = 0;

  constructor(private readonly o: ConversationOptions) {
    this.person = o.person;
    this.now = o.now ?? Date.now;
  }

  get topic(): string | null { return this.current?.thread.topic ?? null; }
  get waitingFor(): typeof this.mode { return this.mode; }

  /** Tacit speaks first. What it says depends on the hour and on whether you have met. */
  open(c: { hour: number; name?: string; briefingReady?: boolean }): Line {
    this.started = this.last = this.now();
    this.offeredBreak = false;
    const met = this.person.all().length > 0;
    const hi = c.name ? `, ${c.name}` : '';
    if (met && c.briefingReady && c.hour >= 5 && c.hour < 12) {
      this.mode = 'briefing';
      return { say: `Morning${hi}. Your briefing is ready — want it now, or should we talk first?`, move: 'greet' };
    }
    if (!met) {
      const q = this.ask(this.pick());
      return { ...q, say: `Hi — I'm Tacit. I'd like to get to know you the way a friend would: no form, we just talk. Say "skip" to anything, and "stop" whenever. ${q.say}`, move: 'greet' };
    }
    const resume = this.current;
    const greeting = c.hour < 5 ? `Still up${hi}?` : c.hour < 12 ? `Morning${hi}.` : c.hour < 18 ? `Hey${hi}.` : `Evening${hi}.`;
    const q = resume ? this.ask(resume.thread, resume.depth) : this.ask(this.pick());
    const back = resume ? ` Last time we were on ${resume.thread.topic.toLowerCase()}.` : '';
    return { ...q, say: `${greeting}${back} ${q.say}`, move: 'greet' };
  }

  /** One thing the person said. */
  hear(text: string): Line {
    const t = normalize(text.replace(/[’']/g, ' '));
    const now = this.now();
    this.person.minutes += Math.min(5, (now - (this.last || now)) / 60_000);
    this.last = now;
    this.turns++;

    if (STOP.test(t)) return this.park();
    if (WHY.test(t) && this.current) return this.why();

    switch (this.mode) {
      case 'briefing':
        this.mode = 'talk';
        if (YES.test(t) || /\bbrief|briefing|now\b/.test(t)) return { say: '', move: 'briefing' };
        return this.ask(this.pick(), 1, 'Sure.');
      case 'break':
        this.mode = 'talk';
        if (YES.test(t) || /\b(keep|more|continue|go on)\b/.test(t)) return this.next('Good.');
        return this.park();
      case 'consent': return this.consentReply(t);
      case 'pairs': return this.pairReply(text);
      case 'items': return this.itemReply(text);
      case 'traits': return this.traitsReply(t);
      case 'parked': this.mode = 'talk'; return this.ask(this.current?.thread ?? this.pick(), this.current?.depth ?? 1, 'Welcome back.');
    }

    if (!this.current) return this.next();
    if (SKIP.test(t)) { this.onThread = 99; return this.next('No problem.'); }

    // Record what was said, in their words, at the depth it answered. When the
    // answer is plainly about something else, it is filed there and the
    // conversation follows the person's lead instead of dragging them back.
    const words = t.split(' ').filter(Boolean).length;
    let { thread, depth } = this.current;
    const elsewhere = words >= 6 ? this.elsewhere(text, thread) : null;
    if (elsewhere) { thread = elsewhere; depth = Math.min(3, this.person.depthOf(elsewhere.id) + 1) as Depth; this.current = { thread, depth }; this.onThread = 0; }
    const fact = this.person.record({ thread: thread.id, depth, text: this.o.summarize?.(text, thread, depth) ?? clean(text, thread), quote: text.trim() });
    this.recent.push(fact);
    if (this.recent.length > 6) this.recent.shift();

    // Energy: a one-word answer to "where do you live" is just an answer. What
    // signals a fading person is filler ("ok", "sure", "idk"), or short replies
    // to the questions that invite a story.
    const filler = FILLER.test(t) && words <= 3;
    if (filler) this.energy = 0.5 * this.energy;
    else if (depth >= 2) this.energy = 0.6 * this.energy + 0.4 * Math.min(1, words / 20);
    else this.energy = Math.min(1, this.energy + (words >= 8 ? 0.15 : 0.05));
    this.onThread++; this.sinceGame++; this.sinceRecap++;
    const ack = this.ack(words);

    // Half an hour in: offer a break, once.
    if (!this.offeredBreak && now - this.started >= 30 * 60_000) {
      this.offeredBreak = true; this.mode = 'break';
      return { say: `${ack} We've been at this for half an hour and I'm enjoying it. Keep going, or pick it up later?`, move: 'break', recorded: [fact] };
    }
    // Every so often, something quick.
    if (this.sinceGame >= 7 || (this.energy < 0.3 && this.sinceGame >= 3)) return { ...this.game(ack), recorded: [fact] };
    // Every so often, say back what was heard.
    if (this.sinceRecap >= 15 && this.recent.length >= 3) {
      this.sinceRecap = 0;
      const heard = this.recent.slice(-3).map((f) => f.text).join('; ');
      const q = this.next();
      return { say: `Let me check I've got you right: ${heard}. Tell me if any of that is off. ${q.say}`, move: 'recap', thread: q.thread, recorded: [fact] };
    }
    // They have a lot to say: stay with it.
    if (words >= 12 && depth < 3 && this.onThread < 3) {
      return { ...this.ask(thread, (depth + 1) as Depth, ack), recorded: [fact] };
    }
    // They mentioned something in passing: pick it up.
    const bridge = this.bridge(text, thread);
    if (bridge) {
      const q = this.ask(bridge.thread, 1);
      return { ...q, say: `${ack} You mentioned ${bridge.word} — ${q.say.charAt(0).toLowerCase()}${q.say.slice(1)}`, move: 'bridge', recorded: [fact] };
    }
    return { ...this.next(ack, this.energy < 0.35), recorded: [fact] };
  }

  /**
   * One curious question in ordinary use, within a daily budget, never while
   * something else is happening. `null` means stay quiet.
   */
  ambient(c: { busy: boolean; day: string }): Line | null {
    if (c.busy || this.mode !== 'talk') return null;
    if (c.day !== this.ambientDay) { this.ambientDay = c.day; this.ambientCount = 0; }
    if (this.ambientCount >= (this.o.dailyCuriosity ?? 3)) return null;
    this.ambientCount++;
    const th = this.pick();
    return this.ask(th, (Math.min(3, this.person.depthOf(th.id) + 1)) as Depth, 'Can I ask you something?');
  }

  // ------------------------------------------------------------------ moves

  private ask(thread: Thread, depth: Depth = 1, lead = ''): Line {
    this.current = { thread, depth };
    if (depth === 1) this.onThread = 0;
    const n = this.asked.get(thread.id) ?? 0;
    this.asked.set(thread.id, n + 1);
    const q = depth === 1 ? thread.open[n % thread.open.length]! : depth === 2 ? thread.deeper : thread.story;
    return { say: `${lead ? `${lead} ` : ''}${q}`, move: depth === 1 ? 'ask' : depth === 2 ? 'deeper' : 'story', thread: thread.id };
  }

  private next(lead = '', light = false): Line {
    const priv = this.privateDue();
    if (priv) {
      this.mode = 'consent'; this.consentFor = priv.id; this.askedConsent.add(priv.id);
      return { say: `${lead ? `${lead} ` : ''}${priv.ask}`, move: 'consent' };
    }
    const switching = !!this.current;
    const th = this.pick(light);
    const depth = Math.min(3, this.person.depthOf(th.id) + 1) as Depth;
    return { ...this.ask(th, depth, lead), move: switching ? 'switch' : 'ask' };
  }

  /** The next thread: what the product needs first, then the least-known area. */
  private pick(light = false): Thread {
    const cur = this.current?.thread.id;
    const open = (th: Thread) => {
      const d = domainById.get(th.domain)!;
      return th.id !== cur && (!d.private || this.person.consentFor(d.id) === 'yes');
    };
    const fresh = (th: Thread) => this.person.depthOf(th.id) === 0 && !this.asked.has(th.id);
    for (const id of FIRST) { const th = threadById.get(id)!; if (open(th) && fresh(th) && (!light || LIGHT.has(th.domain))) return th; }

    const cov = new Map(this.person.coverage().domains.map((d) => [d.id, d.covered]));
    const domains = DOMAINS.filter((d) => cov.has(d.id) && (!light || LIGHT.has(d.id)))
      .sort((a, b) => (cov.get(a.id)! - cov.get(b.id)!) || (DOMAINS.indexOf(a) - DOMAINS.indexOf(b)));
    for (const d of domains) {
      const th = THREADS.find((x) => x.domain === d.id && open(x) && fresh(x));
      if (th) return th;
    }
    // Everything has been touched: go deeper where it is shallowest.
    const candidates = THREADS.filter(open).sort((a, b) => this.person.depthOf(a.id) - this.person.depthOf(b.id) || (this.asked.get(a.id) ?? 0) - (this.asked.get(b.id) ?? 0));
    return candidates[0] ?? THREADS[0]!;
  }

  private bridge(text: string, from: Thread): { thread: Thread; word: string } | null {
    const t = ` ${normalize(text.replace(/[’']/g, ' '))} `;
    const candidates = THREADS.filter((th) => th.id !== from.id && th.domain !== from.domain && this.person.depthOf(th.id) === 0 &&
      (!domainById.get(th.domain)!.private || this.person.consentFor(th.domain) === 'yes'));
    if (this.o.classify) {
      const id = this.o.classify(text, candidates);
      const th = id ? candidates.find((c) => c.id === id) : undefined;
      if (th) return { thread: th, word: th.topic.toLowerCase() };
    }
    for (const th of candidates) {
      const word = th.cues.find((c) => c.length >= 4 && !VAGUE.has(c) && t.includes(` ${normalize(c)} `));
      if (word) {
        // Say it back the way they said it: "Canadiens", not "canadiens".
        const m = text.match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
        return { thread: th, word: m ? m[0] : word };
      }
    }
    return null;
  }

  private elsewhere(text: string, current: Thread): Thread | null {
    const t = ` ${normalize(text.replace(/[\u2019']/g, ' '))} `;
    const hit = (th: Thread) => th.cues.filter((c) => c.length >= 4 && !VAGUE.has(c) && t.includes(` ${normalize(c)} `)).length;
    if (hit(current) > 0) return null;
    const open = THREADS.filter((th) => th.id !== current.id && (!domainById.get(th.domain)!.private || this.person.consentFor(th.domain) === 'yes'));
    if (this.o.classify) {
      const id = this.o.classify(text, [current, ...open]);
      return id && id !== current.id ? open.find((x) => x.id === id) ?? null : null;
    }
    // A distinctive cue for another thread and none for the one asked: two
    // cues always count; one counts in a real answer, not a few words.
    const words = t.trim().split(' ').length;
    const best = open.map((th) => ({ th, n: hit(th) })).sort((a, b) => b.n - a.n)[0];
    return best && (best.n >= 2 || (best.n === 1 && words >= 10)) ? best.th : null;
  }

  private privateDue(): (typeof DOMAINS)[number] | null {
    if (this.turns < 25) return null;
    return DOMAINS.find((d) => d.private && this.person.consentFor(d.id) === undefined && !this.askedConsent.has(d.id)) ?? null;
  }

  private consentReply(t: string): Line {
    const d = this.consentFor!;
    this.mode = 'talk'; this.consentFor = null;
    if (YES.test(t)) {
      this.person.setConsent(d, 'yes');
      const th = THREADS.find((x) => x.domain === d)!;
      return this.ask(th, 1, 'Okay.');
    }
    if (NO.test(t) || SKIP.test(t)) { this.person.setConsent(d, 'no'); return this.next("Got it — I won't go there."); }
    // Not a yes: nothing private is opened on a maybe.
    return this.next('Let’s leave that for now.');
  }

  private why(): Line {
    const th = this.current!.thread;
    const d = domainById.get(th.domain)!;
    const uses = th.uses.map((u) => USE_WORDS[u]).filter(Boolean);
    const q = this.ask(th, this.current!.depth);
    return { say: `${d.why}${uses.length ? ` Concretely, it shapes ${uses.slice(0, 2).join(' and ')}.` : ''} No pressure though. ${q.say}`, move: 'why', thread: th.id };
  }

  private park(): Line {
    this.mode = 'parked';
    const where = this.current ? ` We'll pick up from ${this.current.thread.topic.toLowerCase()}.` : '';
    return { say: `Sure.${where} Talk soon.`, move: 'park' };
  }

  private ack(words: number): string {
    const list = words >= 12 ? ACK_LONG : ACK_SHORT;
    return list[this.acks++ % list.length]!;
  }

  // ------------------------------------------------------------------ games

  private game(lead: string): Line {
    this.sinceGame = 0;
    this.games++;
    // The personality round comes once, on the third game, after there is some trust.
    if (this.games === 3 && !this.person.all().some((f) => f.thread === 'values.self_view')) {
      this.mode = 'items'; this.itemAnswers = [];
      return { say: `${lead} Different kind of game: I read ten short statements, you tell me agree, disagree, or somewhere in between. No right answers. "${ITEMS[0]!.text}"`, move: 'game' };
    }
    const unused = PAIRS.filter((p) => !this.person.about(p.thread).some((f) => f.quote.toLowerCase().includes(p.a) || f.quote.toLowerCase().includes(p.b)));
    const from = unused.length >= 3 ? unused : PAIRS;
    const start = ((this.games - 1) * 3) % from.length;
    this.pairs = [0, 1, 2].map((i) => from[(start + i) % from.length]!);
    this.mode = 'pairs';
    const p = this.pairs[0]!;
    return { say: `${lead} Quick round — three this-or-thats, first thing that comes to mind. ${cap(p.a)} or ${p.b}?`, move: 'game' };
  }

  private pairReply(text: string): Line {
    const p = this.pairs[0]!;
    const side = picked(p, text);
    if (side === null && !SKIP.test(normalize(text))) {
      if (this.unclear++ === 0) return { say: `${cap(p.a)} or ${p.b}?`, move: 'again' };
      this.unclear = 0; this.mode = 'talk'; this.pairs = [];
      return this.next('Okay, no games right now.');
    }
    this.unclear = 0;
    if (side) {
      const pick = side === 'both' ? `both ${p.a} and ${p.b}` : side === 'a' ? p.a : p.b;
      this.person.record({ thread: p.thread, depth: 1, text: `Picks ${pick} (over ${side === 'a' ? p.b : side === 'b' ? p.a : 'choosing'})`, quote: `${p.a} or ${p.b}? ${text.trim()}` });
    }
    this.pairs.shift();
    if (this.pairs.length) { const n = this.pairs[0]!; return { say: `${cap(n.a)} or ${n.b}?`, move: 'game' }; }
    this.mode = 'talk';
    return this.next('Ha, okay.');
  }

  private itemReply(text: string): Line {
    const v = agreement(text);
    const i = this.itemAnswers.length;
    if (v === null && !SKIP.test(normalize(text))) {
      if (this.unclear++ === 0) return { say: `Agree, disagree, or in between? "${ITEMS[i]!.text}"`, move: 'again' };
      // Leaving the round is fine; it can come back another day.
      this.unclear = 0; this.mode = 'talk'; this.games--;
      return this.next('Let\u2019s leave that game for another time.');
    }
    this.unclear = 0;
    this.itemAnswers.push(v ?? 3);
    if (this.itemAnswers.length < ITEMS.length) return { say: `"${ITEMS[this.itemAnswers.length]!.text}"`, move: 'game' };
    const words = describe(traits(this.itemAnswers));
    if (!words.length) { this.mode = 'talk'; return this.next('You sit in the middle on all of those — which is useful too.'); }
    // Shown, never assumed: each one waits for the person's yes.
    this.pendingTraits = words.map((w) => this.person.record({ thread: 'values.self_view', depth: 1, text: cap(w), quote: 'from the ten statements', kind: 'inferred', confirmed: false }));
    this.mode = 'traits';
    return { say: `From that, it sounds like ${words.join(', and ')}. Does that sound like you? I'll only keep it if you say yes.`, move: 'traits' };
  }

  private traitsReply(t: string): Line {
    this.mode = 'talk';
    const all = this.pendingTraits; this.pendingTraits = [];
    if (YES.test(t) || /\b(that s me|accurate|spot on|pretty much|right)\b/.test(t)) { for (const f of all) this.person.confirm(f.id); return this.next('Kept.'); }
    for (const f of all) this.person.forget(f.id);
    return this.next('Dropped — you know you better than ten sentences do. What would you say instead, if anything?');
  }
}

const USE_WORDS: Record<string, string> = {
  briefing: 'your briefing', desk: 'when I interrupt you', calendar: 'your calendar', gifts: 'gift ideas',
  tone: 'how I talk to you', planning: 'how I help you plan', reasoning: 'how I think things through with you',
  settings: 'your settings', suggestions: 'what I suggest', reminders: 'your reminders',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Without a model: the answer itself, tidied. Names get special care. */
function clean(text: string, thread: Thread): string {
  let s = text.trim().replace(/\s+/g, ' ');
  if (thread.id === 'basics.name') {
    s = s.replace(/^(call me|it['’ ]?s|i['’ ]?m|i am|my name is|name['’ ]?s|just)\s+/i, '').replace(/[.!]+$/, '').split(/\s+/).slice(0, 3).join(' ');
    return `Goes by ${s}`;
  }
  if (s.length > 280) s = `${s.slice(0, 277)}…`;
  return cap(s);
}
