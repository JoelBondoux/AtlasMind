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
  buildQuickReplyPayload,
  detectProjectRunProposal,
  sanitizeResponseTail,
  buildProjectRunAutoFlowNotice,
  resolveProjectRunProposal,
  resolveProjectRunAutoFlow,
  type ProjectRunOutcome,
} from '../../src/chat/participant.ts';
import { describeImageRejections } from '../../src/chat/imageAttachments.ts';
import type { TaskImageAttachment } from '../../src/types.ts';
import { type SessionTranscriptEntry } from '../../src/chat/sessionConversation.ts';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { removeTempDir } from '../helpers/tempDir';

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

describe('buildQuickReplyPayload — pills for the surfaces outside the Chat panel', () => {
  it('returns the question and its pills for an answerable question', () => {
    const payload = buildQuickReplyPayload('Should I fix the failing test?');
    expect(payload?.question).toBe('Should I fix the failing test?');
    expect(payload?.replies.map(reply => reply.prompt)).toEqual(['yes', 'no']);
  });

  it('returns nothing when there are no clean options', () => {
    // The Chat panel offers the text input rather than inventing buttons here,
    // and these surfaces must behave the same way.
    expect(buildQuickReplyPayload('What do you think of the architecture?')).toBeUndefined();
    expect(buildQuickReplyPayload('Here is the answer. All done.')).toBeUndefined();
  });

  it('returns nothing for empty or missing input', () => {
    expect(buildQuickReplyPayload('')).toBeUndefined();
    expect(buildQuickReplyPayload('   ')).toBeUndefined();
    expect(buildQuickReplyPayload(undefined)).toBeUndefined();
  });

  it('clamps every field it hands to a webview', () => {
    const payload = buildQuickReplyPayload(`Which one: ${'a'.repeat(300)}, beta, or gamma?`);
    for (const reply of payload?.replies ?? []) {
      expect(reply.label.length).toBeLessThanOrEqual(60);
      expect(reply.prompt.length).toBeLessThanOrEqual(400);
    }
    expect((payload?.question.length ?? 0)).toBeLessThanOrEqual(300);
  });

  it('caps how many pills it will hand over', () => {
    const payload = buildQuickReplyPayload('Which one: a, b, c, d, e, f, or g?');
    expect(payload?.replies.length ?? 0).toBeLessThanOrEqual(5);
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
      removeTempDir(tempRoot);
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
      removeTempDir(tempRoot);
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
      removeTempDir(tempRoot);
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
      removeTempDir(tempRoot);
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
      removeTempDir(tempRoot);
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

  it('reports actual failed model attempts instead of every selection preview', () => {
    const metadata = buildAssistantResponseMetadata(
      'Review the repository',
      {
        agentId: 'test-developer',
        modelUsed: 'mistral/final',
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 20,
        artifacts: undefined,
        modelAttempts: [
          {
            model: 'acp/codex@gpt-5.5#low',
            providerId: 'acp',
            endpointScope: 'acp:codex',
            status: 'timeout',
            durationMs: 180_000,
            inputTokens: 0,
            outputTokens: 0,
            reason: 'Provider timed out.',
          },
          {
            model: 'mistral/final',
            providerId: 'mistral',
            endpointScope: 'provider:mistral',
            status: 'completed',
            durationMs: 2_000,
            inputTokens: 100,
            outputTokens: 20,
          },
        ],
      },
    );

    expect(metadata.modelsUsed).toEqual(['acp/codex@gpt-5.5#low', 'mistral/final']);
    expect(metadata.thoughtSummary?.summary).toBe('Completed after 2 model attempts; 1 did not complete.');
    expect(metadata.thoughtSummary?.bullets).toContain(
      'Did not complete: acp/codex@gpt-5.5#low (timeout).',
    );
  });

  it('carries execution-limit recovery values into chat metadata', () => {
    const metadata = buildAssistantResponseMetadata(
      'Continue the workspace audit',
      {
        agentId: 'security-reviewer',
        modelUsed: 'copilot/gpt-4.1',
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 20,
        artifacts: undefined,
        iterationLimitHit: true,
        suggestedIterationLimit: 15,
        suggestedToolCallsPerTurnLimit: 12,
      },
    );

    expect(metadata).toEqual(expect.objectContaining({
      iterationLimitHit: true,
      suggestedIterationLimit: 15,
      suggestedToolCallsPerTurnLimit: 12,
    }));
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

  it('turns an empty model response into an explicit recovery question with reply chips', () => {
    const metadata = buildAssistantResponseMetadata(
      'give me an honest assessment of my project so far.',
      {
        agentId: 'default',
        modelUsed: 'google/gemini-2.0-flash-lite-001',
        costUsd: 0,
        inputTokens: 24_706,
        outputTokens: 0,
        artifacts: undefined,
      },
      { responseText: '' },
    );

    expect(metadata.thoughtSummary?.summary).toBe('No usable answer was returned.');
    expect(metadata.thoughtSummary?.summary).not.toMatch(/Answered from context/i);
    expect(metadata.followupQuestion).toMatch(/no usable answer/i);
    expect(metadata.quickReplies?.map(item => item.label)).toEqual(['Retry', 'Provider status']);
    expect(metadata.suggestedFollowups).toBeUndefined();
  });

  it('names an auto-paused provider and offers a retry elsewhere after an empty response', () => {
    const metadata = buildAssistantResponseMetadata(
      'Assess the repository.',
      {
        agentId: 'default',
        modelUsed: 'google/gemini-2.0-flash-lite-001',
        costUsd: 0,
        inputTokens: 500,
        outputTokens: 0,
        artifacts: undefined,
        autoDisabledProvider: {
          providerId: 'google',
          displayName: 'Google Gemini',
          reason: 'billing',
        },
      },
      { responseText: '   ' },
    );

    expect(metadata.thoughtSummary?.summary).toBe('Google Gemini stopped before returning an answer.');
    expect(metadata.thoughtSummary?.bullets).toContain(
      'Google Gemini was paused and no fallback model completed the request.',
    );
    expect(metadata.followupQuestion).toMatch(/Google Gemini returned no answer/i);
    expect(metadata.quickReplies?.map(item => item.label)).toEqual(['Retry elsewhere', 'Provider status']);
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

  it('points to rendered reply choices instead of asking for typed Proceed', () => {
    const visible = ensureAssistantVisibleResponse('', {
      followupQuestion: 'The model returned no usable answer. What should Atlas do next?',
      quickReplies: [
        { label: 'Retry', prompt: 'Retry my previous request.' },
        { label: 'Provider status', prompt: 'Show provider status.' },
      ],
    });

    expect(visible).toMatch(/Choose an option below/i);
    expect(visible).not.toMatch(/Proceed/i);
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

  it('labels a divergent legacy stream while keeping only the final response in history', () => {
    // A horizontal rule alone left the operator reading two different answers to
    // one question with nothing saying which was real — and the first, the one
    // they had already read, was the wrong one. Retracting is impossible on an
    // append-only stream; saying so is not.
    const { additionalText, transcriptText } = reconcileAssistantResponse(
      'I will inspect the code path.',
      'The response was getting dropped after the first streamed chunk.',
    );

    expect(additionalText).toContain('superseded');
    expect(additionalText).toContain('The response was getting dropped after the first streamed chunk.');
    expect(transcriptText).toBe('The response was getting dropped after the first streamed chunk.');
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

  it('promotes paused project subtasks into execution-limit recovery metadata', () => {
    const metadata = buildProjectResponseMetadata('Audit the repository', {
      totalInputTokens: 120,
      totalOutputTokens: 30,
      totalCostUsd: 0.02,
      subTaskResults: [
        {
          subTaskId: 'security-review',
          title: 'Audit security',
          status: 'needs-input',
          output: 'Execution stopped at the safety cap.',
          costUsd: 0.02,
          durationMs: 100,
          role: 'security-reviewer',
          dependsOn: [],
          iterationLimitHit: true,
          suggestedIterationLimit: 15,
        },
      ],
    });

    expect(metadata).toEqual(expect.objectContaining({
      iterationLimitHit: true,
      suggestedIterationLimit: 15,
    }));
    expect(metadata.thoughtSummary?.bullets).toEqual(expect.arrayContaining([
      expect.stringMatching(/paused at an execution safety limit/i),
    ]));
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

  it('announces a generic offer as a pending decision, but never auto-starts one', () => {
    // The concern this test was written for — "build this out" must not escalate
    // an ordinary edit into a multi-step run — is now carried by auto-flow rather
    // than by detection, because the two questions have different answers.
    //
    // *Should the operator be told a decision is waiting?* Always: saying yes to
    // this offer starts a run today, and a turn that offers work while showing no
    // control is the silence that made a run seem to come from nowhere.
    //
    // *May it start on its own?* Only when the reply said a run is what starts.
    const reply = 'Sure, I can build this out for you. Want me to start?';
    const transcript = [
      { id: 'u1', role: 'user' as const, content: 'add pagination to the results list', timestamp: new Date(0).toISOString() },
      { id: 'a1', role: 'assistant' as const, content: reply, timestamp: new Date(1000).toISOString() },
    ];

    expect(detectProjectRunProposal(reply)).toBe(true);
    expect(resolveProjectRunAutoFlow(reply, transcript, { enabled: true, autopilot: true })).toBeUndefined();
  });

  it('does not fire on an offer to talk rather than to act', () => {
    // Saying yes to this is a conversation. Drawing a Start-run card on it would
    // make the card mean nothing.
    expect(detectProjectRunProposal('That is how the router picks. Shall I explain the failover path too?')).toBe(false);
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

  it('returns the goal "Proceed" would resolve plus a notice under Autopilot', () => {
    const result = resolveProjectRunAutoFlow(transcript[1].content, transcript, {
      enabled: true,
      autopilot: true,
    });
    // The proposal is deictic ("this"), so the concrete prior user goal wins.
    expect(result?.goal).toBe('Add a CSV export to the reports page.');
    expect(result?.notice).toContain('Autopilot');
  });

  it('leaves interactive sessions to the project-run decision card', () => {
    expect(resolveProjectRunAutoFlow(transcript[1].content, transcript, {
      enabled: true,
      autopilot: false,
    })).toBeUndefined();
    expect(resolveProjectRunProposal(transcript[1].content, transcript)?.goal)
      .toBe('Add a CSV export to the reports page.');
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

describe('the file-count approval gate is reachable from chat', () => {
  // The gate's message said "re-run with `--approve`" while the surface offered
  // no control that could do it, and the two entry points had the approval
  // inverted: an explicit "Proceed" arrived unapproved and stalled here, while a
  // raw prompt merely matching the project pattern was auto-approved straight
  // past the threshold. The prompt with the least review behind it was the one
  // skipping the gate.

  it('offers the approving prompt as the first followup when a run stops at the gate', () => {
    const followups = buildFollowups('project', {
      hasFailures: false,
      hasChangedFiles: false,
      failedSubtaskTitles: [],
      approvalRequiredPrompt: 'Add Stripe checkout --approve',
    });
    expect(followups[0]).toEqual({ prompt: 'Add Stripe checkout --approve', label: 'Approve and run' });
  });

  it('outranks model-suggested followups, since nothing else can unblock the turn', () => {
    const followups = buildFollowups(
      'project',
      {
        hasFailures: false,
        hasChangedFiles: false,
        failedSubtaskTitles: [],
        approvalRequiredPrompt: 'Do the thing --approve',
      },
      [{ label: 'Something Else', prompt: 'something else' }],
    );
    expect(followups[0].label).toBe('Approve and run');
  });

  it('carries a prompt that actually approves — not the bare goal', () => {
    // A chip that re-submits the goal unchanged re-enters the gate and stops
    // again, which is the loop this replaced.
    const followups = buildFollowups('project', {
      hasFailures: false,
      hasChangedFiles: false,
      failedSubtaskTitles: [],
      approvalRequiredPrompt: toApprovedProjectPrompt('Add Stripe checkout'),
    });
    expect(followups[0].prompt).toContain('--approve');
    expect(followups[0].prompt).toContain('Add Stripe checkout');
  });

  it('leaves ordinary project followups alone when no gate was hit', () => {
    const followups = buildFollowups('project', {
      hasFailures: false,
      hasChangedFiles: false,
      failedSubtaskTitles: [],
    });
    expect(followups.map(f => f.label)).not.toContain('Approve and run');
  });
});

describe('a run goal is a goal, not the word used to agree', () => {
  // Built literally rather than through SessionConversation: this file mocks
  // `vscode` narrowly and the manager wants an EventEmitter it does not provide.
  const transcriptOf = (turns: Array<[string, string]>): SessionTranscriptEntry[] =>
    turns.flatMap(([prompt, reply], index) => ([
      { id: `u${index}`, role: 'user' as const, content: prompt, timestamp: new Date(index * 2000).toISOString() },
      { id: `a${index}`, role: 'assistant' as const, content: reply, timestamp: new Date(index * 2000 + 1000).toISOString() },
    ]));

  it('refuses an affirmation fragment as the goal', () => {
    // "Shall I go ahead?" strips its offer lead-in to "go ahead", and that became
    // the project goal — so the plan, the file estimate and the cost estimate were
    // all derived from the word the operator used to agree.
    const transcript = transcriptOf([[
      'the banner is out of date with the manifest',
      'I can implement this across the four files and update the changelog.\n\nShall I go ahead?',
    ]]);

    expect(resolveAutonomousContinuationGoal('yes', transcript))
      .toBe('the banner is out of date with the manifest');
  });

  it('keeps the work when the affirmation is only a preamble to it', () => {
    const transcript = transcriptOf([[
      'the banner is stale',
      'Shall I go ahead and update the README banner?',
    ]]);

    expect(resolveAutonomousContinuationGoal('yes', transcript)).toBe('update the README banner');
  });

  it('does not start a run the assistant said it was not ready to start', () => {
    const transcript = transcriptOf([[
      'can you ship the release?',
      'Once you confirm the version number, I can start a project run to ship it.',
    ]]);

    expect(resolveAutonomousContinuationGoal('continue', transcript)).toBeUndefined();
  });

  it('allows a continuation that answers the precondition', () => {
    // The deferral asked for something. A bare "continue" supplies nothing; a
    // continuation carrying detail does.
    const transcript = transcriptOf([[
      'can you ship the release?',
      'Once you confirm the version number, I can start a project run to ship it.',
    ]]);

    expect(resolveAutonomousContinuationGoal('yes on 0.310.5', transcript)).toBeDefined();
  });
});

describe('a full stop inside a name is not a sentence boundary', () => {
  // One regex took out the whole question lane. `[^.!?]*\?` cannot cross a full
  // stop, so "Want me to update README.md?" yielded "md?" — three characters,
  // below the length guard, discarded — and the question reached the operator as
  // nothing at all. Every closing offer naming a file, a path or a version went
  // the same way, which is most of what Atlas offers to do in a codebase.
  it.each([
    ['I can bring the banner in line.\n\nWant me to update README.md?', 'want me to update readme.md?'],
    ['That logic lives in the participant.\n\nDo you want me to open src/chat/participant.ts?', 'do you want me to open src/chat/participant.ts?'],
    ['The commit range warrants a patch bump.\n\nReady to tag v0.310.2?', 'ready to tag v0.310.2?'],
    ['That would cost about $0.42. Proceed?', 'proceed?'],
  ])('recovers the whole question from %j', (response, expected) => {
    expect(detectResponseQuickReplies(response)?.followupQuestion?.toLowerCase()).toBe(expected);
  });

  it('does not split on an abbreviation followed by a lower-case word', () => {
    const question = detectResponseQuickReplies('Should I add a Playwright suite, i.e. end-to-end coverage?')?.followupQuestion;
    expect(question).toContain('Should I');
  });

  it('surfaces every trailing question, not only the last', () => {
    // Surfacing one made "yes" answer a question the operator never saw singled out.
    const question = detectResponseQuickReplies('That is committed.\n\nShould I update the wiki as well? And do you want a changelog entry?')?.followupQuestion;
    expect(question).toContain('wiki');
    expect(question).toContain('changelog');
  });
});

describe('sanitizeResponseTail keeps what it used to take', () => {
  it('keeps a closing question formatted as a heading', () => {
    // It runs before quick-reply detection, so striking this deleted the question
    // before the operator could see it.
    expect(sanitizeResponseTail('I have the plan ready.\n\n### Ready to proceed?')).toContain('Ready to proceed?');
  });

  it('keeps a heading that answers a lead-in', () => {
    // Otherwise the reply ends on a colon pointing at nothing.
    expect(sanitizeResponseTail('Here is what I would change:\n\n## Next steps')).toContain('Next steps');
  });

  it('still strips a genuinely dangling heading', () => {
    expect(sanitizeResponseTail('The router picks the cheapest model above the floor.\n\n## Notes')).not.toContain('Notes');
  });
});

describe('a long option is abbreviated, not dropped', () => {
  it('keeps a two-way choice clickable when the options are described', () => {
    const detected = detectResponseQuickReplies([
      'There are two ways to close this.',
      '',
      'Which approach do you prefer?',
      '',
      '- Narrow the tool-failure predicate to an exit code so ordinary file reads stop counting',
      '- Append the failure dump instead of overwriting the model answer',
    ].join('\n'));

    expect(detected?.quickReplies).toHaveLength(2);
    const [first] = detected!.quickReplies!;
    expect(first!.label.length).toBeLessThanOrEqual(49);
    expect(first!.label.endsWith('…')).toBe(true);
    // The pill submits the whole option; the ellipsis says the label is short of it.
    expect(first!.prompt.toLowerCase()).toContain('narrow the tool-failure predicate');
  });
});

describe('an offer without a question mark is still an offer', () => {
  // Taken verbatim from a real session. Not one of that model's four turns ended
  // with a question mark — every offer was declarative — and the detector keys
  // on `?`, so the operator was shown three genuine offers and given no way to
  // accept any of them. Every automated probe passed throughout, because their
  // inputs were written by the same hand as the detector and all carried a `?`.
  it.each([
    'If you want, I can also add a short release notes heading for a specific type instead of Changed.',
    'If you want, I can start a project run to validate the required checks locally.',
    // Verbatim shape from a real session. Every hand-written case used "if you
    // want," where the comma supplied the word boundary; this one inflects the
    // verb, and a bare \b after it cannot fire between "want" and "s".
    'If The User wants, I can start a project run next to: validate the required checks locally.',
    'Let me know if you want me to wire the same cache into the image path.',
    "I can raise the TTL to five minutes if you'd prefer.",
    "Happy to split that into two commits if you'd like.",
  ])('offers Yes/No on %j', tail => {
    const detected = detectResponseQuickReplies(`The change is in.\n\n${tail}`);
    expect(detected?.quickReplies?.map(reply => reply.label)).toEqual(['Yes', 'No']);
    expect(detected?.followupQuestion).toBe(tail);
  });

  it.each([
    // Same conditional opening, but the main clause tells the *operator* what to
    // do. A pill here submits an answer to a question nobody asked.
    'If you want multi-instance durability next, use Cloudflare Cache API or KV.',
    'If you want the full history, the changelog has every entry.',
    // Narration, not an undertaking.
    'I can see the lockfile was already at 0.4.2.',
    'I can confirm the tests pass on this branch.',
    'I can tell the working tree is dirty.',
  ])('stays silent on %j', tail => {
    expect(detectResponseQuickReplies(`Here is what I found.\n\n${tail}`)).toBeUndefined();
  });

  it('still prefers a real question when the turn has one', () => {
    const detected = detectResponseQuickReplies('If you want, I can split it.\n\nWhich should I do first?\n\n- Split the commit\n- Land it as one');
    expect(detected?.quickReplies).toHaveLength(2);
  });
});

describe('being asked to explain is never an executable goal', () => {
  const transcriptOf = (turns: Array<[string, string]>): SessionTranscriptEntry[] =>
    turns.flatMap(([prompt, reply], index) => ([
      { id: `u${index}`, role: 'user' as const, content: prompt, timestamp: new Date(index * 2000).toISOString() },
      { id: `a${index}`, role: 'assistant' as const, content: reply, timestamp: new Date(index * 2000 + 1000).toISOString() },
    ]));

  // Observed: "carry on" after "tell me about who makes playwright" started an
  // autonomous project run whose stated goal was that sentence. It touched four
  // files and every model attempt failed. The pattern matched an *interrogative*
  // opening and a question mark; the imperative form asks for exactly the same
  // thing and carries neither.
  it.each([
    'tell me about who makes playwright',
    'tell me about the routing',
    'explain the failover budget',
    'describe the delivery pipeline',
    'summarise what we decided',
    'walk me through the arbiter',
  ])('does not turn %j into a run goal', prompt => {
    const transcript = transcriptOf([[prompt, 'Playwright is maintained by Microsoft.']]);
    expect(resolveAutonomousContinuationGoal('carry on', transcript)).toBeUndefined();
  });

  it('still turns an actual instruction into a goal', () => {
    // The other half: this must not swallow work.
    const transcript = transcriptOf([['add a Playwright test for the initial render', 'Here is the plan.']]);
    expect(resolveAutonomousContinuationGoal('carry on', transcript))
      .toBe('add a Playwright test for the initial render');
  });
});

describe('image attachment rejections', () => {
  /**
   * Every rejection used to be a bare `undefined`, so an oversized screenshot, a
   * `.bmp` and an unreadable file were indistinguishable from "no image
   * mentioned": the turn answered without looking at the picture and said
   * nothing. That is the worst-shaped failure here, because the operator
   * believes the model saw what they saw.
   */
  it('names the file and the reason for each rejection', () => {
    const notice = describeImageRejections([
      { source: 'docs/screenshot.png', reason: 'too-large' },
      { source: 'notes/diagram.bmp', reason: 'unsupported-type' },
      { source: 'tmp/locked.png', reason: 'unreadable', detail: 'EACCES' },
    ]);

    expect(notice).toContain('3 images were not attached');
    expect(notice).toContain('docs/screenshot.png');
    expect(notice).toContain('MB');
    expect(notice).toContain('notes/diagram.bmp');
    expect(notice).toContain('PNG, JPEG, GIF or WebP');
    expect(notice).toContain('tmp/locked.png');
    expect(notice).toContain('EACCES');
  });

  it('says nothing when every image loaded', () => {
    expect(describeImageRejections([])).toBeUndefined();
  });

  it('uses the singular when exactly one was refused', () => {
    const notice = describeImageRejections([{ source: 'a.png', reason: 'too-large' }]);
    expect(notice).toContain('One image was not attached');
  });
});

describe('an interrogative without a question mark', () => {
  /**
   * From a live Lane 4 run: the operator typed "what was my question three turns
   * ago" — no question mark — and `carry on` started an autonomous project run
   * whose stated goal was that sentence. The interrogative branch required a
   * trailing `?` while the imperative branch never did, so "explain the router"
   * was informational and this was executable work.
   */
  function transcriptEndingWith(content: string): SessionTranscriptEntry[] {
    return [
      { id: '1', role: 'user', content: 'add end-to-end tests for the star panel', timestamp: '2026-08-15T10:00:00.000Z' },
      { id: '2', role: 'assistant', content: 'Here is what I would add.', timestamp: '2026-08-15T10:00:10.000Z' },
      { id: '3', role: 'user', content, timestamp: '2026-08-15T10:01:00.000Z' },
      { id: '4', role: 'assistant', content: 'Three turns ago you asked about coverage.', timestamp: '2026-08-15T10:01:10.000Z' },
    ];
  }

  it.each([
    'what was my question three turns ago',
    'what is the cost of running these',
    'how does the router pick a model',
    'which tests cover the panel',
    'why did that turn fail',
  ])('falls back past it rather than running it: %s', question => {
    // "carry on" after a question must not run the question. It reaches back to
    // the last prompt that actually asked for work.
    expect(resolveAutonomousContinuationGoal('carry on', transcriptEndingWith(question)))
      .toBe('add end-to-end tests for the star panel');
  });

  it('still treats a statement opening with an interrogative as work', () => {
    // "When ... it should ..." is a requirement, not an enquiry: `when` opens a
    // subordinate clause as often as a question, and an obligation modal settles
    // it either way.
    const requirement = 'When AtlasMind prompts for tool use it should offer Bypass Approvals and Autopilot.';
    expect(resolveAutonomousContinuationGoal('carry on', transcriptEndingWith(requirement))).toBe(requirement);

    const rule = 'What the router should do is prefer the cheapest healthy model';
    expect(resolveAutonomousContinuationGoal('carry on', transcriptEndingWith(rule))).toBe(rule);
  });
});

describe('shorthand keeps the thread', () => {
  const TRANSCRIPT: SessionTranscriptEntry[] = [
    { id: '1', role: 'user', content: 'install the recommended plugins for me', timestamp: '2026-08-15T10:00:00.000Z' },
    { id: '2', role: 'assistant', content: 'Which one would you like first?', timestamp: '2026-08-15T10:00:10.000Z' },
    { id: '3', role: 'user', content: 'I asked you to fix it, not explain it', timestamp: '2026-08-15T10:01:00.000Z' },
    { id: '4', role: 'assistant', content: 'Added a placeholder entry to extensions.json.', timestamp: '2026-08-15T10:01:10.000Z' },
  ];

  /**
   * From a live Lane 5 run: `git status` dropped the session, and the model —
   * with no session to look at — still narrated one, reporting that it had made
   * no changes on a turn where it had edited a file two turns earlier.
   */
  it.each(['git status', 'project_memory/', 'the tests', 'try again'])(
    'carries the conversation into %s',
    prompt => {
      expect(shouldCarryForwardConversationContext(prompt, TRANSCRIPT)).toBe(true);
    },
  );

  it('still drops the thread on an explicit change of subject', () => {
    // Brevity must not become a way round the subject-shift veto.
    expect(shouldCarryForwardConversationContext(
      'forget that, generate an image of a mountain at sunrise',
      TRANSCRIPT,
    )).toBe(false);
  });
});

describe('model attempt reporting', () => {
  function metadataFor(attempts: Array<{ model: string; status: string }>, modelUsed: string) {
    return buildAssistantResponseMetadata('do the thing', {
      agentId: 'a', modelUsed, costUsd: 0, inputTokens: 1, outputTokens: 1,
      modelAttempts: attempts as never, artifacts: undefined as never,
    } as never, { responseText: 'an answer' });
  }

  /**
   * A model can be tried, refused, and tried again successfully. That produced
   * "final model: X" directly above "Did not complete: …, X", under a headline
   * of "Completed after 5 attempts; 5 did not complete" — which cannot be true
   * of a turn that produced an answer.
   */
  it('never reports the model that answered as having failed', () => {
    const meta = metadataFor([
      { model: 'copilot/flash', status: 'capability-mismatch' },
      { model: 'mistral/small', status: 'capability-mismatch' },
      { model: 'mistral/small', status: 'ok' },
    ], 'mistral/small');

    const bullets = (meta.thoughtSummary?.bullets ?? []).join('\n');
    expect(bullets).toContain('copilot/flash');
    expect(bullets).not.toMatch(/Did not complete:[^\n]*mistral\/small/);
    expect(meta.thoughtSummary?.summary).not.toContain('3 did not complete');
  });

  it('still names the models that genuinely did not complete', () => {
    const meta = metadataFor([
      { model: 'copilot/flash', status: 'error' },
      { model: 'mistral/small', status: 'ok' },
    ], 'mistral/small');

    expect((meta.thoughtSummary?.bullets ?? []).join('\n')).toContain('copilot/flash (error)');
  });
});
