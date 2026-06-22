/**
 * Unit tests for McpClient.
 *
 * The @modelcontextprotocol/sdk Client and transports are mocked so tests
 * run in Node.js without spawning child processes or making network calls.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [
      {
        uri: {
          fsPath: 'C:/AtlasMindWorkspace',
        },
      },
    ],
  },
}));

// ── Mock the SDK ─────────────────────────────────────────────────

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockListTools = vi.fn().mockResolvedValue({ tools: [], nextCursor: undefined });
const mockCallTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });
let lastStdioTransportOptions: unknown;

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    public onerror: ((err: Error) => void) | undefined;
    public onclose: (() => void) | undefined;

    constructor() {}

    connect = mockConnect;
    close = mockClose;
    listTools = mockListTools;
    callTool = mockCallTool;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioClientTransport {
    constructor(options: unknown) {
      lastStdioTransportOptions = options;
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class MockSSEClientTransport {
    constructor(..._args: unknown[]) {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    constructor(..._args: unknown[]) {}
  },
}));

// ── Import after mock registration ───────────────────────────────

import { applyMcpWorkspacePathDefaults, McpClient, McpToolError } from '../../src/mcp/mcpClient.ts';
import type { McpServerConfig } from '../../src/types.ts';

// ── Helpers ──────────────────────────────────────────────────────

function makeStdioConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'test-server',
    name: 'Test Server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'some-server'],
    enabled: true,
    ...overrides,
  };
}

function makeHttpConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'http-server',
    name: 'HTTP Server',
    transport: 'http',
    url: 'http://localhost:3000/mcp',
    enabled: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('McpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastStdioTransportOptions = undefined;
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [], nextCursor: undefined });
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });
  });

  describe('initial state', () => {
    it('starts as disconnected', () => {
      const client = new McpClient(makeStdioConfig());
      expect(client.status).toBe('disconnected');
      expect(client.error).toBeUndefined();
      expect(client.tools).toEqual([]);
    });
  });

  describe('connect()', () => {
    it('transitions to connected on success', async () => {
      const client = new McpClient(makeStdioConfig());
      await client.connect();
      expect(client.status).toBe('connected');
      expect(client.error).toBeUndefined();
    });

    it('populates tools after connecting', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [
          { name: 'read-file', description: 'Read a file', inputSchema: { type: 'object' } },
          { name: 'write-file', description: 'Write a file', inputSchema: { type: 'object' } },
        ],
        nextCursor: undefined,
      });

      const client = new McpClient(makeStdioConfig());
      await client.connect();

      expect(client.tools).toHaveLength(2);
      expect(client.tools[0].name).toBe('read-file');
      expect(client.tools[1].name).toBe('write-file');
      expect(client.tools[0].serverId).toBe('test-server');
    });

    it('handles paginated tool listing', async () => {
      mockListTools
        .mockResolvedValueOnce({
          tools: [{ name: 'tool-a', description: '', inputSchema: {} }],
          nextCursor: 'cursor1',
        })
        .mockResolvedValueOnce({
          tools: [{ name: 'tool-b', description: '', inputSchema: {} }],
          nextCursor: undefined,
        });

      const client = new McpClient(makeStdioConfig());
      await client.connect();

      expect(client.tools).toHaveLength(2);
      expect(client.tools.map(t => t.name)).toEqual(['tool-a', 'tool-b']);
    });

    it('sets error status when connection fails', async () => {
      mockConnect.mockRejectedValueOnce(new Error('spawn failed'));
      const client = new McpClient(makeStdioConfig());
      await expect(client.connect()).rejects.toThrow('spawn failed');
      expect(client.status).toBe('error');
      expect(client.error).toBe('spawn failed');
    });

    it('is a no-op if already connected', async () => {
      const client = new McpClient(makeStdioConfig());
      await client.connect();
      await client.connect(); // second call
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('expands workspaceFolder placeholders before starting stdio presets', async () => {
      const client = new McpClient(makeStdioConfig({ args: ['-y', '@modelcontextprotocol/server-filesystem', '${workspaceFolder}'] }));
      await client.connect();

      const expectedLaunch = process.platform === 'win32'
        ? {
          command: 'cmd',
          args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-filesystem', 'C:/AtlasMindWorkspace'],
        }
        : {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/AtlasMindWorkspace'],
        };

      expect(lastStdioTransportOptions).toMatchObject(expectedLaunch);
    });

    it('throws for stdio transport when command is missing', async () => {
      const client = new McpClient(makeStdioConfig({ command: undefined }));
      await expect(client.connect()).rejects.toThrow('requires a command');
    });

    it('surfaces a helpful error when the configured stdio command is not installed', async () => {
      const client = new McpClient(makeStdioConfig({ command: 'atlasmind-command-that-does-not-exist' }));
      await expect(client.connect()).rejects.toThrow(/not found|review the preset setup details/i);
    });

    it('throws for http transport when url is missing', async () => {
      const client = new McpClient(makeHttpConfig({ url: undefined }));
      await expect(client.connect()).rejects.toThrow('requires a URL');
    });

    it('throws for http transport with invalid URL', async () => {
      const client = new McpClient(makeHttpConfig({ url: 'ftp://bad.scheme' }));
      await expect(client.connect()).rejects.toThrow('invalid or disallowed URL');
    });
  });

  describe('disconnect()', () => {
    it('transitions to disconnected', async () => {
      const client = new McpClient(makeStdioConfig());
      await client.connect();
      await client.disconnect();
      expect(client.status).toBe('disconnected');
    });

    it('is safe to call when not connected', async () => {
      const client = new McpClient(makeStdioConfig());
      await expect(client.disconnect()).resolves.not.toThrow();
    });
  });

  describe('callTool()', () => {
    it('returns text content on success', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello output' }],
        isError: false,
      });

      const client = new McpClient(makeStdioConfig());
      await client.connect();
      const result = await client.callTool('my-tool', { arg: 1 });
      expect(result).toBe('Hello output');
    });

    it('concatenates multiple text parts', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Part one.' },
          { type: 'text', text: 'Part two.' },
        ],
        isError: false,
      });

      const client = new McpClient(makeStdioConfig());
      await client.connect();
      const result = await client.callTool('tool', {});
      expect(result).toBe('Part one.\nPart two.');
    });

    it('throws McpToolError when isError is true', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Something went wrong' }],
        isError: true,
      });

      const client = new McpClient(makeStdioConfig());
      await client.connect();
      await expect(client.callTool('bad-tool', {})).rejects.toBeInstanceOf(McpToolError);
    });

    it('throws when not connected', async () => {
      const client = new McpClient(makeStdioConfig());
      await expect(client.callTool('tool', {})).rejects.toThrow('not connected');
    });

    it('defaults a required repoPath to the workspace folder when the model omits it', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{
          name: 'git_status',
          description: 'Show repo status.',
          inputSchema: { type: 'object', properties: { repoPath: { type: 'string' } }, required: ['repoPath'] },
        }],
        nextCursor: undefined,
      });

      const client = new McpClient(makeStdioConfig());
      await client.connect();
      await client.callTool('git_status', {});

      expect(mockCallTool).toHaveBeenCalledWith(
        { name: 'git_status', arguments: { repoPath: 'C:/AtlasMindWorkspace' } },
        undefined,
        expect.any(Object),
      );
    });
  });

  describe('applyMcpWorkspacePathDefaults()', () => {
    const schema = { type: 'object', properties: { repoPath: { type: 'string' } }, required: ['repoPath'] };

    it('fills a missing repo-path param with the workspace folder', () => {
      expect(applyMcpWorkspacePathDefaults({}, schema, '/repo')).toEqual({ repoPath: '/repo' });
      expect(applyMcpWorkspacePathDefaults({ repoPath: '   ' }, schema, '/repo')).toEqual({ repoPath: '/repo' });
    });

    it('never overrides a value the caller supplied', () => {
      expect(applyMcpWorkspacePathDefaults({ repoPath: '/other' }, schema, '/repo')).toEqual({ repoPath: '/other' });
    });

    it('recognizes cwd / workingDirectory / projectPath but not a bare path', () => {
      const wide = {
        properties: {
          cwd: { type: 'string' },
          workingDirectory: { type: 'string' },
          projectPath: { type: 'string' },
          path: { type: 'string' },
        },
      };
      expect(applyMcpWorkspacePathDefaults({}, wide, '/repo')).toEqual({
        cwd: '/repo',
        workingDirectory: '/repo',
        projectPath: '/repo',
      });
    });

    it('is a no-op without a workspace folder, schema, or matching params', () => {
      expect(applyMcpWorkspacePathDefaults({ a: 1 }, schema, undefined)).toEqual({ a: 1 });
      expect(applyMcpWorkspacePathDefaults({ a: 1 }, undefined, '/repo')).toEqual({ a: 1 });
      expect(applyMcpWorkspacePathDefaults({ a: 1 }, { properties: { other: { type: 'string' } } }, '/repo')).toEqual({ a: 1 });
    });

    it('skips non-string repo-path params', () => {
      const numeric = { properties: { repoPath: { type: 'number' } } };
      expect(applyMcpWorkspacePathDefaults({}, numeric, '/repo')).toEqual({});
    });
  });
});
