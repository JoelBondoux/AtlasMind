import { describe, it, expect } from 'vitest';
import {
  CURRENT_SCHEMA_VERSIONS,
  interpretVersionedDocument,
  migrateDocument,
  shouldPreserveExisting,
} from '../src/core/schemaMigration.js';
import type { SchemaDocumentKind } from '../src/core/schemaMigration.js';

/**
 * State drift: a document on disk was written by a build that no longer exists,
 * and the reader assumes a shape nobody re-checked.
 *
 * `tests/core/schemaMigration.test.ts` covers each ladder step in detail. What
 * it does not do — and what state drift actually is — is assert the property
 * across *every* document kind at once. AtlasMind persists thirteen of them
 * through nine managers, and the bug this closes is not a wrong migration but
 * one kind quietly behaving differently from the rest: a manager that seeds
 * over a newer file because its kind was never added to the table.
 *
 * So every assertion below runs over `CURRENT_SCHEMA_VERSIONS` rather than over
 * a chosen example. A kind added without a version is a compile error; a kind
 * added with a version that behaves differently fails here.
 */

const KINDS = Object.keys(CURRENT_SCHEMA_VERSIONS) as SchemaDocumentKind[];
const anyShape = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

describe('every persisted kind treats a newer file the same way', () => {
  it('has at least one kind to check', () => {
    // Guards the loops below against passing on an empty table.
    expect(KINDS.length).toBeGreaterThan(0);
  });

  for (const kind of KINDS) {
    describe(kind, () => {
      const current = CURRENT_SCHEMA_VERSIONS[kind];

      it('reads a current-version document', () => {
        const outcome = migrateDocument(kind, { version: current });
        expect(outcome.status).toBe('current');
      });

      it('refuses a document from a newer build rather than replacing it', () => {
        // The distinction the whole module exists for. `refused` is somebody's
        // real data; `invalid` is corrupt or foreign and may be replaced.
        // Collapsing them is how an older build destroys a newer one's file.
        const outcome = migrateDocument(kind, { version: current + 1 });
        expect(outcome.status).toBe('refused');
        expect(shouldPreserveExisting(outcome)).toBe(true);
      });

      it('does not preserve a document that is merely corrupt', () => {
        for (const junk of [null, [], 'text', 42, {}, { version: 'two' }, { version: 0 }, { version: 1.5 }]) {
          const outcome = migrateDocument(kind, junk);
          expect(outcome.status, `${JSON.stringify(junk)}`).toBe('invalid');
          expect(shouldPreserveExisting(outcome)).toBe(false);
        }
      });

      it('climbs from v1 to the current version in one read', () => {
        const outcome = migrateDocument(kind, { version: 1 });
        expect(['current', 'migrated']).toContain(outcome.status);
        if (outcome.status === 'migrated') {
          expect(outcome.to).toBe(current);
          expect(outcome.value['version']).toBe(current);
        }
      });

      it('tells the caller to preserve, and hands back no document, when refusing', () => {
        // Both halves matter. A read that set `preserveExisting` but still
        // returned a config would have the caller act on a document this build
        // cannot actually understand.
        const read = interpretVersionedDocument(kind, { version: current + 5 }, anyShape);
        expect(read.preserveExisting).toBe(true);
        expect(read.config).toBeUndefined();
        expect(read.notice, 'a refusal with no explanation is indistinguishable from a bug').toBeTruthy();
      });

      it('allows a reseed when the version is right but the shape is wrong', () => {
        // Right version, wrong shape: corrupt rather than futuristic.
        const read = interpretVersionedDocument(
          kind,
          { version: current },
          (value): value is Record<string, unknown> => anyShape(value) && 'expected' in value,
        );
        expect(read.preserveExisting).toBe(false);
        expect(read.config).toBeUndefined();
      });
    });
  }
});

describe('the version table is internally consistent', () => {
  it('starts every kind at 1 or above', () => {
    for (const kind of KINDS) {
      expect(CURRENT_SCHEMA_VERSIONS[kind], kind).toBeGreaterThanOrEqual(1);
    }
  });

  it('refuses a kind it has never heard of rather than defaulting to v1', () => {
    // A typo in a kind must not read as "brand new document, seed it".
    const outcome = migrateDocument('not-a-kind' as SchemaDocumentKind, { version: 1 });
    expect(outcome.status).toBe('invalid');
  });
});
