# Building with Tacit

Tacit turns an app into something people talk to. They say what they want; one card appears with what was heard; it holds for a moment, and silence lets it happen. A word or a tap corrects it. Undo is always one tap away.

It is built on Stage, the commit contract underneath: every action declares **what it costs to be wrong**, and that, not a list of exceptions, decides whether it may happen on silence, needs a yes, or may never happen unattended.

There are two ways to use it.

| | Inside your app | Outside, next to your tools |
|---|---|---|
| You have | an app, or MCP servers for your services | an assistant: Claude, Cursor, any MCP client |
| You add | `createApp()` and your acts, or `connect()` to your MCP servers | the Tacit server (`hepta.mjs`) |
| People get | a stage in your app they can talk to | an always-on conductor, a shared memory, and a stage their assistant can propose to |

The two compose: one Tacit can be bridged into another, and every write stays behind the same rules.

> **Status.** V1. The packages are not published to npm yet; use them from this repository (`packages/*`) or the bundled files in `apps/`. Everything described here is tested (see `npm test`), except where a section says otherwise.

---

## Five minutes, inside

```ts
import { createApp, defineAct } from '@intermenu/aiuic-kit';
import { StagePresenter, stylesheet } from '@intermenu/aiuic-eui';
import { resolveWhen } from '@intermenu/aiuic-resolve';

const app = createApp({
  ctx: () => ({
    actor: { id: 'me' },
    // All four must be true for silence to count as a yes. Unknown counts as false.
    attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
  }),
  presenters: [new StagePresenter(document.getElementById('stage'), document)],
  acts: [
    defineAct({
      name: 'add_chore',
      domain: 'chores',                                   // the colour, and the rules for that part of the app
      phrases: ['add', 'assign', 'needs to do'],
      slots: {
        chore:    { primitive: 'chip', options: () => CHORES, required: true, order: 1 },
        assignee: { primitive: 'face', options: () => PEOPLE, required: true, order: 2 },
        due:      { primitive: 'when', resolve: resolveWhen, order: 3 },
      },
      radius: 'other-person',                             // what it costs to be wrong
      commit: (f) => db.chores.insert(f),
      undo:   (r) => db.chores.remove(r.id),
    }),
  ],
});

document.head.append(Object.assign(document.createElement('style'), { textContent: stylesheet() }));

app.hear('the dishes for Maya tomorrow');                  // card up, filled, holding
app.hear('the dishes for', { final: false });              // still speaking: it speculates and cannot commit
```

`hear()` routes the sentence to an act, fills its slots from the same words, speculates while `final` is false, and draws. It is the whole surface. Speech-to-text stays outside the SDK: pass the transcript as it arrives.

The one thing a caller must get right: **`final: false` means the person has not stopped talking**, and nothing commits on an unfinished sentence.

### Or connect the MCP servers you already have

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connect, delegationAct } from '@intermenu/aiuic-mcp';

const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['tasks-server.mjs'] }));
const tasks = await connect(client);          // calls nothing yet

tasks.preview();
// "Connect Tasks. It can do 1 thing and look up 2. It asks you first. 1 can be undone,
//  so you may later let it go ahead on silence. It looks things up with list_tasks,
//  list_lists. The server says those only read; approving means trusting that."

await tasks.approve();                        // the person said yes: now it may be called

const app = createApp({ ctx, acts: [...tasks.acts, delegationAct([tasks])], domains: tasks.shape.domains });
```

Write tools become acts. Read-only tools become sources the aggregator can ask. A tool named as another tool's undo is kept out of sight.

**`connect()` calls nothing.** Show `preview()` to the person; it names every tool that will be trusted to only read. Until `approve()`, sources return nothing and acts refuse to commit. Give each connection your own `id`: a delegation belongs to the connection you named, never to whatever name a server gives itself.

---

## Five minutes, outside

```bash
cd apps/hepta
cp hepta.config.example.json hepta.config.json      # list your MCP servers here
node hepta.mjs approve tasks                         # see what it would be trusted with; approve it
node hepta.mjs                                       # always on; MCP over HTTP on 127.0.0.1:8790
```

A server nobody has approved is connected only long enough to show what approving it would mean. Approval is stored with a fingerprint of what the server offers, so a server that changes its tools has to be approved again.

**Claude Desktop, Cursor, or any MCP client that launches servers over stdio:**

```json
{
  "mcpServers": {
    "hepta": {
      "command": "node",
      "args": ["/absolute/path/to/apps/hepta/hepta.mjs", "--stdio", "--config", "/absolute/path/to/hepta.config.json"]
    }
  }
}
```

**Over HTTP:** `http://127.0.0.1:8790/mcp`, with `Authorization: Bearer <token>`. The token is generated on first run at `~/.hepta/token`. The endpoint serves your memory, so it listens on localhost only and refuses requests without the token.

