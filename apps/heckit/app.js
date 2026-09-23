<script>
(function () {
  const A = window.AIUIC, $ = (id) => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ===================================================================== sky
     One canvas behind everything: starfield, orb, memory streaks, and the
     constellation that forms while it thinks. Mode-driven so it reads as one
     continuous object rather than four separate effects. */
  const cv = $('sky'), g = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0;
  let mode = 'idle', t = 0, pulse = 0;
  const stars = [], streaks = [], nodes = [];

  const zoneEl = document.querySelector('.orbzone');

  function size() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (stars.length === 0) {
      for (let i = 0; i < 190; i++) {
        stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.15 + .25,
                     a: Math.random() * .5 + .12, s: Math.random() * .012 + .002 });
      }
    }
    place();
  }

  /* Read the orb's home from the DOM, every frame. Fonts, panels and phone
     rotation all move it, and a stranded orb is the worst possible bug here. */
  function place() {
    const z = zoneEl.getBoundingClientRect();
    if (!z.width) return;
    cx = z.left + z.width / 2; cy = z.top + z.height / 2;
    R = z.width * 0.40;
  }
  addEventListener('resize', size);
  addEventListener('orientationchange', size);

  function addStreak() {
    const ang = Math.random() * Math.PI * 2, d = R * (2.6 + Math.random() * 1.5);
    streaks.push({ ang, d, d0: d, life: 1, hue: Math.random() < .5 ? 'cy' : 'am' });
  }
  function addNode(label) {
    const ang = -Math.PI / 2 + nodes.length * 2.399963;
    nodes.push({ ang, rad: R * (1.42 + (nodes.length % 3) * 0.16), spin: (Math.random() - .5) * .00035,
                 born: t, label: label || '' });
  }

  function draw() {
    t++;
    place();
    g.clearRect(0, 0, W, H);

    /* starfield */
    for (const s of stars) {
      s.y += s.s / 100; if (s.y > 1) s.y = 0;
      g.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 0.01 + s.x * 40));
      g.fillStyle = '#cfd6ff';
      g.beginPath(); g.arc(s.x * W, s.y * H, s.r, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;

    const busy = mode === 'thinking';
    pulse += ((busy ? 1 : 0) - pulse) * 0.03;
    const breathe = 1 + Math.sin(t * (busy ? .05 : .018)) * (busy ? .028 : .014);
    const r = R * breathe;

    /* constellation */
    if (nodes.length) {
      for (const n of nodes) n.ang += n.spin + (busy ? .0016 : .0004);
      const pts = nodes.map((n) => ({
        x: cx + Math.cos(n.ang) * n.rad, y: cy + Math.sin(n.ang) * n.rad,
        a: Math.min(1, (t - n.born) / 60),
      }));
      g.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist > R * 1.5) continue;
          const a = (1 - dist / (R * 1.5)) * 0.32 * pts[i].a * pts[j].a * (0.45 + 0.55 * pulse);
          g.strokeStyle = 'rgba(185,140,255,' + a.toFixed(3) + ')';
          g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[j].x, pts[j].y); g.stroke();
        }
      }
      for (const p of pts) {
        const rr = 2.1 + pulse * 1.1;
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 5);
        gr.addColorStop(0, 'rgba(210,190,255,' + (0.95 * p.a) + ')');
        gr.addColorStop(1, 'rgba(185,140,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, rr * 5, 0, 6.283); g.fill();
      }
    }

    /* streaks of new knowledge falling into the orb */
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.d -= (s.d - r * 0.9) * 0.055;
      s.life -= 0.012;
      if (s.life <= 0 || s.d < r * 1.02) { streaks.splice(i, 1); continue; }
      const x1 = cx + Math.cos(s.ang) * s.d, y1 = cy + Math.sin(s.ang) * s.d;
      const x2 = cx + Math.cos(s.ang) * (s.d + R * 0.5), y2 = cy + Math.sin(s.ang) * (s.d + R * 0.5);
      const grd = g.createLinearGradient(x1, y1, x2, y2);
      const col = s.hue === 'cy' ? '143,232,255' : '185,140,255';
      grd.addColorStop(0, 'rgba(' + col + ',' + (0.85 * s.life).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(' + col + ',0)');
      g.strokeStyle = grd; g.lineWidth = 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }

    /* the orb */
    g.globalCompositeOperation = 'lighter';

    const halo = g.createRadialGradient(cx, cy, r * 0.45, cx, cy, r * 2.9);
    halo.addColorStop(0, 'rgba(120,196,255,' + (0.30 + pulse * 0.18).toFixed(3) + ')');
    halo.addColorStop(0.38, 'rgba(150,110,240,' + (0.15 + pulse * 0.12).toFixed(3) + ')');
    halo.addColorStop(1, 'rgba(6,5,14,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, r * 2.9, 0, 6.283); g.fill();

    const body = g.createRadialGradient(cx - r * .30, cy - r * .34, r * .02, cx, cy, r);
    body.addColorStop(0,   'rgba(255,255,255,.98)');
    body.addColorStop(.14, 'rgba(206,236,255,.86)');
    body.addColorStop(.34, 'rgba(136,196,255,.60)');
    body.addColorStop(.60, 'rgba(126,104,226,.40)');
    body.addColorStop(.85, 'rgba(78,58,168,.22)');
    body.addColorStop(1,   'rgba(30,20,70,.04)');
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill();

    const core = g.createRadialGradient(cx - r * .30, cy - r * .34, 0, cx - r * .30, cy - r * .34, r * .40);
    core.addColorStop(0, 'rgba(255,255,255,.80)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.beginPath(); g.arc(cx - r * .30, cy - r * .34, r * .40, 0, 6.283); g.fill();

    g.globalCompositeOperation = 'source-over';

    g.strokeStyle = 'rgba(200,225,255,' + (0.34 + pulse * 0.26).toFixed(3) + ')';
    g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, r * 1.015, 0, 6.283); g.stroke();

    requestAnimationFrame(draw);
  }

  /* ================================================================= engine */
  const mem = [];              // what it has learned
  let goalText = '', domain = 'default';

  const ctx = () => ({
    actor: { id: 'you', basePauseMs: 850 },
    attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
    reachLimit: 1, undoWindowMs: 4000,
  });
  const ui = A.createAIUIC({ ctx });

  const noSlots = () => [];
  ui.defineAct(A.defineAct({
    name: 'set_goal',
    slots: { goal: { primitive: 'ghostField', fill: 'local', options: noSlots, required: true, order: 1 } },
    radius: 'self',
    commit: (f) => { goalText = String(f.goal); return { id: 'goal' }; },
    undo: () => { goalText = ''; },
  }));
  ui.defineAct(A.defineAct({
    name: 'record_answer',
    slots: {
      question: { primitive: 'objectCard', options: noSlots, required: true, order: 1 },
      answer: { primitive: 'ghostField', fill: 'local', options: noSlots, required: true, order: 2 },
    },
    radius: 'self',
    commit: (f) => { mem.push({ k: f.question.key, v: String(f.answer) }); return { id: 'm' + mem.length }; },
    undo: () => { mem.pop(); },
  }));
  ui.defineAct(A.defineAct({
    name: 'accept_plan',
    slots: { plan: { primitive: 'objectCard', options: noSlots, required: true, order: 1 } },
    radius: 'shared',
    commit: () => ({ id: 'plan' }), undo: () => {},
  }));
  /* The one act the contract refuses to let silence commit. */
  ui.defineAct(A.defineAct({
    name: 'automate_transfer',
    slots: { amount: { primitive: 'quantity', options: noSlots, required: true, order: 1 } },
    radius: 'external',
    commit: () => ({ id: 'tx' }),
    effects: [{ name: 'bank', run: () => {}, radius: 'external', reversible: false, deferrable: false }],
  }));

  /* ================================================================== script
     Question banks stand in for the adaptive generator. In the real build this
     is one Jev call per turn choosing the next question from what is still
     unknown — a Choice over the gaps, not free text. */
  const BANKS = {
    money: [
      ['income',  'Roughly what lands in your account each month?'],
      ['leak',    'What do you spend on that you would defend hardest?'],
      ['slack',   'At the end of a normal month, what is left?'],
      ['history', 'Have you tried saving before? What happened?'],
      ['quit',    'What would make you quit this in three weeks?'],
    ],
    body: [
      ['now',     'What does a normal week of moving look like right now?'],
      ['when',    'What time of day are you actually free?'],
      ['hate',    'What kind of exercise do you quietly hate?'],
      ['history', 'Last time you got fit, what made it stop?'],
      ['quit',    'What would make you quit this in three weeks?'],
    ],
    work: [
      ['now',     'What do you do all day at the moment?'],
      ['gap',     'What can the people you want to be hired by do that you cannot?'],
      ['hours',   'How many real hours a week can you give this?'],
      ['history', 'What have you already tried?'],
      ['quit',    'What would make you quit this in three weeks?'],
    ],
    default: [
      ['why',     'Why this, and why now?'],
      ['shape',   'What would done actually look like?'],
      ['hours',   'How many hours a week can you really give it?'],
      ['history', 'What have you tried before, and what stopped it?'],
      ['quit',    'What would make you quit this in three weeks?'],
    ],
  };
  const LABEL = { income:'income', leak:'spending', slack:'margin', history:'history', quit:'risk',
                  now:'baseline', when:'window', hate:'aversion', gap:'gap', hours:'capacity',
                  why:'motive', shape:'target', goal:'goal' };

  const PLANS = {
    money: (m) => ([
      ['Every morning', 'Move the leftover to a second account before you see it', 'Margin disappears when it stays visible'],
      ['Sundays, 20 min', 'Open last week and name every charge over $20', 'You said ' + short(m.leak) + ' is the one you defend — this is where it gets decided'],
      ['Week 2',  'Cancel or halve the two subscriptions you never opened', 'Fastest money you will ever find'],
      ['Week 4',  'Raise the automatic transfer by $25', 'Small enough that you will not notice; you said you quit when it hurts'],
      ['Week 8',  'Check the number against the goal, out loud', 'You said ' + short(m.history) + ' — this is the point it usually stops'],
    ]),
    body: (m) => ([
      ['Mon / Thu', '25 minutes, before anything else happens', 'You said you are free ' + short(m.when)],
      ['Every day',  'Walk while the first call of the day happens', 'Free volume, no willpower'],
      ['Week 2',     'Add one set to whatever you did last time', 'Progression you cannot fail'],
      ['Week 3',     'Skip a day on purpose, keep the next one', 'You said ' + short(m.history) + ' — planned misses are how it survives'],
      ['Week 6',     'Same session, same clock, no negotiation', 'It stops being a decision'],
    ]),
    work: (m) => ([
      ['Weeknights', 'One hour on the gap you named, nothing else', 'You have ' + short(m.hours)],
      ['Fridays',    'Ship something small in public', 'Proof beats preparation'],
      ['Week 2',     'Message one person doing the job you want', 'You are not asking for a job, you are asking what they read'],
      ['Week 4',     'Rewrite what you show people around the last three things you shipped', 'Evidence, not adjectives'],
      ['Week 8',     'Apply to five, badly, on purpose', 'You said ' + short(m.history)],
    ]),
    default: (m) => ([
      ['Daily',  'Fifteen minutes, same time, no exceptions', 'Rhythm before intensity'],
      ['Weekly', 'Write down one line on what moved', 'You cannot steer what you do not look at'],
      ['Week 2', 'Cut the version of this you were doing for other people', 'You said ' + short(m.why)],
      ['Week 4', 'Raise the bar by one notch', 'Only once the rhythm holds'],
      ['Week 8', 'Decide out loud whether this is still the goal', 'You said ' + short(m.quit)],
    ]),
  };
  const short = (s) => { s = (s || 'that').trim(); return s.length > 42 ? s.slice(0, 40).trim() + '…' : s; };

  function classify(text) {
    const t = A.normalize(text);
    if (/\b(money|broke|save|saving|debt|rent|budget|house|afford|rich|spend)\b/.test(t)) return 'money';
    if (/\b(fit|gym|weight|run|health|healthy|strong|sleep|train|body)\b/.test(t)) return 'body';
    if (/\b(job|career|hired|work|promotion|business|freelance|clients|skill)\b/.test(t)) return 'work';
    return 'default';
  }

  /* ==================================================================== view */
  const CIRC = 728.8;
  let run = null, stage = 'idle', qi = 0, bank = [], holdRaf = 0;

  function setStatus(txt, cls) { $('statust').textContent = txt; $('status').className = 'status ' + (cls || ''); }
  function setGate(txt, cls) { $('gate').textContent = txt; $('gate').className = 'gate ' + (cls || 'quiet'); }
  function setSay(txt) { $('say').textContent = txt; }

  function paintRing() {
    const s = run && run.state();
    if (s && s.status === 'hold' && run.holdDurationMsValue) {
      const f = Math.max(0, Math.min(1, (s.holdRemainingMs || 0) / run.holdDurationMsValue));
      $('arc').setAttribute('stroke-dashoffset', String(CIRC * (1 - f)));
      $('ms').textContent = Math.round(s.holdRemainingMs || 0) + 'ms · say nothing';
      holdRaf = requestAnimationFrame(paintRing);
    } else {
      $('arc').setAttribute('stroke-dashoffset', String(CIRC));
      $('ms').textContent = '';
      holdRaf = 0;
    }
  }
  function armRing() { if (!holdRaf) holdRaf = requestAnimationFrame(paintRing); }

  function renderMem() {
    const box = $('mem'); box.innerHTML = '';
    for (const m of mem) {
      const d = document.createElement('div'); d.className = 'memline';
      d.innerHTML = '<span class="k">' + (LABEL[m.k] || m.k) + '</span><span class="v"></span>';
      d.querySelector('.v').textContent = m.v;
      box.appendChild(d);
    }
    $('memCount').textContent = mem.length + (mem.length === 1 ? ' fact' : ' facts');
    $('memPane').classList.toggle('on', mem.length > 0);
    box.scrollTop = box.scrollHeight;
  }

  function hints(list) {
    const h = $('hint'); h.innerHTML = '';
    if (!list.length) return;
    const lead = document.createElement('span'); lead.className = 'lead'; lead.textContent = 'or try';
    h.appendChild(lead);
    list.forEach((txt) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = txt;
      b.onclick = () => { $('input').value = txt; $('form').requestSubmit(); };
      h.appendChild(b);
    });
  }

  /* ==================================================================== flow */
  function startHold(r, onDone) {
    run = r; armRing();
    setStatus('holding', 'hold');
    setGate('Stay quiet and it commits. Type to take it back.', 'warm');
    const off = ui.on((e) => {
      if (e.type === 'commit') { off(); onDone(); }
      if (e.type === 'frozen') { off(); setGate('Frozen. Nothing was written.', 'quiet'); setStatus('waiting'); }
    });
  }

  function askNext() {
    if (qi >= bank.length) return think();
    stage = 'interview';
    const [key, q] = bank[qi];
    setSay(q);
    setStatus('listening', 'live');
    setGate('Answer in your own words.', 'quiet');
    $('input').placeholder = 'say it however you say it';
    $('input').focus();
    hints([]);
  }

  function answer(text) {
    const [key, q] = bank[qi];
    const r = ui.start('record_answer');
    r.setValue('question', { key, q }, 'model');
    r.setValue('answer', text, 'spoken');
    addStreak(); addStreak();
    startHold(r, () => {
      renderMem(); addNode(key);
      qi++;
      setStatus('listening', 'live');
      askNext();
    });
  }

  function think() {
    stage = 'thinking'; mode = 'thinking';
    setSay('Working out what would actually hold.');
    setStatus('thinking', 'think');
    setGate('Reading everything you said against everything that usually fails.', 'quiet');
    $('input').disabled = true;
    for (let i = 0; i < 9; i++) setTimeout(addStreak, i * 130);
    setTimeout(buildPlan, reduce ? 300 : 3000);
  }

  function buildPlan() {
    mode = 'idle';
    const m = {}; for (const x of mem) m[x.k] = x.v;
    const steps = (PLANS[domain] || PLANS.default)(m);

    $('goalBox').innerHTML = '<div class="goalcard"><div class="lab">Goal</div><div class="g"></div></div>';
    $('goalBox').querySelector('.g').textContent = goalText;
    $('planTitle').textContent = 'Plan';
    $('planMeta').textContent = steps.length + ' steps · drafted on device';

    const box = $('plan'); box.innerHTML = '';
    steps.forEach((s, i) => {
      const d = document.createElement('div'); d.className = 'step';
      d.style.animationDelay = (reduce ? 0 : i * 110) + 'ms';
      d.innerHTML = '<span class="when"></span><span><span class="what"></span><span class="why"></span></span>';
      d.querySelector('.when').textContent = s[0];
      d.querySelector('.what').textContent = s[1];
      const why = d.querySelector('.why'); why.textContent = s[2];
      why.style.display = 'block';
      box.appendChild(d);
    });
    $('planPane').classList.add('on');

    setSay('Here is the year, broken into things you can actually do.');
    setStatus('waiting');
    stage = 'plan';

    const r = ui.start('accept_plan');
    r.setValue('plan', { id: 'p1' }, 'touched');
    startHold(r, () => {
      setStatus('committed', 'done');
      setGate('Plan saved. Nobody asked you to press anything.', 'ok');
      setTimeout(offerTransfer, 1400);
    });
  }

  function offerTransfer() {
    stage = 'external';
    setSay('One more. Shall I set the transfer to move $25 every payday?');
    const r = ui.start('automate_transfer');
    r.setValue('amount', 25, 'model');
    run = r;
    setStatus('needs a yes', 'hold');
    setGate('Money leaves the account, so silence will not do it. This one needs a yes.', 'warm');
    $('input').disabled = true;

    const cta = $('cta'); cta.hidden = false; cta.innerHTML = '';
    const yes = document.createElement('button'); yes.className = 'yes'; yes.textContent = 'Yes, set it up';
    yes.onclick = () => { r.assent().then(() => {
      cta.hidden = true; setStatus('committed', 'done'); addNode('tx');
      setSay('Done. Everything above runs itself now.');
      setGate('That is the whole loop: you spoke once, and nothing you did not agree to happened.', 'ok');
      $('input').disabled = false; $('input').placeholder = 'say anything else'; stage = 'done';
      hints(['start over']);
    }); };
    const no = document.createElement('button'); no.className = 'no'; no.textContent = 'Not yet';
    no.onclick = () => {
      r.discard(); cta.hidden = true; setStatus('waiting');
      setSay('Left alone.'); setGate('Nothing moved.', 'quiet');
      $('input').disabled = false; stage = 'done'; hints(['start over']);
    };
    cta.append(yes, no);
  }

  function begin(text) {
    goalText = text; domain = classify(text); bank = BANKS[domain] || BANKS.default;
    const r = ui.start('set_goal');
    r.setValue('goal', text, 'spoken');
    addStreak(); addStreak(); addStreak();
    setSay('Got it. Five questions, then I will build the year.');
    startHold(r, () => {
      mem.push({ k: 'goal', v: text }); renderMem(); addNode('goal');
      qi = 0; askNext();
    });
  }

  /* ==================================================================== wire */
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('input').value.trim(); if (!v) return;
    $('input').value = '';
    if (stage === 'idle') return begin(v);
    if (stage === 'interview') return answer(v);
    if (stage === 'done') { if (/start over|restart|again/i.test(v)) location.reload(); return; }
  });

  $('input').addEventListener('input', () => {
    if (run && run.status === 'hold') { run.freeze('you started talking again'); setStatus('waiting'); }
  });

  hints(['I want to stop being broke by summer', 'get properly fit this year', 'change careers within a year']);
  setStatus('listening', 'live');
  size(); requestAnimationFrame(draw);
  setTimeout(size, 120);
})();
</script>
