/**
 * One workspace scan behind subject-level coverage, shared by both surfaces.
 *
 * The Testing dashboard renders uncovered subjects and the agent obligation
 * prompt names them, and those two must not disagree: a page saying an endpoint
 * is untested while the turn that touched it was told nothing is worse than
 * neither existing, because one of them is now lying. So the walk, the
 * extraction and the matching happen here once, and both callers read the same
 * answer.
 *
 * `fs`-only — no `vscode` — because the Orchestrator runs outside a webview and
 * must be able to ask this on a turn.
 *
 * **Cached with a short TTL.** The Orchestrator asks on every turn and a
 * directory walk per turn is a cost the user did not agree to. The TTL is short
 * enough that a spec edited during a session is picked up within the same piece
 * of work, and the dashboard passes `force` when the user explicitly refreshes,
 * so a stale reading is never what somebody is looking at after asking for a
 * new one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type { TestingMethodologyId } from '../types.js';
import { matchTestFilesToPolicies } from './testingPolicyCoverage.js';
import {
  assessTestingSubjects,
  extractTestingSubjects,
  emptyTestingSubjectReport,
  isSubjectArtifactPath,
  type DeclaredArtifact,
  type TestingSubjectReport,
} from './testingSubjects.js';

/** Bounds. Hitting one yields fewer subjects rather than a slow turn. */
const MAX_ARTIFACTS = 400;
const MAX_TEST_SOURCES = 400;
const MAX_BYTES = 256_000;
const MAX_ENTRIES = 12_000;
const CACHE_TTL_MS = 30_000;

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', '.next', 'build', 'target', 'vendor']);

/** Same shape the coverage scanner treats as a test file. */
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|features)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$/i;

interface CacheEntry {
  atMs: number;
  enabledKey: string;
  report: TestingSubjectReport;
}

const cache = new Map<string, CacheEntry>();

interface ScanResult {
  artifacts: DeclaredArtifact[];
  testFiles: string[];
}

/**
 * A bounded walk collecting both halves at once.
 *
 * One traversal rather than two: the artifacts and the test files live in the
 * same tree, and walking it twice would double the cost of the thing already
 * being budgeted.
 */
function walkWorkspace(workspaceRoot: string): ScanResult {
  const artifacts: DeclaredArtifact[] = [];
  const testFiles: string[] = [];
  let visited = 0;

  const walk = (directory: string, relative: string): void => {
    if (visited >= MAX_ENTRIES) { return; }
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= MAX_ENTRIES) { return; }
      visited += 1;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) { continue; }
        walk(path.join(directory, entry.name), childRelative);
        continue;
      }
      if (!entry.isFile()) { continue; }
      if (testFiles.length < MAX_TEST_SOURCES && TEST_FILE.test(childRelative)) {
        testFiles.push(childRelative);
        continue;
      }
      if (artifacts.length >= MAX_ARTIFACTS || !isSubjectArtifactPath(childRelative)) { continue; }
      try {
        const absolute = path.join(directory, entry.name);
        if (statSync(absolute).size > MAX_BYTES) { continue; }
        artifacts.push({ path: childRelative, text: readFileSync(absolute, 'utf8') });
      } catch {
        // Unreadable: skipped, and nothing is claimed about what it contained.
      }
    }
  };

  walk(workspaceRoot, '');
  return { artifacts, testFiles };
}

/**
 * Declared subjects for the enabled policies, and whether each is covered.
 *
 * Returns an empty report rather than throwing: this is called from a turn, and
 * an unreadable workspace must not take the turn down with it. An empty report
 * under-reports, which is the safe direction — a missed subject is a gap nobody
 * was told about, while an invented one is an obligation nobody owes.
 */
export function scanTestingSubjects(
  workspaceRoot: string,
  enabled: readonly TestingMethodologyId[],
  options: { force?: boolean; now?: number } = {},
): TestingSubjectReport {
  const now = options.now ?? Date.now();
  const enabledKey = [...enabled].sort().join(',');
  const cached = cache.get(workspaceRoot);
  if (!options.force && cached && cached.enabledKey === enabledKey && now - cached.atMs < CACHE_TTL_MS) {
    return cached.report;
  }

  let report: TestingSubjectReport;
  try {
    const { artifacts, testFiles } = walkWorkspace(workspaceRoot);
    const policyTestFiles = matchTestFilesToPolicies(enabled, testFiles);

    const testSources = new Map<string, string>();
    for (const files of policyTestFiles.values()) {
      for (const relative of files) {
        if (testSources.has(relative) || testSources.size >= MAX_TEST_SOURCES) { continue; }
        try {
          const absolute = path.join(workspaceRoot, relative);
          if (statSync(absolute).size > MAX_BYTES) { continue; }
          testSources.set(relative, readFileSync(absolute, 'utf8'));
        } catch {
          // An unreadable test proves nothing either way.
        }
      }
    }

    // Only subjects belonging to a policy this project has actually declared.
    // Without this, a repository with an OpenAPI spec and no contract policy is
    // handed contract obligations it never agreed to — a gap it cannot close
    // except by enabling a methodology it had deliberately left off.
    const declared = new Set<TestingMethodologyId>(enabled);
    report = assessTestingSubjects({
      subjects: extractTestingSubjects(artifacts).filter(subject => declared.has(subject.policyId)),
      testSources,
      policyTestFiles,
    });
  } catch {
    report = emptyTestingSubjectReport();
  }

  cache.set(workspaceRoot, { atMs: now, enabledKey, report });
  return report;
}

/**
 * The uncovered subjects, flattened for the agent obligation prompt.
 *
 * Labelled with the policy so the sentence reads as an obligation rather than a
 * list of strings: "Contract testing: `POST /v1/orders`" says what is owed.
 */
export function uncoveredTestingSubjects(
  report: TestingSubjectReport,
  policyLabels: ReadonlyMap<TestingMethodologyId, string>,
): Array<{ policyLabel: string; label: string; source: string }> {
  return report.coverage
    .filter(entry => !entry.covered)
    .map(entry => ({
      policyLabel: policyLabels.get(entry.subject.policyId) ?? entry.subject.policyId,
      label: entry.subject.label,
      source: entry.subject.source,
    }));
}

/** Drops the cache. Used when the user explicitly asks for a fresh reading. */
export function clearTestingSubjectScanCache(): void {
  cache.clear();
}
