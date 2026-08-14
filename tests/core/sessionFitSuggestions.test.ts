import { describe, expect, it } from 'vitest';

import {
  deriveSessionFitSuggestions,
  SESSION_FIT_RULES,
  type SessionFitInput,
} from '../../src/core/sessionFitSuggestions.ts';

describe('deriveSessionFitSuggestions', () => {
  it('says nothing about a session that showed nothing', () => {
    expect(deriveSessionFitSuggestions({})).toEqual([]);
  });

  // The rule that matters most: every input is optional and absent means *not
  // observed*, never zero. A rule inferring "no approvals were needed" from an
  // absent count would nag on every fresh session, and a suggestion that fires
  // when nothing happened is one people learn to ignore.
  it.each([
    ['a ceiling with no suggested value', { iterationLimitHit: true }],
    ['a suggested value with no ceiling hit', { suggestedIterationLimit: 40 }],
    ['a context budget with no turn size', { contextChars: 2500 }],
    ['a turn size with no context budget', { turnInputChars: 40_000 }],
    ['an approval count with no mode', { approvalPromptsThisSession: 20 }],
    ['a mode with no approval count', { approvalMode: 'always-ask' }],
  ])('stays quiet on %s', (_label, input: SessionFitInput) => {
    expect(deriveSessionFitSuggestions(input)).toEqual([]);
  });

  it('names the setting and the value when a run stopped at the ceiling', () => {
    const [suggestion] = deriveSessionFitSuggestions({ iterationLimitHit: true, suggestedIterationLimit: 40 });
    expect(suggestion).toMatchObject({
      rule: 'tool-iteration-ceiling',
      key: 'atlasmind.maxToolIterations',
      value: 40,
    });
    expect(suggestion!.message).toContain('not because the work was finished');
  });

  it('notices a context window smaller than the material', () => {
    const [suggestion] = deriveSessionFitSuggestions({ contextChars: 2500, turnInputChars: 18_000 });
    expect(suggestion?.rule).toBe('context-window-too-small');
    expect(Number(suggestion?.value)).toBeGreaterThan(2500);
  });

  it('does not fire on a turn merely larger than the window', () => {
    // A conversation being long is not the same as the window being wrong.
    expect(deriveSessionFitSuggestions({ contextChars: 2500, turnInputChars: 3000 })).toEqual([]);
  });

  it('caps the proposed context budget at what the setting accepts', () => {
    const [suggestion] = deriveSessionFitSuggestions({ contextChars: 2500, turnInputChars: 900_000 });
    expect(Number(suggestion?.value)).toBeLessThanOrEqual(12_000);
  });

  it('suggests a looser approval mode only from the strictest one', () => {
    expect(deriveSessionFitSuggestions({ approvalPromptsThisSession: 20, approvalMode: 'always-ask' })[0]?.rule)
      .toBe('approval-mode-noisy');
    // Never suggests loosening past the default: below always-ask the operator
    // has already chosen a trade-off, and nudging them further is not this
    // module's business.
    expect(deriveSessionFitSuggestions({ approvalPromptsThisSession: 20, approvalMode: 'ask-on-write' })).toEqual([]);
  });

  it('ranks a run that stopped above a session that was merely noisy', () => {
    const suggestions = deriveSessionFitSuggestions({
      approvalPromptsThisSession: 20,
      approvalMode: 'always-ask',
      iterationLimitHit: true,
      suggestedIterationLimit: 40,
    });
    expect(suggestions.map(entry => entry.rule)).toEqual(['tool-iteration-ceiling', 'approval-mode-noisy']);
  });

  it('every suggestion names a rule from the declared table', () => {
    // A suggestion raised on a judgement made last Tuesday is not comparable
    // with one raised today, and comparability is what lets somebody dismiss a
    // rule for good.
    const declared = new Set(SESSION_FIT_RULES.map(rule => rule.id));
    const suggestions = deriveSessionFitSuggestions({
      iterationLimitHit: true,
      suggestedIterationLimit: 40,
      toolCallsPerTurnLimitHit: true,
      suggestedToolCallsPerTurnLimit: 30,
      contextChars: 2500,
      turnInputChars: 18_000,
      approvalPromptsThisSession: 20,
      approvalMode: 'always-ask',
    });
    expect(suggestions.length).toBe(SESSION_FIT_RULES.length);
    for (const suggestion of suggestions) {
      expect(declared.has(suggestion.rule)).toBe(true);
      expect(suggestion.key).toBe(SESSION_FIT_RULES.find(rule => rule.id === suggestion.rule)!.key);
    }
  });

  it('covers more than the two setting families the old path knew about', () => {
    expect(new Set(SESSION_FIT_RULES.map(rule => rule.key)).size).toBeGreaterThanOrEqual(4);
  });
});
