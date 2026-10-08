import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  AUTO_REASONING_RULES,
  AUTO_UNPROFILED_RULE,
  BUDGET_STEP_DOWN_RULE,
  DEEP_REASONING_CAPABLE_BONUS,
  EXPLICIT_PREFERENCE_RULE,
  REASONING_CONTROLS,
  REASONING_CONTROLS_VERIFIED_AT,
  REASONING_LEVEL_COSTS,
  REASONING_LEVELS,
  REASONING_PREFERENCES,
  REASONING_REPLY_ROOM_TOKENS,
  buildReasoningDecision,
  describeReasoningDecision,
  fitReasoningLevelToBudget,
  modelReasoningControl,
  planReasoningRequest,
  projectedThinkingTokens,
  reasoningMaxTokens,
  reasoningOutputMultiplier,
  resolveReasoningLevel,
  sanitizeReasoningPreference,
  scoreReasoningFit,
} from '../../src/core/reasoningBudget.ts';
import type { ModelInfo, ReasoningControlId, ReasoningLevel, TaskReasoning } from '../../src/types.ts';

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'anthropic/claude-opus-5-5',
    provider: 'anthropic',
    name: 'Claude Opus 5.5',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.004,
    outputPricePer1k: 0.02,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
    enabled: true,
    ...overrides,
  };
}

const CONTROL_IDS = Object.keys(REASONING_CONTROLS) as ReasoningControlId[];

