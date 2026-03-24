# Specter

Lightweight autonomous AI agent that runs on your local machine. Dashboard, heartbeat daemon, persistent memory, voice output, and tool-use — all self-hosted.

## Quick Start (npx)

```bash
mkdir my-agent && cd my-agent
npx specter init
npx specter start
```

`specter init` walks you through setup — agent name, API key, and persona. It generates your config files and an AI-written `SOUL.md`.

Once running, open **http://localhost:3700** for the dashboard.

### CLI Commands

```bash
specter start                 # Start server + agent + heartbeat
specter start --no-heartbeat  # Start without heartbeat daemon
specter chat "hello"          # Send a message to the running agent
specter status                # Check server health
specter heartbeat on|off|now  # Control heartbeat daemon
specter logs                  # View activity logs
specter logs -n 50            # View last 50 log entries
```

## Manual Install (Development)

```bash
git clone <repo-url> && cd specter
cp .env.example .env          # Add your ANTHROPIC_API_KEY
npm install
npm run build
```

### Running

```bash
npm run build
npx tsx packages/server/src/index.ts
# Open http://localhost:3700
```

Rebuild when you change dashboard or package code, then restart the server. Core/server TypeScript changes only need a restart (tsx runs TypeScript directly).

## Project Structure

```
specter/
├── specter.config.yaml    # Agent configuration
├── SOUL.md                # Agent persona / system prompt
├── MEMORY.md              # Agent scratchpad notes
├── HEARTBEAT.md           # Standing orders for heartbeat daemon
├── .env                   # API keys (ANTHROPIC_API_KEY, etc.)
├── state/                 # Transcripts, usage data, memory DB
├── tools/                 # Custom user-defined tools
└── packages/
    ├── core/              # Agent, config, heartbeat, memory, events
    ├── memory/            # Vector memory store (local embeddings)
    ├── voice/             # ElevenLabs TTS engine
    ├── server/            # Fastify HTTP + WebSocket server
    ├── dashboard/         # React + Vite dashboard UI
    └── cli/               # CLI (specter init, start, chat, etc.)
```

## Configuration

All config lives in `specter.config.yaml`. Most settings can be changed live from the dashboard Config panel — changes persist to the YAML and hot-reload without restarting.

### Key Settings

| Setting | Description |
|---|---|
| `llm.model` | Claude model to use |
| `agent.maxTurns` | Max turns per query |
| `agent.maxBudgetUsd` | Per-query cost cap |
| `agent.permissionMode` | `bypassPermissions`, `acceptEdits`, `default`, `plan` |
| `agent.subagents` | Named sub-agents with their own model, tools, and prompt |
| `heartbeat.enabled` | Autonomous background task daemon |
| `heartbeat.intervalMinutes` | How often heartbeat wakes |
| `tools.allowed` | Which tools the agent can use |
| `voice.enabled` | ElevenLabs text-to-speech |
| `memory.autoCapture` | Automatically capture memories from conversations |

### API Keys

Managed via the dashboard Config panel or directly in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...        # Optional, for voice
```

## Dashboard

The dashboard at `localhost:3700` (or `3701` in dev mode) provides:

- **Activity** — Live event stream
- **Chat** — Terminal-style chat with tool call visualization, focus mode, new chat
- **Heartbeat** — Heartbeat daemon controls and logs
- **Persona** — Agent identity and SOUL.md
- **Memory** — MEMORY.md, HEARTBEAT.md, and recall stats
- **Tools** — Registered tools, user tools, workspace files
- **Config** — Live-editable settings, subagent editor, API key management

## License

MIT
