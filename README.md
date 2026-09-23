# AIUIC + Hepta

**The AI proposes. Your silence approves. One word corrects it.**

Every framework for AI-driven interfaces answers the same question: *how does a model describe a
screen safely?* A2UI, Open-JSON-UI, json-render and the rest all solve it — catalogue of components,
model emits a tree, renderer draws it.

None of them answers the one after it: **how does the human accept, reject, or correct what it
proposed?** No commit model, no repair grammar, no notion of what a mutation costs if it is wrong.
That is this layer.

Spec **v0.3**. Eight packages, **156 tests**, four apps. `aiuic-core` has no dependencies.

---

## Packages

| Package | Owns | Tests |
| --- | --- | --- |
| `aiuic-core` | acts, slots, beats, blast radius, HOLD, attention gate, outbox, undo, speculation | 41 |
| `aiuic-resolve` | local matcher, grammar, act routing, span arbitration, tiering | 49 |
| `hepta` | seven tongues — speculation over partial speech | 10 |
| `aiuic-tools` | tool schemas generated from acts; applying a model's call | 12 |
| `aiuic-compose` | runtime act composition over a closed capability registry | 13 |
| `aiuic-memory` | stated facts; remembering and forgetting as acts | 10 |
| `aiuic-brand` | brand colour, measured legibility, initials marks | 7 |
| `aiuic-devtools` | why an act is not committing; recorder, timeline, linter | 14 |

`aiuic-core` imports nothing from the others. That is how the boundary gets tested.

```bash
npm test        # every suite
npm run typecheck
```

## Apps

| App | What it is |
| --- | --- |
| `apps/console/` | the concept page: compose an act from JSON, use it, then try six ways to break it |
| `apps/heckit/` | the product: speak once, it interviews, remembers, plans, composes |
| `apps/orb/` | voice: WebRTC to a realtime model, transcripts into Hepta, tools into the contract |
| `demo/` | the commit contract with its workings exposed — four acts, four radii |

```bash
OPENAI_API_KEY=sk-... node apps/orb/server.mjs     # → localhost:8787
```

Everything else is a static page. Rebuild any of them after a core change:

```bash
npx esbuild apps/<name>/entry.ts --bundle --format=iife --global-name=AIUIC \
  --target=es2020 --minify --outfile=apps/<name>/aiuic.bundle.js
cd apps/<name> && { cat head.html body.html; echo '<script>'; cat aiuic.bundle.js; \
  echo '</script>'; cat app.js; } > index.html
```

---

## The core rule

An act declares **what it costs to be wrong**. That, not a hand-maintained list of exceptions,
decides how consent is obtained.

```
live      = effects.filter(e => !e.when || e.when(filled, ctx))
effective = max(commitRadius(filled, ctx), ...live.map(e => e.reversible ? e.radius : 'external'))
reach > reachLimit                     → external
radius === 'external' | gate fails     → explicit assent only
otherwise                              → HOLD for basePause(actor) × radiusMultiplier(write)
```

Silence commits only inside that HOLD, and only when the attention gate passes: app foregrounded,
device unlocked, proximity clear, mic live, **and the user having touched or spoken during this
act**. Any unknown signal counts as failed.

That last clause does more work than it looks. An act filled entirely from defaults has had no
engagement, so a profile never finalizes itself because someone went quiet. Neither does a
system-initiated act — "you're late", "you're near that shop" — because silence from someone who
did not start the exchange is absence, not agreement.

## Resolution tiers

| Tier | What | Latency | Offline | Calibrated |
| --- | --- | --- | --- | --- |
| 0 | local matcher + grammar | ~0 ms | **yes** | yes |
| 0.5 | on-device option scorer (SemIf-class) | 30–80 ms | **yes** | **no** |
| 1 | hosted System One (Jev-class) | 70–500 ms | no | claimed |
| 2 | LLM | seconds | no | no |

`TieredResolver` refuses a non-local tier 0 at construction, and its staged calls hand back the
tier-0 answer synchronously. Local-first is a claim about order, and order is the one thing a plain
`await` destroys.

An uncalibrated score can fill a slot and can never confirm one — a softmax over option tokens
looks like confidence and is not.

## Composition

A model composes an **act**, not an interface: a name, slots from the closed primitive set, and
which registered capability it binds to.

> **A model cannot lower blast radius.** It never writes `commit`, `undo`, `effects` or `radius`.
> It picks a capability, and the capability's cost comes with it.

So an act called `just_a_little_one`, bound to `charge_card`, for four thousand dollars, comes out
`external`, refuses to silence-commit, and sixty seconds of quiet charges nothing. Open
`apps/console` and try it.

---

## What is still mocked, and where

- `apps/heckit/app.js` → the interview question bank, the plan copy, and `composeFor` (which stands
  in for a model emitting an `ActSpec`).
- Speech itself. `ui.hear(text)` takes a string; STT and TTS stay outside the SDK.
- `apps/orb/realtime.js` → the realtime event names were written against May 2026 knowledge. They
  are all in one `EVENTS` block. **Check them before the first live run.**
