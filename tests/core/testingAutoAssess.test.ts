import { describe, expect, it } from 'vitest';
import { assessTestingMethodologies, type ProjectTestingEvidence } from '../../src/core/testingAutoAssess.ts';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../../src/types.ts';

/**
 * Auto-assess answered the wrong question. It matched every signal as a bare
 * substring against one corpus that included three kilobytes of README, so it
 * reported what a project *said about itself* as though it were a fact about
 * the code. Measured on this repository before the change, twelve policies
 * fired on README prose alone — PCI-DSS, bias & fairness and model-output risk
 * classification among them, on a VS Code extension that handles no card data
 * and makes no automated decision about a person.
 *
 * These tests pin the rules that fixed it, because a heuristic with no tests
 * gets worse silently and nobody can tell which change did it.
 */
function evidence(partial: Partial<ProjectTestingEvidence> = {}): ProjectTestingEvidence {
  return { dependencies: [], scripts: [], paths: [], ...partial };
}

function basisOf(result: ReturnType<typeof assessTestingMethodologies>, id: string) {
  return result.policies.find(p => p.id === id)?.basis;
}

function ticked(result: ReturnType<typeof assessTestingMethodologies>): string[] {
  return result.policies.filter(p => p.recommended).map(p => p.id);
}

describe('code decides, prose only proposes', () => {
  it('ticks a policy whose tooling is a real dependency', () => {
    const result = assessTestingMethodologies(evidence({ dependencies: ['@stryker-mutator/core'] }));
    expect(basisOf(result, 'mutation')).toBe('observed');
    expect(ticked(result)).toContain('mutation');
  });

  it('does not tick a policy that only the README mentions', () => {
    // The exact failure this module exists to stop: a project describing itself
    // as handling payments gets PCI-DSS switched on without a payment
    // dependency anywhere in it.
    const result = assessTestingMethodologies(evidence({
      prose: 'A friendly platform for merchants handling cardholder payment flows.',
    }));
    expect(basisOf(result, 'pci-dss')).toBe('stated');
    expect(ticked(result)).not.toContain('pci-dss');
  });

  it('ticks the same policy once the dependency is actually there', () => {
    const result = assessTestingMethodologies(evidence({ dependencies: ['stripe'] }));
    expect(basisOf(result, 'pci-dss')).toBe('observed');
    expect(ticked(result)).toContain('pci-dss');
  });

  it('still surfaces a prose-only policy rather than hiding it', () => {
    // Suppressing it would be a different failure: the user could no longer
    // declare an intention the code has not caught up with yet.
    const result = assessTestingMethodologies(evidence({ prose: 'medical device, safety-critical' }));
    const raised = result.policies.map(p => p.id);
    expect(raised).toContain('v-model');
    expect(result.policies.find(p => p.id === 'v-model')?.reason).toMatch(/description/i);
  });

  it('never reports a prose match as found in the code', () => {
    const result = assessTestingMethodologies(evidence({ prose: 'kubernetes microservice openapi stripe hipaa' }));
    const lying = result.policies.filter(p => p.basis === 'stated' && /found in the code/i.test(p.reason));
    expect(lying).toEqual([]);
  });
});

describe('signal matching has real word boundaries', () => {
  it('does not match a signal inside a longer word', () => {
    // `api` inside `rapid` switched on integration testing for any project whose
    // marketing copy used the word.
    const result = assessTestingMethodologies(evidence({ prose: 'rapid scalable capability' }));
    expect(result.policies.find(p => p.id === 'integration')).toBeUndefined();
  });

  it('does not match a shorter signal inside a related longer one', () => {
    // `api` must not match inside `openapi` — they are different signals
    // belonging to different policies.
    const result = assessTestingMethodologies(evidence({ paths: ['openapi.yaml'] }));
    expect(basisOf(result, 'sdd')).toBe('observed');
  });

  it('matches across a hyphen, which is a boundary and not a letter', () => {
    const result = assessTestingMethodologies(evidence({ prose: 'we are api-first here' }));
    expect(result.policies.find(p => p.id === 'sdd')?.matched).toContain('api-first');
  });

  it('matches hyphenated and slashed signals literally', () => {
    const result = assessTestingMethodologies(evidence({ dependencies: ['fast-check'] }));
    expect(basisOf(result, 'property')).toBe('observed');
  });
});

describe('one ambiguous word is a hint, not a finding', () => {
  it('does not tick SOC 2 because a script runs npm audit', () => {
    const result = assessTestingMethodologies(evidence({ scripts: ['audit', 'npm audit --production'] }));
    expect(basisOf(result, 'soc2')).toBe('ambiguous');
    expect(ticked(result)).not.toContain('soc2');
  });

  it('does not tick data-quality because the project has a CI pipeline', () => {
    const result = assessTestingMethodologies(evidence({ paths: ['.github/workflows'] }));
    expect(basisOf(result, 'data-quality')).toBe('ambiguous');
    // The same fact is decisive for the policy it genuinely evidences.
    expect(basisOf(result, 'continuous')).toBe('observed');
  });

  it('does not tick SLSA provenance because GitHub Actions exists', () => {
    const result = assessTestingMethodologies(evidence({ paths: ['.github/workflows'] }));
    expect(ticked(result)).not.toContain('secure-build-pipeline');
  });

  it('ticks it once the signing tooling is actually present', () => {
    const result = assessTestingMethodologies(evidence({ dependencies: ['cosign', 'sigstore'] }));
    expect(basisOf(result, 'secure-build-pipeline')).toBe('observed');
  });

  it('treats two ambiguous words together as a pattern', () => {
    // One generic word is a hint; several describe a shape.
    const one = assessTestingMethodologies(evidence({ dependencies: ['redis'] }));
    const several = assessTestingMethodologies(evidence({ dependencies: ['redis', 'pg', 'kafkajs'] }));
    expect(basisOf(one, 'integration')).toBe('ambiguous');
    expect(basisOf(several, 'integration')).toBe('observed');
  });

  it('always explains why an ambiguous match was not ticked', () => {
    const result = assessTestingMethodologies(evidence({ scripts: ['npm audit'] }));
    for (const policy of result.policies.filter(p => p.basis === 'ambiguous')) {
      expect(policy.reason).toMatch(/different things in different projects/i);
      expect(policy.recommended).toBe(false);
    }
  });
});

