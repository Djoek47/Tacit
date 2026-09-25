/**
 * The orb. Everything that decides anything runs here, in the page.
 *
 * Order matters and is the whole design:
 *
 *   interim transcript ──▶ Hepta speculates ──▶ stage paints        (no network)
 *                                    │
 *                                    ├──▶ model tool call ──▶ confirms or corrects
 *                                    │
 *   speech stops ──────────▶ settleSpeculation() ──▶ commit contract decides
 *
 * The model is a participant, not the authority. It can fill slots and it can
 * be wrong; it cannot commit anything the contract would not have committed.
 */

import { RealtimeVoice } from './realtime.js';

const A = window.AIUIC;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ host */
const ME = { id: 'me', label: 'me' };
const PEOPLE = [
  { value: ME, label: 'me', aliases: ['myself'] },
  { value: { id: 'sam', label: 'Sam' }, label: 'Sam' },
  { value: { id: 'maya', label: 'Maya' }, label: 'Maya' },
];
const ITEMS = [
  { value: 'milk', label: 'milk' }, { value: 'bread', label: 'bread' },
  { value: 'coffee', label: 'coffee' }, { value: 'batteries', label: 'batteries' },
];
const ERRANDS = [
  { value: 'parcel', label: 'the parcel', aliases: ['parcel'] },
  { value: 'pharmacy', label: 'the pharmacy run', aliases: ['pharmacy'] },
  { value: 'recycling', label: 'the recycling', aliases: ['recycling', 'bins'] },
];

const db = { list: [], errands: [], sent: [], paid: [] };
const OPTIONS = { item: ITEMS, assignee: PEOPLE, payee: PEOPLE, errand: ERRANDS };
const optionsFor = (_act, slot) => OPTIONS[slot] ?? [];

const state = { listening: false };
const ctx = () => ({
  actor: { id: 'me', basePauseMs: 850 },
  attention: {
    foreground: document.visibilityState === 'visible',
    unlocked: true,
    proximityClear: true,
    listening: state.listening,
  },
  reachLimit: 1,
  undoWindowMs: 5000,
});

const ui = A.createAIUIC({ ctx });

ui.defineAct(A.defineAct({
  name: 'add_item', domain: 'groceries', phrases: ['add', 'put on the list', 'we need'],
  slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
  radius: 'self',
  commit: (f) => { db.list.push(f.item); return { id: 'i' + db.list.length }; },
  undo: () => { db.list.pop(); },
  preview: (f) => [(f.item ? (f.item.label ?? f.item) : 'An item') + ' on the list'],
}));

ui.defineAct(A.defineAct({
  name: 'assign_errand', domain: 'chores', phrases: ['picks up', 'can you ask', 'assign', 'grabs'],
  slots: {
    assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    errand: { primitive: 'chip', options: () => ERRANDS, required: true, order: 2 },
    due: { primitive: 'when', resolve: A.resolveWhen, order: 3 },
  },
  radius: { max: 'other-person', of: (f, c) => (f.assignee?.id === c.actor.id ? 'self' : 'other-person') },
  commit: (f) => { db.errands.push(f); return { id: 'e' + db.errands.length }; },
  undo: () => { db.errands.pop(); },
  preview: (f) => [[f.errand ? (f.errand.label ?? f.errand) : 'An errand',
                    f.assignee ? 'for ' + (f.assignee.label ?? f.assignee) : null,
                    f.due ? (f.due.label ?? f.due) : null].filter(Boolean).join(' ')],
  effects: [{
    name: 'notify',
    when: (f, c) => !!f.assignee && f.assignee.id !== c.actor.id,
    run: (r) => { db.sent.push(r.id); log('notification sent', 'effect'); },
    radius: 'other-person', reversible: true, deferrable: true, reach: () => 1,
  }],
}));

