# Tacit web app

## Publish on Vercel (no terminal)

1. On vercel.com: **Add New → Project → Import** `Djoek47/tacit`.
2. Leave every build setting as it is. `vercel.json` already says how to install, build and serve.
3. Before the first deploy, open **Environment Variables** and add:

| Name | Value | Needed? |
|---|---|---|
| `TACIT_ACCESS_CODE` | a code you choose, e.g. a short phrase | **Yes**, if you add any AI key below. Without it, anyone with the link could spend your credits. |
| `ANTHROPIC_API_KEY` | your Claude key | at least one model key, or visitors bring their own |
| `OPENAI_API_KEY` | your OpenAI key | optional |
| `XAI_API_KEY` | your Grok key | optional |
| `WORLDMONITOR_API_KEY` | your World Monitor key | optional; without it the briefing uses a sample feed |

4. **Deploy.** Every push to `main` deploys again on its own.

People you share the link with open **Settings → AI model**, type the access code once, and Tacit uses your AI.
Anyone can instead paste their own key there: it stays in their browser and is sent only with their own requests.

What a visitor tells Tacit stays in their own browser. The server keeps nothing about anyone.

**Connections (MCP):** paste an `https://` MCP server address in Settings. Tacit lists its tools and their cost
before anything is called. The hosted site refuses addresses inside private networks.

## Run it on your own computer (optional)

```
npm run tacit        →  http://127.0.0.1:7373
```

Same page, same server code. Keys come from the same environment variables, or from Settings.

## Change it

```
npm install          # once
npm run tacit:build  # rebuilds public/index.html, api/tacit.mjs and server.mjs from the sources
```

Sources: `head.html` (styles), `body.html` (markup), `app.js` (page logic), `api.ts` (the server side, shared
by Vercel and local), `vercel.ts` (the Vercel function), `server.ts` (the local server), and `packages/`.
