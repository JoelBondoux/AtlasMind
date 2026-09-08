/**
 * Where a project's cost history lives, and what moving it costs.
 *
 * Until this existed, spend went to VS Code `globalState`: machine-wide, capped
 * at 500 records, invisible to anyone else and impossible to diff. That is fine
 * for a status bar and useless for the two things the roadmap needs it for —
 * saying what a project cost, and putting that figure in a document somebody
 * else can read.
 *
 * The choice is genuinely two-sided, which is why it is a setting rather than a
 * decision taken here:
 *
 * - **`machine-private`** keeps spend off the repository. Nothing is committed,
 *   nothing is shared, and the producer report's cost section is local-only.
 * - **`repository`** makes it diffable, survives a clone, and lets the report
 *   carry cost for somebody who never opens VS Code — at the price of committing
 *   a record of your API spend to a repository you may later make public.
 *
 * **The default is `machine-private`, deliberately the less useful one.** It is
 * the first thing AtlasMind would write into `project_memory/` that is about
 * *you* rather than about the project, and deny-by-default is the house rule for
 * that shape of choice. The useful option is one setting away, not the starting
 * position.
 *
 * Three further rules.
 *
 * **Switching moves the history rather than starting a new one.** Losing months
 * of spend because somebody changed a setting would make the setting frightening,
 * and a frightening setting is one nobody uses.
 *
 * **The count moved is reported.** "Moved" with no number is indistinguishable
 * from "moved nothing", and this is the one moment a user can still notice that
 * the wrong store was read.
 *
 * **Retention is bounded and the bound is stated.** An unbounded file in a
 * git-tracked folder grows forever and somebody eventually finds it in a diff.
 *
 * Pure: no `vscode`, no `fs`. Paths are computed, never touched.
 */

import type { CostRecord } from '../types.js';

export type CostHistoryLocation = 'machine-private' | 'repository';

export const DEFAULT_COST_HISTORY_LOCATION: CostHistoryLocation = 'machine-private';

/**
 * How many records a history keeps.
 *
 * Higher than the 500 `globalState` held, because the point of a file is that it
 * can hold a project's history rather than a session's — but bounded, since this
 * can be a committed file and an unbounded one grows until somebody finds it in
 * a diff. Stated wherever the history is described.
 */
export const COST_HISTORY_MAX_RECORDS = 5000;

/** The file name, identical in both locations so a moved file is recognisable. */
export const COST_HISTORY_FILE_NAME = 'cost-history.json';

/**
 * Read the setting, refusing anything that is not one of the two options.
 *
 * An unrecognised value resolves to the private default rather than throwing or
 * guessing: a typo in settings must not be the reason spend starts being
 * committed.
 */
export function resolveCostHistoryLocation(value: unknown): CostHistoryLocation {
  return value === 'repository' ? 'repository' : DEFAULT_COST_HISTORY_LOCATION;
}

export interface CostHistoryPaths {
  location: CostHistoryLocation;
  /**
   * Path segments below the relevant root, never an absolute path.
   *
   * Returned as segments so the caller joins them against a root it controls —
   * a string with a `..` in it could not be built from these, and the caller is
   * the only thing that knows the real root.
   */
  segments: readonly string[];
  /** What to call this location when telling somebody where their data is. */
  label: string;
  /** True when writing here puts spend under version control. */
  committed: boolean;
}

/**
 * Where the history file sits for a location.
 *
 * `repository` goes under the SSOT `operations/` folder — a declared
 * `SSOT_FOLDERS` entry that the memory manager already knows about — rather than
 * a new folder outside the set.
 */
export function costHistoryPaths(location: CostHistoryLocation): CostHistoryPaths {
  if (location === 'repository') {
    return {
      location,
      segments: ['operations', COST_HISTORY_FILE_NAME],
      label: 'the repository, under project memory',
      committed: true,
    };
  }
  return {
    location,
    segments: [COST_HISTORY_FILE_NAME],
    label: 'this machine only',
    committed: false,
  };
}

/**
 * The warning shown before spend starts being committed.
 *
 * Names the file, because "your spend will be committed" is abstract and
 * `project_memory/operations/cost-history.json` is something a person can go and
 * look at, or add to `.gitignore`.
 */
export function costHistoryCommitWarning(relativePath: string): string {
  return [
    `Cost history will be written to ${relativePath} and committed with your project.`,
    '',
    'That makes it diffable, shareable, and readable by the producer report — and it means a record of '
    + 'what you spent goes into a repository you may later make public. It is the first thing AtlasMind '
    + 'writes into project memory that is about you rather than about the project.',
  ].join('\n');
}

export interface CostHistoryMigration {
  from: CostHistoryLocation;
  to: CostHistoryLocation;
  /** Records that will be carried across. */
  movedCount: number;
  /** Records dropped because the destination's retention bound is lower than the source count. */
  droppedCount: number;
  records: readonly CostRecord[];
}

/**
 * What a change of location would move.
 *
 * Newest records are kept when the bound bites, because a truncated history is
 * more useful from the recent end — and dropping is reported rather than done
 * quietly, since spend disappearing without a number is indistinguishable from
 * spend that was never there.
 */
export function planCostHistoryMigration(
  from: CostHistoryLocation,
  to: CostHistoryLocation,
  records: readonly CostRecord[],
): CostHistoryMigration {
  const kept = records.length > COST_HISTORY_MAX_RECORDS
    ? records.slice(records.length - COST_HISTORY_MAX_RECORDS)
    : records;
  return {
    from,
    to,
    movedCount: kept.length,
    droppedCount: records.length - kept.length,
    records: kept,
  };
}

/** The sentence shown after a move, always carrying the count. */
export function describeCostHistoryMigration(migration: CostHistoryMigration): string {
  const where = costHistoryPaths(migration.to).label;
  const moved = `Moved ${migration.movedCount} cost record${migration.movedCount === 1 ? '' : 's'} to ${where}.`;
  return migration.droppedCount > 0
    ? `${moved} ${migration.droppedCount} older record${migration.droppedCount === 1 ? '' : 's'} `
      + `exceeded the ${COST_HISTORY_MAX_RECORDS}-record limit and were not carried across.`
    : moved;
}
