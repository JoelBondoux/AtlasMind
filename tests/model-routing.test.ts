import { describe, it, expect } from 'vitest';
import { ModelRouter, preferNativeToolCandidates } from '../src/core/modelRouter.js';
import { ACP_EFFORT_TIERS, ACP_MODEL_CATEGORY, acpModelChoicesFor, acpModelRows, describeAcpModelStanding } from '../src/providers/acpModels.js';
import type { ModelInfo, ProviderConfig } from '../src/types.js';

/**
 * Which model gets the work, and whether that decision can be relied on.
 *
 * `tests/core/modelRouter.test.ts` covers the router's rules case by case —
 * preferred providers, quota, failover, struggle escape. This file asks the two
 * questions that are properties of the decision *as a whole* rather than of any
 * one rule, and that a case-by-case suite cannot see.
 *
 * **Does it collapse?** A router that returns the same model for every request
 * passes every assertion of the form "it returned a model". It spends nothing,
 * looks healthy, and quietly sends every refactor to a model that cannot do it.
 * The failure shape is a classifier that has learned to answer one class.
 *
 * **Can it be over-satisfied?** A capability is a hard requirement, and the
 * expensive mistake is approximate satisfaction — sending vision work to a text
 * model produces a confident wrong answer rather than a failure anybody notices.
 * Refusing to route is the correct answer when nothing eligible qualifies.
 *
 * The same asymmetry runs through `acpModels`: a model whose standing cannot be
 * determined must stay *routable*, because dropping it hides capacity for
 * exactly the newest model — the one the user is most likely to be paying for —
 * while never being *preferred*, because its rank was never established.
 */

