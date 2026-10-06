# Putting Tacit on GitHub

You have `tacit.bundle`: the whole repository with all of its history (59+ commits since September).
A bundle is a git repository in one file. Nothing here has ever been pushed anywhere.

## 1. Make the repository on GitHub

Create a **private** repository, empty: no README, no licence, no .gitignore.
Suggested name: `kairos/tacit` (an organisation named Kairos), or `Djoek47/tacit` for now.

## 2. Push the bundle (on your Mac)

```sh
git clone -b v1 tacit.bundle tacit
cd tacit
git remote set-url origin git@github.com:<you>/tacit.git
git push -u origin v1:main   # all current work is on v1; it becomes main on GitHub
```

## 3. Install and check it works

```sh
sh scripts/setup.sh   # installs every package, then runs the tests, typecheck and eval
```

Needs Node 20 or later. Each package keeps its own node_modules for now; moving to npm workspaces can come later.

## Secrets

No key is in the code. Keys come from the environment only:

| Variable | Used by |
|---|---|
| `WORLDMONITOR_API_KEY` | the Tacit server (`npm run tacit`) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY` | the Hepta daemon's planner |

Put them in a `.env` that is never committed (`.env` is in `.gitignore`). On GitHub, use repository secrets.

## What is where

| Path | What |
|---|---|
| `packages/knowing` | Tacit getting to know you: the map, the person, the conversation |
| `packages/tacit` | everything put together; the keyless world route |
| `packages/notify` | the Desk, the briefing, World Monitor |
| `packages/settings` | the one fixed screen, also voice-controlled |
| `packages/core`, `resolve`, `kit` | the commit contract, routing, the app |
| `packages/hepta`, `pyramid`, `conductor` | lines of thought, the three roles, standing orders |
| `apps/tacit` | the web app and its server |
| `ios` | the iPhone app (see `ios/README.md`) |
| `brand` | the Kairos and Tacit marks |
