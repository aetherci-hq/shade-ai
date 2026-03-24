# Shade

Lightweight autonomous AI agent that runs on your local machine. Dashboard, heartbeat daemon, persistent memory, voice output, custom tools, and remote access — all self-hosted.

## Quick Start

```bash
mkdir my-agent && cd my-agent
npx shade-ai init
npx shade-ai start
```

`shade-ai init` walks you through setup — agent name, API key, and persona. It generates your config files and an AI-written `SOUL.md`.

Once running, open **http://localhost:3700** for the dashboard.

### CLI Commands

```bash
shade-ai start                 # Start server + agent + heartbeat
shade-ai start --no-heartbeat  # Start without heartbeat daemon
shade-ai chat "hello"          # Send a message to the running agent
shade-ai status                # Check server health
shade-ai heartbeat on|off|now  # Control heartbeat daemon
shade-ai logs                  # View activity logs
shade-ai logs -n 50            # View last 50 log entries
```

## Manual Install (Development)

```bash
git clone https://github.com/aetherci-hq/shade-ai.git && cd shade-ai
cp .env.example .env          # Add your ANTHROPIC_API_KEY
npm install
npm run build
```

### Running

```bash
npm run dev              # Server with hot-reload (port 3700)
npm run dev:dashboard    # Vite dev server (port 3701)
```

Or for production:

```bash
npm run build
npx tsx packages/server/src/index.ts
# Open http://localhost:3700
```

## Project Structure

```
shade-ai/
├── shade.config.yaml      # Agent configuration
├── SOUL.md                # Agent persona / system prompt
├── HUMAN.md               # About the user (injected into agent context)
├── MEMORY.md              # Agent scratchpad notes
├── HEARTBEAT.md           # Standing orders for heartbeat daemon
├── .env                   # API keys (ANTHROPIC_API_KEY, etc.)
├── state/                 # Transcripts, usage data, memory DB
├── tools/                 # Custom tools (auto-discovered)
└── packages/
    ├── core/              # Agent, config, heartbeat, memory, events, tools
    ├── memory/            # Vector memory store (local embeddings)
    ├── voice/             # ElevenLabs TTS engine
    ├── server/            # Fastify HTTP + WebSocket server
    ├── dashboard/         # React + Vite dashboard UI
    └── cli/               # CLI (shade-ai init, start, chat, etc.)
```

## Configuration

All config lives in `shade.config.yaml`. Most settings can be changed live from the dashboard Config panel — changes persist to the YAML and hot-reload without restarting.

### Key Settings

| Setting | Description |
|---|---|
| `models.default` | Model for everyday chat (default: sonnet) |
| `models.advanced` | Model for deep work (default: opus) |
| `models.heartbeat` | Model for heartbeat checks (default: haiku) |
| `agent.maxTurns` | Max turns per query |
| `agent.maxBudgetUsd` | Per-query cost cap |
| `agent.permissionMode` | `bypassPermissions`, `acceptEdits`, `default`, `plan` |
| `agent.subagents` | Named sub-agents with their own model, tools, and prompt |
| `heartbeat.enabled` | Autonomous background task daemon |
| `heartbeat.intervalMinutes` | How often heartbeat wakes |
| `tools.allowed` | Which Claude Agent SDK tools the agent can use |
| `voice.enabled` | ElevenLabs text-to-speech |
| `memory.autoCapture` | Automatically capture memories from conversations |
| `server.host` | `127.0.0.1` for local, `0.0.0.0` for network access |
| `server.authToken` | Required for remote access |
| `timezone` | Agent's timezone (auto-detected, overridable) |

### Remote Access

Access Shade from your phone or another device on your network:

```yaml
server:
  host: 0.0.0.0
  authToken: your-secret-token
```

Restart, then open `http://<your-ip>:3700` from any device. Mobile gets a full-screen chat interface.

### Custom Tools

Drop `.ts` files in `tools/` — they're auto-discovered. Or install from the ecosystem:

```bash
npx shade-tool-weather    # Install weather tool
```

See the Tools panel in the dashboard for details.

### API Keys

Managed via the dashboard Config panel or directly in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...        # Optional, for voice
```

## Dashboard

The dashboard at `localhost:3700` provides:

- **Activity** — Live event stream
- **Chat** — Terminal-style chat with model toggle, working status, focus mode
- **Heartbeat** — Daemon controls, standing order templates, cycle history
- **Persona** — Agent identity builder + Human persona (HUMAN.md)
- **Memory** — Notes, vector memory recall, stats
- **Tools** — Custom tools, catalog, execution history
- **Config** — Live-editable settings, model tiers, remote access, API keys

## License

MIT
