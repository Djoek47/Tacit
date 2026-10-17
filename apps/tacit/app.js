<script>
(async function () {
  'use strict';
  var T = window.Tacit;
  // The card's second line under an answer (a place's address and distance) comes from Tacit, once it exists.
  T.defineStageElement({ tint: 'var(--accent)', detailFor: function (slot, v) { return t ? t.detailFor(slot, v) : null; } });
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  // ------------------------------------------------------------ vault
  // What Tacit knows about you, your data, the Desk and your own AI key are
  // encrypted at rest once you set a passphrase (Settings → Privacy). After
  // unlock they live decrypted in memory only; every save is sealed again.
  var VAULTED = ['tacit.person', 'tacit.data', 'tacit.desk', 'tacit.profile', 'tacit.marks', 'tacit.prefs'];
  var vault = null, plain = {}, pending = {};
  try { vault = new T.Vault(localStorage); } catch (e) { vault = null; }
  function sealLater(k) {
    pending[k] = (pending[k] || Promise.resolve()).then(function () {
      if (!vault || !vault.unlocked) return;
      if (k in plain) return vault.put(k, plain[k]);
    }).catch(function () {});
  }
  function store(k, v) {
    try {
      if (vault && vault.unlocked && VAULTED.indexOf(k) >= 0) {
        if (v === undefined) return k in plain ? plain[k] : null;
        if (v === null) { delete plain[k]; localStorage.removeItem(k); return; }
        plain[k] = String(v); sealLater(k); return;
      }
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function lockScreen() {
    return new Promise(function (done) {
      var o = el('div', 'vault-lock');
      o.innerHTML = '<div class="orb welcome-orb" data-state="idle" aria-hidden="true"><span class="halo"></span><span class="ring"></span><span class="ring two"></span><span class="sphere"></span><svg class="tetra"><use href="#tetra"/></svg></div>';
      var h = el('h2', '', 'Tacit is locked'); var p = el('p', '', 'What Tacit knows about you is encrypted on this device. Your passphrase opens it.');
      var f = el('form', 'vault-form'); var i = el('input'); i.type = 'password'; i.autocomplete = 'current-password'; i.placeholder = 'Passphrase'; i.setAttribute('aria-label', 'Passphrase');
      var b = el('button', 'btn primary', 'Unlock'); b.type = 'submit'; var msg = el('p', 'vault-msg', '');
      var erase = el('button', 'btn small quiet', 'Forgot it? Start over'); erase.type = 'button'; var armed = false;
      erase.onclick = function () {
        if (!armed) { armed = true; erase.textContent = 'Tap again: this erases everything Tacit kept here'; return; }
        VAULTED.concat(['tacit.vault', 'tacit.welcomed']).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        location.reload();
      };
      f.append(i, b);
      f.onsubmit = async function (e) {
        e.preventDefault(); b.disabled = true; msg.textContent = 'Opening…';
        var ok = false; try { ok = await vault.unlock(i.value); } catch (x) { ok = false; }
        if (!ok) { msg.textContent = 'That passphrase doesn’t open it.'; b.disabled = false; i.select(); return; }
        for (var n = 0; n < VAULTED.length; n++) { try { var val = await vault.get(VAULTED[n]); if (val !== null) plain[VAULTED[n]] = val; } catch (x) {} }
        o.remove(); done();
      };
      o.append(h, p, f, msg, erase); document.body.appendChild(o); setTimeout(function () { i.focus(); }, 30);
    });
  }
  if (vault && vault.exists) await lockScreen();
  // Locked again after 15 quiet minutes: the key leaves memory with the page.
  var lastActive = Date.now();
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true }); });
  setInterval(function () { if (vault && vault.unlocked && Date.now() - lastActive > 15 * 60000) location.reload(); }, 60000);
  function hhmm(at) { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  // ------------------------------------------------------------ theme
  function applyTheme() { var th = store('tacit.theme'); if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme; }
  applyTheme();

  // ------------------------------------------------------------ server
  // On Vercel or `npm run tacit`, the page has a server: models, tools, the
  // real world feed. Nothing about you is stored there. What this browser
  // chose — the access code, a key of your own, your tools — stays here and
  // rides along with each request.
  var PREFS = (function () { try { return JSON.parse(store('tacit.prefs') || '{}') || {}; } catch (e) { return {}; } })();
  function savePrefs() { store('tacit.prefs', JSON.stringify(PREFS)); }
  PREFS.mcp = PREFS.mcp || [];
  function heads() {
    var h = {};
    if (PREFS.code) h['x-tacit-code'] = PREFS.code;
    if (PREFS.provider) h['x-tacit-provider'] = PREFS.provider;
    if (PREFS.model) h['x-tacit-model'] = PREFS.model;
    if (PREFS.key) h['x-tacit-key'] = PREFS.key;
    return h;
  }
  var STATUS = null;
  async function api(path, body, ms) {
    var ctl = new AbortController(); var timer = setTimeout(function () { ctl.abort(); }, ms || 15000);
    try {
      var h = heads();
      var init = body === undefined ? { cache: 'no-store', headers: h, signal: ctl.signal } : { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, h), body: JSON.stringify(body), signal: ctl.signal };
      var r = await fetch(path, init);
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok && !j.error) j.error = 'the server answered ' + r.status;
      return j;
    } finally { clearTimeout(timer); }
  }
  async function refreshStatus() {
    if (!/^https?:$/.test(location.protocol)) return;
    try { var s0 = await api('/api/status', undefined, 4000); STATUS = s0 && s0.providers ? s0 : null; } catch (e) { STATUS = null; }
  }
  await refreshStatus();
  var SERVER = !!STATUS;
  function provider() { return PREFS.provider || (STATUS && STATUS.hosted) || 'anthropic'; }
  function hostedUsable(pv) { return !!(STATUS && STATUS.providers[pv] && STATUS.providers[pv].hosted && (!STATUS.locked || STATUS.unlocked)); }
  function hasModel() { return SERVER && (!!PREFS.key || hostedUsable(provider())); }
  function modelLabel() { var pv = provider(); var P = STATUS && STATUS.providers[pv]; return (P ? P.label : pv) + ' · ' + (PREFS.model || (P ? P.models[0] : '')); }

  // ------------------------------------------------------------ connections
  // Each tool server you approved is reached through the Tacit server, which
  // refuses private addresses. This stand-in client gives the bridge the few
  // calls it needs.
  function proxyClient(m) {
    var caps = null, ver = null;
    function rpc(method, params) {
      return api('/api/mcp/rpc', { url: m.url, token: m.token || '', method: method, params: params }, 30000).then(function (j) { if (j.error) throw new Error(j.error); return j.result; });
    }
    return {
      prime: async function () { caps = await rpc('getServerCapabilities'); ver = await rpc('getServerVersion'); },
      getServerCapabilities: function () { return caps || {}; },
      getServerVersion: function () { return ver || { name: m.id, version: '0' }; },
      listTools: function (p) { return rpc('listTools', p || {}); },
      callTool: function (p) { return rpc('callTool', p); },
      readResource: function (p) { return rpc('readResource', p); },
    };
  }
  var connections = [], connectionErrors = [];
  if (SERVER && (!STATUS.locked || STATUS.unlocked)) {
    for (var mi = 0; mi < PREFS.mcp.length; mi++) {
      var m = PREFS.mcp[mi];
      try {
        var pc = proxyClient(m); await pc.prime();
        var conn = await T.connect(pc, { prefix: m.id + '_', id: m.id });
        await conn.approve();
        connections.push(conn);
      } catch (e) { connectionErrors.push(m.name + ': ' + e.message); }
    }
  }

  // ------------------------------------------------------------ world
  var H = 3600000, now0 = Date.now();
  var SAMPLE = [
    ['markets', 'Sample market item: crude oil supply outlook for the quarter'],
    ['markets', 'Sample market item: central bank rate decision due this week'],
    ['ai', 'Sample tech item: a new model release and what it changes for developers'],
    ['ai', 'Sample tech item: chip export rules and supply'],
    ['climate', 'Sample world item: an air quality advisory in a large city'],
    ['cyber', 'Sample world item: a widely used library patches a flaw'],
  ];
  var sample = { name: 'sample', pull: function () { return Promise.resolve(SAMPLE.map(function (x, i) { return { id: 'w' + i, source: 'sample feed', title: x[1], topics: [x[0]], at: now0 - (i + 1) * H }; })); } };
  var worldSource = 'sample';
  var served = SERVER && STATUS.world ? { name: 'World Monitor', pull: function () {
    return api('/api/world', undefined, 20000).then(function (b) { if (!b.items || !b.items.length) throw new Error('empty'); worldSource = 'World Monitor'; return b.items; })
      .catch(function () { worldSource = 'sample'; return sample.pull(); });
  } } : sample;

  // ------------------------------------------------------------ voice out
  var N = window.TacitNative && window.TacitNative.available ? window.TacitNative : null;
  function post(msg) { try { window.webkit.messageHandlers.tacit.postMessage(msg); } catch (e) {} }
  var t = null;
  function voiceOn() { return !t || t.settings.get('voice'); }
  function pickVoice() {
    try {
      var name = store('tacit.voice'); var vs = speechSynthesis.getVoices();
      return vs.find(function (v) { return v.name === name; }) || null;
    } catch (e) { return null; }
  }
  function orb(state, words) {
    $('orb').dataset.state = state;
    $('orb-state').textContent = words || { idle: 'Here when you are', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking' }[state];
  }
  function audible(text, finished) {
    if (!voiceOn()) { orb('idle'); return; }
    if (N) { post({ type: 'speak', text: text }); return; }
    try {
      if (!window.speechSynthesis) { orb('idle'); return; }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      var v = pickVoice(); if (v) u.voice = v;
      u.rate = Number(store('tacit.rate') || 1);
      u.onstart = function () { orb('speaking'); };
      u.onend = function () { orb('idle'); if (handsFree) setTimeout(listen, 250); if (finished) finished(); };
      u.onerror = function () { orb('idle'); if (handsFree) setTimeout(listen, 250); };
      speechSynthesis.speak(u);
    } catch (e) { orb('idle'); }
  }
  // What Tacit says: big, word by word, then into the transcript.
  var nowText = '';
  function settleNow() { if (nowText) { log('it', nowText); nowText = ''; } }
  function speak(text, kind) {
    if (!text) return;
    settleNow();
    var now = $('now'); now.replaceChildren(); now.className = 'now' + (kind === 'answer' ? ' answer' : '');
    text.split(/(\s+)/).forEach(function (w, i) {
      if (/^\s+$/.test(w)) { now.appendChild(document.createTextNode(w)); return; }
      var s = el('span', 'w', w); s.style.animationDelay = Math.min(i * 22, 1400) + 'ms'; now.appendChild(s);
    });
    nowText = text;
    recent.push({ role: 'assistant', content: text }); recent = recent.slice(-8);
    orb('speaking');
    audible(text);
    if (!voiceOn() || (!N && !window.speechSynthesis)) setTimeout(function () { orb('idle'); }, Math.min(4000, 400 + text.length * 25));
  }
  // Tuning notes: during a test conversation, mark any line of Tacit's that
  // should have gone differently. Kept in this browser; exported with Copy notes.
  var transcript = [], lastSaid = '';
  var MARKS = [['follow', 'Should have followed up'], ['move', 'Should have moved on'], ['off', 'Felt off'], ['good', 'Good']];
  function marks() { try { return JSON.parse(store('tacit.marks') || '[]'); } catch (e) { return []; } }
  function mark(entry, kind, row) {
    var all = marks().filter(function (m) { return m.id !== entry.id; });
    all.push({ id: entry.id, at: new Date().toISOString(), mark: kind, tacit: entry.text, before: entry.before });
    store('tacit.marks', JSON.stringify(all.slice(-300)));
    row.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.k === kind)); });
    renderNotes();
  }
  function log(who, text) {
    var box = $('log'); var m = el('div', 'msg ' + who, text);
    if (who === 'me') lastSaid = text;
    transcript.push({ who: who, text: text, at: new Date().toISOString() }); if (transcript.length > 400) transcript.shift();
    if (who === 'it') {
      var entry = { id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), text: text, before: lastSaid };
      var row = el('div', 'marks');
      MARKS.forEach(function (k) {
        var b = el('button', '', k[1]); b.type = 'button'; b.dataset.k = k[0]; b.setAttribute('aria-pressed', 'false');
        b.onclick = function () { mark(entry, k[0], row); }; row.appendChild(b);
      });
      m.appendChild(row);
    }
    box.appendChild(m);
    while (box.children.length > 60) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function notesText() {
    var label = {}; MARKS.forEach(function (k) { label[k[0]] = k[1]; });
    return marks().map(function (m, i) { return (i + 1) + '. ' + label[m.mark].toUpperCase() + '\n   You said: ' + (m.before || '(start)') + '\n   Tacit said: ' + m.tacit; }).join('\n\n');
  }
  function renderNotes() {
    var b = $('notes-btn'); if (!b) return;
    var n = marks().length; b.textContent = n ? 'Copy tuning notes (' + n + ')' : 'Mark lines below to leave tuning notes';
    b.disabled = !n;
  }

  // ------------------------------------------------------------ Tacit
  var saved = null; try { saved = JSON.parse(store('tacit.person') || 'null'); } catch (e) {}
  var recent = [];
  t = T.createTacit({
    profile: { interests: ['markets', 'ai', 'cyber'] },
    restore: saved || undefined,
    // What Tacit's own actions keep (the grocery list, plans, reminders, drafts), saved in this browser.
    data: (function () { try { return JSON.parse(store('tacit.data') || 'null') || undefined; } catch (e) { return undefined; } })(),
    onData: function (d) { store('tacit.data', JSON.stringify(d)); if (typeof renderKept === 'function') renderKept(); },
    world: [served],
    speak: function (s) { speak(s, 'answer'); },
    el: $('stage'),
    sources: { connections: connections },
  });
  try { var over = JSON.parse(store('tacit.profile') || 'null'); if (over) t.updateProfile(over); } catch (e) {}
  function save() { store('tacit.person', JSON.stringify(t.snapshot())); }

  // ------------------------------------------------------------ kept for you
  // What Tacit's actions have kept, in plain words, beside the conversation.
  function whenText(w) {
    var d = new Date(w.at);
    var day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return w.granularity === 'day' ? day : day + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  // What Tacit did today, each with its undo while undo is still honest.
  var receiptsCard = null;
  function renderReceipts() {
    var host = $('receipts'); if (!host || !t) return;
    if (!receiptsCard) {
      briefStyles();
      var inner = document.createElement('div'); host.replaceChildren(inner);
      receiptsCard = new T.ReceiptsPresenter(inner, document, { accent: 'var(--accent)', showOut: false });
      receiptsCard.mount({
        undo: function (id) { t.receipts.undo(id).then(function (ok) { if (!ok) log('note', 'That one can’t be taken back any more.'); renderReceipts(); renderKept(); }); },
        done: function () {},
      });
    }
    receiptsCard.render({ rows: t.receipts.today().map(function (r) {
      return { id: r.id, line: r.line, when: new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        state: r.undone ? 'undone' : r.final ? 'final' : 'done', note: r.final === 'reached someone else' ? 'sent' : 'final' };
    }) });
  }
  function renderKept() {
    renderReceipts();
    var box = $('kept'); if (!box) return; box.replaceChildren();
    var d = t.data, any = false;
    function group(title, rows) {
      if (!rows.length) return; any = true;
      var g = el('div', 'kept-group'); g.appendChild(el('span', 'eyebrow', title));
      rows.forEach(function (r) { var row = el('div', 'kept-row', r[0]); if (r[1]) row.appendChild(el('small', '', r[1])); g.appendChild(row); });
      box.appendChild(g);
    }
    var names = {}; T.GROCERIES.forEach(function (g) { names[g.value] = g.label; });
    var groceries = (d.lists.groceries || []).map(function (x) { return names[x] || x; });
    if (groceries.length) group('Groceries · ' + groceries.length, [[groceries.join(', ')]]);
    var soon = Date.now() - 3600000;
    group('Plans', d.plans.filter(function (p) { return p.at.at >= soon; }).sort(function (a, b) { return a.at.at - b.at.at; })
      .map(function (p) { return [p.with.charAt(0).toUpperCase() + p.with.slice(1) + ' · ' + p.place.label, whenText(p.at)]; }));
    group('Reminders', d.reminders.filter(function (r) { return !r.fired; }).sort(function (a, b) { return a.at.at - b.at.at; })
      .map(function (r) { return [r.what, whenText(r.at)]; }));
    group('Drafts', d.drafts.filter(function (x) { return !x.sent; }).map(function (x) { return ['To ' + x.to.charAt(0).toUpperCase() + x.to.slice(1) + ': ' + x.text, 'not sent'] }));
    if (!any) box.appendChild(el('p', 'empty', 'Lists, plans and reminders you ask for show up here. Try “add milk and eggs”.'));
  }
  // Reminders land when their time comes: said aloud, and on the Desk.
  setInterval(function () {
    var due = t.due();
    due.forEach(function (r) { log('note', 'Reminder: ' + r.what); speak('Reminder: ' + r.what + '.'); });
    if (due.length) { saveDesk(); renderBadges(); renderKept(); if (current === 'desk') renderDesk(); }
  }, 20000);

  // ------------------------------------------------------------ talk
  var lastLine = null, busy = false;
  var REPHRASE = { ask: 1, deeper: 1, story: 1, switch: 1, bridge: 1 };
  var QUESTION = /^(what|who|whom|whose|why|how|when|where|which|is|are|was|were|can|could|should|would|will|do|does|did|tell me|explain|give me|any idea)\b/i;
  function isQuestion(text) {
    var s = text.trim().toLowerCase();
    if (/\bwhy (do|would|are) you (ask|want)/.test(s)) return false;
    return /\?\s*$/.test(s) || QUESTION.test(s);
  }
  function known() { try { return t.person.card({ maxChars: 1500 }); } catch (e) { return ''; } }
  function worldText() {
    try { return t.context.query({ topics: t.profile.interests }).slice(0, 12).map(function (i) { return '- ' + i.title + ' (' + i.source + ')'; }).join('\n'); } catch (e) { return ''; }
  }

  async function say(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    if (briefHeard(text)) return;
    if (/^(brief me|briefing|morning report|catch me up|what did i miss)\b/i.test(text)) { show('morning'); startBrief(); return; }
    busy = true; offers([]);
    settleNow();
    log('me', text);
    recent.push({ role: 'user', content: text }); recent = recent.slice(-8);
    orb('thinking');
    try {
      // A question of their own, while Tacit is just talking: answer it, then carry on.
      if (t.waiting() === 'talk' && isQuestion(text) && !/\b(skip|stop|brief me)\b/i.test(text)) {
        var routed = t.talk(text);
        if (routed.act) { speak('It’s on your card.'); return; }
        // talk() also recorded it as an answer; take that back, it was a question.
        (routed.line && routed.line.recorded || []).forEach(function (f) { t.person.forget(f.id); });
        var answer;
        if (hasModel()) {
          var a = await api('/api/answer', { question: text, known: known(), world: worldText(), recent: recent.slice(0, -1) }, 30000);
          answer = a.text || ('I couldn’t answer that just now: ' + (a.error || 'no reply') + '.');
        } else {
          answer = 'Good question. I can answer things like that once an AI is connected in Settings.';
        }
        // Then carry on: the conversation already has its next question ready.
        var next = routed.line && routed.line.say && routed.line.move !== 'park' ? routed.line.say.replace(/^(Okay|Got it|Noted|Fair|Right|That makes sense|I can picture that|Interesting|Okay, that helps|Huh)\.\s*/, '') : '';
        if (routed.line) lastLine = routed.line;
        speak(next ? answer + '\n\n' + next : answer, 'answer');
        return;
      }
      var r = t.talk(text);
      if (r.act) { speak('It’s on your card. Stay quiet to let it happen, or change it there.'); return; }
      if (!r.line) { orb('idle'); return; }
      var line = r.line;
      if (line.move === 'briefing') { t.talk('brief me'); return; }
      lastLine = line;
      var words = line.say;
      if (hasModel() && REPHRASE[line.move]) {
        var th = line.thread ? T.THREADS.find(function (x) { return x.id === line.thread; }) : null;
        var p = await api('/api/say', { said: text, question: line.say, move: line.move, topic: th ? th.topic : '', known: known() }, 12000).catch(function () { return {}; });
        if (p && p.text) words = p.text;
      }
      speak(words);
      offers(r.offers || []);
      // A model, if there is one, writes the clean line for what was learned.
      if (hasModel()) (line.recorded || []).forEach(function (f) {
        // The name line is read back by Tacit to know what to call you; it stays as it is.
        if (f.kind !== 'stated' || f.thread === 'basics.name') return;
        var th2 = T.THREADS.find(function (x) { return x.id === f.thread; });
        api('/api/summary', { said: f.quote, topic: th2 ? th2.topic : '', question: th2 ? th2.open[0] : '' }, 15000).then(function (s) {
          if (s && s.text && s.text.trim() !== '-') { t.person.edit(f.id, s.text.trim()); save(); renderLearned(); }
        }).catch(function () {});
      });
    } catch (e) {
      speak('Something went wrong on my side: ' + e.message);
    } finally {
      busy = false; save(); renderLearned(); renderBadges();
    }
  }
  function offers(list) {
    var box = $('offers'); box.replaceChildren();
    list.forEach(function (o) {
      var y = el('button', 'chip yes', o.say); y.type = 'button';
      y.onclick = function () { t.accept(o); box.replaceChildren(); log('note', 'Done: ' + o.say.replace(/\?$/, '')); renderAll(); };
      var n = el('button', 'chip', 'Not now'); n.type = 'button'; n.onclick = function () { box.replaceChildren(); };
      box.append(y, n);
    });
  }
  $('ask').addEventListener('submit', function (e) { e.preventDefault(); var q = $('q'); var v = q.value; q.value = ''; say(v); });
  (function () {
    var b = el('button', '', ''); b.type = 'button'; b.id = 'notes-btn';
    b.onclick = function () {
      var text = notesText() + '\n\n--- full transcript ---\n' + transcript.map(function (x) { return (x.who === 'me' ? 'You: ' : x.who === 'it' ? 'Tacit: ' : '· ') + x.text; }).join('\n');
      try { navigator.clipboard.writeText(text).then(function () { b.textContent = 'Copied. Paste it to Claude'; }, function () { b.textContent = 'Copy blocked: use Settings → Privacy → Export'; }); } catch (e) { b.textContent = 'Copy blocked: use Settings → Privacy → Export'; }
    };
    $('hints').appendChild(b);
  })();
  [['skip', 'skip'], ['why do you ask?', 'why do you ask?'], ['brief me', 'brief me'], ['stop for now', 'stop']].forEach(function (h) {
    var b = el('button', '', h[0]); b.type = 'button'; b.onclick = function () { say(h[1]); }; $('hints').appendChild(b);
  });

  // ------------------------------------------------------------ voice in
  var handsFree = false, rec = null;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listen() {
    if (N) { post({ type: 'listen' }); return; }
    if (!SR) return;
    try {
      rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = false;
      rec.onstart = function () { orb('listening'); $('mic').classList.add('live'); };
      rec.onresult = function (ev) {
        var txt = ''; var fin = false;
        for (var i = ev.resultIndex; i < ev.results.length; i++) { txt += ev.results[i][0].transcript; if (ev.results[i].isFinal) fin = true; }
        $('q').value = txt;
        if (fin) { $('q').value = ''; say(txt); }
      };
      rec.onerror = function (ev) { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { $('mic').hidden = true; log('note', 'The microphone is blocked here. Type instead, or allow it in your browser.'); handsFree = false; } };
      rec.onend = function () { $('mic').classList.remove('live'); if ($('orb').dataset.state === 'listening') orb('idle'); };
      rec.start();
    } catch (e) { $('mic').hidden = true; }
  }
  if (N || SR) {
    var mic = $('mic'), pressed = 0; mic.hidden = false;
    mic.title = 'Tap to talk. Hold for hands-free.';
    mic.addEventListener('pointerdown', function () { pressed = Date.now(); });
    mic.addEventListener('pointerup', function () {
      if (handsFree) { handsFree = false; if (N) { post({ type: 'conversation', on: false }); post({ type: 'stop' }); } else if (rec) { try { rec.stop(); } catch (e) {} } log('note', 'Hands-free off'); orb('idle'); return; }
      if (Date.now() - pressed > 500) { handsFree = true; if (N) post({ type: 'conversation', on: true }); log('note', 'Hands-free on: Tacit listens again after it speaks. Tap the mic to stop.'); }
      listen();
    });
  }
  if (N) {
    N.heard = function (text, final) { if (!final) { $('q').value = text; return; } $('q').value = ''; say(text); };
    N.state = function (st) { orb(st === 'listening' ? 'listening' : st === 'speaking' ? 'speaking' : 'idle', st === 'denied' ? 'Microphone is off in Settings' : undefined); };
  }

  // ------------------------------------------------------------ side panel
  function renderLearned() {
    var c = t.person.coverage();
    $('cov-fill').style.width = (c.overall * 100).toFixed(1) + '%';
    $('cov-n').textContent = (c.overall * 100).toFixed(1) + '% of the map';
    var box = $('learned'); box.replaceChildren();
    var facts = t.person.all().slice(-4).reverse();
    if (!facts.length) { box.appendChild(el('p', 'empty', 'What you tell Tacit shows up here, in your words.')); return; }
    facts.forEach(function (f) {
      var th = T.THREADS.find(function (x) { return x.id === f.thread; });
      var d = el('div', 'f', f.text); d.appendChild(el('small', '', th ? th.topic : f.thread)); box.appendChild(d);
    });
  }

  // ------------------------------------------------------------ desk
  // The Desk is saved in this browser: every notice, what was decided for it and why, and what was read.
  try { var deskSaved = JSON.parse(store('tacit.desk') || 'null'); if (deskSaved) t.desk.restore(deskSaved); } catch (e) {}
  function saveDesk() { try { store('tacit.desk', JSON.stringify(t.desk.snapshot())); } catch (e) {} }
  var decided = t.desk.all().map(function (n) { return t.desk.decision(n.id); }).filter(Boolean);
  var INCOMING = [
    { label: 'Bank: card used abroad', n: { from: 'app:bank', title: 'Card used abroad', body: 'A payment in another country.', topics: ['money'], urgency: 0.95 } },
    { label: 'A friend writes', n: { from: 'person:sylla', title: 'Sylla: are you up?', topics: ['people'], urgency: 0.6 } },
    { label: 'Newsletter', n: { from: 'app:news', title: 'Weekly digest is out', topics: ['reading'], urgency: 0.1 } },
    { label: 'Calendar', n: { from: 'app:calendar', title: 'Call at 9:30', topics: ['calendar'], urgency: 0.5 } },
    { label: 'Market alert', n: { from: 'app:broker', title: 'Oil moved 4% in an hour', topics: ['markets'], urgency: 0.8 } },
  ];
  var nid = 0;
  INCOMING.forEach(function (x) {
    var b = el('button', 'chip', x.label); b.type = 'button';
    b.onclick = function () {
      var full = Object.assign({ id: 'n' + (++nid) + Date.now(), at: Date.now() }, x.n);
      var d = t.receive(full); decided.unshift(d); saveDesk();
      deskDeck = null; deskDismissed = false;
      if (d.delivery === 'now') log('note', 'Notification: ' + full.title);
      renderDesk(); renderBadges();
    };
    $('incoming').appendChild(b);
  });
  // What the Desk held back, as one card per sender or story. "Got it" marks
  // a bundle read (it stays on the Desk); "Later" leaves it waiting.
  var deskDeck = null, deskCard = null, deskDismissed = false;
  function renderDeskCard() {
    var host = $('d-card');
    if (!deskDeck) deskDeck = new T.BundleDeck(t.desk);
    var v = deskDeck.view();
    if (deskDismissed || (v.mode === 'clear' && v.total === 0)) { host.hidden = true; host.replaceChildren(); deskCard = null; return; }
    briefStyles();
    if (!deskCard) {
      var inner = document.createElement('div'); host.replaceChildren(inner);
      deskCard = new T.BundlePresenter(inner, document);
      deskCard.mount({
        open: function (id) { deskDeck.open(id); saveDesk(); renderDesk(); renderBadges(); },
        expand: function () { deskDeck.expand(); renderDesk(); },
        read: function () { deskDeck.markRead(); saveDesk(); renderDesk(); renderBadges(); },
        later: function () { deskDeck.later(); renderDesk(); },
        act: function (sentence) { show('talk'); say(sentence); },
        done: function () { deskDismissed = true; renderDesk(); },
      });
    }
    host.hidden = false;
    deskCard.render(v);
  }
  function renderDesk() {
    renderDeskCard();
    var box = $('desk'); box.replaceChildren();
    if (!decided.length) { box.appendChild(el('p', 'empty', 'Nothing has arrived yet. Send one below to see what the Desk does with it.')); return; }
    decided.forEach(function (d) {
      var r = el('div', 'notice' + (t.desk.isRead(d.notice.id) ? ' read' : ''));
      var mid = el('div'); mid.append(el('div', 't', d.notice.title), el('div', 'w', d.why));
      var tm = el('time', '', hhmm(d.notice.at));
      r.append(el('i', 'dot ' + d.delivery), mid, tm); box.appendChild(r);
    });
  }

  // ------------------------------------------------------------ morning
  function renderMorning() {
    var p = { interests: t.profile.interests, minutes: Number(t.settings.get('briefing_length')) };
    var b = T.brief(p, t.desk, t.context, Date.now());
    var h = new Date().getHours();
    var name = t.profile.name ? ', ' + t.profile.name : '';
    $('m-date').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('m-big').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + name + '.';
    var at = t.settings.get('briefing_time');
    $('m-lede').textContent = at === 'off' ? 'Your briefing is off. Turn it on in Settings, or ask for it any time.' : 'Ready every day at ' + String(Number(at.slice(0, 2))) + ':' + at.slice(3) + '. It waits for you; it never starts talking by itself.';
    $('m-meter').textContent = 'About ' + Math.max(1, Math.round(b.minutes)) + ' min · ' + b.words + ' words' + (b.leftOut ? ' · ' + b.leftOut + ' left out for length' : '');
    var box = $('m-body'); box.replaceChildren();
    if (!b.sections.length) box.appendChild(el('p', 'empty', 'Nothing needs you, and nothing moved in what you follow.'));
    b.sections.forEach(function (s) {
      var col = el('div', 'col'); col.appendChild(el('h3', '', s.name));
      s.items.forEach(function (it) {
        var d = el('div', 'item', it.title);
        var from = T.sourceLabel(it.source);
        d.appendChild(el('div', 'why', !from || it.why.toLowerCase().indexOf(from.toLowerCase()) >= 0 ? it.why : it.why + ' · ' + from));
        col.appendChild(d);
      });
      box.appendChild(col);
    });
    $('m-source').textContent = 'World: ' + (worldSource === 'sample' ? 'sample feed (connect World Monitor in Settings for the real one)' : 'World Monitor');
  }
  // The briefing card: the morning one item at a time. Read aloud when the
  // voice is on, and it moves on by itself only when the speech really ended;
  // with the voice off it waits for Next. "Next", "back", "more", "stop" and
  // "continue" are heard while it is open; anything else goes to the talk.
  var reader = null, briefCard = null, briefTimer = 0;
  function briefStyles() {
    if (document.getElementById('eui-brief-css')) return;
    var st = document.createElement('style'); st.id = 'eui-brief-css'; st.textContent = T.stageStylesheet(); document.head.appendChild(st);
  }
  function briefDraw() { if (briefCard && reader) briefCard.render(reader.view()); }
  function briefSay() {
    clearTimeout(briefTimer);
    briefDraw();
    var line = reader.line();
    if (!line) { try { speechSynthesis.cancel(); } catch (e) {} orb('idle'); return; }
    var mine = reader;
    audible(line, function () {
      if (reader !== mine || reader.done) return;
      var m = reader.view().mode;
      if (m !== 'item' && m !== 'more') return;
      briefTimer = setTimeout(function () { if (reader === mine) { reader.next(); briefSay(); } }, 900);
    });
  }
  function briefEnd() {
    clearTimeout(briefTimer);
    reader = null;
    try { speechSynthesis.cancel(); } catch (e) {}
    if (N) post({ type: 'stop' });
    orb('idle');
    $('m-card').hidden = true; $('m-card').replaceChildren(); briefCard = null;
  }
  function startBrief() {
    briefStyles();
    var p = { interests: t.profile.interests, minutes: Number(t.settings.get('briefing_length')) };
    reader = new T.BriefingReader(T.brief(p, t.desk, t.context, Date.now()), t.profile.name || undefined);
    var host = $('m-card'); host.hidden = false;
    var inner = document.createElement('div'); host.replaceChildren(inner);
    briefCard = new T.BriefingPresenter(inner, document, { kicker: 'Morning' });
    briefCard.mount({
      next: function () { reader.next(); briefSay(); },
      back: function () { reader.back(); briefSay(); },
      more: function () { reader.more(); briefSay(); },
      stop: function () { reader.stop(); briefSay(); },
      resume: function () { reader.resume(); briefSay(); },
      act: function (sentence) { briefEnd(); show('talk'); say(sentence); },
      done: briefEnd,
    });
    briefSay();
    host.scrollIntoView({ block: 'nearest' });
  }
  function briefHeard(text) {
    if (!reader || current !== 'morning') return false;
    var r = reader.hear(text);
    if (!r) return false;
    if (r.command === 'act') { briefEnd(); show('talk'); setTimeout(function () { say(r.say); }, 0); return true; }
    briefSay();
    return true;
  }
  $('m-play').onclick = function () { startBrief(); };

  // ------------------------------------------------------------ library
  // Skills: every action Tacit can take, how to say it, and where it came from
  // (built in, built by you, a connection). Knowledge: everything it keeps.
  function human(n) { var s = String(n).replace(/^set_/, '').replace(/^log_/, '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
  function renderLibrary() {
    var q = ($('lib-q').value || '').trim().toLowerCase();
    var hit = function (s) { return !q || String(s).toLowerCase().indexOf(q) >= 0; };
    var built = {}; (t.data.menus.specs || []).forEach(function (s) { built[s.name] = s; });
    var skills = t.app.ui.definitions.map(function (d) {
      var kind = built[d.name] ? 'Built by you' : /^set_/.test(d.name) ? 'Setting' : d.name.indexOf('__') >= 0 || /\//.test(d.name) ? 'Connection' : 'Built in';
      var title = built[d.name] ? built[d.name].title : human(d.name);
      var say = (d.phrases || []).slice(0, 3).map(function (p) { return '“' + p + '”'; }).join(' · ');
      var used = (t.data.receipts || []).filter(function (r) { return r.act === d.name; }).length;
      return { d: d, kind: kind, title: title, say: say, used: used, slots: Object.keys(d.slots).join(', ') };
    }).filter(function (x) { return hit(x.title + ' ' + x.say + ' ' + x.kind + ' ' + x.slots); });
    var order = { 'Built by you': 0, 'Built in': 1, 'Connection': 2, 'Setting': 3 };
    skills.sort(function (a, b) { return order[a.kind] - order[b.kind] || a.title.localeCompare(b.title); });
    var sbox = $('lib-skills'); sbox.replaceChildren(); $('lib-sn').textContent = String(skills.length);
    skills.forEach(function (x) {
      var row = el('div', 'lib-row'); var top = el('div', 'lib-top');
      top.append(el('b', '', x.title), el('span', 'lib-kind', x.kind + (x.used ? ' · used ' + x.used + '×' : '')));
      row.append(top, el('small', '', x.say || 'Pick it from the menu'), el('small', 'lib-fields', 'Asks for: ' + x.slots));
      if (built[x.d.name]) {
        var rm = el('button', 'btn small quiet', 'Remove'); rm.type = 'button';
        rm.onclick = function () { t.data.menus.specs = t.data.menus.specs.filter(function (s) { return s.name !== x.d.name; }); store('tacit.data', JSON.stringify(t.data)); location.reload(); };
        row.appendChild(rm);
      }
      sbox.appendChild(row);
    });
    if (!skills.length) sbox.appendChild(el('p', 'empty', q ? 'No skill matches.' : 'No skills yet.'));
    var hint = el('p', 'lib-hint', 'Build a new one by saying: “make a menu for … with …, … and …”.'); sbox.appendChild(hint);
    // Ready to add: the catalogue, one tap each.
    var have = {}; t.app.ui.definitions.forEach(function (d) { have[d.name] = 1; });
    var lastG = null;
    T.CATALOG.forEach(function (c) {
      var spec; try { spec = T.validateMenu(c.spec); } catch (e) { return; }
      if (have[spec.name] || !hit(c.group + ' ' + spec.title + ' ' + spec.fields.map(function (f) { return f.label; }).join(' '))) return;
      if (c.group !== lastG) { sbox.appendChild(el('span', 'eyebrow lib-group', 'Ready to add · ' + c.group)); lastG = c.group; }
      var row = el('div', 'lib-row'); var top = el('div', 'lib-top');
      top.append(el('b', '', spec.title), el('span', 'lib-kind', 'Ready'));
      var add = el('button', 'btn small', 'Add'); add.type = 'button';
      add.onclick = function () { t.buildMenu(spec); renderLibrary(); };
      row.append(top, el('small', '', spec.phrases.slice(0, 2).map(function (p) { return '“' + p + '”'; }).join(' · ')), el('small', 'lib-fields', 'Asks for: ' + spec.fields.map(function (f) { return f.label; }).join(', ')), add);
      sbox.appendChild(row);
    });

    var know = [];
    t.person.all().forEach(function (f) { var th = T.THREADS.find(function (x) { return x.id === f.thread; }); know.push(['About you', f.text, th ? th.topic : '']); });
    var names = {}; T.GROCERIES.forEach(function (g) { names[g.value] = g.label; });
    if ((t.data.lists.groceries || []).length) know.push(['Lists', 'Groceries: ' + t.data.lists.groceries.map(function (x) { return names[x] || x; }).join(', '), '']);
    t.data.plans.forEach(function (p) { know.push(['Plans', p.with + ' · ' + p.place.label, whenText(p.at)]); });
    t.data.reminders.forEach(function (r) { know.push(['Reminders', r.what, (r.fired ? 'done · ' : '') + whenText(r.at)]); });
    t.data.drafts.forEach(function (d) { know.push(['Drafts', 'To ' + d.to + ': ' + d.text, d.sent ? 'sent' : 'not sent']); });
    Object.keys(t.data.menus.entries || {}).forEach(function (k) {
      var spec = built[k]; (t.data.menus.entries[k] || []).forEach(function (e) {
        var vals = Object.keys(e.values).map(function (f) { var v = e.values[f]; return v && typeof v === 'object' && 'label' in v ? v.label : String(v); }).join(' · ');
        know.push([spec ? spec.title : human(k), vals, new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' })]);
      });
    });
    t.desk.all().slice(0, 30).forEach(function (n) { know.push(['Desk', n.title, T.sourceLabel(n.from) || '']); });
    know = know.filter(function (k) { return hit(k.join(' ')); });
    var kbox = $('lib-know'); kbox.replaceChildren(); $('lib-kn').textContent = String(know.length);
    var last = null;
    know.forEach(function (k) {
      if (k[0] !== last) { kbox.appendChild(el('span', 'eyebrow lib-group', k[0])); last = k[0]; }
      var row = el('div', 'lib-row'); row.appendChild(el('span', '', k[1])); if (k[2]) row.appendChild(el('small', '', k[2])); kbox.appendChild(row);
    });
    if (!know.length) kbox.appendChild(el('p', 'empty', q ? 'Nothing matches.' : 'Nothing kept yet. Talk to Tacit and this fills in.'));
  }
  $('lib-q').addEventListener('input', function () { renderLibrary(); });

  // ------------------------------------------------------------ voice-first
  // Once set up, Talk opens to the voice alone. A card shows only while
  // something said has built one; "Show everything" brings the app back.
  function setVoice(on) {
    document.body.classList.toggle('voice', on);
    if (on) $('stage').setAttribute('nomenu', ''); else $('stage').removeAttribute('nomenu');
    $('voice-toggle').textContent = on ? 'Show everything' : 'Voice only';
    $('voice-toggle').setAttribute('aria-pressed', String(on));
    store('tacit.mode', on ? 'voice' : 'full');
    if (t) t.draw();
  }
  $('voice-toggle').onclick = function () { setVoice(!document.body.classList.contains('voice')); if (!document.body.classList.contains('voice')) show(current); };
  setInterval(function () {
    if (!t) return;
    var v = t.app.view();
    document.body.classList.toggle('has-card', !!(v && v.act && v.status !== 'discarded'));
  }, 250);
  // The briefing card from the keyboard: → next, ← back, M more, Space pause or continue, Esc close.
  document.addEventListener('keydown', function (e) {
    if (!reader || current !== 'morning' || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var m = reader.view().mode, done = true;
    if (e.key === 'ArrowRight') { reader.next(); briefSay(); }
    else if (e.key === 'ArrowLeft') { reader.back(); briefSay(); }
    else if (e.key === 'm' || e.key === 'M') { reader.more(); briefSay(); }
    else if (e.key === ' ') { if (m === 'stopped') reader.resume(); else reader.stop(); briefSay(); }
    else if (e.key === 'Escape') briefEnd();
    else done = false;
    if (done) e.preventDefault();
  });

  // ------------------------------------------------------------ you
  function renderYou() {
    var c = t.person.coverage(); var all = t.person.all();
    $('y-pct').textContent = (c.overall * 100).toFixed(1) + '%';
    $('y-sub').textContent = 'of the map · ' + Math.round(t.person.minutes) + ' min of conversation';
    $('y-facts').textContent = String(all.length);
    var bars = $('y-bars'); bars.replaceChildren();
    c.domains.forEach(function (d) {
      var r = el('div', 'bar-row'); r.appendChild(el('span', '', d.name));
      var tr = el('div', 'track'); var f = el('div', 'fill'); f.style.width = (d.covered * 100).toFixed(1) + '%'; tr.appendChild(f);
      r.append(tr, el('span', 'n', Math.round(d.covered * 100) + '%')); bars.appendChild(r);
    });
    var pend = $('y-pending'); pend.replaceChildren();
    var pending = t.person.pending();
    if (pending.length) {
      var pp = el('div', 'panel panel-pad stack');
      pp.appendChild(el('b', '', 'Tacit thinks this describes you. Keep it only if you agree:'));
      pending.forEach(function (f) {
        var row = el('div', 'inline'); row.appendChild(el('span', '', f.text));
        var k = el('button', 'chip yes', 'That’s me'); k.type = 'button'; k.onclick = function () { t.person.confirm(f.id); save(); renderAll(); };
        var x = el('button', 'chip', 'Not really'); x.type = 'button'; x.onclick = function () { t.person.forget(f.id); save(); renderAll(); };
        row.append(k, x); pp.appendChild(row);
      });
      pend.appendChild(pp);
    }
    var list = $('y-list'); list.replaceChildren();
    if (!all.length) { list.appendChild(el('p', 'empty', 'Nothing yet. Talk to Tacit and this fills in.')); return; }
    var by = {}; all.forEach(function (f) { (by[f.domain] = by[f.domain] || []).push(f); });
    T.DOMAINS.forEach(function (d) {
      var fs = by[d.id]; if (!fs) return;
      list.appendChild(el('span', 'eyebrow', d.name));
      var panel = el('div', 'panel rows');
      fs.forEach(function (f) {
        var row = el('div', 'fact'); var left = el('div');
        left.appendChild(el('div', '', f.text));
        if (f.text.toLowerCase().replace(/[^a-z0-9]/g, '') !== f.quote.toLowerCase().replace(/[^a-z0-9]/g, '')) left.appendChild(el('q', '', f.quote));
        var x = el('button', 'link', 'Forget'); x.type = 'button'; x.onclick = function () { t.person.forget(f.id); save(); renderAll(); };
        row.append(left, x); panel.appendChild(row);
      });
      list.appendChild(panel);
    });
  }

  // ------------------------------------------------------------ settings
  var OPTS = {
    interruptions_per_hour: [[1, '1'], [3, '3'], [6, '6']],
    briefing_time: [['off', 'Off'], ['06:00', '6:00'], ['07:00', '7:00'], ['08:00', '8:00']],
    briefing_length: [[5, 'Short'], [15, 'Standard'], [20, 'Long']],
  };
  var SECTIONS = [['you', 'You'], ['ai', 'AI model'], ['connections', 'Connections'], ['voice', 'Voice'], ['notifications', 'Notifications'], ['briefing', 'Briefing'], ['world', 'World feed'], ['permissions', 'Permissions'], ['appearance', 'Appearance'], ['privacy', 'Privacy'], ['about', 'About']];
  function section(id, title, intro) {
    var s = el('section', 'sec'); s.id = 's-' + id; s.appendChild(el('h2', '', title)); if (intro) s.appendChild(el('p', '', intro)); return s;
  }
  function field(label, describe, control, extra) {
    var f = el('div', 'field'); var l = el('div', 'l'); l.appendChild(el('b', '', label)); if (describe) l.appendChild(el('span', '', describe)); if (extra) l.appendChild(extra);
    f.append(l, control); return f;
  }
  function seg(options, value, onpick) {
    var g = el('div', 'seg'); g.setAttribute('role', 'group');
    options.forEach(function (o) { var b = el('button', '', o[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(o[0] === value)); b.onclick = function () { onpick(o[0]); }; g.appendChild(b); });
    return g;
  }
  function sw(on, label, onflip) { var b = el('button', 'switch'); b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!on)); b.setAttribute('aria-label', label); b.onclick = function () { onflip(!on); }; return b; }
  function setting(key) { return function (v) { t.settings.set(key, v, 'screen'); renderAll(); }; }
  function panelOf() { var p = el('div', 'panel rows'); for (var i = 0; i < arguments.length; i++) p.appendChild(arguments[i]); return p; }
  var shownHow = false;
  function needsServer(box) {
    if (shownHow) { box.appendChild(el('div', 'status', 'Available in the full version: see AI model above.')); return; }
    shownHow = true;
    box.appendChild(el('div', 'status', 'This is a preview running entirely in your browser, so it cannot reach an AI or your tools. The full version of Tacit does: it runs on its own site, or on your computer with “npm run tacit”.'));
  }

  var mcpPreview = null, confirmForget = false;

  function renderSettings() {
    var nav = $('snav'); nav.replaceChildren();
    SECTIONS.forEach(function (s) { var b = el('button', '', s[1]); b.type = 'button'; b.onclick = function () { var target = $('s-' + s[0]); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; nav.appendChild(b); });
    var body = $('s-body'); var keepY = window.scrollY; body.replaceChildren(); shownHow = false;

    // You
    var you = section('you', 'You', 'How Tacit addresses you and what your briefing leads with. Tacit also learns these as you talk.');
    var name = el('input', 'input'); name.value = t.profile.name || ''; name.placeholder = 'Your first name';
    var place = el('input', 'input'); place.value = t.profile.place || ''; place.placeholder = 'Your city';
    var ints = el('input', 'input'); ints.value = (t.profile.interests || []).join(', '); ints.placeholder = 'markets, AI, hockey';
    var keep = el('button', 'btn small', 'Save'); keep.type = 'button';
    keep.onclick = function () { var o = { name: name.value, place: place.value, interests: ints.value.split(',') }; t.updateProfile(o); store('tacit.profile', JSON.stringify(o)); keep.textContent = 'Saved'; renderAll(); };
    you.appendChild(panelOf(field('Name', 'What Tacit calls you.', name), field('City', 'What “around you” means in your briefing.', place), field('What you follow', 'Most important first, separated by commas.', ints), el('div', 'inline')));
    you.lastChild.lastChild.appendChild(keep);
    body.appendChild(you);

    // AI model
    var ai = section('ai', 'AI model', 'Bring your own: Claude, GPT or Grok. Tacit’s conversation decides what to ask; the model decides how to say it, answers your questions, and writes clean notes of what you said.');
    if (!SERVER) needsServer(ai);
    else {
      var pv = provider(), P = STATUS.providers[pv];
      var line = PREFS.key ? 'Using your own ' + P.label + ' key, kept in this browser.'
        : hostedUsable(pv) ? 'Using this site’s ' + P.label + '.'
        : P.hosted && STATUS.locked ? 'This site has ' + P.label + '. Enter the access code to use it, or add your own key.'
        : 'This site has no ' + P.label + ' key. Add your own below, or pick another provider.';
      ai.appendChild(el('div', 'status' + (hasModel() ? ' ok' : ''), line));
      var provSeg = seg(Object.keys(STATUS.providers).map(function (k) { var Q = STATUS.providers[k]; return [k, Q.label + (Q.hosted ? ' ✓' : '')]; }), pv, function (k) { PREFS.provider = k; delete PREFS.model; savePrefs(); renderPill(); renderSettings(); });
      var rows = [field('Provider', '✓ means this site has a key for it.', provSeg)];
      if (STATUS.locked) {
        var code = el('input', 'input'); code.type = 'password'; code.placeholder = STATUS.unlocked ? 'Accepted' : 'Access code'; code.value = '';
        var cbtn = el('button', 'btn small', STATUS.unlocked ? 'Change' : 'Unlock'); cbtn.type = 'button';
        cbtn.onclick = async function () { PREFS.code = code.value.trim(); savePrefs(); await refreshStatus(); if (STATUS.unlocked) { location.reload(); } else { code.value = ''; code.placeholder = 'That code did not work'; } };
        var crow = el('div', 'inline'); crow.append(code, cbtn);
        rows.push(field('Access code', STATUS.unlocked ? 'Accepted. This browser can use the site’s AI and tools.' : 'From whoever shared Tacit with you.', crow));
      }
      var key = el('input', 'input'); key.type = 'password'; key.autocomplete = 'off'; key.placeholder = PREFS.key ? 'Your key is saved in this browser' : P.keyHint + '  (optional)';
      rows.push(field('Your own key', 'Optional. Stays in this browser and is sent only with your own requests; the server never stores it.', key));
      var mdl = el('input', 'input'); mdl.setAttribute('list', 'models'); mdl.value = PREFS.model || P.models[0];
      var dl = el('datalist'); dl.id = 'models'; P.models.forEach(function (x) { var o = el('option'); o.value = x; dl.appendChild(o); });
      rows.push(field('Model', 'Pick one or type any model name.', mdl));
      var go = el('button', 'btn primary small', 'Save and test'); go.type = 'button';
      var out = el('div', 'status'); out.hidden = true;
      go.onclick = async function () {
        if (key.value.trim()) PREFS.key = key.value.trim();
        PREFS.model = mdl.value.trim() || undefined; PREFS.provider = pv; savePrefs();
        go.disabled = true; go.textContent = 'Testing…'; out.hidden = false; out.className = 'status'; out.textContent = 'Asking ' + P.maker + '…';
        var r = await api('/api/model/test', { provider: pv, model: PREFS.model }, 30000).catch(function (e) { return { ok: false, error: e.message }; });
        go.disabled = false; go.textContent = 'Save and test';
        if (r.ok) { out.className = 'status ok'; out.textContent = 'It answered. ' + r.label + ' (' + r.model + ') is ready.'; renderPill(); }
        else { out.className = 'status bad'; out.textContent = r.error || 'It did not work.'; }
      };
      var brow = el('div', 'inline'); brow.appendChild(go);
      if (PREFS.key) { var fk = el('button', 'btn quiet small', 'Remove my key'); fk.type = 'button'; fk.onclick = function () { delete PREFS.key; savePrefs(); renderPill(); renderSettings(); }; brow.appendChild(fk); }
      rows.push(brow);
      ai.appendChild(panelOf.apply(null, rows)); ai.appendChild(dl); ai.appendChild(out);
    }
    body.appendChild(ai);

    // Connections
    var cx = section('connections', 'Connections', 'Connect any MCP server. Its tools become actions on your card. Tacit reads the list of tools first and shows what each would cost; nothing is called until you approve, and anything that reaches outside still waits for your yes every time. Your connections are kept in this browser.');
    if (!SERVER) needsServer(cx);
    else if (STATUS.locked && !STATUS.unlocked) cx.appendChild(el('div', 'status', 'Enter the access code above to connect tools.'));
    else {
      if (PREFS.mcp.length) {
        var lst = el('div', 'panel rows');
        PREFS.mcp.forEach(function (m) {
          var r = el('div', 'tool');
          var l = el('div'); l.appendChild(el('b', '', m.name)); l.appendChild(el('small', '', ' ' + m.url));
          var actions = el('div', 'inline');
          var live = connections.some(function (c) { return c.id === m.id; });
          actions.appendChild(el('span', 'badge' + (live ? ' read' : ''), live ? 'connected' : 'not reachable'));
          var rm = el('button', 'link', 'Remove'); rm.type = 'button'; rm.onclick = function () { PREFS.mcp = PREFS.mcp.filter(function (x) { return x !== m; }); savePrefs(); location.reload(); };
          actions.appendChild(rm);
          r.append(l, actions); lst.appendChild(r);
        });
        cx.appendChild(lst);
      }
      if (connectionErrors.length) cx.appendChild(el('div', 'status bad', connectionErrors.join(' · ')));
      var u = el('input', 'input'); u.placeholder = 'https://your-server.example/mcp';
      var tok = el('input', 'input'); tok.type = 'password'; tok.placeholder = 'Token, if the server needs one (optional)';
      var add = el('button', 'btn small', 'Look at its tools'); add.type = 'button';
      var res = el('div', 'stack');
      add.onclick = async function () {
        add.disabled = true; add.textContent = 'Connecting…';
        var r = await api('/api/mcp/preview', { url: u.value.trim(), token: tok.value.trim() }, 30000).catch(function (e) { return { ok: false, error: e.message }; });
        add.disabled = false; add.textContent = 'Look at its tools';
        mcpPreview = r.ok ? Object.assign(r, { url: u.value.trim(), token: tok.value.trim() }) : r; renderMcpPreview(res);
      };
      cx.appendChild(panelOf(field('Server address', 'https, Streamable HTTP or SSE.', u), field('Token', null, tok), (function () { var d = el('div', 'inline'); d.appendChild(add); return d; })()));
      cx.appendChild(res); renderMcpPreview(res);
    }
    body.appendChild(cx);

    // Voice
    var vo = section('voice', 'Voice', (N ? 'Tacit uses your iPhone’s voice.' : (SR ? 'Tap the microphone to talk; hold it for hands-free.' : 'This browser can’t listen; typing works everywhere. Chrome or Edge can listen.')) + ' Tacit never listens while it speaks.');
    var vsel = el('select', 'input'); var none = el('option', '', 'System default'); none.value = ''; vsel.appendChild(none);
    try { speechSynthesis.getVoices().forEach(function (v) { var o = el('option', '', v.name + ' · ' + v.lang); o.value = v.name; if (v.name === store('tacit.voice')) o.selected = true; vsel.appendChild(o); }); } catch (e) {}
    vsel.onchange = function () { store('tacit.voice', vsel.value || null); };
    var tryv = el('button', 'btn small', 'Hear it'); tryv.type = 'button'; tryv.onclick = function () { audible('Hi. This is how I sound.'); };
    var vrow = el('div', 'inline'); vrow.append(vsel, tryv);
    vo.appendChild(panelOf(
      field('Speak replies', 'Answers are spoken as well as shown.', sw(t.settings.get('voice'), 'Speak replies', setting('voice'))),
      field('Voice', null, vrow),
      field('Speed', null, seg([['0.9', 'Calm'], ['1', 'Normal'], ['1.12', 'Brisk']], store('tacit.rate') || '1', function (v) { store('tacit.rate', v); renderSettings(); }))));
    body.appendChild(vo);

    // Notifications
    var no = section('notifications', 'Notifications', 'How the Desk protects your attention.');
    no.appendChild(panelOf(
      field('Quiet hours', 'From 10 p.m. to 7 a.m., only the people you named get through.', sw(t.settings.get('quiet_hours'), 'Quiet hours', setting('quiet_hours'))),
      field('Interruptions per hour', 'The most times anything but a person may interrupt you.', seg(OPTS.interruptions_per_hour, t.settings.get('interruptions_per_hour'), setting('interruptions_per_hour'))),
      field('Who may always reach you', (t.profile.people && t.profile.people.length) ? t.profile.people.join(', ') : 'Anyone you know, until you name people in conversation.', el('span'))));
    body.appendChild(no);

    // Briefing
    var br = section('briefing', 'Briefing', 'One briefing a day instead of a stream of alerts.');
    br.appendChild(panelOf(
      field('Ready at', 'It waits until you open it.', seg(OPTS.briefing_time, t.settings.get('briefing_time'), setting('briefing_time'))),
      field('Length', 'Read aloud at about 130 words a minute.', seg(OPTS.briefing_length, t.settings.get('briefing_length'), setting('briefing_length')))));
    body.appendChild(br);

    // World
    var wo = section('world', 'World feed', 'What the briefing knows about the world: conflict, markets, energy, cyber, climate and more, from World Monitor. Shared by everyone, and it is never told anything about you.');
    wo.appendChild(el('div', 'status' + (SERVER && STATUS.world ? ' ok' : ''), SERVER && STATUS.world ? 'World Monitor is connected on this site.' : 'Using the sample feed. The site owner adds a World Monitor key to turn on the real one.'));
    body.appendChild(wo);

    // Permissions
    var pe = section('permissions', 'Permissions', 'What may happen without you.');
    var lockTag = el('span', 'lock', 'Never changed by silence');
    pe.appendChild(panelOf(field('Act while I am away', 'Lets standing orders run when you are not there. Money and anything outside always wait for you.', sw(t.settings.get('act_while_away'), 'Act while I am away', setting('act_while_away')), lockTag)));
    body.appendChild(pe);

    // Appearance
    var ap = section('appearance', 'Appearance');
    ap.appendChild(panelOf(field('Theme', null, seg([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], store('tacit.theme') || 'system', function (v) { store('tacit.theme', v === 'system' ? null : v); applyTheme(); renderSettings(); }))));
    body.appendChild(ap);

    // Privacy
    var pr = section('privacy', 'Privacy', 'What Tacit knows about you, your own key and your connections all live in this browser. The server keeps nothing about you, and nothing about you goes into the shared world feed.');
    var ex = el('button', 'btn small', 'Export everything'); ex.type = 'button';
    ex.onclick = function () {
      var data = JSON.stringify({ exported: new Date().toISOString(), person: t.snapshot(), profile: t.profile, settings: t.settings.changes(), tuning: marks(), transcript: transcript }, null, 2);
      try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = 'tacit-export.json'; a.click(); } catch (e) {}
      try { navigator.clipboard.writeText(data); ex.textContent = 'Exported (also copied)'; } catch (e) { ex.textContent = 'Exported'; }
    };
    var fz = el('button', 'btn small danger', 'Forget everything'); fz.type = 'button';
    fz.onclick = function () { confirmForget = true; renderSettings(); };
    var prow = el('div', 'inline'); prow.append(ex, fz);
    pr.appendChild(panelOf(prow));
    // The passphrase lock.
    var lk = el('div', 'stack');
    if (vault && vault.exists) {
      lk.appendChild(el('p', '', 'Locked with a passphrase. Everything Tacit keeps here is encrypted on this device, and it locks again after 15 quiet minutes.'));
      var now = el('button', 'btn small', 'Lock now'); now.type = 'button'; now.onclick = function () { location.reload(); };
      lk.appendChild(now);
    } else if (vault) {
      lk.appendChild(el('p', '', 'Lock what Tacit keeps with a passphrase. It is encrypted on this device and never leaves it. If you forget the passphrase, nothing can open it: export first if you want a copy.'));
      var p1 = el('input'); p1.type = 'password'; p1.placeholder = 'New passphrase (8+ characters)'; p1.autocomplete = 'new-password';
      var p2 = el('input'); p2.type = 'password'; p2.placeholder = 'Same again'; p2.autocomplete = 'new-password';
      var go = el('button', 'btn small primary', 'Lock with this passphrase'); go.type = 'button'; var lm = el('span', 'eyebrow', '');
      go.onclick = async function () {
        if (p1.value.length < 8) { lm.textContent = 'Use at least 8 characters.'; return; }
        if (p1.value !== p2.value) { lm.textContent = 'The two don’t match.'; return; }
        go.disabled = true; lm.textContent = 'Locking…';
        try {
          VAULTED.forEach(function (k) { var raw = localStorage.getItem(k); if (raw !== null) plain[k] = raw; });
          await vault.create(p1.value);
          for (var n = 0; n < VAULTED.length; n++) if (VAULTED[n] in plain) await vault.put(VAULTED[n], plain[VAULTED[n]]);
          lm.textContent = 'Locked.'; renderSettings();
        } catch (x) { lm.textContent = 'Could not lock: ' + (x && x.message ? x.message : 'unknown'); go.disabled = false; }
      };
      var lrow = el('div', 'inline'); lrow.append(p1, p2, go); lk.append(lrow, lm);
    } else {
      lk.appendChild(el('p', '', 'This browser cannot encrypt, so Tacit cannot lock here.'));
    }
    pr.appendChild(panelOf(lk));
    if (confirmForget) {
      var cf = el('div', 'confirm'); cf.appendChild(el('span', '', 'This erases everything Tacit has learned in this browser. It cannot be undone.'));
      var yes = el('button', 'btn small danger', 'Erase it'); yes.type = 'button';
      yes.onclick = function () { VAULTED.concat(['tacit.welcomed', 'tacit.vault']).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} }); location.reload(); };
      var no2 = el('button', 'btn small quiet', 'Keep it'); no2.type = 'button'; no2.onclick = function () { confirmForget = false; renderSettings(); };
      cf.append(yes, no2); pr.appendChild(cf);
    }
    body.appendChild(pr);

    // About
    var ab = section('about', 'About');
    var log2 = t.settings.changes().slice(-6).reverse().map(function (c) { return hhmm(c.at) + '  ' + c.key + ': ' + c.from + ' → ' + c.to + '  (' + c.by + ')'; }).join('\n');
    ab.appendChild(panelOf(
      field('Tacit', 'Version 0.1 · by Kairos · ' + (SERVER ? (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'running on your computer' : 'running on ' + location.hostname) : 'preview, running in this page'), el('span')),
      field('Recent changes', null, el('div', 'code', log2 || 'None yet.'))));
    body.appendChild(ab);
    window.scrollTo(0, keepY);
  }
  function renderMcpPreview(box) {
    box.replaceChildren();
    if (!mcpPreview) return;
    if (!mcpPreview.ok) { box.appendChild(el('div', 'status bad', mcpPreview.error || 'Could not connect.')); return; }
    box.appendChild(el('b', '', (mcpPreview.name || 'This server') + ' offers ' + mcpPreview.tools.length + ' tools:'));
    var lst = el('div', 'panel rows');
    mcpPreview.tools.slice(0, 40).forEach(function (tl) {
      var r = el('div', 'tool'); r.appendChild(el('b', '', tl.name));
      r.appendChild(el('span', 'badge ' + (tl.radius === 'read' ? 'read' : 'external'), tl.radius === 'read' ? 'reads only' : 'asks you every time'));
      if (tl.description) r.appendChild(el('small', '', tl.description));
      lst.appendChild(r);
    });
    box.appendChild(lst);
    var ok = el('button', 'btn primary small', 'Approve this server'); ok.type = 'button';
    ok.onclick = function () {
      var id = String(mcpPreview.name || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'server';
      while (PREFS.mcp.some(function (x) { return x.id === id; })) id += '2';
      PREFS.mcp.push({ id: id, name: mcpPreview.name || id, url: mcpPreview.url, token: mcpPreview.token || undefined }); savePrefs(); location.reload();
    };
    var no = el('button', 'btn quiet small', 'Don’t'); no.type = 'button';
    no.onclick = function () { mcpPreview = null; renderSettings(); };
    var row = el('div', 'inline'); row.append(ok, no); box.appendChild(row);
  }

  // ------------------------------------------------------------ chrome
  function renderPill() {
    var p = $('pill-model');
    p.className = 'pill' + (hasModel() ? ' on' : SERVER ? '' : ' demo');
    p.lastChild.textContent = hasModel() ? modelLabel() : SERVER ? (STATUS.locked && !STATUS.unlocked ? 'Enter access code' : 'No AI yet: connect one') : 'Preview mode';
  }
  $('pill-model').onclick = function () { show('settings'); setTimeout(function () { var a = $('s-ai'); if (a) a.scrollIntoView({ behavior: 'smooth' }); }, 60); };
  function renderBadges() {
    var waiting = decided.filter(function (d) { return d.delivery !== 'now'; }).length;
    $('c-desk').textContent = waiting ? String(waiting) : '';
    var c = t.person.coverage().overall;
    $('c-you').textContent = c ? Math.round(c * 100) + '%' : '';
    $('clock').textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + (t.settings.get('quiet_hours') ? ' · quiet hours' : '');
  }
  var current = 'talk';
  function show(v) {
    if (v !== 'morning' && reader) briefEnd();
    // Any other screen is the full app: voice-only belongs to Talk.
    if (v !== 'talk' && document.body.classList.contains('voice')) { document.body.classList.remove('voice'); $('stage').removeAttribute('nomenu'); $('voice-toggle').textContent = 'Voice only'; }
    if (v === 'desk' && current !== 'desk') { deskDeck = null; deskDismissed = false; }
    current = v;
    document.querySelectorAll('[data-v]').forEach(function (b) { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    ['talk', 'desk', 'morning', 'you', 'library', 'settings'].forEach(function (k) { $('v-' + k).hidden = k !== v; });
    window.scrollTo(0, 0);
    renderAll();
    if (v === 'talk') setTimeout(function () { $('q').focus({ preventScroll: true }); }, 30);
  }
  document.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { show(b.dataset.v); }; });
  function renderAll() {
    renderPill(); renderBadges(); renderLearned(); renderNotes(); renderKept();
    if (current === 'desk') renderDesk();
    if (current === 'morning') renderMorning();
    if (current === 'you') renderYou();
    if (current === 'library') renderLibrary();
    if (current === 'settings') renderSettings();
  }
  try { speechSynthesis.onvoiceschanged = function () { if (current === 'settings') renderSettings(); }; } catch (e) {}
  setInterval(renderBadges, 30000);

  // ------------------------------------------------------------ start
  function begin() {
    store('tacit.welcomed', '1');
    $('welcome').hidden = true;
    show('talk');
    if (store('tacit.mode') !== 'full') setVoice(true);
    var first = t.open(); lastLine = first;
    speak(first.say);
  }
  $('w-start').onclick = begin;
  $('w-connect').onclick = function () { store('tacit.welcomed', '1'); $('welcome').hidden = true; show('settings'); setTimeout(function () { var a = $('s-ai'); if (a) a.scrollIntoView(); }, 60); };
  await t.refresh().catch(function () {});
  var tok = (location.hash || '').slice(1);
  if (['desk', 'morning', 'you', 'library', 'settings'].indexOf(tok) >= 0) { store('tacit.welcomed', '1'); show(tok); }
  else if (!store('tacit.welcomed')) { $('welcome').hidden = false; renderAll(); }
  else begin();
})();
</script>
