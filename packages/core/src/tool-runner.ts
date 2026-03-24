/**
 * Tool runner — executes a user-defined tool by name with JSON parameters.
 * Called by the agent via Bash: npx tsx tools/_run.ts <tool_name> '<json_params>'
 *
 * This script is copied to the workspace tools/ directory at startup.
 */

import { resolve, dirname } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';

const [,, toolName, paramsJson] = process.argv;

if (!toolName) {
  console.error('Usage: npx tsx _run.ts <tool_name> [json_params]');
  process.exit(1);
}

async function run() {
  // Resolve tools dir from the script's own location
  const scriptPath = resolve(process.argv[1]);
  const toolsDir = dirname(scriptPath);

  // Load tool config
  const configPath = resolve(toolsDir, '.config.json');
  let allConfig: Record<string, Record<string, string>> = {};
  if (existsSync(configPath)) {
    try {
      allConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch { /* skip */ }
  }

  // Find the tool file
  const files = readdirSync(toolsDir).filter(f =>
    (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('_')
  );

  let toolFile: string | null = null;

  // Match by filename first (weather.ts → weather)
  for (const file of files) {
    if (file.replace(/\.(ts|js)$/, '') === toolName) {
      toolFile = file;
      break;
    }
  }

  // If not found by filename, check exported name
  if (!toolFile) {
    for (const file of files) {
      try {
        const mod = await import(pathToFileURL(resolve(toolsDir, file)).href);
        const def = mod.default ?? mod;
        if (def.name === toolName) {
          toolFile = file;
          break;
        }
      } catch { /* skip */ }
    }
  }

  if (!toolFile) {
    console.error(JSON.stringify({ error: `Tool "${toolName}" not found` }));
    process.exit(1);
  }

  // Load and execute
  const mod = await import(pathToFileURL(resolve(toolsDir, toolFile)).href);
  const tool = mod.default ?? mod;

  if (typeof tool.execute !== 'function') {
    console.error(JSON.stringify({ error: `Tool "${toolName}" has no execute function` }));
    process.exit(1);
  }

  const params = paramsJson ? JSON.parse(paramsJson) : {};
  const toolConfig = allConfig[tool.name ?? toolName] ?? {};

  try {
    const result = await tool.execute(params, toolConfig);
    console.log(JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error: msg }));
    process.exit(1);
  }
}

run();
