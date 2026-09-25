<script>
(async () => {
const A = window.AIUIC;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

const sheet = document.createElement('style');
sheet.textContent = A.stylesheet();
document.head.appendChild(sheet);

// ------------------------------------------------------- the example servers
// Real MCP servers, built with the official SDK, running inside this page.

function tasksServer() {
  const s = new A.McpServer({ name: 'tasks', version: '1.0.0' });
  const tasks = [{ id: 't0', title: 'renew passport', list: 'home', due: '2026-10-02' }];
  let seq = 0;
  const out = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }], structuredContent: v });
  s.registerTool('list_tasks', { title: 'List tasks', description: 'Open tasks and when they are due', annotations: { readOnlyHint: true } }, async () => out({ items: tasks }));
  s.registerTool('list_lists', { title: 'Lists', annotations: { readOnlyHint: true } }, async () => out({ items: [{ id: 'home', name: 'Home' }, { id: 'work', name: 'Work' }] }));
  s.registerTool('add_task', {
    title: 'Add a task',
    inputSchema: { title: A.z.string(), list: A.z.string(), due: A.z.string().date().optional() },
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ title, list, due }) => { const t = { id: `t${++seq}`, title, list, ...(due ? { due } : {}) }; tasks.push(t); return out({ id: t.id }); });
  s.registerTool('remove_task', { title: 'Remove a task', inputSchema: { id: A.z.string() }, annotations: { destructiveHint: true, openWorldHint: false } },
    async ({ id }) => { const i = tasks.findIndex((t) => t.id === id); if (i >= 0) tasks.splice(i, 1); return out({ removed: id }); });
  s.registerResource('shape', 'aiuic://shape', { mimeType: 'application/json' }, async (uri) => ({ contents: [{ uri: String(uri), mimeType: 'application/json', text: JSON.stringify({
    schema: 'aiuic.shape/1',
    app: { name: 'Tasks', brand: { colour: '#5B6CFF', mark: 'T' } },
    domains: { tasks: { kicker: 'TASKS', colour: '#7C8BFF' } },
    tools: {
      add_task: { domain: 'tasks', phrases: ['add', 'remind me to', 'new task'], preview: 'Add {title} to {list}',
        undo: { tool: 'remove_task', arg: 'id', from: 'id' }, options: { list: { from: 'list_lists', value: 'id', label: 'name' } } },
      remove_task: { domain: 'tasks', phrases: ['remove', 'delete task'] },
    },
    notifications: [{ key: 'due', label: 'A task is due', default: true, watch: 'list_tasks' }],
    home: ['add_task'],
  }) }] }));
  return { server: s, data: tasks };
}

function bankServer() {
  const s = new A.McpServer({ name: 'bank', version: '1.0.0' });
  const sent = [];
  const out = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }], structuredContent: v });
  s.registerTool('balances', { title: 'Balances', description: 'Account balances and this month spending', annotations: { readOnlyHint: true } },
    async () => out({ chequing: 2140.55, savings: 8800, groceries_this_month: 412.30 }));
  // Says nothing about itself: MCP assumes the worst, and so does the bridge.
  s.registerTool('transfer', { title: 'Send money', inputSchema: { to: A.z.enum(['Maya', 'Sam', 'Landlord']), amount: A.z.number() } },
    async ({ to, amount }) => { sent.push({ to, amount }); return out({ id: `x${sent.length}`, to, amount }); });
  s.registerResource('shape', 'aiuic://shape', { mimeType: 'application/json' }, async (uri) => ({ contents: [{ uri: String(uri), mimeType: 'application/json', text: JSON.stringify({
    schema: 'aiuic.shape/1',
    app: { name: 'Bank', brand: { colour: '#E8B04A', mark: 'B' } },
    tools: { transfer: { domain: 'allowance', phrases: ['send', 'pay', 'transfer'], preview: 'Send {amount} to {to}' } },
  }) }] }));
  return { server: s, data: sent };
}

const CATALOG = [
  { key: 'tasks', name: 'Tasks', mark: 'T', colour: '#7C8BFF', make: tasksServer,
    scenes: ['add call the bank to the work list', 'remind me to buy milk on the home list', 'what tasks are open'] },
  { key: 'bank', name: 'Bank', mark: 'B', colour: '#E8B04A', make: bankServer,
    scenes: ['send 50 dollars to Maya', 'what did we spend on groceries'] },
];

