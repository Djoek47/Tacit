<script>
(function () {
  'use strict';
  var K = window.Kit;
  var style = document.createElement('style'); style.textContent = K.stylesheet(); document.head.appendChild(style);
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  // ------------------------------------------------------------ theme
  function setTheme(t) {
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    document.querySelectorAll('#theme button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.t === t)); });
  }
  document.querySelectorAll('#theme button').forEach(function (b) { b.onclick = function () { setTheme(b.dataset.t); }; });

  // ------------------------------------------------------------ views
  function day(offset, h, m) { var d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, m || 0, 0, 0); return d.getTime(); }
  // Days until the next given weekday (0 = Sunday), never today.
  function until(dow) { var n = (dow - new Date().getDay() + 7) % 7; return n || 7; }
  function slot(o) {
    return Object.assign({ label: o.name, status: 'empty', display: '', source: null, provisional: false, stale: false,
      required: true, focused: false, options: [], many: false, items: [], was: null, candidates: [] }, o);
  }
  function view(o) {
    return Object.assign({ act: 'demo', domain: null, status: 'resolving', phase: 'listening', radius: 'self', assent: null,
      holdRemainingMs: null, holdTotalMs: null, slots: [], preview: '', exact: null, refused: null, gateFailures: [], canAssent: false, canUndo: false, canResume: false }, o);
  }
  // A small stage you can poke: chips fill, × empties, "Do it" settles, "Not that" resets.
  function stage(host, initial, said, extra) {
    var current = JSON.parse(JSON.stringify(initial));
    // The presenter owns the element it draws into (it sets its class), so it gets its own, inside the themed host.
    var inner = document.createElement('div'); host.replaceChildren(inner);
    var p = new K.StagePresenter(inner, document, Object.assign({ said: function () { return said || ''; } }, extra || {}));
    function draw() { p.render(current); }
    p.mount({
      touch: function (name, value) {
        current.slots.forEach(function (s) {
          if (s.name !== name) return;
          if (value === undefined) { s.status = 'empty'; s.display = ''; s.value = undefined; s.items = []; s.focused = true; return; }
          if (s.many && Array.isArray(value)) {
            s.items = value.map(function (v) { var o = s.options.find(function (x) { return x.value === v; }); return { value: v, display: o ? o.label : String(v) }; });
            s.status = 'filled'; s.value = value; s.display = s.items.map(function (i) { return i.display; }).join(', ');
            s.source = 'tapped'; s.provisional = false; s.focused = false; return;
          }
          var pick = (s.options || []).concat(s.candidates || []).find(function (o) { return JSON.stringify(o.value) === JSON.stringify(value); });
          s.status = 'filled'; s.value = value; s.display = pick ? (pick.label || pick.display) : s.display; s.source = 'tapped'; s.provisional = false; s.focused = false;
        });
        var next = current.slots.find(function (s) { return s.status !== 'filled'; });
        if (next) next.focused = true;
        draw();
      },
      assent: function () { current.status = 'settled'; current.canUndo = true; draw(); },
      discard: function () { current = JSON.parse(JSON.stringify(initial)); draw(); },
      undo: function () { current = JSON.parse(JSON.stringify(initial)); draw(); },
      freeze: function () {}, resume: function () {},
    });
    draw();
    return { set: function (v) { initial = v; current = JSON.parse(JSON.stringify(v)); draw(); } };
  }

  // ------------------------------------------------------------ kinds
  var PEOPLE = [{ value: 'maya', label: 'Maya Lee' }, { value: 'sam', label: 'Sam' }, { value: 'sylla', label: 'Sylla Mugabo' }, { value: 'vincent', label: 'Vincent' }];
  var KINDS = [
    { primitive: 'face', title: 'Face', what: 'Someone. A person is a face, not a word.', name: 'with', preview: 'Dinner with …',
      options: PEOPLE, filled: { display: 'Maya Lee', value: 'maya' },
      two: [{ value: 'sam', display: 'Sam' }, { value: 'sylla', display: 'Sylla Mugabo' }] },
    { primitive: 'chip', title: 'Chip', what: 'One of a few. The plain choice.', name: 'chore', preview: 'Assign a chore',
      options: [{ value: 'dishes', label: 'Dishes' }, { value: 'laundry', label: 'Laundry' }, { value: 'trash', label: 'Trash' }],
      filled: { display: 'Dishes', value: 'dishes' }, two: [{ value: 'dishes', display: 'Dishes' }, { value: 'laundry', display: 'Laundry' }] },
    { primitive: 'when', title: 'When', what: 'A day and a time you can see at a glance.', name: 'at', preview: 'Call the bank',
      options: [{ value: { at: day(0, 17), label: 'Today 5:00', granularity: 'minute' }, label: 'Today 5:00' }, { value: { at: day(1, 9), label: 'Tomorrow 9:00', granularity: 'minute' }, label: 'Tomorrow 9:00' }],
      filled: { display: 'Wednesday at 7', value: { at: day(until(3), 19), label: 'Wednesday at 7', granularity: 'minute' } },
      two: [{ value: { at: day(1, 8), label: '8:00', granularity: 'minute' }, display: 'Tomorrow 8:00' }, { value: { at: day(1, 9), label: '9:00', granularity: 'minute' }, display: 'Tomorrow 9:00' }] },
    { primitive: 'quantity', title: 'Quantity', what: 'An amount. The number is the point.', name: 'budget', preview: 'Set the grocery budget',
      options: [{ value: 400, label: '$400' }, { value: 450, label: '$450' }, { value: 500, label: '$500' }],
      filled: { display: '$420', value: 420 }, two: [{ value: 1.5, display: '$1.50' }, { value: 1500, display: '$1,500' }] },
    { primitive: 'ghostField', title: 'Ghost field', what: 'Your own words, kept as you said them.', name: 'note', preview: 'Book the restaurant',
      options: [], filled: { display: 'ask for the patio', value: 'ask for the patio' }, guess: true },
    { primitive: 'objectCard', title: 'Object', what: 'A thing from your world: a file, a place, an order.', name: 'place', preview: 'Share the address',
      options: [{ value: 'olive', label: 'Olive & Gourmando' }, { value: 'dispatch', label: 'Dispatch Coffee' }],
      filled: { display: 'Olive & Gourmando, 351 Saint-Paul O', value: 'olive' } },
    { primitive: 'peek', title: 'Peek', what: 'A glimpse of more: a list, a result, a draft.', name: 'draft', preview: 'Reply to Vincent',
      options: [], filled: { display: 'Sounds good, Thursday works. I’ll bring the deck and the numbers from last quarter so we can go through them together before the call with the bank.', value: 'draft' } },
    { primitive: 'objectCard', tag: 'compare', title: 'Compare', what: 'Two or three options side by side. Only what differs is shown.', name: 'flight', preview: 'Book the Toronto flight',
      options: [
        { value: 'ac', label: 'Air Canada 7:05', facts: { price: '$312', time: '1h 25m', arrives: '8:30', bags: '1 free' } },
        { value: 'po', label: 'Porter 8:40', facts: { price: '$268', time: '1h 30m', arrives: '10:10', bags: '1 free' } },
        { value: 'ws', label: 'WestJet 11:15', facts: { price: '$241', time: '1h 35m', arrives: '12:50', bags: '1 free' } },
      ],
      filled: { display: 'Porter 8:40', value: 'po' },
      two: [{ value: 'po', display: 'Porter 8:40' }, { value: 'ac', display: 'Air Canada 7:05' }] },
    { primitive: 'chip', tag: 'list', many: true, title: 'List', what: 'Several things said in one go. Each one can go on its own.', name: 'items', label: 'Groceries', preview: 'Add to the grocery list',
      options: [{ value: 'milk', label: 'Oat milk' }, { value: 'eggs', label: 'Eggs' }, { value: 'coffee', label: 'Coffee' }, { value: 'bread', label: 'Sourdough' }, { value: 'bananas', label: 'Bananas' }, { value: 'rice', label: 'Rice' }],
      filled: { value: ['milk', 'eggs', 'coffee'] } },
    { primitive: 'face', tag: 'list · face', many: true, title: 'People', what: 'More than one person. Each is a face, and each can be taken out.', name: 'with', label: 'With', preview: 'Dinner Friday',
      options: PEOPLE, filled: { value: ['maya', 'sam'] } },
  ];
  KINDS.forEach(function (k) {
    var tile = el('div', 'tile');
    var head = el('header'); head.appendChild(el('h3', '', k.title)); head.appendChild(el('span', 'eyebrow', k.tag || k.primitive));
    tile.appendChild(head); tile.appendChild(el('p', 'what', k.what));
    var host = el('div', 'host'); var tabs = el('div', 'tabs');
    var states = [['ask', 'Asking']];
    if (k.two) states.push(['two', 'Two readings']);
    if (k.guess) states.push(['guess', 'A guess']);
    states.push(['filled', 'Answered']);
    function v(state) {
      var s = slot({ name: k.name, primitive: k.primitive, options: k.options, many: !!k.many, label: k.label || k.name });
      if (state === 'ask') s.focused = true;
      if (state === 'two') { s.status = 'narrowed'; s.candidates = k.two.map(function (c) { return Object.assign({ score: 0.5 }, c); }); }
      if (state === 'filled' || state === 'guess') { s.status = 'filled'; s.display = k.filled.display; s.value = k.filled.value; s.source = state === 'guess' ? 'model' : 'spoken'; s.provisional = state === 'guess'; }
      if (k.many && s.status === 'filled') {
        s.items = k.filled.value.map(function (v) { return { value: v, display: k.options.find(function (o) { return o.value === v; }).label }; });
        s.display = s.items.map(function (i) { return i.display; }).join(', ');
      }
      return view({ slots: [s], preview: k.preview, status: state === 'filled' ? 'hold' : 'resolving', holdRemainingMs: 2200, holdTotalMs: 3000 });
    }
    var st = stage(host, v('ask'));
    states.forEach(function (x, i) {
      var b = el('button', '', x[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(i === 0));
      b.onclick = function () { tabs.querySelectorAll('button').forEach(function (y) { y.setAttribute('aria-pressed', String(y === b)); }); st.set(v(x[0])); };
      tabs.appendChild(b);
    });
    tile.append(tabs, host); $('kinds').appendChild(tile);
  });

  // ------------------------------------------------------------ place and route
  (function () {
    var HOME = { lat: 45.5226, lon: -73.5794 }; // Plateau
    var OLIVE = { label: 'Olive & Gourmando', address: '351 Saint-Paul O', lat: 45.5009, lon: -73.5571 };
    var WAYS = K.routeOptions(K.estimateLegs(HOME, OLIVE));
    var opts = { detailFor: function (name, v) { return K.isPlace(v) ? K.placeLine(v, HOME) : null; } };
    var tile = el('div', 'tile');
    var head = el('header'); head.appendChild(el('h3', '', 'Place and route')); head.appendChild(el('span', 'eyebrow', 'objectCard · compare'));
    tile.append(head, el('p', 'what', 'Where it is, how far from you, and the sensible ways there side by side. No map service is connected, so times are estimates and say so.'));
    var host = el('div', 'host'), tabs = el('div', 'tabs');
    function v(state) {
      var place = slot({ name: 'place', label: 'Where', primitive: 'objectCard', status: 'filled', display: OLIVE.label, value: OLIVE, source: 'spoken' });
      var who = slot({ name: 'with', label: 'With', primitive: 'face', status: 'filled', display: 'Maya Lee', value: 'maya', source: 'spoken' });
      var by = slot({ name: 'by', label: 'Getting there', primitive: 'chip', options: WAYS, focused: state === 'ask' });
      if (state === 'filled') { by.status = 'filled'; by.value = 'bike'; var b = WAYS.find(function (w) { return w.value === 'bike'; }) || WAYS[0]; by.value = b.value; by.display = b.label + ' · ' + b.facts.time; by.source = 'touched'; }
      return view({ slots: [place, who, by], preview: 'Meet Maya at Olive & Gourmando', status: state === 'filled' ? 'hold' : 'resolving', holdRemainingMs: 2200, holdTotalMs: 3000 });
    }
    var st = stage(host, v('ask'), 'meet Maya at Olive and Gourmando', opts);
    [['ask', 'Which way'], ['filled', 'Answered']].forEach(function (x, i) {
      var b = el('button', '', x[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(i === 0));
      b.onclick = function () { tabs.querySelectorAll('button').forEach(function (y) { y.setAttribute('aria-pressed', String(y === b)); }); st.set(v(x[0])); };
      tabs.appendChild(b);
    });
    tile.append(tabs, host); $('kinds').appendChild(tile);
  })();

  // ------------------------------------------------------------ beats
  var full = function () {
    return [
      slot({ name: 'with', primitive: 'face', status: 'filled', display: 'Maya Lee', value: 'maya', source: 'spoken' }),
      slot({ name: 'at', primitive: 'when', status: 'filled', display: 'Wednesday at 7', value: KINDS[2].filled.value, source: 'spoken' }),
      slot({ name: 'budget', primitive: 'quantity', status: 'filled', display: '$80', value: 80, source: 'spoken' }),
    ];
  };
  var BEATS = [
    { title: 'Show', what: 'The first reading, the moment the sentence makes sense.', v: function () { var s = full(); s[1] = slot({ name: 'at', primitive: 'when', focused: true }); s[2] = slot({ name: 'budget', primitive: 'quantity' }); return view({ slots: s, preview: 'Dinner with Maya' }); } },
    { title: 'Hold', what: 'Everything is filled. Silence lets it happen; the bar is the silence running out.', live: true, v: function () { return view({ slots: full(), preview: 'Dinner with Maya · Wednesday 7:00 · $80', status: 'hold', holdRemainingMs: 3000, holdTotalMs: 3000 }); } },
    { title: 'Needs a yes', what: 'It reaches someone else or cannot be taken back, so silence is not enough.', v: function () { return view({ slots: full(), preview: 'Book a table for 2 at Olive & Gourmando', status: 'explicit', radius: 'external' }); } },
    { title: 'Settled', what: 'One mark for the whole card, and an undo while it still can.', v: function () { return view({ slots: full(), preview: 'Dinner with Maya · Wednesday 7:00 · $80', status: 'settled', canUndo: true }); } },
    { title: 'A change', what: 'Changing something that already exists shows what it was, crossed out, beside what it will be.',
      v: function () { var at = KINDS[2].filled.value; return view({ slots: [
        slot({ name: 'plan', label: 'Plan', primitive: 'objectCard', status: 'filled', display: 'Maya · Olive & Gourmando', value: 'p1', source: 'remembered' }),
        slot({ name: 'at', label: 'When', primitive: 'when', status: 'filled', display: 'Wed 8pm', was: 'Wednesday 7pm', value: { at: at.at + 3600000, label: 'Wed 8pm', granularity: 'minute' }, source: 'spoken' })],
        preview: 'Move Maya at Olive & Gourmando to Wed 8pm', status: 'hold', holdRemainingMs: 2000, holdTotalMs: 3000 }); } },
    { title: 'Exactly this', what: 'For anything that leaves the app, every argument is shown as it will be sent, and the yes is given to exactly that.',
      v: function () { return view({ slots: [slot({ name: 'to', primitive: 'face', status: 'filled', display: 'Sam Okafor', value: 'sam', source: 'spoken' }), slot({ name: 'amount', primitive: 'quantity', status: 'filled', display: '$40', value: 40, source: 'spoken' })],
        preview: 'Send Sam $40', status: 'explicit', radius: 'external',
        exact: { what: 'Bank · Send money', rows: [{ label: 'To', value: 'Sam Okafor (sam.okafor@…)' }, { label: 'Amount', value: '40.00 CAD' }, { label: 'From', value: 'Chequing ••42' }, { label: 'Message', value: 'Dinner Friday' }], key: 'k-shown' } }); } },
    { title: 'Changed since you saw it', what: 'The amount changed after the card was drawn. The tap is not a yes to the new amount; the card says so and asks again.',
      v: function () { return view({ slots: [slot({ name: 'to', primitive: 'face', status: 'filled', display: 'Sam Okafor', value: 'sam', source: 'spoken' }), slot({ name: 'amount', primitive: 'quantity', status: 'filled', display: '$400', value: 400, source: 'model', provisional: false })],
        preview: 'Send Sam $400', status: 'explicit', radius: 'external', refused: 'it changed since you saw it — look again',
        exact: { what: 'Bank · Send money', rows: [{ label: 'To', value: 'Sam Okafor (sam.okafor@…)' }, { label: 'Amount', value: '400.00 CAD' }, { label: 'From', value: 'Chequing ••42' }], key: 'k-new' } }); } },
    { title: 'Failed', what: 'Said plainly, never on the same turn as a success.', v: function () { return view({ slots: full(), preview: 'Dinner with Maya · Wednesday 7:00 · $80', status: 'failed' }); } },
  ];
  BEATS.forEach(function (b) {
    var tile = el('div', 'tile');
    var head = el('header'); head.appendChild(el('h3', '', b.title)); tile.appendChild(head); tile.appendChild(el('p', 'what', b.what));
    var host = el('div', 'host'); tile.appendChild(host); $('beats').appendChild(tile);
    var st = stage(host, b.v(), b.title === 'Show' ? 'dinner with Maya…' : '');
    if (b.live) {
      // The bar is redrawn as the hold runs down, then starts again. JavaScript time, not a CSS loop.
      var left = 3000;
      setInterval(function () { left -= 100; if (left < -800) left = 3000; var v = b.v(); v.holdRemainingMs = Math.max(0, left); if (left <= 0) { v.status = 'settled'; v.canUndo = true; } st.set(v); }, 100);
    }
  });

  // ------------------------------------------------------------ surfaces
  var it = function (title, why, source, extra) { return Object.assign({ title: title, why: why, source: source, at: 0, words: 22 }, extra || {}); };
  var MORNING = {
    sections: [
      { name: 'For you', items: [
        it('Vincent sent the revised deck', 'from Vincent', 'person:vincent', { detail: 'He changed the revenue slide and wants your comments before Thursday’s call with the bank.', action: { label: 'Reply to Vincent', say: 'reply to Vincent' } }),
        it('Rent is due Monday', 'it was marked urgent', 'app:bank', { detail: '$1,850 to Gestion Laurier, from your chequing account.' }),
      ] },
      { name: 'Around you', items: [
        it('Rain from 3pm, 12°', 'near Plateau', 'weather', { detail: 'Clearing by 8. Tomorrow is dry and colder, high of 7.' }),
      ] },
      { name: 'What you follow', items: [
        it('Bank of Canada holds its rate at 2.25%', 'you follow markets', 'world'),
        it('Montréal approves the Peel Street bike lane', 'you follow the city', 'world', { detail: 'Work starts in April and closes two lanes for six weeks.' }),
      ] },
    ],
    words: 110, minutes: 0.8, leftOut: 3,
  };
  (function () {
    var tile = el('div', 'tile wide');
    var head = el('header'); head.appendChild(el('h3', '', 'Briefing')); head.appendChild(el('span', 'eyebrow', 'morning'));
    tile.append(head, el('p', 'what', 'The morning, one item at a time. Next, back, more on this, stop and continue — by voice or by tap. It keeps your place.'));
    var host = el('div', 'host'), note = el('p', 'what said');
    tile.append(host, note); $('surfaces').appendChild(tile);
    var r, card;
    function draw(line) { card.render(r.view()); note.textContent = line ? 'It says: “' + line + '”' : ''; }
    function move(fn) { return function () { fn(); draw(r.line()); }; }
    function start() {
      r = new K.BriefingReader(MORNING, 'Cicentos');
      var inner = document.createElement('div'); host.replaceChildren(inner);
      card = new K.BriefingPresenter(inner, document);
      card.mount({
        next: move(function () { r.next(); }), back: move(function () { r.back(); }), more: move(function () { r.more(); }),
        stop: move(function () { r.stop(); }), resume: move(function () { r.resume(); }),
        act: function (s) { note.textContent = 'Handed to the conversation: “' + s + '”. Replying reaches Vincent, so it will wait for a yes.'; },
        done: function () { host.replaceChildren(); var again = el('button', 'again', 'Start the briefing again'); again.type = 'button'; again.onclick = start; host.appendChild(again); note.textContent = ''; },
      });
      draw(r.line());
    }
    start();
  })();

  (function () {
    var tile = el('div', 'tile wide');
    var head = el('header'); head.appendChild(el('h3', '', 'Held for you')); head.appendChild(el('span', 'eyebrow', 'bundle'));
    tile.append(head, el('p', 'what', 'What the Desk held back, one sender or story at a time. Open one, mark the bundle read, or leave it for later. Read is never deleted.'));
    var host = el('div', 'host'), note = el('p', 'what said');
    tile.append(host, note); $('surfaces').appendChild(tile);
    var M = 60000, NOW = new Date(2026, 9, 16, 23, 40).getTime();
    function sample() {
      // 11:40 pm: quiet hours, so even urgent app notices wait.
      var d = new K.Desk(undefined, function () { return 23; }), i = 0;
      function add(p) { d.ingest(Object.assign({ id: 'k' + (++i), topics: ['x'], urgency: 0.9, at: NOW }, p)); }
      add({ from: 'app:bank', title: 'Deposit received: $2,400', at: NOW - 95 * M, body: 'Payroll from Mytikas 73 into chequing.' });
      add({ from: 'app:bank', title: 'Card used at Metro, $38.12', at: NOW - 62 * M });
      add({ from: 'app:bank', title: 'Card used at SAQ, $27.40', at: NOW - 41 * M });
      add({ from: 'app:bank', title: 'Low balance on chequing', at: NOW - 12 * M, body: 'Chequing is under $100 after tonight’s card payments.' });
      add({ from: 'app:bank', title: 'Statement ready', at: NOW - 9 * M });
      add({ from: 'person:maya', title: 'Still on for Friday? I found a place on Saint-Laurent', urgency: 0.3, at: NOW - 5 * M, body: 'Table for two at 7, or 8 if you’re coming from the office.' });
      add({ from: 'app:weather', groupKey: 'storm', title: 'Wind warning overnight', at: NOW - 80 * M, body: 'Gusts to 70 km/h after midnight.' });
      add({ from: 'app:news', groupKey: 'storm', title: 'Wind warning extended to 6 am', at: NOW - 30 * M });
      return d;
    }
    var deck, card;
    function draw() { card.render(deck.view()); }
    function start() {
      deck = new K.BundleDeck(sample(), function () { return NOW; });
      var inner = document.createElement('div'); host.replaceChildren(inner); note.textContent = '';
      card = new K.BundlePresenter(inner, document);
      card.mount({
        open: function (id) { deck.open(id); draw(); },
        expand: function () { deck.expand(); draw(); },
        read: function () { deck.markRead(); draw(); },
        later: function () { deck.later(); draw(); },
        act: function (s) { note.textContent = 'Handed to the conversation: “' + s + '”. A reply reaches Maya, so it will wait for a yes.'; },
        done: function () { host.replaceChildren(); var again = el('button', 'again', 'Start again'); again.type = 'button'; again.onclick = start; host.appendChild(again); },
      });
      draw();
    }
    start();
  })();

  // ------------------------------------------------------------ live replay
  var SCRIPTS = [
    { text: 'Dinner with Maya on Wednesday at 7, about 80 dollars, and ask for the patio', radius: 'external',
      steps: [
        { at: 2, preview: 'Dinner with Maya', fill: ['with', 'Maya Lee', 'maya', 'face'] },
        { at: 5, narrow: ['at', 'when', [{ value: { at: day(until(3), 7), granularity: 'minute' }, display: 'Wednesday 7:00 am' }, { value: { at: day(until(3), 19), granularity: 'minute' }, display: 'Wednesday 7:00 pm' }]] },
        { at: 6, preview: 'Dinner with Maya · Wednesday 7 pm', fill: ['at', 'Wednesday 7:00 pm', { at: day(until(3), 19), granularity: 'minute' }, 'when'] },
        { at: 9, preview: 'Dinner with Maya · Wednesday 7 pm · $80', fill: ['budget', '$80', 80, 'quantity'] },
        { at: 14, fill: ['note', 'ask for the patio', 'ask for the patio', 'ghostField'] },
      ],
      slots: [['with', 'face'], ['at', 'when'], ['budget', 'quantity'], ['note', 'ghostField']],
      end: 'Booking reaches the restaurant, so it waits for your yes.' },
    { text: 'Add milk, eggs and coffee to the groceries', radius: 'self',
      steps: [
        { at: 1, preview: 'Add to groceries', fill: ['item', 'Milk', 'milk', 'chip'] },
        { at: 2, fill: ['also', 'Eggs', 'eggs', 'chip'] },
        { at: 4, preview: 'Milk, eggs and coffee on the list', fill: ['and', 'Coffee', 'coffee', 'chip'] },
      ],
      slots: [['item', 'chip'], ['also', 'chip'], ['and', 'chip']],
      end: 'Only your list, and undoable: silence is enough.' },
    { text: 'Remind me to call Sylla tomorrow morning', radius: 'self',
      steps: [
        { at: 4, preview: 'Remind you to call Sylla', fill: ['who', 'Sylla Mugabo', 'sylla', 'face'] },
        { at: 6, narrow: ['when', 'when', [{ value: { at: day(1, 8), granularity: 'minute' }, display: 'Tomorrow 8:00' }, { value: { at: day(1, 9), granularity: 'minute' }, display: 'Tomorrow 9:00' }]] },
      ],
      slots: [['who', 'face'], ['when', 'when']],
      end: '“Morning” has two readings. Tap one, or say it.' },
  ];
  var live = null, which = 0, timer = null;
  function play() {
    clearInterval(timer);
    var sc = SCRIPTS[which]; var words = sc.text.split(' '); var i = 0; var said = '';
    var v = view({ preview: '…', radius: sc.radius, slots: sc.slots.map(function (x, j) { return slot({ name: x[0], primitive: x[1], focused: j === 0 }); }) });
    var hold = 0;
    if (!live) live = stage($('live'), v, ''); else live.set(v);
    $('replay-note').textContent = '';
    function render() {
      var s = $('said'); s.replaceChildren();
      s.appendChild(el('span', 'heard', words.slice(0, i).join(' ')));
      s.appendChild(el('span', 'coming', (i ? ' ' : '') + words.slice(i).join(' ')));
    }
    render();
    timer = setInterval(function () {
      if (i < words.length) {
        i++; render();
        sc.steps.forEach(function (st) {
          if (st.at !== i) return;
          if (st.preview) v.preview = st.preview;
          if (st.fill) v.slots.forEach(function (s) { if (s.name === st.fill[0]) { s.status = 'filled'; s.display = st.fill[1]; s.value = st.fill[2]; s.source = 'spoken'; s.focused = false; s.candidates = []; } });
          if (st.narrow) v.slots.forEach(function (s) { if (s.name === st.narrow[0]) { s.status = 'narrowed'; s.candidates = st.narrow[2].map(function (c) { return Object.assign({ score: .5 }, c); }); } });
          var next = v.slots.find(function (s) { return s.status === 'empty'; }); v.slots.forEach(function (s) { s.focused = s === next; });
        });
        live.set(JSON.parse(JSON.stringify(v)));
        return;
      }
      // The sentence is over.
      var open = v.slots.some(function (s) { return s.status !== 'filled'; });
      if (open) { $('replay-note').textContent = sc.end; clearInterval(timer); return; }
      if (sc.radius === 'external') { v.status = 'explicit'; live.set(v); $('replay-note').textContent = sc.end; clearInterval(timer); return; }
      hold += 200; v.status = hold >= 3000 ? 'settled' : 'hold'; v.holdTotalMs = 3000; v.holdRemainingMs = Math.max(0, 3000 - hold); v.canUndo = v.status === 'settled';
      live.set(JSON.parse(JSON.stringify(v)));
      if (v.status === 'settled') { $('replay-note').textContent = sc.end; clearInterval(timer); }
    }, 220);
  }
  $('play').onclick = play;
  $('next').onclick = function () { which = (which + 1) % SCRIPTS.length; play(); };
  play();
})();
</script>
