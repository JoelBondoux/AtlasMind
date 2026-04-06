import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCliToolApprovalGate, parseCliArgs, resolveCliSsotRoot } from '../../src/cli/main.ts';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const target = tempRoots.pop();
    if (!target) {
      continue;
    }
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('parseCliArgs', () => {
  it('parses command, positional arguments, and common options', () => {
    const parsed = parseCliArgs([
      'chat',
      '--workspace', 'C:/repo',
      '--provider', 'openai',
      '--budget', 'cheap',
      '--json',
      'fix', 'the', 'tests',
    ]);

    expect(parsed.command).toBe('chat');
    expect(parsed.subcommand).toBe('fix');
    expect(parsed.positional).toEqual(['the', 'tests']);
    expect(parsed.options.workspace).toBe('C:/repo');
    expect(parsed.options.provider).toBe('openai');
    expect(parsed.options.budget).toBe('cheap');
    expect(parsed.options.json).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it('parses the write opt-in flag for CLI mode', () => {
    const parsed = parseCliArgs(['chat', '--allow-writes', 'apply', 'the', 'patch']);

    expect(parsed.options.allowWrites).toBe(true);
  });

  it('parses --dry-run flag correctly', () => {
    const parsed = parseCliArgs(['build', '--dry-run']);
    expect(parsed.command).toBe('build');
    expect(parsed.options.dryRun).toBe(true);
  });

  it('parses --fix flag correctly', () => {
    const parsed = parseCliArgs(['lint', '--fix']);
    expect(parsed.command).toBe('lint');
    expect(parsed.options.fix).toBe(true);
  });

  it('parses --watch flag correctly', () => {
    const parsed = parseCliArgs(['test', '--watch']);
    expect(parsed.command).toBe('test');
    expect(parsed.options.watch).toBe(true);
  });

  it('defaults dryRun, fix, and watch to false', () => {
    const parsed = parseCliArgs(['chat', 'hello']);
    expect(parsed.options.dryRun).toBe(false);
    expect(parsed.options.fix).toBe(false);
    expect(parsed.options.watch).toBe(false);
  });

  it('captures global help and version flags without treating them as commands', () => {
    const helpParsed = parseCliArgs(['--help']);
    const shortHelpParsed = parseCliArgs(['-h']);
    const versionParsed = parseCliArgs(['--version']);

    expect(helpParsed.helpRequested).toBe(true);
    expect(helpParsed.command).toBeUndefined();
    expect(shortHelpParsed.helpRequested).toBe(true);
    expect(shortHelpParsed.command).toBeUndefined();
    expect(versionParsed.versionRequested).toBe(true);
    expect(versionParsed.command).toBeUndefined();
  });

  it('reports unknown options and invalid enum values', () => {
    const parsed = parseCliArgs([
      'chat',
      '--budget', 'reckless',
      '--speed', 'warp',
      '--provider', 'mystery',
      '--bogus',
      'hello',
    ]);

    expect(parsed.errors).toEqual([
      'Invalid budget mode "reckless". Expected one of: cheap, balanced, expensive, auto.',
      'Invalid speed mode "warp". Expected one of: fast, balanced, considered, auto.',
      'Unsupported provider "mystery". Expected one of: anthropic, openai, google, mistral, deepseek, zai, azure, bedrock, xai, cohere, perplexity, huggingface, nvidia, local, copilot.',
      'Unknown option: --bogus',
    ]);
  });

  it('reports missing option values and invalid daily limits', () => {
    const parsed = parseCliArgs(['chat', '--workspace', '--daily-limit-usd', '-2']);

    expect(parsed.errors).toEqual([
      'Missing value for --workspace.',
      'Invalid daily limit "-2". Expected a non-negative number.',
    ]);
  });
});

describe('resolveCliSsotRoot', () => {
  it('prefers an existing project_memory folder', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlasmind-cli-'));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, 'project_memory'), { recursive: true });

    const resolved = await resolveCliSsotRoot(root);

    expect(resolved).toBe(path.join(root, 'project_memory'));
  });

  it('does not trust a workspace-root marker layout as an SSOT root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlasmind-cli-root-'));
    tempRoots.push(root);
    await fs.writeFile(path.join(root, 'project_soul.md'), '# Project Soul\n', 'utf-8');
    await fs.mkdir(path.join(root, 'architecture'), { recursive: true });
    await fs.mkdir(path.join(root, 'decisions'), { recursive: true });
    await fs.mkdir(path.join(root, 'roadmap'), { recursive: true });

    const resolved = await resolveCliSsotRoot(root);

    expect(resolved).toBe(path.join(root, 'project_memory'));
  });
});

describe('createCliToolApprovalGate', () => {
  it('denies write-capable tools by default', async () => {
    const gate = createCliToolApprovalGate(false);

    const decision = await gate('task-1', 'file-write', { path: '/workspace/README.md', content: 'pwned' });

    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('--allow-writes');
  });

  it('continues to deny external tools even when write opt-in is enabled', async () => {
    const gate = createCliToolApprovalGate(true);

    const decision = await gate('task-2', 'web-fetch', { url: 'https://example.com' });

    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('read-only tooling');
  });

  it('allows write-capable tools only after explicit opt-in', async () => {
    const gate = createCliToolApprovalGate(true);

    const decision = await gate('task-3', 'git-commit', { message: 'test' });

    expect(decision).toEqual({ approved: true });
  });
});