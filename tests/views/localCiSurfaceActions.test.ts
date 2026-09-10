import { describe, expect, it } from 'vitest';
import {
  LOCAL_CI_SURFACE_ACTIONS,
  findLocalCiSurfaceAction,
  isLocalCiSurfaceActionId,
} from '../../src/views/localCiSurfaceActions.ts';

describe('reviewed-PR local-CI surface actions', () => {
  it('offers the same two fixed commands to every dashboard', () => {
    expect(LOCAL_CI_SURFACE_ACTIONS.map(action => action.id)).toEqual(['patch', 'review']);
    expect(findLocalCiSurfaceAction('patch')?.command).toBe('atlasmind.localCi.patchRepository');
    expect(findLocalCiSurfaceAction('review')?.command).toBe('atlasmind.localCi.runReviewedPullRequest');
  });

  it('does not let a webview supply an arbitrary command id', () => {
    expect(isLocalCiSurfaceActionId('patch')).toBe(true);
    expect(isLocalCiSurfaceActionId('review')).toBe(true);
    expect(findLocalCiSurfaceAction('workbench.action.terminal.sendSequence')).toBeUndefined();
    expect(findLocalCiSurfaceAction({ command: 'atlasmind.toggleAutopilot' })).toBeUndefined();
  });
});