// --------------------------------------------------------------------- state

const memory = A.openMemory(new A.EphemeralStore());
const condClock = new A.FakeClock(Date.now());
const condStore = new A.EphemeralStore();
const attention = { foreground: true, unlocked: true, proximityClear: true, listening: true };
const ctx = () => ({ now: new Date(), actor: { id: 'you', basePauseMs: 850 }, attention, reachLimit: 1, undoWindowMs: 5000 });

const apps = {};            // key -> { status: 'idle'|'pending'|'connected', conn, preview, data }
let app = null, pyramid = null, conductor = null, presenter = null, said = '';
let theme = { assistant: '#06B6D4' };

const localOrchestrator = ({ findings }) => {
  const useful = findings.filter((f) => f.confidence > 0).slice(0, 4);
  if (!useful.length) return { kind: 'answer', answer: 'I found nothing about that yet.' };
  return { kind: 'answer', answer: useful.map((f) => `${f.source.split('/').pop()}: ${f.claim}`).join('\n') };
};

function connections() { return Object.values(apps).filter((a) => a.status === 'connected').map((a) => a.conn); }

/** Rebuild the app whenever what is connected changes. Memory and the conductor's inbox carry over. */
function rebuild() {
  const conns = connections();
  const domains = Object.assign({}, ...conns.map((c) => c.shape.domains || {}));
  app = A.createApp({
    ctx, speculate: false, domains,
    acts: [...conns.flatMap((c) => c.acts), ...A.scoreActs(), ...(conns.length ? [A.delegationAct(conns)] : [])],
  });
  presenter = new A.StagePresenter($('stage'), document, { said: () => said, domains, accent: '#FF5FA2' });
  app.mount(presenter);
  pyramid = new A.Pyramid({
    app, memory, ctx, orchestrator: localOrchestrator,
    aggregator: new A.Aggregator(conns.flatMap((c) => c.sources)),
  });
  conductor = new A.Conductor({
    app, memory: memory.reader, clock: condClock, store: condStore, ctx,
    pursue: (g) => pyramid.pursue(g),
  });
  app.ui.on(() => { queueMicrotask(refresh); });
  refresh();
}

// ---------------------------------------------------------------- connecting

async function begin(key) {
  const spec = CATALOG.find((c) => c.key === key);
  const made = spec.make();
  const [a, b] = A.InMemoryTransport.createLinkedPair();
  const client = new A.Client({ name: 'hepta-studio', version: '1.0.0' });
  await Promise.all([made.server.connect(a), client.connect(b)]);
  const conn = await A.connect(client);
  apps[key] = { status: 'pending', conn, data: made.data };
  renderApps();
}

async function approve(key) {
  // Nothing from the server has been called until now: approving is what
  // turns its sources on and loads its option lists.
  await apps[key].conn.approve();
  apps[key].status = 'connected';
  // Delegations the person made before survive a reconnect.
  A.applyDelegations([apps[key].conn], memory.reader.view().delegations);
  rebuild();
  renderApps();
  renderScenes();
}

function letItGo(key, tool) {
  // The person's own act: touched, so it is theirs, and it still holds and can be undone.
  app.reset();
  const run = app.ui.start('set_delegation');
  run.setValue('tool', { server: apps[key].conn.server.name, tool }, 'touched');
  run.setValue('level', 'self', 'touched');
  run.evaluate();
  said = `let ${tool.replace(/_/g, ' ')} go ahead without asking`;
  app.draw();
  refresh();
}

