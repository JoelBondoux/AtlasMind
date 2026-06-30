import { describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => ({
  workspaceFolders: undefined as unknown,
  getConfiguration: vi.fn(() => ({
    get: (key: string, fallback?: unknown) => key === 'displayCurrency' ? 'USD' : fallback,
  })),
}));

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return vscodeMock.workspaceFolders;
    },
    set workspaceFolders(value: unknown) {
      vscodeMock.workspaceFolders = value;
    },
    getConfiguration: vscodeMock.getConfiguration,
  },
}));

import {
  addFileAttribution,
  buildRoadmapStatusMarkdown,
  buildRoadmapStatusResult,
  buildAssistantResponseMetadata,
  buildProjectRunSubTaskArtifacts,
  buildProjectRunSummary,
  buildProjectResponseMetadata,
  buildFollowups,
  diffWorkspaceSnapshots,
  ensureAssistantVisibleResponse,
  estimateTouchedFiles,
  extractImagePathCandidates,
  getProjectUiConfig,
  detectUserFrustrationSignal,
  isAutonomousContinuationPrompt,
  isRoadmapPlanIntent,
  isRoadmapStatusPrompt,
  mergeImageAttachments,
  reconcileAssistantResponse,
  resolveAutonomousContinuationGoal,
  resolveAtlasChatIntent,
  resolveProjectExecutionGoal,
  extractAssistantProposedAction,
  renderAssistantResponseFooter,
  shouldCarryForwardConversationContext,
  prepareProjectRunContext,
  summarizeChangedFiles,
  summarizeRoadmapStatus,
  toApprovedProjectPrompt,
  toSerializableAttribution,
  detectResponseQuickReplies,
  detectProjectRunProposal,
  buildProjectRunAutoFlowNotice,
  resolveProjectRunAutoFlow,
  type ProjectRunOutcome,
} from '../../src/chat/participant.ts';
import type { TaskImageAttachment } from '../../src/types.ts';
import type { SessionTranscriptEntry } from '../../src/chat/sessionConversation.ts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

function makeSnapshotEntry(relativePath: string, signature: string) {
  return {
    signature,
    relativePath,
    uri: { fsPath: `C:/workspace/${relativePath}` },
  };
}

describe('detectResponseQuickReplies', () => {
  it('builds pick-one pills for a 3-option enumerated question', () => {
    const result = detectResponseQuickReplies(
      'Where should we start: batch concurrency, Shopify sync, or edge cases?',
    );
    expect(result?.quickReplies?.map(r => r.label)).toEqual(['Batch concurrency', 'Shopify sync', 'Edge cases']);
    expect(result?.quickReplies?.map(r => r.prompt)).toEqual(['batch concurrency', 'Shopify sync', 'edge cases']);
  });

  it('still handles the two-option case', () => {
    const result = detectResponseQuickReplies('Should I raise the limit or skip the subtask?');
    expect(result?.quickReplies).toHaveLength(2);
  });

  it('handles yes/no questions', () => {
    const result = detectResponseQuickReplies('Do you want me to proceed?');
    expect(result?.quickReplies?.map(r => r.prompt)).toEqual(['yes', 'no']);
  });

  it('does not fabricate pills for a prose question with no clean options', () => {
    const result = detectResponseQuickReplies('What is the overall architecture of this project?');
    expect(result?.quickReplies).toBeUndefined();
    expect(result?.followupQuestion).toBeTruthy();
  });

  it('returns nothing when the response does not end with a question', () => {
    expect(detectResponseQuickReplies('Here is the final answer. All done.')).toBeUndefined();
  });

  it('builds pick-one pills from a numbered list that follows the question', () => {
    const result = detectResponseQuickReplies(
      'Which would you like to tackle first?\n\n1. Batch concurrency\n2. Shopify sync\n3. Edge cases',
    );
    expect(result?.quickReplies?.map(r => r.label)).toEqual(['Batch concurrency', 'Shopify sync', 'Edge cases']);
  });

  it('builds pick-one pills from a bulleted list that precedes the question', () => {
    const result = detectResponseQuickReplies(
      'Here are the options:\n\n- Raise the limit\n- Skip the subtask\n\nWhich would you prefer?',
    );
    expect(result?.quickReplies?.map(r => r.label)).toEqual(['Raise the limit', 'Skip the subtask']);
  });

  it('keeps a yes/no question above a findings list as yes/no (not pick-one)', () => {
    const result = detectResponseQuickReplies(
      'I found two issues:\n\n- Bug A\n- Bug B\n\nShould I fix them?',
    );
    expect(result?.quickReplies?.map(r => r.prompt)).toEqual(['yes', 'no']);
  });

  it('recognises broadened yes/no openers and confirmation tails', () => {
    expect(detectResponseQuickReplies('Should we ship it?')?.quickReplies?.map(r => r.prompt)).toEqual(['yes', 'no']);
    expect(detectResponseQuickReplies('I refactored the module. Does that sound good?')?.quickReplies?.map(r => r.prompt)).toEqual(['yes', 'no']);
  });

  it('does not fabricate pick-one pills for an open question above a list', () => {
    const result = detectResponseQuickReplies(
      'Some thoughts:\n\n- Idea A\n- Idea B\n\nWhat do you think?',
    );
    expect(result?.quickReplies).toBeUndefined();
    expect(result?.followupQuestion).toBe('What do you think?');
  });

  it('detects a trailing question even when wrapped in markdown emphasis', () => {
    const result = detectResponseQuickReplies(
      'Done. **Which would you like next: tests, docs, or cleanup?**',
    );
    expect(result?.quickReplies?.map(r => r.label)).toEqual(['Tests', 'Docs', 'Cleanup']);
  });
});

