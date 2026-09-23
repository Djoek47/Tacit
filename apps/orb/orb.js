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
  name: 'add_item', phrases: ['add', 'put on the list', 'we need'],
  slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
  radius: 'self',
  commit: (f) => { db.list.push(f.item); return { id: 'i' + db.list.length }; },
  undo: () => { db.list.pop(); },
}));

ui.defineAct(A.defineAct({
  name: 'assign_errand', phrases: ['picks up', 'can you ask', 'assign', 'grabs'],
  slots: {
    assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    errand: { primitive: 'chip', options: () => ERRANDS, required: true, order: 2 },
    due: { primitive: 'when', resolve: A.resolveWhen, order: 3 },
  },
  radius: { max: 'other-person', of: (f, c) => (f.assignee?.id === c.actor.id ? 'self' : 'other-person') },
  commit: (f) => { db.errands.push(f); return { id: 'e' + db.errands.length }; },
  undo: () => { db.errands.pop(); },
  effects: [{
    name: 'notify',
    when: (f, c) => !!f.assignee && f.assignee.id !== c.actor.id,
    run: (r) => { db.sent.push(r.id); log('notification sent', 'effect'); },
    radius: 'other-person', reversible: true, deferrable: true, reach: () => 1,
  }],
}));

ui.defineAct(A.defineAct({
  name: 'settle_up', phrases: ['pay', 'pay back', 'send money', 'settle up'],
  slots: {
    payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
    amount: { primitive: 'quantity', resolve: A.resolveQuantity, required: true, order: 2 },
  },
  radius: 'external',
  commit: (f) => { db.paid.push(f); return { id: 'p' + db.paid.length }; },
  effects: [{
    name: 'transfer', run: () => log('money moved — irreversible', 'effect'),
    radius: 'external', reversible: false, deferrable: false,
  }],
}));

/* ------------------------------------------------------- hepta + the model */
const local = new A.LocalResolver();
const spec = new A.Speculator(ui, local, optionsFor);

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
  $('heard').textContent = text;
  const s = spec.feed({ text, final }, { ...ctx(), now: new Date() });
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
  voice?.bargeIn();
  const run = spec.currentRun ?? ui.act;
  if (run && run.status === 'hold') { run.freeze('you started talking again'); log('HOLD cancelled', 'repair'); }
  setStatus('listening', 'live');
  render();
}

function onSpeechStop() {
  setStatus('thinking', 'think');
}

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

function fmt(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return v.label ?? JSON.stringify(v);
  return String(v);
}

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

function render() {
  const run = spec.currentRun ?? ui.act;
  const s = run ? run.state() : null;

  const slots = $('slots'); slots.innerHTML = '';
  if (s) {
    for (const name of Object.keys(s.slots)) {
      const sl = s.slots[name];
      const d = document.createElement('div');
      d.className = 'slot' + (sl.status === 'filled' ? '' : ' empty') + (sl.provisional ? ' prov' : '');
      d.innerHTML = '<span class="k"></span><span class="v"></span>';
      d.querySelector('.k').textContent = name + (sl.provisional ? ' · unsure' : '');
      d.querySelector('.v').textContent = sl.status === 'filled' ? fmt(sl.value) : '—';
      slots.appendChild(d);
    }
  }

  const v = $('verdict'); v.innerHTML = '';
  if (s) {
    const pill = (cls, txt) => { const p = document.createElement('span'); p.className = 'pill ' + cls; p.textContent = txt; v.appendChild(p); };
    if (s.status === 'speculating') pill('prov', 'speculating — cannot commit');
    if (s.radius) pill(s.radius === 'external' ? 'stop' : s.radius === 'self' ? 'ok' : 'hold', s.radius);
    if (s.status === 'hold') pill('hold', 'silence will commit');
    if (s.status === 'explicit') pill('stop', 'needs a yes out loud');
    if (s.status === 'settled') pill('ok', 'committed');
    if (s.status === 'frozen') pill('prov', 'frozen');
  }

  const cta = $('cta'); cta.innerHTML = '';
  if (s && s.status === 'explicit' && run) {
    const yes = document.createElement('button'); yes.className = 'yes'; yes.textContent = 'Yes, do it';
    yes.onclick = () => run.assent().then(render);
    const no = document.createElement('button'); no.className = 'no'; no.textContent = 'Cancel';
    no.onclick = () => { run.discard(); render(); };
    cta.append(yes, no);
  }
  if (s && run?.undoAvailable) {
    const u = document.createElement('button'); u.className = 'no'; u.textContent = 'Undo';
    u.onclick = () => run.undo().then(render);
    cta.appendChild(u);
  }

  if (s && s.status === 'hold' && run.holdDurationMsValue) {
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

/* Typing is the same path as speaking: text in, final immediately. */
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('input').value.trim(); if (!t) return;
  $('input').value = '';
  state.listening = true;      // typing is engagement too
  onTranscript(t, false);
  onTranscript(t, true);
});

$('tools').textContent = JSON.stringify(tools(), null, 2);
log('engine ready — ' + ui.definitions.length + ' acts, tools generated', 'boot');
setStatus('idle');
render();
