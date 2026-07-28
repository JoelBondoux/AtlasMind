/**
 * McpEnvironmentScanner — discovers MCP setup signals from the machine and
 * workspace so the "Add MCP server" flow can hand-hold instead of asking a
 * novice to invent a command:
 *
 *   A. IMPORT — parse standard MCP config files written by other tools (Claude
 *      Desktop, Cursor, VS Code, Windsurf, a repo `.mcp.json`) and offer their
 *      server definitions for one-click import/prefill.
 *   B. DERIVE — probe PATH for launch runtimes (npx/uvx/docker/…) and read env
 *      var *names* from `.env*` / `wrangler.toml` so the wizard can suggest the
 *      right command and credential fields.
 *
 * The scan result is cached in SSOT (`project_memory/operations/mcp-environment.json`
 * plus a markdown mirror) and reused on future installs; a "Rescan" re-runs it,
 * and a file watcher invalidates it when a config file changes.
 *
 * Safety-first / redaction boundary: this module is `vscode`-free (node fs only)
 * and unit-testable, and it NEVER captures secret VALUES. Only env var *names*
 * and whether each looks like a secret are recorded — cached or shown. The real
 * values are re-read live from the source file at import time by
 * {@link resolveImportedServer} and routed to SecretStorage, so a token is never
 * persisted to the git-tracked cache nor sent to the webview.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import type { ImportedMcpServer, McpEnvironmentScan, McpServerConfig } from '../types.js';

export const MCP_ENV_SSOT_PATH = 'project_memory/operations/mcp-environment.json';
export const MCP_ENV_SUMMARY_SSOT_PATH = 'project_memory/operations/mcp-environment.md';

const MAX_ENV_NAMES = 60;
const MAX_IMPORTED = 100;

/** Launch runtimes worth reporting availability for. */
// `buzz` is not a generic launcher, but the bundled Buzz bridge shells out to
// it, and without probing for it the only way to learn it is missing is a
// failed call at the far end of setup.
const LAUNCHERS = ['npx', 'uvx', 'node', 'docker', 'python', 'python3', 'pipx', 'gh', 'az', 'aws', 'gcloud', 'wrangler', 'buzz'];

/** Env var names that look like credentials → route to SecretStorage, never shown. */
const SECRET_KEY_RE = /(token|secret|key|password|passwd|pwd|\bpat\b|api[_-]?key|apikey|auth|credential|cookie|access[_-]?key|private)/i;

export function classifySecretEnvKey(name: string): boolean {
  return SECRET_KEY_RE.test(name);
}

// ── PATH probing (self-contained; no vscode/SDK dependency) ───────

/** Minimal PATH lookup mirroring mcpClient.findCommandExecutable, kept local so
 *  the scanner stays vscode-free and unit-testable. */
export function hasLauncherOnPath(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  const suffixes = process.platform === 'win32'
    ? (path.extname(trimmed) ? [''] : ['', ...((process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean))])
    : [''];
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).map(entry => entry.trim()).filter(Boolean);
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      if (existsSync(path.join(dir, `${trimmed}${suffix}`))) {
        return true;
      }
    }
  }
  return false;
}

// ── Config-file discovery + parsing ──────────────────────────────

/** Candidate MCP config file locations (workspace + per-user, cross-platform). */
export function mcpConfigFileCandidates(workspaceRoot: string | undefined, homeDir: string): Array<{ label: string; path: string }> {
  const candidates: Array<{ label: string; path: string }> = [];
  if (workspaceRoot) {
    candidates.push(
      { label: '.vscode/mcp.json (workspace)', path: path.join(workspaceRoot, '.vscode', 'mcp.json') },
      { label: '.cursor/mcp.json (workspace)', path: path.join(workspaceRoot, '.cursor', 'mcp.json') },
      { label: '.mcp.json (workspace)', path: path.join(workspaceRoot, '.mcp.json') },
      { label: 'mcp.json (workspace)', path: path.join(workspaceRoot, 'mcp.json') },
    );
  }
  const platform = process.platform;
  const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');
  const claudeConfig = platform === 'win32'
    ? path.join(appData, 'Claude', 'claude_desktop_config.json')
    : platform === 'darwin'
      ? path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
  const vscodeUser = platform === 'win32'
    ? path.join(appData, 'Code', 'User', 'mcp.json')
    : platform === 'darwin'
      ? path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
      : path.join(homeDir, '.config', 'Code', 'User', 'mcp.json');
  candidates.push(
    { label: 'Claude Desktop', path: claudeConfig },
    { label: 'Cursor (global)', path: path.join(homeDir, '.cursor', 'mcp.json') },
    { label: 'VS Code (user)', path: vscodeUser },
    { label: 'Windsurf', path: path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json') },
  );
  return candidates;
}

interface RawServerEntry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  serverUrl?: unknown;
  type?: unknown;
  transport?: unknown;
}

