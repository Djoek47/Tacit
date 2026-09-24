<script>
(() => {
const A = window.AIUIC;
const $ = (id) => document.getElementById(id);

// The language's own stylesheet, injected from the package. Nothing in
// head.html knows a domain colour.
const sheet = document.createElement('style');
sheet.textContent = A.stylesheet();
document.head.appendChild(sheet);

// ---------------------------------------------------------------- the acts

const PEOPLE = [
  { value: { id: 'maya', label: 'Maya' }, label: 'Maya', aliases: ['maya'] },
  { value: { id: 'sam', label: 'Sam' }, label: 'Sam', aliases: ['sam'] },
  { value: { id: 'noah', label: 'Noah' }, label: 'Noah', aliases: ['noah'] },
];
const CHORES = [
  { value: 'dishes', label: 'Dishes', aliases: ['the dishes', 'washing up'] },
  { value: 'laundry', label: 'Laundry', aliases: ['the laundry', 'washing'] },
  { value: 'bins', label: 'Bins', aliases: ['the bins', 'rubbish', 'trash'] },
];
const ITEMS = [
  { value: 'milk', label: 'Milk', aliases: ['milk'] },
  { value: 'jam', label: 'Jam', aliases: ['jam'] },
  { value: 'bread', label: 'Bread', aliases: ['bread'] },
  { value: 'eggs', label: 'Eggs', aliases: ['eggs'] },
];
const PLACES = [
  { value: 'dentist', label: 'Dentist', aliases: ['the dentist'] },
  { value: 'school', label: 'School', aliases: ['school'] },
];

const attention = { foreground: true, unlocked: true, proximityClear: true, listening: true };
const ui = A.createAIUIC({
  ctx: () => ({ actor: { id: 'me', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 }),
});

const D = {
  chores: A.defineAct({
    name: 'assign_chore', domain: 'chores',
    phrases: ['for', 'assign', 'should do', 'needs to do', 'can do'],
    slots: {
      chore: { primitive: 'chip', options: () => CHORES, required: true, order: 1 },
      assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 2 },
      due: { primitive: 'when', resolve: A.resolveWhen, order: 3 },
    },
    radius: { max: 'other-person', of: () => 'other-person' },
    commit: () => ({ id: 'c' + Date.now() }), undo: () => {},
    preview: (f) => [[f.chore ? A.display(f.chore) : 'A chore',
                      f.assignee ? 'for ' + A.display(f.assignee) : null,
                      f.due ? A.display(f.due) : null].filter(Boolean).join(' ')],
  }),
  groceries: A.defineAct({
    name: 'add_items', domain: 'groceries',
    phrases: ['add', 'put on the list', 'we need'],
    slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
    radius: 'self',
    commit: () => ({ id: 'g' + Date.now() }), undo: () => {},
    preview: (f) => [(f.item ? A.display(f.item) : 'An item') + ' on the list'],
  }),
  calendar: A.defineAct({
    name: 'add_event', domain: 'calendar',
    phrases: ['book', 'appointment', 'at'],
    slots: {
      what: { primitive: 'chip', options: () => PLACES, required: true, order: 1 },
      when: { primitive: 'when', resolve: A.resolveWhen, required: true, order: 2 },
      who: { primitive: 'face', options: () => PEOPLE, order: 3 },
    },
    radius: { max: 'shared', of: () => 'shared' },
    commit: () => ({ id: 'e' + Date.now() }), undo: () => {},
    preview: (f) => [[f.what ? A.display(f.what) : 'An event',
                      f.when ? A.display(f.when) : null,
                      f.who ? 'with ' + A.display(f.who) : null].filter(Boolean).join(' ')],
  }),
  allowance: A.defineAct({
    name: 'pay_allowance', domain: 'allowance',
    phrases: ['pay', 'send', 'allowance'],
    slots: {
      payee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      amount: { primitive: 'quantity', resolve: A.resolveQuantity, required: true, order: 2 },
    },
    radius: 'external',
    commit: () => ({ id: 'p' + Date.now() }),
    preview: (f) => [[f.amount ? A.display(f.amount) : 'Money',
                      f.payee ? 'to ' + A.display(f.payee) : null].filter(Boolean).join(' ')],
  }),
  teaching: A.defineAct({
    name: 'how_do_i', domain: 'teaching',
    phrases: ['how do i', 'show me', 'walk me through'],
    slots: { topic: { primitive: 'chip', options: () => [
      { value: 'proof', label: 'ask for a photo', aliases: ['photo', 'proof'] },
      { value: 'ipad', label: 'set iPad limits', aliases: ['ipad', 'screen time'] },
    ], required: true, order: 1 } },
    radius: 'self',
    commit: () => ({ id: 't' + Date.now() }), undo: () => {},
    preview: (f) => [f.topic ? A.display(f.topic) : 'Show me how'],
  }),
};
for (const def of Object.values(D)) ui.defineAct(def);

const ALL = Object.values(D);
const optionsForDef = (def, slot) => {
  const sd = def.slots[slot];
  return sd && sd.options ? sd.options({}, {}) : [];
};
const local = new A.LocalResolver();

// ------------------------------------------------------------------ stage

let run = null;
let said = '';
let presenter = null;
let unlisten = null;
let update = () => {};
const monitor = new A.BudgetMonitor({ now: () => performance.now() });

function mountStage() {
  const root = $('stage');
  presenter = new A.StagePresenter(root, document, {
    said: () => said,
    queued: () => 0,
    accent: '#FF5FA2', // a member's accent pack. It never reaches a domain.
  });
}

function refresh() {
  if (!run) return;
  update();
  paintBeats();
  paintMeta();
  requestAnimationFrame(() => { if (run && run.status === 'hold') refresh(); });
}

function startFrom(text) {
  said = text;
  monitor.reset();
  monitor.mark('heard');

  const scores = local.scoreSync(text, ALL, { now: new Date(), actor: { id: 'me' } }, optionsForDef);
  const decision = A.pickAct(scores);
  const name = decision.kind === 'start' ? decision.act
    : decision.kind === 'narrow' ? decision.acts[0] : null;
  if (!name) { $('stage').replaceChildren(); said = ''; paintMeta(scores); return; }

  const def = ALL.find((a) => a.name === name);
  run = ui.start(name);
  const wired = A.attachPresenters(run, [presenter], (r, slot) => optionsForDef(r.def, slot));
  update = wired.update;

  const cands = local.fillSync(text, def, {}, { now: new Date(), actor: { id: 'me' } }, optionsForDef);
  for (const [slot, list] of Object.entries(cands)) {
    const best = list[0];
    if (best && best.score >= 0.85) run.setValue(slot, best.value, 'spoken');
    else if (list.length) run.offer(slot, list, 'spoken');
  }
  run.evaluate();
  monitor.mark('shown');
  unlisten?.();
  unlisten = ui.on((e) => { if (e.type === 'commit') monitor.mark('committed'); });
  refresh();
  paintMeta(scores);
}

function paintBeats() {
  const v = A.toView(run, (r, slot) => optionsForDef(r.def, slot));
  const domain = A.DOMAINS[v.domain] || null;
  const now = A.beatOf(v, { domain });
  $('beats').replaceChildren(...['show','narrow','unfold','hold','settle','chain','coach'].map((b, i) => {
    const el = document.createElement('span');
    el.className = 'beat';
    el.dataset.on = String(b === now);
    el.textContent = (i + 1) + ' · ' + b;
    return el;
  }));
}

function paintMeta(scores) {
  const v = run ? A.toView(run, (r, slot) => optionsForDef(r.def, slot)) : null;
  const bits = [];
  if (v) {
    bits.push(`act <b>${v.act}</b>`);
    bits.push(`radius <b>${v.radius || '—'}</b>`);
    bits.push(`assent <b>${v.assent || 'pending'}</b>`);
    if (v.holdTotalMs) bits.push(`hold <b>${v.holdTotalMs}ms</b>`);
    if (A.skipsShow(v)) bits.push('<b>show skipped — already named</b>');
  }
  if (scores && scores.length) {
    bits.push('routing <b>' + scores.slice(0, 2).map((s) => `${s.act} ${s.score.toFixed(2)}`).join(' · ') + '</b>');
  }
  $('meta').replaceChildren(...bits.map((b) => {
    const s = document.createElement('span'); s.innerHTML = b; return s;
  }));
  paintBudget();
}

function paintBudget() {
  const lines = [
    `words end -> card      budget ${A.BUDGET_MS.show}ms`,
    `card -> writes landed  budget ${A.BUDGET_MS.commit}ms`,
    `undo -> gone           budget ${A.BUDGET_MS.undo}ms`,
    '',
    monitor.ok ? 'this run: within budget' : 'this run:\n' + monitor.report(),
  ];
  $('budget').textContent = lines.join('\n');
}

// --------------------------------------------------------------- controls

const SCENES = [
  'dishes for Maya tomorrow',
  'add milk and jam',
  'book the dentist at 9:30am',
  'pay Sam twelve dollars',
  'how do I ask for a photo',
];
$('scenes').replaceChildren(...SCENES.map((t) => {
  const b = document.createElement('button');
  b.className = 'b'; b.textContent = t;
  b.onclick = () => { $('say').value = t; startFrom(t); };
  return b;
}));

$('domains').replaceChildren(...Object.keys(D).map((k) => {
  const b = document.createElement('button');
  b.className = 'b';
  b.textContent = A.DOMAINS[k].kicker;
  b.style.color = A.domainColour(k);
  b.onclick = () => {
    const seed = { chores: 'laundry for Noah', groceries: 'add bread and eggs',
      calendar: 'book school at 8am', allowance: 'pay Maya five dollars',
      teaching: 'how do I set iPad limits' }[k];
    $('say').value = seed; startFrom(seed);
  };
  return b;
}));

let typing;
$('say').addEventListener('input', (e) => {
  clearTimeout(typing);
  const t = e.target.value;
  typing = setTimeout(() => t.trim() && startFrom(t), 260);
});

// --------------------------------------------------------------- the audit

const SPECS = {
  'a good grocery act': {
    name: 'add_items', domain: 'groceries', capability: 'list_add',
    slots: { item: { primitive: 'chip', required: true, order: 1,
      options: [{ value: 'milk', label: 'Milk' }] } },
  },
  'a face on a grocery': {
    name: 'add_items', domain: 'groceries', capability: 'list_add',
    slots: {
      item: { primitive: 'chip', required: true, order: 1, options: [{ value: 'milk', label: 'Milk' }] },
      who: { primitive: 'face', required: true, order: 2,
        options: [{ value: 'maya', label: 'Maya' }] },
    },
  },
  'an allowance that settles on silence': {
    name: 'quick_payout', domain: 'allowance', capability: 'list_add',
    slots: { amount: { primitive: 'quantity', required: true, order: 1 } },
  },
  'a domain nobody owns': {
    name: 'do_a_vibe', domain: 'vibes', capability: 'list_add',
    slots: { what: { primitive: 'chip', required: true, order: 1,
      options: [{ value: 'x', label: 'X' }] } },
  },
};

const composer = new A.Composer();
composer.register({
  name: 'list_add', describe: 'add rows to a list the actor owns',
  radius: 'self', run: () => ({ id: 'x' }), undo: () => {},
});

function audit() {
  let spec;
  try { spec = JSON.parse($('spec').value); }
  catch (e) { return say([{ level: 'error', act: 'spec', message: 'not JSON: ' + e.message }]); }

  let def;
  try { def = composer.compose(spec); }
  catch (e) { return say([{ level: 'error', act: spec.name || '?', message: e.message }]); }

  // The composer strips anything it does not know about, so the domain tag is
  // reattached here. That is the right way round: a model picks a capability,
  // and the host says which part of its app the act belongs to.
  def.domain = spec.domain;
  say([...A.lintDomains([def]), ...A.lintActs([def])]);
}

function say(lints) {
  const el = $('lint');
  if (!lints.length) {
    el.innerHTML = '';
    const ok = document.createElement('span');
    ok.className = 'ok'; ok.textContent = 'clean — the colour is earned by meaning';
    el.replaceChildren(ok);
    return;
  }
  el.replaceChildren(...lints
    .sort((a, b) => ({ error: 0, warn: 1, note: 2 })[a.level] - ({ error: 0, warn: 1, note: 2 })[b.level])
    .map((l) => {
      const s = document.createElement('span');
      s.className = l.level;
      s.textContent = `${l.level.padEnd(5)} ${l.act}: ${l.message}\n`;
      return s;
    }));
}

$('breaks').replaceChildren(...Object.keys(SPECS).map((k) => {
  const b = document.createElement('button');
  b.className = 'b'; b.textContent = k;
  b.onclick = () => { $('spec').value = JSON.stringify(SPECS[k], null, 2); audit(); };
  return b;
}));
$('spec').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(audit, 300); });

// -------------------------------------------------------------- swatches

$('swatches').replaceChildren(...Object.keys(A.DOMAINS).map((k) => {
  const d = A.DOMAINS[k];
  const el = document.createElement('div');
  el.className = 'sw';
  const i = document.createElement('i'); i.style.background = A.domainColour(k);
  const b = document.createElement('b'); b.textContent = d.kicker;
  const s = document.createElement('span'); s.textContent = A.domainColour(k);
  const p = document.createElement('div');
  p.style.cssText = 'font-size:11.5px;color:#9aa6bb;margin-top:6px;line-height:1.5';
  p.textContent = d.shape;
  el.append(i, b, s, p);
  return el;
}));

// --------------------------------------------------------------------- go

mountStage();
$('spec').value = JSON.stringify(SPECS['a face on a grocery'], null, 2);
audit();
$('say').value = SCENES[0];
startFrom(SCENES[0]);
})();

</script>