ui.defineAct(A.defineAct({
  name: 'settle_up', domain: 'allowance', phrases: ['pay', 'pay back', 'send money', 'settle up'],
  slots: {
    payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    amount: { primitive: 'quantity', resolve: A.resolveQuantity, required: true, order: 2 },
  },
  radius: 'external',
  commit: (f) => { db.paid.push(f); return { id: 'p' + db.paid.length }; },
  preview: (f) => [[f.amount ? (f.amount.label ?? f.amount) : 'Money',
                    f.payee ? 'to ' + (f.payee.label ?? f.payee) : null].filter(Boolean).join(' ')],
  effects: [{
    name: 'transfer', run: () => log('money moved — irreversible', 'effect'),
    radius: 'external', reversible: false, deferrable: false,
  }],
}));

/* ------------------------------------------------------- hepta + the model */
const local = new A.LocalResolver();
const spec = new A.Speculator(ui, local, optionsFor);

/*
 * Lines of thought run beside the speculator on every partial. The speculator
 * reads what you are saying now; the lines hold what you said before, what it
 * thinks, and what it left open. ?bluntness=0..1 sets how readily it cuts in.
 */
const bluntness = Math.max(0, Math.min(1, Number(new URLSearchParams(location.search).get('bluntness') ?? 0.5)));
const lines = new A.Lines({ bluntness });
const stageBusy = () => {
  const r = spec.currentRun ?? ui.act;
  return !!r && ['resolving', 'speculating', 'hold', 'explicit', 'frozen'].includes(r.status);
};
window.lines = lines;

const INSTRUCTIONS = [
  'You are the voice of an app that does things rather than talking about them.',
  '',
  'The interface in front of the user is driven by a commit contract you do not control.',
  'Your job is to help it fill in what the user meant, and to say short, human things',
  'while it does. Call a tool the moment you know which act the user wants; you may',
  'call it again with corrections.',
  '',
  'Rules you cannot override, so do not promise otherwise:',
  '- Low-stakes acts commit when the user stops talking. Do not ask "shall I?" for those.',
  '- Anything costing money or irreversible needs the user to say yes out loud. Say so plainly.',
  '- If the stage shows a slot as unsure, ask about THAT slot only, in a few words.',
  '',
  'You will receive STAGE messages describing what is on screen. Trust them over your',
  'own memory of the conversation: the interface moves faster than you do.',
  '',
  'Speak in short sentences. Never read a list back. Never narrate what you are about to do.',
].join('\n');

const euiSheet = document.createElement('style');
euiSheet.textContent = A.stylesheet();
document.head.appendChild(euiSheet);

let voice = null;
let lastReport = 0;

function tools() {
  return A.toolSchema(ui.definitions, optionsFor, 'openai-realtime');
}

function reportState() {
  const now = Date.now();
  if (!voice?.live || now - lastReport < 250) return;
  lastReport = now;
  voice.reportState(ui.state());
}

/* --------------------------------------------------------------- the loop */
function onTranscript(text, final) {
  if (!$('heard').textContent || final) { budget.reset(); budget.mark('heard'); }
  $('heard').textContent = text;
  const atMs = performance.now();

  // It has the floor and you made a sound. A nod, or a turn?
  if (voice?.speaking) {
    const f = lines.hear({ text, final, atMs }, { leader: null, leaderRadius: null, speaking: true });
    if (f.kind === 'yield') { voice.stopSpeaking(); log('yielded the floor on ' + f.why, 'repair'); }
    else if (f.kind === 'keep') { log('kept talking through "' + text + '"', 'voice'); return; }
  }

  const s = spec.feed({ text, final }, { ...ctx(), now: new Date() });
  const lead = spec.currentRun;
  const d = lines.hear({ text, final, atMs }, {
    leader: spec.leaderName, leaderRadius: lead ? lead.state().radius : null,
  });
  if (d.kind === 'interrupt') {
    log('CUT IN (' + d.at + ', ' + d.urge.reason + '): ' + d.urge.say, 'cut');
    voice?.interject(d.urge.say, 'cut');
  } else if (d.kind === 'queue') {
    log('will raise: ' + d.urge.say, 'think');
    voice?.interject(d.urge.say, 'queue');
  }
  renderTracks(s);
  render();
  reportState();
}

