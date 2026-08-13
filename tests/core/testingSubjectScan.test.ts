import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  scanTestingSubjects,
  uncoveredTestingSubjects,
  clearTestingSubjectScanCache,
} from '../../src/core/testingSubjectScan.ts';
import { buildTestingObligationGuidance } from '../../src/core/testingConfigLoader.ts';
import { TESTING_METHODOLOGY_DEFINITIONS, type TestingMethodologyId } from '../../src/types.ts';
import { removeTempDir } from '../helpers/tempDir';

/**
 * End to end over a real directory: a declared artifact lands, and a testing
 * obligation exists for it without anybody writing a rule.
 *
 * The scan is shared by the Testing dashboard and the agent obligation prompt
 * on purpose. A page saying an endpoint is untested while the turn that touched
 * it was told nothing would be worse than neither existing, because one of them
 * is then lying.
 */
const LABELS = new Map(TESTING_METHODOLOGY_DEFINITIONS.map(d => [d.id, d.label] as const));

let workspace: string;

beforeEach(() => {
  clearTestingSubjectScanCache();
  workspace = mkdtempSync(path.join(os.tmpdir(), 'atlas-subjects-'));
});

afterEach(() => {
  removeTempDir(workspace);
});

function write(relative: string, body: string): void {
  const absolute = path.join(workspace, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
}

const SPEC = `
openapi: 3.0.0
paths:
  /v1/orders:
    get:
      summary: List
  /v1/refunds:
    post:
      summary: Refund
`;

describe('a new contract creates a new obligation, with no rule written', () => {
  it('reports both paths as uncovered when nothing tests them', () => {
    write('openapi.yaml', SPEC);
    write('tests/unit.test.ts', "it('adds', () => expect(1 + 1).toBe(2));");

    const report = scanTestingSubjects(workspace, ['contract', 'unit']);
    expect(report.byPolicy.get('contract')).toEqual({ total: 2, uncovered: 2 });
  });

  it('clears one the moment a test names it', () => {
    write('openapi.yaml', SPEC);
    write('tests/orders.contract.test.ts', "request(app).get('/v1/orders')");

    const report = scanTestingSubjects(workspace, ['contract'], { force: true });
    const uncovered = uncoveredTestingSubjects(report, LABELS).map(entry => entry.label);
    expect(uncovered).toEqual(['POST /v1/refunds']);
  });

  it('raises the new one as soon as the spec grows', () => {
    // The property the whole feature exists for.
    write('openapi.yaml', SPEC);
    write('tests/orders.contract.test.ts', "request(app).get('/v1/orders')\nrequest(app).post('/v1/refunds')");
    expect(uncoveredTestingSubjects(scanTestingSubjects(workspace, ['contract'], { force: true }), LABELS)).toEqual([]);

    write('openapi.yaml', `${SPEC}  /v1/disputes:\n    post:\n      summary: Dispute\n`);
    const after = uncoveredTestingSubjects(scanTestingSubjects(workspace, ['contract'], { force: true }), LABELS);
    expect(after.map(entry => entry.label)).toEqual(['POST /v1/disputes']);
  });

  it('names the file the obligation came from', () => {
    write('openapi.yaml', SPEC);
    const [first] = uncoveredTestingSubjects(scanTestingSubjects(workspace, ['contract']), LABELS);
    expect(first.source).toBe('openapi.yaml');
    expect(first.policyLabel).toBe('Contract');
  });

  it('reports nothing for a policy that is not enabled', () => {
    // A project that has not declared contract testing is owed no contract
    // obligations, whatever its spec contains.
    write('openapi.yaml', SPEC);
    const report = scanTestingSubjects(workspace, ['unit'], { force: true });
    expect(report.byPolicy.get('contract')).toBeUndefined();
  });

  it('never walks into a dependency directory', () => {
    write('openapi.yaml', SPEC);
    write('node_modules/some-pkg/openapi.yaml', SPEC.replace('/v1/orders', '/vendor/thing'));
    const labels = uncoveredTestingSubjects(scanTestingSubjects(workspace, ['contract']), LABELS).map(e => e.label);
    expect(labels.some(label => label.includes('/vendor/thing'))).toBe(false);
  });

  it('survives an unreadable workspace without throwing', () => {
    expect(() => scanTestingSubjects(path.join(workspace, 'does-not-exist'), ['contract'])).not.toThrow();
  });
});

describe('the obligation prompt names what is outstanding', () => {
  it('tells the agent the specific item, not just the methodology', () => {
    // A model told "this project does contract testing" cannot know the
    // endpoint it is about to touch is one of the untested ones.
    write('openapi.yaml', SPEC);
    const uncovered = uncoveredTestingSubjects(scanTestingSubjects(workspace, ['contract']), LABELS);
    const prompt = buildTestingObligationGuidance(
      {
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        methodologies: [{ id: 'contract' as TestingMethodologyId, enabled: true }],
      },
      uncovered,
    );
    expect(prompt).toContain('GET /v1/orders');
    expect(prompt).toContain('openapi.yaml');
    expect(prompt).toMatch(/owes a test that names it/i);
  });

  it('says nothing extra when everything is covered', () => {
    const prompt = buildTestingObligationGuidance(
      {
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        methodologies: [{ id: 'contract' as TestingMethodologyId, enabled: true }],
      },
      [],
    );
    expect(prompt).not.toMatch(/ALREADY OUTSTANDING/);
  });

  it('still returns nothing at all when no policy is declared', () => {
    // A project with no policy is told nothing, rather than given generic
    // advice about testing nobody asked for.
    expect(buildTestingObligationGuidance(undefined, [
      { policyLabel: 'Contract', label: 'GET /x', source: 'openapi.yaml' },
    ])).toBe('');
  });
});

describe('the scan is cached, and the cache cannot go stale silently', () => {
  it('reuses a recent result', () => {
    write('openapi.yaml', SPEC);
    const first = scanTestingSubjects(workspace, ['contract'], { now: 1_000 });
    write('openapi.yaml', `${SPEC}  /v1/new:\n    get:\n      summary: New\n`);
    const second = scanTestingSubjects(workspace, ['contract'], { now: 1_500 });
    expect(second).toBe(first);
  });

  it('re-reads once the window passes', () => {
    write('openapi.yaml', SPEC);
    scanTestingSubjects(workspace, ['contract'], { now: 1_000 });
    write('openapi.yaml', `${SPEC}  /v1/new:\n    get:\n      summary: New\n`);
    const later = scanTestingSubjects(workspace, ['contract'], { now: 1_000 + 60_000 });
    expect(later.byPolicy.get('contract')?.total).toBe(3);
  });

  it('re-reads when the enabled policies change', () => {
    // A cached answer for a different policy set is an answer to a different
    // question.
    write('openapi.yaml', SPEC);
    scanTestingSubjects(workspace, ['contract'], { now: 1_000 });
    const other = scanTestingSubjects(workspace, ['contract', 'e2e'], { now: 1_100 });
    expect(other.byPolicy.get('contract')?.total).toBe(2);
  });

  it('re-reads on force, so an explicit refresh is never stale', () => {
    write('openapi.yaml', SPEC);
    scanTestingSubjects(workspace, ['contract'], { now: 1_000 });
    write('openapi.yaml', `${SPEC}  /v1/new:\n    get:\n      summary: New\n`);
    expect(scanTestingSubjects(workspace, ['contract'], { now: 1_100, force: true })
      .byPolicy.get('contract')?.total).toBe(3);
  });
});
