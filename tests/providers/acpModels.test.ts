import { describe, expect, it } from 'vitest';
import {
  ACP_MAX_MODEL_ROWS_PER_AGENT,
  ACP_MODEL_RULE_NOTE,
  acpModelChoicesFor,
  acpModelRows,
  buildAcpModelId,
  composeAcpVariant,
  splitAcpModelSegment,
  type AcpModelChoice,
} from '../../src/providers/acpModels.ts';
import { ACP_EFFORT_TIERS, findAcpEffortTier } from '../../src/providers/acpEffort.ts';

/** Observed on live `claude-agent-acp`. `default` is the agent's own choice. */
const claudeOptions = [
  { id: 'mode', category: 'mode', options: [{ value: 'bypassPermissions', name: 'Bypass' }] },
  {
    id: 'model',
    category: 'model',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'opus[1m]', name: 'Opus' },
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'haiku', name: 'Haiku' },
      { value: 'fable', name: 'Fable' },
    ],
  },
];

/** Observed on live `codex-acp`. Nothing here names a documented tiering. */
const codexOptions = [
  {
    id: 'model',
    category: 'model',
    options: [
      { value: 'gpt-5.6-luna', name: 'Luna' },
      { value: 'gpt-5.6-terra', name: 'Terra' },
      { value: 'gpt-5.6-sol', name: 'Sol' },
    ],
  },
];

describe('the model list is detected, never declared', () => {
  it('reads whatever the agent offers', () => {
    expect(acpModelChoicesFor(claudeOptions).map(m => m.name)).toEqual(['Opus', 'Sonnet', 'Haiku', 'Fable']);
    expect(acpModelChoicesFor(codexOptions).map(m => m.name)).toEqual(['Luna', 'Terra', 'Sol']);
  });

  it('offers a model this build has never heard of', () => {
    // The failure that would make the feature rot: a vendor ships a model, the
    // user pays for it, and the router cannot see it because no table names it.
    const models = acpModelChoicesFor([
      { id: 'model', category: 'model', options: [{ value: 'brand-new-9', name: 'Nine' }] },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]!.value).toBe('brand-new-9');
  });

  it('returns nothing when the agent has no model knob', () => {
    // A perfectly ordinary answer, not an error — not every agent has one.
    expect(acpModelChoicesFor([{ id: 'effort', category: 'thought_level', options: [{ value: 'high' }] }])).toEqual([]);
    expect(acpModelChoicesFor([])).toEqual([]);
  });

  it('never reads a category other than model', () => {
    // `mode` carries `bypassPermissions`. A model list that swallowed it would
    // turn a routing choice into a privilege escalation.
    const models = acpModelChoicesFor(claudeOptions);
    expect(models.map(m => m.value)).not.toContain('bypassPermissions');
  });

  it('drops the agent-default sentinel rather than offering it twice', () => {
    // `default` is already the base row; a second id doing the same thing would
    // claim to be a choice.
    expect(acpModelChoicesFor(claudeOptions).map(m => m.value)).not.toContain('default');
  });

  it('preserves the agent\'s own ordering', () => {
    // Re-sorting by standing would impose a ranking the module admits it cannot
    // always determine.
    expect(acpModelChoicesFor(codexOptions).map(m => m.value))
      .toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']);
  });
});