function toImported(name: string, raw: RawServerEntry, source: string, sourcePath: string): ImportedMcpServer | undefined {
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  const url = typeof raw.url === 'string' ? raw.url.trim()
    : typeof raw.serverUrl === 'string' ? raw.serverUrl.trim() : '';
  const declaredType = typeof raw.type === 'string' ? raw.type.toLowerCase()
    : typeof raw.transport === 'string' ? raw.transport.toLowerCase() : '';
  const isHttp = url.length > 0 || declaredType === 'http' || declaredType === 'sse' || declaredType === 'streamable-http';
  if (!command && !url) {
    return undefined; // nothing launchable
  }
  const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [];
  const envKeys = (raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env))
    ? Object.keys(raw.env as Record<string, unknown>)
    : [];
  return {
    name,
    source,
    sourcePath,
    transport: isHttp ? 'http' : 'stdio',
    ...(command ? { command } : {}),
    ...(args.length > 0 ? { args } : {}),
    ...(url ? { url } : {}),
    envKeys,
    secretEnvKeys: envKeys.filter(classifySecretEnvKey),
  };
}

/**
 * Parse one MCP config file's JSON content into importable server definitions.
 * Handles both the `mcpServers` shape (Claude/Cursor/Windsurf) and the `servers`
 * shape (VS Code). Returns [] on malformed input (never throws).
 */
export function parseMcpConfigFile(content: string, source: string, sourcePath: string): ImportedMcpServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const root = parsed as Record<string, unknown>;
  const bag = (root['mcpServers'] ?? root['servers']);
  if (typeof bag !== 'object' || bag === null || Array.isArray(bag)) {
    return [];
  }
  const out: ImportedMcpServer[] = [];
  for (const [name, value] of Object.entries(bag as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const imported = toImported(name, value as RawServerEntry, source, sourcePath);
    if (imported) {
      out.push(imported);
    }
  }
  return out;
}

// ── Env var NAME discovery (names only — never values) ────────────

export function extractDotenvNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
    if (match[1]) {
      names.push(match[1]);
    }
  }
  return names;
}

export function extractWranglerNames(content: string): string[] {
  const names: string[] = [];
  // Top-level account_id and [vars]/[env.*.vars] table keys.
  for (const match of content.matchAll(/^\s*(account_id|zone_id|name)\s*=/gm)) {
    if (match[1]) { names.push(match[1].toUpperCase()); }
  }
  let inVars = false;
  for (const line of content.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]/);
    if (section) {
      inVars = /(^|\.)vars$/.test(section[1].trim());
      continue;
    }
    if (inVars) {
      const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (kv?.[1]) { names.push(kv[1]); }
    }
  }
  return names;
}

// ── Full scan ────────────────────────────────────────────────────

