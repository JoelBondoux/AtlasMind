/**
 * The version pills in the Project Dashboard header.
 *
 * They used to be two, derived from git alone: a detected production branch,
 * and whatever branch happens to be checked out. That answers "which branch am
 * I on?" — but the question the header is actually asked is *what version is
 * where*, and the project already models that on the Delivery page as an
 * ordered pipeline of stages, each naming the branch whose committed version
 * represents it. The header ignored it, so adding a Staging stage changed
 * nothing in the header and a project with four environments still showed two
 * pills, one of which was a branch name.
 *
 * Deriving the strip from that pipeline means the header and the Delivery page
 * cannot disagree, and a stage added there appears here without a second
 * definition of what a stage is.
 *
 * Four rules, all of them about not claiming to know a version:
 *
 * 1. **A stage whose branch does not exist has no version.** Not `0.0.0`, not
 *    the working copy's — it reports that the branch has not been created. A
 *    plausible version against an environment nobody has deployed to is worse
 *    than a blank.
 * 2. **The working tree is a different claim from a branch.** The local stage
 *    carries no branch by design, and its version comes from `package.json` on
 *    disk — which is the *only* pill that can be ahead of what is committed.
 *    It says `working tree` rather than borrowing a branch name, and carries
 *    whether the tree is dirty, because a clean local pill that merely repeats
 *    the staging version is the one case where it adds nothing.
 * 3. **Ordered by rank, capped, with the remainder stated.** Rank is the
 *    pipeline's own order (local → production); a header that silently dropped
 *    the last stage would read as a project that does not have one.
 * 4. **Never empty.** A project with no pipeline configured falls back to the
 *    original git-derived pair, so the header keeps working before anyone has
 *    opened the Delivery page.
 *
 * Pure and `vscode`-free.
 */

/** One stage of the delivery pipeline, as the dashboard already computes it. */
export interface VersionStripStage {
  id: string;
  name: string;
  rank: number;
  /** Empty when the stage maps to the working tree rather than a branch. */
  branchRef: string;
  /** False when the ref could not be resolved — the branch does not exist yet. */
  branchExists: boolean;
  /** Package version committed on that branch, or `—` when unknown. */
  deployedVersion: string;
  isCurrentBranch: boolean;
  isProtected: boolean;
}

export interface VersionStripInput {
  /** The delivery pipeline. Empty falls back to the git-derived pair. */
  stages?: readonly VersionStripStage[];
  /** The version in `package.json` on disk, right now. */
  workingVersion: string;
  /** True when the working tree has uncommitted changes. */
  workingTreeDirty?: boolean;
  currentBranch: string;
  /** Used only by the fallback, when no pipeline is configured. */
  production?: { branch: string; version: string };
}

export interface VersionStripPill {
  id: string;
  /** The stage's own name, so the header uses the project's vocabulary. */
  label: string;
  /** The branch it reads, or `working tree`. */
  ref: string;
  /** Absent when no version could be read — never substituted. */
  version?: string;
  /** Why there is no version, when there is none. */
  note?: string;
  /** The stage matching the checked-out branch, or the working tree itself. */
  isCurrent: boolean;
  /** Only ever true for the working-tree pill. */
  isWorkingTree: boolean;
  /** Uncommitted changes, so this pill may be ahead of every other. */
  isDirty: boolean;
  isProtected: boolean;
}

/** How many pills fit a header before it stops being a header. */
export const VERSION_STRIP_CAP = 4;

export interface VersionStrip {
  pills: VersionStripPill[];
  /** Stages not shown, so truncation is never silent. */
  droppedByCap: number;
  /**
   * Where the strip came from.
   *
   * `branches` means no delivery pipeline is configured and this is the old
   * git-derived pair — worth distinguishing, because a project that has never
   * opened the Delivery page should be told the pipeline is what fills this in.
   */
  source: 'delivery' | 'branches';
}

/** `deployedVersion` uses this for "not known"; it is not a version. */
const UNKNOWN_VERSION = '—';

function normalizeRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^origin\//, '').trim();
}

export function buildVersionStrip(input: VersionStripInput): VersionStrip {
  const stages = input.stages ?? [];
  if (stages.length === 0) {
    return buildFallbackStrip(input);
  }

  // Rank is the pipeline's declared order. Ties break on name so two stages at
  // the same rank cannot swap places between renders.
  const ordered = [...stages].sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name));
  const all = ordered.map(stage => toPill(stage, input));
  const pills = all.slice(0, VERSION_STRIP_CAP);

  return { pills, droppedByCap: all.length - pills.length, source: 'delivery' };
}

function toPill(stage: VersionStripStage, input: VersionStripInput): VersionStripPill {
  // No branch means the working tree — the one reading that comes from disk
  // rather than from git, and the one that can be ahead of everything else.
  if (!stage.branchRef) {
    return {
      id: stage.id,
      label: stage.name,
      ref: 'working tree',
      version: input.workingVersion,
      isCurrent: true,
      isWorkingTree: true,
      isDirty: input.workingTreeDirty === true,
      isProtected: stage.isProtected,
      ...(input.workingTreeDirty === true
        ? { note: 'Uncommitted changes — this may be ahead of every branch below.' }
        : {}),
    };
  }

  const ref = normalizeRef(stage.branchRef);
  // A branch that does not exist has no version. Substituting the working
  // copy's would claim a deployment nobody has made.
  if (!stage.branchExists) {
    return {
      id: stage.id,
      label: stage.name,
      ref,
      note: `Branch \`${ref}\` does not exist yet.`,
      isCurrent: false,
      isWorkingTree: false,
      isDirty: false,
      isProtected: stage.isProtected,
    };
  }

  const known = stage.deployedVersion && stage.deployedVersion !== UNKNOWN_VERSION;
  return {
    id: stage.id,
    label: stage.name,
    ref,
    ...(known ? { version: stage.deployedVersion } : { note: `No \`package.json\` version on \`${ref}\`.` }),
    isCurrent: stage.isCurrentBranch,
    isWorkingTree: false,
    isDirty: false,
    isProtected: stage.isProtected,
  };
}

/**
 * The original pair, kept for projects with no pipeline configured.
 *
 * Deliberately not merged into the main path: this one is derived from a branch
 * *guess* (`detectProductionBranchRef` walks a candidate list), and a guess
 * should not be presented in the same shape as a stage somebody declared.
 */
function buildFallbackStrip(input: VersionStripInput): VersionStrip {
  const pills: VersionStripPill[] = [];
  const current = normalizeRef(input.currentBranch);

  if (input.production && normalizeRef(input.production.branch) !== current) {
    pills.push({
      id: 'fallback-production',
      label: 'Production',
      ref: normalizeRef(input.production.branch),
      version: input.production.version,
      isCurrent: false,
      isWorkingTree: false,
      isDirty: false,
      isProtected: true,
    });
  }

  pills.push({
    id: 'fallback-current',
    label: 'Working tree',
    ref: current,
    version: input.workingVersion,
    isCurrent: true,
    isWorkingTree: true,
    isDirty: input.workingTreeDirty === true,
    isProtected: false,
    ...(input.workingTreeDirty === true ? { note: 'Uncommitted changes.' } : {}),
  });

  return { pills, droppedByCap: 0, source: 'branches' };
}
