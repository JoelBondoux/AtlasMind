import { describe, expect, it } from 'vitest';
import {
  GITHUB_BILLING_ENDPOINTS,
  describeCreditReading,
  notMeteredReading,
  parseGithubBillingUsage,
  readBillingRefusal,
} from '../../src/core/ciCreditMeter.ts';

describe('GitHub Actions billing reading', () => {
  it('reports headroom with the numbers behind it', () => {
    const reading = parseGithubBillingUsage(JSON.stringify({
      total_minutes_used: 500,
      included_minutes: 2000,
      total_paid_minutes_used: 0,
    }));
    expect(reading).toMatchObject({ state: 'remaining', basis: 'billing-api', usedMinutes: 500, usedPercent: 25 });
  });

  it('reports exhaustion only when the allowance is genuinely spent', () => {
    const reading = parseGithubBillingUsage(JSON.stringify({
      total_minutes_used: 2000,
      included_minutes: 2000,
      total_paid_minutes_used: 0,
    }));
    expect(reading.state).toBe('exhausted');
    if (reading.state === 'exhausted') {
      expect(reading.detail).toContain('2000 of 2000');
    }
  });

  /**
   * Somebody paying for overage has already decided to keep spending. Treating
   * that as exhausted would move work off hosted runners against an explicit
   * decision to the contrary.
   */
  it('treats a paid overage as headroom rather than exhaustion', () => {
    const reading = parseGithubBillingUsage(JSON.stringify({
      total_minutes_used: 2400,
      included_minutes: 2000,
      total_paid_minutes_used: 400,
    }));
    expect(reading.state).toBe('remaining');
  });

  /**
   * The failure this module exists to prevent: a 403 because a scope was never
   * granted looks, to naive code, exactly like zero minutes left — and would
   * move every job onto somebody's workstation on the strength of a permissions
   * error.
   */
  it('never turns an unreadable response into an empty allowance', () => {
    for (const raw of ['', 'not json', '[]', 'null', '{"message":"Resource not accessible"}', '{"included_minutes":2000}']) {
      const reading = parseGithubBillingUsage(raw);
      expect(reading.state).toBe('unknown');
      if (reading.state === 'unknown') {
        expect(reading.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it('never turns a partial reading into a number', () => {
    expect(parseGithubBillingUsage(JSON.stringify({ total_minutes_used: 10 })).state).toBe('unknown');
    expect(parseGithubBillingUsage(JSON.stringify({ total_minutes_used: -5, included_minutes: 10 })).state).toBe('unknown');
  });

  it('models a public repository as headroom with its own basis', () => {
    expect(notMeteredReading()).toEqual({ state: 'remaining', basis: 'not-metered' });
    expect(describeCreditReading(notMeteredReading())).toContain('public');
  });
});

describe('observed billing refusals', () => {
  /**
   * The local-CI documentation warns against assuming budget is the cause of a
   * refused run. A generic failure read as a billing failure would empty the
   * meter and relocate work.
   */
  it('declines to read a generic failure as a billing problem', () => {
    for (const message of [
      'The runner failed to start.',
      'HTTP 500: internal server error',
      'network unreachable',
      '',
    ]) {
      expect(readBillingRefusal(message)).toBeUndefined();
    }
  });

  it('accepts a refusal that names the reason', () => {
    const reading = readBillingRefusal('The job was not started because the spending limit has been reached.');
    expect(reading).toMatchObject({ state: 'exhausted', basis: 'observed-refusal' });
    expect(readBillingRefusal('Please add a valid PAYMENT METHOD to continue.')?.state).toBe('exhausted');
  });
});

describe('describing a reading', () => {
  it('always says where the answer came from, including when there is none', () => {
    expect(describeCreditReading({ state: 'unknown', reason: 'the endpoint returned 403.' }))
      .toContain('not known');
    expect(describeCreditReading({ state: 'exhausted', basis: 'billing-api', detail: 'all used.' }))
      .toBe('all used.');
    expect(describeCreditReading({
      state: 'remaining', basis: 'billing-api', includedMinutes: 2000, usedMinutes: 100, usedPercent: 5,
    })).toContain('100 of 2000');
  });
});

describe('endpoint constants', () => {
  /**
   * These reach `gh api`. The owner segment is the only variable part, and the
   * caller interpolates it from an already-validated slug.
   */
  it('declares one placeholder and no scheme or host', () => {
    for (const endpoint of Object.values(GITHUB_BILLING_ENDPOINTS)) {
      expect(endpoint).not.toMatch(/^https?:/);
      expect(endpoint.match(/\{owner\}/g)).toHaveLength(1);
      expect(endpoint).not.toMatch(/[;&|`$]/);
    }
  });
});
