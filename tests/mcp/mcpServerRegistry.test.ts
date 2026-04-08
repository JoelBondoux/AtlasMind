/**
 * Unit tests for McpServerRegistry.
 *
 * McpClient is mocked so tests do not spawn processes or make network calls.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { McpServerConfig, McpToolInfo } from '../../src/types.ts';

// ── Mock McpClient ────────────────────────────────────────────────

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockCallTool = vi.fn().mockResolvedValue('tool result');
let mockStatus = 'connected';
let mockTools: McpToolInfo[] = [];

vi.mock('../../src/mcp/mcpClient.ts', () => ({
  McpClient: class MockMcpClient {
    constructor(..._args: unknown[]) {}

    connect = mockConnect;
    disconnect = mockDisconnect;
    callTool = mockCallTool;

    get status() { return mockStatus; }
    get tools() { return mockTools; }
    get error() { return undefined; }
  },
}));

import { McpServerRegistry } from '../../src/mcp/mcpServerRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';

// ── Helpers ──────────────────────────────────────────────────────

function makeMockMemento(): { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => store.get(key) ?? defaultValue),
    update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  };
}

function makeStdioConfig(): Omit<McpServerConfig, 'id'> {
  return {
    name: 'Test Server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'some-server'],
    enabled: true,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('McpServerRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = 'connected';
    mockTools = [];
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
  });

  describe('addServer()', () => {
    it('generates a unique id and stores the config', () => {
      const onRefresh = vi.fn();
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), onRefresh);

      const id = registry.addServer(makeStdioConfig());

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const servers = registry.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].config.name).toBe('Test Server');
      expect(servers[0].config.id).toBe(id);
    });

    it('calls onRefresh after adding', () => {
      const onRefresh = vi.fn();
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), onRefresh);
      registry.addServer(makeStdioConfig());
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeServer()', () => {
    it('removes the server from the list', async () => {
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());
      const id = registry.addServer(makeStdioConfig());

      await registry.removeServer(id);

      expect(registry.listServers()).toHaveLength(0);
    });
  });

  describe('connectServer()', () => {
    it('creates a client and connects when server is enabled', async () => {
      const skills = new SkillsRegistry();
      const registry = new McpServerRegistry(makeMockMemento(), skills, vi.fn());
      const id = registry.addServer(makeStdioConfig());

      await registry.connectServer(id);

      expect(mockConnect).toHaveBeenCalledTimes(1);
      const serverState = registry.listServers().find(s => s.config.id === id);
      expect(serverState?.status).toBe('connected');
    });

    it('registers MCP tools as skills in the SkillsRegistry', async () => {
      mockTools = [
        { serverId: '', name: 'read-file', description: 'Read a file', inputSchema: {} },
        { serverId: '', name: 'write-file', description: 'Write a file', inputSchema: {} },
      ];

      const skills = new SkillsRegistry();
      const registry = new McpServerRegistry(makeMockMemento(), skills, vi.fn());
      const id = registry.addServer(makeStdioConfig());

      await registry.connectServer(id);

      const allSkills = skills.listSkills();
      const mcpSkills = allSkills.filter(s => s.id.startsWith('mcp:'));
      expect(mcpSkills).toHaveLength(2);
      expect(mcpSkills[0].id).toBe(`mcp:${id}:read-file`);
      expect(mcpSkills[1].id).toBe(`mcp:${id}:write-file`);
    });

    it('auto-approves registered MCP tool skills', async () => {
      mockTools = [
        { serverId: '', name: 'a-tool', description: '', inputSchema: {} },
      ];

      const skills = new SkillsRegistry();
      const registry = new McpServerRegistry(makeMockMemento(), skills, vi.fn());
      const id = registry.addServer(makeStdioConfig());

      await registry.connectServer(id);

      const skillId = `mcp:${id}:a-tool`;
      const result = skills.getScanResult(skillId);
      expect(result?.status).toBe('passed');
    });

    it('does not connect a disabled server', async () => {
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());
      const id = registry.addServer({ ...makeStdioConfig(), enabled: false });

      await registry.connectServer(id);

      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  describe('disconnectServer()', () => {
    it('disables registered MCP skills on disconnect', async () => {
      mockTools = [
        { serverId: '', name: 'tool-x', description: '', inputSchema: {} },
      ];

      const skills = new SkillsRegistry();
      const registry = new McpServerRegistry(makeMockMemento(), skills, vi.fn());
      const id = registry.addServer(makeStdioConfig());

      await registry.connectServer(id);
      const skillId = `mcp:${id}:tool-x`;

      // Skill should initially be enabled (scan passed)
      expect(skills.isEnabled(skillId)).toBe(true);

      // Disconnect the server without removing skills
      await registry.disconnectServer(id, false);
      expect(skills.isEnabled(skillId)).toBe(false);
    });

    it('unregisters skills when removeSkills = true', async () => {
      mockTools = [
        { serverId: '', name: 'tool-y', description: '', inputSchema: {} },
      ];

      const skills = new SkillsRegistry();
      const registry = new McpServerRegistry(makeMockMemento(), skills, vi.fn());
      const id = registry.addServer(makeStdioConfig());

      await registry.connectServer(id);
      const skillId = `mcp:${id}:tool-y`;
      expect(skills.get(skillId)).toBeDefined();

      await registry.disconnectServer(id, true);
      expect(skills.get(skillId)).toBeUndefined();
    });
  });

  describe('loadFromStorage()', () => {
    it('restores persisted server configs', () => {
      const serverId = '00000000-0000-0000-0000-000000000001';
      const memento = makeMockMemento();
      const savedConfig: McpServerConfig = {
        id: serverId,
        name: 'Saved Server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
      };
      memento.get.mockReturnValue([savedConfig]);

      const registry = new McpServerRegistry(memento, new SkillsRegistry(), vi.fn());
      registry.loadFromStorage();

      const servers = registry.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].config.name).toBe('Saved Server');
      expect(servers[0].status).toBe('disconnected'); // not connected yet
    });

    it('ignores invalid entries in storage', () => {
      const memento = makeMockMemento();
      memento.get.mockReturnValue([
        { id: 'abc', name: 'Valid', transport: 'stdio', command: 'node', enabled: true },
        { name: 'Missing id', transport: 'stdio' }, // invalid: no id
        null,                                        // invalid: not an object
        'bad string',                                // invalid: not an object
      ]);

      const registry = new McpServerRegistry(memento, new SkillsRegistry(), vi.fn());
      registry.loadFromStorage();

      expect(registry.listServers()).toHaveLength(1);
    });
  });

  describe('updateServer()', () => {
    it('updates name and persists', () => {
      const onRefresh = vi.fn();
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), onRefresh);
      const id = registry.addServer(makeStdioConfig());

      registry.updateServer(id, { name: 'Renamed' });

      const servers = registry.listServers();
      expect(servers[0].config.name).toBe('Renamed');
      expect(onRefresh).toHaveBeenCalledTimes(2); // once for add, once for update
    });
  });

  describe('importServers()', () => {
    it('imports a new compatible server and connects it', async () => {
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());

      const result = await registry.importServers([makeStdioConfig()]);

      expect(result).toMatchObject({ added: 1, updated: 0, skipped: 0, connected: 1 });
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(registry.listServers()).toHaveLength(1);
    });

    it('skips duplicate server configs already present in AtlasMind', async () => {
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());
      registry.addServer(makeStdioConfig());

      const result = await registry.importServers([makeStdioConfig()]);

      expect(result).toMatchObject({ added: 0, updated: 0, skipped: 1, connected: 0 });
      expect(registry.listServers()).toHaveLength(1);
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('enables a matching disabled server instead of creating a duplicate', async () => {
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());
      const id = registry.addServer({ ...makeStdioConfig(), enabled: false });

      const result = await registry.importServers([makeStdioConfig()]);

      expect(result).toMatchObject({ added: 0, updated: 1, skipped: 0, connected: 1 });
      expect(mockConnect).toHaveBeenCalledTimes(1);
      const server = registry.listServers().find(entry => entry.config.id === id);
      expect(server?.config.enabled).toBe(true);
    });
  });
});
