# Scaffolding — where everything is

Seven packages, two apps, 122 tests. `npm test` from the root runs every suite.

| Package | Owns | Tests |
| --- | --- | --- |
| `aiuic-core` | acts, slots, beats, blast radius, HOLD, attention gate, outbox, undo | 41 |
| `aiuic-resolve` | local matcher, act routing, span arbitration, Jev + on-device tiers | 29 |
| `hepta` | speculation over partial speech — seven tongues | 10 |
| `aiuic-tools` | tool schemas generated from acts; applying a model's call | 12 |
| `aiuic-compose` | runtime act composition over a closed capability registry | 13 |
| `aiuic-memory` | stated facts; remembering and forgetting as acts | 10 |
| `aiuic-brand` | brand colour, legibility, initials mark — no trademarks shipped | 7 |

| App | What it is |
| --- | --- |
| `demo/` | the commit contract with its workings exposed — four acts, four radii |
| `apps/heckit/` | the MVP: speak once, it interviews, remembers, plans, and composes |

## Wiring it to a model tomorrow

Nothing below needs new engine work; it is all plumbing.

1. **Tool plane.** `toolPlane(ui, optionsFor, 'openai-realtime')` gives the tool list. Never hand-write it.
2. **Session.** Port the SDP exchange from Creatix `app/api/ai/mimic-test-realtime/route.ts` — the key stays server-side, the browser gets an answer.
3. **Transcripts in.** Interim results go to `Speculator.feed({ text, final })`. Nothing commits before `final`.
4. **Tool calls in.** `applyToolCall(ui, call, optionsFor)` puts the model's answer on the stage; values are matched back through the host's own option list.
5. **State out.** `ui.state()` after every change. The model is behind the stage and will contradict it otherwise.
6. **Jev.** One `Choice` per turn over `memory.gaps(expected)` picks the next question. Not free text.

## What is still mocked, and where

- `apps/heckit/app.js` → `BANKS` (question bank), `PLANS` (plan copy), `composeFor` (stands in for the model emitting an `ActSpec`).
- Speech itself. `ui.hear(text)` takes a string; STT and TTS stay outside the SDK.
- No number or date grammar in `aiuic-resolve` yet — the demo's host resolvers cover it. Until it moves in, any act with a quantity or date has no offline path.
