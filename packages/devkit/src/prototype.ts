/**
 * A prototype from the proposal: one HTML file you can open, share, and test.
 *
 * "Ability to create a prototype from the proposal" — and the proposal itself
 * as "an intuitive mood board for all ideas". So the page has both: the board
 * on one side (what it is, who for, the mood, the colours, the references,
 * what it must do), the menu map with its problems, and a working stage where
 * every drafted act can be spoken to. The acts run against stand-ins that
 * record what they would have done, so the flow can be judged before a line
 * of the real app exists.
 *
 * Money and sending still ask for a yes here. A prototype that silently
 * "paid" someone would teach the wrong thing about the product.
 */

import type { Brief } from './brief.js';
import { mapMenus } from './menus.js';
import { draftFromBrief, type ActDraft } from './draft.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const PROTECTED = new Set(['#34D399', '#FB923C', '#F87171', '#06B6D4']);

function example(a: ActDraft): string {
  const sample: Record<string, string> = {
    chores: 'the dishes', groceries: 'milk', calendar: 'dinner', homework: 'maths', trips: 'the airport', rewards: 'a movie night',
  };
  // Said the way a person would: the thing, who for, when, how much.
  const kinds = Object.values(a.slots).map((s) => s.primitive);
  const parts = [a.phrases[0] ?? a.name.split('_')[0]];
  if (kinds.includes('ghostField')) parts.push(sample[a.domain ?? ''] ?? `the ${a.name.split('_').slice(1).join(' ') || 'first one'}`);
  if (kinds.includes('chip')) parts.push('option a');
  if (kinds.includes('face')) parts.push(a.radius === 'external' ? 'Maya' : 'for Maya');
  if (kinds.includes('when')) parts.push('tomorrow');
  if (kinds.includes('quantity')) parts.push('20 dollars');
  return parts.join(' ');
}