describe('standing comes from a declared rule, and says which', () => {
  it('applies the naming conventions it is willing to stand behind', () => {
    const byName = new Map(acpModelChoicesFor(claudeOptions).map(m => [m.name, m]));
    expect(byName.get('Haiku')!.standing).toBe('light');
    expect(byName.get('Sonnet')!.standing).toBe('balanced');
    expect(byName.get('Opus')!.standing).toBe('deep');
  });

  it('reports a model it cannot place as unknown rather than guessing', () => {
    // Luna/terra/sol read as moon/earth/sun, which is etymology rather than a
    // vendor statement. A wrong ranking sends a refactor to the small model and
    // nobody finds out.
    for (const model of acpModelChoicesFor(codexOptions)) {
      expect(model.standing, model.name).toBe('unknown');
    }
    // Same for a Claude model with no documented tiering.
    expect(acpModelChoicesFor(claudeOptions).find(m => m.name === 'Fable')!.standing).toBe('unknown');
  });

  it('publishes the rule that decided, on every choice', () => {
    for (const model of [...acpModelChoicesFor(claudeOptions), ...acpModelChoicesFor(codexOptions)]) {
      expect(model.rule, model.name).toBeTruthy();
      expect(model.rule.length, model.name).toBeGreaterThan(15);
    }
  });

  it('lets the user declare what this build does not know', () => {
    const declared = { luna: 'light', terra: 'balanced', sol: 'deep' };
    const byName = new Map(acpModelChoicesFor(codexOptions, declared).map(m => [m.name, m]));
    expect(byName.get('Luna')!.standing).toBe('light');
    expect(byName.get('Terra')!.standing).toBe('balanced');
    expect(byName.get('Sol')!.standing).toBe('deep');
    expect(byName.get('Sol')!.rule).toContain('you declared');
  });

  it('matches a declaration against the display name as well as the wire value', () => {
    // `sol` should work without the user knowing it is `gpt-5.6-sol`.
    expect(acpModelChoicesFor(codexOptions, { Sol: 'deep' }).find(m => m.name === 'Sol')!.standing).toBe('deep');
    expect(acpModelChoicesFor(codexOptions, { 'gpt-5.6-sol': 'deep' }).find(m => m.name === 'Sol')!.standing).toBe('deep');
  });

  it('lets a declaration override a naming convention', () => {
    const models = acpModelChoicesFor(claudeOptions, { haiku: 'deep' });
    expect(models.find(m => m.name === 'Haiku')!.standing).toBe('deep');
  });

  it('ignores a declaration that is not a standing', () => {
    // A typo must not silently become a ranking.
    const models = acpModelChoicesFor(codexOptions, { sol: 'enormous' });
    expect(models.find(m => m.name === 'Sol')!.standing).toBe('unknown');
  });

  it('falls back to the vendor\'s own description of the model', () => {
    const models = acpModelChoicesFor([{
      id: 'model',
      category: 'model',
      options: [
        { value: 'x-1', name: 'X One', description: 'Fastest model, for everyday edits.' },
        { value: 'x-9', name: 'X Nine', description: 'Our most capable model for complex reasoning.' },
      ],
    }]);
    expect(models[0]!.standing).toBe('light');
    expect(models[1]!.standing).toBe('deep');
    expect(models[1]!.rule).toContain('describes');
  });

  it('states the whole rule table in words', () => {
    expect(ACP_MODEL_RULE_NOTE).toContain('modelStanding');
    expect(ACP_MODEL_RULE_NOTE).toContain('unknown');
  });
});

describe('unknown standing is routable, not dropped', () => {
  it('carries no reasoning depth, so it is never preferred on a number nobody stands behind', () => {
    const sol = acpModelChoicesFor(codexOptions).find(m => m.name === 'Sol')!;
    expect(sol.reasoningDepth).toBeUndefined();
    expect(sol.premiumRequestMultiplier).toBe(1);
  });

  it('still produces a routable row', () => {
    const rows = acpModelRows(acpModelChoicesFor(codexOptions), []);
    expect(rows).toHaveLength(3);
  });

  it('lets the effort tier supply depth on its own', () => {
    const sol = acpModelChoicesFor(codexOptions).find(m => m.name === 'Sol')!;
    const composed = composeAcpVariant(sol, findAcpEffortTier('high'));
    expect(composed.reasoningDepth).toBe(3);
  });
});