`hepta.config.json`:

```json
{
  "dataDir": "~/.hepta",
  "servers": [{ "name": "tasks", "command": "node", "args": ["tasks-server.mjs"] }],
  "http": { "port": 8790 },
  "notify": { "url": "https://ntfy.sh/your-own-topic" }
}
```

`notify.url` receives a plain-text POST whenever the conductor does something, waits for you, or cannot do something. Any push service that accepts a POST works.

### What an outside caller can do

| Tool | Does |
|---|---|
| `stage` | what is on the person's stage now |
| `why_not_committing` | the reasons, in order: missing, guessed, cost, attention |
| `acts` | everything the app can do |
| `propose` | put an act on the stage with values filled, **waiting for the person** |
| `pursue` | run the loop on a goal; ends in an answer or a proposal, never a commit |
| `think` | add a line of thought to a memory branch, never to `main` |
| `memory_search`, `memory_branches` | read the shared memory |
| `inbox`, `score` | the conductor's inbox and standing orders |

There is no tool that says yes, and no tool that speaks as the person. Whoever calls in is a model. A proposal from outside lands as a system-initiated card, and the engagement rule keeps it from committing on silence. The person says yes in the app, or it does not happen.

---

## Concepts

### Acts, slots, primitives

An **act** is one thing a person can ask for: add a chore, send money, book the dentist. It has **slots** it needs filled, each drawn by a **primitive**:

| Primitive | For | Filled locally by |
|---|---|---|
| `chip` | a choice from a list | matching the options and their aliases |
| `face` | a person | matching names |
| `when` | a time | `resolveWhen`: "tomorrow at 9:30am", "friday" |
| `quantity` | an amount | `resolveQuantity`: "$12", "twelve dollars" |
| `ghostField` | free text | the rest of the sentence, always marked as a guess |

A slot filled by a weak or uncalibrated match is **provisional**. The card shows it with a ✓ the person can tap to confirm it.

### What it costs to be wrong: radius

| Radius | Means | Silence may commit? |
|---|---|---|
| `self` | only the person asking | yes, after the hold |
| `shared` | something shared, reversible | yes, after the hold |
| `other-person` | reaches someone else | yes, after a longer hold, and never on a guess |
| `external` | money, sending, anything irreversible | **never**: it asks for a yes |

The act's radius is the highest of its own and every effect's. An effect that cannot be undone counts as `external`. **An act with no `undo()` is `external` at runtime, whatever it declares.** Nothing can commit on silence that cannot be taken back.

### The hold, and the attention gate

A complete act below `external` **holds**: 850 ms for an adult (1300 ms for a child), longer for `other-person`. If the person is quiet through it, it commits. A word or a tap cancels.

Silence only counts as a yes when the app is in front, the device is unlocked, nothing is covering the screen, the mic is live, **and the person touched or spoke during this act**. That last check is why a card built from defaults, a system-initiated card, and a card proposed by a model all wait for a yes.

### The pyramid

| Role | Authority | In code |
|---|---|---|
| **Conductor** | keeps the rhythm, always on, commits only what the score allows | `Conductor` |
| **Congregator** | the only writer to memory; records what happened | `Pyramid.congregator` |
| **Orchestrator** | proposes; receives copies, returns a plan; cannot write | your function |
| **Aggregator** | reads sources and memory; cannot propose or write | `Aggregator` |

The roles do not vote. Three agents on the same model make the same mistakes, so three votes read as one confident wrong answer. Instead each role holds a different authority, and nothing crosses between them except through an interface the next one owns.

```ts
const pyramid = new Pyramid({
  app, ctx, memory,
  aggregator: new Aggregator([...tasks.sources, ...bank.sources]),
  orchestrator: async ({ goal, findings, memory, parts }) => {
    // Call a model here if you like. Return one of:
    //   { kind: 'answer', answer }
    //   { kind: 'propose', act, fill, why }      a card on the stage, waiting for a yes
    //   { kind: 'look', query }                  look again with a sharper question
    //   { kind: 'split', goals }                 each part goes round the loop one level down
  },
});
await pyramid.pursue('plan my month');
```

