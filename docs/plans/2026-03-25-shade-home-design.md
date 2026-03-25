# ~/.shade/ Home Directory & Multi-Agent Structure

## Overview

Move agent data out of the working directory and into `~/.shade/`. Templates ship with the package in `/templates/`. Personal files never touch the repo. The directory structure supports multi-agent from day one, but the CLI surface stays simple (single default agent) until we build multi-agent UI.

## Directory Structure

```
~/.shade/
├── HUMAN.md                      # Global — about the user, shared by all agents
└── agents/
    └── <agent-name>/
        ├── shade.config.yaml     # Agent configuration
        ├── SOUL.md               # Agent persona / system prompt
        ├── MEMORY.md             # Agent scratchpad notes
        ├── HEARTBEAT.md          # Standing orders for heartbeat daemon
        ├── .env                  # API keys
        ├── state/                # Transcripts, usage data, memory.db, activity.jsonl
        └── tools/                # Custom tools (auto-discovered)
```

## Templates

Live in repo at `/templates/`:
- `SOUL.md` — minimal default, tells user to run init
- `MEMORY.md` — empty scaffold
- `HEARTBEAT.md` — empty scaffold with example format
- `HUMAN.md` — prompt telling user to fill in their info

Templates ship with the npm package. Copied during `npx shade-ai init`.

## CLI Changes

### `npx shade-ai init`

1. Create `~/.shade/` if needed
2. If `~/.shade/HUMAN.md` missing, prompt user (optional, Enter to skip). Write to `~/.shade/HUMAN.md`
3. If HUMAN.md exists, skip or ask "Update profile? y/N"
4. Use agent name from persona question (existing flow)
5. Create `~/.shade/agents/<name>/`
6. Run existing flow: API key, persona, SOUL.md generation
7. Copy template defaults for MEMORY.md, HEARTBEAT.md
8. Write shade.config.yaml, .env to agent directory

### `npx shade-ai start`

- Single agent (current scope): finds the one agent in `~/.shade/agents/` and starts it
- Future: picker when multiple agents exist, `--agent` flag

### Other commands

`chat`, `status`, `heartbeat`, `logs` — all resolve the agent directory the same way as `start`.

## Core Changes

### `getShadeHome()` — new utility

Returns `~/.shade/` via `os.homedir()`. Cross-platform.

### Dev mode detection

If `shade.config.yaml` exists in cwd → dev mode, use cwd for everything. Otherwise resolve from `~/.shade/`. Zero changes to `npm run dev` workflow.

### `config.ts` — loadConfig()

- Dev mode: reads `./shade.config.yaml` (unchanged)
- Production: scans `~/.shade/agents/`, reads `shade.config.yaml` from the agent directory
- All relative paths in config (memory.dir, stateDir, tools.userDir) resolve relative to the agent directory

### `memory.ts` — readMemory()

- HUMAN.md: always reads from `~/.shade/HUMAN.md` (global)
- SOUL.md, MEMORY.md, HEARTBEAT.md: reads from agent directory
- Dev mode: HUMAN.md reads from cwd (unchanged)
- Auto-create from embedded defaults if file missing

## Server & Dashboard

No changes needed. Server reads from whatever paths config resolves. Dashboard hits the same API endpoints. The HUMAN.md path change is handled entirely in memory.ts.
