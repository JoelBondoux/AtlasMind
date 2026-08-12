import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  CURRENT_SCHEMA_VERSIONS,
  SCHEMA_MIGRATIONS,
  applyMigrationLadder,
  describeMigrationOutcome,
  migrateDocument,
  shouldPreserveExisting,
  type SchemaMigrationStep,
} from '../../src/core/schemaMigration.ts';
import { DocumentsManager, readDocumentsFile } from '../../src/core/documentsManager.ts';
import { ProjectDirectorManager } from '../../src/core/projectDirectorManager.ts';
import { RiskOversightManager } from '../../src/core/riskOversightManager.ts';
import { SecurityReviewManager } from '../../src/core/securityReviewManager.ts';
import { removeTempDir } from '../helpers/tempDir';

describe('migrateDocument', () => {
  it('reports a document already at the current version as current', () => {
    const outcome = migrateDocument('documents', { version: 1, filing: [], autoUpdate: [] });
    expect(outcome.status).toBe('current');
  });

  it('refuses a document from a newer AtlasMind rather than reading it', () => {
    const outcome = migrateDocument('documents', { version: 7, filing: [] });
    expect(outcome).toMatchObject({ status: 'refused', foundVersion: 7, expectedVersion: 1 });
    expect(shouldPreserveExisting(outcome)).toBe(true);
  });

  it('marks only a refusal as must-preserve', () => {
    // An invalid document is corrupt or foreign and may be replaced; a refused
    // one is somebody's real data that this build simply cannot read.
    expect(shouldPreserveExisting({ status: 'invalid' })).toBe(false);
    expect(shouldPreserveExisting({ status: 'current' })).toBe(false);
    expect(shouldPreserveExisting({ status: 'migrated' })).toBe(false);
  });

  it('rejects anything that is not a versioned object', () => {
    for (const input of [null, undefined, 42, 'text', [], {}, { version: 0 }, { version: 1.5 }, { version: '1' }]) {
      expect(migrateDocument('documents', input).status, JSON.stringify(input)).toBe('invalid');
    }
  });

  it('refuses an unknown document kind', () => {
    expect(migrateDocument('not-a-kind' as never, { version: 1 }).status).toBe('invalid');
  });

  it('can reach every declared version from 1', () => {
    // The real invariant, and the mistake this suite exists to catch: a version
    // bumped without the migration that reaches it. A document at the older
    // version then fails to migrate and reads as `invalid` — which every manager
    // treats as licence to overwrite it with a fresh default.
    //
    // (This previously also asserted the registry was empty. It stopped being
    // true in v0.222.0, when `testing-config` gained the `blocking` field.)
    for (const [kind, version] of Object.entries(CURRENT_SCHEMA_VERSIONS)) {
      const ladder = SCHEMA_MIGRATIONS.filter(step => step.kind === kind).sort((left, right) => left.from - right.from);
      expect(ladder.length, `${kind} is at v${version} with ${ladder.length} migrations`).toBe(version - 1);

      // Contiguous and single-stepped: 1→2→3, never 1→3 or two steps from 2.
      ladder.forEach((step, index) => {
        expect(step.from, `${kind} ladder is not contiguous at index ${index}`).toBe(index + 1);
        expect(step.to, `${kind} step ${step.from} does not advance by exactly one`).toBe(step.from + 1);
      });
    }
  });

  it('migrates a v1 testing config forward without inventing a blocking decision', () => {
    const outcome = migrateDocument('testing-config', {
      version: 1,
      updatedAt: '2026-06-09T00:00:00.000Z',
      methodologies: [{ id: 'unit', enabled: true }],
    });

    expect(outcome.status).toBe('migrated');
    const value = (outcome as { value: Record<string, unknown> }).value;
    expect(value['version']).toBe(2);
    // Absent means "this project never considered the question". An explicit
    // `false` would mean "this project decided against it" — a claim a migration
    // has no standing to make on the user's behalf.
    expect((value['methodologies'] as Array<Record<string, unknown>>)[0]).not.toHaveProperty('blocking');
  });

  describe('website v1 → v2', () => {
    const v1 = () => ({
      version: 1,
      updatedAt: '2026-06-09T00:00:00.000Z',
      intake: { clientName: 'Northstar' },
      pages: [
        { id: 'page-home', title: 'Home', slug: '/', sections: ['Hero', 'Proof', 'Contact'] },
        { id: 'page-about', title: 'About', slug: '/about', sections: [] },
      ],
    });

    it('transcribes the old sections into a drawn wireframe', () => {
      // An empty canvas would read as "your layout work is gone" to somebody who
      // had filled in eight sections.
      const outcome = migrateDocument('website', v1());
      expect(outcome.status).toBe('migrated');
      const value = (outcome as { value: Record<string, unknown> }).value;
      const pages = value['pages'] as Array<Record<string, unknown>>;
      const wireframe = pages[0]!['wireframe'] as { elements: Array<Record<string, unknown>> };

      expect(wireframe.elements.map(element => element['label'])).toEqual(['Hero', 'Proof', 'Contact']);
      // Stacked, in the order the list was in — the only thing the list said.
      const tops = wireframe.elements.map(element => (element['rect'] as { y: number }).y);
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      expect(new Set(tops).size).toBe(tops.length);
    });

    it('leaves a page with no sections without a wireframe rather than inventing one', () => {
      const outcome = migrateDocument('website', v1());
      const pages = (outcome as { value: Record<string, unknown> }).value['pages'] as Array<Record<string, unknown>>;
      expect(pages[1]).not.toHaveProperty('wireframe');
    });

    it('seeds order from array position — the only ordering a v1 file recorded', () => {
      const outcome = migrateDocument('website', v1());
      const pages = (outcome as { value: Record<string, unknown> }).value['pages'] as Array<Record<string, unknown>>;
      expect(pages.map(page => page['order'])).toEqual([0, 1]);
    });

    it('seeds design prompts and links empty rather than guessing at them', () => {
      // A migration has no standing to write a design intent on the author's
      // behalf, and a guessed link is indistinguishable from one they set.
      const outcome = migrateDocument('website', v1());
      const value = (outcome as { value: Record<string, unknown> }).value;
      expect(value['designPrompt']).toBe('');
      const pages = value['pages'] as Array<Record<string, unknown>>;
      for (const page of pages) {
        expect(page['designPrompt']).toBe('');
        expect(page['links']).toEqual([]);
      }
    });

    it('refuses a website file written by a newer AtlasMind', () => {
      const outcome = migrateDocument('website', { ...v1(), version: 99 });
      expect(outcome.status).toBe('refused');
    });

    it('climbs a v1 file all the way to the current version in one pass', () => {
      const outcome = migrateDocument('website', v1());
      expect(outcome.status).toBe('migrated');
      expect((outcome as { value: Record<string, unknown> }).value['version']).toBe(8);
    });
  });

  describe('website v2 → v3', () => {
    const v2 = () => ({
      version: 2,
      updatedAt: '2026-07-01T00:00:00.000Z',
      designPrompt: 'Editorial and calm.',
      intake: { clientName: 'Northstar' },
      pages: [{ id: 'page-home', title: 'Home', slug: '/', sections: [], order: 0, designPrompt: '', links: [] }],
    });

    it('adds the version and nothing else', () => {
      const outcome = migrateDocument('website', v2());
      expect(outcome.status).toBe('migrated');
      const value = (outcome as { value: Record<string, unknown> }).value;
      // migrateDocument climbs the whole ladder, so a v2 file lands on the
      // current version rather than stopping at the next step.
      expect(value['version']).toBe(8);
      // No stack is invented. Absent means nobody has chosen one, and a wrong
      // guess here decides what gets scaffolded.
      expect(value).not.toHaveProperty('stack');
    });

    it('preserves everything v2 already held', () => {
      const outcome = migrateDocument('website', v2());
      const value = (outcome as { value: Record<string, unknown> }).value;
      expect(value['designPrompt']).toBe('Editorial and calm.');
      expect((value['pages'] as unknown[])).toHaveLength(1);
    });

    it('climbs on past v3 to the current version', () => {
      const outcome = migrateDocument('website', v2());
      expect((outcome as { value: Record<string, unknown> }).value['version']).toBe(8);
    });
  });

  describe('website v3 → v4', () => {
    const v3 = () => ({
      version: 3,
      updatedAt: '2026-08-01T00:00:00.000Z',
      designPrompt: 'Editorial and calm.',
      intake: { clientName: 'Northstar' },
      stack: { frameworkId: 'astro', platformId: 'cloudflare-pages', packageManager: 'npm', decidedAt: '2026-08-01T00:00:00.000Z' },
      pages: [{ id: 'page-home', title: 'Home', slug: '/', sections: [], order: 0, designPrompt: '', links: [] }],
    });

    it('adds the version and creates no content', () => {
      // Content lives in files this migration has no business writing, and an
      // absent content file is a meaningful state — "nobody has written this
      // yet" — that seeding would destroy.
      const outcome = migrateDocument('website', v3());
      expect(outcome.status).toBe('migrated');
      const value = (outcome as { value: Record<string, unknown> }).value;
      expect(value['version']).toBe(8);
      expect(value).not.toHaveProperty('content');
    });

    it('preserves the stack choice v3 recorded', () => {
      const outcome = migrateDocument('website', v3());
      const value = (outcome as { value: Record<string, unknown> }).value;
      expect((value['stack'] as Record<string, unknown>)['frameworkId']).toBe('astro');
    });

    it('moves a v4 website into the generalized UI profile without inventing guidance', () => {
      const outcome = migrateDocument('website', { ...v3(), version: 4 });
      expect(outcome.status).toBe('migrated');
      const value = (outcome as { value: Record<string, unknown> }).value;
      expect(value).toMatchObject({
        version: 8,
        surfaceKind: 'website',
        contentDesign: { principles: [], preferredTerms: [], avoidedTerms: [] },
        implementation: { targetTechnologies: [], sourceRoots: [], componentLocations: [], notes: [] },
      });
    });

    it('transcribes a v5 wireframe into the v6 graph without inventing responsive intent', () => {
      const page = {
        id: 'page-home',
        wireframe: {
          breakpoint: 'mobile',
          elements: [{
            id: 'hero', kind: 'hero', label: 'Opening', rect: { x: 1, y: 2, width: 3, height: 4 },
            designPrompt: 'Editorial.', notes: 'Keep.',
          }],
        },
      };
      const outcome = migrateDocument('website', { ...v3(), version: 5, pages: [page] });
      expect(outcome.status).toBe('migrated');
      const value = (outcome as { value: Record<string, unknown> }).value;
      expect(value['designGraph']).toMatchObject({
        revision: 0,
        tokens: [],
        components: [],
        screens: [{
          id: 'page-home',
          pageId: 'page-home',
          initialized: true,
          baseBreakpoint: 'mobile',
          nodes: [{
            id: 'hero',
            label: 'Opening',
            layout: {
              mode: 'free',
              rect: { x: 1, y: 2, width: 3, height: 4 },
              widthMode: 'fixed',
              heightMode: 'fixed',
              hidden: false,
            },
            viewportOverrides: {},
          }],
        }],
      });
      expect((value['pages'] as unknown[])[0]).toEqual(page);
    });

    it('preserves an untouched page as uninitialized in the v6 graph', () => {
      const outcome = migrateDocument('website', {
        ...v3(),
        version: 5,
        pages: [{ id: 'page-home', sections: [] }],
      });
      const value = (outcome as { value: Record<string, unknown> }).value;
      expect(value['designGraph']).toMatchObject({
        screens: [{ pageId: 'page-home', initialized: false, nodes: [] }],
      });
    });

    it('adds an empty token collection to a v6 graph without changing graph facts', () => {
      const designGraph = {
        revision: 9,
        screens: [{ id: 'page-home', pageId: 'page-home', initialized: false, baseBreakpoint: 'desktop', nodes: [] }],
      };
      const outcome = migrateDocument('website', { ...v3(), version: 6, designGraph });
      expect(outcome.status).toBe('migrated');
      const value = (outcome as { value: Record<string, unknown> }).value;
      expect(value).toMatchObject({
        version: 8,
        designGraph: { ...designGraph, tokens: [], components: [] },
      });
    });

    it('adds an empty component collection to v7 without inferring instances', () => {
      const designGraph = { revision: 3, tokens: [], screens: [] };
      const outcome = migrateDocument('website', { ...v3(), version: 7, designGraph });
      expect(outcome).toMatchObject({ status: 'migrated', value: { version: 8, designGraph: { ...designGraph, components: [] } } });
    });

    it('does not re-run on a file already at v8', () => {
      expect(migrateDocument('website', { ...v3(), version: 8 }).status).toBe('current');
    });
  });
});

