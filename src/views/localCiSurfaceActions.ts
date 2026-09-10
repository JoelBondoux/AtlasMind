/**
 * The two reviewed-PR local-CI actions shared by every UI surface.
 *
 * Webviews send one closed identifier. The extension host resolves it here to a
 * fixed VS Code command, so a modified webview cannot ask AtlasMind to execute
 * an arbitrary command id. Copy lives beside the mapping for the same reason:
 * Pipeline, Testing, and chat should not describe different trust boundaries.
 */

export type LocalCiSurfaceActionId = 'patch' | 'review';

export interface LocalCiSurfaceAction {
  id: LocalCiSurfaceActionId;
  command: 'atlasmind.localCi.patchRepository' | 'atlasmind.localCi.runReviewedPullRequest';
  title: string;
  shortTitle: string;
  description: string;
}

export const LOCAL_CI_SURFACE_ACTIONS: readonly LocalCiSurfaceAction[] = [
  {
    id: 'patch',
    command: 'atlasmind.localCi.patchRepository',
    title: 'Patch this repository for local CI',
    shortTitle: 'Patch repository',
    description: 'Inspect the repository, preview the managed exact-SHA workflow and shell-free command contract, then write only after confirmation.',
  },
  {
    id: 'review',
    command: 'atlasmind.localCi.runReviewedPullRequest',
    title: 'Run a reviewed pull request on local CI',
    shortTitle: 'Run reviewed PR',
    description: 'Choose an open same-repository PR, inspect its exact head SHA, approve that immutable commit, and lend one isolated runner.',
  },
] as const;

export function isLocalCiSurfaceActionId(value: unknown): value is LocalCiSurfaceActionId {
  return value === 'patch' || value === 'review';
}

export function findLocalCiSurfaceAction(value: unknown): LocalCiSurfaceAction | undefined {
  return isLocalCiSurfaceActionId(value)
    ? LOCAL_CI_SURFACE_ACTIONS.find(action => action.id === value)
    : undefined;
}
