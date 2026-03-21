import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { statSync } from 'fs';
import { embed, EMBEDDING_DIM } from './embedder.js';
import type { MemoryEntry, NewMemory, ScoredMemory, SearchOpts, MemoryStats } from './types.js';

// In-memory vector cache for fast cosine search
interface VectorCacheEntry {
  id: string;
  embedding: Float32Array;
  importance: number;
  createdAt: number;
}

export class MemoryStore {
  private db!: Database.Database;
  private dbPath!: string;
  private vectors: VectorCacheEntry[] = [];

  // Prepared statements
  private stmtInsert!: Database.Statement;
  private stmtDelete!: Database.Statement;
  private stmtGetById!: Database.Statement;
  private stmtGetAll!: Database.Statement;
  private stmtGetRecent!: Database.Statement;
  private stmtUpdateAccessed!: Database.Statement;
  private stmtCountByType!: Database.Statement;

  async init(dbPath: string): Promise<void> {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
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
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    `);

    this.stmtInsert = this.db.prepare(`
      INSERT INTO memories (id, content, type, source, tags, embedding, created_at, accessed_at, importance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtDelete = this.db.prepare('DELETE FROM memories WHERE id = ?');
    this.stmtGetById = this.db.prepare('SELECT * FROM memories WHERE id = ?');
    this.stmtGetAll = this.db.prepare('SELECT * FROM memories');
    this.stmtGetRecent = this.db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?');
    this.stmtUpdateAccessed = this.db.prepare('UPDATE memories SET accessed_at = ? WHERE id = ?');
    this.stmtCountByType = this.db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type');

    // Load all vectors into memory for fast search
    this.loadVectorCache();
  }

  private loadVectorCache(): void {
    const rows = this.stmtGetAll.all() as Array<{
      id: string;
      embedding: Buffer;
      importance: number;
      created_at: number;
    }>;
    this.vectors = rows.map(row => ({
      id: row.id,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, EMBEDDING_DIM),
      importance: row.importance,
      createdAt: row.created_at,
    }));
  }

  async store(entry: NewMemory): Promise<string> {
    const id = randomUUID();
    const now = Date.now();
    const embedding = await embed(entry.content);
    const tags = JSON.stringify(entry.tags ?? []);
    const importance = entry.importance ?? 0.5;

    const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    this.stmtInsert.run(id, entry.content, entry.type, entry.source, tags, embeddingBuf, now, now, importance);

    // Add to vector cache
    this.vectors.push({ id, embedding, importance, createdAt: now });

    return id;
  }

  async remember(content: string, tags?: string[], importance?: number): Promise<string> {
    return this.store({
      content,
      type: 'agent',
      source: 'agent',
      tags,
      importance: importance ?? 0.8,
    });
  }

  async forget(id: string): Promise<void> {
    this.stmtDelete.run(id);
    this.vectors = this.vectors.filter(v => v.id !== id);
  }

  async search(query: string, opts?: SearchOpts): Promise<ScoredMemory[]> {
    const limit = opts?.limit ?? 10;
    const minScore = opts?.minScore ?? 0.1;
    const queryEmbedding = await embed(query);

    // Score all entries
    const scored: Array<{ id: string; score: number }> = [];
    const now = Date.now();

    for (const entry of this.vectors) {
      const similarity = dotProduct(queryEmbedding, entry.embedding);
      const ageDays = (now - entry.createdAt) / 86_400_000;
      const recencyBoost = Math.exp(-ageDays / 30);
      const score = (similarity * 0.6) + (entry.importance * 0.25) + (recencyBoost * 0.15);

      if (score >= minScore) {
        scored.push({ id: entry.id, score });
      }
    }

    // Sort by score descending, take top-K
    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, limit);

    if (topIds.length === 0) return [];

    // Fetch full entries from DB
    const results: ScoredMemory[] = [];
    const updateTime = Date.now();

    for (const { id, score } of topIds) {
      const row = this.stmtGetById.get(id) as {
        id: string;
        content: string;
        type: 'auto' | 'agent' | 'user';
        source: string;
        tags: string;
        embedding: Buffer;
        created_at: number;
        accessed_at: number;
        importance: number;
      } | undefined;

      if (!row) continue;

      // Filter by type if specified
      if (opts?.type && row.type !== opts.type) continue;

      // Update accessed_at
      this.stmtUpdateAccessed.run(updateTime, id);

      results.push({
        id: row.id,
        content: row.content,
        type: row.type,
        source: row.source,
        tags: JSON.parse(row.tags),
        embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, EMBEDDING_DIM),
        createdAt: row.created_at,
        accessedAt: updateTime,
        importance: row.importance,
        score,
      });
    }

    return results;
  }

  async recent(limit = 20): Promise<MemoryEntry[]> {
    const rows = this.stmtGetRecent.all(limit) as Array<{
      id: string;
      content: string;
      type: 'auto' | 'agent' | 'user';
      source: string;
      tags: string;
      embedding: Buffer;
      created_at: number;
      accessed_at: number;
      importance: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      type: row.type,
      source: row.source,
      tags: JSON.parse(row.tags),
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, EMBEDDING_DIM),
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      importance: row.importance,
    }));
  }

  async stats(): Promise<MemoryStats> {
    const counts = this.stmtCountByType.all() as Array<{ type: string; count: number }>;
    const byType = { auto: 0, agent: 0, user: 0 };
    let total = 0;
    for (const row of counts) {
      byType[row.type as keyof typeof byType] = row.count;
      total += row.count;
    }

    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(this.dbPath).size;
    } catch {}

    const oldest = this.db.prepare('SELECT MIN(created_at) as ts FROM memories').get() as { ts: number | null };
    const newest = this.db.prepare('SELECT MAX(created_at) as ts FROM memories').get() as { ts: number | null };

    return {
      total,
      byType,
      dbSizeBytes,
      oldestEntry: oldest.ts,
      newestEntry: newest.ts,
    };
  }

  async prune(maxEntries = 10000): Promise<number> {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
    if (total <= maxEntries) return 0;

    const toRemove = total - maxEntries;
    // Remove lowest-importance, oldest entries first
    const ids = this.db.prepare(`
      SELECT id FROM memories
      ORDER BY importance ASC, created_at ASC
      LIMIT ?
    `).all(toRemove) as Array<{ id: string }>;

    const deleteMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        this.stmtDelete.run(id);
      }
    });

    const idList = ids.map(r => r.id);
    deleteMany(idList);

    // Rebuild vector cache
    const idSet = new Set(idList);
    this.vectors = this.vectors.filter(v => !idSet.has(v.id));

    return idList.length;
  }

  close(): void {
    this.db.close();
  }
}

// Dot product on normalized vectors = cosine similarity
function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
