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

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpConnectionStatus, McpToolInfo } from '../types.js';

const CLIENT_INFO = { name: 'AtlasMind', version: '0.6.0' } as const;
const TOOL_CALL_TIMEOUT_MS = 120_000; // 2 minutes

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
      this._error = err instanceof Error ? err.message : String(err);
      this.client = undefined;
      throw err;
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
      { timeout: TOOL_CALL_TIMEOUT_MS },
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
      return new StdioClientTransport({
        command,
        args: this.config.args ?? [],
        env: this.config.env
          ? { ...process.env, ...this.config.env } as Record<string, string>
          : undefined,
      });
    }

    // http transport – try Streamable HTTP first, fall back to SSE
    const rawUrl = this.config.url;
    if (!rawUrl) {
      throw new Error(`MCP server "${this.config.name}": http transport requires a URL.`);
    }

    const parsed = validateHttpUrl(rawUrl);
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
