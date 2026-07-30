import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildTestingObligationGuidance,
  readProjectTestingConfig,
  readProjectTestingConfigDocument,
} from '../../src/core/testingConfigLoader.ts';
import { removeTempDir } from '../helpers/tempDir.ts';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../../src/types.ts';
import type { ProjectTestingConfig, TestingMethodologyId } from '../../src/types.ts';

/**
 * The regression this file exists for: fourteen methodologies were enabled on
 * 2026-06-09, and eight of them still had no evidence of any kind seven weeks
 * later. The declaration was never wrong — it was never *shown* to the agent that
 * could have honoured it, because the only channel carrying testing policy into a
 * prompt required the task to already be about testing.
 */

const config = (enabled: TestingMethodologyId[]): ProjectTestingConfig => ({
  version: 1,
  updatedAt: '2026-07-30T00:00:00.000Z',
  methodologies: TESTING_METHODOLOGY_DEFINITIONS.map(definition => ({
    id: definition.id,
    enabled: enabled.includes(definition.id),
  })),
});

describe('buildTestingObligationGuidance', () => {
  it('says nothing when the project has declared no policy', () => {
    // A project with nothing enabled must not receive generic advice about
    // testing. Boilerplate nobody asked for is how a prompt block becomes
    // something agents learn to skip.
    expect(buildTestingObligationGuidance(undefined)).toBe('');
    expect(buildTestingObligationGuidance(config([]))).toBe('');
  });

  it('names every enabled methodology, not one match', () => {
    const guidance = buildTestingObligationGuidance(config(['unit', 'e2e', 'mutation', 'property']));

    // The per-methodology hint this sits alongside answers "which methodology
    // owns this testing task" and returns exactly one. Reusing that here would
    // have silently dropped thirteen of the fourteen declared policies.
    expect(guidance).toContain('Unit');
    expect(guidance).toContain('End-to-End');
    expect(guidance).toContain('Mutation');
    expect(guidance).toContain('Property');
  });

  it('states an obligation rather than asking for a report', () => {
    const guidance = buildTestingObligationGuidance(config(['unit']));

    expect(guidance).toContain('not finished until it carries the evidence');
    // "Report the checks you used" — the old wording — is satisfiable with a
    // sentence and was.
    expect(guidance).toContain('name the tests you wrote or ran and what they actually');
  });

  it('asks for no artifact from a practice, and still names it', () => {
    const guidance = buildTestingObligationGuidance(config(['exploratory', 'v-model']));

    expect(guidance).toContain('Exploratory');
    expect(guidance).toContain('leave no file behind');
    // Asking for a file a practice cannot produce invites an invented one.
    expect(guidance).not.toContain('Produce it, or state why not');
  });

  it('separates artifact-backed methodologies from practices', () => {
    const guidance = buildTestingObligationGuidance(config(['unit', 'exploratory']));

    expect(guidance).toContain('Produce it, or state why not');
    expect(guidance).toContain('leave no file behind');
  });

  it('agrees with the coverage scanner about which methodologies are practices', () => {
    // Two lists, two modules: this one decides what an agent is *asked* for,
    // `testingPolicyCoverage` decides what counts as a *gap*. If they drift, an
    // agent is asked to produce a file for something the dashboard will never
    // look for — or a real gap is quietly never requested.
    const source = readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'core', 'testingPolicyCoverage.ts'),
      'utf8',
    );
    const scannerPractices = new Set(
      [...source.matchAll(/'?([a-z-]+)'?\s*:\s*\{\s*practiceOnly:\s*true\s*\}/g)].map(match => match[1]!),
    );

    expect(scannerPractices.size).toBeGreaterThan(0);

    for (const id of scannerPractices) {
      const guidance = buildTestingObligationGuidance(config([id as TestingMethodologyId]));
      expect(guidance, `${id} is practiceOnly in the scanner but asked for an artifact here`)
        .not.toContain('Produce it, or state why not');
    }
  });
});

describe('readProjectTestingConfig — versioned document boundary', () => {
  const withConfigFile = <T>(document: unknown, run: (root: string) => T): T => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-testing-schema-'));
    try {
      mkdirSync(path.join(root, 'project_memory', 'index'), { recursive: true });
      writeFileSync(
        path.join(root, 'project_memory', 'index', 'testing-config.json'),
        JSON.stringify(document),
        'utf8',
      );
      return run(root);
    } finally {
      removeTempDir(root);
    }
  };

  it('reads a v1 file and brings it forward', () => {
    withConfigFile(
      { version: 1, updatedAt: '2026-06-09T00:00:00.000Z', methodologies: [{ id: 'unit', enabled: true }] },
      root => {
        const read = readProjectTestingConfigDocument(root);
        expect(read.config?.methodologies[0]?.id).toBe('unit');
        expect(read.preserveExisting).toBe(false);
        // The migration adds no `blocking` field. Absent says "never considered";
        // an explicit false would say "decided against", which a migration has no
        // standing to claim on the user's behalf.
        expect(read.config?.methodologies[0]).not.toHaveProperty('blocking');
      },
    );
  });

  it('refuses a file written by a newer AtlasMind instead of reporting no policy', () => {
    // The old reader hard-gated on `version === 1`, so this read as `undefined` —
    // indistinguishable from "no testing policy", which is what every writer in
    // the project treats as licence to persist a fresh default over the top. For
    // a document whose whole content is "which methodologies are on", that is a
    // silent way to switch a project's testing policy off.
    withConfigFile(
      { version: 99, updatedAt: '2030-01-01T00:00:00.000Z', methodologies: [{ id: 'unit', enabled: true }] },
      root => {
        const read = readProjectTestingConfigDocument(root);
        expect(read.preserveExisting).toBe(true);
        expect(read.config).toBeUndefined();
        expect(read.notice).toBeTruthy();
      },
    );
  });

  it('treats an unparseable file as replaceable, not as precious', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-testing-schema-'));
    try {
      mkdirSync(path.join(root, 'project_memory', 'index'), { recursive: true });
      writeFileSync(path.join(root, 'project_memory', 'index', 'testing-config.json'), '{ not json', 'utf8');
      const read = readProjectTestingConfigDocument(root);
      expect(read.preserveExisting).toBe(false);
      expect(read.config).toBeUndefined();
    } finally {
      removeTempDir(root);
    }
  });

  it('reports no config and nothing to preserve when the file is absent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-testing-schema-'));
    try {
      expect(readProjectTestingConfigDocument(root)).toEqual({ preserveExisting: false });
      expect(readProjectTestingConfig(root)).toBeUndefined();
    } finally {
      removeTempDir(root);
    }
  });
});
