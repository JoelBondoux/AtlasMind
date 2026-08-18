/**
 * Which Node version a generated workflow should pin, derived from the project
 * rather than chosen once and left to rot.
 *
 * Three generators write GitHub Actions YAML into a user's repository — the
 * hosted CI starter, the trusted local-runner workflow and the website CI
 * template — and all three took a `nodeVersion` parameter that **no caller ever
 * passed**. So the `'20'` sitting behind each `??` was not a fallback for when
 * detection failed; it was the only value any of them ever emitted. Every
 * workflow AtlasMind has written into somebody else's repository is pinned to a
 * runtime that reached end of life in April 2026.
 *
 * The fix is not a newer constant. `20` was correct when it was written and
 * became wrong in silence, and `24` would fail in exactly the same way on
 * exactly the same schedule. Four rules instead:
 *
 * **The project's own declaration wins, whatever it says.** If `engines.node`
 * or an `.nvmrc` names a version, that is the answer even when it names
 * something end-of-life — overriding a project's stated support floor because
 * we disapprove of it would put a version in their CI that they never claimed
 * to support, and their CI is the place that would find out.
 *
 * **A range resolves to its lowest declared major.** `engines.node` is a range
 * and a workflow pin is a single version, so something has to choose. The floor
 * is what the project *promised*, and it is the half that breaks: reaching for
 * an API that only exists in the newer major is the ordinary mistake, and only
 * the floor catches it. Testing the ceiling catches deprecation warnings, which
 * is worth less and is what a matrix is for.
 *
 * **The last resort is measured, never declared.** With nothing to read, the
 * answer is the major of the Node actually running this code — which is what
 * the developer builds with, is true by construction, and cannot go stale. A
 * constant here would rebuild the bug this module exists to remove.
 *
 * **Every answer names the rule that produced it**, as the debt register and
 * the attention feed do, so a surprising pin is explainable at the point it is
 * confirmed rather than by reading this file.
 *
 * Pure — every input is passed in, including the runtime version — so the
 * ladder is walkable by a test rather than dependent on the machine running it.
 */

/** Where a resolved version came from. Published beside the answer. */
export type NodeVersionSource =
  /** `engines.node` in the project's own package.json. */
  | 'engines'
  /** An `.nvmrc` file. */
  | 'nvmrc'
  /** A `.node-version` file. */
  | 'node-version-file'
  /** Nothing was declared; the running Node's major was used. */
  | 'runtime';

export interface NodeVersionResolution {
  /** A bare major, ready to render into `node-version:`. */
  version: string;
  source: NodeVersionSource;
  /** The declared rule that produced it, in one sentence. */
  rule: string;
}

/** What the caller managed to read. Every field optional: absent means absent. */
export interface NodeVersionFacts {
  /** The raw `engines.node` value, which is a range and not a version. */
  enginesNode?: string;
  /** Raw `.nvmrc` contents. */
  nvmrc?: string;
  /** Raw `.node-version` contents. */
  nodeVersionFile?: string;
  /** `process.versions.node`, passed in so this module stays pure. */
  runtimeVersion: string;
}

/**
 * A bare major, or nothing.
 *
 * Deliberately strict about what a version *is*: `.nvmrc` files carry
 * `lts/hydrogen` and `lts/*` as often as they carry numbers, and resolving a
 * codename would need a table of releases — a constant that ages, which is the
 * failure this module exists to close. An alias is therefore not read as a
 * version at all, and the ladder moves on to the next rung.
 */
function majorOf(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  // A leading `v` is idiomatic in .nvmrc and meaningless here.
  const match = /^v?(\d{1,3})(?:\.\d{1,3}){0,2}$/.exec(trimmed);
  return match ? match[1] : undefined;
}

/**
 * The lowest major a semver range admits.
 *
 * Not a general range parser, and not trying to be: it reads the *floor* of
 * each `||` alternative and takes the smallest. Upper bounds are skipped
 * explicitly rather than by accident — `>=22 <25` declares support for 22, and
 * counting the `25` would pin CI to a major the project never claimed.
 *
 * An unparseable range yields nothing rather than a guess. A wrong pin here
 * becomes a red CI run in somebody else's repository, so silence is the safe
 * direction.
 */
export function lowestMajorInRange(range: string | undefined): string | undefined {
  const raw = range?.trim();
  if (!raw || raw.length > 200) {
    return undefined;
  }
  // `*` and `x` admit everything, which is not a declaration of anything.
  if (/^[*x]$/i.test(raw)) {
    return undefined;
  }
  let lowest: number | undefined;
  for (const alternative of raw.split('||')) {
    let floor: number | undefined;
    for (const comparator of alternative.trim().split(/\s+/).filter(Boolean)) {
      // An upper bound says what is *not* supported; it names no floor.
      if (comparator.startsWith('<')) {
        continue;
      }
      const match = /^(?:>=|>|\^|~|=)?\s*v?(\d{1,3})\b/.exec(comparator);
      if (!match) {
        continue;
      }
      const major = Number(match[1]);
      if (!Number.isSafeInteger(major)) {
        continue;
      }
      floor = floor === undefined ? major : Math.min(floor, major);
    }
    if (floor === undefined) {
      // One unreadable alternative makes the whole range unreadable: the
      // smallest floor of the parts we happened to understand is not the
      // smallest floor of the range.
      return undefined;
    }
    lowest = lowest === undefined ? floor : Math.min(lowest, floor);
  }
  return lowest === undefined ? undefined : String(lowest);
}

/**
 * The version a generated workflow should pin, and why.
 *
 * Always answers. The runtime rung cannot fail in practice, and an answer is
 * required — a generator that emitted no `node-version` would hand the user a
 * workflow whose Node is whatever the runner image happens to ship, which is
 * the least predictable outcome available.
 */
export function resolveWorkflowNodeVersion(facts: NodeVersionFacts): NodeVersionResolution {
  const fromEngines = lowestMajorInRange(facts.enginesNode);
  if (fromEngines) {
    return {
      version: fromEngines,
      source: 'engines',
      rule: `The project's package.json declares engines.node "${facts.enginesNode?.trim()}"; CI pins the lowest major it supports.`,
    };
  }
  const fromNvmrc = majorOf(facts.nvmrc);
  if (fromNvmrc) {
    return {
      version: fromNvmrc,
      source: 'nvmrc',
      rule: 'The project\'s .nvmrc names this version.',
    };
  }
  const fromFile = majorOf(facts.nodeVersionFile);
  if (fromFile) {
    return {
      version: fromFile,
      source: 'node-version-file',
      rule: 'The project\'s .node-version names this version.',
    };
  }
  // `process.versions.node` is always a plain semver string, so the second
  // branch is a structural guard that keeps the return type total rather than a
  // policy default — which is why it is a loose digit scan of whatever the
  // caller passed and not another hardcoded major.
  const fromRuntime = majorOf(facts.runtimeVersion)
    ?? /(\d{1,3})/.exec(facts.runtimeVersion ?? '')?.[1];
  return {
    version: fromRuntime ?? '',
    source: 'runtime',
    rule: 'The project declares no Node version, so CI pins the major you are developing on.',
  };
}
