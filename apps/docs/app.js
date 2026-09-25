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
