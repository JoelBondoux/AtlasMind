import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectMatchesApproved as compareApproved } from '../helpers/approvals.js';
import { buildIssueWorkPrompt } from '../../src/core/issueTracker.js';
import { buildReviewCommentPrompt } from '../../src/core/pullRequestTracker.js';
import { buildDebtWorkPrompt } from '../../src/core/debtRegister.js';
import { buildResearchScanPrompt } from '../../src/core/researchScanCatalog.js';
import { buildHandoffPrompt, evaluateHandoff } from '../../src/core/agentHandoff.js';
import type { IssueRecord } from '../../src/core/issueTracker.js';
import type { DebtEntry } from '../../src/core/debtRegister.js';

/**
 * Prompt regression: the text AtlasMind actually sends, pinned to bytes
 * somebody approved.
 *
 * A prompt is behaviour. Editing one changes what every model does on that path
 * — and unlike a code change, nothing fails when it goes wrong. The turn still
 * runs, the model still answers, and the answer is differently shaped in a way
 * that shows up as "the assistant has got worse lately" three weeks later, with
 * no failing test and nothing obvious in the diff to point at.
 *
 * Behavioural assertions cannot close that gap on their own. `guardrail.test.ts`
 * checks the properties that must hold — the content is fenced, the boundary is
 * stated before the text, the instruction not to follow it is present — and
 * those are the important ones. But a prompt can satisfy every one of them and
 * still have had a paragraph deleted. So the two live side by side: properties
 * for what must be true, baselines for everything else.
 *
 * These builders are deliberately model-free and deterministic, which is what
 * makes this possible at all. Every one takes a record and returns a string.
 *
 * **A failure here is not automatically a bug.** It says the prompt changed. If
 * that was intended, re-approve:
 *
 *     APPROVE_BASELINES=1 npx vitest run tests/prompt-regression
 *
 * and commit the updated `__approvals__` file with the change, so the diff
 * shows what the model is about to be told instead.
 */

const APPROVALS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__approvals__');
const expectMatchesApproved = (name: string, actual: string): void =>
  compareApproved(APPROVALS_DIR, name, actual);

const issue: IssueRecord = {
  number: 4242,
  title: 'Crash when saving an empty document',
  state: 'open',
  author: 'passer-by',
  labels: ['bug'],
  assignees: [],
  body: 'Saving with an empty buffer throws.\n\nSteps: open a new file, press save.',
  bodyTruncated: false,
  url: 'https://github.com/example/repo/issues/4242',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  comments: 3,
};

const debtEntry: DebtEntry = {
  id: 'debt-1',
  domain: 'code',
  title: 'TODO: replace the hand-rolled retry with the shared helper',
  evidencePath: 'src/core/thing.ts',
  evidenceLine: 12,
  detectedAt: '2026-01-01T00:00:00.000Z',
  severity: 'low',
  rule: 'absent-marker',
  status: 'open',
  transitions: [],
};

