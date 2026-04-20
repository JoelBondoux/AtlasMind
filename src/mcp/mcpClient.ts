/**
 * McpClient – wraps @modelcontextprotocol/sdk Client for a single server connection.
 *
 * Security notes:
 * - stdio: command/args are user-supplied; the user explicitly configured the server,
 *   so intent is clear. No shell expansion is used (spawn, not exec).
 * - http: URL is validated before use. Only https/http schemes are accepted.
 * - Tool arguments received from the orchestrator are passed through unchanged;
 *   callers are responsible for schema validation before invocation.
 */

import * as path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpConnectionStatus, McpToolInfo } from '../types.js';

const CLIENT_INFO = { name: 'AtlasMind', version: '0.6.0' } as const;
import { MCP_TOOL_CALL_TIMEOUT_MS } from '../constants.js';

export class McpClient {
  private client: Client | undefined;
  private _status: McpConnectionStatus = 'disconnected';
  private _error: string | undefined;
  private _tools: McpToolInfo[] = [];

  constructor(private readonly config: McpServerConfig) {}

  get status(): McpConnectionStatus { return this._status; }
  get error(): string | undefined { return this._error; }
  get tools(): McpToolInfo[] { return [...this._tools]; }

  /**
   * Establish the transport connection and discover available tools.
   * Resolves when the handshake completes. Rejects on connection failure.
   */
  async connect(): Promise<void> {
    if (this._status === 'connected' || this._status === 'connecting') {
      return;
    }

    this._status = 'connecting';
    this._error = undefined;

    try {
      this.client = new Client(CLIENT_INFO, { capabilities: {} });

      this.client.onerror = (err: Error) => {
        this._status = 'error';
        this._error = err.message;
      };

      this.client.onclose = () => {
        if (this._status === 'connected') {
          this._status = 'disconnected';
        }
      };

      const transport = this.buildTransport();
      await this.client.connect(transport);
      this._status = 'connected';

      await this.refreshTools();
    } catch (err) {
      this._status = 'error';
      this._error = formatConnectionError(err, this.config);
      this.client = undefined;
      throw new Error(this._error);
    }
  }

