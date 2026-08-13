import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      writeFile: async (uri: { fsPath: string }, data: Uint8Array) => {
        mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        writeFileSync(uri.fsPath, Buffer.from(data));
      },
    },
  },
  Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
  default: {},
}));

import { scaffoldTestingFramework } from '../../src/core/testingScaffolder.ts';
import {
  COMPLIANCE_EVIDENCE_DIR,
  buildTestingPolicyLaymanGuide,
  deriveTestingPolicyCoverage,
} from '../../src/core/testingPolicyCoverage.ts';
import { PRACTICE_ONLY, REPOSITORY_LEVEL } from '../../src/core/testingObligation.ts';
import { resolveArchetypePack } from '../../src/core/archetypePacks.ts';
import { PROJECT_ARCHETYPES } from '../../src/core/projectArchetype.ts';
import {
  TESTING_METHODOLOGY_DEFINITIONS,
  type ProjectTestingConfig,
  type TestingMethodologyId,
} from '../../src/types.ts';
import { removeTempDir } from '../helpers/tempDir';

/**
 * The catalogue grew from 23 methodologies to 69 in one pass, adding three
 * kinds of policy the registry had never carried: drift checks over the code's
 * own shape, AI-specific behaviour, and compliance regimes.
 *
 * Compliance is the one that needed new machinery. Every other policy answers
 * "does the evidence exist in the file tree?", and a compliance regime mostly
 * does not — "cryptography is governed by a policy" has no assertion. The
 * scaffolder therefore emits a *control mapping* for those, and this file pins
 * the handful of rules that make that honest rather than decorative.
 */
const ALL_IDS = TESTING_METHODOLOGY_DEFINITIONS.map(d => d.id);

function makeConfig(ids: TestingMethodologyId[]): ProjectTestingConfig {
  return {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    methodologies: ids.map(id => ({ id, enabled: true })),
  };
}

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(os.tmpdir(), 'atlas-compliance-'));
});

afterEach(() => {
  removeTempDir(workspace);
});

describe('catalogue completeness', () => {
  it('has no duplicate ids', () => {
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
  });

  it('gives every methodology plain-language copy', () => {
    // The layman guide is a total promise: a newly-added methodology must not
    // fall back to jargon on the "Ask Atlas" action.
    const missing = ALL_IDS.filter(id => {
      const guide = buildTestingPolicyLaymanGuide(id);
      return !guide.whatItIs?.trim() || !guide.expectedResult?.trim();
    });
    expect(missing).toEqual([]);
  });

  it('gives every methodology a category the UI renders', () => {
    // Both surfaces group by category. A definition carrying a key neither
    // lists is not a styling bug — the row silently disappears from the matrix,
    // so the policy cannot be switched on at all.
    const settings = readFileSync(path.resolve(__dirname, '../../src/views/settingsPanel.ts'), 'utf8');
    const dashboard = readFileSync(path.resolve(__dirname, '../../media/projectDashboard.js'), 'utf8');
    const orphaned = [...new Set(TESTING_METHODOLOGY_DEFINITIONS.map(d => d.category))]
      .filter(category => !settings.includes(`'${category}'`) || !dashboard.includes(`'${category}'`));
    expect(orphaned).toEqual([]);
  });

  it('never lists a methodology as both a practice and repository-level', () => {
    // They mean different things — invisible to a file scan versus evidenced by
    // configuration — and a policy in both would get two different answers
    // about whether a change owes it evidence.
    const both = ALL_IDS.filter(id => PRACTICE_ONLY.has(id) && REPOSITORY_LEVEL.has(id));
    expect(both).toEqual([]);
  });
});