describe('participant helper logic', () => {
  it('loads the session SSOT bundle for project execution context', async () => {
    const sessionContextManager = {
      loadContext: vi.fn().mockResolvedValue({
        goal: 'Fix the auth redirect regression',
        summary: 'The failing redirect path was isolated in the login handler.',
        decisions: 'Add a regression test before changing redirect logic.',
        openThreads: 'Need to confirm the expected redirect target.',
        ssotExcerpts: ['architecture/auth-flow.md'],
        loadedAt: '2026-05-01T12:00:00.000Z',
      }),
    };
    const sessionConversation = {
      buildContext: vi.fn(() => 'legacy session context'),
    };

    const context = await prepareProjectRunContext({
      sessionContextManager,
      sessionConversation,
    } as never, 'session-1');

    expect(sessionContextManager.loadContext).toHaveBeenCalledWith('session-1');
    expect(context.sessionContextBundle?.summary).toContain('login handler');
    expect(context.sessionContext).toBe('');
    expect(sessionConversation.buildContext).not.toHaveBeenCalled();
  });

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

  it('returns explicit execution-choice followups when assistant metadata provides them', () => {
    const followups = buildFollowups(undefined, undefined, [
      { label: 'Fix This', prompt: 'Fix this issue in the workspace.' },
      { label: 'Explain Only', prompt: 'Explain only.' },
    ]);

    expect(followups.map(f => f.label)).toEqual(['Fix This', 'Explain Only']);
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

  it('uses the assistant proposed action when the user affirms an offer instead of the prior question', () => {
    const transcript: SessionTranscriptEntry[] = [
      {
        id: '1',
        role: 'user',
        content: 'what is the most important one of these items to address?',
        timestamp: '2026-06-14T10:00:00.000Z',
      },
      {
        id: '2',
        role: 'assistant',
        content:
          'Reapply the Customer ID requirement is the single most important action. '
          + 'Want me to start by finding where customerID was hidden and drafting the reapplication?',
        timestamp: '2026-06-14T10:00:05.000Z',
      },
    ];

    // Bug regression: a bare "yes" must run the assistant's proposed action, not re-run
    // the user's earlier question (which previously became the autonomous goal).
    expect(resolveAutonomousContinuationGoal('yes', transcript)).toBe(
      'start by finding where customerID was hidden and drafting the reapplication',
    );
  });

  it('skips a bare user question and falls back to an earlier actionable prompt when there is no offer', () => {
    const transcript: SessionTranscriptEntry[] = [
      {
        id: '1',
        role: 'user',
        content: 'Add a customer ID validation guard to the checkout flow.',
        timestamp: '2026-06-14T10:00:00.000Z',
      },
      {
        id: '2',
        role: 'assistant',
        content: 'The checkout flow lives in src/checkout.ts.',
        timestamp: '2026-06-14T10:00:05.000Z',
      },
      {
        id: '3',
        role: 'user',
        content: 'what is the riskiest part of that change?',
        timestamp: '2026-06-14T10:00:10.000Z',
      },
      {
        id: '4',
        role: 'assistant',
        content: 'The riskiest part is the session token handling.',
        timestamp: '2026-06-14T10:00:15.000Z',
      },
    ];

    expect(resolveAutonomousContinuationGoal('go ahead', transcript)).toBe(
      'Add a customer ID validation guard to the checkout flow.',
    );
  });

  it('extracts a first-person assistant offer as the proposed action', () => {
    expect(
      extractAssistantProposedAction([
        {
          id: '1',
          role: 'assistant',
          content: 'Here is the plan. Shall I wire the approval gate into the live tool path?',
          timestamp: '2026-06-14T10:00:00.000Z',
        },
      ]),
    ).toBe('wire the approval gate into the live tool path');
  });

  it('returns no proposed action when the last assistant turn made no actionable offer', () => {
    expect(
      extractAssistantProposedAction([
        {
          id: '1',
          role: 'assistant',
          content: 'The change is complete and tests pass.',
          timestamp: '2026-06-14T10:00:00.000Z',
        },
      ]),
    ).toBeUndefined();

    // A non-offer question ("Does that look correct?") is not an executable proposal.
    expect(
      extractAssistantProposedAction([
        {
          id: '2',
          role: 'assistant',
          content: 'Does that look correct to you?',
          timestamp: '2026-06-14T10:00:00.000Z',
        },
      ]),
    ).toBeUndefined();
  });

  it('extracts explicit project goals for project execution routing', () => {
    expect(resolveProjectExecutionGoal('/project Implement approval bypasses', [])).toBe(
      'Implement approval bypasses',
    );
  });

  it('recognizes natural-language requests to start a project run', () => {
    expect(resolveAtlasChatIntent('Start a project run to refactor the auth workflow', [])).toEqual({
      kind: 'project',
      goal: 'refactor the auth workflow',
    });
  });

  it('recognizes natural-language requests to open AtlasMind settings surfaces', () => {
    expect(resolveAtlasChatIntent('Open AtlasMind Settings', [])).toEqual({
      kind: 'command',
      commandId: 'atlasmind.openSettings',
      summary: 'Opened AtlasMind Settings.',
    });
    expect(resolveAtlasChatIntent('Open the AtlasMind cost panel', [])).toEqual({
      kind: 'command',
      commandId: 'atlasmind.openCostDashboard',
      summary: 'Opened the AtlasMind Cost Dashboard.',
    });
    expect(resolveAtlasChatIntent('Open the AtlasMind ideation board', [])).toEqual({
      kind: 'command',
      commandId: 'atlasmind.openProjectIdeation',
      summary: 'Opened the AtlasMind Project Ideation workspace.',
    });
    expect(resolveAtlasChatIntent('Open Specialist Integrations', [])).toBeUndefined();
  });

  it('routes image-generation requests to the specialist integrations workflow', () => {
    expect(resolveAtlasChatIntent('Create an image for an alternative logo suggestion', [])).toBeUndefined();
  });

  it('does not misclassify code-oriented image component requests as specialist image generation', () => {
    expect(resolveAtlasChatIntent('Create a React image component for the settings page', [])).toBeUndefined();
  });


  it('keeps conversation context for explicit follow-up prompts', () => {
    const transcript: SessionTranscriptEntry[] = [
      {
        id: '1',
        role: 'user',
        content: 'Investigate why the Dependabot dependency updates are not merging cleanly.',
        timestamp: '2026-04-08T04:00:00.000Z',
      },
    ];

    expect(shouldCarryForwardConversationContext('Based on the above, fix that in the workspace.', transcript)).toBe(true);
  });

  it('drops stale conversation context for strong subject changes', () => {
    const transcript: SessionTranscriptEntry[] = [
      {
        id: '1',
        role: 'user',
        content: 'Investigate why the Dependabot dependency updates are not merging cleanly.',
        timestamp: '2026-04-08T04:00:00.000Z',
      },
    ];

    expect(shouldCarryForwardConversationContext('Create an image for an alternative logo suggestion.', transcript)).toBe(false);
  });

  it('recognizes roadmap status prompts', () => {
    expect(isRoadmapStatusPrompt('what are the outstanding roadmap items we need to address?')).toBe(true);
    expect(isRoadmapStatusPrompt('explain the roadmap philosophy')).toBe(false);
  });

  it('summarizes roadmap progress using the same counting style as the dashboard', () => {
    const snapshot = summarizeRoadmapStatus([
      {
        path: 'project_memory/roadmap/improvement-plan.md',
        content: ['- ✅ done item', '- pending item', '1. [x] numbered complete', '2. numbered pending'].join('\n'),
      },
    ]);

    expect(snapshot.completed).toBe(2);
    expect(snapshot.total).toBe(4);
    expect(snapshot.outstanding.map(item => item.text)).toEqual(['pending item', 'numbered pending']);
    expect(snapshot.questions).toEqual([]);
  });

  it('poses only unspecified profile fields as questions (clarify-style items stay tasks)', () => {
    const snapshot = summarizeRoadmapStatus([
      {
        path: 'project_memory/roadmap/improvement-plan.md',
        content: [
          '- Project: lookdesigner-pro',
          '- Project type: Unspecified',
          '- Target audience: Unspecified',
          '- Tech stack: C#',
          '- [ ] Clarify the next highest-value user or business outcome.',
          '- [ ] Harden auth token validation',
        ].join('\n'),
      },
    ]);

    // Resolved metadata (Project name, Tech stack) is excluded; only clean profile gaps are questions.
    expect(snapshot.questions.map(question => question.fieldLabel)).toEqual(['Project type', 'Target audience']);
    expect(snapshot.questions[0].question).toBe('What type of project is this?');
    // Clarify-style items are no longer mangled into questions — they remain outstanding tasks.
    expect(snapshot.outstanding.map(item => item.text)).toEqual([
      'Clarify the next highest-value user or business outcome.',
      'Harden auth token validation',
    ]);
    expect(snapshot.total).toBe(4); // 2 questions + 2 tasks, 0 completed
  });

  it('excludes scaffold/legend lines outside the managed backlog block', () => {
    const snapshot = summarizeRoadmapStatus([
      {
        path: 'project_memory/roadmap/improvement-plan.md',
        content: [
          '## Project Context',
          '- Project type: Unspecified',
          '- Tech stack: C#',
          '## Prioritized Backlog',
          '<!-- atlasmind:roadmap-items:start -->',
          '- [ ] Real backlog task one',
          '- [ ] Real backlog task two',
          '<!-- atlasmind:roadmap-items:end -->',
          '## Prioritisation Notes',
          '1. Critical, security, reliability, or production-blocking work.',
          '2. Architectural integrity and changes that unlock safer future work.',
        ].join('\n'),
      },
    ]);

    // Only items inside the managed block count as outstanding; legend numbers are dropped.
    expect(snapshot.outstanding.map(item => item.text)).toEqual(['Real backlog task one', 'Real backlog task two']);
    // The profile gap outside the block is still posed as a question; resolved metadata is excluded.
    expect(snapshot.questions.map(question => question.fieldLabel)).toEqual(['Project type']);
    expect(snapshot.total).toBe(3); // 2 tasks + 1 question
  });

  it('excludes shipped release-history notes from the outstanding tally', () => {
    const snapshot = summarizeRoadmapStatus([
      {
        path: 'project_memory/roadmap/improvement-plan.md',
        content: ['- [ ] Real open task'].join('\n'),
      },
      {
        path: 'project_memory/roadmap/release-history.md',
        content: ['- **Shipped a thing.** Already done.', '- **Shipped another thing.**'].join('\n'),
      },
    ]);

    expect(snapshot.outstanding.map(item => item.text)).toEqual(['Real open task']);
    expect(snapshot.total).toBe(1);
    expect(snapshot.questions).toEqual([]);
  });

  it('builds a live roadmap status response from roadmap files on disk', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-roadmap-'));
    const roadmapRoot = path.join(tempRoot, 'project_memory', 'roadmap');
    mkdirSync(roadmapRoot, { recursive: true });
    writeFileSync(path.join(roadmapRoot, 'improvement-plan.md'), ['- ✅ shipped milestone', '- pending milestone'].join('\n'));
    writeFileSync(path.join(roadmapRoot, 'provider-followups.md'), ['1. pending provider task'].join('\n'));

    const originalFolders = (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [{ uri: { fsPath: tempRoot, path: tempRoot } }];
    (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = () => ({
      get: (_key: string, fallback?: unknown) => fallback,
    } as never);

    try {
      const markdown = await buildRoadmapStatusMarkdown('what are the outstanding roadmap items we need to address?');
      expect(markdown).toContain('**1/3** roadmap item(s) marked complete');
      expect(markdown).toContain('**2**.');
      expect(markdown).toContain('project_memory/roadmap/improvement-plan.md');
      expect(markdown).toContain('pending milestone');
      expect(markdown).toContain('pending provider task');
    } finally {
      (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = originalFolders;
      (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = originalGetConfiguration;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('surfaces answerable questions and prefill chips in the roadmap status result', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-roadmap-questions-'));
    const roadmapRoot = path.join(tempRoot, 'project_memory', 'roadmap');
    mkdirSync(roadmapRoot, { recursive: true });
    writeFileSync(
      path.join(roadmapRoot, 'improvement-plan.md'),
      [
        '- Project type: Unspecified',
        '- Timeline: Unspecified',
        '- [ ] Tighten the core implementation',
      ].join('\n'),
    );

    const originalFolders = (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [{ uri: { fsPath: tempRoot, path: tempRoot } }];
    (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = () => ({
      get: (_key: string, fallback?: unknown) => fallback,
    } as never);

    try {
      const result = await buildRoadmapStatusResult('what are the outstanding roadmap items we need to address?');
      expect(result).toBeDefined();
      expect(result?.questions.map(question => question.fieldLabel)).toEqual(['Project type', 'Timeline']);
      expect(result?.markdown).toContain('#### Questions to unblock the plan');
      expect(result?.markdown).toContain('What type of project is this?');
      expect(result?.markdown).toContain('Open questions you can answer now: **2**');
      // The genuine task is still listed, without a redundant double checkbox.
      expect(result?.markdown).toContain('Tighten the core implementation');
      expect(result?.markdown).not.toContain('— [ ] Tighten');
      // A single combined "Answer all" chip pre-fills every gap at once.
      expect(result?.prefills).toHaveLength(1);
      expect(result?.prefills[0].label).toBe('Answer all 2 questions');
      expect(result?.prefills[0].template).toContain('Project type: ');
      expect(result?.prefills[0].template).toContain('Timeline: ');
      expect(typeof result?.prefills[0].cursorOffset).toBe('number');
    } finally {
      (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = originalFolders;
      (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = originalGetConfiguration;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('classifies plan/build intent vs explicit status requests', () => {
    expect(isRoadmapPlanIntent('Plan the fastest safe route to a minimum viable product')).toBe(true);
    expect(isRoadmapPlanIntent('Build the roadmap to MVP')).toBe(true);
    // Explicit status words win, even when "plan" appears.
    expect(isRoadmapPlanIntent('what are the outstanding roadmap items in the plan?')).toBe(false);
    expect(isRoadmapPlanIntent('show roadmap progress')).toBe(false);
  });

  it('asks only the blocking gaps for a plan request and omits the checklist dump', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-roadmap-plan-'));
    const roadmapRoot = path.join(tempRoot, 'project_memory', 'roadmap');
    mkdirSync(roadmapRoot, { recursive: true });
    writeFileSync(
      path.join(roadmapRoot, 'improvement-plan.md'),
      [
        '- Project type: Unspecified',
        '- Timeline: Unspecified',
        '## Prioritized Backlog',
        '<!-- atlasmind:roadmap-items:start -->',
        '- [ ] Some real backlog task',
        '<!-- atlasmind:roadmap-items:end -->',
      ].join('\n'),
    );

    const originalFolders = (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [{ uri: { fsPath: tempRoot, path: tempRoot } }];
    (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = () => ({
      get: (_key: string, fallback?: unknown) => fallback,
    } as never);

    try {
      const result = await buildRoadmapStatusResult('Plan the fastest safe route to MVP using the roadmap; address the highest-risk gap first.');
      expect(result).toBeDefined();
      expect(result?.markdown).toContain('### Plan your MVP');
      expect(result?.markdown).toContain('What type of project is this?');
      // Plan mode stays focused — no outstanding-items dump.
      expect(result?.markdown).not.toContain('Outstanding roadmap items');
      expect(result?.markdown).not.toContain('Some real backlog task');
      expect(result?.prefills).toHaveLength(1);
      expect(result?.prefills[0].label).toBe('Answer all 2 questions');
    } finally {
      (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = originalFolders;
      (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = originalGetConfiguration;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('defers a plan request to real planning when there are no profile gaps', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-roadmap-noplan-'));
    const roadmapRoot = path.join(tempRoot, 'project_memory', 'roadmap');
    mkdirSync(roadmapRoot, { recursive: true });
    writeFileSync(
      path.join(roadmapRoot, 'improvement-plan.md'),
      [
        '- Project type: CLI tool',
        '- Timeline: 2 weeks',
        '## Prioritized Backlog',
        '<!-- atlasmind:roadmap-items:start -->',
        '- [ ] Some real backlog task',
        '<!-- atlasmind:roadmap-items:end -->',
      ].join('\n'),
    );

    const originalFolders = (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [{ uri: { fsPath: tempRoot, path: tempRoot } }];
    (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = () => ({
      get: (_key: string, fallback?: unknown) => fallback,
    } as never);

    try {
      // No gaps → undefined so the normal pipeline (the model) does the actual planning.
      const result = await buildRoadmapStatusResult('Plan the fastest safe route to MVP using the roadmap; address the highest-risk gap first.');
      expect(result).toBeUndefined();
    } finally {
      (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = originalFolders;
      (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = originalGetConfiguration;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not force roadmap markdown for generic next-work prompts', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-roadmap-priority-'));
    const roadmapRoot = path.join(tempRoot, 'project_memory', 'roadmap');
    mkdirSync(roadmapRoot, { recursive: true });
    writeFileSync(
      path.join(roadmapRoot, 'improvement-plan.md'),
      [
        '- [ ] Harden auth token validation and secrets handling',
        '- [ ] Capture the architecture decision for provider failover',
        '- [ ] Polish the README examples',
      ].join('\n'),
    );

    const originalFolders = (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [{ uri: { fsPath: tempRoot, path: tempRoot } }];
    (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = () => ({
      get: (_key: string, fallback?: unknown) => fallback,
    } as never);

    try {
      const markdown = await buildRoadmapStatusMarkdown('what should we work on next?');
      expect(markdown).toBeUndefined();
    } finally {
      (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = originalFolders;
      (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = originalGetConfiguration;
      rmSync(tempRoot, { recursive: true, force: true });
    }
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
        agentId: 'default',
        modelUsed: 'copilot/gpt-4.1',
        costUsd: 0.0345,
        inputTokens: 1234,
        outputTokens: 567,
        artifacts: {
          output: 'done',
          outputPreview: 'done',
          toolCallCount: 2,
          toolCalls: [],
          verificationSummary: 'npm run compile passed',
          checkpointedTools: ['writeFile'],
        },
      },
      { hasSessionContext: true, routingContext: { sessionContext: 'Recent panel context' } },
    );

    expect(metadata.modelUsed).toBe('copilot/gpt-4.1');
    expect(metadata.thoughtSummary?.summary).toBe('Used 2 tool calls.');
    expect(metadata.thoughtSummary?.status).toBeUndefined();
    expect(metadata.thoughtSummary?.bullets).toContain('2 tool calls.');
    expect(metadata.thoughtSummary?.bullets).toContain('Used recent session context.');
    expect(metadata.thoughtSummary?.bullets).toContain('Checkpointed: writeFile.');
    expect(metadata.thoughtSummary?.bullets).toContain('Verified: npm run compile passed.');
    expect(metadata.thoughtSummary?.bullets).toEqual(expect.arrayContaining([
      expect.stringMatching(/0\.0345 · 1,234 in \/ 567 out/),
    ]));
  });

  it('adds routing hints and workspace investigation notes to the thinking summary', () => {
    const metadata = buildAssistantResponseMetadata(
      'The chat sidebar layout is broken and I need help debugging the UI regression.',
      {
        agentId: 'frontend-reviewer',
        modelUsed: 'copilot/gpt-4.1',
        costUsd: 0.0042,
        inputTokens: 321,
        outputTokens: 98,
        artifacts: undefined,
      },
      { routingContext: { sessionContext: 'Current chat panel session' } },
    );

    expect(metadata.thoughtSummary?.bullets).toContain('Workspace investigation applied.');
    expect(metadata.thoughtSummary?.bullets).toEqual(expect.arrayContaining([
      expect.stringMatching(/0\.0042 · 321 in \/ 98 out/),
    ]));
    expect(metadata.followupQuestion).toBe('Do you want me to fix this?');
    expect(metadata.suggestedFollowups?.map(item => item.label)).toEqual([
      'Fix This',
      'Explain Only',
      'Fix Autonomously',
    ]);
  });

  it('still builds a thinking summary when routing hints are supplied', () => {
    const metadata = buildAssistantResponseMetadata(
      'Do deep research on current MCP adoption patterns',
      {
        agentId: 'default',
        modelUsed: 'perplexity/sonar-deep-research',
        costUsd: 0.011,
        inputTokens: 500,
        outputTokens: 220,
        artifacts: undefined,
      },
      {
        routingContext: {
          specialistRouteLabel: 'research and source-backed retrieval',
          specialistRoutingHint: 'Prefer EXA or deep-research routing.',
        },
      },
    );

    expect(metadata.thoughtSummary).toBeDefined();
    expect(metadata.modelUsed).toBe('perplexity/sonar-deep-research');
  });

  it('does not add execution-choice followups when the user explicitly asked for a fix', () => {
    const metadata = buildAssistantResponseMetadata(
      'Fix the broken chat sidebar layout in the workspace.',
      {
        agentId: 'frontend-reviewer',
        modelUsed: 'copilot/gpt-4.1',
        costUsd: 0.0042,
        inputTokens: 321,
        outputTokens: 98,
        artifacts: undefined,
      },
      { routingContext: { sessionContext: 'Current chat panel session' } },
    );

    expect(metadata.followupQuestion).toBeUndefined();
    expect(metadata.suggestedFollowups).toBeUndefined();
  });

  it('does not add execution-choice followups for terse actionable frustrated prompts', () => {
    const metadata = buildAssistantResponseMetadata(
      'Can you do that for me?',
      {
        agentId: 'default',
        modelUsed: 'copilot/gpt-4.1',
        costUsd: 0.0042,
        inputTokens: 321,
        outputTokens: 98,
        artifacts: undefined,
      },
      {
        routingContext: {
          sessionContext: 'We already established that the broken chat sidebar layout is in the workspace chat panel code and the next step is to fix it.',
          userFrustrationSignal: 'Operator frustration signal (moderate): recover with direct action.',
        },
      },
    );

    expect(metadata.followupQuestion).toBeUndefined();
    expect(metadata.suggestedFollowups).toBeUndefined();
    expect(metadata.thoughtSummary?.bullets).toContain('Direct-action mode active.');
    expect(metadata.timelineNotes).toEqual([
      expect.objectContaining({
        label: 'Learned from friction',
        tone: 'warning',
      }),
    ]);
  });

  it('detects explicit frustration cues that should trigger adaptive learning', () => {
    expect(detectUserFrustrationSignal('You are not doing what I ask. Can you not do this for me?')).toEqual(
      expect.objectContaining({
        level: 'high',
        matchedCue: 'explicit-frustration',
      }),
    );

    expect(detectUserFrustrationSignal('No, I want the reason Atlas is not acting to be resolved.')).toEqual(
      expect.objectContaining({
        level: 'moderate',
        matchedCue: 'frustrated-correction',
      }),
    );
  });

  it('surfaces a visible continuation hint when the assistant response body is empty', () => {
    const visible = ensureAssistantVisibleResponse('', {
      modelUsed: 'copilot/openai-o3-mini',
      iterationLimitHit: true,
      thoughtSummary: {
        label: 'Thinking summary',
        summary: 'High-reasoning code task routed to copilot/openai-o3-mini.',
        bullets: [],
      },
    });

    expect(visible).toMatch(/Proceed|continue/i);
  });

  it('surfaces the last-resort fallback when the response is empty and the model did no work', () => {
    // The orchestrator should have already generated a targeted clarifying question via
    // generateClarifyingQuestion; this fallback only fires if that call also fails.
    const visible = ensureAssistantVisibleResponse('', {
      modelUsed: 'openai/o3-mini',
      thoughtSummary: {
        label: 'What Atlas did',
        summary: 'Answered from context.',
        bullets: [],
      },
    });

    expect(visible).not.toMatch(/Answered from context/i);
    expect(visible).toMatch(/details|files|examples/i);
  });

  it('surfaces the last-resort fallback when the response is empty with no metadata', () => {
    const visible = ensureAssistantVisibleResponse('', undefined);
    expect(visible).toMatch(/details|files|examples/i);
  });

  it('renders an assistant footer with model and thinking summary', () => {
    const footer = renderAssistantResponseFooter({
      modelUsed: 'copilot/gpt-4.1',
      thoughtSummary: {
        label: 'Thinking summary',
        summary: 'High-reasoning code task routed to copilot/gpt-4.1.',
        status: 'verified',
        statusLabel: '[Red->Green observed]',
        bullets: ['Tool loop used 1 call(s).'],
      },
    });

    expect(footer).toContain('_Model: copilot/gpt-4.1_');
    expect(footer).toContain('**Thinking summary:** High-reasoning code task routed to copilot/gpt-4.1.');
    expect(footer).toContain('**Red-to-green:** [Red->Green observed]');
    expect(footer).toContain('- Tool loop used 1 call(s).');
  });

  it('renders follow-up execution choices in the assistant footer', () => {
    const footer = renderAssistantResponseFooter({
      followupQuestion: 'Do you want me to fix this?',
      suggestedFollowups: [
        { label: 'Fix This', prompt: 'Fix this issue.' },
        { label: 'Explain Only', prompt: 'Explain only.' },
      ],
    });

    expect(footer).toContain('**Next step:** Do you want me to fix this?');
    expect(footer).toContain('- Fix This');
    expect(footer).toContain('- Explain Only');
  });

  it('renders session timeline notes in the assistant footer', () => {
    const footer = renderAssistantResponseFooter({
      modelUsed: 'copilot/gpt-4.1',
      timelineNotes: [
        {
          label: 'Learned from friction',
          summary: 'Atlas updated this workspace session with stronger direct-recovery guidance after the operator signaled frustration on this turn.',
          tone: 'warning',
        },
      ],
    });

    expect(footer).toContain('**Session timeline:**');
    expect(footer).toContain('- Learned from friction: Atlas updated this workspace session with stronger direct-recovery guidance after the operator signaled frustration on this turn.');
  });

  it('adds a red-to-green cue when TDD evidence is present', () => {
    const metadata = buildAssistantResponseMetadata(
      'Fix the auth redirect bug and update the implementation.',
      {
        agentId: 'backend-engineer',
        modelUsed: 'copilot/gpt-4.1',
        costUsd: 0.0123,
        inputTokens: 210,
        outputTokens: 80,
        artifacts: {
          output: 'done',
          outputPreview: 'done',
          toolCallCount: 2,
          toolCalls: [],
          tddStatus: 'verified',
          tddSummary: 'Observed a failing relevant test signal before implementation writes and a passing verification signal after the change.',
          checkpointedTools: [],
        },
      },
    );

    expect(metadata.thoughtSummary?.status).toBe('verified');
    expect(metadata.thoughtSummary?.statusLabel).toBe('[Red->Green observed]');
    expect(metadata.thoughtSummary?.bullets).toContain('Red-to-green: [Red->Green observed].');
    expect(metadata.thoughtSummary?.bullets).toContain('TDD evidence: Observed a failing relevant test signal before implementation writes and a passing verification signal after the change..');
  });

  it('persists follow-up policy snapshots into assistant metadata', () => {
    const metadata = buildAssistantResponseMetadata(
      'Review the workspace and update the docs',
      {
        agentId: 'default',
        modelUsed: 'copilot/gpt-4.1',
        costUsd: 0.0345,
        inputTokens: 1234,
        outputTokens: 567,
        artifacts: undefined,
      },
      {
        policies: [
          { source: 'personality', label: 'Saved personality profile', summary: 'Direct, pragmatic, and specific.' },
          { source: 'project-soul', label: 'Project soul', summary: 'Build a safe and reviewable coding agent.' },
        ],
      },
    );

    expect(metadata.policies).toEqual([
      { source: 'personality', label: 'Saved personality profile', summary: 'Direct, pragmatic, and specific.' },
      { source: 'project-soul', label: 'Project soul', summary: 'Build a safe and reviewable coding agent.' },
    ]);
  });

  it('reconciles partial streamed text with a different final response', () => {
    expect(reconcileAssistantResponse(
      'I will inspect the code path.',
      'The response was getting dropped after the first streamed chunk.',
    )).toEqual({
      additionalText: '\n\nThe response was getting dropped after the first streamed chunk.',
      transcriptText: 'I will inspect the code path.\n\nThe response was getting dropped after the first streamed chunk.',
    });
  });

  it('reconciles prefixed streamed text without duplicating the suffix', () => {
    expect(reconcileAssistantResponse(
      'AtlasMind ',
      'AtlasMind completed the response.',
    )).toEqual({
      additionalText: 'completed the response.',
      transcriptText: 'AtlasMind completed the response.',
    });
  });

  it('describes project mode as multiple routed models', () => {
    const metadata = buildProjectResponseMetadata('Ship the new chat bubble metadata');

    expect(metadata.modelUsed).toBe('multiple routed models');
    expect(metadata.thoughtSummary?.summary).toContain('different models');
  });

  it('persists TDD artifact metadata into project run artifacts', () => {
    const artifacts = buildProjectRunSubTaskArtifacts([
      {
        subTaskId: 'fix-auth',
        title: 'Fix auth regression',
        status: 'completed',
        output: 'Updated auth logic.',
        costUsd: 0.01,
        durationMs: 1200,
        role: 'backend-engineer',
        dependsOn: [],
        artifacts: {
          output: 'Updated auth logic.',
          outputPreview: 'Updated auth logic.',
          toolCallCount: 2,
          toolCalls: [],
          verificationSummary: 'PASS: npm run test (exit 0)',
          tddStatus: 'verified',
          tddSummary: 'Observed a failing relevant test signal before implementation writes and a passing verification signal after the change.',
          checkpointedTools: [],
          changedFiles: [],
        },
      },
    ]);

    expect(artifacts[0]?.tddStatus).toBe('verified');
    expect(artifacts[0]?.tddSummary).toContain('failing relevant test signal');
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

describe('detectProjectRunProposal', () => {
  it('detects a first-person offer to start a project run posed as a question', () => {
    expect(
      detectProjectRunProposal(
        'I have mapped out the work. Want me to kick off a project run to build this out?',
      ),
    ).toBe(true);
    expect(
      detectProjectRunProposal('Plan ready. Shall I start an autonomous project run to implement it?'),
    ).toBe(true);
  });

  it('detects a first-person readiness statement that offers to run autonomously', () => {
    expect(
      detectProjectRunProposal("The plan is set. I'm ready to switch into project execution mode and run this."),
    ).toBe(true);
  });

  it('does not fire when the reply ends with an information-seeking question', () => {
    // Mentions a project run, but the trailing question is gathering requirements.
    expect(
      detectProjectRunProposal(
        'I can run this as a project run. What database and auth provider should the build target?',
      ),
    ).toBe(false);
  });

  it('does not fire on a plain answer with no run offer', () => {
    expect(detectProjectRunProposal('The checkout flow lives in src/checkout.ts and looks correct.')).toBe(false);
  });

  it('does not fire on a generic build statement without project-run vocabulary', () => {
    // "build this out" alone must never escalate an ordinary edit into a multi-step run.
    expect(detectProjectRunProposal('Sure, I can build this out for you. Want me to start?')).toBe(false);
  });

  it('vetoes a proposal that is being declined or deferred', () => {
    expect(
      detectProjectRunProposal("I won't start a project run until you confirm the target stack."),
    ).toBe(false);
  });
});

describe('buildProjectRunAutoFlowNotice', () => {
  it('uses an immediate notice under Autopilot', () => {
    expect(buildProjectRunAutoFlowNotice('Build the export feature', true)).toBe(
      '**Autopilot** — auto-continuing into a project run.\n\nGoal: `Build the export feature`',
    );
  });

  it('uses a cancellable notice when Autopilot is off', () => {
    expect(buildProjectRunAutoFlowNotice('Build the export feature', false)).toBe(
      'Starting a project run to: **Build the export feature**\n\n_Use Stop to cancel._',
    );
  });
});

describe('resolveProjectRunAutoFlow', () => {
  const transcript: SessionTranscriptEntry[] = [
    {
      id: '1',
      role: 'user',
      content: 'Add a CSV export to the reports page.',
      timestamp: '2026-06-22T10:00:00.000Z',
    },
    {
      id: '2',
      role: 'assistant',
      content: 'Here is the plan. Want me to kick off a project run to build this out?',
      timestamp: '2026-06-22T10:00:05.000Z',
    },
  ];

  it('returns the goal "Proceed" would resolve plus a notice when a run was proposed', () => {
    const result = resolveProjectRunAutoFlow(transcript[1].content, transcript, {
      enabled: true,
      autopilot: false,
    });
    // Mirrors resolveAutonomousContinuationGoal('proceed', …): the assistant's proposed action.
    expect(result?.goal).toBe('kick off a project run to build this out');
    expect(result?.notice).toContain('Use Stop to cancel');
  });

  it('returns undefined when auto-flow is disabled', () => {
    expect(
      resolveProjectRunAutoFlow(transcript[1].content, transcript, { enabled: false, autopilot: false }),
    ).toBeUndefined();
  });

  it('returns undefined when the reply did not propose a run', () => {
    expect(
      resolveProjectRunAutoFlow('The reports page renders fine; nothing to change.', transcript, {
        enabled: true,
        autopilot: true,
      }),
    ).toBeUndefined();
  });
});
