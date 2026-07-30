import { describe, expect, it } from 'vitest';
import {
  digestSource,
  findStaleInstructionBlocks,
  formatSourceDigestComment,
  formatStaleReport,
  readRecordedDigest,
  type InstructionBlockKind,
} from '../../src/utils/instructionSyncCheck.ts';

const WORKFLOW: InstructionBlockKind = {
  id: 'workflow',
  label: 'GitHub workflow',
  markers: { start: '<!-- atlasmind:workflow:start -->', end: '<!-- atlasmind:workflow:end -->' },
  sourcePath: 'project_memory/operations/workflow.json',
};

const TESTING: InstructionBlockKind = {
  id: 'testing-protocols',
  label: 'Testing protocols',
  markers: {
    start: '<!-- atlasmind:testing-protocols:start -->',
    end: '<!-- atlasmind:testing-protocols:end -->',
  },
  sourcePath: 'project_memory/index/testing-config.json',
};

/** An instruction file carrying one block, stamped for `sourceText`. */
function fileWith(kind: InstructionBlockKind, sourceText: string, body = 'rules'): string {
  return [
    '# CLAUDE.md',
    '',
    'Hand-written guidance that must survive.',
    '',
    kind.markers.start,
    body,
    '',
    formatSourceDigestComment(digestSource(sourceText)),
    kind.markers.end,
    '',
    'More hand-written guidance.',
  ].join('\n');
}

describe('digestSource', () => {
  it('is stable for the same bytes and different for a change', () => {
    expect(digestSource('a')).toBe(digestSource('a'));
    expect(digestSource('a')).not.toBe(digestSource('b'));
  });

  it('notices whitespace, because a reformatted source is a changed source', () => {
    expect(digestSource('{"a":1}')).not.toBe(digestSource('{ "a": 1 }'));
  });
});

describe('readRecordedDigest', () => {
  it('reads the digest a block recorded', () => {
    const source = '{"profile":"solo"}';
    expect(readRecordedDigest(fileWith(WORKFLOW, source), WORKFLOW.markers)).toBe(digestSource(source));
  });

  it('returns undefined when the block is absent', () => {
    expect(readRecordedDigest('# just a readme', WORKFLOW.markers)).toBeUndefined();
  });

  it('returns undefined for a block written before digests were recorded', () => {
    const legacy = `${WORKFLOW.markers.start}\nold body\n${WORKFLOW.markers.end}`;
    expect(readRecordedDigest(legacy, WORKFLOW.markers)).toBeUndefined();
  });

  it('does not read another block\'s digest', () => {
    // Two blocks in one file, each with its own stamp — the realistic layout.
    const file = `${fileWith(TESTING, 'testing-source')}\n${fileWith(WORKFLOW, 'workflow-source')}`;
    expect(readRecordedDigest(file, WORKFLOW.markers)).toBe(digestSource('workflow-source'));
    expect(readRecordedDigest(file, TESTING.markers)).toBe(digestSource('testing-source'));
  });
});

describe('findStaleInstructionBlocks', () => {
  it('reports nothing when every block matches its source', () => {
    const source = '{"profile":"solo"}';
    const stale = findStaleInstructionBlocks({
      targets: [{ path: 'CLAUDE.md', text: fileWith(WORKFLOW, source) }],
      sources: new Map([[WORKFLOW.sourcePath, source]]),
      kinds: [WORKFLOW],
    });
    expect(stale).toEqual([]);
  });

  it('reports a block whose source has changed since it was written', () => {
    const stale = findStaleInstructionBlocks({
      targets: [{ path: 'CLAUDE.md', text: fileWith(WORKFLOW, '{"profile":"solo"}') }],
      sources: new Map([[WORKFLOW.sourcePath, '{"profile":"studio"}']]),
      kinds: [WORKFLOW],
    });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ path: 'CLAUDE.md', kind: 'workflow' });
    expect(stale[0]!.reason).toContain('workflow.json changed');
  });

  /**
   * The rule that keeps this check from becoming noise.
   *
   * Instruction files are opt-in per tool. Reporting "Cursor is out of date" to a
   * project that has never synced Cursor would turn adopting one tool into a
   * standing complaint about the eight you do not use — and a check that
   * complains constantly is a check that gets switched off.
   */
  it('ignores a file that does not carry the block at all', () => {
    const stale = findStaleInstructionBlocks({
      targets: [{ path: '.cursorrules', text: '# my own cursor rules, no AtlasMind block' }],
      sources: new Map([[WORKFLOW.sourcePath, '{"profile":"solo"}']]),
      kinds: [WORKFLOW],
    });
    expect(stale).toEqual([]);
  });

  it('ignores a kind whose source does not exist — nothing to be stale against', () => {
    const stale = findStaleInstructionBlocks({
      targets: [{ path: 'CLAUDE.md', text: fileWith(WORKFLOW, 'whatever') }],
      sources: new Map(),
      kinds: [WORKFLOW],
    });
    expect(stale).toEqual([]);
  });

  it('reports a block that predates digest recording, so it can be shown current', () => {
    const legacy = `# CLAUDE.md\n\n${WORKFLOW.markers.start}\nold body\n${WORKFLOW.markers.end}`;
    const stale = findStaleInstructionBlocks({
      targets: [{ path: 'CLAUDE.md', text: legacy }],
      sources: new Map([[WORKFLOW.sourcePath, '{}']]),
      kinds: [WORKFLOW],
    });
    expect(stale).toHaveLength(1);
    expect(stale[0]!.reason).toContain('no recorded digest');
  });

  it('checks every kind against every file that carries it', () => {
    const stale = findStaleInstructionBlocks({
      targets: [
        { path: 'CLAUDE.md', text: `${fileWith(TESTING, 'T-old')}\n${fileWith(WORKFLOW, 'W-now')}` },
        { path: 'AGENTS.md', text: fileWith(TESTING, 'T-now') },
      ],
      sources: new Map([[TESTING.sourcePath, 'T-now'], [WORKFLOW.sourcePath, 'W-now']]),
      kinds: [TESTING, WORKFLOW],
    });
    // Only CLAUDE.md's testing block is behind.
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ path: 'CLAUDE.md', kind: 'testing-protocols' });
  });
});

describe('formatStaleReport', () => {
  const stale = findStaleInstructionBlocks({
    targets: [{ path: 'CLAUDE.md', text: fileWith(WORKFLOW, 'old') }],
    sources: new Map([[WORKFLOW.sourcePath, 'new']]),
    kinds: [WORKFLOW],
  });

  it('is empty when nothing is stale, so the hook prints nothing', () => {
    expect(formatStaleReport([])).toBe('');
  });

  it('names the file, the block, and the command that fixes it', () => {
    const report = formatStaleReport(stale);
    expect(report).toContain('CLAUDE.md');
    expect(report).toContain('GitHub workflow');
    // "Stale" is a verdict; the command is the instruction.
    expect(report).toMatch(/Sync Testing Protocols|sync-instructions/);
  });

  it('states that nothing was modified', () => {
    // The property the whole design rests on. If this line ever stops being
    // true, the message must stop claiming it.
    expect(formatStaleReport(stale)).toMatch(/Nothing was modified/);
  });

  it('documents its own escape hatch', () => {
    // An undocumented bypass gets bypassed with --no-verify, which also
    // disables the compile, lint and test gates in the same hook.
    const report = formatStaleReport(stale);
    expect(report).toContain('ATLASMIND_SKIP_INSTRUCTION_CHECK=1');
    expect(report).toMatch(/Settings -> AI Instructions/);
  });
});
