import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  parseMergeResult,
  parseRenderResult,
  renderUnifiedMarkdown,
  gatherInstructionSources,
  detectedWritebackTools,
  applyManagedInstructionBlock,
  SHARED_INSTRUCTIONS_MARKERS,
  type MergeDirective,
} from '../../src/utils/aiInstructionMerge.js';

function tempWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'atlasmind-instr-merge-'));
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

describe('parseMergeResult', () => {
  it('parses a well-formed merge object', () => {
    const raw = JSON.stringify({
      unified: [{ id: 'd1', category: 'Style', text: 'Use spaces', sources: ['Claude Code'] }],
      autoResolved: [{ topic: 'wording', note: 'merged' }],
      conflicts: [],
    });
    const result = parseMergeResult(raw);
    expect(result.unified).toHaveLength(1);
    expect(result.unified[0]?.text).toBe('Use spaces');
    expect(result.autoResolved).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });

  it('extracts JSON wrapped in markdown code fences', () => {
    const raw = '```json\n{"unified":[{"text":"X"}],"autoResolved":[],"conflicts":[]}\n```';
    expect(parseMergeResult(raw).unified[0]?.text).toBe('X');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseMergeResult('not json at all')).toThrow();
  });

  it('throws when there are no directives or conflicts', () => {
    expect(() => parseMergeResult('{"unified":[],"autoResolved":[],"conflicts":[]}')).toThrow();
  });

  it('keeps significant multi-option conflicts and clamps the recommended index', () => {
    const raw = JSON.stringify({
      unified: [{ text: 'base' }],
      conflicts: [
        {
          id: 'c1', topic: 'Indentation', significant: true,
          options: [{ tool: 'Claude Code', directive: 'spaces' }, { tool: 'GitHub Copilot', directive: 'tabs' }],
          recommendedOptionIndex: 9,
        },
      ],
    });
    const result = parseMergeResult(raw);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.recommendedOptionIndex).toBe(1); // clamped to last option
  });

  it('drops non-significant conflicts and single-option conflicts', () => {
    const raw = JSON.stringify({
      unified: [{ text: 'base' }],
      conflicts: [
        { id: 'a', topic: 'minor', significant: false, options: [{ tool: 'X', directive: '1' }, { tool: 'Y', directive: '2' }] },
        { id: 'b', topic: 'one-sided', significant: true, options: [{ tool: 'X', directive: 'only' }] },
      ],
    });
    expect(parseMergeResult(raw).conflicts).toHaveLength(0);
  });
});

describe('parseRenderResult', () => {
  it('extracts a markdown block per requested tool and ignores the rest', () => {
    const raw = JSON.stringify({ 'Claude Code': '## A', 'GitHub Copilot': '## B', Unwanted: '## C' });
    const out = parseRenderResult(raw, ['Claude Code', 'GitHub Copilot']);
    expect(out).toEqual({ 'Claude Code': '## A', 'GitHub Copilot': '## B' });
  });

  it('returns an empty map on malformed JSON', () => {
    expect(parseRenderResult('garbage', ['Claude Code'])).toEqual({});
  });
});

describe('renderUnifiedMarkdown', () => {
  it('groups directives by category and lists each', () => {
    const unified: MergeDirective[] = [
      { id: '1', category: 'Style', text: 'Use spaces', sources: [] },
      { id: '2', category: 'Style', text: 'Max width 100', sources: [] },
      { id: '3', category: 'Commits', text: 'Conventional commits', sources: [] },
    ];
    const md = renderUnifiedMarkdown(unified);
    expect(md).toContain('### Style');
    expect(md).toContain('- Use spaces');
    expect(md).toContain('### Commits');
    expect(md).toContain('- Conventional commits');
  });
});

describe('gatherInstructionSources / detectedWritebackTools', () => {
  let root: string;
  beforeEach(() => { root = tempWorkspace(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('collects authored content and strips AtlasMind-managed blocks', () => {
    write(
      root,
      'CLAUDE.md',
      `# Claude rules\n\nUse spaces.\n\n${SHARED_INSTRUCTIONS_MARKERS.start}\n## mirror (should be stripped)\n- old\n${SHARED_INSTRUCTIONS_MARKERS.end}\n`,
    );
    write(root, '.github/copilot-instructions.md', '# Copilot rules\n\nUse tabs.');

    const sources = gatherInstructionSources(root);
    const claude = sources.find(s => s.relativePath === 'CLAUDE.md');
    expect(claude).toBeDefined();
    expect(claude?.content).toContain('Use spaces.');
    expect(claude?.content).not.toContain('should be stripped');
    expect(sources.some(s => s.tool === 'GitHub Copilot')).toBe(true);
  });

  it('includes AtlasMind\'s own personality profile as a source', () => {
    write(root, 'CLAUDE.md', 'rules');
    write(root, 'project_memory/agents/atlas-personality-profile.md', '# Atlas\n\nBe concise.');
    const sources = gatherInstructionSources(root);
    const atlas = sources.find(s => s.tool === 'AtlasMind');
    expect(atlas).toBeDefined();
    expect(atlas?.content).toContain('Be concise.');
  });

  it('detects writeback tools from existing markdown files only', () => {
    write(root, 'CLAUDE.md', 'rules');
    write(root, 'AGENTS.md', 'rules');
    const tools = detectedWritebackTools(root);
    expect(tools).toContain('Claude Code');
    expect(tools).toContain('OpenAI Codex');
    expect(tools).not.toContain('Cursor');
  });
});

describe('applyManagedInstructionBlock', () => {
  let root: string;
  beforeEach(() => { root = tempWorkspace(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reports detected markdown files as updated and JSON configs as skipped', async () => {
    write(root, 'CLAUDE.md', '# Claude\n\nrules');
    write(root, '.continue/config.json', '{"systemMessage":"x"}');
    const unified: MergeDirective[] = [{ id: '1', category: 'General', text: 'Do the thing', sources: [] }];

    const result = await applyManagedInstructionBlock(root, {}, unified);
    expect(result.updated).toContain('CLAUDE.md');
    expect(result.skipped.some(s => s.path === '.continue/config.json')).toBe(true);
  });

  it('does not touch files that do not exist', async () => {
    const unified: MergeDirective[] = [{ id: '1', category: 'General', text: 'x', sources: [] }];
    const result = await applyManagedInstructionBlock(root, {}, unified);
    expect(result.updated).toHaveLength(0);
  });
});
