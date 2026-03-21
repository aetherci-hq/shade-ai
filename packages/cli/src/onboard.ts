import { createInterface } from 'readline/promises';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ─── Terminal styling (no chalk dependency for colors — use ANSI) ───

const GREEN = '\x1b[38;2;57;255;20m';
const CYAN = '\x1b[38;2;88;166;255m';
const AMBER = '\x1b[38;2;210;153;34m';
const DIM = '\x1b[38;2;139;148;158m';
const RED = '\x1b[38;2;248;81;73m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function green(s: string) { return `${GREEN}${s}${RESET}`; }
function cyan(s: string) { return `${CYAN}${s}${RESET}`; }
function amber(s: string) { return `${AMBER}${s}${RESET}`; }
function dim(s: string) { return `${DIM}${s}${RESET}`; }
function red(s: string) { return `${RED}${s}${RESET}`; }
function bold(s: string) { return `${BOLD}${s}${RESET}`; }

// ─── Main ───────────────────────────────────────────────────────────

export async function runOnboarding(baseDir: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const envPath = resolve(baseDir, '.env');
  const configPath = resolve(baseDir, 'specter.config.yaml');
  const soulPath = resolve(baseDir, 'SOUL.md');
  const memoryPath = resolve(baseDir, 'MEMORY.md');
  const heartbeatPath = resolve(baseDir, 'HEARTBEAT.md');
  const stateDir = resolve(baseDir, 'state');
  const toolsDir = resolve(baseDir, 'tools');

  // ─── Banner ─────────────────────────────────────────────────────

  console.log('');
  console.log(green('  ╔══════════════════════════════════════════╗'));
  console.log(green('  ║') + bold('   ⚡ SPECTER — Agent Onboarding          ') + green('║'));
  console.log(green('  ╚══════════════════════════════════════════╝'));
  console.log('');
  console.log(dim('  Configure your autonomous AI agent in 3 steps.'));
  console.log('');

  // ─── Step 1: Agent Name ─────────────────────────────────────────

  console.log(green('  [1/3]') + bold(' Agent Name'));
  console.log(dim('  This is how your agent identifies itself.'));
  console.log('');

  const name = (await rl.question(green('  > ') + 'Name ' + dim('(Specter) ') + green('> '))).trim() || 'Specter';

  console.log('');
  console.log(dim('  Agent name: ') + cyan(name));
  console.log('');

  // ─── Step 2: API Key ────────────────────────────────────────────

  console.log(green('  [2/3]') + bold(' Claude API Key'));
  console.log(dim('  Get one at https://console.anthropic.com/settings/keys'));
  console.log('');

  // Check if .env already has a key
  let existingKey = '';
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/ANTHROPIC_API_KEY=(.+)/);
    if (match && match[1].trim() && !match[1].includes('your-key')) {
      existingKey = match[1].trim();
      console.log(dim('  Found existing key: ') + cyan(existingKey.slice(0, 10) + '...' + existingKey.slice(-4)));
      const useExisting = (await rl.question(green('  > ') + 'Use this key? ' + dim('(Y/n) ') + green('> '))).trim().toLowerCase();
      if (useExisting !== 'n' && useExisting !== 'no') {
        console.log(dim('  Keeping existing key.'));
        console.log('');
      } else {
        existingKey = '';
      }
    }
  }

  let apiKey = existingKey;
  if (!apiKey) {
    apiKey = (await rl.question(green('  > ') + 'API Key ' + green('> '))).trim();

    if (!apiKey) {
      console.log(red('  Error: API key is required.'));
      rl.close();
      process.exit(1);
    }

    if (!apiKey.startsWith('sk-ant-')) {
      console.log(amber('  Warning: Key doesn\'t start with sk-ant-. Proceeding anyway.'));
    }
  }

  // Validate key with a quick API call
  console.log('');
  process.stdout.write(dim('  Validating key... '));
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    console.log(green('✓ Valid'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('authentication') || msg.includes('401') || msg.includes('invalid')) {
      console.log(red('✗ Invalid key'));
      console.log(red('  ' + msg));
      rl.close();
      process.exit(1);
    }
    // Other errors (rate limit, etc.) mean the key works
    console.log(amber('⚠ Key accepted (non-auth error: ' + msg.slice(0, 60) + ')'));
  }
  console.log('');

  // ─── Step 3: Persona ────────────────────────────────────────────

  console.log(green('  [3/3]') + bold(' Persona'));
  console.log(dim('  Describe your agent\'s personality in a sentence or two.'));
  console.log(dim('  Examples:'));
  console.log(dim('    "A snarky DevOps engineer who automates everything"'));
  console.log(dim('    "A meticulous researcher who cites sources"'));
  console.log(dim('    "A no-nonsense coding assistant, terse and fast"'));
  console.log('');

  const personaInput = (await rl.question(green('  > ') + 'Persona ' + green('> '))).trim();

  if (!personaInput) {
    console.log(dim('  Using default persona.'));
  }

  rl.close();

  // ─── Generate SOUL.md via streaming API call ────────────────────

  console.log('');
  console.log(green('  ─── Generating SOUL.md ───'));
  console.log('');

  const client = new Anthropic({ apiKey });

  const soulPrompt = `You are writing a system prompt (SOUL.md) for an autonomous AI agent named "${name}".

The user described the agent's personality as: "${personaInput || 'A helpful autonomous agent'}"

Generate a complete SOUL.md that includes these sections:

1. **Opening line**: "You are ${name}, ..." incorporating the personality described above.
2. **## Identity**: What the agent is, how it operates, its personality traits.
3. **## Tools**: List the available tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent). For Agent, mention the researcher (haiku) and coder (sonnet) subagents. Also mention Read/Write/Edit on MEMORY.md, HEARTBEAT.md, SOUL.md for persistent memory.
4. **### Tool Call Style**: Don't narrate routine calls, just do them.
5. **## Problem Solving**: 5-step approach (diagnose, try alternatives, research when stuck, break down complexity, recover from errors). Never say "I can't".
6. **## Memory Management**: MEMORY.md (long-term notes), HEARTBEAT.md (standing orders), SOUL.md (this file). When to write to memory. Keep it clean.
7. **## Heartbeat Behavior**: Read orders, read memory, execute or respond IDLE. The IDLE convention.
8. **## Workspace**: Root directory, key locations.
9. **## Response Style**: How the agent communicates — incorporate the personality described above.

Make the personality PERVASIVE — it should color the entire document, not just a sentence. If they said "snarky", the whole tone should have edge. If they said "meticulous", every section should reflect precision.

Output ONLY the markdown content for SOUL.md. No preamble, no explanation.`;

  process.stdout.write('  ');

  let soulContent = '';

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2500,
    messages: [{ role: 'user', content: soulPrompt }],
  });

  stream.on('text', (text) => {
    soulContent += text;
    process.stdout.write(dim(text));
  });

  await stream.finalMessage();

  console.log('');
  console.log('');

  // ─── Write all files ────────────────────────────────────────────

  console.log(green('  ─── Writing configuration ───'));
  console.log('');

  // Ensure directories exist
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(toolsDir, { recursive: true });

  // .env
  writeFileSync(envPath, `ANTHROPIC_API_KEY=${apiKey}\n`, 'utf-8');
  console.log(dim('  ✓ ') + cyan('.env'));

  // specter.config.yaml (only if it doesn't exist)
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `llm:
  provider: claude
  model: claude-sonnet-4-20250514
  maxTokens: 4096

agent:
  maxTurns: 75
  permissionMode: bypassPermissions
  subagents:
    researcher:
      description: Research agent for web searches, information gathering, and analysis.
      prompt: You are a research specialist. Search the web, gather information, and report findings concisely.
      tools: [WebSearch, WebFetch, Read, Grep, Glob]
      model: haiku
    coder:
      description: Coding agent for writing, editing, and debugging code.
      prompt: You are a coding specialist. Write clean, correct code. Read existing code before modifying it.
      tools: [Read, Write, Edit, Bash, Glob, Grep]
      model: sonnet

heartbeat:
  enabled: true
  intervalMinutes: 15

server:
  port: 3700
  host: 127.0.0.1

memory:
  dir: .
  stateDir: ./state

tools:
  allowed:
    - Read
    - Write
    - Edit
    - Bash
    - Glob
    - Grep
    - WebFetch
    - WebSearch
    - Agent
  disallowed: []
  userDir: ./tools

guardrails:
  blockedCommands:
    - "rm -rf /"
    - "format"
    - "shutdown"
    - "reboot"
  blockedPaths:
    - /etc
    - /System
  maxShellTimeout: 30000
  allowedHosts:
    - "*"
  maxFileSize: 1048576
`, 'utf-8');
    console.log(dim('  ✓ ') + cyan('specter.config.yaml'));
  } else {
    console.log(dim('  ⊘ specter.config.yaml (already exists, kept)'));
  }

  // SOUL.md
  writeFileSync(soulPath, soulContent.trim() + '\n', 'utf-8');
  console.log(dim('  ✓ ') + cyan('SOUL.md') + dim(` (${soulContent.length} chars)`));

  // MEMORY.md (only if doesn't exist)
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, `# ${name} Memory\n\n_No memories yet._\n`, 'utf-8');
    console.log(dim('  ✓ ') + cyan('MEMORY.md'));
  } else {
    console.log(dim('  ⊘ MEMORY.md (already exists, kept)'));
  }

  // HEARTBEAT.md (only if doesn't exist)
  if (!existsSync(heartbeatPath)) {
    writeFileSync(heartbeatPath, `# Standing Orders\n\n_No standing orders yet. Add tasks here for ${name} to execute on heartbeat._\n`, 'utf-8');
    console.log(dim('  ✓ ') + cyan('HEARTBEAT.md'));
  } else {
    console.log(dim('  ⊘ HEARTBEAT.md (already exists, kept)'));
  }

  // ─── Done ───────────────────────────────────────────────────────

  console.log('');
  console.log(green('  ╔══════════════════════════════════════════╗'));
  console.log(green('  ║') + bold(`   ⚡ ${name} is ready.`) + ' '.repeat(Math.max(0, 27 - name.length)) + green('║'));
  console.log(green('  ╚══════════════════════════════════════════╝'));
  console.log('');
  console.log(dim('  Start your agent:'));
  console.log(cyan('    npx specter start'));
  console.log('');
  console.log(dim('  Dashboard:'));
  console.log(cyan('    http://localhost:3700'));
  console.log('');
}