/**
 * The ladder is what actually runs the first time a format changes. With every
 * kind at v1 it is unreachable through `migrateDocument`, so it is tested
 * directly — otherwise this whole mechanism would ship unexercised.
 */
describe('applyMigrationLadder', () => {
  const steps: SchemaMigrationStep[] = [
    { kind: 'documents', from: 1, to: 2, summary: 'Added owners.', migrate: doc => ({ ...doc, owners: [] }) },
    { kind: 'documents', from: 2, to: 3, summary: 'Renamed shelves.', migrate: doc => ({ ...doc, shelves: doc['filing'] }) },
  ];

  it('runs every step in order and stamps the resulting version', () => {
    const result = applyMigrationLadder('documents', { version: 1, filing: ['a'] }, 1, 3, steps);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.document).toMatchObject({ version: 3, filing: ['a'], owners: [], shelves: ['a'] });
    expect(result.applied).toEqual(['Added owners.', 'Renamed shelves.']);
  });

  it('starts from the version found, not from the beginning', () => {
    const result = applyMigrationLadder('documents', { version: 2, filing: ['a'] }, 2, 3, steps);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    // The 1→2 step must not re-run: it would re-add a field the user removed.
    expect(result.document['owners']).toBeUndefined();
    expect(result.applied).toEqual(['Renamed shelves.']);
  });

  it('stops with a reason when a step in the chain is missing', () => {
    const result = applyMigrationLadder('documents', { version: 1 }, 1, 3, [steps[1]!]);
    expect(result).toEqual({ ok: false, reason: 'no migration from v1 to v2 for "documents"' });
  });

  it('reports a throwing step rather than half-applying the chain', () => {
    const exploding: SchemaMigrationStep[] = [
      steps[0]!,
      { kind: 'documents', from: 2, to: 3, summary: 'boom', migrate: () => { throw new Error('bad data'); } },
    ];
    const result = applyMigrationLadder('documents', { version: 1 }, 1, 3, exploding);
    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.reason).toContain('v2→v3');
    expect(result.reason).toContain('bad data');
  });

  it('stamps the version even when a step forgets to', () => {
    const forgetful: SchemaMigrationStep[] = [
      { kind: 'documents', from: 1, to: 2, summary: 'forgot', migrate: doc => ({ ...doc, extra: true }) },
    ];
    const result = applyMigrationLadder('documents', { version: 1 }, 1, 2, forgetful);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.document['version']).toBe(2);
  });

  it('does nothing when there is nothing to climb', () => {
    const result = applyMigrationLadder('documents', { version: 1 }, 1, 1, steps);
    expect(result).toMatchObject({ ok: true, applied: [] });
  });

  it('ignores steps belonging to another document kind', () => {
    const otherKind: SchemaMigrationStep[] = [
      { kind: 'missions', from: 1, to: 2, summary: 'wrong kind', migrate: doc => doc },
    ];
    expect(applyMigrationLadder('documents', { version: 1 }, 1, 2, otherKind).ok).toBe(false);
  });
});

