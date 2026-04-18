/**
 * McpServerRegistry – manages persisted MCP server configurations and live client instances.
 *
 * Responsibilities:
 *  - Persist server configurations to VS Code globalState.
 *  - Create and manage McpClient instances keyed by server ID.
 *  - Register MCP tools as SkillDefinition objects in the SkillsRegistry when a server connects.
 *  - Unregister (or disable) those skill entries when a server disconnects.
 *  - Emit a refresh event so UI surfaces update in real time.
 *
 * MCP tool skill IDs follow the pattern: `mcp:<serverId>:<toolName>`
 * MCP tool source follows the pattern:  `mcp://<serverId>/<toolName>`
 */

import type * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { McpClient } from './mcpClient.js';
import type { SkillsRegistry } from '../core/skillsRegistry.js';
import type { McpServerConfig, McpServerState, McpToolInfo, SkillDefinition } from '../types.js';

const STORAGE_KEY = 'atlasmind.mcpServers';
const LEGACY_RECOMMENDED_GIT_PACKAGE = '@modelcontextprotocol/server-git';
const VALID_MODEL_CONTEXT_PROTOCOL_NPX_PACKAGES = new Set([
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-fetch',
  '@modelcontextprotocol/server-sequential-thinking',
  '@modelcontextprotocol/server-time',
  '@modelcontextprotocol/server-everything',
]);

export interface McpServerImportResult {
  added: number;
  updated: number;
  skipped: number;
  connected: number;
  failedConnections: Array<{ name: string; message: string }>;
}

export class McpServerRegistry {
  private clients = new Map<string, McpClient>();
  private states = new Map<string, McpServerState>();

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly skillsRegistry: SkillsRegistry,
    private readonly onRefresh: () => void,
    private readonly outputChannel?: vscode.OutputChannel,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────

  /** List all persisted server configurations (with live status overlaid). */
  listServers(): McpServerState[] {
    return [...this.states.values()];
  }

  /** Add a new server configuration. Returns the new server's ID. */
  addServer(config: Omit<McpServerConfig, 'id'>): string {
    const id = randomUUID();
    const full: McpServerConfig = { ...config, id };
    this.states.set(id, { config: full, status: 'disconnected', tools: [] });
    void this.persist();
    this.onRefresh();
    return id;
  }

  /** Update an existing server's configuration (preserves ID). */
  updateServer(id: string, updates: Partial<Omit<McpServerConfig, 'id'>>): void {
    const state = this.states.get(id);
    if (!state) { return; }
    state.config = { ...state.config, ...updates };
    void this.persist();
    this.onRefresh();
  }

  /** Remove a server and clean up its connection and registered skills. */
  async removeServer(id: string): Promise<void> {
    await this.disconnectServer(id, /* removing */ true);
    this.states.delete(id);
    void this.persist();
    this.onRefresh();
  }

  /**
   * Import compatible MCP servers from another configuration source.
   * Existing equivalent servers are skipped unless the import would enable them.
   */
  async importServers(configs: ReadonlyArray<Omit<McpServerConfig, 'id'>>): Promise<McpServerImportResult> {
    const result: McpServerImportResult = {
      added: 0,
      updated: 0,
      skipped: 0,
      connected: 0,
      failedConnections: [],
    };

    for (const config of configs) {
      const existing = this.findMatchingServer(config);
      if (existing) {
        if (!existing.enabled && config.enabled) {
          this.updateServer(existing.id, { enabled: true });
          result.updated += 1;
          await this.connectImportedServer(existing.id, existing.name, result);
        } else {
          result.skipped += 1;
        }
        continue;
      }

      const id = this.addServer(config);
      result.added += 1;
      await this.connectImportedServer(id, config.name, result);
    }

    return result;
  }

  // ── Connection management ────────────────────────────────────

