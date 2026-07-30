import type { ProjectTestingConfig, TestingMethodologyId } from '../types.js';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../types.js';
import type { TestingPolicyCoverage } from './testingPolicyCoverage.js';

/**
 * What the declared testing policy says, next to what the repository shows — and
 * what to do about each disagreement.
 *
 * **Why this exists.** A testing matrix drifts in one direction. Enabling a
 * methodology takes a click; noticing months later that it never produced
 * anything takes somebody deliberately looking. This project enabled fourteen in
 * a single auto-assess pass and eight of them still had no evidence of any kind
 * seven weeks later — and nothing ever said so in a form that invited a decision.
 * The coverage board reported the gaps accurately the whole time; what was
 * missing was a way to *act* on them without hand-editing a JSON file.
 *
 * Four rules, each the answer to a way this could mislead:
 *
 * - **Dropping is a first-class outcome, not a failure.** A project that
 *   declared End-to-End testing in June and has since decided it does not want
 *   it is not behind on work — it has a stale declaration. Presenting every gap
 *   as "write these tests" would make withdrawing one feel like giving up, and a
 *   policy nobody can withdraw from is a policy people stop reading.
 * - **`commit` is a real answer with a real cost.** Keeping an unevidenced
 *   methodology deliberately is legitimate; it stays a visible gap, and the
 *   proposal says so rather than making it disappear into an "accepted" bucket.
 * - **Practices are never proposed for anything.** They leave no artifact, so
 *   there is no evidence to be missing. Proposing to drop Exploratory Testing
 *   because no file mentions it would be the tool misunderstanding its own data.
 * - **Nothing is decided here.** This returns a proposal. The caller confirms it,
 *   and applying it is a separate call, because the outcome is a rewrite of a
 *   git-tracked file that governs how every agent in the project behaves.
 *
 * Pure: no clock, no filesystem, no `vscode`.
 */

export type TestingReconciliationAction =
  /** Evidenced. Nothing to do. */
  | 'keep'
  /** Enabled, nothing on disk, and nothing suggests the project intends to. */
  | 'drop'
  /** Enabled with tooling present — the work looks started, so keep it. */
  | 'commit'
  /** Not enabled, but the repository shows evidence for it. */
  | 'adopt';

export interface TestingReconciliationProposal {
  id: TestingMethodologyId;
  label: string;
  action: TestingReconciliationAction;
  /** Whether this methodology would be enabled after applying the proposal. */
  enabledAfter: boolean;
  /** The observation that produced this proposal, in the user's terms. */
  reason: string;
}

export interface TestingReconciliation {
  proposals: TestingReconciliationProposal[];
  /** Proposals that would actually change the config, in display order. */
  changes: TestingReconciliationProposal[];
  /** One line describing the whole reconciliation. */
  summary: string;
}

/** Display order: the changes first, and within them the most consequential. */
const ACTION_ORDER: Record<TestingReconciliationAction, number> = {
  drop: 0,
  adopt: 1,
  commit: 2,
  keep: 3,
};

/**
 * Compare the declared policy with the evidence.
 *
 * `coverage` carries a row per *enabled* methodology only, which is why adoption
 * is derived separately: a methodology switched off has no row, and the most
 * useful thing this can find is a project quietly practising something it never
 * declared. (`integration` was exactly that here — switched off, with its tests
 * in the tree and running.)
 */
