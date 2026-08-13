import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AgentDefinition,
  ProjectTestingConfig,
  ProjectTestingMethodologyConfig,
  SubTask,
  TestingMethodologyId,
} from '../types.js';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../types.js';
import { interpretVersionedDocument } from './schemaMigration.js';
import type { VersionedDocumentRead } from './schemaMigration.js';

/**
 * The one place this path is written.
 *
 * It previously appeared in three files — here, `settingsPanel.ts` (beside a
 * byte-identical copy of the reader), and `testingProtocolSync.ts` — so the
 * project had two readers that could disagree about whether a config was usable.
 */
export const TESTING_CONFIG_SSOT_PATH = 'project_memory/index/testing-config.json';
const TESTING_PRESENCE_TERMS = [
  'test',
  'spec',
  'coverage',
  'assert',
  'verify',
  'validate',
  'qa',
  'regression',
  'mutation',
  'snapshot',
  'scan',
  'audit',
  'tdd',
  'bdd',
  'e2e',
  'end-to-end',
];

/** Is this a testing config this build can use? Shape only — versioning is the ladder's job. */
function isProjectTestingConfig(value: unknown): value is ProjectTestingConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['methodologies']);
}

/**
 * Read the workspace's testing configuration.
 *
 * Routed through `interpretVersionedDocument` rather than checking the version
 * itself. The previous gate was `parsed.version === 1`, which collapsed two very
 * different situations into the same `undefined`: a corrupt file, and a file
 * written by a *newer* AtlasMind. The second is the dangerous one — every caller
 * treats `undefined` as "this project has no testing policy", and the writers
 * then persist a fresh default straight over a newer build's file. Since the
 * shape is a list of enabled methodologies, that is a silent way to switch a
 * project's whole testing policy off.
 *
 * `interpretVersionedDocument` keeps *invalid* (safe to replace) and *refused*
 * (never safe to replace) apart, and runs the 1→2 migration ladder on the way
 * through. This function still answers `undefined` in both cases, because
 * reading is all it does — {@link readProjectTestingConfigDocument} is for the
 * callers that are about to write and therefore need the distinction.
 */
export function readProjectTestingConfig(workspaceRoot: string): ProjectTestingConfig | undefined {
  return readProjectTestingConfigDocument(workspaceRoot).config;
}

/**
 * The same read, with the answer a *writer* needs: whether a file exists that
 * this build must not overwrite. A caller that seeds a default must check
 * `preserveExisting` before persisting, or it will destroy a newer build's file.
 */
