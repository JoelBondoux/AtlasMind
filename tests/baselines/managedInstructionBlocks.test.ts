import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectMatchesApproved as compareApproved } from '../helpers/approvals.js';
import {
  buildTestingProtocolsMarkdown,
  buildDebtMarkerMarkdown,
  buildWorkflowMarkdown,
} from '../../src/utils/testingProtocolSync.js';
import { seedWorkflowConfig } from '../../src/core/workflowConfig.js';
import type { AgentDefinition, ProjectTestingConfig } from '../../src/types.js';

/**
 * Cross-version parity for the bytes AtlasMind writes into *other* projects.
 *
 * These three renderers do not produce a screen. They produce a managed block
 * that is written into `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`
 * and the rest, in every repository AtlasMind is pointed at, and those files are
 * committed. So a wording change here is not a local edit — it is a diff in
 * every user's repository the next time they sync, and because each block
 * carries a digest of its source, an unintended change also makes every
 * project's block read as stale until it is rewritten.
 *
 * Behavioural tests already cover what these renderers *do*
 * (`tests/utils/testingProtocolSync.test.ts`). What they cannot catch is an
 * accidental change to the exact text, because an assertion written from the
 * new output passes against the new output. An approved baseline is the only
 * check that fails on a change nobody meant to make.
 *
 * **A failure here is not automatically a bug.** It says the published text
 * changed. If the change was intended, re-approve it:
 *
 *     APPROVE_BASELINES=1 npx vitest run tests/baselines
 *
 * and commit the updated `__approvals__` file with the change, so the diff
 * shows what every downstream instruction file is about to be told.
 */

const APPROVALS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__approvals__');

/** Shared with the prompt baselines, so the re-approval rule has one home. */
const expectMatchesApproved = (name: string, actual: string): void =>
  compareApproved(APPROVALS_DIR, name, actual);

const AGENTS: AgentDefinition[] = [
  {
    id: 'test-developer',
    name: 'Test Developer',
    role: 'testing',
    description: 'Writes and reviews tests.',
    systemPrompt: 'Write tests.',
    skills: [],
  },
];

/**
 * A fixed config, not this repository's own.
 *
 * Reading `project_memory/index/testing-config.json` would make the baseline
 * change whenever somebody ticks a policy on the Testing page, and a baseline
 * that moves with configuration cannot detect a change to the renderer.
 */
const TESTING_CONFIG: ProjectTestingConfig = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  methodologies: [
    { id: 'tdd', enabled: true, assignedAgentId: 'test-developer' },
    { id: 'unit', enabled: true, assignedAgentId: 'test-developer' },
    { id: 'property', enabled: true, assignedAgentId: 'test-developer', notes: 'Pure derivations only.' },
    { id: 'e2e', enabled: false },
  ],
};

describe('managed instruction blocks — published text is approved, not incidental', () => {
  it('renders the testing-protocols block exactly as approved', () => {
    expectMatchesApproved('testing-protocols', buildTestingProtocolsMarkdown(TESTING_CONFIG, AGENTS));
  });

  it('renders the empty testing-protocols block exactly as approved', () => {
    // The "nothing enabled" wording is the one most likely to be reworded
    // casually and the one a project sees before it has configured anything.
    const none: ProjectTestingConfig = { ...TESTING_CONFIG, methodologies: [] };
    expectMatchesApproved('testing-protocols-empty', buildTestingProtocolsMarkdown(none, AGENTS));
  });

  it('renders the debt-marker block exactly as approved', () => {
    expectMatchesApproved('debt-markers', buildDebtMarkerMarkdown([]));
  });

  it('renders the debt-marker block with a project marker exactly as approved', () => {
    expectMatchesApproved(
      'debt-markers-custom',
      buildDebtMarkerMarkdown([{ marker: 'DEBT', severity: 'high' }]),
    );
  });

  it('renders the workflow block exactly as approved', () => {
    const block = buildWorkflowMarkdown({
      config: seedWorkflowConfig({ profile: 'solo' }),
      ceiling: 'observe',
      masterEnabled: true,
    });
    expect(block).toBeDefined();
    expectMatchesApproved('workflow', block ?? '');
  });

  it('writes no workflow block at all when no workflow is declared', () => {
    // Not an empty block: an empty one reads as "this project has no workflow
    // rules", which is a claim, and a false one for a project that has simply
    // not configured the feature. There is nothing to approve here — the
    // absence *is* the assertion.
    expect(buildWorkflowMarkdown(undefined)).toBeUndefined();
  });
});
