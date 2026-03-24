import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  // Bundle workspace packages (@shade/*) into the output
  // Keep npm-published deps and Node built-ins as external
  noExternal: [/@shade\/.*/],
  external: [
    // Node built-ins
    'fs', 'path', 'url', 'os', 'events', 'child_process', 'crypto', 'stream',
    'readline', 'readline/promises', 'net', 'http', 'https', 'util', 'buffer',
    'node:fs', 'node:path', 'node:url', 'node:os', 'node:events',
    'node:child_process', 'node:crypto', 'node:stream', 'node:readline',
    'node:net', 'node:http', 'node:https', 'node:util', 'node:buffer',
    // npm deps (resolved at install time)
    '@anthropic-ai/sdk', '@anthropic-ai/claude-agent-sdk',
    'better-sqlite3', '@xenova/transformers',
    'fastify', '@fastify/cors', '@fastify/static', '@fastify/websocket',
    'yaml', 'zod', 'glob', 'chalk', 'commander', 'ws',
  ],
  // Shebang is already in src/index.ts line 1
});