describe('the declared tables', () => {
  it('states when the vendor shapes were verified, as a calendar date', () => {
    expect(REASONING_CONTROLS_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('maps every profiler tier through exactly one auto rule, so auto never falls through', () => {
    const tiers: TaskReasoning[] = ['low', 'medium', 'high'];
    for (const tier of tiers) {
      expect(AUTO_REASONING_RULES.filter(rule => rule.when === tier)).toHaveLength(1);
    }
    expect(new Set(AUTO_REASONING_RULES.map(rule => rule.id)).size).toBe(AUTO_REASONING_RULES.length);
  });

  it('orders auto monotonically: a harder task never resolves to less thinking', () => {
    const rank = (level: ReasoningLevel) => REASONING_LEVELS.indexOf(level);
    const low = AUTO_REASONING_RULES.find(rule => rule.when === 'low')!;
    const medium = AUTO_REASONING_RULES.find(rule => rule.when === 'medium')!;
    const high = AUTO_REASONING_RULES.find(rule => rule.when === 'high')!;
    expect(rank(low.level)).toBeLessThan(rank(medium.level));
    expect(rank(medium.level)).toBeLessThan(rank(high.level));
  });

  it('gives every control a value for every level and a published source', () => {
    for (const id of CONTROL_IDS) {
      const spec = REASONING_CONTROLS[id];
      expect(spec.providers.length).toBeGreaterThan(0);
      expect(spec.source).toMatch(/^https:\/\//);
      for (const level of REASONING_LEVELS) {
        expect(['low', 'medium', 'high']).toContain(spec.values[level]);
      }
    }
  });

  it('projects more thinking, and a higher output multiplier, at each step up', () => {
    expect(REASONING_LEVEL_COSTS.minimal.projectedThinkingTokens).toBeLessThan(REASONING_LEVEL_COSTS.standard.projectedThinkingTokens);
    expect(REASONING_LEVEL_COSTS.standard.projectedThinkingTokens).toBeLessThan(REASONING_LEVEL_COSTS.deep.projectedThinkingTokens);
    expect(REASONING_LEVEL_COSTS.minimal.outputMultiplier).toBeLessThan(REASONING_LEVEL_COSTS.standard.outputMultiplier);
    expect(REASONING_LEVEL_COSTS.standard.outputMultiplier).toBeLessThan(REASONING_LEVEL_COSTS.deep.outputMultiplier);
    // Gemini 2.5 is the one vendor that publishes budgets per level; the
    // planning figures are declared to match them rather than invented.
    expect(REASONING_LEVEL_COSTS.minimal.projectedThinkingTokens).toBe(1_024);
    expect(REASONING_LEVEL_COSTS.standard.projectedThinkingTokens).toBe(8_192);
    expect(REASONING_LEVEL_COSTS.deep.projectedThinkingTokens).toBe(24_576);
  });
});

describe('sanitizeReasoningPreference', () => {
  it('passes the four declared values through', () => {
    for (const preference of REASONING_PREFERENCES) {
      expect(sanitizeReasoningPreference(preference)).toBe(preference);
    }
  });

  it('treats anything else as auto, never as deep', () => {
    for (const value of ['DEEP', 'max', '', null, undefined, 3, {}, ['deep']]) {
      expect(sanitizeReasoningPreference(value)).toBe('auto');
    }
  });
});

describe('resolveReasoningLevel', () => {
  it('honours an explicit preference and names the rule', () => {
    const resolution = resolveReasoningLevel('deep', { reasoning: 'low' });
    expect(resolution).toMatchObject({ level: 'deep', rule: EXPLICIT_PREFERENCE_RULE.id });
  });

  it.each([
    ['low', 'minimal', 'auto-low'],
    ['medium', 'standard', 'auto-medium'],
    ['high', 'deep', 'auto-high'],
  ] as const)('auto on a %s task resolves to %s by %s', (tier, level, rule) => {
    expect(resolveReasoningLevel('auto', { reasoning: tier })).toMatchObject({ preference: 'auto', level, rule });
  });

  it('auto with no profile uses the middle level rather than assuming depth', () => {
    expect(resolveReasoningLevel('auto')).toMatchObject({ level: 'standard', rule: AUTO_UNPROFILED_RULE.id });
  });
});

describe('planReasoningRequest', () => {
  it('maps a level onto the vendor value for a declared model', () => {
    const plan = planReasoningRequest(model({ reasoningControl: 'anthropic-effort' }), 'deep');
    expect(plan).toEqual({
      kind: 'applied',
      directive: { control: 'anthropic-effort', level: 'deep', value: 'high', rule: 'anthropic-effort:deep' },
      parameter: 'output_config.effort=high',
    });
  });

  it('sends nothing to a model with no declared control, and says why', () => {
    expect(planReasoningRequest(model(), 'deep')).toMatchObject({ kind: 'not-sent', rule: 'no-declared-control' });
  });

  it('sends nothing for an unknown model', () => {
    expect(planReasoningRequest(undefined, 'deep')).toMatchObject({ kind: 'not-sent', rule: 'unknown-model' });
  });

  it('refuses a control declared on a provider whose adapter does not implement it', () => {
    // A Claude row reached through Copilot must never carry Anthropic's field.
    const viaCopilot = model({ id: 'copilot/claude-opus-5-5', provider: 'copilot', reasoningControl: 'anthropic-effort' });
    expect(planReasoningRequest(viaCopilot, 'deep')).toMatchObject({ kind: 'not-sent', rule: 'provider-does-not-implement-control' });
    expect(modelReasoningControl(viaCopilot)).toBeUndefined();
  });

  it('refuses a control id nobody declared, even if one is smuggled onto the model', () => {
    const forged = model({ reasoningControl: 'made-up-control' as unknown as ReasoningControlId });
    expect(modelReasoningControl(forged)).toBeUndefined();
    expect(planReasoningRequest(forged, 'deep').kind).toBe('not-sent');
  });

  it('property: a request never carries a reasoning parameter to a model not declared capable on its provider', () => {
    const providers = ['anthropic', 'openai', 'google', 'copilot', 'bedrock', 'deepseek', 'local', 'openrouter', 'azure'];
    fc.assert(fc.property(
      fc.constantFrom(...providers),
      fc.option(fc.constantFrom<ReasoningControlId | 'bogus'>(...CONTROL_IDS, 'bogus'), { nil: undefined }),
      fc.constantFrom(...REASONING_LEVELS),
      (provider, control, level) => {
        const candidate = model({ id: `${provider}/x`, provider, ...(control ? { reasoningControl: control as ReasoningControlId } : {}) });
        const plan = planReasoningRequest(candidate, level);
        const declaredOnProvider = control !== undefined
          && control !== 'bogus'
          && REASONING_CONTROLS[control].providers.includes(provider);
        if (plan.kind === 'applied') {
          expect(declaredOnProvider).toBe(true);
          expect(plan.directive.control).toBe(control);
          expect(plan.directive.value).toBe(REASONING_CONTROLS[plan.directive.control].values[level]);
        } else {
          expect(declaredOnProvider).toBe(false);
        }
      },
    ));
  });
});

describe('cost projection', () => {
  it('adds projected thinking only for an applied plan', () => {
    expect(projectedThinkingTokens(undefined)).toBe(0);
    expect(projectedThinkingTokens(planReasoningRequest(model(), 'deep'))).toBe(0);
    expect(projectedThinkingTokens(planReasoningRequest(model({ reasoningControl: 'anthropic-effort' }), 'deep'))).toBe(24_576);
  });

  it('raises the output multiplier only for a capable model', () => {
    expect(reasoningOutputMultiplier(model(), 'deep')).toBe(1);
    expect(reasoningOutputMultiplier(model({ thinkingTokenMultiplier: 3 }), 'deep')).toBe(3);
    expect(reasoningOutputMultiplier(model({ reasoningControl: 'anthropic-effort' }), undefined)).toBe(1);
    expect(reasoningOutputMultiplier(model({ reasoningControl: 'anthropic-effort' }), 'deep')).toBe(4);
    // A declared multiplier already larger than the level's is never lowered.
    expect(reasoningOutputMultiplier(model({ reasoningControl: 'anthropic-effort', thinkingTokenMultiplier: 6 }), 'minimal')).toBe(6);
  });

  it('prefers a capable model only when deep is wanted; unknown capability earns nothing', () => {
    const capable = model({ reasoningControl: 'anthropic-effort' });
    expect(scoreReasoningFit(capable, 'deep')).toBe(DEEP_REASONING_CAPABLE_BONUS);
    expect(scoreReasoningFit(capable, 'standard')).toBe(0);
    expect(scoreReasoningFit(capable, undefined)).toBe(0);
    expect(scoreReasoningFit(model(), 'deep')).toBe(0);
  });
});

describe('reasoningMaxTokens', () => {
  const deep = { control: 'anthropic-effort', level: 'deep', value: 'high', rule: 'anthropic-effort:deep' } as const;

  it('passes the requested ceiling through when nothing is sent', () => {
    expect(reasoningMaxTokens(undefined, 2_400, 100_000)).toBe(2_400);
  });

  it('makes room for the projected thinking plus a reply', () => {
    expect(reasoningMaxTokens(deep, 2_400, 100_000)).toBe(24_576 + REASONING_REPLY_ROOM_TOKENS);
  });

  it('never exceeds what the context window can hold, and never shrinks the request', () => {
    expect(reasoningMaxTokens(deep, 2_400, 10_000)).toBe(10_000);
    expect(reasoningMaxTokens(deep, 2_400, 1_000)).toBe(2_400);
    expect(reasoningMaxTokens(deep, 50_000, 100_000)).toBe(50_000);
  });
});

describe('fitReasoningLevelToBudget', () => {
  const deepAuto = resolveReasoningLevel('auto', { reasoning: 'high' });
  const priceAt = (level: ReasoningLevel) => ({ minimal: 0.01, standard: 0.05, deep: 0.2 })[level];

  it('keeps the level and its rule when there is no cap', () => {
    expect(fitReasoningLevelToBudget(deepAuto, priceAt, undefined)).toEqual({ level: 'deep', rule: 'auto-high', describes: deepAuto.describes });
    expect(fitReasoningLevelToBudget(deepAuto, priceAt, 0).level).toBe('deep');
  });

  it('keeps the level when its projection fits the cap', () => {
    expect(fitReasoningLevelToBudget(deepAuto, priceAt, 0.5)).toMatchObject({ level: 'deep', rule: 'auto-high' });
  });

  it('steps down to the highest level that fits, naming the step', () => {
    expect(fitReasoningLevelToBudget(deepAuto, priceAt, 0.1)).toEqual({
      level: 'standard',
      rule: BUDGET_STEP_DOWN_RULE.id,
      describes: BUDGET_STEP_DOWN_RULE.describes,
      steppedFrom: 'deep',
    });
  });

  it('keeps minimal when nothing fits — refusing is the cap’s job', () => {
    expect(fitReasoningLevelToBudget(deepAuto, priceAt, 0.001)).toMatchObject({ level: 'minimal', steppedFrom: 'deep' });
    const minimal = resolveReasoningLevel('minimal');
    expect(fitReasoningLevelToBudget(minimal, priceAt, 0.001)).toMatchObject({ level: 'minimal', rule: EXPLICIT_PREFERENCE_RULE.id });
  });

  it('property: never steps up, and whatever it keeps fits the cap unless it is minimal', () => {
    fc.assert(fc.property(
      fc.constantFrom(...REASONING_LEVELS),
      fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })),
      fc.double({ min: 0.0001, max: 2, noNaN: true }),
      (level, [a, b, c], cap) => {
        const sorted = [a, b, c].sort((x, y) => x - y);
        const cost = (l: ReasoningLevel) => sorted[REASONING_LEVELS.indexOf(l)];
        const fitted = fitReasoningLevelToBudget(resolveReasoningLevel(level), cost, cap);
        expect(REASONING_LEVELS.indexOf(fitted.level)).toBeLessThanOrEqual(REASONING_LEVELS.indexOf(level));
        if (fitted.level !== 'minimal') {
          expect(cost(fitted.level)).toBeLessThanOrEqual(cap);
        }
      },
    ));
  });
});

describe('the decision a routing explanation shows', () => {
  it('names the level, its rule and the parameter sent', () => {
    const fitted = fitReasoningLevelToBudget(resolveReasoningLevel('auto', { reasoning: 'high' }), () => 0, undefined);
    const plan = planReasoningRequest(model({ reasoningControl: 'anthropic-effort' }), fitted.level);
    const decision = buildReasoningDecision('auto', fitted, 'anthropic/claude-opus-5-5', plan);
    expect(decision).toEqual({
      preference: 'auto',
      level: 'deep',
      levelRule: 'auto-high',
      model: 'anthropic/claude-opus-5-5',
      outcome: 'applied',
      parameter: 'output_config.effort=high',
    });
    expect(describeReasoningDecision(decision)).toBe(
      'Reasoning: auto → deep (rule: auto-high); sent output_config.effort=high to anthropic/claude-opus-5-5.',
    );
  });

  it('says plainly when nothing was sent, and why', () => {
    const fitted = fitReasoningLevelToBudget(resolveReasoningLevel('deep'), () => 0, undefined);
    const decision = buildReasoningDecision('deep', fitted, 'copilot/gpt-4o', planReasoningRequest(model({ id: 'copilot/gpt-4o', provider: 'copilot' }), 'deep'));
    expect(decision.outcome).toBe('not-sent');
    expect(decision.parameter).toBeUndefined();
    expect(describeReasoningDecision(decision)).toBe(
      'Reasoning: deep (rule: explicit-preference); nothing sent to copilot/gpt-4o (no-declared-control).',
    );
  });
});
