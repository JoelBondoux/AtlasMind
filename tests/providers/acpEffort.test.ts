import { describe, expect, it } from 'vitest';
import {
  ACP_EFFORT_CATEGORY,
  ACP_EFFORT_TIERS,
  ACP_SETTABLE_CONFIG_CATEGORIES,
  acpEffortTiersFor,
  buildAcpModelVariantId,
  findAcpEffortTier,
  isSettableAcpConfigCategory,
  parseAcpModelVariant,
} from '../../src/providers/acpEffort.ts';
import { parseSessionConfigOptions } from '../../src/providers/acpProtocol.ts';

/**
 * Shapes copied from live agents, so the tests fail if the assumption drifts:
 * `codex-acp` 1.1.7 and `claude-agent-acp` 0.63.0, read from `session/new` on
 * 2026-07-30. Note that the effort option's **id differs** between them while
 * the **category matches** — that is the whole reason category is the key.
 */
const CODEX_CONFIG_OPTIONS = [
  { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'agent', options: [{ value: 'read-only', name: 'Read only' }, { value: 'agent', name: 'Agent' }, { value: 'agent-full-access', name: 'Full access' }] },
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'gpt-5.6-sol', options: [{ value: 'gpt-5.6-sol', name: 'Sol' }, { value: 'gpt-5.6-terra', name: 'Terra' }] },
  { id: 'reasoning_effort', name: 'Reasoning effort', category: 'thought_level', type: 'select', currentValue: 'xhigh', options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }, { value: 'xhigh', name: 'Xhigh' }, { value: 'max', name: 'Max' }, { value: 'ultra', name: 'Ultra' }] },
  { id: 'fast-mode', name: 'Fast mode', category: 'model_config', type: 'select', currentValue: 'off', options: [{ value: 'off', name: 'Off' }, { value: 'on', name: 'On' }] },
];

