/**
 * ArdInstaller – turns a chosen discovered resource into a local action.
 *
 * Safety posture: every action is NON-DESTRUCTIVE and DISABLED-by-default.
 *   - `application/mcp-server+json` → added to the MCP registry **disabled**;
 *     the user enables/connects it through the existing MCP trust gate, so no
 *     new execution path is introduced here.
 *   - `application/ai-catalog+json` / `application/ai-registry+json` → added as a
 *     new Agent Finder, **disabled** (opt-in before any outbound traffic).
 *   - `application/a2a-agent-card+json`, `application/ai-skill`, APIs, and any
 *     other type → recorded as a reference only. AtlasMind does not auto-wire
 *     arbitrary remote execution; the URL + trust metadata are surfaced for the
 *     user to act on manually. (Documented v1 limitation.)
 */

import type { McpServerRegistry } from '../mcp/mcpServerRegistry.js';
import type { ArdRegistry } from './ardRegistry.js';
import type {
  ArdDiscoveredResource,
  ArdInstallResult,
  McpServerConfig,
} from '../types.js';

export class ArdInstaller {
  constructor(
    private readonly mcpServerRegistry: McpServerRegistry,
    private readonly ardRegistry: ArdRegistry,
  ) {}

  /** Map a discovered resource to a local install action. Never throws. */
  async install(resource: ArdDiscoveredResource): Promise<ArdInstallResult> {
    switch (resource.type) {
      case 'application/mcp-server+json':
        return this.installMcpServer(resource);
      case 'application/ai-catalog+json':
        return this.installFinder(resource, 'manifest');
      case 'application/ai-registry+json':
        return this.installFinder(resource, 'registry');
      default:
        return this.recordReference(resource);
    }
  }

  // ── MCP server ────────────────────────────────────────────────

  private installMcpServer(resource: ArdDiscoveredResource): ArdInstallResult {
    const config = resolveMcpConfig(resource);
    if (!config) {
      return {
        kind: 'reference',
        ok: true,
        message:
          `"${resource.displayName}" is an MCP server but its connection details could not be derived automatically. ` +
          `Open the MCP Servers panel and add it manually` +
          (resource.url ? ` using: ${resource.url}` : '') + '.',
      };
    }

    const id = this.mcpServerRegistry.addServer(config);
    return {
      kind: 'mcp-server',
      ok: true,
      mcpServerId: id,
      message:
        `Added "${config.name}" to the MCP Servers panel as a disabled server. ` +
        `Review it there, then enable it to connect — its tools become AtlasMind skills.`,
    };
  }

  // ── Finder (nested catalog / registry) ────────────────────────

  private installFinder(resource: ArdDiscoveredResource, kind: 'registry' | 'manifest'): ArdInstallResult {
    if (!resource.url) {
      return {
        kind: 'unsupported',
        ok: false,
        message: `"${resource.displayName}" is a ${kind} but has no URL to register as an Agent Finder.`,
      };
    }
    const id = this.ardRegistry.add({
      name: resource.displayName,
      url: resource.url,
      kind,
      enabled: false,
    });
    return {
      kind: 'finder',
      ok: true,
      finderId: id,
      message:
        `Added "${resource.displayName}" as a disabled Agent Finder. ` +
        `Enable it in Resource Discovery to search it.`,
    };
  }

  // ── Reference-only resources ──────────────────────────────────

  private recordReference(resource: ArdDiscoveredResource): ArdInstallResult {
    const label = describeResourceType(resource.type);
    return {
      kind: 'reference',
      ok: true,
      message:
        `"${resource.displayName}" is ${label}. AtlasMind does not auto-install this resource type yet — ` +
        `${resource.url ? `connect it manually using: ${resource.url}` : 'no endpoint was provided'}.`,
    };
  }
}

// ── Connection mapping ────────────────────────────────────────────

