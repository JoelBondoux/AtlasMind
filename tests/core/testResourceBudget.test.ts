import { describe, expect, it } from 'vitest';
import {
  clampTestResourceShare,
  planTestCommandThrottle,
  planTestResourceBudget,
  TEST_RESOURCE_RESERVE_MIN_CPUS,
  TEST_RESOURCE_RESERVE_MIN_MEMORY_GB,
  TEST_RESOURCE_SHARE_DEFAULT,
  withTestResourceEnv,
} from '../../src/core/testResourceBudget.ts';

describe('test resource budget', () => {
  it('reserves at least 25% of the host in both dimensions', () => {
    const budget = planTestResourceBudget({ cpuCount: 24, memoryGb: 64 }, 90);
    expect(budget.reserveCpus).toBe(6);
    expect(budget.reserveMemoryGb).toBe(16);
    // 90% of 24 = 21, but the reserve leaves only 18.
    expect(budget.cpus).toBe(18);
    expect(budget.memoryGb).toBe(48);
  });

  it('applies the share when it is lower than what the reserve leaves', () => {
    const budget = planTestResourceBudget({ cpuCount: 24, memoryGb: 64 }, 50);
    expect(budget.cpus).toBe(12);
    expect(budget.memoryGb).toBe(32);
    expect(budget.maxWorkers).toBe(12);
    expect(budget.rule).toContain('50%');
  });

  it('enforces the aggressive reserve floors on small machines', () => {
    const budget = planTestResourceBudget({ cpuCount: 4, memoryGb: 16 }, 90);
    expect(budget.reserveCpus).toBe(TEST_RESOURCE_RESERVE_MIN_CPUS);
    expect(budget.reserveMemoryGb).toBe(TEST_RESOURCE_RESERVE_MIN_MEMORY_GB);
    expect(budget.cpus).toBe(2);
    expect(budget.memoryGb).toBe(8);
  });

  it('never refuses a host run: a machine smaller than the reserve keeps the 1/1 floor', () => {
    const budget = planTestResourceBudget({ cpuCount: 2, memoryGb: 4 }, 50);
    expect(budget.cpus).toBe(1);
    expect(budget.memoryGb).toBe(1);
    expect(budget.maxWorkers).toBe(1);
    expect(budget.rule).toContain('floor');
  });

  it('budgets mutation runs harder than test runs', () => {
    const budget = planTestResourceBudget({ cpuCount: 24, memoryGb: 64 }, 50);
    // 12 workers, 32 GB → half the workers, one per 2 GB, whichever is lower.
    expect(budget.mutationConcurrency).toBe(6);
    expect(budget.mutationConcurrency).toBeLessThan(budget.maxWorkers);
  });

  it('caps the per-process heap so inherited workers cannot each take the whole budget', () => {
    const budget = planTestResourceBudget({ cpuCount: 24, memoryGb: 64 }, 50);
    expect(budget.perProcessHeapMb).toBe(Math.floor((32 * 1024) / 13));
    expect(budget.perProcessHeapMb).toBeGreaterThanOrEqual(512);
    expect(budget.perProcessHeapMb).toBeLessThanOrEqual(4096);
  });

  it('clamps the share setting instead of trusting it', () => {
    expect(clampTestResourceShare(5)).toBe(10);
    expect(clampTestResourceShare(200)).toBe(90);
    expect(clampTestResourceShare(Number.NaN)).toBe(TEST_RESOURCE_SHARE_DEFAULT);
    expect(clampTestResourceShare('60')).toBe(TEST_RESOURCE_SHARE_DEFAULT);
    expect(clampTestResourceShare(undefined)).toBe(TEST_RESOURCE_SHARE_DEFAULT);
  });
});

describe('test command throttle', () => {
  const budget = planTestResourceBudget({ cpuCount: 24, memoryGb: 64 }, 50);

  it('appends --maxWorkers for a bare jest script', () => {
    const throttle = planTestCommandThrottle('jest', budget);
    expect(throttle.runner).toBe('jest');
    expect(throttle.extraArgs).toEqual([`--maxWorkers=${budget.maxWorkers}`]);
  });

  it('appends --maxWorkers for vitest behind launchers and env assignments', () => {
    expect(planTestCommandThrottle('cross-env NODE_ENV=test npx vitest run', budget).runner).toBe('vitest');
    expect(planTestCommandThrottle('node node_modules/jest/bin/jest.js --colors', budget).runner).toBe('jest');
  });

  it('appends --concurrency for stryker, at the harder mutation cap', () => {
    const throttle = planTestCommandThrottle('stryker run', budget);
    expect(throttle.runner).toBe('stryker');
    expect(throttle.extraArgs).toEqual(['--concurrency', String(budget.mutationConcurrency)]);
  });

  it('refuses a compound command rather than throttling its last step', () => {
    const throttle = planTestCommandThrottle('jest && node scripts/report.js', budget);
    expect(throttle.extraArgs).toEqual([]);
    expect(throttle.rule).toContain('compound');
  });

  it('respects a script that states its own parallelism', () => {
    expect(planTestCommandThrottle('jest --maxWorkers=2', budget).extraArgs).toEqual([]);
    expect(planTestCommandThrottle('vitest run --pool=forks', budget).extraArgs).toEqual([]);
    expect(planTestCommandThrottle('jest --runInBand', budget).extraArgs).toEqual([]);
  });

  it('appends nothing to a runner it does not recognise', () => {
    expect(planTestCommandThrottle('mocha tests', budget).extraArgs).toEqual([]);
    expect(planTestCommandThrottle(undefined, budget).extraArgs).toEqual([]);
    expect(planTestCommandThrottle('webpack --mode production', budget).extraArgs).toEqual([]);
  });
});

describe('test resource environment', () => {
  const budget = planTestResourceBudget({ cpuCount: 24, memoryGb: 64 }, 50);

  it('merges the heap cap into NODE_OPTIONS without disturbing existing flags', () => {
    const env = withTestResourceEnv({ NODE_OPTIONS: '--use-system-ca', PATH: 'x' }, budget);
    expect(env['NODE_OPTIONS']).toBe(`--use-system-ca --max-old-space-size=${budget.perProcessHeapMb}`);
    expect(env['PATH']).toBe('x');
  });

  it('sets NODE_OPTIONS when none exists', () => {
    const env = withTestResourceEnv({}, budget);
    expect(env['NODE_OPTIONS']).toBe(`--max-old-space-size=${budget.perProcessHeapMb}`);
  });

  it('leaves an existing --max-old-space-size exactly as the user wrote it', () => {
    const env = withTestResourceEnv({ NODE_OPTIONS: '--max-old-space-size=1024' }, budget);
    expect(env['NODE_OPTIONS']).toBe('--max-old-space-size=1024');
  });
});