const CLAUDE_CONFIG_OPTIONS = [
  { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Manual' }, { value: 'acceptEdits', name: 'Accept edits' }, { value: 'bypassPermissions', name: 'Bypass' }] },
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'opus[1m]', options: [{ value: 'default', name: 'Default' }, { value: 'opus[1m]', name: 'Opus' }, { value: 'haiku', name: 'Haiku' }] },
  { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default' }, { value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }, { value: 'xhigh', name: 'Xhigh' }, { value: 'max', name: 'Max' }] },
];

describe('the config categories AtlasMind will set', () => {
  it('never sets the permission mode, whatever it is called', () => {
    // This is the one that matters. The same `configOptions` array that carries
    // effort also carries the agent's *permission* mode — whose values include
    // `agent-full-access` and `bypassPermissions`. A settings channel able to
    // set those would route around `toolApprovalManager` entirely, so it would
    // be a privilege escalation wearing the clothes of a routing optimisation.
    expect(isSettableAcpConfigCategory('mode')).toBe(false);
    expect(ACP_SETTABLE_CONFIG_CATEGORIES).not.toContain('mode');
  });

  it('is an allowlist, so an unknown category is refused rather than passed through', () => {
    // Deny-by-default: a category this build has never heard of is exactly the
    // case where "probably harmless" is a guess nobody should be making.
    expect(isSettableAcpConfigCategory('collaboration_mode')).toBe(false);
    expect(isSettableAcpConfigCategory('something_invented_later')).toBe(false);
    expect(isSettableAcpConfigCategory(undefined)).toBe(false);
    expect(isSettableAcpConfigCategory('')).toBe(false);
  });

  it('does not spend more of the subscription on the user\'s behalf', () => {
    // Codex's `model_config` is "fast mode": *1.5x speed, increased usage*.
    // Spending somebody's plan faster is their call, not a routing decision.
    expect(isSettableAcpConfigCategory('model_config')).toBe(false);
  });

  it('allows exactly model and effort', () => {
    expect([...ACP_SETTABLE_CONFIG_CATEGORIES].sort()).toEqual(['model', 'thought_level']);
    expect(isSettableAcpConfigCategory('model')).toBe(true);
    expect(isSettableAcpConfigCategory(ACP_EFFORT_CATEGORY)).toBe(true);
  });
});

describe('effort tiers are matched on category, not id', () => {
  it('finds the effort knob on both agents despite different ids', () => {
    // Codex calls it `reasoning_effort`, Claude Agent calls it `effort`. Keying
    // on id would work against one and silently no-op against the other — and a
    // silent no-op looks exactly like success, because the turn still completes.
    expect(acpEffortTiersFor(CODEX_CONFIG_OPTIONS).map(t => t.value))
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(acpEffortTiersFor(CLAUDE_CONFIG_OPTIONS).map(t => t.value))
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('offers only tiers the agent actually listed', () => {
    // Claude has no `ultra`; offering one would put a row in the tree that the
    // agent would refuse.
    expect(acpEffortTiersFor(CLAUDE_CONFIG_OPTIONS).map(t => t.value)).not.toContain('ultra');
  });

  it('ignores a value this build cannot score', () => {
    const exotic = [{ category: 'thought_level', options: [{ value: 'transcendent' }, { value: 'low' }] }];
    expect(acpEffortTiersFor(exotic).map(t => t.value)).toEqual(['low']);
  });

  it('treats "default" as the base model, not a tier', () => {
    // `default` means "the agent's own choice", which is the un-suffixed row.
    // Emitting it as a variant would add a second model id meaning the same run.
    expect(ACP_EFFORT_TIERS.map(t => t.value)).not.toContain('default');
    expect(acpEffortTiersFor(CLAUDE_CONFIG_OPTIONS).map(t => t.value)).not.toContain('default');
  });

  it('returns nothing for an agent with no effort knob, which is an ordinary answer', () => {
    expect(acpEffortTiersFor([{ category: 'mode', options: [{ value: 'default' }] }])).toEqual([]);
    expect(acpEffortTiersFor([])).toEqual([]);
  });

  it('orders tiers by increasing effort and increasing quota cost', () => {
    // Both must rise together, or the budget gate stops expressing the gradient.
    const depths = ACP_EFFORT_TIERS.map(t => t.reasoningDepth);
    const costs = ACP_EFFORT_TIERS.map(t => t.premiumRequestMultiplier);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('places the tiers either side of the budget gates', () => {
    // The gate reads `premiumRequestMultiplier`: cheap needs ≤1, balanced ≤2.
    // If every tier were >2 the gradient would collapse to "expensive only".
    expect(findAcpEffortTier('low')!.premiumRequestMultiplier).toBeLessThanOrEqual(1);
    expect(findAcpEffortTier('medium')!.premiumRequestMultiplier).toBeLessThanOrEqual(1);
    expect(findAcpEffortTier('high')!.premiumRequestMultiplier).toBeLessThanOrEqual(2);
    expect(findAcpEffortTier('max')!.premiumRequestMultiplier).toBeGreaterThan(2);
  });
});

describe('model id variants', () => {
  it('round-trips a variant', () => {
    const high = findAcpEffortTier('high')!;
    const id = buildAcpModelVariantId('acp/claude', high);
    expect(id).toBe('acp/claude#high');
    expect(parseAcpModelVariant(id)).toEqual({ baseModelId: 'acp/claude', effort: high });
  });

  it('reads a bare model id as the agent default', () => {
    expect(parseAcpModelVariant('acp/claude')).toEqual({ baseModelId: 'acp/claude' });
  });

  it('drops an unrecognised suffix rather than guessing at it', () => {
    // A variant this build does not know is not one it should apply — but the
    // agent is still resolvable, so the turn runs at the default instead of failing.
    expect(parseAcpModelVariant('acp/claude#transcendent')).toEqual({ baseModelId: 'acp/claude' });
  });
});

describe('parseSessionConfigOptions — untrusted third-party input', () => {
  it('reads the live shape', () => {
    const parsed = parseSessionConfigOptions({ configOptions: CLAUDE_CONFIG_OPTIONS });
    expect(parsed.map(o => o.id)).toEqual(['mode', 'model', 'effort']);
    expect(parsed.find(o => o.id === 'effort')?.currentValue).toBe('default');
  });

  it('never throws on anything', () => {
    for (const shape of [{}, { configOptions: null }, { configOptions: 'nope' }, { configOptions: [null, 1, 'x'] },
      { configOptions: [{ id: 'a' }] }, { configOptions: [{ id: 'a', type: 'select' }] }]) {
      expect(() => parseSessionConfigOptions(shape as Record<string, unknown>)).not.toThrow();
    }
    expect(parseSessionConfigOptions({ configOptions: [{ id: 'a', type: 'select' }] })).toEqual([]);
  });

  it('drops non-select options rather than half-supporting them', () => {
    // A boolean option takes a different set-request shape. Keeping it here
    // would advertise something the set path cannot build.
    const parsed = parseSessionConfigOptions({
      configOptions: [{ id: 'b', type: 'boolean', currentValue: 'true', options: [{ value: 'true', name: 'On' }] }],
    });
    expect(parsed).toEqual([]);
  });

  it('caps both dimensions rather than trusting the agent\'s count', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      id: `opt-${i}`, name: 'x', type: 'select', currentValue: 'a',
      options: Array.from({ length: 500 }, (_, j) => ({ value: `v${j}`, name: 'v' })),
    }));
    const parsed = parseSessionConfigOptions({ configOptions: many });
    expect(parsed.length).toBeLessThanOrEqual(32);
    expect(parsed[0]!.options.length).toBeLessThanOrEqual(64);
  });

  it('clamps oversized text', () => {
    const parsed = parseSessionConfigOptions({
      configOptions: [{
        id: 'x'.repeat(5000), name: 'y'.repeat(5000), description: 'z'.repeat(5000),
        type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'n'.repeat(5000) }],
      }],
    });
    expect(parsed[0]!.id.length).toBeLessThanOrEqual(200);
    expect(parsed[0]!.name.length).toBeLessThanOrEqual(120);
    expect(parsed[0]!.description!.length).toBeLessThanOrEqual(300);
  });
});