function renderApps() {
  const box = $('apps');
  box.replaceChildren();
  for (const spec of CATALOG) {
    const st = apps[spec.key];
    const card = el('div', 'app');
    const top = el('div', 'app-top');
    const mark = el('span', 'mark', spec.mark); mark.style.background = spec.colour;
    top.append(mark, el('b', '', spec.name));
    const status = !st ? 'not connected' : st.status === 'pending' ? 'waiting for you' : 'connected';
    top.append(el('span', 'lbl state', status));
    card.append(top);

    if (!st) {
      const b = el('button', 'btn', `Connect ${spec.name}`); b.type = 'button';
      b.onclick = () => begin(spec.key);
      card.append(b);
    } else if (st.status === 'pending') {
      card.append(el('p', 'approve', st.conn.preview()));
      const row = el('div', 'row-btns');
      const yes = el('button', 'btn primary', 'Approve'); yes.type = 'button'; yes.onclick = () => approve(spec.key);
      const no = el('button', 'btn', 'Not now'); no.type = 'button'; no.onclick = () => { delete apps[spec.key]; renderApps(); };
      row.append(yes, no);
      card.append(row);
    } else {
      const ul = el('ul', 'tools');
      for (const t of st.conn.tools()) {
        const li = el('li', 'tool');
        li.append(el('span', 'n', t.tool));
        let pill;
        if (t.kind === 'read') pill = el('span', 'pill read', 'reads');
        else if (t.radius === 'external' && !t.lowerable) pill = el('span', 'pill never', 'always asks');
        else if (t.radius === 'external') pill = el('span', 'pill ask', 'asks first');
        else pill = el('span', 'pill go', 'goes ahead');
        pill.title = t.why.join('; ');
        li.append(pill);
        if (t.kind === 'write' && t.lowerable && t.radius === 'external') {
          const b = el('button', 'btn let', 'Let it go ahead'); b.type = 'button';
          b.onclick = () => letItGo(spec.key, t.tool);
          li.append(b);
        }
        ul.append(li);
      }
      card.append(ul);
      if (st.conn.shapeProblems.length) {
        const p = el('ul', 'problems');
        for (const x of st.conn.shapeProblems) p.append(el('li', '', x));
        card.append(p);
      }
    }
    box.append(card);
  }
}

// --------------------------------------------------------------------- stage

async function hear(text) {
  said = text;
  const r = app.hear(text);
  if (!r.act) {
    // Not an act: ask the pyramid. The answer is a notice, not a card.
    const out = await pyramid.pursue(text);
    const final = out.kind === 'split' ? out.then : out;
    if (final.kind === 'answered') showAnswer(text, final.answer);
  }
  refresh();
}

function showAnswer(question, answer) {
  const stage = $('stage');
  stage.replaceChildren();
  stage.className = 'eui-stage';
  stage.append(el('div', 'eui-said', `“${question}”`));
  const card = el('div', 'eui-card');
  card.style.setProperty('--eui-domain', theme.assistant);
  card.append(el('div', 'eui-kicker', 'FOUND'));
  for (const line of answer.split('\n')) card.append(el('div', 'eui-row', line));
  stage.append(card);
}

function renderScenes() {
  const box = $('scenes');
  box.replaceChildren();
  const list = [
    ...CATALOG.filter((c) => apps[c.key]?.status === 'connected').flatMap((c) => c.scenes),
    'every morning tell me what is due',
  ];
  for (const s of list) {
    const b = el('button', 'scene', s); b.type = 'button';
    b.onclick = () => { $('say').value = s; hear(s); };
    box.append(b);
  }
}

$('sayForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('say').value.trim();
  if (t) hear(t);
});

function whyLine() {
  const run = app?.act;
  const p = $('why');
  if (!run || ['settled', 'discarded', 'failed'].includes(run.status)) { p.textContent = run?.status === 'failed' ? 'That did not save. Nothing else changed.' : ''; return; }
  try {
    const x = A.explain(run, ctx());
    p.replaceChildren(el('b', '', 'Why it is waiting: '), document.createTextNode(x.summary));
  } catch { p.textContent = ''; }
}

// ----------------------------------------------------------------- conductor

function fmtTime(ms) { const d = new Date(ms); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDay(ms) { return new Date(ms).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); }

