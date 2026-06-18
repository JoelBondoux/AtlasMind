/**
 * ardCatalogExporter – builds a spec-conformant `ai-catalog.json` describing
 * AtlasMind's own agents, skills, and MCP servers so other ARD clients can
 * discover this project's resources.
 *
 * Redaction boundary (safety-first): the export contains only names,
 * descriptions, capabilities, and (for MCP) a sanitized connection. It NEVER
 * includes agent system prompts, secrets, or MCP `env` values.
 *
 * @see https://agenticresourcediscovery.org/spec/
 */

import { ARD_SPEC_VERSION } from '../constants.js';
import type {
  AgentDefinition,
  ArdCatalog,
  ArdCatalogEntry,
  McpServerState,
  SkillDefinition,
} from '../types.js';

export interface CatalogExportInput {
  /** Publisher domain used as the URN trust anchor, e.g. `atlasmind.local`. */
  publisher: string;
  hostDisplayName?: string;
  agents?: AgentDefinition[];
  skills?: SkillDefinition[];
  mcpServers?: McpServerState[];
}

/** Build an `ArdCatalog` from the supplied AtlasMind resources. */
export function buildAtlasMindCatalog(input: CatalogExportInput): ArdCatalog {
  const publisher = sanitizePublisher(input.publisher);
  const updatedAt = new Date().toISOString();
  const entries: ArdCatalogEntry[] = [];

  for (const agent of input.agents ?? []) {
    entries.push(agentToEntry(agent, publisher, updatedAt));
  }

  for (const skill of input.skills ?? []) {
    // MCP-derived skills belong to their own publisher, not AtlasMind — skip them.
    if (skill.source?.startsWith('mcp://')) {
      continue;
    }
    entries.push(skillToEntry(skill, publisher, updatedAt));
  }

  for (const server of input.mcpServers ?? []) {
    entries.push(mcpServerToEntry(server, publisher, updatedAt));
  }

  return {
    specVersion: ARD_SPEC_VERSION,
    host: {
      displayName: input.hostDisplayName ?? 'AtlasMind',
      identifier: `did:web:${publisher}`,
    },
    entries,
  };
}

// ── Per-resource mapping ──────────────────────────────────────────

function agentToEntry(agent: AgentDefinition, publisher: string, updatedAt: string): ArdCatalogEntry {
  return {
    identifier: urn(publisher, 'agent', agent.id),
    displayName: agent.name,
    type: 'application/vnd.atlasmind.agent+json',
    // Embedded artifact — never the system prompt.
    data: {
      role: agent.role,
      description: agent.description,
      skills: agent.skills,
    },
    description: agent.description,
    ...(agent.role ? { representativeQueries: [agent.role] } : {}),
    capabilities: agent.skills,
    tags: ['agent', 'atlasmind'],
    updatedAt,
  };
}

function skillToEntry(skill: SkillDefinition, publisher: string, updatedAt: string): ArdCatalogEntry {
  return {
    identifier: urn(publisher, 'skill', skill.id),
    displayName: skill.name,
    type: 'application/ai-skill',
    data: {
      parameters: skill.parameters,
    },
    description: skill.description,
    ...(skill.routingHints && skill.routingHints.length > 0 ? { representativeQueries: skill.routingHints.slice(0, 5) } : {}),
    tags: ['skill', 'atlasmind', ...(skill.builtIn ? ['built-in'] : [])],
    updatedAt,
  };
}

function mcpServerToEntry(server: McpServerState, publisher: string, updatedAt: string): ArdCatalogEntry {
  const { config } = server;
  // Sanitized connection — env is deliberately omitted (may carry secrets).
  const connection: Record<string, unknown> = { transport: config.transport };
  if (config.transport === 'stdio') {
    if (config.command) {
      connection['command'] = config.command;
    }
    if (config.args) {
      connection['args'] = config.args;
    }
  } else if (config.url) {
    connection['url'] = config.url;
  }

  const toolNames = server.tools.map(tool => tool.name);
  return {
    identifier: urn(publisher, 'mcp', config.name),
    displayName: config.name,
    type: 'application/mcp-server+json',
    data: connection,
    ...(toolNames.length > 0 ? { description: `MCP server exposing: ${toolNames.join(', ')}.` } : {}),
    capabilities: toolNames,
    tags: ['mcp-server', 'atlasmind'],
    updatedAt,
  };
}

// ── URN helpers ───────────────────────────────────────────────────

/** Build a `urn:ai:<publisher>:<namespace>:<name>` identifier with a safe terminal slug. */
function urn(publisher: string, namespace: string, name: string): string {
  return `urn:ai:${publisher}:${namespace}:${slugify(name)}`;
}

function sanitizePublisher(publisher: string): string {
  const cleaned = publisher.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
  return cleaned.length > 0 ? cleaned : 'atlasmind.local';
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'resource';
}
