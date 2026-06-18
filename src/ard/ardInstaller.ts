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
