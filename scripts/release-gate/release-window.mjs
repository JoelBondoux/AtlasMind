#!/usr/bin/env node
/**
 * One scheduled publish window (10:30 and 22:00 UK; see register-publish-windows.ps1).
 *
 *   node scripts/release-gate/release-window.mjs              # publish if one is needed and passes
 *   node scripts/release-gate/release-window.mjs --check-only # run the gate, publish nothing
 *
 * Run from a dedicated clone of AtlasMind (never a working checkout: it moves
 * HEAD to origin/main). It:
 *
 *   1. fetches origin and moves this clone to origin/main, so the gate rules
 *      are always the newest ones;
 *   2. reads the Marketplace's latest version;
 *   3. lists release tags newer than that, newest first. None: logs "no publish
 *      needed" and exits 0 without running anything;
 *   4. gates each candidate in turn, in a detached worktree of its tag, with
 *      this clone's copy of release-gate.mjs, and publishes the first that
 *      passes, so the latest release that passes is the one shipped and older
 *      ones are never published one by one. A daily-limit refusal stops the window.
 *
 * Every run appends to %LOCALAPPDATA%\AtlasMind\release-gate\window.log (or
 * ~/.atlasmind/release-gate on other systems) and writes a JSON report per
 * candidate beside it. Exit 0: published, or nothing needed; 1: candidates
 * existed and none passed; 2: refused (daily limit, setup error).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMarketplaceVersions, latestPublished, windowCandidates } from './gate-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const IS_WINDOWS = process.platform === 'win32';
const unknown = process.argv.slice(2).filter((a) => a !== '--check-only');
if (unknown.length) { console.error(`[window] unknown argument(s): ${unknown.join(' ')}`); process.exit(2); }
const checkOnly = process.argv.includes('--check-only');

const STATE = IS_WINDOWS && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'AtlasMind', 'release-gate')
  : path.join(homedir(), '.atlasmind', 'release-gate');
mkdirSync(STATE, { recursive: true });
const LOG = path.join(STATE, 'window.log');

function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(LOG, `${text}\n`);
}

function sh(command, args, { cwd = REPO, capture = true, timeoutMinutes = 10 } = {}) {
  const shell = IS_WINDOWS && command.endsWith('.cmd');
  const res = spawnSync(shell && /\s/.test(command) ? `"${command}"` : command, args, {
    cwd, shell, windowsHide: true, timeout: timeoutMinutes * 60_000,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${res.error?.message ?? `exit ${res.status}`}${capture ? ` ${res.stderr}` : ''}`);
  }
  return capture ? res.stdout.toString() : '';
}

function fail(code, message) { log(`[window] ${message}`); process.exit(code); }

let candidates;
try {
  log(`[window] ${checkOnly ? 'check-only ' : ''}publish window opened in ${REPO}`);
  sh('git', ['fetch', '--tags', '--prune', '--force', 'origin']);
  if (sh('git', ['status', '--porcelain']).trim()) fail(2, 'the release clone has local changes; refusing to move it');
  sh('git', ['checkout', '--detach', 'origin/main']);
  sh(IS_WINDOWS ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { capture: false, timeoutMinutes: 20 });

  const require = createRequire(import.meta.url);
  const shown = sh(process.execPath, [require.resolve('@vscode/vsce/vsce'), 'show', 'JoelBondoux.atlasmind', '--json'], { timeoutMinutes: 2 });
  const marketplaceLatest = latestPublished(readMarketplaceVersions(JSON.parse(shown)));
  const tags = sh('git', ['tag', '--list', 'v*']).split(/\r?\n/).filter(Boolean);
  candidates = windowCandidates(tags, marketplaceLatest);
  if (!candidates.length) fail(0, `no publish needed: the Marketplace has v${marketplaceLatest}, the newest release`);
  log(`[window] Marketplace has v${marketplaceLatest}; candidates newest first: ${candidates.map((v) => `v${v}`).join(', ')}`);
} catch (err) {
  fail(2, `setup failed, nothing published: ${err.message}`);
}

const worktrees = path.join(STATE, 'worktrees');
for (const version of candidates) {
  const tree = path.join(worktrees, `v${version}`);
  try {
    if (existsSync(tree)) { sh('git', ['worktree', 'remove', '--force', tree]); }
    sh('git', ['worktree', 'prune']);
    sh('git', ['worktree', 'add', '--detach', tree, `v${version}`]);
  } catch (err) {
    log(`[window] v${version}: could not prepare a checkout (${err.message}); trying the next`);
    continue;
  }
  const report = path.join(STATE, 'reports', `v${version}-${Date.now()}.json`);
  log(`[window] v${version}: running the gate${checkOnly ? ' (check only)' : ''}; report ${report}`);
  const res = spawnSync(process.execPath, [path.join(HERE, 'release-gate.mjs'), ...(checkOnly ? [] : ['--publish']), '--report', report], {
    cwd: tree, stdio: 'inherit', windowsHide: true, timeout: 120 * 60_000,
  });
  try { sh('git', ['worktree', 'remove', '--force', tree]); } catch { rmSync(tree, { recursive: true, force: true }); }

  if (res.status === 0) fail(0, `v${version}: gate passed${checkOnly ? ' (check only; nothing published)' : '; published'}`);
  if (res.status === 2) fail(2, `v${version}: the gate refused before checking (daily limit, Marketplace unreadable or bad checkout); stopping this window. See ${report}`);
  log(`[window] v${version}: gate FAILED (exit ${res.status ?? res.signal}); see ${report}. Trying the next older candidate.`);
}
fail(1, `no candidate passed the gate; nothing published (${candidates.map((v) => `v${v}`).join(', ')})`);
