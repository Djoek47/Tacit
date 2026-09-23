<script>
(function () {
  const A = window.AIUIC, $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------- the host side
     Written in code, once, with the cost declared. A composed act binds to one
     of these and inherits what it costs; it can never invent a cheaper one. */
  const log = [];
  const CITIES = [
    { value: 'nrt', label: 'Tokyo' }, { value: 'lis', label: 'Lisbon' },
    { value: 'cdg', label: 'Paris' }, { value: 'yul', label: 'Montréal' },
  ];
  const PEOPLE = [
    { value: { id: 'me', label: 'me' }, label: 'me' },
    { value: { id: 'sam', label: 'Sam' }, label: 'Sam' },
    { value: { id: 'maya', label: 'Maya' }, label: 'Maya' },
  ];

  const CAPS = [
    {
      name: 'draft_plan',
      describe: 'Write something into the user’s own notes.',
      radius: 'self',
      run: (f) => { log.push(f); return { id: 'd' + log.length }; },
      undo: () => { log.pop(); },
      catalogs: { cities: () => CITIES, people: () => PEOPLE },
    },
    {
      name: 'ask_someone',
      describe: 'Send a request to another person.',
      radius: { max: 'other-person', of: () => 'other-person' },
      requires: { who: 'face' },
      run: (f) => { log.push(f); return { id: 'a' + log.length }; },
      undo: () => { log.pop(); },
      catalogs: { people: () => PEOPLE },
      effects: [{ name: 'notify', run: () => {}, radius: 'other-person',
                  reversible: true, deferrable: true, reach: () => 1 }],
    },
    {
      name: 'charge_card',
      describe: 'Take money from the stored card.',
      radius: 'external',
      requires: { amount: 'quantity' },
      run: () => ({ id: 'charge' }),
      effects: [{ name: 'settle', run: () => {}, radius: 'external',
                  reversible: false, deferrable: false }],
    },
  ];

  const composer = new A.Composer();
  for (const c of CAPS) composer.register(c);

  const state = { engaged: false };
  const ctx = () => ({
    actor: { id: 'me', basePauseMs: 850 },
    attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
    reachLimit: 1, undoWindowMs: 5000,
  });
  const ui = A.createAIUIC({ ctx });

  const OPTION_CACHE = new Map();
  const optionsFor = (act, slot) => {
    const sd = act.slots[slot];
    if (!sd || !sd.options) return [];
    const key = act.name + '.' + slot;
    if (!OPTION_CACHE.has(key)) OPTION_CACHE.set(key, sd.options(ctx(), {}));
    return OPTION_CACHE.get(key);
  };

  /* ------------------------------------------------------------- the specs */
  const PRESETS = {
    'Hold tickets — self': {
      name: 'hold_tickets', capability: 'draft_plan', phrases: ['tickets', 'fly'],
      slots: {
        destination: { primitive: 'chip', catalog: 'cities', required: true, order: 1 },
        depart: { primitive: 'when', params: { granularity: 'day' }, required: true, order: 2 },
        travellers: { primitive: 'quantity', params: { min: 1, max: 9 }, order: 3 },
      },
    },
    'Ask a favour — other-person': {
      name: 'ask_favour', capability: 'ask_someone', phrases: ['ask', 'can someone'],
      slots: {
        who: { primitive: 'face', catalog: 'people', required: true, order: 1 },
        favour: { primitive: 'ghostField', required: true, order: 2 },
      },
    },
    'Buy it — external': {
      name: 'buy_it', capability: 'charge_card', phrases: ['buy', 'order'],
      slots: {
        amount: { primitive: 'quantity', params: { min: 1, max: 5000 }, order: 1 },
        note: { primitive: 'ghostField', order: 2 },
      },
    },
  };

  const ATTACKS = [
    ['Bind to a capability nobody registered',
      (s) => ({ ...s, capability: 'transfer_everything' })],
    ['Declare its own radius',
      (s) => ({ ...s, radius: 'self' })],
    ['Smuggle in a function',
      (s) => ({ ...s, slots: { ...s.slots, evil: { primitive: 'chip', order: 9, params: { onTap: () => 1 } } } })],
    ['Invent a primitive',
      (s) => ({ ...s, slots: { ...s.slots, frame: { primitive: 'iframe', order: 9 } } })],
    ['Ship 200 options',
      (s) => ({ ...s, slots: { ...s.slots, many: { primitive: 'chip', order: 9,
        options: Array.from({ length: 200 }, (_, i) => ({ value: i, label: 'o' + i })) } } })],
    ['Dress a charge up as something small',
      () => ({ name: 'just_a_little_one', capability: 'charge_card',
        slots: { amount: { primitive: 'quantity', order: 1 } } }),
      { amount: 4000 }],
  ];

  /* ------------------------------------------------------------------ view */
  let run = null, raf = 0;
  const CIRC = 226.2;

  const setStatus = (t) => { $('status').textContent = t; };

  function fmt(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return v.label ?? JSON.stringify(v);
    return String(v);
  }

  function showError(msg) {
    $('err').innerHTML = '';
    if (!msg) return;
    const d = document.createElement('div'); d.className = 'err'; d.textContent = msg;
    $('err').appendChild(d);
  }

  function showAccepted(name) {
    $('err').innerHTML = '';
    const d = document.createElement('div'); d.className = 'ok-note';
    d.textContent = 'accepted → ' + name + ' — now check what it costs on the right';
    $('err').appendChild(d);
  }

  function render() {
    const out = $('out');
    if (!run) { out.innerHTML = '<p class="why">Compose something and it appears here.</p>'; setStatus('—'); return; }
    const s = run.state();
    setStatus(s.status);
    out.innerHTML = '';

    const slots = document.createElement('div'); slots.className = 'slots';
    const ordered = Object.entries(run.def.slots).sort((a, b) => a[1].order - b[1].order);
    for (const [name, sd] of ordered) {
      const sl = s.slots[name];
      const d = document.createElement('div');
      d.className = 'slot' + (sl.status === 'filled' ? '' : ' empty') + (sl.provisional ? ' prov' : '');
      const k = document.createElement('span'); k.className = 'k';
      k.textContent = name + ' · ' + sd.primitive + (sd.required ? '' : ' (opt)');
      const v = document.createElement('span'); v.className = 'v';
      v.textContent = sl.status === 'filled' ? fmt(sl.value) : '—';
      d.append(k, v);

      const opts = optionsFor(run.def, name);
      if (opts.length) {
        const box = document.createElement('div'); box.className = 'chips';
        opts.slice(0, 8).forEach((o) => {
          const c = document.createElement('button'); c.type = 'button'; c.className = 'chip';
          c.textContent = o.label;
          if (sl.status === 'filled' && sl.value === o.value) c.classList.add('sel');
          c.onclick = () => { run.setValue(name, o.value, 'touched'); render(); };
          box.appendChild(c);
        });
        d.appendChild(box);
      } else {
        const f = document.createElement('input'); f.className = 'mini';
        f.placeholder = sd.primitive === 'quantity' ? 'a number' : sd.primitive === 'when' ? 'friday' : 'type it';
        f.oninput = () => {
          const t = f.value.trim();
          if (!t) return;
          if (sd.primitive === 'quantity') {
            const c = A.resolveQuantity(t);
            if (c[0]) run.setValue(name, c[0].value, 'touched');
          } else if (sd.primitive === 'when') {
            const c = A.resolveWhen(t, { ...ctx(), now: new Date() });
            if (c[0]) run.setValue(name, c[0].value, 'touched');
          } else {
            run.setValue(name, t, 'touched');
          }
          render();
        };
        d.appendChild(f);
      }
      slots.appendChild(d);
    }
    out.appendChild(slots);

    const v = document.createElement('div');
    v.className = 'verdict';
    const pill = (cls, txt) => { const p = document.createElement('span'); p.className = 'pill ' + cls; p.textContent = txt; v.appendChild(p); };
    if (s.radius) pill(s.radius === 'external' ? 'stop' : s.radius === 'self' ? 'ok' : 'hold', s.radius);
    if (s.status === 'hold') pill('hold', 'silence commits');
    if (s.status === 'explicit') pill('stop', 'needs an explicit yes');
    if (s.status === 'settled') pill('ok', 'committed');
    if (s.status === 'frozen') pill('prov', 'frozen');
    out.appendChild(v);

    if (s.status === 'hold') {
      const row = document.createElement('div'); row.className = 'holdrow';
      row.innerHTML =
        '<svg class="ring" viewBox="0 0 80 80"><circle class="trk" cx="40" cy="40" r="36"></circle>' +
        '<circle class="arc" id="arc" cx="40" cy="40" r="36" stroke-dasharray="226.2" stroke-dashoffset="226.2"></circle></svg>' +
        '<span class="t">Say nothing for <b id="msleft"></b> and it writes. Touch anything and the clock restarts.</span>';
      out.appendChild(row);
      const f = Math.max(0, Math.min(1, (s.holdRemainingMs || 0) / run.holdDurationMsValue));
      const arc = row.querySelector('#arc');
      if (arc) arc.setAttribute('stroke-dashoffset', String(CIRC * (1 - f)));
      const left = row.querySelector('#msleft');
      if (left) left.textContent = Math.round(s.holdRemainingMs || 0) + 'ms';
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
    }

    const why = document.createElement('div'); why.className = 'why';
    if (s.status === 'explicit') {
      why.textContent = s.radius === 'external'
        ? 'The capability behind this cannot be taken back, so silence will never commit it — whatever the spec called the act.'
        : 'The attention gate did not pass: ' + (s.gateFailures || []).join('; ') + '.';
      out.appendChild(why);
      const row = document.createElement('div'); row.className = 'row';
      const yes = document.createElement('button'); yes.className = 'go'; yes.textContent = 'Yes, do it';
      yes.onclick = () => run.assent().then(render);
      const no = document.createElement('button'); no.textContent = 'Cancel';
      no.onclick = () => { run.discard(); render(); };
      row.append(yes, no); out.appendChild(row);
    } else if (s.status === 'resolving' && s.focus) {
      why.textContent = 'Waiting on “' + s.focus + '”. It cannot hold until every required slot is filled.';
      out.appendChild(why);
    } else if (s.status === 'settled') {
      why.textContent = 'Written. ' + (run.undoAvailable ? 'Undo is live for a few seconds.' : 'The undo window has closed.');
      out.appendChild(why);
      if (run.undoAvailable) {
        const row = document.createElement('div'); row.className = 'row';
        const u = document.createElement('button'); u.textContent = 'Undo';
        u.onclick = () => run.undo().then(render);
        row.appendChild(u); out.appendChild(row);
      }
    }
  }

  function compose(spec, note, prefill) {
    OPTION_CACHE.clear();
    try {
      const def = composer.compose(spec);
      // Always redefine: editing a spec without renaming it must take effect,
      // and the registry overwrites by name.
      ui.defineAct(def);
      run = ui.start(def.name);
      run.markEngaged();
      if (prefill) for (const [k, v] of Object.entries(prefill)) {
        if (def.slots[k]) run.setValue(k, v, 'touched');
      }
      run.evaluate();
      $('tools').textContent = JSON.stringify(A.toolSchema([def], optionsFor, 'openai'), null, 2);
      if (note) showAccepted(def.name); else showError('');
      render();
    } catch (err) {
      run = null;
      $('tools').textContent = '—';
      showError(err.name === 'ComposeError' || err.name === 'ActDefinitionError'
        ? 'REFUSED — ' + err.message
        : String(err));
      render();
    }
  }

  /* ------------------------------------------------------------------ wire */
  const sel = $('preset');
  Object.keys(PRESETS).forEach((k) => {
    const o = document.createElement('option'); o.value = k; o.textContent = k; sel.appendChild(o);
  });
  const load = (k) => { $('spec').value = JSON.stringify(PRESETS[k], null, 2); showError(''); };
  sel.onchange = () => { load(sel.value); compose(PRESETS[sel.value]); };

  $('compose').onclick = () => {
    try { compose(JSON.parse($('spec').value)); }
    catch { showError('REFUSED — spec is not valid JSON'); }
  };
  $('reset').onclick = () => { load(sel.value); compose(PRESETS[sel.value]); };

  const box = $('attacks');
  ATTACKS.forEach(([label, mutate, prefill]) => {
    const d = document.createElement('div'); d.className = 'attack';
    const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Try it';
    const t = document.createElement('div');
    t.innerHTML = '<div class="d"></div>';
    t.querySelector('.d').textContent = label;
    b.onclick = () => {
      let base;
      try { base = JSON.parse($('spec').value); } catch { base = PRESETS[sel.value]; }
      const next = mutate(base);
      $('spec').value = JSON.stringify(next, (k, v) => (typeof v === 'function' ? '<<function>>' : v), 2);
      compose(next, label.startsWith('Dress'), prefill);
      document.querySelector('.lab').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    d.append(b, t); box.appendChild(d);
  });

  const caps = $('caps');
  for (const c of CAPS) {
    const tr = document.createElement('tr');
    const r = typeof c.radius === 'string' ? c.radius : c.radius.max;
    tr.innerHTML = '<td><code></code></td><td></td><td></td><td></td>';
    tr.children[0].firstChild.textContent = c.name;
    tr.children[1].textContent = r;
    tr.children[2].textContent = c.undo ? 'yes' : 'no';
    tr.children[3].textContent = c.describe;
    caps.appendChild(tr);
  }

  $('capnote').textContent = CAPS.length + ' capabilities registered';
  $('api').textContent = [
    "const ui = createAIUIC({ presenter, attention, ctx });",
    "",
    "ui.defineAct(actDef);            // validated at definition time",
    "ui.hear(text);                   // route, resolve, paint",
    "ui.touch(slot, value);           // a decision now",
    "ui.apply(toolCall);              // the model confirms or corrects",
    "ui.toolSchema('anthropic');      // generated, never hand-written",
    "ui.state();                      // what is on screen, for the model",
    "ui.pause(); ui.resume();         // covering sheets, hangup",
    "ui.on('commit' | 'undo' | 'failed', handler);",
  ].join('\n');

  load(sel.value);
  compose(PRESETS[sel.value]);
})();
</script>
