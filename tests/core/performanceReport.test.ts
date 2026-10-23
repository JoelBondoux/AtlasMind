import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPerformanceReport, parsePerformanceReport, PERFORMANCE_REPORT_LIMITS, PERFORMANCE_METRICS, PERFORMANCE_STATISTICS } from '../../src/core/performanceReport.js';

const NOW = '2026-10-19T12:00:00.000Z';
const report = (overrides: Record<string, unknown> = {}) => ({
  version: 1, capturedAt: '2026-10-18T10:00:00.000Z', target: 'windows-shipping',
  measurements: [{ scenario: 'busy-scene', metric: 'frameTimeMs', statistic: 'p95', value: 16.2, sampleCount: 600 }],
  ...overrides,
});
const parse = (value: unknown) => parsePerformanceReport(JSON.stringify(value), NOW);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) { rmSync(root, { recursive: true, force: true }); } });
function workspace() { const root = mkdtempSync(path.join(tmpdir(), 'am-perf-')); roots.push(root); return root; }
function write(root: string, file: string, value = JSON.stringify(report())) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), value);
}

describe('project-produced performance report', () => {
  it('retains values, units and statistics without claiming a passing budget', () => {
    const evidence = parse(report());
    expect(evidence.status).toBe('measured');
    if (evidence.status !== 'measured') { throw new Error('no measurements'); }
    expect(evidence.measurements[0]).toMatchObject({ metric: 'frameTimeMs', unit: 'ms', statistic: 'p95', value: 16.2, sampleCount: 600 });
    expect(evidence.budgetVerdict).toBe('not-assessed');
    expect(evidence.capturedAt).toBe('2026-10-18T10:00:00.000Z');
    expect(evidence).not.toHaveProperty('passed');
  });
  it.each([{}, { version: 2 }, { capturedAt: 'tomorrow' }, { capturedAt: '2026-10-20T00:00:00.000Z' },
    { capturedAt: '2026-02-31T00:00:00.000Z' }, { measurements: [] }, { measurements: [{ metric: 'fps', value: 60 }] },
  ])('refuses malformed or unsupported reports without partial evidence: %j', change => {
    const input = Object.keys(change).length === 0 ? {} : report(change);
    expect(parse(input).status).toBe('unreadable');
  });
  it.each([0, -1, '16', null, 1e309])('refuses invalid measured values: %j', value => {
    expect(parse(report({ measurements: [{ ...report().measurements[0], value }] })).status).toBe('unreadable');
  });
  it('rejects empty, oversized, partial, duplicated and overlong inputs', () => {
    expect(parsePerformanceReport('', NOW).status).toBe('unreadable');
    expect(parsePerformanceReport('{', NOW).status).toBe('unreadable');
    expect(parsePerformanceReport(' '.repeat(PERFORMANCE_REPORT_LIMITS.bytes + 1), NOW).status).toBe('unreadable');
    expect(parse(report({ measurements: Array(PERFORMANCE_REPORT_LIMITS.measurements + 1).fill(report().measurements[0]) })).status).toBe('unreadable');
    expect(parse(report({ measurements: [report().measurements[0], report().measurements[0]] })).status).toBe('unreadable');
    expect(parse(report({ measurements: [{ ...report().measurements[0], scenario: 'x'.repeat(121) }] })).status).toBe('unreadable');
  });
  it('strips controls and redacts known secrets before retaining scenario text', () => {
    const evidence = parse(report({ measurements: [{ ...report().measurements[0], scenario: 'scene\u0001 sk-ant-' + 'a'.repeat(30) }] }));
    expect(evidence.status).toBe('measured');
    expect(JSON.stringify(evidence)).not.toContain('sk-ant-');
    expect(JSON.stringify(evidence)).not.toContain('\\u0001');
    expect(JSON.stringify(evidence)).toContain('[REDACTED]');
  });
  it('refuses a credential-shaped target and never forwards it in a diagnostic', () => {
    const evidence = parse(report({ target: 'sk-ant-' + 'a'.repeat(30) }));
    expect(evidence.status).toBe('unreadable');
    expect(JSON.stringify(evidence)).not.toContain('sk-ant-');
  });
  it('rejects arbitrary extra fields without returning their contents', () => {
    const evidence = parse(report({ rawLog: 'private report body' }));
    expect(evidence.status).toBe('unreadable');
    expect(JSON.stringify(evidence)).not.toContain('private report body');
  });
});

describe('bounded local report collection', () => {
  it('reports no verdict when no report exists, without creating anything', () => {
    expect(collectPerformanceReport(workspace(), NOW).status).toBe('no-report');
    expect(collectPerformanceReport(undefined, NOW).status).toBe('unavailable');
  });
  it('reads a project report and never substitutes an older valid capture for a broken newer one', () => {
    const root = workspace();
    write(root, 'test-results/performance.json');
    expect(collectPerformanceReport(root, NOW).status).toBe('measured');
    write(root, 'reports/performance.json', '{broken');
    utimesSync(path.join(root, 'test-results/performance.json'), 1, 1);
    const evidence = collectPerformanceReport(root, NOW);
    expect(evidence.status).toBe('unreadable');
    expect(evidence.relativePath).toBe('reports/performance.json');
  });
  it('refuses a symlinked report directory', () => {
    const root = workspace();
    const outside = workspace();
    write(outside, 'performance.json');
    symlinkSync(outside, path.join(root, 'test-results'), 'junction');
    expect(collectPerformanceReport(root, NOW).status).toBe('unreadable');
  });
  it('refuses oversized reports before parsing', () => {
    const root = workspace();
    write(root, 'test-results/performance.json', ' '.repeat(PERFORMANCE_REPORT_LIMITS.bytes + 1));
    expect(collectPerformanceReport(root, NOW).status).toBe('unreadable');
  });
});


it('keeps the editor schema aligned with the reader limits and closed vocabulary', () => {
  const schema = JSON.parse(readFileSync(path.join(process.cwd(), 'schemas/performance-report.schema.json'), 'utf8'));
  const measurements = schema.properties.measurements;
  expect(measurements.maxItems).toBe(PERFORMANCE_REPORT_LIMITS.measurements);
  expect(measurements.items.properties.scenario.maxLength).toBe(PERFORMANCE_REPORT_LIMITS.scenarioChars);
  expect(measurements.items.properties.metric.enum).toEqual(Object.keys(PERFORMANCE_METRICS));
  expect(measurements.items.properties.statistic.enum).toEqual(PERFORMANCE_STATISTICS);
  expect(measurements.items.additionalProperties).toBe(false);
});
