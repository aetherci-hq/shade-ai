import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from './config.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  optional?: boolean;
}

export interface ToolConfigField {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface UserToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  config: Record<string, ToolConfigField>;
  filename: string;
  enabled: boolean;
  configured: boolean;  // true if all required config fields are set
  source?: string;      // npm package name if installed from catalog (e.g. 'specter-tool-weather')
}

// ─── Tool Config Store ──────────────────────────────────────────────

function configPath(): string {
  const config = getConfig();
  return resolve(config.tools.userDir, '.config.json');
}

export function loadToolConfig(): Record<string, Record<string, string>> {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveToolConfig(toolName: string, values: Record<string, string>): void {
  const all = loadToolConfig();
  all[toolName] = { ...(all[toolName] ?? {}), ...values };
  writeFileSync(configPath(), JSON.stringify(all, null, 2), 'utf-8');
}

export function getToolConfigValues(toolName: string): Record<string, string> {
  return loadToolConfig()[toolName] ?? {};
}

// ─── Tool Registry ──────────────────────────────────────────────────

let _tools: UserToolDefinition[] = [];

/**
 * Scan the tools/ directory and extract tool definitions from TypeScript files.
 * Each tool file must export a default with { name, description, parameters, execute }.
 * We parse the metadata WITHOUT executing the file (read + regex extract).
 */
export function loadUserTools(): UserToolDefinition[] {
  const config = getConfig();
  const toolsDir = config.tools.userDir;

  if (!existsSync(toolsDir)) {
    _tools = [];
    return _tools;
  }

  const files = readdirSync(toolsDir).filter(f =>
    (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('_')
  );

  const allConfig = loadToolConfig();
  const tools: UserToolDefinition[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(resolve(toolsDir, file), 'utf-8');
      const def = parseToolMetadata(content, file, allConfig);
      if (def) tools.push(def);
    } catch (err) {
      console.error(`[tools] Failed to parse ${file}:`, err);
    }
  }

  _tools = tools;
  return _tools;
}

export function getUserTools(): UserToolDefinition[] {
  return _tools;
}

/**
 * Parse tool metadata from file content without executing it.
 */
function parseToolMetadata(
  content: string,
  filename: string,
  allConfig: Record<string, Record<string, string>>,
): UserToolDefinition | null {
  // Extract name
  const nameMatch = content.match(/name:\s*['"`]([^'"`]+)['"`]/);
  if (!nameMatch) return null;
  const name = nameMatch[1];

  // Extract first description (the tool-level one, before config/parameters blocks)
  const descMatch = content.match(/^\s*description:\s*['"`]([^'"`]+)['"`]/m);
  if (!descMatch) return null;

  // Extract source (npm package origin)
  const sourceMatch = content.match(/source:\s*['"`]([^'"`]+)['"`]/);
  const source = sourceMatch?.[1];

  // Extract config block — match with or without trailing comma
  const configFields: Record<string, ToolConfigField> = {};
  const configBlockMatch = content.match(/config:\s*\{([\s\S]*?)\n\s*\},?/);
  if (configBlockMatch) {
    const configBlock = configBlockMatch[1];
    // Match fields with any order of type/description/required, handles multiline
    const fieldRegex = /(\w+):\s*\{([^}]+)\}/gs;
    let match;
    while ((match = fieldRegex.exec(configBlock)) !== null) {
      const body = match[2];
      const typeM = body.match(/type:\s*['"`](\w+)['"`]/);
      const descM = body.match(/description:\s*['"`]([^'"`]+)['"`]/);
      const reqM = body.match(/required:\s*(true|false)/);
      if (typeM && descM) {
        configFields[match[1]] = {
          type: typeM[1] as 'string' | 'number' | 'boolean',
          description: descM[1],
          required: reqM ? reqM[1] === 'true' : true,
        };
      }
    }
  }

  // Extract parameters block — match with or without trailing comma
  const params: Record<string, ToolParameter> = {};
  const paramBlockMatch = content.match(/parameters:\s*\{([\s\S]*?)\n\s*\},?/);
  if (paramBlockMatch) {
    const paramBlock = paramBlockMatch[1];
    const fieldRegex = /(\w+):\s*\{([^}]+)\}/gs;
    let match;
    while ((match = fieldRegex.exec(paramBlock)) !== null) {
      const body = match[2];
      const typeM = body.match(/type:\s*['"`](\w+)['"`]/);
      const descM = body.match(/description:\s*['"`]([^'"`]+)['"`]/);
      const optM = body.match(/optional:\s*(true|false)/);
      if (typeM && descM) {
        params[match[1]] = {
          type: typeM[1] as 'string' | 'number' | 'boolean',
          description: descM[1],
          optional: optM ? optM[1] === 'true' : false,
        };
      }
    }
  }

  // Check if tool is fully configured
  const toolConfig = allConfig[name] ?? {};
  const requiredFields = Object.entries(configFields).filter(([, f]) => f.required);
  const configured = requiredFields.every(([key]) => toolConfig[key]?.trim());

  return {
    name,
    description: descMatch[1],
    parameters: params,
    config: configFields,
    filename,
    enabled: true,
    configured,
    source,
  };
}

/**
 * Generate the system prompt section for custom tools.
 */
export function getToolPromptSection(): string {
  const enabledTools = _tools.filter(t => t.enabled);
  if (enabledTools.length === 0) return '';

  const relDir = 'tools';

  const toolLines = enabledTools.map(tool => {
    const paramParts = Object.entries(tool.parameters).map(([key, p]) => {
      const opt = p.optional ? '?' : '';
      return `${key}${opt}: ${p.type}`;
    });
    const paramStr = paramParts.length > 0 ? ` Params: {${paramParts.join(', ')}}` : '';
    const setupNote = !tool.configured ? ' ⚠️ NEEDS SETUP' : '';
    return `- **${tool.name}**: ${tool.description}${paramStr}${setupNote}`;
  });

  return [
    '\n\n## Custom Tools',
    `You have ${enabledTools.length} custom tool${enabledTools.length !== 1 ? 's' : ''} available. Call them via Bash:`,
    '```',
    `npx tsx ${relDir}/_run.ts <tool_name> '<json_params>'`,
    '```',
    '',
    ...toolLines,
  ].join('\n');
}
