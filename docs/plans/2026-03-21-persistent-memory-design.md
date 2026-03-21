# Persistent AI Memory Layer — Design

**Date:** 2026-03-21
**Status:** Approved
**Package:** `packages/memory`

## Overview

Add a structured, searchable, vector-embedded memory system to Specter. The agent gets smarter over time by automatically capturing conversation insights and retrieving relevant context via semantic search. Runs entirely local — no API calls for embeddings.

**Key principle:** Parallel to MEMORY.md, not a replacement. MEMORY.md stays as the user's explicit notebook. The new layer is an automatic, implicit memory that captures and indexes everything the agent learns.

## Architecture

### New Package: `packages/memory`

```
packages/memory/
  src/
    index.ts          — Public API (MemoryStore class)
    store.ts          — SQLite storage + vector search
    embedder.ts       — Local embeddings via @xenova/transformers
    extractor.ts      — Auto-capture from event bus
    types.ts          — MemoryEntry, SearchOpts, etc.
  package.json        — better-sqlite3, @xenova/transformers
```

### Data Model

```typescript
interface MemoryEntry {
  id: string;              // UUID
  content: string;         // The memory text
  type: 'auto' | 'agent' | 'user';  // How it was created
  source: string;          // conversationId or 'manual'
  tags: string[];          // Topic tags
  embedding: Float32Array; // 384-dim vector
  createdAt: number;
  accessedAt: number;      // Last retrieval time
  importance: number;      // 0-1 score
}
```

Three creation paths:
- **Auto-capture** — Agent responses and significant tool results, via eventBus listeners
- **Agent `remember()` tool** — Explicit high-signal insights (importance: 0.8 default)
- **User manual** — Via dashboard or API

Two retrieval paths:
- **Auto-injection** — Top-K relevant memories prepended to system prompt before each query
- **Agent `recall()` tool** — On-demand semantic search mid-conversation

## Storage: SQLite

Single database at `{stateDir}/memory.db`.

```sql
CREATE TABLE memories (
  id          TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('auto', 'agent', 'user')),
  source      TEXT NOT NULL,
  tags        TEXT DEFAULT '[]',
  embedding   BLOB NOT NULL,
  created_at  INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  importance  REAL DEFAULT 0.5
);

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_created ON memories(created_at);
```

### Vector Search

In-memory cosine similarity over Float32Arrays. All embeddings loaded into memory on startup (10,000 entries at 384 dims = ~15MB). Linear scan is sub-millisecond at this scale.

No sqlite-vss — native bindings are fragile across platforms (especially Windows). Pure JS cosine is simpler, portable, and sufficient for years of personal use. Add HNSW if it ever exceeds 100K entries.

Vectors are normalized at embedding time, so cosine similarity reduces to dot product.

## Embedder

`@xenova/transformers` with `Xenova/all-MiniLM-L6-v2` (384 dimensions).

- **Lazy init** — Model loads on first use (~2-3s), not at server startup
- **Singleton** — One instance, model stays in memory after first load
- **Cached** — Model downloaded once (~25MB), cached to `~/.cache/huggingface`
- **Normalized** — Vectors normalized at embedding time for fast dot-product search

### Chunking for Auto-Capture

- Agent responses: split on paragraph boundaries, max ~500 chars per chunk
- Tool results: only embed meaningful outputs (skip file reads over 1KB, skip error stacks)
- Each chunk = one memory entry with its own embedding

## Auto-Capture

Listens to existing events in `eventBus`:

**`agent:response`** — Chunk and embed agent responses (importance: 0.4)

**`agent:tool_result`** — Embed meaningful tool outputs (importance: 0.3). Skip:
- `Read` and `Glob` results (too large, re-derivable)
- Outputs over 1KB
- Error stacks

## Agent Tools

### `remember`
Store an important fact, decision, or insight. Agent calls this intentionally.
- Input: `content` (required), `tags` (optional), `importance` (optional, default 0.8)
- Agent-remembered entries rank higher in retrieval

### `recall`
Search long-term memory. Agent calls this mid-conversation for targeted queries.
- Input: `query` (required), `limit` (optional, default 10)
- Returns formatted memory entries with dates and importance

## Context Injection

Before each `query()` call in `agent.ts`:

1. Read SOUL.md (system prompt base)
2. Read MEMORY.md (user's manual notes)
3. Search memory store for top-K entries relevant to user input
4. Compose system prompt: `SOUL.md + MEMORY.md notes + recalled memories`

### Relevance Scoring

```
score = (similarity * 0.6) + (importance * 0.25) + (recencyBoost * 0.15)
```

- **Similarity (60%)** — Cosine similarity to query embedding
- **Importance (25%)** — Agent-assigned or heuristic score
- **Recency (15%)** — Exponential decay over ~30 days: `e^(-ageDays/30)`

High-importance memories stay visible even when old. Recent memories get a gentle boost. Semantic match is always the primary signal.

`accessed_at` updates on every retrieval — enables future decay/surfacing features.

## Public API

```typescript
class MemoryStore {
  async init(dbPath: string): Promise<void>
  async close(): Promise<void>
  async store(entry: NewMemory): Promise<string>
  async remember(content: string, tags?: string[], importance?: number): Promise<string>
  async forget(id: string): Promise<void>
  async search(query: string, opts?: SearchOpts): Promise<ScoredMemory[]>
  async recent(limit?: number): Promise<MemoryEntry[]>
  async stats(): Promise<MemoryStats>
  async prune(maxEntries?: number): Promise<number>
}
```

## Integration Changes

| Package | Change | Details |
|---------|--------|---------|
| `core/agent.ts` | Import MemoryStore, inject context, register tools | Memory-augmented system prompt, `remember`/`recall` tools |
| `core/config.ts` | Add memory config fields | `embedModel`, `autoCapture`, `maxEntries`, `contextLimit` |
| `core/types.ts` | Extend `SpecterConfig.memory` | New fields for memory layer config |
| `server/http.ts` | Add memory API endpoints | `/api/memory/search`, `/api/memory/entries`, `/api/memory/stats` |
| `dashboard` | Memory panel additions | Searchable memory browser, stats display |

### Config Additions

```yaml
memory:
  dir: .
  stateDir: ./state
  embedModel: Xenova/all-MiniLM-L6-v2
  autoCapture: true
  maxEntries: 10000
  contextLimit: 8
```

## What Does NOT Change

- MEMORY.md read/write — untouched
- SOUL.md — still the base system prompt
- HEARTBEAT.md — still read by heartbeat daemon
- Activity logs — still JSONL, separate concern
- Existing dashboard panels — no regressions
