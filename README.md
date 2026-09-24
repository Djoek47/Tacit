# AIUIC + Hepta

**The AI proposes. Your silence approves. One word corrects it.**

Every framework for AI-driven interfaces answers the same question: *how does a model describe a
screen safely?* A2UI, Open-JSON-UI, json-render and the rest all solve it — catalogue of components,
model emits a tree, renderer draws it.

None of them answers the one after it: **how does the human accept, reject, or correct what it
proposed?** No commit model, no repair grammar, no notion of what a mutation costs if it is wrong.
That is this layer.

Spec **v0.3**. Eleven packages, **220 tests**, five apps. `aiuic-core` has no dependencies.

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
| `aiuic-present` | the renderer boundary: one view, a text presenter and a DOM one | 15 |
| `aiuic-eui` | the visual language: tokens, domain rules as lint, the seven beats, one card | 34 |
| `aiuic-eval` | labelled suites, the false-confirm rate, reliability curves, threshold sweeps | 12 |

`aiuic-core` imports nothing from the others. That is how the boundary gets tested.

**Renderer-agnostic, concretely.** `toView()` turns a live act into everything a renderer needs and
nothing it has to work out — options resolved, values formatted, the preview sentence, which
controls are live. Two presenters ship against that one view: `TextPresenter` draws words,
`DomPresenter` drives elements. They are tested side by side on the same act, and neither restates
a rule. If a rule ever has to be repeated inside a presenter, the boundary is in the wrong place.

```bash
npm test        # every suite
npm run typecheck
npm run eval    # the seed suite, with numbers
```

## The number that decides whether any of this is safe

```
cases            28
routing          28/28  (100.0%)
confirmed right  39
confirmed WRONG  0      <- the only one that silence-commits a mistake
FALSE CONFIRM    0.0%
```

A confident miss is the one failure the contract cannot catch. A provisional
fill holds and waits; an empty slot asks; a narrowed slot offers two. Only a
slot filled **confidently and wrongly** silence-commits the wrong thing, and
the user finds out afterwards. Twenty-eight sentences is not enough to tune on
— a few hundred from real users is — but the harness is there and the number
is real.

## Apps

| App | What it is |
| --- | --- |
| `apps/console/` | the concept page: compose an act from JSON, use it, then try six ways to break it |
| `apps/heckit/` | the product: speak once, it interviews, remembers, plans, composes |
| `apps/orb/` | voice: WebRTC to a realtime model, transcripts into Hepta, tools into the contract |
| `apps/stage/` | the visual language: say something, break a design rule, read the material |
| `demo/` | the commit contract with its workings exposed — four acts, four radii |

```bash
OPENAI_API_KEY=sk-... node apps/orb/server.mjs     # → localhost:8787
```

The orb needs neither the key nor a microphone to exercise. Typing replays a
sentence word by word at speaking rate, down the same path a transcript takes,
so speculation is visible without granting anything — `window.speak(text, wpm)`
drives it from the console.

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

## The design language is lint

`aiuic-eui` is the Ultramax EUI visual language as a package: one mint, three
springs, four type roles, and the seven beats every act plays. The part worth
having is not the colours.

A domain says what an act in that part of the app is *allowed to be*, so
sentences from a design board become checks against act definitions:

```
groceries + a face slot          → error   "items only, never a person"
allowance below external         → error   "money always confirms"
a reward that settles on silence → error   "a child's claim waits for an adult"
teaching that writes anything    → error   "teaching never costs an action"
```

That needed one opaque field on `ActDef`. The core never reads `domain` and
ships no list of values — a presentation layer owns the meaning. Without it the
rules could only be checked against rendered output, which is to say not
checked.

Board 13's ALWAYS and NEVER are tests rather than advice: one card at a time,
their words above it, a way out in every state, the count before it happens,
44px targets; never a nested card, never a spinner, never a failure line over a
finished act, and never a personal accent repainting a domain — `resolveColours()`
takes the accent so that it can visibly not use it.

## Speculation, measured

`npm run hepta` replays partial speech through the seven tongues. Recognizers
revise, so the generator revises: "my a" becomes "Maya" two words later.

```
cases              8
ended on the act   8/8  (100.0%)
EARLY COMMITS      0      <- must be 0

card right by      59.9% of the way in
time bought        1257ms before the sentence ended
stage switches     1.13 per sentence
peak tracks        2 of 7 tongues
```

`EARLY COMMITS` must be zero. Not low. A commit on a partial utterance is a
write the person never finished asking for. Everything else is tuning.

It found one thing worth keeping: a sentence that changes its mind could not
recover. "pay Maya no actually give Maya the laundry" kept the payment act to
the last word, because the switch margin held the leader and the early words
kept feeding its score. That margin exists to stop the stage flickering while
someone is looking at it — a mid-sentence cost, which stops existing when the
sentence does. It is dropped on the final transcript now.

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
- `apps/orb/realtime.js` → the event names have been checked against the GA reference and the
  wiring rebuilt for it (ephemeral client secrets, `/v1/realtime/calls`, the `type: "realtime"`
  session discriminator, `audio.input.turn_detection`). Two things stay unverified and are marked
  in the code: whether input transcription must be explicitly enabled in a speech-to-speech
  session, and whether `response.function_call_arguments.done` still exists — the tool call is
  driven off `response.done` either way.
