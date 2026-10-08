/**
 * The one module that reads `vscode.workspace.workspaceFolders`.
 *
 * AtlasMind was single-root by construction: two hundred-odd call sites each
 * took `workspaceFolders?.[0]` for themselves, so "which folder does this
 * mean?" had as many answers as there were places asking, and none of them
 * could be changed without finding all of them. This adapter is where that
 * question is asked from now on. It owns no decision of its own — every rule
 * lives in the pure `src/core/workspaceScope.ts`, and this file only turns the
 * host's folders into the shape that module reads.
 *
 * Three properties, in order of how much they matter:
 *
 * - **The default is exactly today's.** `defaultWorkspaceFolder()` is the first
 *   folder VS Code reports — not the declared home, not the folder the active
 *   editor is in — because `docs/project-composition.md` §8 requires default
 *   resolution to stay byte-for-byte `workspaceFolders[0]` until a surface opts
 *   in. A migrated call site therefore behaves identically; the migration
 *   changes *where* the question is asked, never the answer.
 * - **Nothing is cached.** VS Code adds and removes folders while the extension
 *   runs, and every call site this replaces re-read the live list on each use.
 *   A memoised root would be the one behavioural change a structural refactor
 *   must not make.
 * - **Migration is by consequence, not by count.** The execution boundary (skill
 *   context, `runCommand`, the git tools) routes through here first because it
 *   is where a wrong root does damage. The remaining direct reads are ceilinged
 *   per file by `tests/baselines/workspaceFolderReads.test.ts`, which fails if a
 *   count rises *or* falls without its ceiling being lowered; a mechanical
 *   rewrite of every `[0]` is an explicit non-goal.
 *
 * Later slices add `ssotHomeRoot()` (locating the SSOT home in a multi-root
 * workspace) and a component picker here, beside these — never at a call site.
 */

import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import type { ProjectComposition } from '../core/projectComposition.js';
import {
  defaultWorkspaceFolderOf,
  resolveWorkspaceScope,
  type WorkspaceFolderReference,
  type WorkspaceScope,
  type WorkspaceScopeTarget,
} from '../core/workspaceScope.js';

/**
 * URI schemes whose `fsPath` names something this process can open.
 *
 * A virtual folder (`vscode-vfs`, `memfs`, a GitHub repository opened in the
 * browser) still has an `fsPath`, but it is not a path on this machine, so
 * probing it would answer a different question. Such a folder is reported
 * unreadable rather than probed.
 */
const PROBEABLE_SCHEMES: ReadonlySet<string> = new Set(['file', 'vscode-remote']);

/** Every folder open in this window, in VS Code's order; empty when none is. */
export function openWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
  return vscode.workspace.workspaceFolders ?? [];
}

/**
 * The folder a caller means when it has not said which: the first one open.
 *
 * Returns the host's own folder object, so a caller needing its `uri.scheme`
 * or passing it to `vscode.debug.startDebugging` gets exactly what the direct
 * read used to give it.
 */
export function defaultWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return defaultWorkspaceFolderOf(openWorkspaceFolders());
}

/** The default folder's filesystem path, or `undefined` when no folder is open. */
export function defaultWorkspaceRootPath(): string | undefined {
  return defaultWorkspaceFolder()?.uri.fsPath;
}

/**
 * The open folders as `resolveWorkspaceScope` reads them, each probed once.
 *
 * `readable: false` means somebody looked and could not get in — a folder on a
 * scheme this process cannot open, or a path that no longer answers. It is not
 * dropped, because a component whose folder is missing and one whose folder is
 * unreadable call for different reactions, and the resolver reports which.
 */
export async function workspaceFolderReferences(): Promise<WorkspaceFolderReference[]> {
  return Promise.all(openWorkspaceFolders().map(async folder => {
    const readable = PROBEABLE_SCHEMES.has(folder.uri.scheme)
      ? await fs.access(folder.uri.fsPath).then(() => true, () => false)
      : false;
    return { name: folder.name, fsPath: folder.uri.fsPath, readable };
  }));
}

/**
 * Resolve a scope against the folders open right now.
 *
 * Omitting `target` is the default rule — the first folder, composition not
 * consulted — exactly as `resolveWorkspaceScope` defines it.
 */
export async function resolveScope(
  composition?: ProjectComposition,
  target?: WorkspaceScopeTarget,
): Promise<WorkspaceScope> {
  return resolveWorkspaceScope(await workspaceFolderReferences(), composition, target);
}