export function readProjectTestingConfigDocument(workspaceRoot: string): VersionedDocumentRead<ProjectTestingConfig> {
  const configPath = path.join(workspaceRoot, TESTING_CONFIG_SSOT_PATH);
  if (!existsSync(configPath)) {
    return { preserveExisting: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    // Unreadable or not JSON: corrupt rather than futuristic, so replacing it is
    // allowed. A parse failure is never grounds for preserving a file.
    return { preserveExisting: false };
  }

  return interpretVersionedDocument<ProjectTestingConfig>('testing-config', parsed, isProjectTestingConfig);
}

export function inferTestingMethodologyForSubTask(
  task: SubTask,
  config: ProjectTestingConfig,
): TestingMethodologyId | undefined {
  const corpus = `${task.title} ${task.description} ${task.role}`.toLowerCase();
  const hasTestingPresence = TESTING_PRESENCE_TERMS.some(term => corpus.includes(term));
  const isTestingRole = /tester|security-reviewer|qa|test/i.test(task.role);

  if (!isTestingRole && !hasTestingPresence) {
    return undefined;
  }

  // First pass: specific signals only. Wildcard ('*') entries (tdd, unit) intentionally
  // excluded here so they do not shadow concrete methodology matches — e.g. a task
  // mentioning 'playwright' should resolve to 'e2e', not 'tdd' (which is first in the
  // definitions array but applies to everything via wildcard).
  for (const def of TESTING_METHODOLOGY_DEFINITIONS) {
    const enabledConfig = config.methodologies.find((entry) => entry.id === def.id && entry.enabled);
    if (!enabledConfig) {
      continue;
    }

    const specificSignals = def.autoDetectSignals.filter(s => s !== '*').map(s => s.toLowerCase());
    if (specificSignals.some(signal => corpus.includes(signal))) {
      return def.id;
    }
  }

  // Wildcard fallback: only for confirmed testing roles, so a devops task that mentions
  // 'pipeline' but no specific CI-tool signal does not silently adopt 'tdd'.
  if (isTestingRole) {
    for (const def of TESTING_METHODOLOGY_DEFINITIONS) {
      const enabledConfig = config.methodologies.find((entry) => entry.id === def.id && entry.enabled);
      if (!enabledConfig) {
        continue;
      }
      if (def.autoDetectSignals.includes('*')) {
        return def.id;
      }
    }
  }

  return undefined;
}

export function resolveTestingModelOverride(
  methodologyId: TestingMethodologyId,
  methodConfig: ProjectTestingMethodologyConfig,
  agents: AgentDefinition[],
): string | undefined {
  const assignedModelId = methodConfig.assignedModelId?.trim();
  if (assignedModelId) {
    return assignedModelId;
  }

  const assignedAgent = agents.find((agent) => agent.id === methodConfig.assignedAgentId);
  if (!assignedAgent) {
    return undefined;
  }

  const override = assignedAgent.testingModelOverrides?.[methodologyId]?.trim();
  return override || undefined;
}

/**
 * State the project's whole enabled testing policy to an agent about to write code.
 *
 * **Why this exists as a separate builder.** The only channel that ever carried
 * testing policy into a prompt was `buildMethodologySystemPromptHint`, and it is
 * reached through two narrow gates: a direct task must already be *classified as
 * testing* and match an `assignedAgentId`, and a subtask must satisfy
 * `inferTestingMethodologyForSubTask`, which returns `undefined` unless the task
 * text already contains a testing term. So a subtask that implemented a feature
 * and never said the word "test" was told nothing about the policy at all — which
 * is exactly how a project can run for weeks with fourteen methodologies declared
 * and no tests written for any of them. That is not a reporting bug; the
 * declaration was never in front of the model that could have honoured it.
 *
 * Three properties follow from that failure, and each is load-bearing:
 *
 * - **The whole enabled set, never one match.** The per-methodology hint answers
 *   "which methodology owns *this* testing task" — a real question, kept for the
 *   model override. This answers "what does this project require of any change",
 *   and picking one of fourteen would silently drop thirteen.
 * - **An obligation, not a description.** The old hint closed with "report the
 *   checks you used", which a model satisfies with a sentence. Work that changes
 *   behaviour and produces none of the evidence its policy names is stated to be
 *   incomplete.
 * - **Empty when nothing is enabled.** A project that has declared no policy gets
 *   no block, rather than boilerplate telling it to test in general — advice
 *   nobody asked for trains agents to skim the prompt.
 *
 * Practices (`v-model`, `exploratory` and the rest) are ways of working that leave
 * no artifact, so they are named as context but never as evidence to produce —
 * `testingPolicyCoverage` already refuses to count them as gaps, and asking for a
 * file they cannot produce would invite an invented one.
 *
 * Pure: takes the config, returns a string, reads nothing.
 */
export function buildTestingObligationGuidance(
  config: ProjectTestingConfig | undefined,
  /**
   * Declared work this project's policies cover that no test names yet.
   *
   * The reason this parameter exists: the guidance above names *methodologies*,
   * and a model told "this project does contract testing" has no way to know
   * that the endpoint it is about to add is a new thing needing one. Naming the
   * uncovered subjects turns a standing policy into the specific obligation this
   * turn has actually incurred.
   */
  uncoveredSubjects: ReadonlyArray<{ policyLabel: string; label: string; source: string }> = [],
): string {
  if (!config) {
    return '';
  }

  const enabled = TESTING_METHODOLOGY_DEFINITIONS.filter(definition =>
    config.methodologies.some(entry => entry.id === definition.id && entry.enabled));

  if (enabled.length === 0) {
    return '';
  }

  const artifactBacked = enabled.filter(definition => !PRACTICE_ONLY_METHODOLOGIES.has(definition.id));
  const practices = enabled.filter(definition => PRACTICE_ONLY_METHODOLOGIES.has(definition.id));

  const lines = [
    'TESTING POLICY (declared by this project, in force for this task)',
    '',
    'This project has declared the testing methodologies below. They are not',
    'suggestions and they are not limited to tasks that mention testing: a change',
    'that alters behaviour is not finished until it carries the evidence its',
    'policy names. If you cannot produce that evidence, say so plainly and say',
    'why — an unstated gap is worse than a stated one, because nobody can act on it.',
    '',
  ];

  if (artifactBacked.length > 0) {
    lines.push('Each of these leaves an artifact behind. Produce it, or state why not:');
    lines.push('');
    for (const definition of artifactBacked) {
      lines.push(`- **${definition.label}** — ${definition.whenToUse}`);
    }
    lines.push('');
  }

  if (practices.length > 0) {
    lines.push(
      `Also declared as ways of working: ${practices.map(definition => definition.label).join(', ')}. `
      + 'These leave no file behind, so nothing is expected on disk for them — apply them to how you approach the work.',
    );
    lines.push('');
  }

  if (uncoveredSubjects.length > 0) {
    const shown = uncoveredSubjects.slice(0, 20);
    lines.push(
      'ALREADY OUTSTANDING — declared work with no test naming it:',
      '',
    );
    for (const subject of shown) {
      lines.push(`- ${subject.policyLabel}: \`${subject.label}\` (declared in ${subject.source})`);
    }
    if (uncoveredSubjects.length > shown.length) {
      lines.push(`- …and ${uncoveredSubjects.length - shown.length} more.`);
    }
    lines.push(
      '',
      'These are facts about the repository, not a request. If your change touches',
      'one of them, it owes a test that names it — a test that never mentions the',
      'thing it covers is not evidence that it does. If your change adds another',
      'such item, the same applies to it.',
      '',
    );
  }

  lines.push(
    'Before concluding, name the tests you wrote or ran and what they actually',
    'verify. "Tests pass" is not evidence; which test, covering which behaviour, is.',
  );

  return lines.join('\n');
}

/**
 * The methodologies that are ways of working rather than artifacts.
 *
 * Mirrors the `practiceOnly` markers in `testingPolicyCoverage.ts`, which is the
 * module that decides whether something counts as a gap. Kept as a local set
 * rather than imported because that module owns evidence *detection* and this one
 * owns what an agent is *asked* for; a shared import would tie prompt wording to
 * a scanner's internals. `tests/core/testingObligation.test.ts` pins the two
 * lists together so they cannot drift apart silently.
 */
const PRACTICE_ONLY_METHODOLOGIES: ReadonlySet<TestingMethodologyId> = new Set<TestingMethodologyId>([
  'v-model', 'white-box', 'test-design', 'black-box', 'gray-box', 'exploratory', 'agile-testing',
]);

export function buildMethodologySystemPromptHint(methodologyId: TestingMethodologyId): string {
  const definition = TESTING_METHODOLOGY_DEFINITIONS.find((entry) => entry.id === methodologyId);
  if (!definition) {
    return '';
  }

  return [
    `Methodology: ${definition.label}`,
    `Description: ${definition.description}`,
    `When to apply: ${definition.whenToUse}`,
    `Key tools: ${definition.keyTools}`,
    '- Report the checks, assertions, or verification artifacts you used for this methodology before concluding.',
  ].join('\n');
}