describe('archetype packs stay inside the catalogue', () => {
  it('recommends and discourages only ids that exist', () => {
    const known = new Set<string>(ALL_IDS);
    const unknown: string[] = [];
    for (const archetype of PROJECT_ARCHETYPES) {
      const { testing } = resolveArchetypePack(archetype, []);
      for (const id of [...testing.recommended, ...testing.discouraged]) {
        if (!known.has(id)) { unknown.push(`${archetype}: ${id}`); }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('never recommends and discourages the same policy for one shape', () => {
    const conflicts: string[] = [];
    for (const archetype of PROJECT_ARCHETYPES) {
      const { testing } = resolveArchetypePack(archetype, []);
      const discouraged = new Set<string>(testing.discouraged);
      for (const id of testing.recommended) {
        if (discouraged.has(id)) { conflicts.push(`${archetype}: ${id}`); }
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('always explains a discouragement', () => {
    // The reason is the whole point: "not recommended" with no explanation
    // reads as an arbitrary restriction rather than a shape that cannot produce
    // the evidence.
    const silent = PROJECT_ARCHETYPES.filter(archetype => {
      const { testing } = resolveArchetypePack(archetype, []);
      return testing.discouraged.length > 0 && !testing.discouragedReason?.trim();
    });
    expect(silent).toEqual([]);
  });
});

describe('compliance scaffolding', () => {
  it('writes a control mapping where the coverage scanner looks for it', () => {
    // The scaffolder and the scanner must agree on the path, or a project can
    // hold a complete mapping and still read as never assessed.
    return scaffoldTestingFramework(workspace, makeConfig(['iso-27001'])).then(result => {
      const written = result.files.find(f => f.path.includes('iso-27001'));
      expect(written?.created).toBe(true);
      expect(written?.path).toBe(`${COMPLIANCE_EVIDENCE_DIR}/iso-27001.md`);

      const coverage = deriveTestingPolicyCoverage({
        enabledMethodologies: ['iso-27001'],
        testFiles: [],
        dependencies: [],
        scripts: [],
        configFiles: [`${COMPLIANCE_EVIDENCE_DIR}/iso-27001.md`],
      });
      expect(coverage.rows.find(r => r.id === 'iso-27001')?.status).toBe('covered');
    });
  });

  it('seeds every control as Not assessed, never as a pass', async () => {
    // A scaffolder that seeded "Satisfied" would assert something nobody
    // checked, into a file an assessor reads.
    await scaffoldTestingFramework(workspace, makeConfig(['soc2']));
    const doc = readFileSync(path.join(workspace, COMPLIANCE_EVIDENCE_DIR, 'soc2.md'), 'utf8');
    const rows = doc.split(/\r?\n/).filter(line => /^\| `/.test(line));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.includes('Not assessed'))).toBe(true);
    expect(doc).not.toMatch(/\|\s*Satisfied\s*\|/);
  });

  it('never rewrites a mapping that already holds decisions', async () => {
    // These fill with human judgements. Re-running the scaffolder after a
    // review must not erase them.
    await scaffoldTestingFramework(workspace, makeConfig(['gdpr']));
    const docPath = path.join(workspace, COMPLIANCE_EVIDENCE_DIR, 'gdpr.md');
    writeFileSync(docPath, '# reviewed by a person\n\nArt. 17 — Satisfied, see erasure runbook.\n');

    const second = await scaffoldTestingFramework(workspace, makeConfig(['gdpr']));
    expect(readFileSync(docPath, 'utf8')).toContain('reviewed by a person');
    expect(second.files.find(f => f.path.endsWith('gdpr.md'))?.created).toBe(false);
  });

  it('gives a regime with machine-checkable controls both a mapping and a test', async () => {
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '^1' } }));
    const result = await scaffoldTestingFramework(workspace, makeConfig(['gdpr']));
    const paths = result.files.map(f => f.path);
    expect(paths).toContain(`${COMPLIANCE_EVIDENCE_DIR}/gdpr.md`);
    expect(paths.some(p => /gdpr\..*\.test\./.test(p))).toBe(true);
  });

  it('gives a purely documentary regime a mapping and no assertion-free test file', async () => {
    // An assertion-free test stub is the permanent unclosable gap the packs'
    // `discouraged` list exists to prevent — it can never honestly pass and it
    // can never honestly fail.
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '^1' } }));
    const result = await scaffoldTestingFramework(workspace, makeConfig(['aviation-compliance']));
    const paths = result.files.filter(f => !f.path.endsWith('testing-strategy.md')).map(f => f.path);
    expect(paths).toEqual([`${COMPLIANCE_EVIDENCE_DIR}/aviation-compliance.md`]);
  });

  it('writes the same mapping whatever the project is written in', async () => {
    // The regime does not change because the project is written in Go.
    writeFileSync(path.join(workspace, 'go.mod'), 'module example.com/x\n');
    const result = await scaffoldTestingFramework(workspace, makeConfig(['hipaa']));
    expect(result.files.map(f => f.path)).toContain(`${COMPLIANCE_EVIDENCE_DIR}/hipaa.md`);
  });

  it('states the scoping question before the controls', async () => {
    // A mapping filled in before anyone decided what is in scope is a document
    // that looks complete and answers nothing.
    await scaffoldTestingFramework(workspace, makeConfig(['pci-dss']));
    const doc = readFileSync(path.join(workspace, COMPLIANCE_EVIDENCE_DIR, 'pci-dss.md'), 'utf8');
    expect(doc.indexOf('Before this mapping means anything')).toBeLessThan(doc.indexOf('## Controls'));
  });
});

describe('scaffolding stays non-destructive across the whole catalogue', () => {
  it('never writes outside the workspace, whatever is enabled', async () => {
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '^1' } }));
    const result = await scaffoldTestingFramework(workspace, makeConfig(ALL_IDS));
    const escaping = result.files.filter(f => f.path.includes('..') || path.isAbsolute(f.path));
    expect(escaping).toEqual([]);
  });

  it('produces no colliding paths with every policy enabled', async () => {
    // Two policies claiming one path would mean whichever ran second silently
    // reported "already exists" for a file it never wrote.
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '^1' } }));
    const result = await scaffoldTestingFramework(workspace, makeConfig(ALL_IDS));
    const paths = result.files.map(f => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('leaves every file it created actually on disk', async () => {
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '^1' } }));
    const result = await scaffoldTestingFramework(workspace, makeConfig(ALL_IDS));
    const created = result.files.filter(f => f.created).map(f => f.path);
    expect(created.length).toBeGreaterThan(10);
    expect(created.filter(p => !existsSync(path.join(workspace, p)))).toEqual([]);
  });
});
