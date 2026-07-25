import { describe, expect, it, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import {
  classifySecretEnvKey,
  parseMcpConfigFile,
  extractDotenvNames,
  extractWranglerNames,
  resolveImportedServer,
  renderMcpEnvironmentMarkdown,
} from '../../src/mcp/mcpEnvironmentScanner.ts';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atlas-mcp-scan-'));
afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('classifySecretEnvKey', () => {
  it('flags credential-looking names', () => {
    for (const name of ['GITHUB_PERSONAL_ACCESS_TOKEN', 'API_KEY', 'CLIENT_SECRET', 'DB_PASSWORD', 'AUTH_HEADER', 'PRIVATE_KEY']) {
      expect(classifySecretEnvKey(name)).toBe(true);
    }
  });
  it('does not flag innocuous names', () => {
    for (const name of ['PORT', 'HOST', 'NODE_ENV', 'REGION', 'WP_API_URL']) {
      expect(classifySecretEnvKey(name)).toBe(false);
    }
  });
});

describe('parseMcpConfigFile', () => {
  it('parses the mcpServers (Claude/Cursor) shape and records env NAMES only', () => {
    const content = JSON.stringify({
      mcpServers: {
        github: { command: 'docker', args: ['run', 'ghcr.io/github/github-mcp-server'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_realsecret', LOG_LEVEL: 'info' } },
      },
    });
    const [server] = parseMcpConfigFile(content, 'Claude Desktop', '/x/claude.json');
    expect(server.name).toBe('github');
    expect(server.transport).toBe('stdio');
    expect(server.command).toBe('docker');
    expect(server.envKeys).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN', 'LOG_LEVEL']);
    expect(server.secretEnvKeys).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN']);
    // Redaction boundary: the parsed structure must not contain the secret value.
    expect(JSON.stringify(server)).not.toContain('ghp_realsecret');
  });

  it('parses the servers (VS Code) shape and infers http transport from url', () => {
    const content = JSON.stringify({ servers: { remote: { url: 'https://mcp.example.com/mcp', type: 'http' } } });
    const [server] = parseMcpConfigFile(content, '.vscode/mcp.json', '/x/.vscode/mcp.json');
    expect(server.transport).toBe('http');
    expect(server.url).toBe('https://mcp.example.com/mcp');
  });

  it('skips entries with neither command nor url, and returns [] on malformed JSON', () => {
    expect(parseMcpConfigFile('{ not json', 's', '/p')).toEqual([]);
    const [none] = parseMcpConfigFile(JSON.stringify({ mcpServers: { bad: { description: 'x' } } }), 's', '/p');
    expect(none).toBeUndefined();
  });
});

describe('extractDotenvNames', () => {
  it('extracts keys, honouring export and ignoring comments/values', () => {
    const names = extractDotenvNames('# comment\nAPI_KEY=abc123\nexport DB_HOST=localhost\n  PORT = 3000\n');
    expect(names).toEqual(['API_KEY', 'DB_HOST', 'PORT']);
  });
});

describe('extractWranglerNames', () => {
  it('extracts account_id and [vars] keys', () => {
    const toml = 'name = "app"\naccount_id = "abc"\n\n[vars]\nMY_FLAG = "true"\nAPI_BASE = "https://x"\n';
    const names = extractWranglerNames(toml);
    expect(names).toContain('ACCOUNT_ID');
    expect(names).toContain('MY_FLAG');
    expect(names).toContain('API_BASE');
  });
});

describe('resolveImportedServer', () => {
  it('re-reads values live and routes secrets to a separate secrets map', () => {
    const file = path.join(tmp, 'claude.json');
    writeFileSync(file, JSON.stringify({
      mcpServers: {
        github: { command: 'docker', args: ['run'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_live', LOG_LEVEL: 'info' } },
      },
    }), 'utf8');
    const resolved = resolveImportedServer(file, 'github');
    expect(resolved).toBeDefined();
    expect(resolved!.config.transport).toBe('stdio');
    expect(resolved!.config.command).toBe('docker');
    // Secret value lands ONLY in the secrets map (→ SecretStorage), not in env.
    expect(resolved!.secrets).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_live' });
    expect(resolved!.config.secretEnvKeys).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN']);
    expect(resolved!.config.env).toEqual({ LOG_LEVEL: 'info' });
    expect(JSON.stringify(resolved!.config)).not.toContain('ghp_live');
  });

  it('builds an http config from a url entry', () => {
    const file = path.join(tmp, 'vscode.json');
    writeFileSync(file, JSON.stringify({ servers: { remote: { url: 'https://mcp.example.com/mcp' } } }), 'utf8');
    const resolved = resolveImportedServer(file, 'remote');
    expect(resolved!.config.transport).toBe('http');
    expect(resolved!.config.url).toBe('https://mcp.example.com/mcp');
  });

  it('returns undefined for a missing file or missing server', () => {
    expect(resolveImportedServer(path.join(tmp, 'nope.json'), 'x')).toBeUndefined();
    const file = path.join(tmp, 'empty.json');
    writeFileSync(file, JSON.stringify({ mcpServers: {} }), 'utf8');
    expect(resolveImportedServer(file, 'ghost')).toBeUndefined();
  });
});

describe('renderMcpEnvironmentMarkdown', () => {
  it('renders a no-secrets snapshot with servers and the safety note', () => {
    const md = renderMcpEnvironmentMarkdown({
      version: 1,
      scannedAt: '2026-07-25T00:00:00.000Z',
      launchers: { npx: true, docker: false },
      importedServers: [{ name: 'github', source: 'Claude Desktop', sourcePath: '/x', transport: 'stdio', command: 'docker', args: ['run'], envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'], secretEnvKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'] }],
      envVarNames: ['API_KEY'],
      projectSignals: ['wrangler.toml present — Cloudflare Workers project detected.'],
      sources: [{ label: 'Claude Desktop', path: '/x', exists: true }],
    });
    expect(md).toContain('# MCP Environment Scan');
    expect(md).toContain('No secret values are stored here');
    expect(md).toContain('github');
    expect(md).toContain('`npx`');
  });
});