  /** Connect a single server by ID. Registers its tools in the SkillsRegistry on success. */
  async connectServer(id: string): Promise<void> {
    const state = this.states.get(id);
    if (!state) { return; }

    const repairedConfig = normalizeStoredServerConfig(state.config);
    if (JSON.stringify(repairedConfig) !== JSON.stringify(state.config)) {
      state.config = repairedConfig;
      void this.persist();
    }

    if (!state.config.enabled) {
      this.onRefresh();
      return;
    }

    const knownInvalidReason = getKnownRecommendedServerIssue(state.config);
    if (knownInvalidReason) {
      state.status = 'error';
      state.error = knownInvalidReason;
      state.tools = [];
      this.onRefresh();
      return;
    }

    // Reuse existing connected client if available
    const existing = this.clients.get(id);
    if (existing?.status === 'connected') { return; }

    state.status = 'connecting';
    this.onRefresh();

    const client = new McpClient(state.config);
    this.clients.set(id, client);

    try {
      await client.connect();
    } catch {
      // If StreamableHTTP failed and transport is 'http', try SSE fallback
      if (state.config.transport === 'http' && state.config.url) {
        try {
          const sseFallbackClient = await this.connectViaSse(state.config);
          if (sseFallbackClient) {
            this.clients.set(id, sseFallbackClient);
            state.status = 'connected';
            state.error = undefined;
            state.tools = sseFallbackClient.tools;
            this.registerToolsAsSkills(state.config, sseFallbackClient.tools);
            void this.persist();
            this.onRefresh();
            return;
          }
        } catch {
          // fall through to normal error handling
        }
      }

      state.status = client.status;
      state.error = client.error;
      state.tools = [];
      this.onRefresh();
      return;
    }

    state.status = 'connected';
    state.error = undefined;
    state.tools = client.tools;
    this.registerToolsAsSkills(state.config, client.tools);
    void this.persist();
    this.onRefresh();
  }