async function skip(ms) {
  condClock.advance(ms);
  await conductor.tick();
  refresh();
}
$('skipHour').onclick = () => skip(60 * 60_000);
$('skipMorning').onclick = () => {
  const now = new Date(condClock.now());
  const next = new Date(now); next.setHours(8, 1, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  skip(next - now);
};

function renderConductor() {
  $('clock').textContent = fmtTime(condClock.now());
  $('clockDay').textContent = fmtDay(condClock.now()) + ' · its own clock';
  const score = $('score'); score.replaceChildren();
  const orders = conductor.orders();
  if (!orders.length) score.append(el('li', 'empty', 'No standing orders, so it does nothing. Try "every morning tell me what is due".'));
  for (const o of orders) {
    const li = el('li');
    li.append(el('span', '', o.text), el('span', 'pill go ceil', `up to ${o.spec.ceiling}`));
    score.append(li);
  }
  const inbox = $('inbox'); inbox.replaceChildren();
  const items = [...conductor.inbox()].reverse();
  if (!items.length) inbox.append(el('li', 'empty', 'Nothing yet. Skip ahead to let it work.'));
  for (const i of items.slice(0, 20)) {
    const li = el('li', 'item'); li.dataset.kind = i.kind;
    const label = { done: 'Done on its own', waiting: 'Waiting for you', notice: 'Found', failed: 'Could not' }[i.kind];
    li.append(el('span', 'lbl', `${label} · ${fmtTime(i.at)}`), el('span', 't', i.title));
    const d = i.why ? i.why.join('; ') : i.detail;
    if (d) li.append(el('span', 'd', d));
    if (i.kind === 'waiting') {
      const b = el('button', 'btn', 'Open on the stage'); b.type = 'button';
      b.onclick = () => { said = i.detail; conductor.open(i.id); refresh(); };
      li.append(b);
    }
    inbox.append(li);
  }
}

// -------------------------------------------------------------------- memory

function renderMemory() {
  const v = memory.reader.view();
  $('mDecisions').textContent = v.decisions.length;
  $('mThoughts').textContent = v.thoughts.length;
  $('mBranches').textContent = memory.reader.branches().length;
  const log = $('memLog'); log.replaceChildren();
  const rows = [
    ...v.decisions.map((d) => ({ k: d.undone ? 'undone' : 'decided', t: `${d.act.replace(/_/g, ' ')}`, at: d.at })),
    ...Object.entries(v.delegations).map(([t, r]) => ({ k: 'allowed', t: `${t} → ${r}`, at: 0 })),
    ...v.thoughts.slice(-6).map((t) => ({ k: 'thought', t: `${t.topic}: ${t.text.split('\n')[0]}`, at: t.at })),
  ].sort((a, b) => b.at - a.at).slice(0, 12);
  if (!rows.length) log.append(el('li', 'empty', 'Nothing decided yet.'));
  for (const r of rows) { const li = el('li'); li.append(el('span', 'kind', r.k), el('span', '', r.t)); log.append(li); }
}

// --------------------------------------------------------------------- theme

const SWATCHES = ['#06B6D4', '#E07BFF', '#7C8BFF', '#F5B971', '#34D399'];
function renderTheme() {
  const box = $('swatches'); box.replaceChildren();
  for (const c of SWATCHES) {
    const b = el('button', 'sw'); b.type = 'button'; b.style.background = c;
    b.setAttribute('aria-label', `Use ${c}`);
    b.setAttribute('aria-pressed', String(theme.assistant === c));
    b.onclick = () => {
      const problems = A.checkTheme({ assistant: c });
      $('themeMsg').textContent = problems[0] ? problems[0].replace('assistant: ', '') : '';
      if (problems.length) return;
      theme = { assistant: c };
      document.documentElement.style.setProperty('--assistant', A.orbTints(theme).idle);
      renderTheme();
    };
    box.append(b);
  }
}

// ----------------------------------------------------------------- the loop

function refresh() {
  if (!app) return;
  app.draw();
  whyLine();
  renderApps();
  renderConductor();
  renderMemory();
}

let last = 0;
function frame(t) {
  // The ring moves while a card is held; nothing else needs a frame.
  if (app?.act?.status === 'hold' && t - last > 50) { app.draw(); last = t; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------- a working start
// Tasks is connected for the demo; Bank waits for you to approve it.
renderTheme();
await begin('tasks');
await approve('tasks');
$('say').value = CATALOG[0].scenes[0];
await hear(CATALOG[0].scenes[0]);
})();
</script>
