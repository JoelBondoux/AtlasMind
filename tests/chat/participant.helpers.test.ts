import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import {
  addFileAttribution,
  buildAssistantResponseMetadata,
  buildProjectRunSummary,
  buildProjectResponseMetadata,
  buildFollowups,
  diffWorkspaceSnapshots,
  estimateTouchedFiles,
  extractImagePathCandidates,
  getProjectUiConfig,
  isAutonomousContinuationPrompt,
  mergeImageAttachments,
  resolveAutonomousContinuationGoal,
  resolveProjectExecutionGoal,
  renderAssistantResponseFooter,
  summarizeChangedFiles,
  toApprovedProjectPrompt,
  toSerializableAttribution,
  type ProjectRunOutcome,
} from '../../src/chat/participant.ts';
import type { TaskImageAttachment } from '../../src/types.ts';
import type { SessionTranscriptEntry } from '../../src/chat/sessionConversation.ts';

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

  it('detects short autonomous continuation prompts', () => {
    expect(isAutonomousContinuationPrompt('Proceed autonomously')).toBe(true);
    expect(isAutonomousContinuationPrompt('continue on the approval workflow')).toBe(true);
    expect(isAutonomousContinuationPrompt('Explain how autonomous runs work')).toBe(false);
  });

  it('reuses the latest substantive user prompt for autonomous continuation', () => {
    const transcript: SessionTranscriptEntry[] = [
      {
        id: '1',
        role: 'user',
        content: 'When AtlasMind prompts for tool use it should offer Bypass Approvals and Autopilot.',
        timestamp: '2026-04-05T10:00:00.000Z',
      },
      {
        id: '2',
        role: 'assistant',
        content: 'I will inspect the approval flow and implement it.',
        timestamp: '2026-04-05T10:00:10.000Z',
      },
    ];

    expect(resolveAutonomousContinuationGoal('Proceed autonomously', transcript)).toBe(
      'When AtlasMind prompts for tool use it should offer Bypass Approvals and Autopilot.',
    );
  });

  it('appends follow-up detail when continuing autonomously', () => {
    const transcript: SessionTranscriptEntry[] = [
      {
        id: '1',
        role: 'user',
        content: 'Wire ToolApprovalManager into the live tool gate.',
        timestamp: '2026-04-05T10:00:00.000Z',
      },
    ];

    expect(resolveAutonomousContinuationGoal('Continue on the approval workflow', transcript)).toBe(
      'Wire ToolApprovalManager into the live tool gate.\n\nAdditional execution instruction: the approval workflow',
    );
  });

  it('extracts explicit project goals for project execution routing', () => {
    expect(resolveProjectExecutionGoal('/project Implement approval bypasses', [])).toBe(
      'Implement approval bypasses',
    );
  });

  it('normalizes approved project prompts', () => {
    expect(toApprovedProjectPrompt('Implement approval bypasses')).toBe(
      'Implement approval bypasses --approve',
    );
  });

  it('builds assistant metadata with model and execution details', () => {
    const metadata = buildAssistantResponseMetadata(
      'Review the workspace and update the docs',
      {
        modelUsed: 'copilot/gpt-4.1',
        artifacts: {
          output: 'done',
          outputPreview: 'done',
          toolCallCount: 2,
          toolCalls: [],
          verificationSummary: 'npm run compile passed',
          checkpointedTools: ['writeFile'],
        },
      },
      { hasSessionContext: true },
    );

    expect(metadata.modelUsed).toBe('copilot/gpt-4.1');
    expect(metadata.thoughtSummary?.summary).toContain('copilot/gpt-4.1');
    expect(metadata.thoughtSummary?.bullets).toContain('Tool loop used 2 call(s).');
    expect(metadata.thoughtSummary?.bullets).toContain('Included recent session context when routing the response.');
    expect(metadata.thoughtSummary?.bullets).toContain('Checkpointed tools: writeFile.');
  });

  it('renders an assistant footer with model and thinking summary', () => {
    const footer = renderAssistantResponseFooter({
      modelUsed: 'copilot/gpt-4.1',
      thoughtSummary: {
        label: 'Thinking summary',
        summary: 'High-reasoning code task routed to copilot/gpt-4.1.',
        bullets: ['Tool loop used 1 call(s).'],
      },
    });

    expect(footer).toContain('_Model: copilot/gpt-4.1_');
    expect(footer).toContain('**Thinking summary:** High-reasoning code task routed to copilot/gpt-4.1.');
    expect(footer).toContain('- Tool loop used 1 call(s).');
  });

  it('describes project mode as multiple routed models', () => {
    const metadata = buildProjectResponseMetadata('Ship the new chat bubble metadata');

    expect(metadata.modelUsed).toBe('multiple routed models');
    expect(metadata.thoughtSummary?.summary).toContain('different models');
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
      runReportFolder: 'project_memory/operations',
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
      runReportFolder: 'project_memory/operations',
    });
  });

  it('uses explicit run report folder setting when provided', () => {
    const configuration = {
      get: vi.fn((key: string) => {
        const values: Record<string, unknown> = {
          projectApprovalFileThreshold: 12,
          projectEstimatedFilesPerSubtask: 2,
          projectChangedFileReferenceLimit: 5,
          projectRunReportFolder: 'project_memory/custom_reports',
        };
        return values[key] as string | number;
      }),
    };

    expect(getProjectUiConfig(configuration)).toEqual({
      approvalFileThreshold: 12,
      estimatedFilesPerSubtask: 2,
      changedFileReferenceLimit: 5,
      runReportFolder: 'project_memory/custom_reports',
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

  it('tracks and serializes file attribution by subtask title', () => {
    const attribution = new Map<string, Set<string>>();
    addFileAttribution(attribution, 'Scaffold API', [
      { relativePath: 'src/api.ts', status: 'created' },
      { relativePath: 'src/routes.ts', status: 'modified' },
    ]);
    addFileAttribution(attribution, 'Add tests', [
      { relativePath: 'src/api.ts', status: 'modified' },
      { relativePath: 'tests/api.test.ts', status: 'created' },
    ]);

    expect(toSerializableAttribution(attribution)).toEqual({
      'src/api.ts': ['Add tests', 'Scaffold API'],
      'src/routes.ts': ['Scaffold API'],
      'tests/api.test.ts': ['Add tests'],
    });
  });

  it('builds a stable project run summary payload', () => {
    const summary = buildProjectRunSummary(
      {
        id: 'plan-1',
        goal: 'Build feature X',
        subTaskResults: [
          {
            subTaskId: 'api',
            title: 'Build API',
            status: 'completed',
            output: 'done',
            costUsd: 0.1,
            durationMs: 1000,
          },
        ],
        synthesis: 'final',
        totalCostUsd: 0.1,
        totalDurationMs: 1000,
      },
      [{ relativePath: 'src/api.ts', status: 'created' }],
      new Map<string, Set<string>>([
        ['src/api.ts', new Set(['Build API'])],
      ]),
      '2026-04-03T10:00:00.000Z',
    );

    expect(summary.id).toBe('plan-1');
    expect(summary.goal).toBe('Build feature X');
    expect(summary.startedAt).toBe('2026-04-03T10:00:00.000Z');
    expect(summary.fileAttribution).toEqual({ 'src/api.ts': ['Build API'] });
    expect(summary.subTaskResults).toHaveLength(1);
    expect(summary.subTaskArtifacts).toEqual([
      expect.objectContaining({
        subTaskId: 'api',
        title: 'Build API',
        status: 'completed',
        toolCallCount: 0,
        changedFiles: [],
      }),
    ]);
  });

  // -- Outcome-aware follow-ups -------------------------------------------

  it('returns failure-oriented followups when project has failures', () => {
    const outcome: ProjectRunOutcome = {
      hasFailures: true,
      hasChangedFiles: true,
      failedSubtaskTitles: ['Build API'],
    };
    const followups = buildFollowups('project', outcome);
    const labels = followups.map(f => f.label);
    expect(labels).toContain('Retry the project');
    expect(labels).toContain('Diagnose failures');
  });

  it('returns change-aware followups when project changed files without failures', () => {
    const outcome: ProjectRunOutcome = {
      hasFailures: false,
      hasChangedFiles: true,
      failedSubtaskTitles: [],
    };
    const followups = buildFollowups('project', outcome);
    expect(followups.map(f => f.label)).toContain('Add tests');
  });

  it('returns default project followups when run succeeded with no file changes', () => {
    const outcome: ProjectRunOutcome = {
      hasFailures: false,
      hasChangedFiles: false,
      failedSubtaskTitles: [],
    };
    const followups = buildFollowups('project', outcome);
    expect(followups.map(f => f.label)).toContain('Run another project');
  });

  it('returns default project followups when no outcome is provided', () => {
    const followups = buildFollowups('project');
    expect(followups.map(f => f.label)).toEqual([
      'Review session cost',
      'Save plan to memory',
      'Run another project',
    ]);
  });

  // -- Edge-case gating -------------------------------------------------------

  it('summarizes an empty changed file list as all-zero counts', () => {
    expect(summarizeChangedFiles([])).toBe('created 0, modified 0, deleted 0');
  });

  it('approval threshold: estimateTouchedFiles exceeds default threshold with 10 subtasks', () => {
    const config = getProjectUiConfig({ get: vi.fn().mockReturnValue(undefined) });
    const estimated = estimateTouchedFiles(10, config.estimatedFilesPerSubtask);
    // 10 subtasks × 2 files default = 20, which exceeds the default threshold of 12
    expect(estimated).toBeGreaterThan(config.approvalFileThreshold);
  });

  it('no-op run: estimateTouchedFiles is within default threshold with 2 subtasks', () => {
    const config = getProjectUiConfig({ get: vi.fn().mockReturnValue(undefined) });
    const estimated = estimateTouchedFiles(2, config.estimatedFilesPerSubtask);
    // 2 × 2 = 4, well within the default threshold of 12
    expect(estimated).toBeLessThanOrEqual(config.approvalFileThreshold);
  });

  it('extracts inline image path candidates from quoted and unquoted prompt text', () => {
    expect(extractImagePathCandidates(
      'Please inspect "media/mockup.png" and screenshots/home page.jpg plus docs/diagram.webp',
    )).toEqual([
      'media/mockup.png',
      'screenshots/home page.jpg',
      'docs/diagram.webp',
    ]);
  });

  it('merges explicit and inline image attachments without duplicates', () => {
    const explicit: TaskImageAttachment[] = [
      { source: 'media/mockup.png', mimeType: 'image/png', dataBase64: 'abc' },
    ];
    const inline: TaskImageAttachment[] = [
      { source: 'media/mockup.png', mimeType: 'image/png', dataBase64: 'abc' },
      { source: 'docs/diagram.webp', mimeType: 'image/webp', dataBase64: 'def' },
    ];

    expect(mergeImageAttachments(explicit, inline)).toEqual([
      { source: 'media/mockup.png', mimeType: 'image/png', dataBase64: 'abc' },
      { source: 'docs/diagram.webp', mimeType: 'image/webp', dataBase64: 'def' },
    ]);
  });

  it('falls back to follow-up detail when no prior substantive user prompt exists', () => {
    expect(resolveAutonomousContinuationGoal('Continue on tests', [])).toBe('tests');
  });
});
