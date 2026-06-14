import { describe, expect, it, beforeEach } from 'vitest';
import {
  inferTestingMethodologyForSubTask,
  resolveTestingModelOverride,
  buildMethodologySystemPromptHint,
} from '../../src/core/testingConfigLoader.ts';
import type { AgentDefinition, ProjectTestingConfig, SubTask } from '../../src/types.ts';

function makeConfig(overrides: Partial<ProjectTestingConfig['methodologies'][0]>[] = []): ProjectTestingConfig {
  const base: ProjectTestingConfig['methodologies'] = [
    { id: 'tdd', enabled: true },
    { id: 'unit', enabled: true },
    { id: 'bdd', enabled: false },
    { id: 'security-testing', enabled: true },
  ];
  return {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    methodologies: base.map((m, i) => ({ ...m, ...(overrides[i] ?? {}) })),
  };
}

function makeTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: 'task-1',
    title: 'Write unit tests',
    description: 'Write unit tests for the auth module',
    role: 'tester',
    skills: [],
    dependsOn: [],
    ...overrides,
  };
}

// ── inferTestingMethodologyForSubTask ─────────────────────────────

describe('inferTestingMethodologyForSubTask', () => {
  it('returns undefined for non-testing roles with no testing presence terms', () => {
    const result = inferTestingMethodologyForSubTask(
      makeTask({ role: 'backend-engineer', title: 'Build checkout form', description: 'Implement the React checkout UI' }),
      makeConfig(),
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when no methodologies are enabled', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [{ id: 'tdd', enabled: false }, { id: 'unit', enabled: false }],
    };
    expect(inferTestingMethodologyForSubTask(makeTask(), config)).toBeUndefined();
  });

  it('matches security-testing for security-reviewer when auth signal present', () => {
    // security-testing autoDetectSignals include 'auth' — so a task mentioning auth flow
    // matches via specific-signal pass, not wildcard fallback.
    const result = inferTestingMethodologyForSubTask(
      makeTask({ role: 'security-reviewer', title: 'Review auth flow', description: 'Audit authentication and oauth token handling' }),
      makeConfig(),
    );
    expect(result).toBe('security-testing');
  });

  it('falls back to tdd wildcard for security-reviewer when no specific signal matches', () => {
    // 'owasp' is NOT in security-testing autoDetectSignals — wildcard (tdd) wins.
    const result = inferTestingMethodologyForSubTask(
      makeTask({ role: 'security-reviewer', title: 'OWASP scan', description: 'Run owasp zap against the API' }),
      makeConfig(),
    );
    expect(result).toBe('tdd');
  });

  it('matches security-testing for security-reviewer when snyk signal present', () => {
    const result = inferTestingMethodologyForSubTask(
      makeTask({ role: 'security-reviewer', title: 'Dependency scan', description: 'Run snyk and semgrep on the codebase' }),
      makeConfig(),
    );
    expect(result).toBe('security-testing');
  });

  it('matches BDD via specific signal in description for tester role', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [
        { id: 'tdd', enabled: true },
        { id: 'bdd', enabled: true },
      ],
    };
    const result = inferTestingMethodologyForSubTask(
      makeTask({ title: 'Write gherkin specs', description: 'Create cucumber step definitions' }),
      config,
    );
    expect(result).toBe('bdd');
  });

  it('falls back to first wildcard methodology (tdd) when no specific signal matches', () => {
    const result = inferTestingMethodologyForSubTask(
      makeTask({ title: 'Write tests', description: 'Basic coverage pass' }),
      makeConfig(),
    );
    expect(result).toBe('tdd');
  });

  it('falls back to unit when tdd is disabled but unit is enabled', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [
        { id: 'tdd', enabled: false },
        { id: 'unit', enabled: true },
      ],
    };
    const result = inferTestingMethodologyForSubTask(makeTask(), config);
    expect(result).toBe('unit');
  });

  it('returns undefined for tester role when only non-wildcard methodologies are enabled and none match', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [{ id: 'bdd', enabled: true }],
    };
    // tester role with generic task — no gherkin/cucumber signal, no wildcard enabled
    const result = inferTestingMethodologyForSubTask(
      makeTask({ title: 'Write tests', description: 'General test pass' }),
      config,
    );
    expect(result).toBeUndefined();
  });

  // ── Gap-3: non-testing roles now fire when corpus contains testing presence terms ──

  it('matches e2e for frontend-engineer when playwright and test presence term both present', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [{ id: 'tdd', enabled: true }, { id: 'e2e', enabled: true }],
    };
    const result = inferTestingMethodologyForSubTask(
      makeTask({ role: 'frontend-engineer', title: 'Write e2e tests', description: 'Add playwright coverage for checkout flow' }),
      config,
    );
    expect(result).toBe('e2e');
  });

  it('does NOT match e2e for frontend-engineer with playwright but no testing presence term', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [{ id: 'e2e', enabled: true }],
    };
    const result = inferTestingMethodologyForSubTask(
      makeTask({
        role: 'frontend-engineer',
        title: 'Build checkout form',
        description: 'Implement checkout UI — use playwright-style interaction patterns for accessibility',
      }),
      config,
    );
    expect(result).toBeUndefined();
  });

  it('matches continuous for devops role when CI signal and test presence term both present', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [{ id: 'tdd', enabled: true }, { id: 'continuous', enabled: true }],
    };
    const result = inferTestingMethodologyForSubTask(
      makeTask({ role: 'devops', title: 'Set up test pipeline', description: 'Configure github actions workflow to run tests on every PR' }),
      config,
    );
    expect(result).toBe('continuous');
  });

  it('does NOT match continuous for devops role with CI signal but no testing presence term', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [{ id: 'continuous', enabled: true }],
    };
    const result = inferTestingMethodologyForSubTask(
      makeTask({ role: 'devops', title: 'Configure deployment', description: 'Set up github actions workflow for production deployment' }),
      config,
    );
    expect(result).toBeUndefined();
  });

  it('specific signal match takes priority over wildcard when both methodologies are enabled', () => {
    const config: ProjectTestingConfig = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: [
        { id: 'tdd', enabled: true },
        { id: 'bdd', enabled: true },
      ],
    };
    // tdd is first with '*' wildcard, but bdd has 'cucumber' signal that matches
    const result = inferTestingMethodologyForSubTask(
      makeTask({ title: 'Implement cucumber scenarios', description: 'Write gherkin step definitions' }),
      config,
    );
    expect(result).toBe('bdd');
  });
});

