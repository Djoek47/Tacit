<script>
(async function () {
  'use strict';
  var T = window.Tacit;
  T.defineStageElement();
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function hhmm(at) { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  // ------------------------------------------------------------ theme
  function applyTheme() { var th = store('tacit.theme'); if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme; }
  applyTheme();

  // ------------------------------------------------------------ server
  // Served by `npm run tacit`, the page has a server: your model, your
  // connections, the real world feed. Opened anywhere else, it runs on its own.
  var STATUS = null;
  async function api(path, body, ms) {
    var ctl = new AbortController(); var timer = setTimeout(function () { ctl.abort(); }, ms || 15000);
    try {
      var r = await fetch(path, body === undefined ? { cache: 'no-store', signal: ctl.signal } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok && !j.error) j.error = 'the server answered ' + r.status;
      return j;
    } finally { clearTimeout(timer); }
  }
  if (/^https?:$/.test(location.protocol)) {
    try { var s0 = await api('/api/status', undefined, 2500); if (s0 && s0.providers) STATUS = s0; } catch (e) { STATUS = null; }
  }
  var SERVER = !!STATUS;
  function hasModel() { return !!(STATUS && STATUS.model); }

  // ------------------------------------------------------------ connections
  // Each approved MCP server is reached through the Tacit server; this stand-in
  // client gives the bridge exactly the calls it needs, nothing else.
  function proxyClient(id) {
    var caps = null, ver = null;
    function rpc(method, params) {
      return api('/api/mcp/' + id + '/rpc', { method: method, params: params }, 30000).then(function (j) { if (j.error) throw new Error(j.error); return j.result; });
    }
    return {
      prime: async function () { caps = await rpc('getServerCapabilities'); ver = await rpc('getServerVersion'); },
      getServerCapabilities: function () { return caps || {}; },
      getServerVersion: function () { return ver || { name: id, version: '0' }; },
      listTools: function (p) { return rpc('listTools', p || {}); },
      callTool: function (p) { return rpc('callTool', p); },
      readResource: function (p) { return rpc('readResource', p); },
    };
  }
  var connections = [], connectionErrors = [];
  if (SERVER) {
    for (var mi = 0; mi < STATUS.mcp.length; mi++) {
      var m = STATUS.mcp[mi];
      if (!m.approved) continue;
      try {
        var pc = proxyClient(m.id); await pc.prime();
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
  function audible(text) {
    if (!voiceOn()) { orb('idle'); return; }
    if (N) { post({ type: 'speak', text: text }); return; }
    try {
      if (!window.speechSynthesis) { orb('idle'); return; }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      var v = pickVoice(); if (v) u.voice = v;
      u.rate = Number(store('tacit.rate') || 1);
      u.onstart = function () { orb('speaking'); };
      u.onend = u.onerror = function () { orb('idle'); if (handsFree) setTimeout(listen, 250); };
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
  function log(who, text) {
    var box = $('log'); box.appendChild(el('div', 'msg ' + who, text));
    while (box.children.length > 60) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------ Tacit
  var saved = null; try { saved = JSON.parse(store('tacit.person') || 'null'); } catch (e) {}
  var recent = [];
  t = T.createTacit({
    profile: { interests: ['markets', 'ai', 'cyber'] },
    restore: saved || undefined,
    world: [served],
    speak: function (s) { speak(s, 'answer'); },
    el: $('stage'),
    sources: { connections: connections },
  });
  try { var over = JSON.parse(store('tacit.profile') || 'null'); if (over) t.updateProfile(over); } catch (e) {}
  function save() { store('tacit.person', JSON.stringify(t.snapshot())); }

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
  var decided = [];
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
      var d = t.receive(full); decided.unshift(d);
      if (d.delivery === 'now') log('note', 'Notification: ' + full.title);
      renderDesk(); renderBadges();
    };
    $('incoming').appendChild(b);
  });
  function renderDesk() {
    var box = $('desk'); box.replaceChildren();
    if (!decided.length) { box.appendChild(el('p', 'empty', 'Nothing has arrived yet. Send one below to see what the Desk does with it.')); return; }
    decided.forEach(function (d) {
      var r = el('div', 'notice');
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
        d.appendChild(el('div', 'why', it.why.indexOf(it.source) >= 0 ? it.why : it.why + ' · ' + it.source));
        col.appendChild(d);
      });
      box.appendChild(col);
    });
    $('m-source').textContent = 'World: ' + (worldSource === 'sample' ? 'sample feed (connect World Monitor in Settings for the real one)' : 'World Monitor');
  }
  $('m-play').onclick = function () { show('talk'); say('brief me'); };

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
    if (shownHow) { box.appendChild(el('div', 'status', 'Needs Tacit running on your computer: see AI model above.')); return; }
    shownHow = true;
    box.appendChild(el('div', 'status', 'This part needs Tacit running on your computer, where your keys stay private. You need Git and Node.js 20 or newer; nothing else to install.'));
    box.appendChild(el('div', 'code', 'git clone https://github.com/Djoek47/tacit\ncd tacit\nnpm run tacit\n\nthen open  http://127.0.0.1:7373'));
  }

  var aiDraft = { provider: (STATUS && STATUS.model && STATUS.model.provider) || 'anthropic' };
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
    var ai = section('ai', 'AI model', 'Bring your own: Claude, GPT or Grok. Tacit’s conversation decides what to ask; your model decides how to say it, answers your questions, and writes clean notes of what you said.');
    if (!SERVER) needsServer(ai);
    else {
      var st = el('div', 'status' + (STATUS.model ? ' ok' : ''), STATUS.model ? 'Connected: ' + STATUS.model.label + ' · ' + STATUS.model.model + (STATUS.model.from === 'environment' ? ' (from your environment)' : '') : 'No model connected. Tacit still talks, in plainer words.');
      ai.appendChild(st);
      var prov = STATUS.providers;
      var provSeg = seg(Object.keys(prov).map(function (k) { return [k, prov[k].label + ' · ' + prov[k].maker]; }), aiDraft.provider, function (k) { aiDraft.provider = k; renderSettings(); });
      var key = el('input', 'input'); key.type = 'password'; key.autocomplete = 'off'; key.placeholder = prov[aiDraft.provider].keyHint + (STATUS.model && STATUS.model.provider === aiDraft.provider ? '  (saved — leave empty to keep it)' : '');
      var mdl = el('input', 'input'); mdl.setAttribute('list', 'models'); mdl.value = (STATUS.model && STATUS.model.provider === aiDraft.provider) ? STATUS.model.model : prov[aiDraft.provider].models[0];
      var dl = el('datalist'); dl.id = 'models'; prov[aiDraft.provider].models.forEach(function (m) { var o = el('option'); o.value = m; dl.appendChild(o); });
      var go = el('button', 'btn primary small', 'Connect and test'); go.type = 'button';
      var out = el('div', 'status'); out.hidden = true;
      go.onclick = async function () {
        go.disabled = true; go.textContent = 'Testing…'; out.hidden = false; out.className = 'status'; out.textContent = 'Asking ' + prov[aiDraft.provider].maker + '…';
        var r = await api('/api/model', { provider: aiDraft.provider, key: key.value, model: mdl.value }, 30000).catch(function (e) { return { ok: false, error: e.message }; });
        go.disabled = false; go.textContent = 'Connect and test';
        if (r.ok) { STATUS = r.status; out.className = 'status ok'; out.textContent = 'It answered. ' + prov[aiDraft.provider].label + ' is connected.'; renderPill(); setTimeout(renderSettings, 900); }
        else { out.className = 'status bad'; out.textContent = r.error || 'It did not work.'; }
      };
      var row = el('div', 'inline'); row.appendChild(go);
      if (STATUS.model && STATUS.model.from === 'settings') {
        var forget = el('button', 'btn quiet small', 'Disconnect'); forget.type = 'button';
        forget.onclick = async function () { STATUS = await api('/api/model/forget', {}); renderPill(); renderSettings(); };
        row.appendChild(forget);
      }
      ai.appendChild(panelOf(field('Provider', null, provSeg), field('API key', 'Kept on your computer, in a file only you can read. Never sent to this page.', key), field('Model', 'Pick one or type any model name your key can use.', mdl), row));
      ai.appendChild(dl); ai.appendChild(out);
    }
    body.appendChild(ai);

    // Connections
    var cx = section('connections', 'Connections', 'Connect any MCP server. Its tools become actions on your card. Tacit reads the list of tools first and shows you what each would cost; nothing is called until you approve the server, and anything that reaches outside still waits for your yes every time.');
    if (!SERVER) needsServer(cx);
    else {
      if (STATUS.mcp.length) {
        var lst = el('div', 'panel rows');
        STATUS.mcp.forEach(function (m) {
          var r = el('div', 'tool');
          var l = el('div'); l.appendChild(el('b', '', m.name)); l.appendChild(el('small', '', ' ' + m.url));
          var actions = el('div', 'inline');
          actions.appendChild(el('span', 'badge' + (m.approved ? ' read' : ''), m.approved ? (m.tools + ' tools · approved') : 'not approved'));
          var rm = el('button', 'link', 'Remove'); rm.type = 'button'; rm.onclick = async function () { STATUS = await api('/api/mcp/remove', { id: m.id }); renderSettings(); };
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
        var r = await api('/api/mcp/add', { url: u.value, token: tok.value }, 30000).catch(function (e) { return { ok: false, error: e.message }; });
        add.disabled = false; add.textContent = 'Look at its tools';
        mcpPreview = r; renderMcpPreview(res);
      };
      cx.appendChild(panelOf(field('Server address', 'Streamable HTTP or SSE.', u), field('Token', null, tok), (function () { var d = el('div', 'inline'); d.appendChild(add); return d; })()));
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
    if (!SERVER) needsServer(wo);
    else {
      wo.appendChild(el('div', 'status' + (STATUS.world ? ' ok' : ''), STATUS.world ? 'World Monitor is connected.' : 'Using the sample feed.'));
      var wk = el('input', 'input'); wk.type = 'password'; wk.placeholder = 'World Monitor API key';
      var wsave = el('button', 'btn small', 'Save'); wsave.type = 'button';
      wsave.onclick = async function () { STATUS = await api('/api/world/key', { key: wk.value }); wsave.textContent = 'Saved — reload to use it'; };
      var wrow = el('div', 'inline'); wrow.append(wk, wsave);
      wo.appendChild(panelOf(field('API key', 'Stays on your computer.', wrow)));
    }
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
    var pr = section('privacy', 'Privacy', 'What Tacit knows about you lives in this browser' + (SERVER ? ', and your keys in a private file on this computer.' : '.') + ' Nothing about you goes into the shared world feed.');
    var ex = el('button', 'btn small', 'Export everything'); ex.type = 'button';
    ex.onclick = function () {
      var data = JSON.stringify({ exported: new Date().toISOString(), person: t.snapshot(), profile: t.profile, settings: t.settings.changes() }, null, 2);
      try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = 'tacit-export.json'; a.click(); } catch (e) {}
      try { navigator.clipboard.writeText(data); ex.textContent = 'Exported (also copied)'; } catch (e) { ex.textContent = 'Exported'; }
    };
    var fz = el('button', 'btn small danger', 'Forget everything'); fz.type = 'button';
    fz.onclick = function () { confirmForget = true; renderSettings(); };
    var prow = el('div', 'inline'); prow.append(ex, fz);
    pr.appendChild(panelOf(prow));
    if (confirmForget) {
      var cf = el('div', 'confirm'); cf.appendChild(el('span', '', 'This erases everything Tacit has learned in this browser. It cannot be undone.'));
      var yes = el('button', 'btn small danger', 'Erase it'); yes.type = 'button';
      yes.onclick = function () { ['tacit.person', 'tacit.profile', 'tacit.welcomed'].forEach(function (k) { store(k, null); }); location.reload(); };
      var no2 = el('button', 'btn small quiet', 'Keep it'); no2.type = 'button'; no2.onclick = function () { confirmForget = false; renderSettings(); };
      cf.append(yes, no2); pr.appendChild(cf);
    }
    body.appendChild(pr);

    // About
    var ab = section('about', 'About');
    var log2 = t.settings.changes().slice(-6).reverse().map(function (c) { return hhmm(c.at) + '  ' + c.key + ': ' + c.from + ' → ' + c.to + '  (' + c.by + ')'; }).join('\n');
    ab.appendChild(panelOf(
      field('Tacit', 'Version 0.1 · by Kairos · ' + (SERVER ? 'running on your computer' : 'preview, running in this page'), el('span')),
      field('Recent changes', null, el('div', 'code', log2 || 'None yet.'))));
    body.appendChild(ab);
    window.scrollTo(0, keepY);
  }
  function renderMcpPreview(box) {
    box.replaceChildren();
    if (!mcpPreview) return;
    if (!mcpPreview.ok) { box.appendChild(el('div', 'status bad', mcpPreview.error || 'Could not connect.')); return; }
    box.appendChild(el('b', '', (mcpPreview.name || mcpPreview.id) + ' offers ' + mcpPreview.tools.length + ' tools:'));
    var lst = el('div', 'panel rows');
    mcpPreview.tools.slice(0, 40).forEach(function (tl) {
      var r = el('div', 'tool'); r.appendChild(el('b', '', tl.name));
      r.appendChild(el('span', 'badge ' + (tl.radius === 'read' ? 'read' : 'external'), tl.radius === 'read' ? 'reads only' : 'asks you every time'));
      if (tl.description) r.appendChild(el('small', '', tl.description));
      lst.appendChild(r);
    });
    box.appendChild(lst);
    var ok = el('button', 'btn primary small', 'Approve this server'); ok.type = 'button';
    ok.onclick = async function () { await api('/api/mcp/approve', { id: mcpPreview.id }); location.reload(); };
    var no = el('button', 'btn quiet small', 'Don’t'); no.type = 'button';
    no.onclick = async function () { STATUS = await api('/api/mcp/remove', { id: mcpPreview.id }); mcpPreview = null; renderSettings(); };
    var row = el('div', 'inline'); row.append(ok, no); box.appendChild(row);
  }

  // ------------------------------------------------------------ chrome
  function renderPill() {
    var p = $('pill-model');
    p.className = 'pill' + (hasModel() ? ' on' : SERVER ? '' : ' demo');
    p.lastChild.textContent = hasModel() ? STATUS.model.label + ' · ' + STATUS.model.model : SERVER ? 'No AI yet: connect one' : 'Preview mode';
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
    current = v;
    document.querySelectorAll('[data-v]').forEach(function (b) { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    ['talk', 'desk', 'morning', 'you', 'settings'].forEach(function (k) { $('v-' + k).hidden = k !== v; });
    window.scrollTo(0, 0);
    renderAll();
    if (v === 'talk') setTimeout(function () { $('q').focus({ preventScroll: true }); }, 30);
  }
  document.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { show(b.dataset.v); }; });
  function renderAll() {
    renderPill(); renderBadges(); renderLearned();
    if (current === 'desk') renderDesk();
    if (current === 'morning') renderMorning();
    if (current === 'you') renderYou();
    if (current === 'settings') renderSettings();
  }
  try { speechSynthesis.onvoiceschanged = function () { if (current === 'settings') renderSettings(); }; } catch (e) {}
  setInterval(renderBadges, 30000);

  // ------------------------------------------------------------ start
  function begin() {
    store('tacit.welcomed', '1');
    $('welcome').hidden = true;
    show('talk');
    var first = t.open(); lastLine = first;
    speak(first.say);
  }
  $('w-start').onclick = begin;
  $('w-connect').onclick = function () { store('tacit.welcomed', '1'); $('welcome').hidden = true; show('settings'); setTimeout(function () { var a = $('s-ai'); if (a) a.scrollIntoView(); }, 60); };
  await t.refresh().catch(function () {});
  var tok = (location.hash || '').slice(1);
  if (['desk', 'morning', 'you', 'settings'].indexOf(tok) >= 0) { store('tacit.welcomed', '1'); show(tok); }
  else if (!store('tacit.welcomed')) { $('welcome').hidden = false; renderAll(); }
  else begin();
})();
</script>
