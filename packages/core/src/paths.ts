import { homedir } from 'os';
import { resolve } from 'path';
import { existsSync, readdirSync } from 'fs';

/** Returns the global Shade home directory: ~/.shade/ */
export function getShadeHome(): string {
  return resolve(homedir(), '.shade');
}

/** Returns the global HUMAN.md path: ~/.shade/HUMAN.md */
export function getHumanPath(): string {
  return resolve(getShadeHome(), 'HUMAN.md');
}

/**
 * Resolve the agent directory.
 *
 * Dev mode: if shade.config.yaml exists in cwd, returns cwd.
 * Production: finds the agent in ~/.shade/agents/.
 * If only one agent exists, returns it. If a name is provided, uses that.
 */
export function resolveAgentDir(agentName?: string): string {
  // Dev mode: config in cwd means we're running from the repo
  if (existsSync(resolve(process.cwd(), 'shade.config.yaml'))) {
    return process.cwd();
  }

  const agentsDir = resolve(getShadeHome(), 'agents');

  // If a specific agent is requested
  if (agentName) {
    const dir = resolve(agentsDir, agentName);
    if (!existsSync(dir)) {
      throw new Error(`Agent "${agentName}" not found at ${dir}`);
    }
    return dir;
  }

  // Auto-resolve: find the single agent or error
  if (!existsSync(agentsDir)) {
    throw new Error('No agents found. Run `npx shade-ai init` to create one.');
  }

  const agents = readdirSync(agentsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(resolve(agentsDir, d.name, 'shade.config.yaml')))
    .map(d => d.name);

  if (agents.length === 0) {
    throw new Error('No agents found. Run `npx shade-ai init` to create one.');
  }

  if (agents.length === 1) {
    return resolve(agentsDir, agents[0]);
  }

  // Multiple agents — return the list for the CLI to handle with a picker
  throw new MultipleAgentsError(agents);
}

/** List all agent names in ~/.shade/agents/ */
export function listAgents(): string[] {
  const agentsDir = resolve(getShadeHome(), 'agents');
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(resolve(agentsDir, d.name, 'shade.config.yaml')))
    .map(d => d.name);
}

/** Check if we're in dev mode (shade.config.yaml in cwd) */
export function isDevMode(): boolean {
  return existsSync(resolve(process.cwd(), 'shade.config.yaml'));
}

/** Error thrown when multiple agents exist and none was specified */
export class MultipleAgentsError extends Error {
  agents: string[];
  constructor(agents: string[]) {
    super(`Multiple agents found: ${agents.join(', ')}. Specify one with --agent.`);
    this.agents = agents;
  }
}
