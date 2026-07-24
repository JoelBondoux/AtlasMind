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
/** Captures the config the registry passes to McpClient at connect time. */
let lastConstructedConfig: McpServerConfig | undefined;
const mockFindCommandExecutable = vi.fn((_command: string): string | undefined => undefined);

vi.mock('../../src/mcp/mcpClient.ts', () => ({
  McpClient: class MockMcpClient {
    constructor(...args: unknown[]) {
      lastConstructedConfig = args[0] as McpServerConfig;
    }

    connect = mockConnect;
    disconnect = mockDisconnect;
    callTool = mockCallTool;

    get status() { return mockStatus; }
    get tools() { return mockTools; }
    get error() { return undefined; }
  },
  findCommandExecutable: (command: string) => mockFindCommandExecutable(command),
  getKnownCommandInstallHint: () => 'Install the required runtime.',
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

function makeMockSecrets() {
  const store = new Map<string, string>();
  return {
    store: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get: vi.fn(async (key: string) => store.get(key)),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    _store: store,
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
    lastConstructedConfig = undefined;
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockFindCommandExecutable.mockReturnValue(undefined);
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

    it('migrates the legacy broken Git preset package to the supported git server command', () => {
      const memento = makeMockMemento();
      memento.get.mockReturnValue([
        {
          id: 'git-1',
          name: 'Git MCP Server',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-git'],
          enabled: true,
        },
      ] satisfies McpServerConfig[]);

      const registry = new McpServerRegistry(memento, new SkillsRegistry(), vi.fn());
      registry.loadFromStorage();

      const restored = registry.listServers()[0]?.config;
      expect(restored?.command).toBe('uvx');
      expect(restored?.args).toEqual(['mcp-server-git']);
      expect(restored?.enabled).toBe(true);
    });

    it('safely disables legacy manual-only presets that previously pointed at nonexistent npm packages', () => {
      const memento = makeMockMemento();
      memento.get.mockReturnValue([
        {
          id: 'm365-1',
          name: 'Microsoft 365 MCP Server',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-m365'],
          enabled: true,
        },
      ] satisfies McpServerConfig[]);

      const registry = new McpServerRegistry(memento, new SkillsRegistry(), vi.fn());
      registry.loadFromStorage();

      const restored = registry.listServers()[0]?.config;
      expect(restored?.enabled).toBe(false);
      expect(restored?.command).toBe('npx');
      expect(restored?.args).toEqual(['-y', '@modelcontextprotocol/server-m365']);
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

  describe('SecretStorage-backed env', () => {
    it('resolves secretEnvKeys from SecretStorage into the connect-time env only', async () => {
      const secrets = makeMockSecrets();
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn(), undefined, secrets as never);
      const id = registry.addServer({ ...makeStdioConfig(), env: { PLAIN: 'x' }, secretEnvKeys: ['TOKEN'] });
      await registry.setServerSecrets(id, { TOKEN: 'super-secret' });

      await registry.connectServer(id);

      // The client receives the merged secret value…
      expect(lastConstructedConfig?.env).toMatchObject({ PLAIN: 'x', TOKEN: 'super-secret' });
      // …but the persisted config never stores the secret value.
      const persisted = registry.listServers().find(entry => entry.config.id === id)?.config;
      expect(persisted?.env).toEqual({ PLAIN: 'x' });
      expect(secrets.store).toHaveBeenCalledWith(`atlasmind.mcp.${id}.TOKEN`, 'super-secret');
    });

    it('deletes stored secrets when the server is removed', async () => {
      const secrets = makeMockSecrets();
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn(), undefined, secrets as never);
      const id = registry.addServer({ ...makeStdioConfig(), secretEnvKeys: ['TOKEN'] });
      await registry.setServerSecrets(id, { TOKEN: 'super-secret' });

      await registry.removeServer(id);

      expect(secrets.delete).toHaveBeenCalledWith(`atlasmind.mcp.${id}.TOKEN`);
    });

    it('leaves env untouched when no SecretStorage is provided', async () => {
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());
      const id = registry.addServer({ ...makeStdioConfig(), env: { PLAIN: 'x' } });

      await registry.connectServer(id);

      expect(lastConstructedConfig?.env).toEqual({ PLAIN: 'x' });
    });
  });

  describe('detectAvailableServers()', () => {
    it('only surfaces servers whose launch runtime is present', async () => {
      mockFindCommandExecutable.mockImplementation((command: string) => (command === 'npx' ? '/usr/bin/npx' : undefined));
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());

      const detected = await registry.detectAvailableServers();
      const names = detected.map(entry => entry.config.name);

      expect(names).toContain('Filesystem MCP Server');
      expect(names).not.toContain('Git MCP Server'); // uvx absent
      expect(detected.every(entry => typeof entry.reason === 'string' && entry.reason.length > 0)).toBe(true);
    });

    it('returns nothing when no supported runtime is installed', async () => {
      mockFindCommandExecutable.mockReturnValue(undefined);
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());

      expect(await registry.detectAvailableServers()).toHaveLength(0);
    });

    it('does not re-offer an already-configured server', async () => {
      mockFindCommandExecutable.mockImplementation((command: string) => (command === 'uvx' ? '/usr/bin/uvx' : undefined));
      const registry = new McpServerRegistry(makeMockMemento(), new SkillsRegistry(), vi.fn());
      registry.addServer({ name: 'Git MCP Server', transport: 'stdio', command: 'uvx', args: ['mcp-server-git'], enabled: false });

      const detected = await registry.detectAvailableServers();

      expect(detected.map(entry => entry.config.name)).not.toContain('Git MCP Server');
    });
  });
});