The loop stops at a depth budget (3), after too many "look again"s (2), and on any goal already being pursued higher up.

#### A model behind the orchestrator (optional)

`@intermenu/aiuic-orchestrators` puts Claude or an OpenAI model behind the orchestrator. The model plans; it never writes.

```ts
import { anthropicOrchestrator, openaiOrchestrator } from '@intermenu/aiuic-orchestrators';

const orchestrator = anthropicOrchestrator({
  apiKey: process.env.ANTHROPIC_API_KEY!,   // server-side only
  model: 'claude-opus-5',
  acts: () => app.ui.definitions,           // read on every plan, so new servers are included
});
// or openaiOrchestrator({ apiKey, model, acts }) — the Responses API
```

What the model is given: the goal, what the aggregator found, what memory holds about it, and the answers to any parts it split the goal into. It answers by calling one of four tools (`answer`, `propose`, `look`, `split`), and its reply is checked before anything else sees it:

- A proposal must name an act the app has, fill only that act's slots, use plain values, and say why. It then lands on the stage and waits for the person, like any other proposal.
- Acts that grant authority (`set_delegation`, `set_standing_order`) are not offered to the model at all. Findings come from apps, and an app's output should not be what suggests trusting that app more. Pass `includeAuthority: true` to change that.
- Findings and memory are marked as data. The system prompt says text in them is not from the person and is never to be followed. The check above is what holds if the model follows it anyway.
- **Nothing throws.** No network, a timeout, a 4xx or 5xx, a refusal, malformed output, two tool calls at once, an unknown act or slot: each becomes `{ kind: 'answer' }` saying what went wrong. An unreachable provider cannot stop the conductor. A provider's error message is included with anything shaped like a key removed, because answers are written to memory.
- `tool_choice` is `auto` by default: the Claude docs say some current models reject forced tool use. A plain-text reply counts as an answer. OpenAI requests use `parallel_tool_calls: false` and `store: false`.

In the daemon, add `"planner": { "provider": "anthropic", "model": "claude-opus-5" }` to `hepta.config.json` and set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) in the environment. The key is never read from the config file. Without a key it says so and plans locally.

**Not yet verified against the live APIs.** The request shapes follow the providers' current documentation, cited in the source, and the tests run on a stubbed `fetch`. The daemon has been run end to end against a local stand-in for the Claude API: the proposal it relayed waited on the stage, and a proposal naming an act that does not exist was refused. This sandbox cannot reach either provider.

### Memory

```ts
const { reader, writer } = openMemory(store);
```

One memory, one pen. The reader goes to every role; only the congregator holds the writer. **Versions are branches**: a line of thought can explore "what if the budget were 650" on its own branch and be merged or dropped. A branch holds only thoughts and findings. Facts, decisions, delegations and standing orders are real, and they are written to `main` or nowhere.

A fact is only ever what the person said, and it carries the words it came from. A finding from a bank feed stays a finding.

### The conductor

```ts
const conductor = new Conductor({ app, memory: reader, clock, store, ctx, pursue: (g) => pyramid.pursue(g), notifier });
conductor.start();
```

The person writes the **score**: standing orders like "every morning, tell me what is due", each written through an act they approved. The conductor runs them around the clock. It may commit on the person's behalf only when all of these hold:

- the order names that act: an act order covers its own act, and a goal order covers only what its `allow` list names, so a model never chooses what gets committed
- it does not change what may happen without the person: letting a tool go ahead and writing orders are only ever committed by the person
- its radius is at or under that order's ceiling
- the ceiling is not `external`: money and anything irreversible are never done unattended
- it has an undo
- nothing is missing and nothing is a guess

Everything else goes to the **inbox**, waiting for a yes. Every unattended commit is in the inbox too, with its result so it can be undone later. With no orders, the conductor does nothing.

### Tacit: speaking and listening at once

**The seven tongues** (`Speculator`) keep up to seven candidate acts alive while someone is still talking, and paint the leader early. None may commit until the sentence ends.

**Lines of thought** (`Lines`) run beside them on every partial transcript: claims said earlier, views it holds, things left open.

- **Cutting in**: at a clause boundary or a breath, not mid-word, unless waiting would cost more than the rudeness.
- **Holding the floor**: "yeah" keeps it talking; "wait" or a real sentence stops it.
- **Arguing**: a reason lowers its confidence until it concedes; "do it anyway" ends the argument. It argues once per disagreement at default bluntness, twice when turned up, never more.
- **Wandering**: when you are quiet and nothing is on stage, it goes back to something left open.

