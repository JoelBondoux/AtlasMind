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

const TESTING_CONFIG_SSOT_PATH = 'project_memory/index/testing-config.json';
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

export function readProjectTestingConfig(workspaceRoot: string): ProjectTestingConfig | undefined {
  const configPath = path.join(workspaceRoot, TESTING_CONFIG_SSOT_PATH);
  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as ProjectTestingConfig;
    if (parsed.version === 1 && Array.isArray(parsed.methodologies)) {
      return parsed;
    }
  } catch {
    // Ignore invalid or unreadable project testing config.
  }

  return undefined;
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
