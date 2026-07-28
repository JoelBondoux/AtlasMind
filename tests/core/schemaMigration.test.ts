import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('ships no migrations yet, because no format has changed', () => {
    expect(SCHEMA_MIGRATIONS).toEqual([]);
    // Every kind starts at 1; a bump here without a migration is the mistake
    // this suite exists to catch.
    for (const [kind, version] of Object.entries(CURRENT_SCHEMA_VERSIONS)) {
      const ladder = SCHEMA_MIGRATIONS.filter(step => step.kind === kind);
      expect(ladder.length, `${kind} is at v${version} with ${ladder.length} migrations`).toBe(version - 1);
    }
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
      rmSync(roots.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
