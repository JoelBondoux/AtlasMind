/**
 * SchemaMigration — how a persisted AtlasMind document changes shape over time.
 *
 * Every document AtlasMind writes into `project_memory/` carries a `version`.
 * Until now that field was only ever used as a **validity test** —
 * `version === 1` or the document was treated as unreadable — which has two
 * consequences that only bite later:
 *
 * 1. **There is no way to change a format.** A v2 shape would be rejected by
 *    every v1 reader, so the change could only ship as a break.
 * 2. **A document from the future is destroyed, silently.** An unreadable file
 *    makes the manager seed a default *and write it back* (see
 *    `DocumentsManager.ensureSeeded`). Open a project in an older AtlasMind
 *    than the one that wrote it and your documents registry, delivery pipeline,
 *    or people roster is replaced with an empty one. Nothing warns, because
 *    from the reader's point of view there was simply no valid file.
 *
 * This module makes the version field mean something. The load-bearing
 * distinction is between a document that is **invalid** (corrupt, truncated,
 * not ours — safe to replace) and one that is **refused** (structurally fine,
 * but written by a newer AtlasMind than this one understands — *never* safe to
 * replace). Callers must not seed over a refusal; `shouldPreserveExisting`
 * exists so that rule is expressed in one place rather than remembered in nine.
 *
 * Migrations themselves are pure `(document) => document` steps registered per
 * kind and chained from the version found to the version wanted, so a v1 file
 * opened by a v3 AtlasMind runs 1→2 then 2→3. The registry is deliberately
 * empty today — every document is still at v1 — but the mechanism, its
 * invariants, and its tests ship *before* 1.0, because 1.0 is the promise that
 * these formats stay readable and that promise needs a way to be kept.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

/** A persisted document kind, keyed by the file it lives in. */
export type SchemaDocumentKind =
  | 'documents'
  | 'delivery'
  | 'project-director'
  | 'risk-oversight'
  | 'security-review'
  | 'data-privacy'
  | 'testing-config'
  | 'missions'
  | 'personality-profile'
  | 'mcp-environment'
  | 'workflow'
  | 'research';

/**
 * The version each kind is written at today.
 *
 * Bumping one of these is the deliberate act of changing a format: it must be
 * accompanied by a migration step from the previous version, and the test that
 * asserts every version is reachable from 1 will fail until it is.
 */
export const CURRENT_SCHEMA_VERSIONS: Readonly<Record<SchemaDocumentKind, number>> = {
  documents: 1,
  delivery: 1,
  'project-director': 1,
  'risk-oversight': 1,
  'security-review': 1,
  'data-privacy': 1,
  'testing-config': 2,
  missions: 1,
  'personality-profile': 1,
  'mcp-environment': 1,
  workflow: 1,
  research: 1,
};

/** One step up the version ladder for one kind. Pure by contract. */
export interface SchemaMigrationStep {
  kind: SchemaDocumentKind;
  /** The version this step reads. */
  from: number;
  /** The version this step produces. Always `from + 1`. */
  to: number;
  /** Why the shape changed — surfaced when a migration runs. */
  summary: string;
  /**
   * Transform the document. Must not throw; a step that cannot convert a
   * particular document should return it unchanged rather than lose data, and
   * let the shape validator downstream reject it.
   */
  migrate: (document: Record<string, unknown>) => Record<string, unknown>;
}

/** Every registered migration. */
export const SCHEMA_MIGRATIONS: readonly SchemaMigrationStep[] = [
  {
    kind: 'testing-config',
    from: 1,
    to: 2,
    summary: 'A testing methodology can now hold back non-test writes until its evidence has been seen.',
    // `blocking` is left absent rather than written as `false`. Both read the
    // same way, and an absent field says "this project never considered the
    // question", where an explicit `false` would say "this project decided
    // against it" — a distinction the Testing page can show and a migration has
    // no standing to invent on the user's behalf.
    migrate: document => ({ ...document, version: 2 }),
  },
];

export type SchemaMigrationOutcome<T> =
  /** Already at the current version. */
  | { status: 'current'; value: T }
  /** Read at an older version and brought forward. */
  | { status: 'migrated'; value: T; from: number; to: number; applied: string[] }
  /**
   * Written by a newer AtlasMind. The document is intact and **must be left
   * alone** — see {@link shouldPreserveExisting}.
   */
  | { status: 'refused'; foundVersion: number; expectedVersion: number; reason: string }
  /** Not a document this kind can read at all. Safe to replace. */
  | { status: 'invalid'; reason: string };

/**
 * Bring a parsed document up to the current version for its kind.
 *
 * Never throws: a migration step that fails is reported as `invalid` with the
 * failure, because a half-applied migration is worse than a refused one.
 */
