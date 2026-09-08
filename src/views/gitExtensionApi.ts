import * as vscode from 'vscode';

/**
 * The part of the built-in `vscode.git` extension API AtlasMind relies on.
 *
 * A structural subset, declared once. These types lived inside `chatPanel.ts`,
 * which was fine while one surface read the branch name and stopped being fine
 * the moment a second surface needed the same API — two structural copies of
 * somebody else's interface drift silently, because nothing type-checks one
 * against the other.
 *
 * Deliberately narrow. Declaring only what is used means an upstream change to
 * a field we never read cannot break the build, and the fields we do read are
 * all optional or defensively handled: a detached HEAD, a repository with no
 * commits, and a web host with no Git extension are all ordinary states here.
 */

export interface GitRemoteLike {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

/** The Source Control commit message box. Writing to it does not commit. */
export interface GitInputBoxLike {
  value: string;
}

export interface GitRepositoryLike {
  rootUri: vscode.Uri;
  /**
   * Present on a real repository; absent in the narrower shapes some tests and
   * older API versions provide, so every caller must handle it missing.
   */
  inputBox?: GitInputBoxLike;
  /**
   * `diff(true)` is the **staged** diff, `diff(false)` the unstaged one.
   *
   * Optional for the same reason as `inputBox`: this is somebody else's API and
   * a missing method must degrade to a message rather than throw.
   */
  diff?(cached?: boolean): Promise<string>;
  state: {
    remotes: readonly GitRemoteLike[];
    /**
     * The checked-out ref, when there is one.
     *
     * Optional because a detached HEAD and a freshly-initialised repository both
     * legitimately have no branch name — and because the workflow notice that
     * reads this must degrade to a general message rather than claim you are on
     * a branch it could not identify.
     */
    HEAD?: { name?: string };
    onDidChange: vscode.Event<void>;
  };
}

export interface GitApiLike {
  repositories: readonly GitRepositoryLike[];
  onDidOpenRepository: vscode.Event<GitRepositoryLike>;
}

export interface GitExtensionLike {
  getAPI(version: number): GitApiLike;
}

/**
 * Returns the built-in `vscode.git` extension API, activating the extension if
 * needed. Returns `undefined` when Git tooling is unavailable (e.g. a web host
 * without the Git extension).
 */
export async function getGitApi(): Promise<GitApiLike | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
  if (!extension) {
    return undefined;
  }
  if (!extension.isActive) {
    await extension.activate();
  }
  return extension.exports.getAPI(1);
}

/**
 * The repository containing `workspaceRoot`, or the first one open.
 *
 * `startsWith` on the path rather than an exact match, because a workspace
 * folder can sit inside a repository rather than at its root — and falling back
 * to the first repository is right for the ordinary single-repository case and
 * merely arbitrary in a multi-root one, which is what the caller's own message
 * should say.
 */
export function findRepositoryFor(
  api: GitApiLike | undefined,
  workspaceRoot: string | undefined,
): GitRepositoryLike | undefined {
  if (!api) {
    return undefined;
  }
  if (workspaceRoot) {
    const owning = api.repositories.find(candidate => workspaceRoot.startsWith(candidate.rootUri.fsPath));
    if (owning) {
      return owning;
    }
  }
  return api.repositories[0];
}
