import { describe, expect, it } from 'vitest';
import {
  REASONING_CONTROL_CATALOG,
  REASONING_CONTROL_CATALOG_VERIFIED_AT,
  lookupReasoningControl,
} from '../../src/providers/modelCatalog.ts';
import { REASONING_CONTROLS } from '../../src/core/reasoningBudget.ts';
import { inferModelMetadata } from '../../src/extension.ts';

describe('the reasoning-control catalog', () => {
  it('states when it was verified, and cites a page for every row', () => {
    expect(REASONING_CONTROL_CATALOG_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const entry of REASONING_CONTROL_CATALOG) {
      expect(entry.source).toMatch(/^https:\/\//);
    }
  });

  it('declares each row on a provider whose adapter implements its control', () => {
    // A row on a provider the control does not list could never be sent, and
    // reading as declared while being inert is the confusion this prevents.
    for (const entry of REASONING_CONTROL_CATALOG) {
      expect(REASONING_CONTROLS[entry.control].providers).toContain(entry.provider);
    }
  });

  it.each([
    ['anthropic', 'anthropic/claude-opus-5-5', 'anthropic-effort'],
    ['anthropic', 'claude-opus-4-5-20251101', 'anthropic-effort'],
    ['anthropic', 'anthropic/claude-sonnet-4-6', 'anthropic-effort'],
    ['anthropic', 'anthropic/claude-sonnet-5-5', 'anthropic-effort'],
    ['anthropic', 'anthropic/claude-fable-5-1', 'anthropic-effort'],
    ['anthropic', 'anthropic/claude-haiku-5-5', 'anthropic-effort'],
    ['openai', 'openai/gpt-5.5', 'openai-reasoning-effort'],
    ['openai', 'openai/gpt-5.6-terra', 'openai-reasoning-effort'],
    ['openai', 'openai/gpt-6.1-sol', 'openai-reasoning-effort'],
    ['google', 'google/gemini-2.5-flash', 'gemini-reasoning-effort'],
    ['google', 'google/gemini-3.1-pro-preview', 'gemini-reasoning-effort'],
    ['google', 'google/gemini-3-flash-preview', 'gemini-reasoning-effort'],
  ])('%s %s → %s', (provider, model, control) => {
    expect(lookupReasoningControl(provider, model)).toBe(control);
  });

  it.each([
    // The effort page lists neither, and both return an error when sent effort.
    ['anthropic', 'anthropic/claude-haiku-4-5'],
    ['anthropic', 'anthropic/claude-sonnet-4-5'],
    // Not on the reasoning guide's list — unknown, so not declared.
    ['openai', 'openai/o3'],
    ['openai', 'openai/gpt-4o'],
    ['openai', 'openai/gpt-5.5-pro'],
    // Variants that are not chat reasoners.
    ['google', 'google/gemini-2.5-flash-image'],
    ['google', 'google/gemini-2.5-flash-preview-tts'],
    // The same Claude through another vendor is a different wire format.
    ['copilot', 'copilot/claude-opus-5-5'],
    ['bedrock', 'bedrock/claude-opus-5-5'],
    ['openrouter', 'openrouter/anthropic/claude-opus-5-5'],
  ])('%s %s → unknown', (provider, model) => {
    expect(lookupReasoningControl(provider, model)).toBeUndefined();
  });
});

describe('the metadata merge carries the declared control, and only the declared one', () => {
  it('sets it for a declared model on its own provider', () => {
    expect(inferModelMetadata('anthropic', 'anthropic/claude-opus-4-7').reasoningControl).toBe('anthropic-effort');
  });

  it('leaves it absent for an undeclared model, never guessing from a reasoning-sounding name', () => {
    const info = inferModelMetadata('deepseek', 'deepseek/deepseek-reasoner');
    expect(info.capabilities).toContain('reasoning');
    expect(info).not.toHaveProperty('reasoningControl');
  });

  it('does not borrow a control across providers', () => {
    expect(inferModelMetadata('copilot', 'copilot/claude-opus-4-7')).not.toHaveProperty('reasoningControl');
  });
});