export function scanMcpEnvironment(workspaceRoot: string | undefined, homeDir: string = os.homedir()): McpEnvironmentScan {
  const launchers: Record<string, boolean> = {};
  for (const launcher of LAUNCHERS) {
    launchers[launcher] = hasLauncherOnPath(launcher);
  }

  const sources: McpEnvironmentScan['sources'] = [];
  const importedServers: ImportedMcpServer[] = [];
  const seenImports = new Set<string>();
  for (const candidate of mcpConfigFileCandidates(workspaceRoot, homeDir)) {
    const exists = existsSync(candidate.path);
    sources.push({ label: candidate.label, path: candidate.path, exists });
    if (!exists) {
      continue;
    }
    let content = '';
    try {
      content = readFileSync(candidate.path, 'utf8');
    } catch {
      continue;
    }
    for (const server of parseMcpConfigFile(content, candidate.label, candidate.path)) {
      // De-duplicate identical definitions surfaced from multiple tools.
      const key = `${server.name}::${server.command ?? server.url ?? ''}::${(server.args ?? []).join(' ')}`.toLowerCase();
      if (seenImports.has(key) || importedServers.length >= MAX_IMPORTED) {
        continue;
      }
      seenImports.add(key);
      importedServers.push(server);
    }
  }

  const envVarNames: string[] = [];
  const seenNames = new Set<string>();
  const addNames = (names: string[]) => {
    for (const name of names) {
      if (!seenNames.has(name) && envVarNames.length < MAX_ENV_NAMES) {
        seenNames.add(name);
        envVarNames.push(name);
      }
    }
  };
  const projectSignals: string[] = [];
  if (workspaceRoot) {
    for (const file of ['.env', '.env.local', '.env.development', '.dev.vars', '.env.example']) {
      const p = path.join(workspaceRoot, file);
      if (existsSync(p)) {
        try { addNames(extractDotenvNames(readFileSync(p, 'utf8'))); } catch { /* skip */ }
      }
    }
    const wrangler = path.join(workspaceRoot, 'wrangler.toml');
    if (existsSync(wrangler)) {
      projectSignals.push('wrangler.toml present — Cloudflare Workers project detected.');
      try { addNames(extractWranglerNames(readFileSync(wrangler, 'utf8'))); } catch { /* skip */ }
    }
    if (existsSync(path.join(workspaceRoot, 'Dockerfile')) || existsSync(path.join(workspaceRoot, 'docker-compose.yml'))) {
      projectSignals.push('Docker files present.');
    }
    const pkgPath = path.join(workspaceRoot, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
        const deps = { ...(pkg['dependencies'] as object ?? {}), ...(pkg['devDependencies'] as object ?? {}) };
        const mcpDeps = Object.keys(deps).filter(name => /mcp|modelcontextprotocol/i.test(name));
        if (mcpDeps.length > 0) {
          projectSignals.push(`MCP-related npm packages in this project: ${mcpDeps.slice(0, 6).join(', ')}.`);
        }
      } catch { /* skip */ }
    }
  }

  return {
    version: 1,
    scannedAt: new Date().toISOString(),
    launchers,
    importedServers,
    envVarNames,
    projectSignals,
    sources,
  };
}

// ── Import resolution (re-reads values live; never cached) ────────

/**
 * Re-read a source config file and build a connect-ready config for one imported
 * server, splitting secret-looking env vars into SecretStorage. This is the ONLY
 * place credential values are read, and they never leave the extension host.
 */
export function resolveImportedServer(sourcePath: string, name: string): { config: Omit<McpServerConfig, 'id'>; secrets: Record<string, string> } | undefined {
  let content = '';
  try {
    content = readFileSync(sourcePath, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const root = parsed as Record<string, unknown>;
  const bag = (root['mcpServers'] ?? root['servers']);
  if (typeof bag !== 'object' || bag === null) {
    return undefined;
  }
  const raw = (bag as Record<string, unknown>)[name];
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const entry = raw as RawServerEntry;
  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  const url = typeof entry.url === 'string' ? entry.url.trim()
    : typeof entry.serverUrl === 'string' ? entry.serverUrl.trim() : '';
  const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === 'string') : [];
  const env: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const secretEnvKeys: string[] = [];
  if (entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)) {
    for (const [key, value] of Object.entries(entry.env as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        continue;
      }
      if (classifySecretEnvKey(key)) {
        secrets[key] = value;
        secretEnvKeys.push(key);
      } else {
        env[key] = value;
      }
    }
  }
  if (url) {
    return {
      config: { name, transport: 'http', url, enabled: true },
      secrets,
    };
  }
  if (!command) {
    return undefined;
  }
  return {
    config: {
      name,
      transport: 'stdio',
      command,
      args,
      env: Object.keys(env).length > 0 ? env : undefined,
      secretEnvKeys: secretEnvKeys.length > 0 ? secretEnvKeys : undefined,
      enabled: true,
    },
    secrets,
  };
}

