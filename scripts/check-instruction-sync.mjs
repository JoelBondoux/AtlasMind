#!/usr/bin/env node
/**
 * Pre-commit check: are the AtlasMind blocks in the AI instruction files current?
 *
 * Verify only. This script **never writes a file**, and that is the whole design
 * rather than a limitation. A hook that edited the tree would mean the commit
 * that lands is not the commit you staged and reviewed — and a *bi-directional*
 * one would pull another agent's edits into this repository and broadcast them
 * to every other tool's instruction file, unreviewed, at commit time. One tool's
 * change silently becoming every tool's instruction is the failure worth
 * engineering against here.
 *
 * So this mirrors what the hook already does for the version bump: it refuses,
 * and it names the command that fixes it.
 *
 * Exits 0 when everything is current, when the check is disabled, or when it
 * cannot run (no build output, no instruction files). **A check that cannot run
 * is not a failure** — blocking every commit in a fresh clone because `out/` has
 * not been built yet would train the maintainer to reach for `--no-verify`,
 * which disables the compile, lint and test gates too.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

/** One commit's escape hatch, documented in the failure message. */
if (process.env.ATLASMIND_SKIP_INSTRUCTION_CHECK === '1') {
  process.exit(0);
}

/**
 * The workspace setting behind the Settings → AI Instructions checkbox.
 *
 * Read from `.vscode/settings.json` because a git hook has no VS Code host. That
 * is also why the checkbox writes to **workspace** scope: a User-scoped value
 * would be invisible here, and a control that silently does nothing is worse
 * than one that is not offered. Default on, so a project that has never opened
 * the page still gets the check.
 */
function checkEnabled() {
  const file = path.join(root, '.vscode', 'settings.json');
  if (!existsSync(file)) {
    return true;
  }
  try {
    // Tolerate JSONC: VS Code settings files legitimately carry comments and
    // trailing commas, and a parse failure must not silently disable the check.
    const raw = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/,\s*([}\]])/g, '$1');
    const parsed = JSON.parse(raw);
    const value = parsed['atlasmind.instructions.verifyOnCommit'];
    return value === undefined ? true : value !== false;
  } catch {
    return true;
  }
}

if (!checkEnabled()) {
  process.exit(0);
}

const compiled = path.join(root, 'out', 'utils', 'instructionSyncCheck.js');
const compiledSync = path.join(root, 'out', 'utils', 'testingProtocolSync.js');
if (!existsSync(compiled)) {
  // Nothing built yet. The hook compiles later in its own run, but this step
  // comes first and must not be the thing that blocks a fresh clone.
  process.exit(0);
}

const { findStaleInstructionBlocks, formatStaleReport } = await import(`file://${compiled}`);

/**
 * The block kinds and target paths come from the extension's own module, so the
 * hook cannot drift from what the sync actually writes. Loading it pulls in
 * `vscode`, which does not exist here — so the constants are duplicated below
 * only if that import fails, and the duplication is asserted against the real
 * module by a unit test.
 */
let kinds;
let targetPaths;
try {
  const mod = await import(`file://${compiledSync}`);
  kinds = mod.CHECKED_INSTRUCTION_BLOCK_KINDS;
  targetPaths = mod.INSTRUCTION_TARGET_PATHS;
} catch {
  kinds = [
    {
      id: 'testing-protocols',
      label: 'Testing protocols',
      markers: {
        start: '<!-- atlasmind:testing-protocols:start -->',
        end: '<!-- atlasmind:testing-protocols:end -->',
      },
      sourcePath: 'project_memory/index/testing-config.json',
    },
    {
      id: 'workflow',
      label: 'GitHub workflow',
      markers: {
        start: '<!-- atlasmind:workflow:start -->',
        end: '<!-- atlasmind:workflow:end -->',
      },
      sourcePath: 'project_memory/operations/workflow.json',
    },
  ];
  targetPaths = [
    '.github/copilot-instructions.md', 'CLAUDE.md', '.claude/CLAUDE.md',
    '.cursorrules', '.clinerules', '.cline/system_prompt.md', 'AGENTS.md',
    'GEMINI.md', '.gemini/system.md', 'WINDSURF.md', '.aider.system.md',
  ];
}

const targets = [];
for (const relative of targetPaths) {
  const absolute = path.join(root, relative);
  if (existsSync(absolute)) {
    try {
      targets.push({ path: relative, text: readFileSync(absolute, 'utf8') });
    } catch {
      // Unreadable file: skipped rather than reported. It is not evidence of
      // staleness, and failing a commit over a permission error would be noise.
    }
  }
}

if (targets.length === 0) {
  process.exit(0);
}

const sources = new Map();
for (const kind of kinds) {
  const absolute = path.join(root, kind.sourcePath);
  if (existsSync(absolute)) {
    try {
      sources.set(kind.sourcePath, readFileSync(absolute, 'utf8'));
    } catch {
      // Same reasoning: no source, nothing to be stale against.
    }
  }
}

const stale = findStaleInstructionBlocks({ targets, sources, kinds });
if (stale.length === 0) {
  process.exit(0);
}

console.error(formatStaleReport(stale));
process.exit(1);
