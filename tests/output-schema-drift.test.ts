import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJUnitReport } from '../src/core/testingPolicyCoverage.js';

/**
 * Output-schema drift, on the one schema this project both **writes and reads**.
 *
 * The Testing dashboard never runs a test command. It reads pass/fail out of a
 * JUnit report the project already wrote — so `vitest.config.ts` emits one on
 * every run, and `parseJUnitReport` reads it back. Producer and consumer are
 * both here, joined by a file format neither of them owns.
 *
 * That join is exactly where drift is invisible. A Vitest upgrade that changes
 * an attribute name breaks nothing that fails: the suite still passes, the
 * report is still written, and the dashboard quietly reverts to "no test report
 * to read" — the state it showed before any of this existed. Nobody notices,
 * because a dashboard that says it has no data looks the same whether it has no
 * data or cannot understand the data it has.
 *
 * **This suite deliberately does not read `test-results/junit.xml`.** The first
 * version did, on the reasoning that a fixture would keep passing through the
 * upgrade that broke it. That was true and the test was still wrong: the report
 * is written by the very run doing the reading, so during a full-suite run the
 * file is empty and the assertion failed — while passing in a single-file run,
 * where the previous run's output was still on disk. A test whose result
 * depends on what a previous run happened to leave behind is worse than a
 * fixture, because it fails for reasons that have nothing to do with the thing
 * it is checking.
 *
 * The fixture problem is solved instead by **pinning the producer's version**.
 * `vitest-junit-report.xml` was captured from a real run, and if the declared
 * Vitest version moves the pin below fails and asks for a re-capture — which is
 * the moment the format could actually have changed.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'vitest-junit-report.xml');

/** The Vitest line the fixture was captured from. Re-capture when this moves. */
const CAPTURED_FROM_VITEST = '^4.1';

const report = () => parseJUnitReport(readFileSync(FIXTURE, 'utf8'));

describe('the producer is still wired to the path the consumer reads', () => {
  const config = readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8');

  it('emits a JUnit report on every run, not behind a separate script', () => {
    // Behind an opt-in script the report would exist only when somebody
    // remembered, which is the state that left the dashboard permanently dark.
    expect(config).toMatch(/reporters:\s*\[[^\]]*'junit'/);
  });

  it('writes it where the dashboard looks', () => {
    expect(config).toContain('test-results/junit.xml');
  });

  it('was captured from the Vitest line this project still uses', () => {
    // The pin that makes a fixture safe. A major/minor Vitest bump is exactly
    // when the report format could change, and this fails at that moment
    // rather than silently continuing to test an old shape.
    const declared = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(
      declared.devDependencies['vitest'],
      `Vitest moved — re-capture tests/fixtures/vitest-junit-report.xml from a real run and update CAPTURED_FROM_VITEST`,
    ).toMatch(new RegExp(`^${CAPTURED_FROM_VITEST.replace(/[\^.]/g, ch => `\\${ch}`)}`));
  });
});

describe('the reader understands what the producer emits', () => {
  it('parses a real Vitest report', () => {
    expect(report(), 'the reader could not understand a report Vitest produced').toBeDefined();
  });

  it('reads totals that describe a real run', () => {
    // Zero suites or zero tests parses "successfully" while carrying nothing,
    // which reaches the dashboard as a clean verdict on an empty run.
    const parsed = report()!;
    expect(parsed.suites).toBe(2);
    expect(parsed.tests).toBe(4);
    expect(parsed.failed).toBe(1);
    expect(parsed.skipped).toBe(1);
  });

  it('attributes a failure to the file that owns it', () => {
    // Policy attribution depends entirely on this: without a file or suite on a
    // failing case, `deriveTestingPolicyCoverage` cannot decide which policy
    // the failure belongs to and every one lands in the unattributed bucket —
    // technically true and useless.
    //
    // Worth knowing: this reporter emits no `file` attribute. The path arrives
    // as the suite `name` and the case `classname`, which is why
    // `fileEvidencesPolicy` matches on `file` *and* `suite` together.
    const failure = report()!.failures[0]!;
    expect(`${failure.file ?? ''} ${failure.suite ?? ''}`).toContain('tests/example.test.ts');
    expect(failure.name).toContain('fails');
  });

  it('never keeps the failure message', () => {
    // An assertion message can carry values from a test environment, and this
    // data is rendered in a webview. The name, suite and file are enough to
    // open the test.
    expect(JSON.stringify(report())).not.toContain('Object.is equality');
  });
});

describe('the reader refuses output that is not this schema', () => {
  const NOT_A_REPORT = [
    '',
    'not xml at all',
    '<html><body>nope</body></html>',
    '<testsuites',
    '{"suites": 3}',
  ];

  for (const input of NOT_A_REPORT) {
    it(`returns undefined for ${JSON.stringify(input.slice(0, 24))}`, () => {
      // Undefined, never a zeroed report: "0 failing" is a verdict, and
      // publishing one derived from an unreadable file is the drift failure
      // wearing a clean bill of health.
      expect(parseJUnitReport(input)).toBeUndefined();
    });
  }

  it('does not resolve an external entity in a report it was handed', () => {
    // The report is read from disk in the workspace, so it is untrusted input
    // like any other workspace file. The reader is regex-based with no XML
    // parser and no DTD handling, and this pins that.
    const withEntity = [
      '<?xml version="1.0"?>',
      '<!DOCTYPE testsuites [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
      '<testsuites><testsuite name="s" tests="1" failures="0" errors="0" skipped="0">',
      '<testcase name="&xxe;" classname="s"/>',
      '</testsuite></testsuites>',
    ].join('\n');

    expect(JSON.stringify(parseJUnitReport(withEntity) ?? {})).not.toContain('root:');
  });
});
