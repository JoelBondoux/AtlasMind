#!/usr/bin/env node
/**
 * Resolve the conflicts a long-lived branch collects against a fast-moving
 * integration branch, for the files every AtlasMind release touches.
 *
 * **Why this exists.** Every commit in this repository bumps `package.json` and
 * writes release notes. That is a deliberate rule — the version always names an
 * exact state of the code — but it means two branches doing unrelated work
 * conflict on the same five files *every single time*, with zero semantic
 * overlap between the changes. A branch open while another stream is pushing
 * will re-conflict within hours, repeatedly.
 *
 * Hand-resolving the same five files over and over is not just tedious, it is
 * the specific way a real edit gets dropped: the conflict hunks look identical
 * each time, so attention drifts to the version numbers and a changelog entry
 * quietly loses a paragraph. This encodes the resolution once.
 *
 * **The rules it applies.**
 *   - *Version files* take the integration branch's version, patch-bumped. A
 *     feature branch is a PATCH on top of wherever that branch reached; it is
 *     never a revert of it, which is what taking "ours" would silently do.
 *   - *Notes files* keep BOTH sides, this branch's entry relabelled to the new
 *     version and placed above. Taking either side alone deletes release notes
 *     for work that shipped — the failure this script most exists to prevent.
 *   - It **refuses to report success** while any marker survives, so a partial
 *     resolution cannot be committed on the strength of a green summary line.
 *
 * It resolves nothing else. A conflict in source, tests or docs is a real
 * disagreement about behaviour and wants a human; only the mechanical
 * version-marker collisions are handled here.
 *
 * Usage, mid-merge:
 *   npm run resolve:release-conflicts
 *   git add -A && git commit
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.argv[2] ?? process.cwd();
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, text) => writeFileSync(path.join(root, file), text);

const VERSION_FILES = ['package.json', 'package-lock.json'];
const NOTES_FILES = ['CHANGELOG.md', 'wiki/Changelog.md', 'README.md'];
const ALL_FILES = [...VERSION_FILES, ...NOTES_FILES];

/**
 * `<<<<<<< {label}\n{ours}\n=======\n{theirs}\n>>>>>>> {label}\n`
 *
 * The opening label is matched loosely rather than pinned to `HEAD`: a plain
 * `git merge` writes `HEAD`, but `git checkout --conflict=merge` — the usual way
 * to put the markers back after a botched resolution — writes `ours`. Pinned to
 * `HEAD`, this silently matched nothing on a restored conflict and reported the
 * file as unresolvable.
 */
const CONFLICT = /<<<<<<< [^\n]*\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> [^\n]*\r?\n/g;
const ANY_MARKER = /^<<<<<<< |^>>>>>>> |^=======$/m;

const fail = message => {
  console.error(`\n${message}`);
  process.exit(1);
};

// ── Guard: only meaningful mid-merge ─────────────────────────────────────────
//
// Run outside a merge this would rewrite version numbers in a clean tree, which
// looks like a release bump nobody asked for.
//
// The path comes from `git rev-parse --git-path` rather than being joined onto
// `<root>/.git`, because in a **worktree** `.git` is a file pointing elsewhere
// and the merge state lives under `.git/worktrees/<name>/`. Hardcoding the
// naive path made this refuse to run in exactly the setup it was written for —
// this repository's own branches are worktrees.
const gitPath = name => {
  try {
    const resolved = execFileSync('git', ['rev-parse', '--git-path', name], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.resolve(root, resolved);
  } catch {
    return undefined;   // not a repository, or no git on PATH
  }
};

const mergeHead = gitPath('MERGE_HEAD');
const rebaseMerge = gitPath('rebase-merge');
if (!mergeHead) {
  fail('Not a git repository (or git is not on PATH).');
}
if (!existsSync(mergeHead) && !(rebaseMerge && existsSync(rebaseMerge))) {
  fail('Not in a merge or rebase — nothing to resolve. Run "git merge origin/develop" first.');
}

for (const file of ALL_FILES) {
  if (!existsSync(path.join(root, file))) {
    fail(`Expected release file is missing: ${file}`);
  }
}

// ── The new version: theirs, patch-bumped ────────────────────────────────────
const theirVersion = /=======\r?\n\s*"version": "([^"]+)"/.exec(read('package.json'))?.[1];
if (!theirVersion) {
  fail(
    'No version conflict in package.json.\n'
    + 'This script derives the new version from that conflict, so there is nothing for it to do.\n'
    + 'Resolve the remaining files by hand.',
  );
}
const parts = theirVersion.split('.').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  fail(`Could not parse the incoming version as SemVer: "${theirVersion}"`);
}
const next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
console.log(`incoming ${theirVersion} -> this branch ${next}\n`);

