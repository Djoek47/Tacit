<script>
(function () {
  const A = window.AIUIC;
  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------- host data */
  const ME   = { id: 'me',  label: 'me' };
  const SAM  = { id: 'sam', label: 'Sam' };
  const MAYA = { id: 'maya',label: 'Maya' };

  const PEOPLE = [
    { value: ME,   label: 'me',   aliases: ['myself', 'I'] },
    { value: SAM,  label: 'Sam' },
    { value: MAYA, label: 'Maya' },
  ];
  const ITEMS = [
    { value: 'milk', label: 'milk' }, { value: 'bread', label: 'bread' },
    { value: 'coffee', label: 'coffee' }, { value: 'batteries', label: 'batteries' },
  ];
  const ERRANDS = [
    { value: 'parcel', label: 'the parcel', aliases: ['parcel', 'package'] },
    { value: 'recycling', label: 'the recycling', aliases: ['recycling', 'bins'] },
  ];

  const db = { list: [], errands: [], queue: { pharmacy: { at: Date.now() + 36e5, label: 'the pharmacy run' } }, paid: [] };
  const QUEUE = [{ value: 'pharmacy', label: 'the pharmacy run', aliases: ['pharmacy', 'pharmacy run'] }];

  /* ------------------------------------------------- host slot resolvers */
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const ONES = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
    eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
  const TENS = {twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};

  function nextWeekday(idx) {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    let delta = (idx - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    d.setDate(d.getDate() + delta);
    return d.getTime();
  }

  /* Values carry their own label so the stage shows the word that was said,
     not a timestamp the speaker never uttered. */
  function resolveWhen(text) {
    const t = A.normalize(text);
    const out = [];
    const now = Date.now();
    const push = (at, label) => out.push({ value: { at, label }, label, score: 1, calibrated: true });
    if (/\btonight\b/.test(t)) push(now + 6 * 36e5, 'tonight');
    if (/\btomorrow\b/.test(t)) push(now + 24 * 36e5, 'tomorrow');
    if (/\bnow\b/.test(t)) push(now + 6e4, 'right now');
    for (let i = 0; i < DAYS.length; i++) {
      if (new RegExp('\\b' + DAYS[i] + '\\b').test(t)) {
        push(nextWeekday(i), DAYS[i][0].toUpperCase() + DAYS[i].slice(1));
      }
    }
    return out;
  }

  function resolveAmount(text) {
    const t = A.normalize(text);
    const digits = t.match(/\b(\d+(?:\.\d{1,2})?)\b/);
    if (digits) return [{ value: parseFloat(digits[1]), label: '$' + digits[1], score: 1, calibrated: true }];
    const words = t.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (ONES[words[i]] !== undefined) {
        return [{ value: ONES[words[i]], label: '$' + ONES[words[i]], score: 1, calibrated: true }];
      }
      if (TENS[words[i]] !== undefined) {
        let n = TENS[words[i]];
        if (ONES[words[i + 1]] !== undefined && ONES[words[i + 1]] < 10) n += ONES[words[i + 1]];
        return [{ value: n, label: '$' + n, score: 1, calibrated: true }];
      }
    }
    return [];
  }

  const OPTIONS = {
    item: ITEMS, assignee: PEOPLE, payee: PEOPLE, errand: ERRANDS, target: QUEUE,
  };
  const optionsFor = (act, slot) => OPTIONS[slot] || [];

  /* ------------------------------------------------------------- context */
  const state = { model: true, looking: true, slow: false };
  const ctx = () => ({
    actor: { id: 'me', basePauseMs: state.slow ? 1300 : 850 },
    attention: state.looking
      ? { foreground: true, unlocked: true, proximityClear: true, listening: true }
      : { foreground: true, unlocked: false, proximityClear: false, listening: true },
    reachLimit: 1,
    undoWindowMs: 5000,
  });

  const ui = A.createAIUIC({ ctx });
  const local = new A.LocalResolver();

  /* --------------------------------------------------------------- acts */
  ui.defineAct(A.defineAct({
    name: 'add_item', phrases: ['add', 'put on the list'],
    slots: { item: { primitive: 'chip', options: () => ITEMS, required: true, order: 1 } },
    radius: 'self',
    commit: (f) => { db.list.push(f.item); return { id: 'i' + db.list.length }; },
    undo: () => { db.list.pop(); },
  }));

  ui.defineAct(A.defineAct({
    name: 'assign_errand', phrases: ['picks up', 'assign', 'grabs'],
    slots: {
      assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      errand:   { primitive: 'chip', options: () => ERRANDS, required: true, order: 2 },
      due:      { primitive: 'when', resolve: resolveWhen, order: 3 },
    },
    radius: { max: 'other-person', of: (f, c) => (f.assignee && f.assignee.id === c.actor.id ? 'self' : 'other-person') },
    commit: (f) => { db.errands.push(f); return { id: 'e' + db.errands.length }; },
    undo: () => { db.errands.pop(); },
    effects: [{
      name: 'notify',
      when: (f, c) => !!f.assignee && f.assignee.id !== c.actor.id,
      run: () => { log('notification sent', 'effect'); },
      radius: 'other-person', reversible: true, deferrable: true, reach: () => 1,
    }],
  }));

  ui.defineAct(A.defineAct({
    name: 'reschedule_errand', phrases: ['move', 'reschedule', 'push'],
    slots: {
      target: { primitive: 'objectCard', options: () => QUEUE, required: true, order: 1 },
      when:   { primitive: 'when', resolve: resolveWhen, required: true, order: 2 },
    },
    radius: {
      max: 'external',
      of: (f, c) => (f.when && (f.when.at - c.now.getTime()) / 6e4 < 7 ? 'external' : 'shared'),
    },
    commit: (f) => {
      const prev = db.queue[f.target].at;
      db.queue[f.target].at = f.when.at;
      return { id: f.target, previous: prev };
    },
    undo: (r) => { db.queue[r.id].at = r.previous; },
  }));

  ui.defineAct(A.defineAct({
    name: 'settle_up', phrases: ['pay', 'send', 'settle up', 'pay back'],
    slots: {
      payee:  { primitive: 'face', options: () => PEOPLE, required: true, order: 1 },
      amount: { primitive: 'quantity', resolve: resolveAmount, required: true, order: 2 },
    },
    radius: 'external',
    commit: (f) => { db.paid.push(f); return { id: 'p' + db.paid.length }; },
    effects: [{
      name: 'transfer', run: () => { log('money moved — irreversible', 'effect'); },
      radius: 'external', reversible: false, deferrable: false,
    }],
  }));

  /* --------------------------------------------------------------- view */
  const CIRC = 389.6;
  let run = null, said = '', pending = null;

  function log(msg, kind) {
    const el = document.createElement('div');
    const t = new Date();
    el.innerHTML = '<span class="t">' + String(t.getMinutes()).padStart(2, '0') + ':' +
      String(t.getSeconds()).padStart(2, '0') + '</span><span class="m">' +
      (kind ? '<b>' + kind + '</b> ' : '') + msg + '</span>';
    const box = $('log');
    box.prepend(el);
    while (box.children.length > 60) box.lastChild.remove();
  }

  function fmt(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object' && v.label) return v.label;
    if (typeof v === 'number') return String(v);
    return String(v);
  }

  function render() {
    const s = run ? run.state() : null;
    const orb = $('orb'), arc = $('arc');

    $('phase').textContent = s ? s.status : 'idle';
    $('utter').innerHTML = said ? said.replace(/</g, '&lt;') : '<span class="none">nothing said yet</span>';

    orb.className = 'orb';
    if (s) {
      if (s.status === 'hold') orb.classList.add('holding');
      else if (s.status === 'settled') orb.classList.add('done');
      else if (s.status === 'explicit' || s.status === 'frozen') orb.classList.add('blocked');
      else orb.classList.add('listening');
    }

    if (s && s.status === 'hold' && run.holdDurationMsValue > 0) {
      const frac = Math.max(0, Math.min(1, (s.holdRemainingMs || 0) / run.holdDurationMsValue));
      arc.setAttribute('stroke-dashoffset', String(CIRC * (1 - frac)));
      arc.style.stroke = 'var(--hold)';
      $('ms').textContent = Math.round(s.holdRemainingMs || 0) + 'ms';
    } else if (s && s.status === 'settled') {
      arc.setAttribute('stroke-dashoffset', '0'); arc.style.stroke = 'var(--ok)'; $('ms').textContent = '';
    } else {
      arc.setAttribute('stroke-dashoffset', String(CIRC)); $('ms').textContent = '';
    }

    /* slots */
    const box = $('slots'); box.innerHTML = '';
    if (s) {
      for (const name of s.visible) {
        const sl = s.slots[name]; if (!sl) continue;
        const d = document.createElement('div');
        d.className = 'slot' + (sl.status === 'filled' ? '' : ' empty') + (sl.provisional ? ' prov' : '') +
          (s.focus === name ? ' focus' : '');
        d.innerHTML = '<span class="k">' + name + (sl.provisional ? ' · unsure' : '') + '</span><span class="v">' +
          (sl.status === 'filled' ? fmt(sl.value) : '—') + '</span>';
        box.appendChild(d);
      }
    }

    /* verdict */
    const v = $('verdict'); v.innerHTML = '';
    if (s) {
      const add = (cls, txt) => { const p = document.createElement('span'); p.className = 'pill ' + cls; p.textContent = txt; v.appendChild(p); };
      if (s.radius) add(s.radius === 'external' ? 'stop' : s.radius === 'self' ? 'ok' : 'hold', s.radius);
      if (s.status === 'hold') add('hold', 'silence will commit');
      if (s.status === 'explicit') add('stop', 'needs an explicit yes');
      if (s.status === 'settled') add('ok', 'committed');
      if (s.status === 'frozen') add('prov', 'frozen — nothing changed');
      const why = document.createElement('div'); why.className = 'why';
      if (s.status === 'explicit') {
        why.textContent = s.radius === 'external'
          ? 'External radius: nothing here can be taken back once it happens, so silence can never commit it.'
          : 'Attention gate failed — ' + (s.gateFailures || []).join('; ') + '.';
        v.appendChild(why);
      } else if (s.status === 'resolving' && s.focus) {
        why.textContent = 'Waiting on “' + s.focus + '”.';
        v.appendChild(why);
      }
    }

    /* actions */
    const a = $('actions'); a.innerHTML = '';
    if (s && s.status === 'explicit') {
      const b = document.createElement('button'); b.className = 'danger'; b.textContent = 'Yes, do it';
      b.onclick = () => { run.assent().then(render); }; a.appendChild(b);
      const c = document.createElement('button'); c.className = 'ghost'; c.textContent = 'Cancel';
      c.onclick = () => { run.discard(); render(); }; a.appendChild(c);
    }
    if (s && run && run.undoAvailable) {
      const b = document.createElement('button'); b.textContent = 'Undo';
      b.onclick = () => { run.undo().then(render); }; a.appendChild(b);
    }
    if (s && s.status === 'frozen') {
      const b = document.createElement('button'); b.className = 'ghost'; b.textContent = 'Resume';
      b.onclick = () => { run.resume(); render(); }; a.appendChild(b);
    }

    renderReadout(s);
  }

  function renderReadout(s) {
    const r = $('readout');
    if (!s) { r.innerHTML = '<div class="row"><span class="key">act</span><span class="val">— idle —</span></div>'; return; }
    const cls = s.status === 'hold' ? 'hold' : s.status === 'settled' ? 'ok'
      : (s.status === 'explicit' || s.status === 'frozen') ? 'stop' : 'prov';
    let h = '';
    const row = (k, val, c) => { h += '<div class="row"><span class="key">' + k + '</span><span class="val ' + (c || '') + '">' + val + '</span></div>'; };
    row('act', s.act || '—');
    row('status', s.status, cls);
    row('phase', s.phase);
    row('radius', s.radius || '—', s.radius === 'external' ? 'stop' : '');
    row('assent', s.assent || 'none', s.assent === 'silence' ? 'hold' : s.assent ? 'stop' : '');
    if (s.status === 'hold') row('hold', Math.round(s.holdRemainingMs || 0) + ' / ' + run.holdDurationMsValue + 'ms', 'hold');
    row('outbox', String(s.outbox));
    h += '<hr>';
    for (const name of Object.keys(s.slots)) {
      const sl = s.slots[name];
      const val = sl.status === 'filled' ? fmt(sl.value) : sl.status;
      const meta = sl.status === 'filled'
        ? ' <span class="key">· ' + (sl.source || '?') + (sl.provisional ? ' · provisional' : ' · confirmed') + '</span>'
        : '';
      row(name, val + meta, sl.provisional ? 'prov' : '');
    }
    if (s.gateFailures && s.gateFailures.length) {
      h += '<hr><div class="row"><span class="key">gate</span><span class="val fail">' +
        s.gateFailures.join('<br>') + '</span></div>';
    }
    r.innerHTML = h;
  }

  /* ------------------------------------------------------------- engine */
  ui.on((e) => {
    if (e.type === 'hold-start') log('HOLD ' + e.ms + 'ms at ' + e.radius, 'hold');
    else if (e.type === 'hold-cancel') log(e.reason, 'cancel');
    else if (e.type === 'commit') log('committed ' + e.act, 'commit');
    else if (e.type === 'undo') log('undone — outbox discarded', 'undo');
    else if (e.type === 'frozen') log(e.reason + ' — preview frozen', 'freeze');
    else if (e.type === 'blocked') log(e.reason, 'blocked');
    else if (e.type === 'discarded') log('discarded', 'veto');
  });

  function hear(text) {
    said = text;
    if (pending) { clearTimeout(pending); pending = null; }
    const acts = ui.definitions;
    const d = A.pickAct(local.scoreSync(text, acts, ctx(), optionsFor));

    if (d.kind === 'none') { run = null; log('no act matched “' + text + '”', 'route'); render(); return; }
    if (d.kind === 'narrow') { log('tie between ' + d.acts.join(' / ') + ' — would NARROW over acts', 'route'); }

    const name = d.kind === 'start' ? d.act : d.acts[0];
    log('routed to ' + name + ' (' + d.scores[0].score.toFixed(2) + ')', 'route');

    run = ui.start(name);
    const def = ui.definitions.find((x) => x.name === name);
    const fills = local.fillSync(text, def, {}, ctx(), optionsFor);
    for (const slot of Object.keys(fills)) run.offer(slot, fills[slot], 'spoken');

    /* Tier 1 stand-in: a calibrated model confirming an unsure local fill. */
    const st = run.state();
    const unsure = Object.keys(st.slots).filter((k) => st.slots[k].provisional);
    if (state.model && unsure.length) {
      log('asking the model about ' + unsure.join(', '), 'tier 1');
      pending = setTimeout(() => {
        pending = null;
        if (!run || run.status === 'settled' || run.status === 'discarded') return;
        for (const k of unsure) {
          const c = run.slots[k] && run.slots[k].candidates;
          if (c && c[0]) run.setValue(k, c[0].value, 'model');
        }
        log('model confirmed', 'tier 1');
        render();
      }, 450);
    } else if (unsure.length) {
      log('model unreachable — staying provisional', 'degraded');
    }
    render();
  }

  /* --------------------------------------------------------------- wire */
  const SCRIPT = [
    ['add milk', 'self'],
    ['Sam picks up the parcel Friday', 'other'],
    ['move the pharmacy run to Saturday', 'shared'],
    ['pay Sam back twenty dollars', 'external'],
    ['Sammy picks up the parcel', 'unsure name'],
    ['move the pharmacy run to now', 'time flips it'],
  ];
  const chips = $('chips');
  SCRIPT.forEach(([text, tag]) => {
    const b = document.createElement('button');
    b.innerHTML = '“' + text + '”<span class="r">' + tag + '</span>';
    b.onclick = () => { $('input').value = text; hear(text); };
    chips.appendChild(b);
  });

  $('sayform').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const t = $('input').value.trim();
    if (t) hear(t);
  });
  $('sayno').onclick = () => {
    if (run && ['hold', 'resolving', 'explicit'].indexOf(run.status) >= 0) { run.freeze('bare negation'); render(); }
  };
  $('clearlog').onclick = () => { $('log').innerHTML = ''; };

  function bindToggle(id, key, wrapId) {
    const el = $(id);
    el.addEventListener('change', () => {
      state[key] = el.checked;
      $(wrapId).classList.toggle('off', !el.checked);
      if (run && run.status !== 'settled' && run.status !== 'discarded') { run.evaluate(); render(); }
    });
  }
  bindToggle('model', 'model', 'tg-model');
  bindToggle('looking', 'looking', 'tg-look');
  $('slow').addEventListener('change', () => { state.slow = $('slow').checked; $('tg-review').classList.toggle('off', !$('slow').checked); });

  (function loop() { if (run && (run.status === 'hold' || run.undoAvailable)) render(); requestAnimationFrame(loop); })();

  log('engine ready — 4 acts registered', 'boot');
  render();
})();
</script>
