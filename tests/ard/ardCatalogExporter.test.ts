import { describe, expect, it } from 'vitest';
import { buildAtlasMindCatalog } from '../../src/ard/ardCatalogExporter.ts';
import { ARD_URN_PATTERN } from '../../src/constants.ts';
import type { AgentDefinition, McpServerState, SkillDefinition } from '../../src/types.ts';

const agent: AgentDefinition = {
  id: 'backend-engineer',
  name: 'Backend Engineer',
  role: 'Implements backend services',
  description: 'Writes APIs and services.',
  systemPrompt: 'SECRET SYSTEM PROMPT THAT MUST NOT LEAK',
  skills: ['file-read', 'git-commit'],
};

const skill: SkillDefinition = {
  id: 'http-request',
  name: 'HTTP Request',
  description: 'Make an HTTP request.',
  parameters: { type: 'object', properties: {} },
  routingHints: ['call api', 'post request'],
  builtIn: true,
  execute: async () => 'ok',
};

const mcpSkill: SkillDefinition = {
  id: 'mcp:server-1:do-thing',
  name: '[MCP] do-thing',
  description: 'External MCP tool.',
  parameters: {},
  source: 'mcp://server-1/do-thing',
  execute: async () => 'ok',
};

const mcpServer: McpServerState = {
  config: { id: 's1', name: 'Local DB', transport: 'stdio', command: 'npx', args: ['server'], env: { DB_TOKEN: 'super-secret' }, enabled: true },
  status: 'connected',
  tools: [{ serverId: 's1', name: 'query', description: 'run a query', inputSchema: {} }],
};

describe('buildAtlasMindCatalog', () => {
  it('emits a spec-conformant catalog with did:web host and urn:ai identifiers', () => {
    const catalog = buildAtlasMindCatalog({ publisher: 'my-app', agents: [agent], skills: [skill], mcpServers: [mcpServer] });
    expect(catalog.specVersion).toBe('1.0');
    expect(catalog.host?.identifier).toBe('did:web:my-app');
    for (const entry of catalog.entries) {
      expect(entry.identifier).toMatch(ARD_URN_PATTERN);
      // Strict value-or-reference: AtlasMind exports embedded data, never a url.
      expect(Boolean(entry.url) !== Boolean(entry.data)).toBe(true);
    }
  });

  it('never leaks agent system prompts or MCP env secrets', () => {
    const catalog = buildAtlasMindCatalog({ publisher: 'x', agents: [agent], mcpServers: [mcpServer] });
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain('SECRET SYSTEM PROMPT');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('DB_TOKEN');
  });

  it('exports agent role/description and MCP tool capabilities', () => {
    const catalog = buildAtlasMindCatalog({ publisher: 'x', agents: [agent], mcpServers: [mcpServer] });
    const agentEntry = catalog.entries.find(e => e.type === 'application/vnd.atlasmind.agent+json');
    const mcpEntry = catalog.entries.find(e => e.type === 'application/mcp-server+json');
    expect(agentEntry?.capabilities).toEqual(['file-read', 'git-commit']);
    expect(agentEntry?.data).toMatchObject({ role: agent.role });
    expect(mcpEntry?.capabilities).toEqual(['query']);
    expect(mcpEntry?.data).toMatchObject({ transport: 'stdio', command: 'npx' });
  });

  it('skips MCP-derived skills (they belong to their own publisher)', () => {
    const catalog = buildAtlasMindCatalog({ publisher: 'x', skills: [skill, mcpSkill] });
    const skillEntries = catalog.entries.filter(e => e.type === 'application/ai-skill');
    expect(skillEntries).toHaveLength(1);
    expect(skillEntries[0]?.displayName).toBe('HTTP Request');
  });
});
