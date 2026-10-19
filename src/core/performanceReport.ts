/**
 * Project-reported performance measurements. The v1 exchange format is ours,
 * not a claim to parse engine-native captures. Nothing runs a profiler, writes,
 * evaluates a budget, or forwards scenario text to a model.
 */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../utils/secretRedactor.js';

export const PERFORMANCE_REPORT_LIMITS = { bytes: 262_144, measurements: 128, scenarioChars: 120 } as const;
export const PERFORMANCE_REPORT_PATHS = ['test-results/performance.json', 'reports/performance.json'] as const;
export const PERFORMANCE_METRICS = {
  frameTimeMs: { label: 'Frame time', unit: 'ms' },
  memoryMb: { label: 'Memory', unit: 'MB' },
  loadTimeS: { label: 'Load time', unit: 's' },
} as const;
export type PerformanceMetric = keyof typeof PERFORMANCE_METRICS;
export const PERFORMANCE_STATISTICS = ['mean', 'median', 'p95', 'p99', 'max'] as const;
export type PerformanceStatistic = typeof PERFORMANCE_STATISTICS[number];
export interface PerformanceMeasurement {
  readonly scenario: string;
  readonly metric: PerformanceMetric;
  readonly unit: 'ms' | 'MB' | 's';
  readonly statistic: PerformanceStatistic;
  readonly value: number;
  readonly sampleCount: number;
}
export type PerformanceReportEvidence = {
  readonly status: 'measured';
  readonly capturedAt: string;
  /** Project-authored target identifier, not a verified platform assertion. */
  readonly target: string;
  readonly measurements: readonly PerformanceMeasurement[];
  readonly budgetVerdict: 'not-assessed';
  readonly relativePath?: string;
} | {
  readonly status: 'no-report' | 'unavailable' | 'unreadable';
  readonly reason: string;
  readonly relativePath?: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function unreadable(reason = 'The performance report is malformed, unsupported or incomplete.'): PerformanceReportEvidence {
  return { status: 'unreadable', reason };
}

/** Whole-report acceptance: dropping an invalid measurement could hide its result. */
export function parsePerformanceReport(text: string, now: string): PerformanceReportEvidence {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > PERFORMANCE_REPORT_LIMITS.bytes) {
    return unreadable('The performance report is empty or exceeds the read limit.');
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return unreadable(); }
  if (!object(raw) || raw['version'] !== 1 || !keys(raw, ['version', 'capturedAt', 'target', 'measurements'])) { return unreadable(); }
  const capturedAt = raw['capturedAt'];
  if (typeof capturedAt !== 'string') { return unreadable(); }
  const capturedMs = Date.parse(capturedAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(capturedMs) || !Number.isFinite(nowMs) || capturedMs > nowMs) { return unreadable(); }
  const iso = new Date(capturedMs).toISOString();
  if (capturedAt !== iso && capturedAt !== iso.replace('.000Z', 'Z')) { return unreadable(); }
  const target = raw['target'];
  if (typeof target !== 'string' || !/^[a-z][a-z0-9-]{0,59}$/.test(target) || redactSecrets(target).redactedCount > 0) { return unreadable(); }
  const list = raw['measurements'];
  if (!Array.isArray(list) || list.length === 0 || list.length > PERFORMANCE_REPORT_LIMITS.measurements) { return unreadable(); }
  const seen = new Set<string>();
  const measurements: PerformanceMeasurement[] = [];
  for (const entry of list) {
    if (!object(entry) || !keys(entry, ['scenario', 'metric', 'statistic', 'value', 'sampleCount'])) { return unreadable(); }
    const metric = entry['metric'];
    const statistic = entry['statistic'];
    const scenario = entry['scenario'];
    const value = entry['value'];
    const sampleCount = entry['sampleCount'];
    if (typeof metric !== 'string' || !Object.hasOwn(PERFORMANCE_METRICS, metric)
      || typeof statistic !== 'string' || !(PERFORMANCE_STATISTICS as readonly string[]).includes(statistic)
      || typeof scenario !== 'string' || scenario.length > PERFORMANCE_REPORT_LIMITS.scenarioChars
      || typeof value !== 'number' || !Number.isFinite(value) || value <= 0
      || typeof sampleCount !== 'number' || !Number.isSafeInteger(sampleCount) || sampleCount <= 0) { return unreadable(); }
    const clean = redactSecrets(scenario.replace(/[\u0000-\u001f\u007f]/g, '').trim()).text;
    if (!clean) { return unreadable(); }
    const identity = JSON.stringify([clean, metric, statistic]);
    if (seen.has(identity)) { return unreadable('The report repeats a scenario, metric and statistic. No measurement was selected arbitrarily.'); }
    seen.add(identity);
    measurements.push({ scenario: clean, metric: metric as PerformanceMetric,
      unit: PERFORMANCE_METRICS[metric as PerformanceMetric].unit,
      statistic: statistic as PerformanceStatistic, value, sampleCount });
  }
  return { status: 'measured', capturedAt, target, measurements, budgetVerdict: 'not-assessed' };
}

/** Fixed candidates, no recursive discovery, bounded descriptor read, no symlink traversal. */
export function collectPerformanceReport(workspaceRoot: string | undefined, now: string): PerformanceReportEvidence {
  if (!workspaceRoot) { return { status: 'unavailable', reason: 'No unambiguous project home is available.' }; }
  let root: string;
  try { root = realpathSync(workspaceRoot); } catch { return { status: 'unavailable', reason: 'The project home is unreadable.' }; }
  let selected: { relativePath: string; absolute: string; modified: number; dev: number; ino: number } | undefined;
  for (const relativePath of PERFORMANCE_REPORT_PATHS) {
    try {
      let cursor = root;
      const segments = relativePath.split('/');
      for (const [index, segment] of segments.entries()) {
        cursor = path.join(cursor, segment);
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink() || (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
          return { ...unreadable('The report path is not an ordinary project file; links are not followed.'), relativePath };
        }
        if (index === segments.length - 1 && (!selected || stat.mtimeMs > selected.modified)) {
          selected = { relativePath, absolute: cursor, modified: stat.mtimeMs, dev: stat.dev, ino: stat.ino };
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ...unreadable('The performance report path is unreadable.'), relativePath };
      }
    }
  }
  if (!selected) { return { status: 'no-report', reason: 'No project-produced performance report was found.' }; }
  let fd: number | undefined;
  try {
    fd = openSync(selected.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    const relative = path.relative(root, realpathSync(selected.absolute));
    if (relative.startsWith('..') || path.isAbsolute(relative) || !stat.isFile()
      || stat.dev !== selected.dev || stat.ino !== selected.ino || stat.size > PERFORMANCE_REPORT_LIMITS.bytes) {
      return { ...unreadable('The performance report changed identity, escaped the project or exceeds the read limit.'), relativePath: selected.relativePath };
    }
    const buffer = Buffer.alloc(PERFORMANCE_REPORT_LIMITS.bytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, size);
      if (count === 0) { break; }
      size += count;
    }
    if (size > PERFORMANCE_REPORT_LIMITS.bytes) { return { ...unreadable('The performance report exceeds the read limit.'), relativePath: selected.relativePath }; }
    return { ...parsePerformanceReport(buffer.subarray(0, size).toString('utf8'), now), relativePath: selected.relativePath };
  } catch { return { ...unreadable('The performance report could not be read safely.'), relativePath: selected.relativePath }; }
  finally { if (fd !== undefined) { closeSync(fd); } }
}
