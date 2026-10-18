/**
 * Model Routing Correctness for the reasoning axis: table-driven routes, the
 * cost each route is projected at, and failover when the preferred model is
 * unavailable. The axis must change a choice only when it was asked to.
 */
import { describe, expect, it } from 'vitest';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import type { ModelInfo, ProviderConfig, ReasoningPreference, RoutingConstraints, TaskProfile } from '../../src/types.ts';

/** Same price, same depth; only one declares a reasoning control. */
const CAPABLE: ModelInfo = {
  id: 'anthropic/claude-opus-5-5',
  provider: 'anthropic',
  name: 'Claude Opus 5.5',
  contextWindow: 1_000_000,
  inputPricePer1k: 0.004,
  outputPricePer1k: 0.02,
  capabilities: ['chat', 'code', 'reasoning'],
  reasoningDepth: 3,
  latencyClass: 'balanced',
  reasoningControl: 'anthropic-effort',
  enabled: true,
};
const UNDECLARED: ModelInfo = {
  ...CAPABLE,
  id: 'other/reasoner',
  provider: 'other',
  name: 'Undeclared reasoner',
  reasoningControl: undefined,
};

function provider(id: string, models: ModelInfo[]): ProviderConfig {
  return { id, displayName: id, apiKeySettingKey: '', enabled: true, pricingModel: 'pay-per-token', models };
}

function routerWith(models: ModelInfo[]): ModelRouter {
  const router = new ModelRouter();
  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of models) {
    byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
  }
  for (const [id, list] of byProvider) {
    router.registerProvider(provider(id, list));
  }
  return router;
}

const HIGH: TaskProfile = { phase: 'execution', modality: 'text', reasoning: 'high', requiresTools: false, requiredCapabilities: [], preferredCapabilities: ['chat', 'reasoning'] };
const LOW: TaskProfile = { ...HIGH, reasoning: 'low', preferredCapabilities: ['chat'] };

function constraints(reasoning?: ReasoningPreference): RoutingConstraints {
  return { budget: 'expensive', speed: 'considered', ...(reasoning ? { reasoning } : {}) };
}

describe('routes by reasoning preference (table-driven)', () => {
  const cases: Array<{ name: string; reasoning?: ReasoningPreference; profile: TaskProfile; expected: string }> = [
    { name: 'deep explicitly → the declared model', reasoning: 'deep', profile: LOW, expected: CAPABLE.id },
    { name: 'auto on a high-reasoning task → the declared model', reasoning: 'auto', profile: HIGH, expected: CAPABLE.id },
    { name: 'minimal → the undeclared model, whose output is not projected to grow', reasoning: 'minimal', profile: HIGH, expected: UNDECLARED.id },
    { name: 'standard → the undeclared model (no depth bonus, higher projected output on the capable one)', reasoning: 'standard', profile: HIGH, expected: UNDECLARED.id },
    { name: 'auto on a low-reasoning task → the undeclared model', reasoning: 'auto', profile: LOW, expected: UNDECLARED.id },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const router = routerWith([CAPABLE, UNDECLARED]);
      expect(router.selectModel(constraints(testCase.reasoning), undefined, testCase.profile)).toBe(testCase.expected);
    });
  }
});

describe('the axis changes nothing when nobody asked for it', () => {
  it('selects exactly what a router without any declared control selects', () => {
    for (const profile of [HIGH, LOW]) {
      const withControl = routerWith([CAPABLE, UNDECLARED]).selectModel(constraints(), undefined, profile);
      const withoutControl = routerWith([{ ...CAPABLE, reasoningControl: undefined }, UNDECLARED]).selectModel(constraints(), undefined, profile);
      expect(withControl).toBe(withoutControl);
    }
  });
});

describe('cost per route accounts for thinking billed as output', () => {
  it('a deeper level never makes a declared model look cheaper (cheap budget prefers the undeclared one at deep)', () => {
    // Under a cheap budget the cost weight dominates, so a capable model whose
    // output is projected at 4× must lose to an equally priced undeclared model —
    // the depth bonus is not allowed to hide the thinking bill.
    const router = routerWith([CAPABLE, UNDECLARED].map(model => ({ ...model, inputPricePer1k: 0.0001, outputPricePer1k: 0.0004 })));
    expect(router.selectModel({ budget: 'cheap', speed: 'balanced', reasoning: 'deep' }, undefined, HIGH)).toBe(UNDECLARED.id);
  });

  it('keeps budget gates on listed prices, so deep cannot unlock a tier the budget excludes', () => {
    const premium: ModelInfo = { ...CAPABLE, id: 'anthropic/claude-fable-5-1', inputPricePer1k: 0.01, outputPricePer1k: 0.05 };
    const cheap: ModelInfo = { ...UNDECLARED, inputPricePer1k: 0.0001, outputPricePer1k: 0.0004 };
    const router = routerWith([premium, cheap]);
    expect(router.listCandidateModelIds({ budget: 'cheap', speed: 'balanced', reasoning: 'deep' }, undefined, HIGH)).toEqual([cheap.id]);
  });
});

describe('failover with reasoning unsupported', () => {
  it('routes to the undeclared model when the declared one has failed — unknown is routable', () => {
    const router = routerWith([CAPABLE, UNDECLARED]);
    router.recordModelFailure(CAPABLE.id, 'boom');
    expect(router.selectModel(constraints('deep'), undefined, HIGH)).toBe(UNDECLARED.id);
  });

  it('still routes when no model declares a control at all', () => {
    const router = routerWith([UNDECLARED]);
    expect(router.selectModel(constraints('deep'), undefined, HIGH)).toBe(UNDECLARED.id);
  });
});
