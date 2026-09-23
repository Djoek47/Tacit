# Orb — voice wired to the contract

```bash
OPENAI_API_KEY=sk-... node apps/orb/server.mjs
# → http://localhost:8787
```

The key lives in the server process. The browser posts its WebRTC offer to
`/realtime` and gets an SDP answer back; it never sees a credential.

## What runs where

| | |
| --- | --- |
| `server.mjs` | SDP exchange and static files. Knows nothing about acts. |
| `realtime.js` | WebRTC, mic, playback, event names. Knows nothing about committing. |
| `orb.js` | Acts, Hepta, the contract. Knows nothing about WebRTC. |

Swapping OpenAI for another provider — or for a local recognizer — should touch
`realtime.js` and nothing else.

## The one fragile part

Realtime event names change. They are all in `EVENTS` at the top of
`realtime.js`, so a rename is one edit. **Check them against the current docs
before the first live run** — this was written against May 2026 knowledge.

Also worth confirming on that first run:
- the transcription model name in `configure()`
- that `server_vad` is still the turn-detection type, and that `speech_started` /
  `speech_stopped` still fire (Hepta needs them to know when to settle)
- the `?model=` and `?voice=` query parameters on the realtime URL

## What the model can and cannot do

It fills slots by calling tools generated from the act definitions. It cannot
commit anything: `applyToolCall` puts values on the stage, and the contract
decides what happens next. A value the host never offered is refused and
reported back rather than set.

Barge-in is wired both ways — when the user starts talking, the model is told to
stop speaking, and a running HOLD is frozen.
