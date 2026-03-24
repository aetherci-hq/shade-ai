# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Specter

Specter is a local autonomous AI agent framework. It wraps the Anthropic Claude Agent SDK with persistent memory, a heartbeat daemon, voice output (ElevenLabs), and a React dashboard. All config lives in `specter.config.yaml` with hot-reload support.

## Commands

```bash
# Development (run both simultaneously)
npm run dev              # Server with hot-reload (tsx --watch, port 3700)
npm run dev:dashboard    # Vite dev server (port 3701, proxies to 3700)

# Build all packages (must build before production start)
npm run build

# Production
npm run start
```

There is no linter or test runner configured.

## Architecture

Monorepo with 6 npm workspaces under `packages/`. All packages use TypeScript (ES2022, ESNext modules) and compile via `tsc` to `dist/`, except dashboard which uses Vite.

### Package dependency graph

```
cli → server → core, memory, voice, dashboard
memory → core
voice → core
```

### Packages

- **@specter/core** — Agent class (Claude Agent SDK wrapper), config loader/writer (YAML), heartbeat daemon, file-based memory (SOUL/MEMORY/HEARTBEAT .md files, activity.jsonl, transcripts/), event bus, usage tracking, API key management
- **@specter/memory** — Vector memory store using SQLite (better-sqlite3) + local embeddings (Xenova transformers, 384-dim). Semantic search with in-memory cosine similarity cache. Auto-captures from agent responses via event bus
- **@specter/voice** — ElevenLabs TTS with hourly char limits and daily cost caps. Listens to event bus for agent responses
- **@specter/server** — Fastify HTTP + WebSocket server. REST API in `src/http.ts`, WebSocket event broadcasting in `src/ws.ts`. Serves the built dashboard as static files. Main bootstrap in `src/index.ts`
- **@specter/dashboard** — React 19 + Tailwind 4 + Vite. 8 panels (Activity, Chat, Heartbeat, Persona, Memory, Tools, Stats, Config). WebSocket hooks for live state. Design: warm dark console theme, sharp corners, copper accent
- **@specter/cli** — Commander-based CLI. Commands: init, start, chat, status, heartbeat, logs. Interactive onboarding wizard in `src/onboard.ts`

### Key patterns

- **Event bus** (`eventBus` from core) is the central communication mechanism. All packages emit/listen to events. The server broadcasts all events to dashboard via WebSocket.
- **Singletons** — Agent, MemoryStore, VoiceEngine, and config are initialized once in the server bootstrap and accessed globally.
- **Config hot-reload** — Changes to `specter.config.yaml` (or via API/dashboard) emit events that components listen to for live updates.
- **File-based state** — `SOUL.md` (persona/system prompt), `MEMORY.md` (agent notes), `HEARTBEAT.md` (standing orders). Runtime state in `state/` directory (memory.db, activity.jsonl, usage.json, transcripts/).

### API surface

The server exposes REST endpoints at `/api/*` (status, config, keys, chat, conversations, memory files, vector memory search, activity, tools, usage) and a WebSocket at `/ws` for bidirectional event streaming.
