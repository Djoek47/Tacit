# Tacit web app

## Run it (Windows, macOS or Linux)

You need Git and Node.js 20 or newer. Nothing else to install: the server is prebuilt.

```
git clone https://github.com/Djoek47/tacit
cd tacit
npm run tacit
```

Open http://127.0.0.1:7373. Then, in **Settings**:

- **AI model**: pick Claude, GPT or Grok, paste your key, press *Connect and test*.
- **Connections**: paste an MCP server address (Streamable HTTP or SSE), look at its tools, approve.
- **World feed**: paste a World Monitor key for the real briefing.

Keys are saved in `~/.tacit/config.json` on your computer (on Windows: `C:\Users\<you>\.tacit\config.json`)
and never sent to the page. Environment variables work too and win over the file:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `WORLDMONITOR_API_KEY`.

The server only listens on this computer. Do not expose it to the internet until sign-in exists.

## Change it

```
npm install          # once
npm run tacit:build  # rebuilds index.html and server.mjs from the sources
```

Sources: `head.html` (styles), `body.html` (markup), `app.js` (page logic), `server.ts` (server),
and the packages under `packages/` (the conversation, the Desk, the briefing, the Stage).