const resolveEach = (text, resolve) => text.replace(CONFLICT, (_m, ours, theirs) => resolve(ours, theirs));

/**
 * Every resolution is computed before any of it is written.
 *
 * A refusal part-way through would otherwise leave the version files rewritten
 * and the notes files still conflicted — a half-resolved tree, reported as a
 * failure, which is a worse state to hand back than the conflict was.
 */
const pending = new Map();
const plan = (file, text, note) => {
  pending.set(file, text);
  console.log(`  ${file}  ${note}`);
};

// ── Version files ────────────────────────────────────────────────────────────
for (const file of VERSION_FILES) {
  plan(file, resolveEach(read(file), (ours, theirs) => {
    if (!/"version":/.test(theirs)) {
      fail(`Unexpected non-version conflict in ${file}. Resolve this one by hand:\n${theirs}\n\nNothing was written.`);
    }
    return `${theirs.replace(/"version": "[^"]+"/, `"version": "${next}"`)}\n`;
  }), `version -> ${next}`);
}

// ── Notes files: keep both sides, ours relabelled and first ──────────────────
//
// Safe only while both sides are *whole* entries. Git does not guarantee that:
// when this branch's body has already reached the integration branch (its PR
// merged, then more landed on top), the bodies become common context and git
// splits the conflict at the heading alone. `ours` is then a bare heading, and
// concatenating yields an empty section for this branch while the shared body
// silently reattributes to the other side's version number.
//
// That is this script's own stated failure — a changelog entry losing its
// paragraph — so it refuses the shape rather than guessing. Sorting it out
// needs a judgement the script does not have: whether the shared body belongs
// to the version already released or to the one being prepared.
// No `\b` after the version: it would sit between `]` and a space, both
// non-word characters, so the boundary never matches and the guard never fires.
const bodylessHeading = /^\s*##\s+(?:\[\d+\.\d+\.\d+\]|v\d+\.\d+\.\d+)[^\n]*\s*$/;

for (const [file, ourLabel, render] of [
  ['CHANGELOG.md', /## \[\d+\.\d+\.\d+\] - /, `## [${next}] - `],
  ['wiki/Changelog.md', /## v\d+\.\d+\.\d+ — /, `## v${next} — `],
]) {
  plan(file, resolveEach(read(file), (ours, theirs) => {
    if (bodylessHeading.test(ours)) {
      fail(
        `${file}: this side of the conflict is a version heading with no body.\n\n`
        + 'That means the entry itself merged as common context — normally because this\n'
        + "branch's work already reached the integration branch and more landed on top.\n"
        + 'Concatenating here would leave an empty section and reattribute the shared body\n'
        + "to the other side's version.\n\n"
        + 'Resolve this file by hand: decide whether the shared body belongs to the version\n'
        + 'already released or to the one being prepared, then give any genuinely new entry\n'
        + `its own ## ${next} section.\n\nNothing was written.`,
      );
    }
    return `${ours.replace(ourLabel, render)}\n\n${theirs}\n`;
  }), `kept both sides, ours relabelled ${next}`);
}

// README carries two version markers and one bullet list; the markers take the
// new version, the list keeps both sides in the same order as the changelogs.
plan('README.md', resolveEach(read('README.md'), (ours, theirs) => {
  if (/Current source version/.test(theirs)) {
    return `${theirs.replace(/Current source version: [\d.]+/, `Current source version: ${next}`)}\n`;
  }
  if (/What's new in/.test(theirs)) {
    return `${theirs.replace(/What's new in [\d.]+/, `What's new in ${next}`)}\n`;
  }
  return `${ours}\n\n${theirs}\n`;
}), `markers -> ${next}, bullet list kept both sides`);

// ── Check the whole plan before any of it lands ──────────────────────────────
const unresolved = [...pending].filter(([, text]) => ANY_MARKER.test(text)).map(([file]) => file);
if (unresolved.length > 0) {
  fail(`Markers would survive in: ${unresolved.join(', ')}\nResolve these by hand.\n\nNothing was written.`);
}

for (const [file, text] of pending) {
  write(file, text);
}

console.log(`\nAll five release files resolved at ${next}.`);
console.log('Any remaining conflict is a real one. Check with:');
console.log('  git diff --name-only --diff-filter=U');
console.log('  git diff --cached origin/develop --stat');