function onToolCall(name, argsJson, callId) {
  log('tool: ' + name, 'model');
  try {
    const { run, unmatched, unknownSlots } = A.applyToolCall(ui, { name, arguments: argsJson }, optionsFor);
    if (unmatched.length) log('refused values for ' + unmatched.join(', '), 'guard');
    if (unknownSlots.length) log('ignored unknown ' + unknownSlots.join(', '), 'guard');
    voice?.reportToolResult(callId, { status: run.status, radius: run.radius });
  } catch (err) {
    log(String(err.message), 'guard');
    voice?.reportToolResult(callId, { error: String(err.message) });
  }
  render();
}

function onSpeechStart() {
  state.listening = true;
  // No blanket barge-in: whether a sound takes the floor is decided on its
  // words, in onTranscript, by the lines of thought.
  const run = spec.currentRun ?? ui.act;
  if (run && run.status === 'hold') { run.freeze('you started talking again'); log('HOLD cancelled', 'repair'); }
  setStatus('listening', 'live');
  render();
}

function onSpeechStop() {
  setStatus('thinking', 'think');
}

// The orb's tint is its state, and 'thinking' has to end somewhere. Board 14:
// done is the orb itself, not a second circle.
ui.on((e) => {
  if (e.type === 'commit' || e.type === 'discarded' || e.type === 'failed') {
    setStatus(state.listening ? 'listening' : 'idle', state.listening ? 'live' : '');
  }
});

/* ------------------------------------------------------------------ view */
const CIRC = 728.8;
let raf = 0;

function log(msg, kind) {
  const box = $('log');
  const el = document.createElement('div');
  const t = new Date();
  el.innerHTML = '<span class="t">' + String(t.getMinutes()).padStart(2, '0') + ':' +
    String(t.getSeconds()).padStart(2, '0') + '</span><span class="m">' +
    (kind ? '<b>' + kind + '</b> ' : '') + msg + '</span>';
  box.prepend(el);
  while (box.children.length > 50) box.lastChild.remove();
}

function setStatus(txt, cls) { $('statust').textContent = txt; $('status').className = 'status ' + (cls || ''); }

function renderTracks(s) {
  const box = $('tracks');
  box.innerHTML = '';
  for (const t of s.tracks) {
    const d = document.createElement('div');
    d.className = 'track' + (t.leading ? ' lead' : '');
    d.innerHTML = '<span class="n"></span><span class="s"></span>';
    d.querySelector('.n').textContent = t.act.replace(/_/g, ' ');
    d.querySelector('.s').textContent = t.score.toFixed(2);
    box.appendChild(d);
  }
  $('trackCount').textContent = s.tracks.length + ' of 7 alive';
}

/**
 * The stage is drawn by the EUI presenter over `toView()`, not by this file.
 *
 * What was here before was a second copy of the rules: it decided what a
 * provisional slot looks like, when a yes is needed, which pill to show. Every
 * one of those is a contract question with an answer already, and a renderer
 * that re-derives them is a renderer that can disagree with the thing it is
 * drawing. Now this function does two things the presenter cannot: it keeps
 * the ring animating, and it tells the model what is on screen.
 */
let presenter = null;
let updateStage = () => {};
let boundRun = null;
const budget = new A.BudgetMonitor({ now: () => performance.now() });

function optionsForRun(r, slot) {
  const sd = r.def.slots[slot];
  return sd && sd.options ? sd.options(ctx(), {}) : [];
}

function bindStage() {
  const run = spec.currentRun ?? ui.act;
  if (!run || run === boundRun) return run;
  boundRun = run;
  if (!presenter) {
    // No `said` here: #heard already draws their words above the card, which
    // is where board 13 puts them. Passing it as well would print the sentence
    // twice for one utterance.
    presenter = new A.StagePresenter($('stage'), document, { queued: () => 0 });
  }
  const wired = A.attachPresenters(run, [presenter], optionsForRun);
  updateStage = wired.update;
  budget.mark('shown');
  return run;
}

