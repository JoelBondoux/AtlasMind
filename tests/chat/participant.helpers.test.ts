import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import {
  buildFollowups,
  diffWorkspaceSnapshots,
  estimateTouchedFiles,
  getProjectUiConfig,
  summarizeChangedFiles,
} from '../../src/chat/participant.ts';

function makeSnapshotEntry(relativePath: string, signature: string) {
  return {
    signature,
    relativePath,
    uri: { fsPath: `C:/workspace/${relativePath}` },
  };
}

describe('participant helper logic', () => {
  it('returns project-specific followups', () => {
    const followups = buildFollowups('project');
    expect(followups.map(f => f.label)).toEqual([
      'Review session cost',
      'Save plan to memory',
      'Run another project',
    ]);
  });

  it('returns default followups for freeform requests', () => {
    const followups = buildFollowups(undefined);
    expect(followups.map(f => f.label)).toContain('Turn this into a full project');
  });

  it('reads valid project UI settings and floors them to positive integers', () => {
    const configuration = {
      get: vi.fn((key: string) => {
        const values: Record<string, number> = {
          projectApprovalFileThreshold: 18.9,
          projectEstimatedFilesPerSubtask: 3.2,
          projectChangedFileReferenceLimit: 7.8,
        };
        return values[key];
      }),
    };

    expect(getProjectUiConfig(configuration)).toEqual({
      approvalFileThreshold: 18,
      estimatedFilesPerSubtask: 3,
      changedFileReferenceLimit: 7,
    });
  });

  it('falls back to defaults when project UI settings are invalid', () => {
    const configuration = {
      get: vi.fn((key: string) => {
        const values: Record<string, number> = {
          projectApprovalFileThreshold: 0,
          projectEstimatedFilesPerSubtask: -1,
          projectChangedFileReferenceLimit: Number.NaN,
        };
        return values[key];
      }),
    };

    expect(getProjectUiConfig(configuration)).toEqual({
      approvalFileThreshold: 12,
      estimatedFilesPerSubtask: 2,
      changedFileReferenceLimit: 5,
    });
  });

  it('estimates touched files using the configured multiplier', () => {
    expect(estimateTouchedFiles(4, 3)).toBe(12);
    expect(estimateTouchedFiles(0, 3)).toBe(1);
    expect(estimateTouchedFiles(2, 0)).toBe(2);
  });

  it('diffs snapshots into created, modified, and deleted files', () => {
    const baseline = new Map([
      ['a.ts', makeSnapshotEntry('a.ts', '1:10')],
      ['b.ts', makeSnapshotEntry('b.ts', '1:10')],
    ]);
    const current = new Map([
      ['a.ts', makeSnapshotEntry('a.ts', '2:10')],
      ['c.ts', makeSnapshotEntry('c.ts', '1:10')],
    ]);

    expect(diffWorkspaceSnapshots(baseline, current)).toEqual([
      {
        relativePath: 'a.ts',
        status: 'modified',
        uri: { fsPath: 'C:/workspace/a.ts' },
      },
      {
        relativePath: 'b.ts',
        status: 'deleted',
      },
      {
        relativePath: 'c.ts',
        status: 'created',
        uri: { fsPath: 'C:/workspace/c.ts' },
      },
    ]);
  });

  it('summarizes changed file counts by status', () => {
    expect(summarizeChangedFiles([
      { relativePath: 'a.ts', status: 'created' },
      { relativePath: 'b.ts', status: 'modified' },
      { relativePath: 'c.ts', status: 'modified' },
      { relativePath: 'd.ts', status: 'deleted' },
    ])).toBe('created 1, modified 2, deleted 1');
  });
});