export function prototype(b: Brief, runtime: string): string {
  const d = draftFromBrief(b);
  const map = mapMenus(b.menus);
  const colour = b.design.colours.find((c) => !PROTECTED.has(c.toUpperCase())) ?? '#7C8BFF';
  const spec = {
    colour,
    acts: d.acts.map((a) => ({
      name: a.name, radius: a.radius, domain: a.domain, feature: a.feature, example: example(a), preview: a.preview,
      phrases: a.phrases,
      slots: Object.fromEntries(Object.entries(a.slots).map(([k, s]) => [k, { primitive: s.primitive, order: s.order, required: s.required, ...(s.catalog ? { catalog: s.catalog } : {}) }])),
    })),
  };

  const menuList = map.nodes.length
    ? `<ul class="map">${map.nodes.map((n) => {
        const issues = map.issues.filter((i) => i.menu === n);
        const to = map.edges.filter(([a]) => a === n).map(([, t]) => t);
        const depth = map.depth[n];
        return `<li><b>${esc(n)}</b>${depth !== undefined ? ` <span class="dim">${depth === 0 ? 'start' : `${depth} tap${depth === 1 ? '' : 's'} in`}</span>` : ''}${to.length ? ` → ${to.map(esc).join(', ')}` : ''}${issues.map((i) => `<div class="issue ${i.level}">${esc(i.message)}</div>`).join('')}</li>`;
      }).join('')}</ul>`
    : '<p class="dim">No menus described. That may be the point: on a stage, most menus are a sentence.</p>';

  const list = (xs: string[], empty: string) => xs.length ? `<ul>${xs.map((x) => `<li>${/^https?:\/\//.test(x) ? `<a href="${esc(x)}" target="_blank" rel="noopener">${esc(x)}</a>` : esc(x)}</li>`).join('')}</ul>` : `<p class="dim">${empty}</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(b.name || 'Prototype')}</title>
<style>
:root{color-scheme:dark;--g:#0B1220;--b:#111827;--u:#1B2434;--l:rgba(233,238,247,.09);--i:#E9EEF7;--d:#9AA6BB;--f:#6C7689;--c:${colour}}
*{box-sizing:border-box}html,body{background:var(--g);color:var(--i)}
body{margin:0;padding:0 16px;font:15px/1.55 "Bricolage Grotesque",system-ui,-apple-system,sans-serif}
.w{max-width:1180px;margin:0 auto;padding-block:24px 48px;display:grid;gap:18px;grid-template-columns:1fr}
@media(min-width:900px){.w{grid-template-columns:minmax(0,1fr) minmax(0,1.1fr)}}
h1{font-size:clamp(26px,4vw,38px);margin:0;letter-spacing:-.02em;text-wrap:balance}h2{font-size:15px;margin:0 0 8px}
.lbl{font:500 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--f)}
.panel{background:var(--b);border:1px solid var(--l);border-radius:20px;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
.dim{color:var(--d)}ul{margin:0;padding-left:18px}li{margin:3px 0}a{color:var(--c)}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{border:1px solid var(--l);border-radius:999px;padding:4px 10px;font-size:13px}
.sw{width:36px;height:36px;border-radius:10px;border:1px solid var(--l)}
.map{list-style:none;padding:0}.map li{padding:6px 0;border-bottom:1px solid var(--l)}
.issue{font-size:12.5px;margin-top:3px}.issue.error{color:#F87171}.issue.warn{color:#FB923C}.issue.note{color:var(--d)}
.stage{background:var(--g);border:1px solid var(--l);border-radius:24px;padding:16px;min-height:240px}
form{display:flex;gap:8px}input{flex:1;min-width:0;min-height:44px;border-radius:14px;border:1px solid var(--l);background:var(--g);color:var(--i);padding:0 12px;font:inherit}
button.say,button.scene{min-height:44px;border-radius:999px;border:1px solid var(--l);background:transparent;color:var(--i);padding:0 14px;font:inherit;cursor:pointer}
button.say{background:var(--i);color:var(--g);font-weight:600}
.scenes{display:flex;gap:8px;flex-wrap:wrap}.scene{font-size:13px;color:var(--d)}
.log{font:12.5px/1.6 ui-monospace,Menlo,monospace;color:var(--d);margin:0;padding-left:18px}
.draft li{font-size:13.5px}.draft .r{font:500 11px ui-monospace,Menlo,monospace;color:var(--c)}
</style></head><body><div class="w">
<section class="panel" aria-label="Mood board">
  <span class="lbl">The proposal</span>
  <h1>${esc(b.name || 'Untitled')}</h1>
  <p>${esc(b.purpose || '')}</p>
  ${b.audience ? `<p class="dim">For ${esc(b.audience)}</p>` : ''}
  ${b.design.mood.length ? `<div class="chips">${b.design.mood.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</div>` : ''}
  ${b.design.colours.length ? `<div class="chips">${b.design.colours.map((c) => `<span class="sw" style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')}</div>` : ''}
  ${b.design.fonts.length ? `<p class="dim">Type: ${b.design.fonts.map(esc).join(', ')}</p>` : ''}
  <h2>References</h2>${list(b.references, 'None yet.')}
  <h2>It must</h2>${list(b.expectations, 'No expectations written yet.')}
  <h2>Never</h2>${list(b.exceptions, 'No exceptions written yet.')}
  <h2>How the screens connect</h2>${menuList}
</section>
<section class="panel" aria-label="Prototype">
  <span class="lbl">Try it</span>
  <div class="stage"><div id="stage"></div></div>
  <form id="f" autocomplete="off"><input id="say" aria-label="Say something" placeholder="Say it the way you would"><button class="say" type="submit">Say</button></form>
  <div class="scenes" id="scenes"></div>
  <h2>What it would have done</h2><ol class="log" id="log"><li class="dim">Nothing yet.</li></ol>
  <h2>The drafted acts</h2>
  <ul class="draft">${d.acts.map((a) => `<li><b>${esc(a.name)}</b> <span class="r">${a.radius}</span> — ${esc(a.feature)}<br><span class="dim">${esc(a.why.join(' '))}</span></li>`).join('')}</ul>
</section>
</div>
<script>${runtime}</script>
<script>
(function(){
var R = window.HeptaRuntime, S = ${JSON.stringify(spec).replace(/</g, '\\u003c')};
var st = document.createElement('style'); st.textContent = R.stylesheet(); document.head.appendChild(st);
var log = document.getElementById('log'), first = true;
function note(t){ if(first){ log.innerHTML=''; first=false; } var li=document.createElement('li'); li.textContent=t; log.appendChild(li); }
var people = [{value:'maya',label:'Maya'},{value:'sam',label:'Sam'},{value:'alex',label:'Alex'}];
var generic = [{value:'a',label:'Option A'},{value:'b',label:'Option B'},{value:'c',label:'Option C'}];
var c = new R.Composer(), acts = [], n = 0;
S.acts.forEach(function(a){
  var cats = {}; Object.keys(a.slots).forEach(function(k){ var s=a.slots[k]; if(s.catalog){ cats[s.catalog] = function(){ return s.catalog==='people'?people:generic; }; } });
  c.register({ name: 'cap_'+a.name, describe: a.feature, radius: a.radius, catalogs: cats,
    run: function(f){ var id = a.name+':'+(++n); note(a.name.replace(/_/g,' ')+' — '+JSON.stringify(f)); return { id: id }; },
    undo: a.radius==='external' ? undefined : function(r){ note('undone: '+r.id); } });
  try { var def = c.compose({ name: a.name, capability: 'cap_'+a.name, phrases: a.phrases, slots: a.slots });
    if (a.domain) def.domain = a.domain; else def.domain = 'proto';
    def.preview = function(f){ return [a.preview.replace(/[{]([a-z0-9_]+)[}]/gi, function(_, k){ var v=f[k]; if(v===undefined) return '…'; if(v&&typeof v==='object'&&v.label) return v.label; var o=(def.slots[k].options?def.slots[k].options({}, {}):[]).find(function(x){return x.value===v;}); return o?o.label:String(v); }).split(' ').filter(Boolean).join(' ')]; };
    acts.push(def); } catch(e){ note('could not build '+a.name+': '+e.message); }
});
var said = '';
var app = R.createApp({ acts: acts, speculate: false, domains: { proto: { kicker: ${JSON.stringify((b.name || 'APP').toUpperCase().slice(0, 24))}, colour: S.colour } },
  ctx: function(){ return { now: new Date(), actor: { id: 'you', basePauseMs: 850 }, reachLimit: 1, undoWindowMs: 5000,
    attention: { foreground: true, unlocked: true, proximityClear: true, listening: true } }; } });
app.mount(new R.StagePresenter(document.getElementById('stage'), document, { said: function(){ return said; }, domains: { proto: { kicker: 'APP', colour: S.colour } } }));
function hear(t){ said = t; var r = app.hear(t); if(!r.act){ document.getElementById('stage').innerHTML = '<p style="color:#9AA6BB">Nothing in the proposal answers “'+t.replace(/[<&]/g,'')+'” yet. That may be a missing feature.</p>'; } }
app.ui.on(function(){ setTimeout(function(){ app.draw(); }, 0); });
(function loop(){ if (app.act && app.act.status==='hold') app.draw(); requestAnimationFrame(loop); })();
document.getElementById('f').addEventListener('submit', function(e){ e.preventDefault(); var v=document.getElementById('say').value.trim(); if(v) hear(v); });
var box = document.getElementById('scenes');
S.acts.forEach(function(a){ var btn=document.createElement('button'); btn.type='button'; btn.className='scene'; btn.textContent=a.example; btn.onclick=function(){ document.getElementById('say').value=a.example; hear(a.example); }; box.appendChild(btn); });
if (S.acts[0]) { document.getElementById('say').value = S.acts[0].example; hear(S.acts[0].example); }
})();
</script></body></html>`;
}
