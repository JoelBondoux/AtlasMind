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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.argv[2] ?? process.cwd();
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, text) => writeFileSync(path.join(root, file), text);

const VERSION_FILES = ['package.json', 'package-lock.json'];
const NOTES_FILES = ['CHANGELOG.md', 'wiki/Changelog.md', 'README.md'];
const ALL_FILES = [...VERSION_FILES, ...NOTES_FILES];

/** `<<<<<<< HEAD\n{ours}\n=======\n{theirs}\n>>>>>>> ref\n` */
const CONFLICT = /<<<<<<< HEAD\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> [^\n]*\r?\n/g;
const ANY_MARKER = /^<<<<<<< |^>>>>>>> |^=======$/m;

const fail = message => {
  console.error(`\n${message}`);
  process.exit(1);
};

// ── Guard: only meaningful mid-merge ─────────────────────────────────────────
//
// Run outside a merge this would rewrite version numbers in a clean tree, which
// looks like a release bump nobody asked for.
if (!existsSync(path.join(root, '.git', 'MERGE_HEAD'))
  && !existsSync(path.join(root, '.git', 'rebase-merge'))) {
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

// ── Version files ────────────────────────────────────────────────────────────
for (const file of VERSION_FILES) {
  write(file, resolveEach(read(file), (ours, theirs) => {
    if (!/"version":/.test(theirs)) {
      fail(`Unexpected non-version conflict in ${file}. Resolve this one by hand:\n${theirs}`);
    }
    return `${theirs.replace(/"version": "[^"]+"/, `"version": "${next}"`)}\n`;
  }));
  console.log(`  ${file}  version -> ${next}`);
}

// ── Notes files: keep both sides, ours relabelled and first ──────────────────
for (const [file, ourLabel, render] of [
  ['CHANGELOG.md', /## \[\d+\.\d+\.\d+\] - /, `## [${next}] - `],
  ['wiki/Changelog.md', /## v\d+\.\d+\.\d+ — /, `## v${next} — `],
]) {
  write(file, resolveEach(read(file), (ours, theirs) => `${ours.replace(ourLabel, render)}\n\n${theirs}\n`));
  console.log(`  ${file}  kept both sides, ours relabelled ${next}`);
}

// README carries two version markers and one bullet list; the markers take the
// new version, the list keeps both sides in the same order as the changelogs.
write('README.md', resolveEach(read('README.md'), (ours, theirs) => {
  if (/Current source version/.test(theirs)) {
    return `${theirs.replace(/Current source version: [\d.]+/, `Current source version: ${next}`)}\n`;
  }
  if (/What's new in/.test(theirs)) {
    return `${theirs.replace(/What's new in [\d.]+/, `What's new in ${next}`)}\n`;
  }
  return `${ours}\n\n${theirs}\n`;
}));
console.log('  README.md  markers -> ' + next + ', bullet list kept both sides');

// ── Never report success over a surviving marker ─────────────────────────────
const leftovers = ALL_FILES.filter(file => ANY_MARKER.test(read(file)));
if (leftovers.length > 0) {
  fail(`Markers still present in: ${leftovers.join(', ')}\nResolve these by hand; nothing was committed.`);
}

console.log(`\nAll five release files resolved at ${next}.`);
console.log('Any remaining conflict is a real one. Check with:');
console.log('  git diff --name-only --diff-filter=U');
console.log('  git diff --cached origin/develop --stat');
