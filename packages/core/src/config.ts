import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import type { SpecterConfig } from './types.js';

function loadDotenv(baseDir: string): void {
  const envPath = resolve(baseDir, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const DEFAULTS: SpecterConfig = {
  name: 'Specter',
  llm: { provider: 'claude', model: 'claude-sonnet-4-20250514', maxTokens: 4096 },
  agent: {
    maxTurns: 25,
    permissionMode: 'bypassPermissions',
    subagents: {
      researcher: {
        description: 'Research agent for web searches, information gathering, and analysis.',
        prompt: 'You are a research specialist. Search the web, gather information, and report findings concisely.',
        tools: ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'],
        model: 'haiku',
      },
      coder: {
        description: 'Coding agent for writing, editing, and debugging code.',
        prompt: 'You are a coding specialist. Write clean, correct code. Read existing code before modifying it.',
        tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        model: 'sonnet',
      },
    },
  },
  heartbeat: { enabled: true, intervalMinutes: 15 },
  server: { port: 3700, host: '127.0.0.1' },
  memory: { dir: '.', stateDir: './state', embedModel: 'Xenova/all-MiniLM-L6-v2', autoCapture: true, maxEntries: 10000, contextLimit: 8 },
  tools: {
    allowed: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent'],
    disallowed: [],
    userDir: './tools',
  },
  guardrails: {
    blockedCommands: ['rm -rf /', 'format', 'shutdown', 'reboot'],
    blockedPaths: ['/etc', '/System', 'C:\\Windows'],
    maxShellTimeout: 30000,
    allowedHosts: ['*'],
    maxFileSize: 1048576,
  },
};

function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '');
}

function deepInterpolate(obj: unknown): unknown {
  if (typeof obj === 'string') return interpolateEnv(obj);
  if (Array.isArray(obj)) return obj.map(deepInterpolate);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepInterpolate(v);
    }
    return result;
  }
  return obj;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

let _config: SpecterConfig | null = null;

export function loadConfig(baseDir: string): SpecterConfig {
  if (_config) return _config;
  loadDotenv(baseDir);

  const configPath = resolve(baseDir, 'specter.config.yaml');
  let userConfig: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    userConfig = (parseYaml(raw) as Record<string, unknown>) ?? {};
  }

  const interpolated = deepInterpolate(userConfig) as Record<string, unknown>;
  const merged = deepMerge(DEFAULTS as unknown as Record<string, unknown>, interpolated);

  // Resolve relative paths against baseDir (where the config file lives)
  const cfg = merged as unknown as SpecterConfig;
  cfg.memory.dir = resolve(baseDir, cfg.memory.dir);
  cfg.memory.stateDir = resolve(baseDir, cfg.memory.stateDir);
  cfg.tools.userDir = resolve(baseDir, cfg.tools.userDir);

  _config = cfg;
  return _config;
}

export function getConfig(): SpecterConfig {
  if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');
  return _config;
}
