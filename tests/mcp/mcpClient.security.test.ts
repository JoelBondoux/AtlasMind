import { describe, expect, it } from 'vitest';
import { McpClient } from '../../src/mcp/mcpClient.ts';
import type { McpServerConfig } from '../../src/types.ts';

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'test',
    name: 'Test',
    transport: 'stdio',
    command: 'node',
    args: [],
    enabled: true,
    ...overrides,
  };
}

describe('McpClient command validation', () => {
  it('rejects command containing pipe metacharacter', async () => {
    const client = new McpClient(makeConfig({ command: 'node | cat' }));
    await expect(client.connect()).rejects.toThrow('disallowed shell metacharacters');
  });

  it('rejects command containing semicolon', async () => {
    const client = new McpClient(makeConfig({ command: 'node; rm -rf /' }));
    await expect(client.connect()).rejects.toThrow('disallowed shell metacharacters');
  });

  it('rejects command containing ampersand', async () => {
    const client = new McpClient(makeConfig({ command: 'node & malicious' }));
    await expect(client.connect()).rejects.toThrow('disallowed shell metacharacters');
  });

  it('rejects command containing backtick', async () => {
    const client = new McpClient(makeConfig({ command: 'node `whoami`' }));
    await expect(client.connect()).rejects.toThrow('disallowed shell metacharacters');
  });

  it('rejects command containing dollar sign', async () => {
    const client = new McpClient(makeConfig({ command: 'node $(malicious)' }));
    await expect(client.connect()).rejects.toThrow('disallowed shell metacharacters');
  });

  it('allows command with no metacharacters', () => {
    // Just testing construction + config acceptance — full connect would need MCP infra
    const client = new McpClient(makeConfig({ command: 'node' }));
    expect(client.status).toBe('disconnected');
  });
});