function render() {
  const run = bindStage();
  if (!run) { $('stage').replaceChildren(); return; }
  updateStage();

  const s = run.state();

  // The orb's ring is the orb's, not the card's: it is the credit and the
  // state, and board 14 says it never unmounts while the tab is open.
  if (s.status === 'hold' && run.holdDurationMsValue) {
    const f = Math.max(0, Math.min(1, (s.holdRemainingMs || 0) / run.holdDurationMsValue));
    $('arc').setAttribute('stroke-dashoffset', String(CIRC * (1 - f)));
    $('ms').textContent = Math.round(s.holdRemainingMs || 0) + 'ms';
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
  } else {
    $('arc').setAttribute('stroke-dashoffset', String(CIRC));
    $('ms').textContent = '';
  }
}

ui.on((e) => {
  if (e.type === 'hold-start') log('HOLD ' + e.ms + 'ms at ' + e.radius, 'hold');
  else if (e.type === 'commit') { log('committed ' + e.act, 'commit'); reportState(); }
  else if (e.type === 'undo') log('undone', 'undo');
  else if (e.type === 'blocked') log(e.reason, 'blocked');
  else if (e.type === 'frozen') log(e.reason, 'freeze');
});

/* ------------------------------------------------------------------ wire */
$('mic').onclick = async () => {
  if (voice?.live) { voice.stop(); voice = null; state.listening = false; $('mic').textContent = 'Start listening'; return; }
  voice = new RealtimeVoice({
    instructions: INSTRUCTIONS,
    tools: tools(),
    onTranscript, onToolCall, onSpeechStart, onSpeechStop,
    onStatus: (s, detail) => {
      if (s === 'live') { state.listening = true; $('mic').textContent = 'Stop'; setStatus('listening', 'live'); log('connected', 'voice'); }
      if (s === 'connecting') setStatus('connecting');
      if (s === 'idle') { state.listening = false; setStatus('idle'); }
      if (s === 'error') { state.listening = false; setStatus('error', 'stop'); log(detail ?? 'error', 'voice'); }
      render();
    },
  });
  try { await voice.start(); } catch { voice = null; }
};

/**
 * Typing is the same path as speaking, and that has to include the shape of
 * it. Handing the whole sentence over at once and calling it final skips the
 * only thing speculation does: Hepta never sees a growing prefix, so nothing
 * is ever speculated and the mic path is the only way to exercise it.
 *
 * So a typed sentence is replayed word by word at conversational speed,
 * through the same generator the replay suite uses. The mic becomes a
 * convenience rather than a prerequisite — which is the point of an SDK that
 * takes text rather than audio.
 */
let replaying = 0;

function speak(text, wpm = A.DEFAULT_WPM) {
  clearTimeout(replaying);
  state.listening = true;      // typing is engagement too
  onSpeechStart();
  const seq = A.partials(text, { wpm });
  let i = 0;
  const step = () => {
    const p = seq[i++];
    if (!p) return;
    onTranscript(p.text, p.final);
    if (p.final) { onSpeechStop(); return; }
    replaying = setTimeout(step, seq[i].atMs - p.atMs);
  };
  step();
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('input').value.trim(); if (!t) return;
  $('input').value = '';
  speak(t);
});

// The weekend test needs no mic and no key: drive it from the console.
window.speak = speak;

// Wandering: when you have gone quiet and nothing is on stage, it may go back
// to something left open. Checked once a second; rests between wanders.
setInterval(() => {
  const u = lines.wander(performance.now(), stageBusy());
  if (!u) return;
  log('went back to ' + u.thread.topic + ': ' + u.say, 'think');
  voice?.interject(u.say, 'cut');
}, 1000);

$('tools').textContent = JSON.stringify(tools(), null, 2);
log('engine ready — ' + ui.definitions.length + ' acts, tools generated', 'boot');
setStatus('idle');
render();
