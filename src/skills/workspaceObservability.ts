import type { SkillDefinition } from '../types.js';

/**
 * Candidate paths where test result files may be written.
 * Searched relative to the workspace root.
 */
const TEST_RESULT_GLOBS = [
  '**/test-results/*.xml',
  '**/test-results/**/*.xml',
  '**/junit*.xml',
  '**/coverage/test-results.xml',
  '**/.vitest-results.json',
  '**/vitest-results.json',
  '**/test-results.json',
  '**/coverage-summary.json',
] as const;

/** Parse a minimal subset of JUnit XML to extract suite/test counts and failures. */
function parseJunitXml(xml: string): string {
  const suiteMatch = xml.match(/<testsuite[^>]*\bname="([^"]*)"[^>]*\btests="(\d+)"[^>]*\bfailures="(\d+)"[^>]*\berrors="(\d+)"/);
  if (!suiteMatch) {
    // Try without named captures for simple <testsuite tests="N" failures="N"> forms
    const simple = xml.match(/<testsuite[^>]*\btests="(\d+)"[^>]*\bfailures="(\d+)"/);
    if (simple) {
      return `  Tests: ${simple[1]}, Failures: ${simple[2]}`;
    }
    return '  (unrecognised JUnit XML structure)';
  }
  // Destructure: skip the full match (index 0) and capture named groups
  const [/* _fullMatch */, name, tests, failures, errors] = suiteMatch;
  const failCount = Number(failures) + Number(errors);
  const status = failCount > 0 ? '✗' : '✓';
  return `  ${status} ${name || 'suite'}: ${tests} test(s), ${failCount} failure(s)`;
}

/** Summarise a JSON test result file (Vitest / Jest / coverage-summary format). */
function parseJsonResults(raw: string): string {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;

    // Vitest / Jest summary: { numPassedTests, numFailedTests, numTotalTests }
    if (typeof data['numTotalTests'] === 'number') {
      const passed = data['numPassedTests'] as number;
      const failed = data['numFailedTests'] as number;
      const total = data['numTotalTests'] as number;
      const status = failed > 0 ? '✗' : '✓';
      return `  ${status} ${passed}/${total} tests passed, ${failed} failed`;
    }

    // coverage-summary: { total: { lines: { pct }, ... } }
    if (data['total'] && typeof (data['total'] as Record<string, unknown>)['lines'] === 'object') {
      const total = data['total'] as Record<string, { pct?: number }>;
      const linesPct = total['lines']?.pct ?? '?';
      const stmtsPct = total['statements']?.pct ?? '?';
      return `  Coverage — lines: ${linesPct}%, statements: ${stmtsPct}%`;
    }

    return '  (unrecognised JSON test result format)';
  } catch {
    return '  (invalid JSON)';
  }
}

export const workspaceObservabilitySkill: SkillDefinition = {
  id: 'workspace-state',
  name: 'Workspace State',
  builtIn: true,
  description:
    'Return a snapshot of the active VS Code workspace state: output channel availability, active debug sessions, ' +
    'a summary of the current workspace problems, and the latest test results when result files are present. ' +
    'Use this before answering questions about the live state of the project.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_params, context) {
    const [channelNames, debugSessions, diagnostics] = await Promise.all([
      context.getOutputChannelNames(),
      context.getDebugSessions(),
      context.getDiagnostics(),
    ]);

    const lines: string[] = ['=== Workspace State ==='];

    // Output channels
    lines.push(`\nOutput Channels (${channelNames.length}):`);
    if (channelNames.length === 0) {
      lines.push('  (none detected)');
    } else {
      for (const name of channelNames) {
        lines.push(`  - ${name}`);
      }
    }

    // Debug sessions
    lines.push(`\nDebug Sessions (${debugSessions.length}):`);
    if (debugSessions.length === 0) {
      lines.push('  No active debug sessions.');
    } else {
      for (const session of debugSessions) {
        lines.push(`  - ${session.name} [${session.type}]`);
      }
    }

    // Problems summary
    const errors = diagnostics.filter(d => d.severity === 'error');
    const warnings = diagnostics.filter(d => d.severity === 'warning');
    lines.push(`\nWorkspace Problems: ${errors.length} error(s), ${warnings.length} warning(s)`);
    if (errors.length > 0) {
      const sample = errors.slice(0, 5);
      for (const err of sample) {
        lines.push(`  ✗ ${err.path}:${err.line} — ${err.message}`);
      }
      if (errors.length > 5) {
        lines.push(`  ... and ${errors.length - 5} more error(s)`);
      }
    }

    // Test results
    const resultFiles = (
      await Promise.all(
        TEST_RESULT_GLOBS.map(glob => context.findFiles(glob).catch(() => [] as string[])),
      )
    ).flat();

    // Deduplicate
    const seen = new Set<string>();
    const uniqueFiles = resultFiles.filter(f => {
      if (seen.has(f)) { return false; }
      seen.add(f);
      return true;
    });

    if (uniqueFiles.length > 0) {
      lines.push(`\nTest Results (${uniqueFiles.length} result file(s) found):`);
      for (const filePath of uniqueFiles.slice(0, 5)) {
        const shortPath = filePath.replace(context.workspaceRootPath ? context.workspaceRootPath + '/' : '', '');
        try {
          const content = await context.readFile(filePath);
          const summary = filePath.endsWith('.json')
            ? parseJsonResults(content)
            : parseJunitXml(content);
          lines.push(`  ${shortPath}`);
          lines.push(summary);
        } catch {
          lines.push(`  ${shortPath} — (could not read file)`);
        }
      }
      if (uniqueFiles.length > 5) {
        lines.push(`  ... and ${uniqueFiles.length - 5} more result file(s)`);
      }
    } else {
      lines.push('\nTest Results: no result files found');
    }

    return lines.join('\n');
  },
};