`npm run hepta` scores both. The numbers that must stay at zero are **early commits** and **wrong cuts**.

---

## The shape: `aiuic://shape`

An MCP server can say what its app should look like by exposing one resource, `aiuic://shape`, containing JSON:

```json
{
  "schema": "aiuic.shape/1",
  "app": { "name": "Tasks", "brand": { "colour": "#5B6CFF", "mark": "T" } },
  "domains": { "tasks": { "kicker": "TASKS", "colour": "#7C8BFF" } },
  "tools": {
    "add_task": {
      "domain": "tasks",
      "phrases": ["add", "remind me to", "new task"],
      "preview": "Add {title} to {list}",
      "undo": { "tool": "remove_task", "arg": "id", "from": "id" },
      "options": { "list": { "from": "list_lists", "value": "id", "label": "name" } }
    }
  },
  "settings": [{ "key": "weekly", "label": "Weekly review", "type": "toggle", "default": true }],
  "notifications": [{ "key": "due", "label": "A task is due", "default": true, "watch": "list_tasks" }],
  "home": ["add_task"]
}
```

A shape **describes**; it never decides. It is refused, and the app falls back to a plain look, if it:

- sets `radius`, `commit`, `reversible`, `effects`, `assent` or `silence` anywhere
- names an undo tool that does not exist, or one that claims to be read-only
- uses a colour that means something everywhere (success `#34D399`, warning `#FB923C`, danger `#F87171`, the assistant `#06B6D4`)
- names a parameter in a `preview` that the tool does not have
- lists options from a tool that is not read-only

Every problem is reported at once, in `connection.shapeProblems`.

## How the bridge decides what a tool costs

MCP tool annotations are hints, and the MCP SDK itself says clients should never make decisions on them for untrusted servers. So a server's hints may only make a tool look **more** dangerous:

| The server says | The bridge does |
|---|---|
| `readOnlyHint: true` | a source for the aggregator, never an act |
| nothing (MCP assumes destructive, open-world) | `external`, always |
| `destructiveHint: true` | `external`, always |
| no undo in the shape | `external`, always: it cannot be taken back |
| `destructiveHint: false` and an undo | starts `external`; **the person** may let it go ahead, down to `other-person` (or `self` if `openWorldHint: false`) |

Letting a tool go ahead is the person's own act (`delegationAct`): previewed, held, undoable, and remembered.

---

## Developer tools: `hepta-dev`

For building with Tacit, not inside it. Shaped on the same pyramid: context, evolution, proposal, reconstruction, testing.

```bash
node apps/hepta-dev/hepta-dev.mjs init            # write BRIEF.md to start from
node apps/hepta-dev/hepta-dev.mjs brief           # read it; check how the menus connect
node apps/hepta-dev/hepta-dev.mjs draft           # the acts it implies, and why
node apps/hepta-dev/hepta-dev.mjs scaffold        # a runnable MCP server in ./app
node apps/hepta-dev/hepta-dev.mjs prototype       # a clickable prototype.html
node apps/hepta-dev/hepta-dev.mjs test <url>      # use it like a person; say what is wrong
node apps/hepta-dev/hepta-dev.mjs search <words>  # the code, its history, the chats
node apps/hepta-dev/hepta-dev.mjs evolution       # how the project got here
node apps/hepta-dev/hepta-dev.mjs dossier         # what a rebuild starts from
node apps/hepta-dev/hepta-dev.mjs mcp             # all of it as an MCP server, for Cursor or Claude
```

### The brief

Markdown, written the way notes already are. French headings work too.

```markdown
# Family Tasks
A calm app that runs the house by voice.
Audience: parents with kids under 14

## Features
- Add a chore for someone — asks who, what, when
- Pay allowance — asks who, amount

## Menus
- Home -> Chores, Calendar, Settings

## Design
- mood: calm, glass
- colour: #5B6CFF

## References
- https://…

## Exceptions
- kids cannot approve their own allowance

## Expectations
- adding a chore takes one sentence
```

`— asks who, when` shapes the act: who → a person, when → a time, amount → a quantity, what → free text, anything else → a choice from a list you provide. Every guess is written down with its reason. Costs lean careful: money and sending are `external`, and anything involving another person is at least `other-person`.

### Testing

