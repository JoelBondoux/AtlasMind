import { describe, expect, it, vi } from 'vitest';
import { ArdInstaller, resolveMcpConfig } from '../../src/ard/ardInstaller.ts';
import type { McpServerRegistry } from '../../src/mcp/mcpServerRegistry.ts';
import type { ArdRegistry } from '../../src/ard/ardRegistry.ts';
import type { ArdDiscoveredResource } from '../../src/types.ts';

function makeInstaller() {
  const addServer = vi.fn(() => 'mcp-id-1');
  const addFinder = vi.fn(() => 'finder-id-1');
  const mcp = { addServer } as unknown as McpServerRegistry;
  const ard = { add: addFinder } as unknown as ArdRegistry;
  return { installer: new ArdInstaller(mcp, ard), addServer, addFinder };
}

function resource(partial: Partial<ArdDiscoveredResource>): ArdDiscoveredResource {
  return {
    identifier: 'urn:ai:example.com:x:one',
    displayName: 'Example',
    type: 'application/mcp-server+json',
    sourceName: 'Test',
    ...partial,
  };
}

describe('resolveMcpConfig', () => {
  it('derives a stdio config from embedded command/args (no env leak in shape)', () => {
    const config = resolveMcpConfig(resource({
      data: { command: 'npx', args: ['-y', '@scope/server'], env: { TOKEN: 'x' } },
    }));
    expect(config).toMatchObject({ transport: 'stdio', command: 'npx', args: ['-y', '@scope/server'], enabled: false });
  });

  it('derives an http config from an embedded remote url', () => {
    const config = resolveMcpConfig(resource({ data: { url: 'https://api.example.com/mcp' } }));
    expect(config).toMatchObject({ transport: 'http', url: 'https://api.example.com/mcp', enabled: false });
  });

  it('falls back to the entry url as an http endpoint', () => {
    const config = resolveMcpConfig(resource({ url: 'https://remote.example.com/mcp' }));
    expect(config).toMatchObject({ transport: 'http', url: 'https://remote.example.com/mcp', enabled: false });
  });

  it('returns undefined when no usable connection is present', () => {
    expect(resolveMcpConfig(resource({ data: { foo: 'bar' } }))).toBeUndefined();
  });
});

describe('ArdInstaller.install', () => {
  it('adds an MCP server as a DISABLED server', async () => {
    const { installer, addServer } = makeInstaller();
    const result = await installer.install(resource({ data: { command: 'npx', args: ['server'] } }));
    expect(addServer).toHaveBeenCalledTimes(1);
    expect(addServer.mock.calls[0][0]).toMatchObject({ enabled: false, transport: 'stdio' });
    expect(result).toMatchObject({ kind: 'mcp-server', ok: true, mcpServerId: 'mcp-id-1' });
  });

  it('records an MCP server with no connection as a reference (does not add)', async () => {
    const { installer, addServer } = makeInstaller();
    const result = await installer.install(resource({ data: { unrelated: true } }));
    expect(addServer).not.toHaveBeenCalled();
    expect(result.kind).toBe('reference');
  });

  it('adds a nested registry as a DISABLED finder', async () => {
    const { installer, addFinder } = makeInstaller();
    const result = await installer.install(resource({
      type: 'application/ai-registry+json',
      url: 'https://other.com/search',
    }));
    expect(addFinder).toHaveBeenCalledTimes(1);
    expect(addFinder.mock.calls[0][0]).toMatchObject({ enabled: false, kind: 'registry', url: 'https://other.com/search' });
    expect(result).toMatchObject({ kind: 'finder', ok: true });
  });

  it('treats A2A agents and skills as reference-only (no auto-wiring)', async () => {
    const { installer, addServer, addFinder } = makeInstaller();
    const a2a = await installer.install(resource({ type: 'application/a2a-agent-card+json', url: 'https://agent.example.com/card.json' }));
    const skill = await installer.install(resource({ type: 'application/ai-skill', data: { parameters: {} } }));
    expect(addServer).not.toHaveBeenCalled();
    expect(addFinder).not.toHaveBeenCalled();
    expect(a2a.kind).toBe('reference');
    expect(skill.kind).toBe('reference');
  });
});
