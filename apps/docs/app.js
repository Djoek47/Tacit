<script>
(function () {
  var R = window.HeptaRuntime;

  // Copy buttons on every code block. Clipboard can be refused; then the text is selected instead.
  document.querySelectorAll('.code').forEach(function (box) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'copy'; btn.textContent = 'Copy';
    btn.addEventListener('click', function () {
      var text = box.querySelector('pre').innerText;
      var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1400); };
      var select = function () { var r = document.createRange(); r.selectNodeContents(box.querySelector('pre')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = 'Selected'; };
      try { navigator.clipboard.writeText(text).then(done, select); } catch (e) { select(); }
    });
    box.appendChild(btn);
  });

  // The section list follows the reader.
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  var byId = {}; links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.removeAttribute('aria-current'); });
        var a = byId[e.target.id]; if (a) a.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('main section[id]').forEach(function (s) { io.observe(s); });
  }

  // ------------------------------------------------------------- the live stage
  if (!R) return;
  var st = document.createElement('style'); st.textContent = R.stylesheet(); document.head.appendChild(st);

  var list = [], sent = [];
  var said = document.getElementById('said');
  var c = new R.Composer();
  c.register({ name: 'list_add', describe: 'add to the shopping list', radius: 'self',
    run: function (f) { list.push(f.what); show(); return { id: 'g' + list.length }; },
    undo: function () { list.pop(); show(); } });
  c.register({ name: 'send_money', describe: 'send money', radius: 'external',
    catalogs: { people: function () { return [{ value: 'maya', label: 'Maya' }, { value: 'sam', label: 'Sam' }]; } },
    run: function (f) { sent.push(f); show(); return { id: 'x' + sent.length }; } });

  var add = c.compose({ name: 'add_items', capability: 'list_add', phrases: ['add', 'we need', 'put'],
    slots: { what: { primitive: 'ghostField', order: 1, required: true } } });
  add.domain = 'groceries';
  add.preview = function (f) { return [(f.what ? f.what : 'Something') + ' on the list']; };
  var pay = c.compose({ name: 'send_money', capability: 'send_money', phrases: ['send', 'pay'],
    slots: { who: { primitive: 'face', order: 1, required: true, catalog: 'people' },
             amount: { primitive: 'quantity', order: 2, required: true } } });
  pay.domain = 'allowance';
  pay.preview = function (f) { return ['Send ' + (f.amount ? f.amount.label : '…') + ' to ' + (f.who === 'sam' ? 'Sam' : f.who === 'maya' ? 'Maya' : '…')]; };

  var words = '';
  var app = R.createApp({ acts: [add, pay], speculate: false,
    ctx: function () { return { now: new Date(), actor: { id: 'you', basePauseMs: 850 }, reachLimit: 1, undoWindowMs: 5000,
      attention: { foreground: true, unlocked: true, proximityClear: true, listening: true } }; } });
  app.mount(new R.StagePresenter(document.getElementById('stage'), document, { said: function () { return words; } }));

  function show() {
    var parts = [];
    parts.push(list.length ? 'On the list: ' + list.join(', ') : 'The list is empty.');
    parts.push(sent.length ? 'Money sent: ' + sent.length : 'No money sent.');
    said.textContent = parts.join(' · ');
  }
  function hear(t) {
    words = t;
    var r = app.hear(t);
    if (!r.act) { document.getElementById('stage').innerHTML = '<p style="color:#9AA6BB;margin:0">Try adding something to the list, or sending money.</p>'; }
  }
  app.ui.on(function () { setTimeout(function () { app.draw(); show(); }, 0); });
  (function loop() { if (app.act && app.act.status === 'hold') app.draw(); requestAnimationFrame(loop); })();

  document.getElementById('demo').addEventListener('submit', function (e) {
    e.preventDefault(); var v = document.getElementById('demoSay').value.trim(); if (v) hear(v);
  });
  var tries = document.getElementById('tries');
  ['add milk and eggs', 'send 20 dollars to Maya'].forEach(function (t) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'try'; b.textContent = t;
    b.onclick = function () { document.getElementById('demoSay').value = t; hear(t); };
    tries.appendChild(b);
  });
  show();
  document.getElementById('demoSay').value = 'add milk and eggs';
  hear('add milk and eggs');
})();
</script>
<script>
(function () {
  /* ---------------------------------------------------------- playground ---
     A developer pastes what their app already has, and the page builds the
     menus from it — the same SDK this site documents, running here. Nothing
     leaves the page: the OpenAPI door is given a caller that answers locally,
     because a demo that fires real requests at somebody's server is a demo
     that should not exist. */
  var R = window.HeptaRuntime;
  var src = document.getElementById('playSrc');
  if (!R || !src || typeof R.mount !== 'function') return;

  var ui = document.getElementById('playUI');
  var note = document.getElementById('playNote');
  var costs = document.getElementById('playCosts');
  var say = document.getElementById('playSay');
  var kind = 'openapi';
  var mounted = null;

  var SAMPLE = {
    openapi: JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Your API' },
      paths: {
        '/tasks': {
          get: { operationId: 'list_tasks', summary: 'List tasks', tags: ['tasks'] },
          post: { operationId: 'add_task', summary: 'Add a task', tags: ['tasks'],
            'x-aiuic-undo': '/tasks/{id}/restore',
            requestBody: { content: { 'application/json': { schema: {
              type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } } } }
        },
        '/tasks/{id}': {
          delete: { operationId: 'delete_task', summary: 'Delete a task', tags: ['tasks'],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] }
        },
        '/billing/charge': {
          post: { operationId: 'charge_card', summary: 'Charge the card on file', tags: ['billing'],
            requestBody: { content: { 'application/json': { schema: {
              type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] } } } } }
        }
      }
    }, null, 2),
    functions: JSON.stringify([
      { name: 'add_task', domain: 'tasks', phrases: ['add'], undo: true,
        parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
      { name: 'drop_task', domain: 'tasks', phrases: ['drop', 'remove'], undo: true,
        parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
      { name: 'pay_allowance', domain: 'money', phrases: ['pay'], undo: true, reachesOutside: true,
        parameters: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] } }
    ], null, 2)
  };

  var COST_LINE = {
    self: 'yours alone, and reversible — quiet lets it happen',
    shared: 'changes something shared, and reversible',
    'other-person': 'touches somebody else — never while you are away',
    external: 'always asks before it happens'
  };

  /* Why an action costs what it does. An imported write starts at the top and
     the person lowers it later, which is not the same thing as it being
     expensive — saying "costs money" about every POST would teach the wrong
     model on the first screen a developer sees. */
  function reason(name, radius, cost) {
    if (!cost) return COST_LINE[radius] || radius;
    if (cost.kind === 'read') return 'only reads — a source, never an action';
    if (cost.lowerable) return 'starts here until you let it go ahead, and no lower than "' + cost.floor + '"';
    return 'can never be lowered: ' + cost.why.join('; ');
  }

  function show(msg, bad) {
    note.textContent = msg || '';
    if (bad) note.setAttribute('data-bad', 'true'); else note.removeAttribute('data-bad');
  }

  function build() {
    var parsed;
    try { parsed = JSON.parse(src.value); }
    catch (e) { show('That is not JSON yet: ' + e.message, true); return; }

    if (mounted) { mounted.destroy(); mounted = null; }
    var opts = { el: ui };
    var classified = {};
    try {
      if (kind === 'openapi') {
        // Answers locally. Your server is never called from this page.
        opts.openapi = { doc: parsed, call: function () {
          return Promise.resolve({ ok: true, status: 200, body: { id: 'demo' } });
        } };
        classified = R.fromOpenAPI(parsed, { call: opts.openapi.call }).costs;
      } else {
        if (!Array.isArray(parsed)) throw new Error('expected a list of functions');
        opts.functions = parsed.map(function (f) {
          var spec = {
            name: f.name, domain: f.domain, phrases: f.phrases, parameters: f.parameters,
            reachesOutside: f.reachesOutside, touchesSomeoneElse: f.touchesSomeoneElse,
            run: function () { return { id: 'demo' }; }
          };
          if (f.undo) spec.undo = function () {};
          return spec;
        });
      }
      mounted = R.mount(opts);
    } catch (e) { show('Could not read that: ' + e.message, true); return; }

    var acts = mounted.app.ui.definitions;
    if (!acts.length) { show('Nothing in there could become an action yet.', true); costs.textContent = ''; return; }

    costs.replaceChildren();
    acts.forEach(function (a) {
      var r = typeof a.radius === 'string' ? a.radius : a.radius.max;
      var line = document.createElement('div');
      line.className = 'play-cost';
      var b = document.createElement('b');
      b.textContent = a.name;
      line.appendChild(b);
      line.appendChild(document.createTextNode(' — ' + reason(a.name, r, classified[a.name])));
      costs.appendChild(line);
    });

    var menus = mounted.menus.structure.length;
    show(acts.length + ' action' + (acts.length === 1 ? '' : 's') + ', ' + menus + ' menu' +
         (menus === 1 ? '' : 's') + ', nobody wrote one. Nothing here calls your server.');
    say.placeholder = (acts[0].phrases && acts[0].phrases[0] ? acts[0].phrases[0] : 'say') + ' something';
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      kind = tab.getAttribute('data-kind');
      document.querySelectorAll('.tab').forEach(function (t) {
        t.setAttribute('aria-selected', String(t === tab));
      });
      src.value = SAMPLE[kind];
      build();
    });
  });

  document.getElementById('playBuild').addEventListener('click', build);
  document.getElementById('playReset').addEventListener('click', function () {
    src.value = SAMPLE[kind]; build();
  });
  document.getElementById('playSayForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (mounted && say.value.trim()) { mounted.hear(say.value.trim(), { final: true }); say.value = ''; }
  });

  src.value = SAMPLE.openapi;
  build();
})();
</script>