// ── resolveTestingModelOverride ───────────────────────────────────

describe('resolveTestingModelOverride', () => {
  let agents: AgentDefinition[];

  beforeEach(() => {
    agents = [];
  });

  it('returns undefined when no override is configured', () => {
    const result = resolveTestingModelOverride('tdd', { id: 'tdd', enabled: true }, agents);
    expect(result).toBeUndefined();
  });

  it('returns assignedModelId directly when set', () => {
    const result = resolveTestingModelOverride(
      'tdd',
      { id: 'tdd', enabled: true, assignedModelId: 'anthropic/claude-opus-4-8' },
      agents,
    );
    expect(result).toBe('anthropic/claude-opus-4-8');
  });

  it('trims whitespace from assignedModelId', () => {
    const result = resolveTestingModelOverride(
      'tdd',
      { id: 'tdd', enabled: true, assignedModelId: '  openai/gpt-4o  ' },
      agents,
    );
    expect(result).toBe('openai/gpt-4o');
  });

  it('falls back to agent testingModelOverrides when no assignedModelId', () => {
    agents = [{
      id: 'qa-agent',
      name: 'QA Agent',
      role: 'tester',
      description: 'QA',
      systemPrompt: '',
      testingModelOverrides: { tdd: 'local/deepseek-coder' },
    }];

    const result = resolveTestingModelOverride(
      'tdd',
      { id: 'tdd', enabled: true, assignedAgentId: 'qa-agent' },
      agents,
    );
    expect(result).toBe('local/deepseek-coder');
  });

  it('returns undefined when assigned agent has no override for the methodology', () => {
    agents = [{
      id: 'qa-agent',
      name: 'QA Agent',
      role: 'tester',
      description: 'QA',
      systemPrompt: '',
      testingModelOverrides: { bdd: 'some/model' },
    }];

    const result = resolveTestingModelOverride(
      'tdd',
      { id: 'tdd', enabled: true, assignedAgentId: 'qa-agent' },
      agents,
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when assignedAgentId does not exist in the agents list', () => {
    const result = resolveTestingModelOverride(
      'tdd',
      { id: 'tdd', enabled: true, assignedAgentId: 'nonexistent-agent' },
      agents,
    );
    expect(result).toBeUndefined();
  });

  it('assignedModelId takes priority over agent testingModelOverrides', () => {
    agents = [{
      id: 'qa-agent',
      name: 'QA Agent',
      role: 'tester',
      description: 'QA',
      systemPrompt: '',
      testingModelOverrides: { tdd: 'local/deepseek-coder' },
    }];

    const result = resolveTestingModelOverride(
      'tdd',
      { id: 'tdd', enabled: true, assignedAgentId: 'qa-agent', assignedModelId: 'anthropic/claude-haiku-4-5' },
      agents,
    );
    expect(result).toBe('anthropic/claude-haiku-4-5');
  });
});

// ── buildMethodologySystemPromptHint ─────────────────────────────

describe('buildMethodologySystemPromptHint', () => {
  it('returns a non-empty string for a known methodology id', () => {
    const hint = buildMethodologySystemPromptHint('tdd');
    expect(hint.length).toBeGreaterThan(0);
  });

  it('includes the methodology label', () => {
    const hint = buildMethodologySystemPromptHint('bdd');
    expect(hint).toContain('BDD');
  });

  it('includes when-to-apply guidance', () => {
    const hint = buildMethodologySystemPromptHint('unit');
    expect(hint).toContain('When to apply:');
  });

  it('includes key tools section', () => {
    const hint = buildMethodologySystemPromptHint('e2e');
    expect(hint).toContain('Key tools:');
  });

  it('returns empty string for an unknown methodology id', () => {
    const hint = buildMethodologySystemPromptHint('nonexistent' as never);
    expect(hint).toBe('');
  });

  it('includes step-reporting instruction', () => {
    const hint = buildMethodologySystemPromptHint('continuous');
    expect(hint).toContain('Report');
  });
});