// ── SSOT persistence + markdown mirror ───────────────────────────

export function readMcpEnvironmentScan(workspaceRoot: string): McpEnvironmentScan | undefined {
  try {
    const raw = readFileSync(path.join(workspaceRoot, MCP_ENV_SSOT_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>)['version'] === 1) {
      return parsed as McpEnvironmentScan;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function writeMcpEnvironmentScan(workspaceRoot: string, scan: McpEnvironmentScan): Promise<void> {
  const jsonPath = path.join(workspaceRoot, MCP_ENV_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, MCP_ENV_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(scan, null, 2), 'utf-8'),
    writeFile(summaryPath, renderMcpEnvironmentMarkdown(scan), 'utf-8'),
  ]);
}

export function renderMcpEnvironmentMarkdown(scan: McpEnvironmentScan): string {
  const lines: string[] = [];
  lines.push('# MCP Environment Scan');
  lines.push('');
  lines.push('> Maintained by AtlasMind (MCP → Add Server). A cached, non-sensitive snapshot of the');
  lines.push('> MCP setup signals on this machine and workspace, reused to speed up future installs.');
  lines.push('> **No secret values are stored here** — only env-variable names and launcher availability.');
  lines.push('');
  lines.push(`_Last scanned: ${scan.scannedAt}._`);
  lines.push('');

  lines.push('## Available launch runtimes');
  lines.push('');
  const present = Object.entries(scan.launchers).filter(([, ok]) => ok).map(([name]) => name);
  lines.push(present.length > 0 ? present.map(name => `\`${name}\``).join(', ') : '_None detected on PATH._');
  lines.push('');

  lines.push('## Servers found in your other tools');
  lines.push('');
  if (scan.importedServers.length === 0) {
    lines.push('_No MCP servers found in Claude Desktop, Cursor, VS Code, Windsurf, or a repo config._');
  } else {
    for (const server of scan.importedServers) {
      const launch = server.transport === 'http' ? server.url : `${server.command ?? ''} ${(server.args ?? []).join(' ')}`.trim();
      lines.push(`- **${server.name}** (${server.source}) — \`${launch}\`${server.envKeys.length > 0 ? ` · env: ${server.envKeys.join(', ')}` : ''}`);
    }
  }
  lines.push('');

  if (scan.envVarNames.length > 0) {
    lines.push('## Environment variable names in this workspace');
    lines.push('');
    lines.push('_Names only — values are never read._');
    lines.push('');
    lines.push(scan.envVarNames.map(name => `\`${name}\``).join(', '));
    lines.push('');
  }

  if (scan.projectSignals.length > 0) {
    lines.push('## Project signals');
    lines.push('');
    for (const signal of scan.projectSignals) {
      lines.push(`- ${signal}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_Config files checked:_');
  for (const src of scan.sources) {
    lines.push(`- ${src.exists ? '✓' : '·'} ${src.label}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Workspace-scoped holder for the MCP environment scan. Serves the cached scan
 * and re-scans on demand (Rescan button / external config-file change).
 */
export class McpEnvironmentScanner {
  private cached: McpEnvironmentScan | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.cached = workspaceRoot ? readMcpEnvironmentScan(workspaceRoot) : undefined;
  }

  getCached(): McpEnvironmentScan | undefined {
    return this.cached;
  }

  /** Re-read the cache from disk (e.g. after an external change). */
  reload(): McpEnvironmentScan | undefined {
    this.cached = this.workspaceRoot ? readMcpEnvironmentScan(this.workspaceRoot) : undefined;
    return this.cached;
  }

  /** Run a fresh scan, cache it to SSOT (best-effort), and return it. */
  async scan(): Promise<McpEnvironmentScan> {
    const scan = scanMcpEnvironment(this.workspaceRoot);
    this.cached = scan;
    if (this.workspaceRoot) {
      try {
        await writeMcpEnvironmentScan(this.workspaceRoot, scan);
      } catch {
        // Best-effort; the in-memory scan is still served.
      }
    }
    return scan;
  }

  /** Return the cached scan, running (and caching) one on first use. */
  async ensureScanned(): Promise<McpEnvironmentScan> {
    if (this.cached) {
      return this.cached;
    }
    return this.scan();
  }
}