describe('composing a model with an effort', () => {
  const models = acpModelChoicesFor(claudeOptions);
  const opus = models.find(m => m.name === 'Opus')!;
  const haiku = models.find(m => m.name === 'Haiku')!;

  it('takes the greater depth of the two knobs', () => {
    // A light model cannot be made deep by asking harder; a deep model asked for
    // low effort is still the deep model.
    expect(composeAcpVariant(haiku, findAcpEffortTier('max')).reasoningDepth).toBe(5);
    expect(composeAcpVariant(opus, findAcpEffortTier('low')).reasoningDepth).toBe(5);
  });

  it('multiplies the cost, because both spend the plan', () => {
    expect(composeAcpVariant(opus, findAcpEffortTier('high')).premiumRequestMultiplier).toBe(4);
    expect(composeAcpVariant(haiku, findAcpEffortTier('low')).premiumRequestMultiplier).toBe(0.25);
  });

  it('is the model alone when no effort is asked for', () => {
    expect(composeAcpVariant(opus)).toEqual({ reasoningDepth: 5, premiumRequestMultiplier: 2 });
  });

  it('keeps a cheap combination cheaper than an expensive one', () => {
    // The property the budget gate depends on: cheap mode must not reach the
    // deep model at max effort.
    const cheapest = composeAcpVariant(haiku, findAcpEffortTier('low')).premiumRequestMultiplier;
    const dearest = composeAcpVariant(opus, ACP_EFFORT_TIERS[ACP_EFFORT_TIERS.length - 1]).premiumRequestMultiplier;
    expect(cheapest).toBeLessThan(dearest);
  });
});

describe('routed ids round-trip', () => {
  const opus: AcpModelChoice = {
    value: 'opus[1m]', name: 'Opus', slug: 'opus', standing: 'deep', rule: 'x', premiumRequestMultiplier: 2,
  };

  it('builds an id from the slug rather than the wire value', () => {
    // `opus[1m]` contains characters that have no business in an id.
    expect(buildAcpModelId('acp/claude', opus)).toBe('acp/claude@opus');
  });

  it('separates the model segment while leaving the effort suffix intact', () => {
    // Parsing effort first would leave `acp/claude@opus` as the agent lookup
    // key, which matches no configured agent and silently falls through to the
    // first one — a turn running on the wrong subscription.
    expect(splitAcpModelSegment('acp/claude@opus#high'))
      .toEqual({ withoutModel: 'acp/claude#high', modelSlug: 'opus' });
    expect(splitAcpModelSegment('acp/claude@opus'))
      .toEqual({ withoutModel: 'acp/claude', modelSlug: 'opus' });
  });

  it('leaves an id with no model segment alone', () => {
    expect(splitAcpModelSegment('acp/claude#high')).toEqual({ withoutModel: 'acp/claude#high' });
    expect(splitAcpModelSegment('acp/claude')).toEqual({ withoutModel: 'acp/claude' });
  });

  it('gives two models with the same name distinct ids, or drops the collision', () => {
    // One id resolving to whichever came first is a turn routed to the wrong
    // model, which is worse than one fewer row.
    const models = acpModelChoicesFor([{
      id: 'model',
      category: 'model',
      options: [{ value: 'a-1', name: 'Turbo' }, { value: 'b-2', name: 'turbo' }],
    }]);
    expect(new Set(models.map(m => m.slug)).size).toBe(models.length);
  });
});

describe('the row set is bounded and ordered for truncation', () => {
  const many = acpModelChoicesFor([{
    id: 'model',
    category: 'model',
    options: Array.from({ length: 12 }, (_unused, index) => ({ value: `m-${index}`, name: `M${index}` })),
  }]);

  it('caps the rows one agent contributes', () => {
    expect(acpModelRows(many, ACP_EFFORT_TIERS)).toHaveLength(ACP_MAX_MODEL_ROWS_PER_AGENT);
  });

  it('offers every model before any effort variant', () => {
    // So a lineup too long for the cap still exposes every model, rather than
    // every effort of the first two.
    const rows = acpModelRows(many, ACP_EFFORT_TIERS);
    const firstWithEffort = rows.findIndex(row => row.effort !== undefined);
    expect(firstWithEffort).toBe(many.length);
  });

  it('caps the model list itself', () => {
    const huge = acpModelChoicesFor([{
      id: 'model',
      category: 'model',
      options: Array.from({ length: 200 }, (_unused, index) => ({ value: `m-${index}`, name: `M${index}` })),
    }]);
    expect(huge.length).toBeLessThanOrEqual(12);
  });
});
