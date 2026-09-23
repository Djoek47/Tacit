# AIUIC

**Artificial Intelligence Interface Control.** The layer between *"the system knows what the user wants"* and *"the write happened"*: act lifecycle, commit contract, assent, repair.

AIUIC does not generate UI. A2UI, Open-JSON-UI and json-render already do that. AIUIC is the layer above them, and it answers the question none of them answer: **how does the human accept, reject, or correct what the AI proposed?**

Spec: v0.2.

## Packages

| Package | Status | Holds |
| --- | --- | --- |
| `@intermenu/aiuic-core` | building | acts, slots, beats, commit contract, assent, repair, outbox |
| `@intermenu/aiuic-resolve` | not started | fuzzy matcher, numbers, dates, spans, act routing |
| `@intermenu/aiuic-tools` | not started | `toolSchema()` for Anthropic / OpenAI / JSON Schema |
| `@intermenu/aiuic-rn` | not started | React Native presenter + primitives |
| `@intermenu/aiuic-attention` | not started | iOS attention signals |
| `@intermenu/aiuic-devtools` | not started | act inspector, HOLD timeline, replay |

`aiuic-core` imports nothing from the others. That is how the boundary gets tested.

## The core rule

An act declares what it costs to be wrong. That, not a hand-maintained list, decides how assent is obtained.

```
effectiveRadius = max(commitRadius, ...effects.map(e => e.reversible ? e.radius : 'external'))
reach > reachLimit                     → external
radius === 'external' | gate fails     → explicit assent only
otherwise                              → HOLD for basePause(actor) × radiusMultiplier(write)
```

Silence commits only inside that HOLD, and only when the attention gate passes: app foregrounded, device unlocked, proximity clear, mic live, and the user having touched or spoken during **this** act. Any unknown signal counts as failed.

## Running the core

```bash
cd packages/core
npm install
npm run typecheck
npm test
```

Everything is tested against an injectable `FakeClock`, so no device and no audio are needed.

## Resolution tiers

| Tier | What | Latency | Network | Fills |
| --- | --- | --- | --- | --- |
| 0 | local matcher | ~0 ms | no | names, chips, anything in a declared option list |
| 1 | Jev (TypeSafe System One) | 70–500 ms | **yes** | which act; which option, with a calibrated distribution |
| 2 | LLM | seconds | yes | free text, novel intent, escalation |

Jev is a hosted, closed model, so it is tier 1 and never tier 0. `TieredResolver` refuses a non-local tier 0 at construction, and its staged calls hand back the local answer synchronously so nothing paints behind a network call.

## Demo

`demo/index.html` bundles `aiuic-core` + `aiuic-resolve` into one self-contained page — the real
engine, not a mockup. Four acts, one per blast radius. Rebuild after a core change:

```bash
npx esbuild demo/entry.ts --bundle --format=iife --global-name=AIUIC --minify --outfile=demo/aiuic.bundle.js
cat demo/page-head.html demo/page-body.html > demo/index.html
{ echo '<script>'; cat demo/aiuic.bundle.js; echo '</script>'; cat demo/app.js; } >> demo/index.html
```

## apps/heckit

The MVP surface: speak once, it interviews you, learns, thinks, and builds the year.
Runs `aiuic-core` + `aiuic-resolve` + `hepta` bundled into one page. Rebuild:

```bash
npx esbuild apps/heckit/entry.ts --bundle --format=iife --global-name=AIUIC \
  --target=es2020 --minify --outfile=apps/heckit/aiuic.bundle.js
cd apps/heckit && { cat head.html body.html; echo '<script>'; cat aiuic.bundle.js; \
  echo '</script>'; cat app.js; } > index.html
```

**Mocked, and marked in the source:** the question bank (a real build asks Jev to
choose the next question from the gaps), the plan text, and speech itself. Everything
underneath — acts, slots, blast radius, HOLD, the attention gate, the outbox — is the
real engine.
