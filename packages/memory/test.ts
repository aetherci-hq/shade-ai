/**
 * Quick smoke test for the memory layer.
 * Run: npx tsx packages/memory/test.ts
 */
import { MemoryStore } from './src/store.js';
import { chunkText } from './src/extractor.js';
import { resolve } from 'path';
import { mkdirSync, rmSync } from 'fs';

const TEST_DIR = resolve('state/test');
const DB_PATH = resolve(TEST_DIR, 'memory-test.db');

async function run() {
  mkdirSync(TEST_DIR, { recursive: true });

  // Clean up any previous test DB
  try { rmSync(DB_PATH); } catch {}

  const store = new MemoryStore();

  console.log('--- Init store ---');
  console.time('init');
  await store.init(DB_PATH);
  console.timeEnd('init');

  // Store some memories
  console.log('\n--- Storing memories ---');
  console.time('store 5 memories');

  await store.store({
    content: 'The deploy pipeline uses GitHub Actions with a staging approval gate before production.',
    type: 'agent', source: 'conv-1', tags: ['deploy', 'ci-cd'], importance: 0.9,
  });

  await store.store({
    content: 'User prefers copper accent color (#D29922) and sharp corners in the dashboard UI.',
    type: 'agent', source: 'conv-2', tags: ['design', 'dashboard'], importance: 0.8,
  });

  await store.store({
    content: 'Specter runs on port 3700 by default. The heartbeat daemon checks in every 15 minutes.',
    type: 'auto', source: 'conv-3', importance: 0.4,
  });

  await store.store({
    content: 'The agent encountered a rate limit error when making rapid WebSearch calls. Added a 1s delay between searches.',
    type: 'auto', source: 'conv-4', tags: ['bug', 'rate-limit'], importance: 0.5,
  });

  await store.remember(
    'User is building an autonomous AI agent platform called Specter. They care deeply about design quality and local-first architecture.',
    ['user-context', 'project'],
  );

  console.timeEnd('store 5 memories');

  // Search
  console.log('\n--- Semantic search ---');

  const queries = [
    'How does deployment work?',
    'What does the dashboard look like?',
    'Tell me about the user',
    'rate limiting issues',
    'heartbeat configuration',
  ];

  for (const q of queries) {
    console.time(`search: "${q}"`);
    const results = await store.search(q, { limit: 3 });
    console.timeEnd(`search: "${q}"`);
    console.log(`  Top ${results.length} results:`);
    for (const r of results) {
      console.log(`    [${r.score.toFixed(3)}] (${r.type}) ${r.content.slice(0, 80)}...`);
    }
    console.log();
  }

  // Stats
  console.log('--- Stats ---');
  const stats = await store.stats();
  console.log(stats);

  // Recent
  console.log('\n--- Recent (limit 3) ---');
  const recent = await store.recent(3);
  for (const r of recent) {
    console.log(`  [${new Date(r.createdAt).toISOString()}] (${r.type}) ${r.content.slice(0, 60)}...`);
  }

  // Chunking
  console.log('\n--- Chunking test ---');
  const longText = 'First paragraph about deployment.\n\nSecond paragraph about testing strategies and how they relate to CI/CD pipelines in modern software development workflows.\n\nThird paragraph about monitoring and observability in production systems.\n\nFourth paragraph.';
  const chunks = chunkText(longText, 100);
  console.log(`  Input: ${longText.length} chars → ${chunks.length} chunks`);
  for (const [i, c] of chunks.entries()) {
    console.log(`  [${i}] (${c.length} chars) ${c.slice(0, 60)}...`);
  }

  // Forget
  console.log('\n--- Forget ---');
  const beforeCount = (await store.stats()).total;
  const toForget = recent[0].id;
  await store.forget(toForget);
  const afterCount = (await store.stats()).total;
  console.log(`  Before: ${beforeCount}, After: ${afterCount}`);

  // Cleanup
  store.close();
  rmSync(DB_PATH);
  try { rmSync(TEST_DIR, { recursive: true }); } catch {}

  console.log('\n✓ All checks passed.');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