export function migrateDocument<T extends Record<string, unknown>>(
  kind: SchemaDocumentKind,
  raw: unknown,
  migrations: readonly SchemaMigrationStep[] = SCHEMA_MIGRATIONS,
): SchemaMigrationOutcome<T> {
  const expectedVersion = CURRENT_SCHEMA_VERSIONS[kind];
  if (typeof expectedVersion !== 'number') {
    return { status: 'invalid', reason: `unknown document kind "${String(kind)}"` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { status: 'invalid', reason: 'not a JSON object' };
  }

  const document = { ...(raw as Record<string, unknown>) };
  const found = document['version'];
  if (typeof found !== 'number' || !Number.isInteger(found) || found < 1) {
    return { status: 'invalid', reason: 'no usable version field' };
  }

  if (found === expectedVersion) {
    return { status: 'current', value: document as T };
  }

  if (found > expectedVersion) {
    // The one case that must never be treated as "replace me". A document from
    // a newer AtlasMind is not corrupt — this build simply cannot read it.
    return {
      status: 'refused',
      foundVersion: found,
      expectedVersion,
      reason: `written by a newer version of AtlasMind (format v${found}; this build reads v${expectedVersion})`,
    };
  }

  const climbed = applyMigrationLadder(kind, document, found, expectedVersion, migrations);
  if (!climbed.ok) {
    return { status: 'invalid', reason: climbed.reason };
  }
  return { status: 'migrated', value: climbed.document as T, from: found, to: expectedVersion, applied: climbed.applied };
}

/**
 * Walk a document up one version at a time.
 *
 * Exported and taking its bounds as arguments so the chaining, the
 * missing-step guard, and the throwing-step guard can be tested directly —
 * this is the code that runs the first time a format actually changes, and it
 * would otherwise be unreachable by a test while every kind sits at v1.
 */
export function applyMigrationLadder(
  kind: SchemaDocumentKind,
  document: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
  migrations: readonly SchemaMigrationStep[] = SCHEMA_MIGRATIONS,
): { ok: true; document: Record<string, unknown>; applied: string[] } | { ok: false; reason: string } {
  const ladder = migrations
    .filter(step => step.kind === kind && step.from >= fromVersion && step.to <= toVersion)
    .sort((left, right) => left.from - right.from);

  let current = document;
  const applied: string[] = [];
  for (let version = fromVersion; version < toVersion; version += 1) {
    const step = ladder.find(entry => entry.from === version);
    if (!step) {
      return { ok: false, reason: `no migration from v${version} to v${version + 1} for "${kind}"` };
    }
    try {
      // The step's own `to` wins over whatever it returned, so a step that
      // forgets to stamp the version cannot leave the document mislabelled.
      current = { ...step.migrate(current), version: step.to };
    } catch (error) {
      // A half-applied migration is worse than a refused one.
      return {
        ok: false,
        reason: `migration v${step.from}→v${step.to} for "${kind}" failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    applied.push(step.summary);
  }

  return { ok: true, document: current, applied };
}

/**
 * Whether the caller must leave the existing file alone.
 *
 * True only for `refused`. An `invalid` document is corrupt or foreign and may
 * be replaced; a refused one is somebody's real data written by a build newer
 * than this one, and seeding over it is the data-loss bug this module exists to
 * close.
 */
export function shouldPreserveExisting(outcome: SchemaMigrationOutcome<never> | { status: string }): boolean {
  return outcome.status === 'refused';
}

/** What a manager needs to know after reading its file. */
export interface VersionedDocumentRead<T> {
  /** The document, when this build can use it. */
  config?: T;
  /**
   * True when a file exists that this build must **not** write over. Callers
   * must skip their seed-and-persist path when this is set.
   */
  preserveExisting: boolean;
  /** Something worth telling the user about the file itself. */
  notice?: string;
}

/**
 * Interpret an already-parsed document: migrate it, refuse it, or reject it.
 *
 * Deliberately IO-free — each manager still does its own read, because they
 * differ in path and error handling — but the *decision* lives here so nine
 * managers cannot drift into nine slightly different answers to "is this file
 * safe to replace?". Getting that answer wrong silently destroys user data,
 * which is not a thing to re-implement per file.
 */
export function interpretVersionedDocument<T>(
  kind: SchemaDocumentKind,
  parsed: unknown,
  isValid: (value: unknown) => value is T,
  migrations: readonly SchemaMigrationStep[] = SCHEMA_MIGRATIONS,
): VersionedDocumentRead<T> {
  const outcome = migrateDocument<Record<string, unknown>>(kind, parsed, migrations);
  if (outcome.status === 'refused') {
    return {
      preserveExisting: true,
      notice: describeMigrationOutcome(kind, outcome) ?? 'This file was written by a newer AtlasMind.',
    };
  }
  if (outcome.status === 'invalid') {
    return { preserveExisting: false };
  }
  const candidate = outcome.value as unknown;
  if (!isValid(candidate)) {
    // Right version, wrong shape: corrupt rather than futuristic, so replacing
    // it is allowed.
    return { preserveExisting: false };
  }
  return {
    config: candidate,
    preserveExisting: false,
    ...(outcome.status === 'migrated' ? { notice: describeMigrationOutcome(kind, outcome) } : {}),
  };
}

/** A sentence for the user explaining what happened to their file. */
export function describeMigrationOutcome(kind: SchemaDocumentKind, outcome: SchemaMigrationOutcome<never> | SchemaMigrationOutcome<Record<string, unknown>>): string | undefined {
  switch (outcome.status) {
    case 'migrated':
      return `Updated your ${kind} file from format v${outcome.from} to v${outcome.to}.${outcome.applied.length > 0 ? ` ${outcome.applied.join(' ')}` : ''}`;
    case 'refused':
      return `Your ${kind} file was ${outcome.reason}. AtlasMind has left it untouched rather than replacing it — update AtlasMind to read it.`;
    case 'invalid':
      return `Your ${kind} file could not be read (${outcome.reason}).`;
    default:
      return undefined;
  }
}
