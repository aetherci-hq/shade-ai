#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'path';
import { runOnboarding } from './onboard.js';

const DEFAULT_PORT = 3700;
const DEFAULT_HOST = '127.0.0.1';

function baseUrl(opts: { port?: string }): string {
  const port = opts.port ?? String(DEFAULT_PORT);
  return `http://${DEFAULT_HOST}:${port}`;
}

const program = new Command()
  .name('shade-ai')
  .description('Shade — Lightweight Autonomous AI Agent')
  .version('0.1.0');

// shade init
program
  .command('init')
  .description('Set up a new agent (name, API key, persona)')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .action(async (opts) => {
    const dir = resolve(opts.dir);
    await runOnboarding(dir);
  });

// shade start
program
  .command('start')
  .description('Start the Shade server + agent + heartbeat')
  .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
  .option('--no-heartbeat', 'Disable heartbeat daemon')
  .action(async (opts) => {
    process.env.SHADE_PORT = opts.port;
    if (!opts.heartbeat) process.env.SHADE_NO_HEARTBEAT = '1';
    await import('@shade/server');
  });

// shade chat
program
  .command('chat <message>')
  .description('Send a message to the running agent')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (message: string, opts) => {
    try {
      const res = await fetch(`${baseUrl(opts)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json() as { response: string };
      console.log(data.response);
    } catch {
      console.error('Error: Could not connect to Shade. Is it running?');
      process.exit(1);
    }
  });

// shade status
program
  .command('status')
  .description('Check Shade server status')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (opts) => {
    try {
      const res = await fetch(`${baseUrl(opts)}/api/status`);
      const data = await res.json() as Record<string, unknown>;
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.error('Shade is not running.');
      process.exit(1);
    }
  });

// shade heartbeat
const hb = program.command('heartbeat').description('Control the heartbeat daemon');

hb.command('on')
  .description('Enable heartbeat')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (opts) => {
    await sendWsMessage(opts, 'heartbeat:toggle', { enabled: true });
    console.log('Heartbeat enabled.');
  });

hb.command('off')
  .description('Disable heartbeat')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (opts) => {
    await sendWsMessage(opts, 'heartbeat:toggle', { enabled: false });
    console.log('Heartbeat disabled.');
  });

hb.command('now')
  .description('Trigger an immediate heartbeat')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (opts) => {
    await sendWsMessage(opts, 'heartbeat:trigger', {});
    console.log('Heartbeat triggered.');
  });

// shade logs
program
  .command('logs')
  .description('View activity logs')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .option('-n, --tail <lines>', 'Number of entries', '20')
  .action(async (opts) => {
    try {
      const res = await fetch(`${baseUrl(opts)}/api/activity?limit=${opts.tail}`);
      const data = await res.json() as Array<Record<string, unknown>>;
      for (const entry of data.reverse()) {
        const ts = new Date(entry['ts'] as number).toLocaleTimeString('en-US', { hour12: false });
        const type = entry['type'] as string;
        console.log(`${ts}  ${type.padEnd(20)}  ${JSON.stringify(entry).slice(0, 100)}`);
      }
    } catch {
      console.error('Error: Could not connect to Shade.');
      process.exit(1);
    }
  });

async function sendWsMessage(opts: { port?: string }, type: string, data: Record<string, unknown>): Promise<void> {
  const { WebSocket } = await import('ws');
  const port = opts.port ?? String(DEFAULT_PORT);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${DEFAULT_HOST}:${port}/ws`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type, data }));
      setTimeout(() => { ws.close(); resolve(); }, 500);
    });
    ws.on('error', () => { reject(new Error('Could not connect')); });
  });
}

program.parse();
