import { describe, expect, it } from 'vitest';
import {
  BackgroundFailureNotices,
  backgroundSummarizationRunsAtAll,
  decideBackgroundSummarization,
  isLocalProviderId,
  resolveBackgroundSummarizationMode,
  resolveMemorySelfHealingMode,
  selfHealingMayScan,
  selfHealingMayWrite,
} from '../../src/core/backgroundMemoryPolicy.js';

describe('background summarisation is off unless asked for', () => {
  it('defaults to off', () => {
    expect(resolveBackgroundSummarizationMode(undefined)).toBe('off');
  });

  /**
   * A typo in settings must not be the reason project memory reaches a cloud
   * provider.
   */
  it('resolves anything unrecognised to off', () => {
    for (const value of ['Routed', 'local', 'on', '', null, 7, {}, ['routed']]) {
      expect(resolveBackgroundSummarizationMode(value)).toBe('off');
    }
  });

  it('accepts the two declared non-default values', () => {
    expect(resolveBackgroundSummarizationMode('local-only')).toBe('local-only');
    expect(resolveBackgroundSummarizationMode('routed')).toBe('routed');
  });

  it('does not run at all when off, so no model is even selected', () => {
    expect(backgroundSummarizationRunsAtAll('off')).toBe(false);
    expect(backgroundSummarizationRunsAtAll('local-only')).toBe(true);
    expect(backgroundSummarizationRunsAtAll('routed')).toBe(true);
  });

  it('blocks with a stated reason when off', () => {
    const decision = decideBackgroundSummarization('off', 'local');
    expect(decision.status).toBe('blocked');
    if (decision.status !== 'blocked') { return; }
    expect(decision.rule).toBe('summarization-off');
    expect(decision.reason).toMatch(/backgroundSummarizationMode/);
  });
});

/**
 * The bug this replaces: `'local'` was passed as a *fallback* argument that read
 * like a constraint, so a cheap cloud model satisfied it. Locality is now
 * checked against the provider that would actually receive the bytes.
 */
describe('local-only is enforced on the resolved provider', () => {
  it('allows a local provider', () => {
    const decision = decideBackgroundSummarization('local-only', 'local');
    expect(decision.status).toBe('allowed');
    if (decision.status !== 'allowed') { return; }
    expect(decision.external).toBe(false);
  });

  it('blocks every cloud provider, naming the rule', () => {
    for (const provider of ['anthropic', 'openai', 'google', 'copilot', 'bedrock', 'openrouter']) {
      const decision = decideBackgroundSummarization('local-only', provider);
      expect(decision.status).toBe('blocked');
      if (decision.status !== 'blocked') { continue; }
      expect(decision.rule).toBe('local-only-no-local-provider');
    }
  });

  /**
   * `ProviderId` is an open union, so a negative check ("not in the cloud list")
   * would let an unrecognised provider added tomorrow pass as local.
   */
  it('treats an unknown provider as not local', () => {
    expect(isLocalProviderId('some-new-vendor')).toBe(false);
    expect(decideBackgroundSummarization('local-only', 'some-new-vendor').status).toBe('blocked');
  });

  it('blocks when no provider resolved, rather than proceeding', () => {
    for (const provider of [undefined, '']) {
      const decision = decideBackgroundSummarization('local-only', provider);
      expect(decision.status).toBe('blocked');
      if (decision.status !== 'blocked') { continue; }
      expect(decision.rule).toBe('no-provider');
    }
  });

  it('marks a routed cloud request as external so the caller can say so', () => {
    const decision = decideBackgroundSummarization('routed', 'anthropic');
    expect(decision.status).toBe('allowed');
    if (decision.status !== 'allowed') { return; }
    expect(decision.external).toBe(true);
  });
});

describe('self-healing reports before it writes', () => {
  it('defaults to report-only', () => {
    expect(resolveMemorySelfHealingMode(undefined)).toBe('report-only');
  });

  it('resolves anything unrecognised to report-only', () => {
    for (const value of ['Apply', 'write', '', null, 3]) {
      expect(resolveMemorySelfHealingMode(value)).toBe('report-only');
    }
  });

  it('permits a write only under apply', () => {
    expect(selfHealingMayWrite('apply')).toBe(true);
    for (const mode of ['off', 'report-only', 'ask'] as const) {
      expect(selfHealingMayWrite(mode)).toBe(false);
    }
  });

  it('scans in every mode but off', () => {
    expect(selfHealingMayScan('off')).toBe(false);
    for (const mode of ['report-only', 'ask', 'apply'] as const) {
      expect(selfHealingMayScan(mode)).toBe(true);
    }
  });

  it('does not write under the default', () => {
    expect(selfHealingMayWrite(resolveMemorySelfHealingMode(undefined))).toBe(false);
  });
});

/**
 * The previous behaviour was `catch {}`. Deduplication must not recreate that:
 * quiet on repeats, audible on change, audible again after a recovery.
 */
describe('repeated failures are deduplicated, not discarded', () => {
  it('reports the first occurrence and suppresses identical repeats', () => {
    const notices = new BackgroundFailureNotices();
    expect(notices.shouldNotify('provider-timeout')).toBe(true);
    expect(notices.shouldNotify('provider-timeout')).toBe(false);
    expect(notices.shouldNotify('provider-timeout')).toBe(false);
  });

  it('reports a different failure immediately', () => {
    const notices = new BackgroundFailureNotices();
    notices.shouldNotify('provider-timeout');
    expect(notices.shouldNotify('no-local-provider')).toBe(true);
  });

  it('reports again after a recovery', () => {
    const notices = new BackgroundFailureNotices();
    notices.shouldNotify('provider-timeout');
    notices.clear();
    expect(notices.shouldNotify('provider-timeout')).toBe(true);
  });
});