function providers(): ProviderConfig[] {
  return [
    {
      id: 'openai',
      displayName: 'OpenAI',
      apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'openai/gpt-4o-mini',
          provider: 'openai',
          name: 'GPT-4o mini',
          contextWindow: 128000,
          inputPricePer1k: 0.00015,
          outputPricePer1k: 0.0006,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
        {
          id: 'openai/gpt-4o',
          provider: 'openai',
          name: 'GPT-4o',
          contextWindow: 128000,
          inputPricePer1k: 0.0025,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      apiKeySettingKey: 'atlasmind.provider.anthropic.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'anthropic/claude-haiku',
          provider: 'anthropic',
          name: 'Claude Haiku',
          contextWindow: 200000,
          inputPricePer1k: 0.0008,
          outputPricePer1k: 0.004,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
        {
          id: 'anthropic/claude-opus',
          provider: 'anthropic',
          name: 'Claude Opus',
          contextWindow: 200000,
          inputPricePer1k: 0.015,
          outputPricePer1k: 0.075,
          capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
  ];
}

function router(): ModelRouter {
  const instance = new ModelRouter();
  for (const provider of providers()) {
    instance.registerProvider(provider);
  }
  return instance;
}

describe('the router does not collapse to one answer', () => {
  it('returns more than one model across the range of requests', () => {
    // The collapse test. A router returning the same model for every input
    // passes any assertion of the form "it returned a model".
    //
    // Capability is varied alongside budget and speed on purpose. Budget and
    // speed alone do *not* move this router when every model can do the work —
    // the cheapest eligible one wins at every budget, which is a deliberate
    // cost policy rather than a collapse, and is pinned separately below. What
    // would be a collapse is a router that cannot be moved by anything.
    const chosen = new Set<string>();
    for (const budget of ['cheap', 'balanced', 'expensive'] as const) {
      for (const speed of ['fast', 'balanced', 'thorough'] as const) {
        chosen.add(router().selectModel({ budget, speed }));
        chosen.add(router().selectModel({ budget, speed, requiredCapabilities: ['reasoning'] }));
        chosen.add(router().selectModel({ budget, speed, preferredProvider: 'anthropic' }));
      }
    }

    expect(chosen.size, `the router chose only ${[...chosen]} for every request`).toBeGreaterThan(1);
  });

  it('changes its choice when the work states a harder requirement', () => {
    // The decision must respond to the stated ground rather than to nothing.
    // Note what this also documents: with no capability required, the cheapest
    // eligible model wins at *every* budget — `expensive` raises the ceiling,
    // it does not raise the spend. Only a requirement the cheap model cannot
    // meet moves the choice.
    const ordinary = router().selectModel({ budget: 'expensive', speed: 'thorough' });
    const needsReasoning = router().selectModel({
      budget: 'expensive',
      speed: 'thorough',
      requiredCapabilities: ['reasoning'],
    });

    expect(ordinary).toBe('openai/gpt-4o-mini');
    expect(needsReasoning).not.toBe(ordinary);
  });

  it('never returns a model that lacks a required capability', () => {
    // The safety half, and the one worth the most: a router that satisfied a
    // capability request approximately would send vision work to a text model
    // and produce a confident wrong answer rather than a failure.
    const all = providers().flatMap(provider => provider.models);

    for (const capability of ['reasoning', 'vision'] as const) {
      for (const budget of ['cheap', 'balanced', 'expensive'] as const) {
        const selected = router().selectModel({
          budget,
          speed: 'thorough',
          requiredCapabilities: [capability],
        });
        const model = all.find(entry => entry.id === selected);
        if (!model) {
          // Fell back to `local/echo-1` because nothing eligible could satisfy
          // the requirement at this budget. Refusing to route is the correct
          // answer; quietly returning a model without the capability is not.
          expect(selected).toBe('local/echo-1');
          continue;
        }
        expect(model.capabilities, `${selected} was chosen for ${capability} at ${budget}`).toContain(capability);
      }
    }
  });

  it('gives the same answer for the same request', () => {
    // Determinism is the fairness property that matters most here: two
    // identical turns must not be routed differently, or nobody can reason
    // about cost or quality at all.
    const first = router().selectModel({ budget: 'balanced', speed: 'balanced' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(router().selectModel({ budget: 'balanced', speed: 'balanced' })).toBe(first);
    }
  });

  it('honours an explicit provider preference over its own scoring', () => {
    const selected = router().selectModel({
      budget: 'balanced',
      speed: 'balanced',
      preferredProvider: 'anthropic',
    });
    expect(selected.startsWith('anthropic/')).toBe(true);
  });
});

describe('an unrecognised model is ranked unknown, never dropped', () => {
  const choices = acpModelChoicesFor([{
    category: ACP_MODEL_CATEGORY,
    options: [
      { value: 'claude-opus-4', name: 'Claude Opus 4' },
      { value: 'claude-haiku-4', name: 'Claude Haiku 4' },
      // Moon, earth, sun is etymology, not a vendor statement about capability.
      { value: 'luna', name: 'Luna' },
    ],
  }]);

  it('lists a model whose standing cannot be determined', () => {
    // Dropping it would hide capacity for exactly the newest model — the one a
    // vendor shipped after this release, and the one the user is paying for.
    expect(choices.map(choice => choice.slug), 'an unranked model disappeared').toContain('luna');
  });

  it('does not guess a standing from a name that only sounds ranked', () => {
    const luna = choices.find(choice => choice.slug === 'luna');
    expect(luna?.standing).toBe('unknown');
  });

  it('publishes the rule that decided each standing', () => {
    for (const choice of choices) {
      expect(choice.rule.trim().length, choice.slug).toBeGreaterThan(0);
      expect(describeAcpModelStanding(choice.standing).trim().length, choice.slug).toBeGreaterThan(0);
    }
  });

  it('does not prefer an unknown model on a number nobody stands behind', () => {
    // Routable but never *preferred*: an unknown standing carries no reasoning
    // depth, so it cannot win a comparison on a rank that was guessed.
    const luna = choices.find(choice => choice.slug === 'luna');
    expect(luna?.reasoningDepth).toBeUndefined();
    // And a recognised one does carry a depth, so the assertion above is a real
    // distinction rather than a field nothing ever sets.
    const opus = choices.find(choice => choice.slug.includes('opus'));
    expect(opus?.reasoningDepth).toBeGreaterThan(0);
  });

  it('offers every model before offering any model’s effort variants', () => {
    // Truncation must cost the least: a lineup too long for the cap should
    // still reach every model rather than every effort of the first two. The
    // opposite ordering hides whole models behind one model's variants.
    const rows = acpModelRows(choices, ACP_EFFORT_TIERS);
    const firstVariant = rows.findIndex(row => row.effort !== undefined);
    const lastBare = rows.map(row => row.effort === undefined).lastIndexOf(true);
    expect(lastBare).toBeLessThan(firstVariant === -1 ? rows.length : firstVariant);
  });
});

describe('delegation is a fallback, not an equal', () => {
  // A subscription-backed agent reports zero per-token cost, so treated as an
  // equal candidate it dominates every budget comparison there is. Observed in
  // the field: a session where every turn routed to an ACP agent, with much of
  // AtlasMind's own tooling dark and nothing saying so. AtlasMind sends such an
  // agent no tool schemas at all — it satisfies "function_calling" by running
  // its own tools instead.
  const native = (id: string): ModelInfo => ({
    id, name: id, provider: 'openai', contextWindow: 128_000,
    inputPricePer1k: 0.001, outputPricePer1k: 0.002,
    capabilities: ['chat', 'code', 'function_calling'], enabled: true,
  } as unknown as ModelInfo);
  const delegated = (id: string): ModelInfo => ({
    id, name: id, provider: 'acp', contextWindow: 200_000,
    inputPricePer1k: 0, outputPricePer1k: 0,
    capabilities: ['chat', 'code'], enabled: true, delegatedToolExecution: true,
  } as unknown as ModelInfo);

  const constraints = { budget: 'balanced', speed: 'balanced', allowDelegatedToolExecution: true } as never;

  it('drops delegated candidates when a native one can take the tools', () => {
    const kept = preferNativeToolCandidates(
      [delegated('acp/codex'), native('openai/gpt-4.1')], ['function_calling'], constraints,
    );
    expect(kept.map(model => model.id)).toEqual(['openai/gpt-4.1']);
  });

  it('keeps the delegated candidate when nothing else qualifies', () => {
    // The fallback half. Refusing the work outright would be worse than running
    // it with the agent's own tools.
    const kept = preferNativeToolCandidates([delegated('acp/codex')], ['function_calling'], constraints);
    expect(kept.map(model => model.id)).toEqual(['acp/codex']);
  });

  it('leaves a turn that needs no tools alone', () => {
    const kept = preferNativeToolCandidates(
      [delegated('acp/codex'), native('openai/gpt-4.1')], ['chat'], constraints,
    );
    expect(kept).toHaveLength(2);
  });

  it('does nothing when delegation was not permitted in the first place', () => {
    const kept = preferNativeToolCandidates(
      [native('openai/gpt-4.1')], ['function_calling'],
      { budget: 'balanced', speed: 'balanced' } as never,
    );
    expect(kept).toHaveLength(1);
  });
});