export function reconcileTestingPolicy(input: {
  config: ProjectTestingConfig | undefined;
  coverage: TestingPolicyCoverage | undefined;
  /**
   * Methodologies with file or tooling evidence that are **not** currently
   * enabled. Derived by the caller, which is the side that can scan the
   * workspace; absent means adoption was not assessed and none is proposed.
   */
  unenabledWithEvidence?: readonly TestingMethodologyId[];
}): TestingReconciliation {
  const proposals: TestingReconciliationProposal[] = [];

  for (const row of input.coverage?.rows ?? []) {
    const definition = TESTING_METHODOLOGY_DEFINITIONS.find(entry => entry.id === row.id);
    const label = definition?.label ?? row.label;

    // A practice leaves no artifact, so it has no evidence to be missing.
    // Proposing anything for it would be the tool misreading its own data.
    if (row.status === 'not-file-evident') {
      continue;
    }

    if (row.status === 'covered') {
      proposals.push({
        id: row.id,
        label,
        action: 'keep',
        enabledAfter: true,
        reason: row.detail,
      });
      continue;
    }

    if (row.status === 'tooling-only') {
      // The tooling is installed, so somebody started. Dropping this would
      // discard a decision already acted on.
      proposals.push({
        id: row.id,
        label,
        action: 'commit',
        enabledAfter: true,
        reason: `Tooling is present (${row.toolingSignals.slice(0, 3).join(', ')}) but no tests use it yet. Keeping this leaves a visible gap until they do.`,
      });
      continue;
    }

    proposals.push({
      id: row.id,
      label,
      action: 'drop',
      enabledAfter: false,
      reason: 'Declared, with no tests and no tooling anywhere in the repository. Either this is work nobody has started, or a declaration the project has outgrown.',
    });
  }

  for (const id of input.unenabledWithEvidence ?? []) {
    const definition = TESTING_METHODOLOGY_DEFINITIONS.find(entry => entry.id === id);
    if (!definition) {
      continue;
    }
    proposals.push({
      id,
      label: definition.label,
      action: 'adopt',
      enabledAfter: true,
      reason: 'The repository already has evidence for this, but it is switched off — so nothing asks agents to keep it up, and the dashboard does not count it.',
    });
  }

  proposals.sort((left, right) => ACTION_ORDER[left.action] - ACTION_ORDER[right.action]
    || left.label.localeCompare(right.label));

  const declared = new Map((input.config?.methodologies ?? []).map(entry => [entry.id, entry.enabled]));
  const changes = proposals.filter(proposal => (declared.get(proposal.id) ?? false) !== proposal.enabledAfter);

  return { proposals, changes, summary: buildSummary(proposals, changes, input) };
}

function buildSummary(
  proposals: readonly TestingReconciliationProposal[],
  changes: readonly TestingReconciliationProposal[],
  input: { config: ProjectTestingConfig | undefined; coverage: TestingPolicyCoverage | undefined },
): string {
  if (!input.config || !input.coverage) {
    // Never assessed is not the same as nothing to do, and saying "already
    // matches" here would be a claim about a comparison that never ran.
    return 'Testing coverage has not been gathered, so the declared policy has not been compared with the repository.';
  }
  if (proposals.length === 0) {
    return 'No artifact-backed methodology is enabled, so there is nothing to compare. Enable the ones this project genuinely practises.';
  }
  if (changes.length === 0) {
    return `The declared policy matches the repository: all ${proposals.length} artifact-backed methodolog${proposals.length === 1 ? 'y is' : 'ies are'} where the evidence says they should be.`;
  }

  const parts: string[] = [];
  const count = (action: TestingReconciliationAction) => changes.filter(change => change.action === action).length;
  if (count('drop') > 0) {
    parts.push(`${count('drop')} to drop`);
  }
  if (count('adopt') > 0) {
    parts.push(`${count('adopt')} to adopt`);
  }
  return `${changes.length} proposed change${changes.length === 1 ? '' : 's'}: ${parts.join(', ')}. Nothing is applied until you confirm.`;
}

/**
 * Apply a reconciliation, returning a new config.
 *
 * Separate from deriving it, because the derivation is a comparison and this is a
 * rewrite of a git-tracked file that governs how every agent in the project
 * behaves. Everything the entry already carries — the assigned agent, the model
 * override, the notes, the `blocking` flag — survives: a reconciliation decides
 * *whether* a methodology is declared, and has no standing to discard how the
 * project configured it. A dropped methodology therefore keeps its settings, so
 * re-enabling it later restores what was there rather than a blank row.
 */
export function applyTestingReconciliation(
  config: ProjectTestingConfig,
  proposals: readonly TestingReconciliationProposal[],
): ProjectTestingConfig {
  const decisions = new Map(proposals.map(proposal => [proposal.id, proposal.enabledAfter]));
  return {
    ...config,
    methodologies: config.methodologies.map(entry => {
      const enabledAfter = decisions.get(entry.id);
      return enabledAfter === undefined ? entry : { ...entry, enabled: enabledAfter };
    }),
  };
}

/**
 * A human-readable diff, for the confirmation dialog.
 *
 * The exact lines are shown before anything is written, because the alternative —
 * "reconcile the testing policy?" with a count — asks somebody to approve a
 * rewrite of a tracked file without seeing what it says.
 */
export function describeTestingReconciliation(changes: readonly TestingReconciliationProposal[]): string {
  return changes
    .map(change => `${change.enabledAfter ? 'Enable' : 'Disable'} ${change.label} — ${change.reason}`)
    .join('\n\n');
}