`hepta-dev test <url>` opens the app at phone (390), tablet (820) and desktop (1440) widths, runs optional steps, and reports in sentences:

```
phone — 390×844
  ✗ On a phone (390 px), the page scrolls sideways: it is 520 px wide. Too wide: div.hero reaches 520 px.
  ! On a phone (390 px), 1 thing is smaller than a fingertip (44 px): button#send "Go" is 30×24.
  ! On a phone (390 px), text is cut off inside div.clip "This sentence does not fit in its box at".
  ✗ The console shows an error: Cannot read properties of undefined (reading "title")
```

Steps are JSON: `[{"click":"text=Add"}, {"fill":["#say","buy milk"]}, {"press":"Enter"}, {"wait":500}]`. It needs Playwright with Chromium (`npx playwright install chromium`), or point `HEPTA_CHROMIUM` at a Chromium binary.

---

## Guarantees, and how they are held

Each of these is a test in the repository, not a promise in a document.

| Guarantee | Held by |
|---|---|
| Nothing commits on a sentence still being spoken | `speculative` runs; the replay suite's early-commit count |
| Nothing commits on silence that cannot be undone | `explainRadius` raises any act without `undo()` to `external` at runtime |
| Nothing commits on silence the person did not engage with | the attention gate's engagement clause |
| A model cannot lower what an act costs | the composer takes cost from the capability, never the spec |
| An MCP server cannot lower what its tools cost | annotations only raise; the shape may not set a radius |
| An outside caller cannot say yes | the Tacit server has no assent tool and no way to speak as the person |
| Money and the irreversible are never done unattended | `authorise()` in the conductor; order ceilings capped below `external` |
| Nothing real is hypothetical | memory refuses facts, decisions, delegations and orders on branches |
| Only the person's words become facts | memory refuses facts without their words, or from any role but the congregator |
| Nothing can grant itself permission | acts marked `grantsAuthority` are refused by `assentUnattended()` in the core |
| A hold that started legitimately must still be legitimate when it ends | the hold re-checks cost and attention when it fires |
| Speaking again stops a hold | more speech puts the act back to speculating |
| No server is called before it is approved | `connect()` calls nothing; `approve()` turns it on; the daemon stores approval per fingerprint |
| A model orchestrator only proposes, and only what exists | `checkPlan` refuses unknown tools, acts, slots and non-plain values; authority-granting acts are never offered |
| A failing model cannot stop the conductor | every provider failure becomes an honest answer; nothing in the adapters throws |

Four of these came from an independent review — an agent that had not seen the code being written — which found eight ways around the rules above. Each is fixed and kept as a regression test.

## Not yet verified

- **Voice, live.** The OpenAI Realtime wiring follows the current GA documentation, but it has not connected to a live session yet. Two details could not be confirmed from the docs: whether input transcription must be enabled explicitly in a speech-to-speech session, and whether the model will start speaking while input audio is still arriving (Tacit cutting in depends on it).
- **Thresholds.** Routing and hold thresholds are tuned on 28 written sentences and 15 replayed conversations. They need a few hundred real ones.
- **Detectors.** Every detector in Tacit's lines of thought is tier 0: word overlap and numbers. The `Detector` interface is where a fast classifier replaces them.

## Packages

| Package | For |
|---|---|
| `aiuic-core` | acts, slots, radius, hold, attention gate, outbox, undo. No dependencies. |
| `aiuic-resolve` | local matching, grammar (when, quantity, free text), routing |
| `hepta` | the seven tongues, and lines of thought |
| `aiuic-kit` | `createApp()` and `hear()` |
| `aiuic-present` | `toView()`: the one view every renderer draws |
| `aiuic-eui` | the visual language: tokens, domains as rules, the stage |
| `aiuic-mcp` | any MCP server as acts, sources and a shape |
| `aiuic-memory` | one memory, one pen, branches |
| `aiuic-pyramid` | aggregator, orchestrator, congregator |
| `aiuic-orchestrators` | optional: Claude or OpenAI behind the orchestrator, planning only |
| `aiuic-conductor` | always on; the score; the inbox |
| `aiuic-server` | Tacit as an MCP server |
| `aiuic-devkit` | brief, drafts, scaffold, prototype, tester, context, dossier |
| `aiuic-compose`, `aiuic-tools` | acts composed by a model; tool schemas from acts |
| `aiuic-devtools`, `aiuic-eval` | why an act is waiting; the false-confirm rate |
