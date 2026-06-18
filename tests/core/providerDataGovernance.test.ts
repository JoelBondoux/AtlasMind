import { describe, expect, it } from 'vitest';
import { getProviderDataGovernance, hasProviderDataGovernance } from '../../src/core/providerDataGovernance.ts';

describe('providerDataGovernance', () => {
  it('returns curated entries for known providers', () => {
    expect(hasProviderDataGovernance('anthropic')).toBe(true);
    const anthropic = getProviderDataGovernance('anthropic');
    expect(anthropic.dataRequestUrl).toMatch(/^https:\/\//);
    expect(anthropic.trainsOnDataByDefault).toBe(false);
  });

  it('marks local inference as on-device with no training', () => {
    const local = getProviderDataGovernance('local');
    expect(local.trainsOnDataByDefault).toBe(false);
    expect(local.retentionSummary).toMatch(/device/i);
  });

  it('falls back to a generic entry for unknown providers', () => {
    expect(hasProviderDataGovernance('totally-unknown')).toBe(false);
    const generic = getProviderDataGovernance('totally-unknown');
    expect(generic.trainsOnDataByDefault).toBe('unknown');
  });

  it('every curated data-request/privacy URL is https', () => {
    for (const id of ['anthropic', 'openai', 'google', 'groq', 'copilot', 'bedrock', 'openrouter']) {
      const gov = getProviderDataGovernance(id);
      for (const url of [gov.dataRequestUrl, gov.privacyPolicyUrl, gov.dpaUrl]) {
        if (url) { expect(url).toMatch(/^https:\/\//); }
      }
    }
  });
});
