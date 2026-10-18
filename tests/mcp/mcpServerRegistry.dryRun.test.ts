import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Memento } from 'vscode';
import type { McpToolInfo } from '../../src/types.ts';

/**
 * The backstop under every MCP caller: a dry run reaching the registry's skill
 * wrapper is refused before `callTool`, whoever asked — the tool loop simulates
 * MCP calls before they get here, and each panel asks first, so this is what
 * catches the caller that forgot.
 */

const mockCallTool = vi.fn().mockResolvedValue('tool result');
const mockTools: McpToolInfo[] = [
  { serverId: '', name: 'send_email', description: 'Send an email', inputSchema: {} },
];

vi.mock('../../src/mcp/mcpClient.ts', () => ({
  McpClient: class MockMcpClient {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    callTool = mockCallTool;
    get status() { return 'connected'; }
    get tools() { return mockTools; }
    get error() { return undefined; }
  },
  findCommandExecutable: () => undefined,
  getKnownCommandInstallHint: () => 'Install the required runtime.',
}));

import { McpServerRegistry } from '../../src/mcp/mcpServerRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';
import { DryRunLedger } from '../../src/core/dryRun.ts';
import { DryRunHost, installDryRunHost } from '../../src/core/dryRunHost.ts';

function memento(): Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get: (key: string, fallback?: unknown) => store.get(key) ?? fallback,
    update: async (key: string, value: unknown) => { store.set(key, value); },
  } as unknown as Memento;
}

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  mockCallTool.mockClear();
});

async function connectedSkill() {
  const skills = new SkillsRegistry();
  const registry = new McpServerRegistry(memento(), skills, vi.fn());
  const id = registry.addServer({ name: 'Mail', transport: 'stdio', command: 'npx', args: ['mail-server'], enabled: true });
  await registry.connectServer(id);
  const skill = skills.get(`mcp:${id}:send_email`);
  expect(skill).toBeDefined();
  return skill!;
}

describe('MCP tool calls under a dry run', () => {
  it('never reaches callTool in a dry run, and records the call', async () => {
    const ledger = new DryRunLedger();
    const notify = vi.fn();
    uninstall = installDryRunHost(new DryRunHost({ isEnabled: () => true, record: record => ledger.record(record), notify }));
    const skill = await connectedSkill();

    await expect(skill.execute({ to: 'someone@example.com' }, {} as never)).rejects.toThrow(/Dry run is on/);
    expect(mockCallTool).not.toHaveBeenCalled();
    expect(ledger.list().map(record => record.rule)).toEqual(['dry-run.host-network']);
    // The backstop is quiet: the surface that asked is the one that tells.
    expect(notify).not.toHaveBeenCalled();
  });

  it('calls the tool as before when dry run is off', async () => {
    uninstall = installDryRunHost(new DryRunHost({ isEnabled: () => false, record: () => undefined }));
    const skill = await connectedSkill();
    await expect(skill.execute({ to: 'someone@example.com' }, {} as never)).resolves.toBe('tool result');
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });
});
