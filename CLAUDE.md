# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Shade

Shade (npm: `shade-ai`, repo: `aetherci-hq/shade-ai`) is a local autonomous AI agent framework. It wraps the Anthropic Claude Agent SDK with persistent memory, a heartbeat daemon, voice output (ElevenLabs), custom tools, and a React dashboard. All config lives in `shade.config.yaml` with hot-reload support.

Previously named Specter. Internal workspace package names use `@shade/*` (not published to npm individually). The published npm package is `shade-ai`.

## Commands

```bash
# Development (run both simultaneously)
npm run dev              # Server with hot-reload (tsx --watch, port 3700)
npm run dev:dashboard    # Vite dev server (port 3701, proxies to 3700)

# Build all packages (must build before production start)
npm run build

# Production
npm run start

# CLI (after npm publish)
npx shade-ai init        # Onboarding wizard
npx shade-ai start       # Start server
```

There is no linter or test runner configured.

## Architecture

Monorepo with 6 npm workspaces under `packages/`. All packages use TypeScript (ES2022, ESNext modules) and compile via `tsc` to `dist/`, except dashboard (Vite) and cli (tsup bundler).

### Package dependency graph

```
cli (shade-ai) → server → core, memory, voice, dashboard
memory → core
voice → core
```

### Packages

- **@specter/core** — Agent class (Claude Agent SDK wrapper), config loader/writer (YAML), heartbeat daemon, file-based memory (SOUL/HUMAN/MEMORY/HEARTBEAT .md files, activity.jsonl, transcripts/), event bus, usage tracking, API key management, custom tool loader/registry
- **@specter/memory** — Vector memory store using SQLite (better-sqlite3) + local embeddings (Xenova transformers, 384-dim). Semantic search with in-memory cosine similarity cache. Auto-captures from agent responses via event bus
- **@specter/voice** — ElevenLabs TTS with hourly char limits and daily cost caps. Speaks intermediate text (before tool calls) and final responses. Accumulate-and-flush pattern to avoid duplicates
- **@specter/server** — Fastify HTTP + WebSocket server. REST API in `src/http.ts`, WebSocket event broadcasting in `src/ws.ts`. Auth middleware for remote access. Serves the built dashboard as static files. Main bootstrap in `src/index.ts`
- **@specter/dashboard** — React 19 + Tailwind 4 + Vite. 7 panels (Activity, Chat, Heartbeat, Persona, Memory, Tools, Config+Stats). Mobile layout (< 768px) renders full-screen chat only. Auth login screen for remote access. Design: warm dark console theme, sharp corners, copper accent
- **shade-ai** (cli) — Commander-based CLI, bundled with tsup. Commands: init, start, chat, status, heartbeat, logs. Interactive onboarding wizard in `src/onboard.ts`. Published to npm as the single user-facing package

### Key patterns

- **Event bus** (`eventBus` from core) is the central communication mechanism. All packages emit/listen to events. The server broadcasts all events to dashboard via WebSocket.
- **Singletons** — Agent, MemoryStore, VoiceEngine, and config are initialized once in the server bootstrap and accessed globally.
- **Config hot-reload** — Changes to `shade.config.yaml` (or via API/dashboard) emit events that components listen to for live updates.
- **File-based state** — `SOUL.md` (persona/system prompt), `HUMAN.md` (user persona), `MEMORY.md` (agent notes), `HEARTBEAT.md` (standing orders). Runtime state in `state/` directory (memory.db, activity.jsonl, usage.json, transcripts/).
- **Custom tools** — `.ts` files in `tools/` are auto-discovered via regex metadata parsing (no execution). Agent calls them via Bash through `tools/_run.ts`. Tool config stored in `tools/.config.json`.
- **Model tiers** — `models.default` (chat), `models.advanced` (deep work), `models.heartbeat` (monitoring). Chat UI has a one-click model toggle.
- **Auth** — `server.authToken` protects remote access. Localhost bypasses auth. Dashboard uses `authFetch()` wrapper on all API calls.
- **Cross-device sync** — User messages broadcast via WebSocket so desktop and mobile see the same conversation.

### API surface

The server exposes REST endpoints at `/api/*` (status, config, keys, auth/check, chat, conversations, memory files, vector memory search/stats, activity, tools, tool config, usage) and a WebSocket at `/ws` for bidirectional event streaming.

### Naming note

The local directory may still be named `specter`. The GitHub repo is `shade-ai`. Internal workspace packages use `@shade/*` scope (not published to npm). The npm package is `shade-ai`. User-facing text, config files, CLI commands, and log output all use "Shade".