describe('derived signals read facts the package name does not spell out', () => {
  it('recognises a model-backed project from its SDK', () => {
    // Nothing in `@anthropic-ai/sdk` contains the word `prompt`.
    const result = assessTestingMethodologies(evidence({
      dependencies: ['@anthropic-ai/sdk', 'openai', 'langchain'],
    }));
    expect(ticked(result)).toContain('prompt-regression');
  });

  it('recognises a migration story from the directory, not just the tool', () => {
    const result = assessTestingMethodologies(evidence({ paths: ['prisma/migrations'] }));
    expect(basisOf(result, 'schema-migration')).toBe('observed');
  });

  it('recognises authorization work from a policy engine', () => {
    const result = assessTestingMethodologies(evidence({ dependencies: ['cerbos', 'casbin'] }));
    expect(ticked(result)).toContain('rbac-compliance');
  });

  it('reads dependencies out of a non-Node manifest', () => {
    // Only `package.json` was ever parsed, so a Python project was assessed
    // almost entirely on its README.
    const result = assessTestingMethodologies(evidence({
      dependencies: ['[tool.poetry.dependencies]\nhypothesis = "^6"\nalembic = "^1"\n'],
      paths: ['pyproject.toml'],
    }));
    expect(basisOf(result, 'property')).toBe('observed');
    expect(basisOf(result, 'schema-migration')).toBe('observed');
  });
});

describe('the project shape can withhold, and existing evidence overrules it', () => {
  it('does not propose a policy the shape can never evidence', () => {
    const result = assessTestingMethodologies(evidence({
      dependencies: ['react'],
      archetype: 'api',
    }));
    expect(basisOf(result, 'visual')).toBe('discouraged');
    expect(ticked(result)).not.toContain('visual');
  });

  it('names the reason rather than silently dropping it', () => {
    const result = assessTestingMethodologies(evidence({ archetype: 'api' }));
    const suppressed = result.policies.filter(p => p.basis === 'discouraged');
    expect(suppressed.length).toBeGreaterThan(0);
    expect(suppressed.every(p => p.reason.length > 30)).toBe(true);
  });

  it('keeps a discouraged policy the repository is demonstrably already doing', () => {
    // A file on disk beats a heuristic about what this kind of project usually
    // needs. Reporting it as unsuited while its tests run on every commit would
    // be the tool arguing with the evidence.
    const result = assessTestingMethodologies(evidence({
      archetype: 'api',
      alreadyEvidenced: ['visual'],
    }));
    expect(basisOf(result, 'visual')).toBe('evidenced');
    expect(ticked(result)).toContain('visual');
  });
});

describe('unassessed is never reported as nothing found', () => {
  it('carries what could not be read into the summary', () => {
    const result = assessTestingMethodologies(evidence({ unreadable: ['pyproject.toml'] }));
    expect(result.unassessed).toEqual(['pyproject.toml']);
    expect(result.summary).toMatch(/partial/i);
    expect(result.summary).toContain('pyproject.toml');
  });

  it('says nothing about partial readings when everything was readable', () => {
    expect(assessTestingMethodologies(evidence()).summary).not.toMatch(/partial/i);
  });

  it('still recommends the universal policies with no evidence at all', () => {
    // An empty project is not a project with no testing policy.
    const result = assessTestingMethodologies(evidence());
    expect(ticked(result).sort()).toEqual(['tdd', 'unit']);
  });
});

describe('the assessment stays inside the catalogue', () => {
  it('never invents a policy id', () => {
    const known = new Set(TESTING_METHODOLOGY_DEFINITIONS.map(d => d.id));
    const result = assessTestingMethodologies(evidence({
      dependencies: ['react', 'stripe', 'openai', 'prisma'],
      prose: 'hipaa gdpr aviation',
    }));
    expect(result.policies.filter(p => !known.has(p.id))).toEqual([]);
  });

  it('lists each policy at most once', () => {
    const result = assessTestingMethodologies(evidence({
      dependencies: ['react', 'stripe', 'openai'],
      prose: 'react stripe openai',
    }));
    const ids = result.policies.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts exactly what it ticks', () => {
    const result = assessTestingMethodologies(evidence({ dependencies: ['stripe', 'react'] }));
    expect(result.recommendedCount).toBe(ticked(result).length);
    expect(result.summary).toContain(String(result.recommendedCount));
  });

  it('orders ticked policies before proposals', () => {
    const result = assessTestingMethodologies(evidence({
      dependencies: ['@stryker-mutator/core'],
      prose: 'hipaa aviation do-178',
      archetype: 'api',
    }));
    const firstProposal = result.policies.findIndex(p => !p.recommended);
    const lastTicked = result.policies.map(p => p.recommended).lastIndexOf(true);
    expect(lastTicked).toBeLessThan(firstProposal);
  });
});