describe('the prompts AtlasMind sends are approved text', () => {
  it('sends the approved issue-work prompt', () => {
    expectMatchesApproved('issue-work', buildIssueWorkPrompt(issue));
  });

  it('sends the approved issue-work prompt when the body is empty', () => {
    // The empty and truncated variants are separate baselines because they are
    // separate prompts, and both are reached by ordinary use.
    expectMatchesApproved(
      'issue-work-no-body',
      buildIssueWorkPrompt({ ...issue, body: '', bodyTruncated: false }),
    );
  });

  it('sends the approved issue-work prompt when the body was truncated', () => {
    expectMatchesApproved(
      'issue-work-truncated',
      buildIssueWorkPrompt({ ...issue, body: 'A very long report…', bodyTruncated: true }),
    );
  });

  it('sends the approved review-comment prompt', () => {
    expectMatchesApproved('review-comment', buildReviewCommentPrompt(
      {
        number: 7,
        title: 'Add caching to the contract reader',
        author: 'contributor',
        url: 'https://github.com/example/repo/pull/7',
      } as never,
      {
        id: 'c1',
        author: 'reviewer',
        body: 'This needs a guard for the empty case.',
        path: 'src/core/cache.ts',
        line: 42,
        url: 'https://github.com/example/repo/pull/7#discussion_r1',
        createdAt: '2026-01-01T00:00:00.000Z',
        resolved: false,
      } as never,
    ));
  });

  it('sends the approved debt-work prompt', () => {
    expectMatchesApproved('debt-work', buildDebtWorkPrompt(debtEntry));
  });

  it('sends the approved research-scan prompt when discovery is available', () => {
    expectMatchesApproved('research-scan-discoverable', buildResearchScanPrompt('competition', {
      projectSummary: 'A VS Code extension providing a multi-agent orchestrator.',
      canDiscover: true,
    } as never));
  });

  it('sends the approved research-scan prompt when nothing can search', () => {
    // The more important of the two. This is the prompt sent when the model
    // cannot look anything up, and the wording is the only thing standing
    // between that and a fluent invented market report.
    expectMatchesApproved('research-scan-no-discovery', buildResearchScanPrompt('competition', {
      projectSummary: 'A VS Code extension providing a multi-agent orchestrator.',
      canDiscover: false,
    } as never));
  });

  it('sends the approved hand-off prompt when capabilities were withheld', () => {
    const decision = evaluateHandoff({
      request: { targetAgentId: 'reviewer', question: 'Is this cache safe to share?' },
      chain: [],
      callerAgentId: 'builder',
      knownAgentIds: ['builder', 'reviewer'],
      callerSkillIds: ['file-read', 'text-search'],
      targetSkillIds: ['file-read', 'text-search', 'file-write'],
    });

    expect(decision.allowed).toBe(true);
    expectMatchesApproved('handoff-withheld', buildHandoffPrompt(
      { targetAgentId: 'reviewer', question: 'Is this cache safe to share?', reason: 'you own caching' },
      decision,
      'builder',
    ));
  });

  it('sends the approved hand-off prompt when nothing was withheld', () => {
    const decision = evaluateHandoff({
      request: { targetAgentId: 'reviewer', question: 'Is this cache safe to share?' },
      chain: [],
      callerAgentId: 'builder',
      knownAgentIds: ['builder', 'reviewer'],
      callerSkillIds: ['file-read', 'text-search'],
      targetSkillIds: ['file-read', 'text-search'],
    });

    expect(decision.withheldSkillIds).toEqual([]);
    expectMatchesApproved('handoff-full', buildHandoffPrompt(
      { targetAgentId: 'reviewer', question: 'Is this cache safe to share?', reason: 'you own caching' },
      decision,
      'builder',
    ));
  });
});

describe('a prompt is the same prompt every time it is built', () => {
  // Approval testing assumes determinism. If a builder reached for a clock, a
  // random id or the ambient environment, the baselines above would fail
  // intermittently and get deleted rather than debugged — so the assumption is
  // checked rather than relied on.
  const builders: ReadonlyArray<{ name: string; build: () => string }> = [
    { name: 'issue-work', build: () => buildIssueWorkPrompt(issue) },
    { name: 'debt-work', build: () => buildDebtWorkPrompt(debtEntry) },
    {
      name: 'research-scan',
      build: () => buildResearchScanPrompt('competition', {
        projectSummary: 'A VS Code extension.',
        canDiscover: true,
      } as never),
    },
  ];

  for (const { name, build } of builders) {
    it(`builds ${name} identically across repeated calls`, () => {
      const first = build();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(build()).toBe(first);
      }
    });

    it(`builds ${name} without embedding today's date`, () => {
      // A prompt carrying the current date is not reproducible, and it also
      // quietly invalidates every cached prefix on the provider side.
      const today = new Date().toISOString().slice(0, 10);
      expect(build()).not.toContain(today);
    });
  }
});
