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
 * `ssotHomeRoot()` locates the SSOT home (the folder holding project memory)
 * the same way: it gathers what is on disk and `locateSsotHome` decides. It is
 * the one *deliberate* departure from the first-folder default, and only for
 * reads and writes of project memory. Workspace *identity* — the cost-tracker
 * key and the machine-private cost-history hash — stays on the first folder on
 * purpose: moving it would re-key every spend record already written and
 * orphan the history, which is a worse failure than a key named after a folder
 * that is not the home. A component picker arrives here later, beside these —
 * never at a call site.
 */

import { statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ProjectComposition } from '../core/projectComposition.js';
import { readWorkflowFile } from '../core/workflowConfig.js';
import {
  defaultWorkspaceFolderOf,
  describeSsotHomeRefusal,
  locateSsotHome,
  resolveWorkspaceScope,
  type SsotHomeLocation,
  type SsotHomeProbe,
  type WorkspaceFolderReference,
  type WorkspaceScope,
  type WorkspaceScopeOptions,
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
  options?: WorkspaceScopeOptions,
): Promise<WorkspaceScope> {
  return resolveWorkspaceScope(await workspaceFolderReferences(), composition, target, options);
}

const DEFAULT_SSOT_PATH = 'project_memory';

/**
 * The configured project-memory folder, as a workspace-relative path.
 *
 * Validated, never cleaned: an absolute path or one that climbs out of the
 * folder is replaced by the default rather than repaired into something the
 * user did not write, which is what every other reader of the setting does.
 */
function configuredSsotPath(): string {
  const raw = vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH);
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return DEFAULT_SSOT_PATH;
  }
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    return DEFAULT_SSOT_PATH;
  }
  return segments.join('/');
}

/**
 * Look inside one folder: does it hold project memory, and does its own
 * `workflow.json` declare a composition?
 *
 * Synchronous, because the surfaces that ask (a manager's constructor, a
 * prompt builder) are, and bounded: one `stat` and one small read per folder,
 * for at most `SSOT_HOME_MAX_PROBED_FOLDERS` folders, and only in a multi-root
 * workspace. A `stat` that fails for any reason other than "not there" is
 * *could not look*, which the decision reports rather than reading as absent.
 */
function probeFolder(ssotPath: string): (folder: WorkspaceFolderReference) => SsotHomeProbe {
  return folder => {
    let ssotPresent: boolean | undefined;
    try {
      ssotPresent = statSync(path.join(folder.fsPath, ...ssotPath.split('/'))).isDirectory();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      ssotPresent = code === 'ENOENT' || code === 'ENOTDIR' ? false : undefined;
    }
    const composition = readWorkflowFile(folder.fsPath).config?.composition;
    return { ssotPresent, ...(composition ? { composition } : {}) };
  };
}

/** Where project memory lives in the workspace open right now. */
export interface SsotHomeRoot {
  /** The decision, with the rule that made it. */
  location: SsotHomeLocation;
  /** The host's own folder object for the home; absent when there is none or it is unknown. */
  folder?: vscode.WorkspaceFolder;
  /** The home's filesystem path; absent exactly when `folder` is. */
  fsPath?: string;
  /** Why project memory may not be read or written, when the home is ambiguous. */
  refusal?: string;
}

/**
 * Locate the SSOT home among the open folders.
 *
 * A single-root workspace is answered without touching the disk or the
 * settings, so it is byte-for-byte the first folder it always was. In a
 * multi-root workspace each folder is probed and `locateSsotHome` applies
 * `SSOT_HOME_RULES`. An ambiguous home comes back with no folder and a
 * `refusal` naming the candidates — the caller refuses rather than picking.
 * Nothing is cached, for the same reason as everything else here.
 */
export function ssotHomeRoot(): SsotHomeRoot {
  const folders = openWorkspaceFolders();
  if (folders.length <= 1) {
    const only = defaultWorkspaceFolderOf(folders);
    const location = locateSsotHome(
      folders.map(folder => ({ name: folder.name, fsPath: folder.uri.fsPath })),
      () => undefined,
    );
    return only ? { location, folder: only, fsPath: only.uri.fsPath } : { location };
  }
  const ssotPath = configuredSsotPath();
  const references: WorkspaceFolderReference[] = folders.map(folder => ({
    name: folder.name,
    fsPath: folder.uri.fsPath,
    ...(PROBEABLE_SCHEMES.has(folder.uri.scheme) ? {} : { readable: false }),
  }));
  const location = locateSsotHome(references, probeFolder(ssotPath));
  const index = location.home ? references.indexOf(location.home) : -1;
  const folder = index >= 0 ? folders[index] : undefined;
  const refusal = describeSsotHomeRefusal(location, ssotPath);
  return {
    location,
    ...(folder ? { folder, fsPath: folder.uri.fsPath } : {}),
    ...(refusal ? { refusal } : {}),
  };
}