/**
 * Derive a (disabled) MCP server config from a discovered MCP resource.
 * Prefers an embedded artifact (`data`) describing the connection; otherwise
 * falls back to treating the entry `url` as a remote Streamable-HTTP endpoint
 * for the user to verify. Returns undefined when nothing usable is found.
 */
export function resolveMcpConfig(resource: ArdDiscoveredResource): Omit<McpServerConfig, 'id'> | undefined {
  const name = resource.displayName.trim() || resource.identifier;
  const data = resource.data ?? {};

  // 1) Embedded stdio connection: command + args (+ env).
  const command = pickString(data, ['command']);
  if (command) {
    const args = pickStringArray(data, ['args']);
    const env = pickStringRecord(data, ['env']);
    return {
      name,
      transport: 'stdio',
      command,
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
      enabled: false,
    };
  }

  // 2) Embedded or referenced remote endpoint (http/SSE).
  const remoteUrl =
    pickString(data, ['url', 'endpoint', 'serverUrl', 'baseUrl']) ??
    (isHttpUrl(resource.url) ? resource.url : undefined);
  if (remoteUrl && isHttpUrl(remoteUrl)) {
    return {
      name,
      transport: 'http',
      url: remoteUrl,
      enabled: false,
    };
  }

  return undefined;
}

/**
 * What installing a resource will actually do, stated before it happens.
 *
 * The confirmation dialog shows this rather than a summary beside it: the
 * finder, the destination, and — for an MCP server — the exact command it would
 * run or the URL it would reach, since that is what a person is agreeing to.
 * The relevance score is repeated as what it is, not as trust.
 */
export function describeInstallPlan(resource: ArdDiscoveredResource): string {
  const lines = [`Found by: ${resource.sourceName}`];
  if (resource.url) { lines.push(`Source: ${resource.url}`); }
  if (typeof resource.score === 'number') {
    lines.push(`Relevance ${resource.score}/100 — how well it matched the search, not a trust or safety rating.`);
  }
  switch (resource.type) {
    case 'application/mcp-server+json': {
      const config = resolveMcpConfig(resource);
      if (!config) {
        lines.push('Nothing will be added automatically: its connection details could not be derived. You will be pointed to the MCP Servers panel to add it by hand.');
      } else if (config.transport === 'stdio') {
        const commandLine = [config.command, ...(config.args ?? [])].join(' ');
        lines.push(`Adds an MCP server, switched OFF, that would run on this machine:\n  ${commandLine.slice(0, 300)}`);
        if (config.env && Object.keys(config.env).length > 0) {
          lines.push(`With environment variables: ${Object.keys(config.env).slice(0, 10).join(', ')}`);
        }
        lines.push('Nothing runs until you enable it in the MCP Servers panel.');
      } else {
        lines.push(`Adds an MCP server, switched OFF, that would connect to:\n  ${config.url ?? ''}`);
        lines.push('Nothing connects until you enable it in the MCP Servers panel.');
      }
      break;
    }
    case 'application/ai-catalog+json':
    case 'application/ai-registry+json':
      lines.push('Adds it as an Agent Finder, switched OFF. Nothing is queried until you enable it.');
      break;
    default:
      lines.push(`${describeResourceType(resource.type)}: AtlasMind cannot install this type, so nothing will be added — you will be told how to connect it yourself.`);
  }
  return lines.join('\n');
}

function describeResourceType(type: string): string {
  switch (type) {
    case 'application/a2a-agent-card+json':
      return 'an A2A agent';
    case 'application/ai-skill':
      return 'a Skill';
    default:
      return `a "${type}" resource`;
  }
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  try {
    const protocol = new URL(value).protocol.toLowerCase();
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function pickString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickStringArray(data: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === 'string');
      if (items.length > 0) {
        return items;
      }
    }
  }
  return undefined;
}

function pickStringRecord(data: Record<string, unknown>, keys: string[]): Record<string, string> | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record: Record<string, string> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string') {
          record[k] = v;
        }
      }
      if (Object.keys(record).length > 0) {
        return record;
      }
    }
  }
  return undefined;
}
