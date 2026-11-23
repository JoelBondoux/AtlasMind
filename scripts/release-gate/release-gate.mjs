#!/usr/bin/env node
/**
 * The Marketplace release gate. The only route by which a release is published.
 *
 *   node scripts/release-gate/release-gate.mjs             # run the gate, publish nothing
 *   node scripts/release-gate/release-gate.mjs --publish   # run it; publish only if it passes
 *
 * Runs against the current directory, which must be a clean checkout of the
 * release tag `v<package.json version>`. In order, stopping at the first failure:
 *
 *   1. preconditions   clean tree, HEAD is the release tag
 *   2. marketplace     the version is newer than the Marketplace's, and fewer than
 *                      two versions have been published today (UK); unreadable
 *                      Marketplace data fails the gate
 *   3. publish rights  (with --publish) `vsce verify-pat`, before any work
 *   4. npm ci
 *   5. local CI        `npm run ci:local`: compile, lint, integration audit, the
 *                      extension's full test suite, coverage, package
 *   6. security tests  the repository's own security suite (tests/security)
 *   7. npm audit       production dependencies (what the VSIX ships), high or above
 *   8. package         a VSIX built once, the exact file that is smoke-tested,
 *                      scanned and published
 *   9. secret scan     every file inside that VSIX
 *  10. install         `code --install-extension` into a throwaway profile
 *  11. smoke           the packaged extension activates, every contributed command
 *                      is registered, and the core commands run (vsix-smoke.cjs)
 *  12. publish         (with --publish) `vsce publish --packagePath <that VSIX>`
 *
 * Fail closed: a step that errors, times out or cannot run fails the gate. There
 * is no skip, force or bypass option; unknown arguments are refused.
 *
 * Exit codes: 0 passed (and published, with --publish); 1 a check failed;
 * 2 refused before checking (not needed, daily limit, preconditions).
 *
 * The Marketplace credential is never read, printed or passed here. Locally
 * `vsce` uses the one `vsce login` stored in the OS keychain; in CI,
 * `--azure-credential` uses the workflow's Entra identity.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseGateArgs, publishDecision, readMarketplaceVersions, scanFile,
} from './gate-core.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VSCE = require.resolve('@vscode/vsce/vsce');
const EXTENSION_ID = 'JoelBondoux.atlasmind';
const PUBLISHER = 'JoelBondoux';
const IS_WINDOWS = process.platform === 'win32';

const args = (() => {
  try { return parseGateArgs(process.argv.slice(2)); } catch (err) { console.error(`[gate] ${err.message}`); process.exit(2); }
})();

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
const version = pkg.version;
const results = [];
const work = mkdtempSync(path.join(tmpdir(), `atlasmind-gate-${version}-`));

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[gate] ${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`);
}

function finish(code, summary) {
  const report = {
    version, at: new Date().toISOString(), publish: args.publish, outcome: summary, exitCode: code, steps: results,
  };
  if (args.report) {
    mkdirSync(path.dirname(args.report), { recursive: true });
    writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`[gate] ${summary}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

/** Run a command hidden (no console window), output inherited. */
function run(step, command, commandArgs, { timeoutMinutes = 45, capture = false, env } = {}) {
  console.log(`[gate] ▶ ${step}: ${command} ${commandArgs.join(' ')}`);
  // A Windows .cmd shim (npm, code) can only be started through the shell.
  const shell = IS_WINDOWS && (command.endsWith('.cmd') || command === 'code');
  const res = spawnSync(shell && /\s/.test(command) ? `"${command}"` : command, shell ? commandArgs.map((a) => (/[\s&|<>^]/.test(a) ? `"${a}"` : a)) : commandArgs, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell,
    windowsHide: true,
    timeout: timeoutMinutes * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (res.error) return { ok: false, detail: res.error.message };
  if (res.status !== 0) return { ok: false, detail: `exit ${res.status ?? res.signal}` };
  return { ok: true, stdout: capture ? res.stdout.toString() : '' };
}

function must(step, outcome, detail) {
  record(step, outcome.ok, outcome.ok ? detail : outcome.detail);
  if (!outcome.ok) finish(1, `gate FAILED at ${step}; v${version} not published`);
  return outcome;
}

function refuse(step, detail) {
  record(step, false, detail);
  finish(2, `refused: ${detail}`);
}

const npm = IS_WINDOWS ? 'npm.cmd' : 'npm';
const vsce = (vsceArgs, opts) => run(opts.step, process.execPath, [VSCE, ...vsceArgs], opts);

// 1. Preconditions.
const dirty = run('preconditions', 'git', ['status', '--porcelain'], { capture: true, timeoutMinutes: 1 });
if (!dirty.ok) refuse('preconditions', `git status failed: ${dirty.detail}`);
if (dirty.stdout.trim()) refuse('preconditions', 'the working tree has uncommitted changes');
const tagged = run('preconditions', 'git', ['tag', '--points-at', 'HEAD'], { capture: true, timeoutMinutes: 1 });
if (!tagged.ok || !tagged.stdout.split(/\r?\n/).includes(`v${version}`)) {
  refuse('preconditions', `HEAD is not the release tag v${version}`);
}
record('preconditions', true, `clean checkout of v${version}`);

// 2. Marketplace: needed, and inside the daily limit.
const shown = vsce(['show', EXTENSION_ID, '--json'], { step: 'marketplace', capture: true, timeoutMinutes: 2 });
if (!shown.ok) refuse('marketplace', `could not read the Marketplace listing (${shown.detail}); failing closed`);
let decision;
try {
  decision = publishDecision({ candidate: version, marketplaceVersions: readMarketplaceVersions(JSON.parse(shown.stdout)), now: Date.now() });
} catch (err) {
  refuse('marketplace', `${err.message}; failing closed`);
}
// A check-only run publishes nothing, so "already published" or "limit reached"
// is noted rather than refused: it still answers whether the release is good.
if (!decision.ok && args.publish) refuse('marketplace', decision.reason);
record('marketplace', true, decision.ok ? decision.reason : `${decision.reason} (check only, so the checks still run)`);

// 3. Publish rights, before spending twenty minutes on checks.
if (args.publish) {
  must('publish rights', vsce(['verify-pat', PUBLISHER, ...(args.azureCredential ? ['--azure-credential'] : [])], { step: 'publish rights', timeoutMinutes: 2 }), `publisher ${PUBLISHER}`);
}

// 4–7. Install, local CI (which includes the extension's whole test suite), security.
must('npm ci', run('npm ci', npm, ['ci', '--no-audit', '--no-fund'], { timeoutMinutes: 20 }));
must('local CI', run('local CI', npm, ['run', 'ci:local'], { timeoutMinutes: 60, env: { CI: 'true' } }), 'compile, lint, integration audit, tests, coverage, package');
must('security tests', run('security tests', npm, ['exec', '--', 'vitest', 'run', 'tests/security'], { timeoutMinutes: 15 }));
must('npm audit', run('npm audit', npm, ['audit', '--omit=dev', '--audit-level=high'], { timeoutMinutes: 5 }), 'no high or critical advisories in shipped dependencies');

// 8. Package once; everything after this uses this exact file.
const vsixPath = path.join(work, `atlasmind-${version}.vsix`);
must('package', vsce(['package', '--out', vsixPath], { step: 'package', timeoutMinutes: 15 }), path.basename(vsixPath));

// 9. Unpack and scan every file in it.
const unpacked = path.join(work, 'unpacked');
await unzip(vsixPath, unpacked);
const findings = [];
let scanned = 0;
for (const file of walk(unpacked)) {
  const rel = path.relative(unpacked, file);
  const size = statSync(file).size;
  const text = size <= 8 * 1024 * 1024 ? readFileSync(file, 'latin1') : undefined;
  findings.push(...scanFile(rel, text));
  scanned += 1;
}
must('secret scan', findings.length
  ? { ok: false, detail: `${findings.length} finding(s): ${findings.map((f) => `${f.file} (${f.rule})`).join('; ')}` }
  : { ok: true }, `${scanned} files, no secrets`);

// 10. It installs into a real VS Code (CLI only: no window opens).
const profile = path.join(work, 'profile');
const code = process.env.ATLASMIND_GATE_CODE_CLI || 'code';
const installArgs = ['--extensions-dir', path.join(profile, 'ext'), '--user-data-dir', path.join(profile, 'data')];
must('install', run('install', code, ['--install-extension', vsixPath, '--force', ...installArgs], { timeoutMinutes: 5 }));
const listed = run('install', code, ['--list-extensions', '--show-versions', ...installArgs], { capture: true, timeoutMinutes: 2 });
must('install', listed.ok && listed.stdout.toLowerCase().includes(`${EXTENSION_ID.toLowerCase()}@${version}`)
  ? { ok: true } : { ok: false, detail: `VS Code does not list ${EXTENSION_ID}@${version} after install` }, `${EXTENSION_ID}@${version} installed`);

// 11. The packaged code activates and its commands run.
must('smoke', run('smoke', process.execPath, [path.join(HERE, 'vsix-smoke.cjs'), path.join(unpacked, 'extension')], { timeoutMinutes: 5 }));

if (!args.publish) finish(0, `gate PASSED for v${version} (check only; nothing published)`);

// 12. Publish the file that passed.
must('publish', vsce(['publish', '--packagePath', vsixPath, ...(args.azureCredential ? ['--azure-credential'] : [])], { step: 'publish', timeoutMinutes: 15 }), `v${version} published`);
finish(0, `gate PASSED; v${version} published to the Marketplace`);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full); else yield full;
  }
}

function unzip(zipPath, dest) {
  const yauzl = require('yauzl');
  const { createWriteStream } = require('node:fs');
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const target = path.resolve(dest, entry.fileName);
        if (!target.startsWith(path.resolve(dest) + path.sep)) return reject(new Error(`unsafe path in VSIX: ${entry.fileName}`));
        if (/\/$/.test(entry.fileName)) { mkdirSync(target, { recursive: true }); zip.readEntry(); return; }
        mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          stream.pipe(createWriteStream(target)).on('finish', () => zip.readEntry()).on('error', reject);
        });
      });
      zip.readEntry();
    });
  }).catch((err) => must('secret scan', { ok: false, detail: `could not unpack the VSIX: ${err.message}` }));
}