describe('describeMigrationOutcome', () => {
  it('says the file was left untouched when it is from a newer build', () => {
    const message = describeMigrationOutcome('documents', {
      status: 'refused', foundVersion: 3, expectedVersion: 1, reason: 'written by a newer version of AtlasMind (format v3; this build reads v1)',
    });
    expect(message).toContain('left it untouched');
    expect(message).toContain('v3');
  });

  it('has nothing to say about an ordinary read', () => {
    expect(describeMigrationOutcome('documents', { status: 'current', value: {} })).toBeUndefined();
  });
});

describe('DocumentsManager — a newer file is never overwritten', () => {
  const roots: string[] = [];
  const makeWorkspace = (contents: unknown): string => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-migration-'));
    roots.push(root);
    mkdirSync(path.join(root, 'project_memory', 'operations'), { recursive: true });
    writeFileSync(path.join(root, 'project_memory', 'operations', 'documents.json'), JSON.stringify(contents), 'utf8');
    return root;
  };
  const readBack = (root: string): unknown =>
    JSON.parse(readFileSync(path.join(root, 'project_memory', 'operations', 'documents.json'), 'utf8'));

  afterEach(() => {
    while (roots.length > 0) {
      removeTempDir(roots.pop()!);
    }
  });

  it('leaves a future-format file exactly as it found it', async () => {
    // The bug this closes: an unreadable file made the manager seed a default
    // and write it back, destroying a registry written by a newer AtlasMind.
    const future = { version: 99, filing: [{ id: 'f1', label: 'Docs', path: 'docs' }], autoUpdate: [], updatedAt: '2027-01-01T00:00:00.000Z' };
    const root = makeWorkspace(future);

    const manager = new DocumentsManager(root);
    await manager.ensureSeeded({ presentDocFolders: ['docs'], keyDocs: ['README.md'] });

    expect(readBack(root)).toEqual(future);
  });

  it('tells the user why, rather than failing silently', () => {
    const root = makeWorkspace({ version: 99, filing: [], autoUpdate: [] });
    const notice = new DocumentsManager(root).getNotice();
    expect(notice).toContain('newer version of AtlasMind');
    expect(notice).toContain('left it untouched');
  });

  it('still seeds over a genuinely corrupt file', () => {
    // Corrupt is not the same as newer: there is nothing to preserve.
    const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-migration-'));
    roots.push(root);
    mkdirSync(path.join(root, 'project_memory', 'operations'), { recursive: true });
    writeFileSync(path.join(root, 'project_memory', 'operations', 'documents.json'), '{ not json', 'utf8');

    const read = readDocumentsFile(root);
    expect(read.config).toBeUndefined();
    expect(read.preserveExisting).toBe(false);
  });

  it('reads a current-format file normally', () => {
    const root = makeWorkspace({ version: 1, filing: [{ id: 'f1', label: 'Docs', path: 'docs' }], autoUpdate: [] });
    const read = readDocumentsFile(root);
    expect(read.config?.filing).toHaveLength(1);
    expect(read.preserveExisting).toBe(false);
    expect(read.notice).toBeUndefined();
  });

  it('protects every SSOT register the same way, not just documents', async () => {
    // Four managers had the identical seed-over-unreadable path. The roster is
    // the one that matters most — it holds real people — so the guarantee has
    // to hold across all of them, not just the one that was found first.
    const cases: Array<{ file: string; construct: (root: string) => { ensureSeeded: (seed?: never) => Promise<unknown>; getNotice(): string | undefined } }> = [
      { file: 'project-director.json', construct: root => new ProjectDirectorManager(root) as never },
      { file: 'risk-oversight.json', construct: root => new RiskOversightManager(root) as never },
      { file: 'security-review.json', construct: root => new SecurityReviewManager(root) as never },
    ];

    for (const testCase of cases) {
      const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-migration-'));
      roots.push(root);
      mkdirSync(path.join(root, 'project_memory', 'operations'), { recursive: true });
      const future = { version: 99, keptByANewerBuild: true };
      const target = path.join(root, 'project_memory', 'operations', testCase.file);
      writeFileSync(target, JSON.stringify(future), 'utf8');

      const manager = testCase.construct(root);
      await manager.ensureSeeded({ projectName: 'x', contacts: [] } as never);

      expect(JSON.parse(readFileSync(target, 'utf8')), testCase.file).toEqual(future);
      expect(manager.getNotice(), testCase.file).toContain('newer version of AtlasMind');
    }
  });

  it('an explicit save still writes — the user is editing on purpose', async () => {
    const root = makeWorkspace({ version: 99, filing: [], autoUpdate: [] });
    const manager = new DocumentsManager(root);
    expect(manager.getNotice()).toBeTruthy();

    await manager.save({ version: 1, filing: [], autoUpdate: [], updatedAt: '2026-07-28T00:00:00.000Z' });

    expect((readBack(root) as { version: number }).version).toBe(1);
    // Nothing left to warn about once the file is this build's format.
    expect(manager.getNotice()).toBeUndefined();
  });
});