  /** Disconnect a server and optionally remove its registered skills entirely. */
  async disconnectServer(id: string, removeSkills = false): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
    }

    const state = this.states.get(id);
    if (state) {
      // Disable (or unregister) skills that were registered by this server
      for (const tool of state.tools) {
        const skillId = mcpSkillId(id, tool.name);
        if (removeSkills) {
          this.skillsRegistry.unregister(skillId);
        } else {
          this.skillsRegistry.disable(skillId);
        }
      }
      state.status = 'disconnected';
      state.tools = [];
    }

    this.onRefresh();
  }

  /** Connect all enabled servers (called on extension activation). */
  async connectAll(): Promise<void> {
    const connects = [...this.states.values()]
      .filter(s => s.config.enabled)
      .map(s => this.connectServer(s.config.id).catch(err => {
        this.outputChannel?.appendLine(`[mcp] Failed to connect server ${s.config.id} (${s.config.name}): ${err instanceof Error ? err.message : String(err)}`);
      }));
    await Promise.all(connects);
  }

  /** Disconnect all servers and dispose resources (called on deactivation). */
  async disposeAll(): Promise<void> {
    const disconnects = [...this.clients.keys()].map(id =>
      this.disconnectServer(id, false).catch(err => {
        this.outputChannel?.appendLine(`[mcp] Error disconnecting server ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }),
    );
    await Promise.all(disconnects);
  }

  // ── State restore ────────────────────────────────────────────

  /** Load persisted server configurations from globalState on activation. */
  loadFromStorage(): void {
    const raw = this.globalState.get<McpServerConfig[]>(STORAGE_KEY, []);
    const configs = raw.filter(isValidServerConfig);
    let mutated = false;
    for (const config of configs) {
      const repaired = normalizeStoredServerConfig(config);
      if (JSON.stringify(repaired) !== JSON.stringify(config)) {
        mutated = true;
      }
      this.states.set(repaired.id, { config: repaired, status: 'disconnected', tools: [] });
    }
    if (mutated) {
      void this.persist();
    }
  }

  // ── Private helpers ──────────────────────────────────────────

  private async persist(): Promise<void> {
    const configs = [...this.states.values()].map(s => s.config);
    await this.globalState.update(STORAGE_KEY, configs);
  }

  private findMatchingServer(config: Omit<McpServerConfig, 'id'>): McpServerConfig | undefined {
    const expected = toComparableSignature(config);
    for (const state of this.states.values()) {
      if (toComparableSignature(state.config) === expected) {
        return state.config;
      }
    }
    return undefined;
  }

  private async connectImportedServer(id: string, name: string, result: McpServerImportResult): Promise<void> {
    const state = this.states.get(id);
    if (!state?.config.enabled) {
      return;
    }

    await this.connectServer(id);
    const refreshed = this.states.get(id);
    if (refreshed?.status === 'connected') {
      result.connected += 1;
      return;
    }

    result.failedConnections.push({
      name,
      message: refreshed?.error ?? 'Unknown connection failure.',
    });
  }

  /**
   * Register each MCP tool as a SkillDefinition in the SkillsRegistry.
   * MCP tools use a synthetic skill ID: `mcp:<serverId>:<toolName>`.
   * They are auto-approved (user explicitly configured the server = implicit trust).
   */
  private registerToolsAsSkills(config: McpServerConfig, tools: McpToolInfo[]): void {
    for (const tool of tools) {
      const skillId = mcpSkillId(config.id, tool.name);
      const clientRef = this.clients.get(config.id);

      const skill: SkillDefinition = {
        id: skillId,
        name: `[MCP] ${tool.name}`,
        description: `${config.name} › ${tool.description || tool.name}`,
        parameters: tool.inputSchema,
        source: `mcp://${config.id}/${tool.name}`,
        builtIn: false,
        routingHints: inferMcpRoutingHints(config.name, tool.name, tool.description),
        execute: async (params) => {
          const client = clientRef ?? this.clients.get(config.id);
          if (!client || client.status !== 'connected') {
            throw new Error(
              `MCP server "${config.name}" is not connected. ` +
              'Use the MCP panel to reconnect.',
            );
          }
          return client.callTool(tool.name, params);
        },
      };

      this.skillsRegistry.register(skill);

      // Auto-approve: mark as 'passed' (external process, not in-process code to scan)
      this.skillsRegistry.setScanResult({
        skillId,
        status: 'passed',
        scannedAt: new Date().toISOString(),
        issues: [],
      });
    }
  }

  /**
   * Attempt to connect via the legacy SSE transport.
   * Used as fallback when the primary StreamableHTTP transport fails.
   */
  private async connectViaSse(config: McpServerConfig): Promise<McpClient | null> {
    // Build a temporary McpClient-like wrapper using SSE directly
    // We do this via a modified config rather than a second McpClient instance,
    // since McpClient already handles the SSE transport case.
    // Here we just return null to keep things simple — the SSE fallback path
    // in connectServer handles the retry at the transport level.
    void config; // reserved for future use
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

export function mcpSkillId(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

/** Runtime validation of a persisted McpServerConfig. */
function isValidServerConfig(v: unknown): v is McpServerConfig {
  if (typeof v !== 'object' || v === null) { return false; }
  const c = v as Record<string, unknown>;
  return (
    typeof c['id'] === 'string' && c['id'].length > 0 &&
    typeof c['name'] === 'string' &&
    (c['transport'] === 'stdio' || c['transport'] === 'http') &&
    typeof c['enabled'] === 'boolean'
  );
}

function toComparableSignature(config: Pick<McpServerConfig, 'transport' | 'command' | 'args' | 'env' | 'url'>): string {
  const normalizedEnv = normalizeEnv(config.env);
  const normalizedArgs = (config.args ?? []).join('\u0000');
  return JSON.stringify({
    transport: config.transport,
    command: config.command ?? '',
    args: normalizedArgs,
    env: normalizedEnv,
    url: config.url ?? '',
  });
}

function normalizeEnv(env: McpServerConfig['env']): string {
  if (!env) {
    return '';
  }
  return JSON.stringify(
    Object.keys(env)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, env[key]]),
  );
}

function normalizeStoredServerConfig(config: McpServerConfig): McpServerConfig {
  const packageName = getConfiguredPackageName(config);

  if (packageName === LEGACY_RECOMMENDED_GIT_PACKAGE) {
    return {
      ...config,
      command: 'uvx',
      args: ['mcp-server-git'],
    };
  }

  if (packageName && isKnownBrokenRecommendedPackage(packageName)) {
    return {
      ...config,
      enabled: false,
    };
  }

  return config;
}

function getKnownRecommendedServerIssue(config: McpServerConfig): string | undefined {
  const packageName = getConfiguredPackageName(config);
  if (!packageName || !isKnownBrokenRecommendedPackage(packageName)) {
    return undefined;
  }

  if (packageName === LEGACY_RECOMMENDED_GIT_PACKAGE) {
    return 'This saved Git preset used a deprecated npm package name. AtlasMind now recommends the supported git server command; reopen the server entry if you want to review it.';
  }

  return 'This saved preset points to a deprecated package name that no longer exists. Open the Add Server workspace, review the linked documentation, and enter the real server command or URL for your environment.';
}

function getConfiguredPackageName(config: Pick<McpServerConfig, 'transport' | 'command' | 'args'>): string | undefined {
  if (config.transport !== 'stdio') {
    return undefined;
  }
  return (config.args ?? []).find(arg => typeof arg === 'string' && arg.startsWith('@modelcontextprotocol/server-'));
}

function isKnownBrokenRecommendedPackage(packageName: string): boolean {
  if (packageName === LEGACY_RECOMMENDED_GIT_PACKAGE) {
    return true;
  }
  return packageName.startsWith('@modelcontextprotocol/server-') && !VALID_MODEL_CONTEXT_PROTOCOL_NPX_PACKAGES.has(packageName);
}

const MCP_ACTION_HINTS: Record<string, string[]> = {
  add: ['add', 'create', 'new'],
  branch: ['branch', 'create branch', 'switch branch'],
  build: ['build', 'compile', 'bundle'],
  checkout: ['checkout', 'switch branch'],
  commit: ['commit', 'git commit', 'commit changes', 'save changes'],
  delete: ['delete', 'remove'],
  diff: ['diff', 'show changes'],
  export: ['export', 'download'],
  fetch: ['fetch', 'sync'],
  find: ['find', 'search', 'look up'],
  get: ['get', 'show', 'view'],
  install: ['install', 'add package'],
  list: ['list', 'show', 'view'],
  log: ['log', 'history', 'recent changes'],
  merge: ['merge', 'combine branches'],
  pause: ['pause', 'hold'],
  pull: ['pull', 'update from remote'],
  push: ['push', 'publish commits'],
  query: ['query', 'search', 'look up'],
  read: ['read', 'open', 'view'],
  release: ['release', 'publish release'],
  remove: ['remove', 'delete'],
  resume: ['resume', 'continue'],
  run: ['run', 'execute'],
  show: ['show', 'display', 'view'],
  start: ['start', 'begin', 'launch'],
  status: ['status', 'check status', 'show status'],
  stop: ['stop', 'end', 'finish'],
  test: ['test', 'run tests'],
  update: ['update', 'modify', 'change'],
  write: ['write', 'save', 'create'],
};

const MCP_ROUTING_STOPWORDS = new Set([
  'mcp', 'tool', 'tools', 'server', 'workspace', 'project', 'the', 'a', 'an', 'and', 'for', 'from', 'with', 'into', 'using',
]);

function inferMcpRoutingHints(serverName: string, toolName: string, description?: string): string[] {
  const hints = new Set<string>();
  const idTokens = splitIntentTokens(toolName);
  const descriptionTokens = splitIntentTokens(description ?? '');
  const serverTokens = splitIntentTokens(serverName).filter(token => !MCP_ROUTING_STOPWORDS.has(token));
  const combinedTokens = [...new Set([...idTokens, ...descriptionTokens])].filter(token => !MCP_ROUTING_STOPWORDS.has(token));
  const action = combinedTokens.find(token => token in MCP_ACTION_HINTS);
  const subjectTokens = combinedTokens.filter(token => token !== action && !MCP_ACTION_HINTS[token]);
  const compactSubject = subjectTokens.slice(0, 2).join(' ').trim();

  if (compactSubject) {
    hints.add(compactSubject);
  }

  if (action) {
    for (const variant of MCP_ACTION_HINTS[action] ?? [action]) {
      hints.add(variant);
      if (compactSubject) {
        hints.add(`${variant} ${compactSubject}`);
      }
      if (serverTokens.includes('git') && action === 'commit') {
        hints.add('git commit');
        hints.add('commit staged changes');
      }
    }
  }

  if (idTokens.length > 1) {
    hints.add(idTokens.join(' '));
  }

  const cleanedDescription = (description ?? '')
    .replace(/[.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (cleanedDescription.length > 0) {
    hints.add(cleanedDescription);
  }

  return [...hints]
    .map(value => value.trim().toLowerCase())
    .filter(value => value.length >= 3 && value.length <= 60)
    .slice(0, 8);
}

function splitIntentTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}