  /** Disconnect and clean up transport. */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Best-effort close
      }
      this.client = undefined;
    }
    this._status = 'disconnected';
    this._error = undefined;
  }

  /**
   * Invoke a tool by name with the supplied arguments.
   * Returns the concatenated text content of the response.
   * Throws McpToolError if the tool reports isError, or re-throws transport/protocol errors.
   */
  async callTool(toolName: string, toolArgs: Record<string, unknown>): Promise<string> {
    if (!this.client || this._status !== 'connected') {
      throw new Error(`MCP server "${this.config.name}" is not connected.`);
    }

    const result = await this.client.callTool(
      { name: toolName, arguments: toolArgs },
      undefined,
      { timeout: MCP_TOOL_CALL_TIMEOUT_MS },
    );

    if (result.isError) {
      const detail = extractTextContent(result.content);
      throw new McpToolError(`Tool "${toolName}" error: ${detail}`);
    }

    return extractTextContent(result.content);
  }

  /** Re-fetch the tool list from the connected server. */
  async refreshTools(): Promise<void> {
    if (!this.client || this._status !== 'connected') {
      return;
    }

    const allTools: McpToolInfo[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.listTools({ cursor });
      for (const t of response.tools) {
        allTools.push({
          serverId: this.config.id,
          name: t.name,
          description: t.description ?? '',
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
        });
      }
      cursor = response.nextCursor;
    } while (cursor);

    this._tools = allTools;
  }

  // ── Private helpers ─────────────────────────────────────────

  private buildTransport(): StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport {
    if (this.config.transport === 'stdio') {
      const command = this.config.command;
      if (!command) {
        throw new Error(`MCP server "${this.config.name}": stdio transport requires a command.`);
      }
      if (/[|;&`$]/.test(command)) {
        throw new Error(
          `MCP server "${this.config.name}": command contains disallowed shell metacharacters.`,
        );
      }
      const resolvedCommand = resolveMcpTemplateValue(command, this.config.name);
      const resolvedArgs = (this.config.args ?? []).map(arg => resolveMcpTemplateValue(arg, this.config.name));
      assertStdioCommandAvailable(resolvedCommand, this.config.name);
      const normalizedLaunch = normalizeStdioLaunch(resolvedCommand, resolvedArgs);
      return new StdioClientTransport({
        command: normalizedLaunch.command,
        args: normalizedLaunch.args,
        env: this.config.env
          ? {
            ...process.env,
            ...Object.fromEntries(
              Object.entries(this.config.env).map(([key, value]) => [key, resolveMcpTemplateValue(value, this.config.name)]),
            ),
          } as Record<string, string>
          : undefined,
      });
    }

    // http transport – try Streamable HTTP first, fall back to SSE
    const rawUrl = this.config.url;
    if (!rawUrl) {
      throw new Error(`MCP server "${this.config.name}": http transport requires a URL.`);
    }

    const parsed = validateHttpUrl(resolveMcpTemplateValue(rawUrl, this.config.name));
    if (!parsed) {
      throw new Error(
        `MCP server "${this.config.name}": invalid or disallowed URL "${rawUrl}". ` +
        'Only http:// and https:// are supported.',
      );
    }

    // We return StreamableHTTP; if the server is legacy SSE-only the registry
    // retries with SSEClientTransport.
    return new StreamableHTTPClientTransport(parsed);
  }
}

/** Thrown when a tool call returns isError: true from the MCP server. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}

// ── Module-level helpers ─────────────────────────────────────────

/** Extract readable text from a tool-call content array. */
function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return String(content ?? '');
  }
  return content
    .filter((c): c is { type: string; text: string } =>
      typeof c === 'object' && c !== null && (c as { type: string }).type === 'text',
    )
    .map(c => c.text)
    .join('\n');
}

/**
 * Validate that a URL uses http or https.
 * Returns the parsed URL, or null if invalid/disallowed.
 */
function validateHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function resolveMcpTemplateValue(value: string, serverName: string): string {
  if (!value.includes('${')) {
    return value;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const userHome = process.env.USERPROFILE ?? process.env.HOME;
  const replacements: Array<[string, string | undefined]> = [
    ['${workspaceFolder}', workspaceFolder],
    ['${userHome}', userHome],
  ];

  let resolved = value;
  for (const [token, replacement] of replacements) {
    if (!resolved.includes(token)) {
      continue;
    }
    if (!replacement) {
      throw new Error(`MCP server "${serverName}" requires ${token}, but AtlasMind could not resolve it in the current workspace.`);
    }
    resolved = resolved.split(token).join(replacement);
  }

  return resolved;
}

function assertStdioCommandAvailable(command: string, serverName: string): void {
  const resolved = findCommandExecutable(command);
  if (resolved) {
    primeProcessPathWithExecutable(resolved);
    return;
  }

  throw new Error(`The command "${command}" was not found for ${serverName}. ${getKnownCommandInstallHint(command)}`.trim());
}

export function findCommandExecutable(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/[\\/]/.test(trimmed)) {
    return existsSync(trimmed) ? trimmed : undefined;
  }

  const suffixes = process.platform === 'win32'
    ? (path.extname(trimmed)
      ? ['']
      : ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)])
    : [''];

  const seen = new Set<string>();
  const searchDirectories = [
    ...(process.env.PATH ?? process.env.Path ?? '')
      .split(path.delimiter)
      .map(entry => entry.trim())
      .filter(Boolean),
    ...getKnownCommandSearchDirectories(trimmed),
  ];

  for (const entry of searchDirectories) {
    const normalizedEntry = entry.toLowerCase();
    if (seen.has(normalizedEntry)) {
      continue;
    }
    seen.add(normalizedEntry);

    for (const suffix of suffixes) {
      const candidate = path.join(entry, `${trimmed}${suffix}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function getKnownCommandSearchDirectories(command: string): string[] {
  const normalized = command.toLowerCase();

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const userProfile = process.env.USERPROFILE;
    const wingetPackageRoot = localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Packages') : undefined;

    const findWingetPackageDirectories = (prefixes: string[]): string[] => {
      if (!wingetPackageRoot || !existsSync(wingetPackageRoot)) {
        return [];
      }

      try {
        return readdirSync(wingetPackageRoot, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && prefixes.some(prefix => entry.name.toLowerCase().startsWith(prefix)))
          .map(entry => path.join(wingetPackageRoot, entry.name));
      } catch {
        return [];
      }
    };

    switch (normalized) {
      case 'uv':
      case 'uvx':
        return [
          userProfile ? path.join(userProfile, '.local', 'bin') : '',
          ...findWingetPackageDirectories(['astral-sh.uv_']),
        ].filter(Boolean);
      case 'gk':
        return [
          localAppData ? path.join(localAppData, 'Programs', 'GitKraken CLI') : '',
          localAppData ? path.join(localAppData, 'Programs', 'GitKraken CLI', 'bin') : '',
          programFiles ? path.join(programFiles, 'GitKraken CLI') : '',
          programFiles ? path.join(programFiles, 'GitKraken CLI', 'bin') : '',
          programFiles ? path.join(programFiles, 'GitKraken') : '',
          programFiles ? path.join(programFiles, 'GitKraken', 'bin') : '',
          programFilesX86 ? path.join(programFilesX86, 'GitKraken') : '',
          programFilesX86 ? path.join(programFilesX86, 'GitKraken', 'bin') : '',
          ...findWingetPackageDirectories(['gitkraken.cli_']),
        ].filter(Boolean);
      case 'dnx':
      case 'dotnet':
        return [
          programFiles ? path.join(programFiles, 'dotnet') : '',
          programFilesX86 ? path.join(programFilesX86, 'dotnet') : '',
        ].filter(Boolean);
      case 'node':
      case 'npm':
      case 'npx':
        return [
          programFiles ? path.join(programFiles, 'nodejs') : '',
          programFilesX86 ? path.join(programFilesX86, 'nodejs') : '',
          localAppData ? path.join(localAppData, 'Programs', 'nodejs') : '',
          ...findWingetPackageDirectories(['openjs.nodejs.lts_']),
        ].filter(Boolean);
      case 'winget':
        return [
          localAppData ? path.join(localAppData, 'Microsoft', 'WindowsApps') : '',
        ].filter(Boolean);
      default:
        return [];
    }
  }

  const home = process.env.HOME;
  const brewDirectories = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/home/linuxbrew/.linuxbrew/bin',
    home ? path.join(home, '.linuxbrew', 'bin') : '',
    home ? path.join(home, '.local', 'bin') : '',
  ].filter(Boolean);

  switch (normalized) {
    case 'brew':
      return brewDirectories;
    case 'uv':
    case 'uvx':
    case 'node':
    case 'npm':
    case 'npx':
    case 'gk':
    case 'dnx':
    case 'dotnet':
      return brewDirectories;
    default:
      return [];
  }
}

function primeProcessPathWithExecutable(executablePath: string): void {
  const executableDir = path.dirname(executablePath);
  const currentPath = process.env.PATH ?? process.env.Path ?? '';
  const entries = currentPath.split(path.delimiter).map(entry => entry.trim().toLowerCase());
  if (entries.includes(executableDir.trim().toLowerCase())) {
    return;
  }

  const nextPath = `${executableDir}${path.delimiter}${currentPath}`;
  process.env.PATH = nextPath;
  process.env.Path = nextPath;
}

export function getKnownCommandInstallHint(command: string): string {
  const normalized = command.trim().toLowerCase();
  if (normalized === 'uvx' || normalized === 'uv') {
    return 'Install uv first so the Git MCP server can launch.';
  }
  if (normalized === 'gk') {
    return 'Install GitKraken CLI and complete gk auth login before connecting this preset.';
  }
  if (normalized === 'dnx') {
    return 'Install the required .NET SDK/runtime so the Power Platform MCP preset can launch.';
  }
  if (normalized === 'npx' || normalized === 'npm') {
    return 'Install Node.js and npm first so AtlasMind can start this MCP server.';
  }
  return 'Review the preset setup details and confirm the required runtime is installed.';
}

function normalizeStdioLaunch(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') {
    return { command, args };
  }

  if (['npx', 'npm', 'pnpm', 'yarn', 'bunx'].includes(command.toLowerCase())) {
    return {
      command: 'cmd',
      args: ['/c', command, ...args],
    };
  }

  return { command, args };
}

function formatConnectionError(err: unknown, config: McpServerConfig): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/ENOENT|not found/i.test(message)) {
    if (config.transport === 'stdio' && config.command?.toLowerCase() === 'uvx') {
      return `The command "uvx" was not found for ${config.name}. Install uv first, or edit the server command to use a working local runtime.`;
    }
    if (config.transport === 'stdio') {
      return `The command "${config.command ?? 'unknown'}" was not found for ${config.name}. ${getKnownCommandInstallHint(config.command ?? '')}`;
    }
  }

  if (/connection closed/i.test(message) && config.transport === 'stdio') {
    return `${config.name} closed immediately after launch. Confirm "${config.command ?? 'unknown'}" is installed and works from a normal terminal. ${getKnownCommandInstallHint(config.command ?? '')}`;
  }

  return message;
}
