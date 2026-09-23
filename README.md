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
