import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mocked vscode whose fs.writeFile actually persists to disk so the module's
// node:fs reads can observe what was written (idempotency checks).
vi.mock('vscode', () => ({
  workspace: {
    fs: {
      writeFile: async (uri: { fsPath: string }, data: Uint8Array) => {
        mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        writeFileSync(uri.fsPath, Buffer.from(data));
      },
    },
  },
  Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
  default: {},
}));

import {
  buildTestingProtocolsMarkdown,
  syncTestingProtocols,
  MANAGED_BLOCK_START,
  MANAGED_BLOCK_END,
} from '../../src/utils/testingProtocolSync.ts';
import { isSafeRelativePath } from '../../src/utils/aiInstructionSync.ts';
import type { AgentDefinition, ProjectTestingConfig } from '../../src/types.ts';

function makeConfig(overrides: ProjectTestingConfig['methodologies'] = [
  { id: 'unit', enabled: true, assignedAgentId: 'agent-qa', assignedModelId: 'claude-opus-4-8', notes: 'Cover the auth module' },
  { id: 'e2e', enabled: true },
  { id: 'bdd', enabled: false },
]): ProjectTestingConfig {
  return { version: 1, updatedAt: '2026-01-01T00:00:00.000Z', methodologies: overrides };
}

const agents: AgentDefinition[] = [
  { id: 'agent-qa', name: 'QA Specialist', role: 'tester', description: '', systemPrompt: '' } as AgentDefinition,
];

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(os.tmpdir(), 'atlas-protocol-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('buildTestingProtocolsMarkdown', () => {
  it('renders only enabled methodologies with their fields', () => {
    const md = buildTestingProtocolsMarkdown(makeConfig(), agents);
    expect(md).toContain('### Unit Testing');
    expect(md).toContain('### End-to-End');
    expect(md).not.toContain('### BDD'); // disabled
    expect(md).toContain('**Primary owner:** QA Specialist'); // resolved from agents
    expect(md).toContain('`claude-opus-4-8`');
    expect(md).toContain('Cover the auth module');
  });

  it('reports no methodologies when none are enabled', () => {
    const md = buildTestingProtocolsMarkdown(
      makeConfig([{ id: 'unit', enabled: false }]),
      agents,
    );
    expect(md).toContain('No testing methodologies are currently enabled');
  });

  it('falls back to the raw agent id when the agent is not in the registry', () => {
    const md = buildTestingProtocolsMarkdown(
      makeConfig([{ id: 'unit', enabled: true, assignedAgentId: 'ghost-agent' }]),
      agents,
    );
    expect(md).toContain('**Primary owner:** ghost-agent');
  });
});

describe('syncTestingProtocols', () => {
  it('injects the managed block into a detected file, preserving surrounding content', async () => {
    const claudePath = path.join(workspace, 'CLAUDE.md');
    writeFileSync(claudePath, '# My Project\n\nExisting guidance.\n');

    const result = await syncTestingProtocols(workspace, makeConfig(), agents);

    expect(result.success).toBe(true);
    expect(result.updated).toContain('CLAUDE.md');
    const content = readFileSync(claudePath, 'utf8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Existing guidance.');
    expect(content).toContain(MANAGED_BLOCK_START);
    expect(content).toContain(MANAGED_BLOCK_END);
    expect(content).toContain('### Unit Testing');
  });

  it('is idempotent — re-running replaces the block instead of duplicating it', async () => {
    const copilotPath = path.join(workspace, '.github', 'copilot-instructions.md');
    mkdirSync(path.dirname(copilotPath), { recursive: true });
    writeFileSync(copilotPath, 'Copilot rules.\n');

    await syncTestingProtocols(workspace, makeConfig(), agents);
    const first = readFileSync(copilotPath, 'utf8');
    await syncTestingProtocols(workspace, makeConfig(), agents);
    const second = readFileSync(copilotPath, 'utf8');

    expect(second).toBe(first);
    expect(second.match(new RegExp(MANAGED_BLOCK_START, 'g'))).toHaveLength(1);
    expect(second.match(new RegExp(MANAGED_BLOCK_END, 'g'))).toHaveLength(1);
  });

  it('refreshes the block contents when the config changes', async () => {
    const agentsPath = path.join(workspace, 'AGENTS.md');
    writeFileSync(agentsPath, 'Agents doc.\n');

    await syncTestingProtocols(workspace, makeConfig(), agents);
    expect(readFileSync(agentsPath, 'utf8')).toContain('### End-to-End');

    await syncTestingProtocols(
      workspace,
      makeConfig([{ id: 'unit', enabled: true }]),
      agents,
    );
    const updated = readFileSync(agentsPath, 'utf8');
    expect(updated).toContain('### Unit Testing');
    expect(updated).not.toContain('### End-to-End');
  });

  it('only writes to files that already exist (does not create new ones)', async () => {
    // No instruction files present in the workspace.
    const result = await syncTestingProtocols(workspace, makeConfig(), agents);

    expect(result.success).toBe(false);
    expect(result.updated).toHaveLength(0);
    expect(existsSync(path.join(workspace, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(path.join(workspace, 'AGENTS.md'))).toBe(false);
  });

  it('reports JSON-config tools as skipped rather than corrupting them', async () => {
    const continuePath = path.join(workspace, '.continue', 'config.json');
    mkdirSync(path.dirname(continuePath), { recursive: true });
    writeFileSync(continuePath, '{"systemMessage":"hi"}');

    const result = await syncTestingProtocols(workspace, makeConfig(), agents);

    expect(result.skipped.some(s => s.path === '.continue/config.json')).toBe(true);
    // The JSON file is left byte-for-byte intact.
    expect(readFileSync(continuePath, 'utf8')).toBe('{"systemMessage":"hi"}');
  });
});

describe('path-safety guard (shared with aiInstructionSync)', () => {
  it('rejects traversal and absolute paths', () => {
    expect(isSafeRelativePath('../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('C:/Windows/system32')).toBe(false);
    expect(isSafeRelativePath('a/../../b')).toBe(false);
    expect(isSafeRelativePath('foo\0bar')).toBe(false);
  });

  it('accepts well-formed workspace-relative paths', () => {
    expect(isSafeRelativePath('CLAUDE.md')).toBe(true);
    expect(isSafeRelativePath('.github/copilot-instructions.md')).toBe(true);
  });
});
