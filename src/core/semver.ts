/**
 * The semver primitives, extracted so a pure module can use them.
 *
 * These three functions lived in `promotionRunner`, which imports
 * `child_process`, `fs` and `https` because it *runs* promotions. That was
 * harmless while the only other caller was `releasePreparation`, and stopped
 * being harmless the moment `versioningPolicy` — documented as pure — imported
 * `compareSemver` and dragged a process spawner in behind it. The symptom was
 * a test elsewhere that partially mocks `node:child_process` failing on a
 * missing `exec` export, from a file that has nothing to do with either.
 *
 * Nothing here reads a clock, a file or an environment. `promotionRunner`
 * re-exports all three, so every existing import keeps working and there is
 * still exactly one implementation of what a version means — which is the
 * point: two copies of `compareSemver` would eventually disagree about
 * whether a release candidate had already shipped.
 */

/** How far a change moves the version, by the conventional-commits reading. */
export type BumpLevel = 'patch' | 'minor' | 'major';

/**
 * Compare two versions by SemVer §11 precedence.
 *
 * Returns >0 when `a` is newer than `b`, <0 when older, and 0 when the two have
 * equal precedence. Build metadata (`+…`) is discarded before anything else,
 * because the spec gives it no precedence at all.
 *
 * This used to read `value.split('-')[0]` and ignore the pre-release suffix
 * entirely, which made `1.5.0-rc.1` and `1.5.0` compare **equal**. That is not
 * a rounding error on a field nobody uses: `releasePreparation`'s `version-ahead`
 * gate asks exactly this question of exactly these values, so a release
 * candidate read as *already published*, and the finished release that followed
 * it read as *not ahead of* the candidate. Both are the same failure — a gate
 * that exists to stop a double publish, refusing the one release that was
 * never published. Any branch-to-channel scheme is unimplementable on top of it,
 * which is why this correction comes before `versioningPolicy` rather than with it.
 *
 * The rules, in the spec's own order:
 *
 *  - major, minor and patch compare numerically;
 *  - a version *carrying* a pre-release has lower precedence than the same core
 *    version without one — `1.0.0-alpha` < `1.0.0`, which is the whole point;
 *  - pre-release identifiers compare field by field: numeric fields
 *    numerically, everything else in ASCII order, a numeric field always lower
 *    than an alphanumeric one, and a larger set of fields winning when every
 *    field before it is equal.
 */
export function compareSemver(a: string, b: string): number {
  const split = (value: string): { core: number[]; pre: string[] } => {
    const bare = (value ?? '').trim().replace(/^v/i, '').split('+', 1)[0];
    // Only the *first* dash opens the pre-release: `1.0.0-rc-2` has one
    // identifier, `rc-2`, not two.
    const dash = bare.indexOf('-');
    const coreText = dash === -1 ? bare : bare.slice(0, dash);
    const preText = dash === -1 ? '' : bare.slice(dash + 1);
    return {
      core: coreText.split('.').map(part => Number.parseInt(part, 10) || 0),
      pre: preText ? preText.split('.') : [],
    };
  };

  const pa = split(a);
  const pb = split(b);

  for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  // A pre-release always precedes the release it leads to.
  if (pa.pre.length === 0 && pb.pre.length === 0) {
    return 0;
  }
  if (pa.pre.length === 0) {
    return 1;
  }
  if (pb.pre.length === 0) {
    return -1;
  }

  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const ia = pa.pre[i];
    const ib = pb.pre[i];
    // Every field so far is equal, so the version with more of them wins.
    if (ia === undefined) {
      return -1;
    }
    if (ib === undefined) {
      return 1;
    }
    if (ia === ib) {
      continue;
    }
    const numericA = /^\d+$/.test(ia);
    const numericB = /^\d+$/.test(ib);
    if (numericA && numericB) {
      const diff = Number.parseInt(ia, 10) - Number.parseInt(ib, 10);
      if (diff !== 0) {
        return diff > 0 ? 1 : -1;
      }
      continue;
    }
    // Numeric identifiers always rank below alphanumeric ones, so `1.0.0-1`
    // precedes `1.0.0-alpha` rather than following it.
    if (numericA !== numericB) {
      return numericA ? -1 : 1;
    }
    return ia < ib ? -1 : 1;
  }
  return 0;
}

/**
 * Assess the SemVer bump level warranted by a set of commit messages, using the
 * conventional-commits convention: a breaking change (`type!:` subject or a
 * `BREAKING CHANGE` footer) ⇒ major; any `feat:` ⇒ minor; otherwise patch. This
 * matches both general SemVer practice and repos whose stated rules follow it.
 */
export function classifyBumpLevel(commitMessages: readonly string[]): BumpLevel {
  let level: BumpLevel = 'patch';
  for (const raw of commitMessages) {
    const message = (raw ?? '').trim();
    if (!message) {
      continue;
    }
    const subject = message.split('\n', 1)[0];
    if (/^[a-z]+(\([^)]*\))?!:/i.test(subject) || /breaking[ -]change/i.test(message)) {
      return 'major';
    }
    if (/^feat(\([^)]*\))?:/i.test(subject)) {
      level = 'minor';
    }
  }
  return level;
}

/** Increment a semver-ish version by the given level (pre-release suffixes dropped). */
export function bumpVersion(base: string, level: BumpLevel): string {
  const parts = (base ?? '').replace(/^v/, '').split('-')[0].split('.');
  let major = Number.parseInt(parts[0], 10) || 0;
  let minor = Number.parseInt(parts[1], 10) || 0;
  let patch = Number.parseInt(parts[2], 10) || 0;
  if (level === 'major') {
    major += 1; minor = 0; patch = 0;
  } else if (level === 'minor') {
    minor += 1; patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}
