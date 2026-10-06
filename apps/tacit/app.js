<script>
(function () {
  'use strict';
  var T = window.Tacit;
  T.defineStageElement();
  var $ = function (id) { return document.getElementById(id); };
  var H = 3600000, now = Date.now();

  // A sample world, so the page is whole without a server. On the iPhone app
  // this comes from World Monitor through the Tacit server; the key never ships here.
  var SAMPLE = [
    ['trading', 'Sample market item: crude oil supply outlook for the quarter'],
    ['trading', 'Sample market item: central bank rate decision due this week'],
    ['trading', 'Sample market item: currency volatility in emerging markets'],
    ['ai', 'Sample tech item: a model release and what it changes for developers'],
    ['ai', 'Sample tech item: chip export rules and supply'],
    ['climate', 'Sample world item: air quality advisory in a large city'],
    ['cyber', 'Sample world item: a widely used library patches a flaw'],
  ];
  var world = { name: 'sample world', pull: function () {
    return Promise.resolve(SAMPLE.map(function (s, i) {
      return { id: 'w' + i, source: 'sample world', title: s[1], topics: [s[0]], at: now - (i + 1) * H };
    }));
  } };

  var said = $('said');
  function line(cls, text) {
    var p = document.createElement('div'); p.className = cls; p.textContent = text; said.appendChild(p);
    while (said.children.length > 6) said.removeChild(said.firstChild);
  }
  function speak(text) {
    line('reply', text);
    try {
      if (window.speechSynthesis) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
    } catch (e) { /* the caption is the reply; the voice is a bonus */ }
  }

  // Served by the Tacit server, the world is real and the key stays there. Opened
  // anywhere else, the page falls back to the labelled sample.
  var served = /^https?:$/.test(location.protocol) ? { name: 'World Monitor', pull: function () {
    return fetch('/api/world', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (b) { return b.items; })
      .catch(function () { return world.pull(); });
  } } : world;

  var t = T.createTacit({
    profile: { interests: ['trading', 'ai', 'cyber'] },
    world: [served], speak: speak, el: $('stage'),
  });

  // ---- Talk
  var TRIES = ['brief me', 'what did I miss', 'turn off quiet hours', 'make the briefing short', 'interruptions per hour one', "don't brief me"];
  TRIES.forEach(function (s) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = s;
    b.onclick = function () { say(s); }; $('tries').appendChild(b);
  });
  function say(text) {
    if (!text.trim()) return;
    line('bubble', text);
    if (iv) { ivShow(iv.answer(text)); return; }
    var r = t.hear(text, { final: true });
    if (!r || !r.decision || r.decision.kind === 'none') line('reply', 'Nothing I can do matches that yet. Try one of these.');
    setTimeout(renderAll, 50);
  }
  $('ask').addEventListener('submit', function (e) { e.preventDefault(); var q = $('q'); say(q.value); q.value = ''; });

  // ---- The first conversation
  var iv = null;
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function ivStart() { iv = t.interview(); show('talk'); ivShow(iv.step()); }
  function ivEnd() { iv = null; $('iv').hidden = true; $('hello').hidden = false; $('intro').hidden = false; $('tries').hidden = false; $('q').placeholder = 'brief me'; store('tacit.met', '1'); }
  function ctl(label, words, primary) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (primary ? ' primary' : '');
    b.textContent = label; b.onclick = function () { say(words); }; $('iv-ctl').appendChild(b);
  }
  function ivShow(s) {
    $('iv').hidden = false; $('hello').hidden = true; $('intro').hidden = true; $('tries').hidden = true; $('q').placeholder = 'Your answer'; $('iv-ctl').replaceChildren(); $('iv-sum').hidden = true;
    if (s.kind === 'ask') {
      $('iv-n').textContent = (s.index + 1) + ' of ' + s.of + ' · first conversation';
      $('iv-q').textContent = s.ask; $('iv-h').textContent = s.hint;
      speakQuiet(s.ask);
      ctl('Skip', 'skip'); if (s.index > 0) ctl('Back', 'go back'); ctl('Stop', 'stop');
      $('q').focus();
    } else if (s.kind === 'confirm') {
      $('iv-n').textContent = 'Did I hear you right?';
      $('iv-q').textContent = 'Here is what I will remember.';
      $('iv-h').textContent = 'Nothing changes until you say yes.';
      var ul = $('iv-sum'); ul.replaceChildren(); ul.hidden = false;
      s.summary.forEach(function (x) { var li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
      speakQuiet(s.summary.join(' ') + ' Is that right?');
      ctl('Yes, that is right', 'yes', true); ctl('No, go back', 'no');
    } else if (s.kind === 'done') {
      t.learn(s.learned); ivEnd();
      line('reply', (t.profile.name ? 'Thank you, ' + t.profile.name + '. ' : 'Thank you. ') + 'Say “brief me” whenever you want your briefing.');
      renderAll();
    } else { ivEnd(); line('reply', 'Stopped. Nothing was changed. You can do it again from Settings.'); }
  }
  // Questions are spoken through the same voice setting as every reply, without filling the transcript.
  function speakQuiet(text) {
    if (!t.settings.get('voice')) return;
    try { if (window.speechSynthesis) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } } catch (e) {}
  }
  $('redo').onclick = ivStart;

  // ---- Desk
  var decided = [];
  function hhmm(at) { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  var INCOMING = [
    { label: 'Bank: card used abroad', n: { from: 'app:bank', title: 'Card used abroad', body: 'A payment in another country.', topics: ['money'], urgency: 0.95 } },
    { label: 'A person messages you', n: { from: 'person:sylla', title: 'Sylla: are you up?', topics: ['people'], urgency: 0.6 } },
    { label: 'Newsletter', n: { from: 'app:news', title: 'Weekly digest is out', topics: ['reading'], urgency: 0.1 } },
    { label: 'Calendar reminder', n: { from: 'app:calendar', title: 'Call at 9:30', topics: ['calendar'], urgency: 0.5 } },
  ];
  var nid = 0;
  function receive(n) {
    var full = Object.assign({ id: 'n' + (++nid), at: Date.now() }, n);
    var d = t.receive(full);
    decided.unshift(d);
    if (d.delivery === 'now') speak('Now: ' + full.title);
    renderAll();
  }
  INCOMING.forEach(function (x) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = x.label;
    b.onclick = function () { receive(x.n); }; $('incoming').appendChild(b);
  });
  function renderDesk() {
    var box = $('desk'); box.replaceChildren();
    if (!decided.length) { var e = document.createElement('div'); e.className = 'row'; e.innerHTML = '<span></span><span class="w">Nothing has arrived yet. Send a test notice below.</span><span></span>'; box.appendChild(e); }
    decided.forEach(function (d) {
      var r = document.createElement('div'); r.className = 'row';
      var dot = document.createElement('i'); dot.className = 'dot ' + d.delivery;
      var mid = document.createElement('div');
      var a = document.createElement('div'); a.className = 't'; a.textContent = d.notice.title;
      var w = document.createElement('div'); w.className = 'w'; w.textContent = d.why;
      mid.append(a, w);
      var at = document.createElement('span'); at.className = 'at'; at.textContent = hhmm(d.notice.at);
      r.append(dot, mid, at); box.appendChild(r);
    });
    var waiting = decided.filter(function (d) { return d.delivery !== 'now'; }).length;
    $('b-desk').textContent = waiting ? String(waiting) : '';
  }

  // ---- Morning
  function renderMorning() {
    var p = { interests: t.profile.interests, minutes: Number(t.settings.get('briefing_length')) };
    var b = T.brief(p, t.desk, t.context, Date.now());
    $('m-lede').textContent = 'What waits for you, what is around you, and what moved in what you follow. Ready at ' +
      t.settings.screen().flatMap(function (s) { return s.items; }).find(function (i) { return i.key === 'briefing_time'; }).display +
      '; it never starts talking by itself.';
    $('m-meter').textContent = 'About ' + Math.max(1, Math.round(b.minutes)) + ' min · ' + b.words + ' words' + (b.leftOut ? ' · ' + b.leftOut + ' left out for length' : '');
    var box = $('m-body'); box.replaceChildren();
    if (!b.sections.length) { var e = document.createElement('p'); e.className = 'lede'; e.textContent = 'Nothing needs you, and nothing moved in what you follow.'; box.appendChild(e); }
    b.sections.forEach(function (s) {
      var sec = document.createElement('div'); sec.className = 'sec';
      var h = document.createElement('h2'); h.textContent = s.name; sec.appendChild(h);
      s.items.forEach(function (it) {
        var d = document.createElement('div'); d.className = 'item';
        var a = document.createElement('div'); a.textContent = it.title;
        var w = document.createElement('div'); w.className = 'why'; w.textContent = it.why.indexOf(it.source) >= 0 ? it.why : it.why + ' · ' + it.source;
        d.append(a, w); sec.appendChild(d);
      });
      box.appendChild(sec);
    });
    $('m-play').onclick = function () { say('brief me'); show('talk'); };
  }

  // ---- Settings
  function renderSettings() {
    var body = $('s-body'); body.replaceChildren();
    var defs = {};
    t.settings.screen().forEach(function (sec) {
      var g = document.createElement('div'); g.className = 'group';
      var h = document.createElement('span'); h.className = 'eyebrow'; h.textContent = sec.section; g.appendChild(h);
      var list = document.createElement('div'); list.className = 'list';
      sec.items.forEach(function (it) {
        var row = document.createElement('div'); row.className = 'set';
        var left = document.createElement('div');
        var l = document.createElement('div'); l.style.fontWeight = '700'; l.textContent = it.label;
        var d = document.createElement('div'); d.className = 'd'; d.textContent = it.describe;
        left.append(l, d);
        if (it.locked) { var k = document.createElement('div'); k.className = 'lock'; k.textContent = 'Never changed by silence'; left.appendChild(k); }
        var ctl;
        if (typeof it.value === 'boolean') {
          ctl = document.createElement('button'); ctl.type = 'button'; ctl.className = 'switch'; ctl.setAttribute('role', 'switch');
          ctl.setAttribute('aria-checked', String(it.value)); ctl.setAttribute('aria-label', it.label);
          ctl.onclick = function () { t.settings.set(it.key, !it.value, 'screen'); renderAll(); };
        } else {
          ctl = document.createElement('div'); ctl.className = 'seg'; ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', it.label);
          (OPTS[it.key] || []).forEach(function (o) {
            var b = document.createElement('button'); b.type = 'button'; b.textContent = o.label;
            b.setAttribute('aria-pressed', String(o.value === it.value));
            b.onclick = function () { t.settings.set(it.key, o.value, 'screen'); renderAll(); };
            ctl.appendChild(b);
          });
        }
        row.append(left, ctl); list.appendChild(row);
      });
      g.appendChild(list); body.appendChild(g);
    });
    var ch = t.settings.changes();
    $('s-log').replaceChildren();
    if (!ch.length) $('s-log').textContent = 'Nothing yet.';
    ch.slice(-8).reverse().forEach(function (c) {
      var d = document.createElement('div');
      d.textContent = hhmm(c.at) + '  ' + c.key + ': ' + c.from + ' → ' + c.to + '  (by ' + c.by + ')';
      $('s-log').appendChild(d);
    });
  }
  var OPTS = {
    interruptions_per_hour: [{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 6, label: '6' }],
    briefing_time: [{ value: 'off', label: 'Off' }, { value: '06:00', label: '6:00' }, { value: '07:00', label: '7:00' }, { value: '08:00', label: '8:00' }],
    briefing_length: [{ value: 5, label: 'Short' }, { value: 15, label: 'Standard' }, { value: 20, label: 'Long' }],
  };

  // ---- Tabs
  function show(v) {
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.v === v)); });
    ['talk', 'desk', 'morning', 'settings'].forEach(function (k) { $('v-' + k).hidden = k !== v; });
    renderAll();
  }
  document.querySelectorAll('nav.tabs button').forEach(function (b) { b.onclick = function () { show(b.dataset.v); }; });

  function renderAll() {
    $('clock').textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) +
      (t.settings.get('quiet_hours') ? ' · quiet hours on' : '');
    renderDesk(); renderMorning(); renderSettings();
  }
  // The stage commits on silence with a real clock; redraw the other views when it does.
  var sig = '';
  setInterval(function () {
    var s = t.settings.changes().length + ':' + decided.length + ':' + (t.app.act ? t.app.act.status : '-');
    if (s !== sig) { sig = s; renderAll(); }
  }, 1000);
  var tok = (location.hash || '').slice(1);
  t.refresh().then(function () {
    show(['desk', 'morning', 'settings'].indexOf(tok) >= 0 ? tok : 'talk');
    if (!store('tacit.met') || tok === 'hello') ivStart();
  });
})();
</script>
