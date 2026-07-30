import { describe, expect, it } from 'vitest';

import {
  compareObservedState,
  describeSince,
  DELTA_TRACKED_FIELDS,
  MAX_REPORTED_CHANGES,
  summarizeObservedDelta,
  takeObservedSnapshot,
  type ObservedSnapshot,
} from '../../src/core/observedDelta.js';
import type { WorkflowObservedState } from '../../src/core/workflowCurriculum.js';

const NOW = '2026-07-30T12:00:00.000Z';
const EARLIER = '2026-07-30T09:00:00.000Z';

function snapshot(state: Partial<WorkflowObservedState>, takenAt = EARLIER): ObservedSnapshot {
  return { takenAt, repoSlug: 'owner/repo', state };
}

function current(state: Partial<WorkflowObservedState>): WorkflowObservedState {
  return { repoSlug: 'owner/repo', ...state };
}

describe('a first look reports a first look, not eighteen changes', () => {
  it('treats a missing snapshot as a first look with no changes', () => {
    // The moment somebody decides whether to trust this surface is the moment it
    // has nothing to compare — so it must not fill the space with false news.
    const delta = compareObservedState(undefined, current({ openIssueCount: 12, ciStatus: 'fail' }));
    expect(delta.status).toBe('first-look');
    expect(delta.firstLookReason).toBe('no-snapshot');
    expect(delta.changes).toEqual([]);
    expect(summarizeObservedDelta(delta, NOW)).toMatch(/First look/);
  });

  it('treats an unreadable snapshot as a first look rather than a baseline of nothing', () => {
    for (const broken of [
      {} as ObservedSnapshot,
      { takenAt: '', state: {} } as ObservedSnapshot,
      { takenAt: EARLIER } as unknown as ObservedSnapshot,
      { takenAt: EARLIER, state: null } as unknown as ObservedSnapshot,
      'not a snapshot' as unknown as ObservedSnapshot,
    ]) {
      const delta = compareObservedState(broken, current({ openIssueCount: 4 }));
      expect(delta.status, JSON.stringify(broken)).toBe('first-look');
      expect(delta.changes).toEqual([]);
    }
  });

  it('refuses to compare across repositories', () => {
    // A snapshot from one repo diffed against another is not a delta, it is two
    // unrelated readings subtracted from each other.
    const delta = compareObservedState(
      { takenAt: EARLIER, repoSlug: 'owner/other', state: { openIssueCount: 90 } },
      current({ openIssueCount: 3 }),
    );
    expect(delta.status).toBe('first-look');
    expect(delta.firstLookReason).toBe('different-repository');
    expect(summarizeObservedDelta(delta, NOW)).toMatch(/different repository/);
  });

  it('still compares when one side has no slug, because absence is not disagreement', () => {
    const delta = compareObservedState(
      { takenAt: EARLIER, state: { openIssueCount: 5 } },
      { openIssueCount: 6 },
    );
    expect(delta.status).toBe('changed');
  });
});

describe('unknown and zero are not the same number', () => {
  it('reports a value that became readable as now-known, never as a rise from zero', () => {
    const delta = compareObservedState(snapshot({}), current({ openIssueCount: 12 }));
    const change = delta.changes.find(entry => entry.field === 'openIssueCount');
    expect(change?.kind).toBe('now-known');
    expect(change?.before).toBeUndefined();
    expect(change?.summary).toMatch(/nothing to compare/);
    // The thing that must never appear: a twelve-issue spike that never happened.
    expect(change?.summary).not.toMatch(/\b0\b/);
    expect(change?.summary).not.toMatch(/more|fewer/);
  });

  it('ranks a newly readable value below that same field actually moving', () => {
    // News about the reading, not about the project — so it is demoted relative
    // to its own field. It is not demoted below *every* field: a newly visible
    // failing pipeline still belongs above a label count changing.
    for (const field of DELTA_TRACKED_FIELDS) {
      const value = field.endsWith('Count') || field === 'requiredApprovers' || field === 'commitsSinceLastTag'
        ? 2
        : field.startsWith('has') || field === 'workflowEnabled' || field === 'workflowConfigPresent'
          || field === 'ghAuthenticated' || field === 'changelogHasCurrentVersion'
          ? true
          : field === 'protectedBranches' || field === 'enabledTestingMethodologyIds'
            ? ['a', 'b']
            : 'after';
      const nowKnown = compareObservedState(
        { takenAt: EARLIER, repoSlug: 'owner/repo', state: {} },
        { repoSlug: 'owner/repo', [field]: value } as WorkflowObservedState,
      ).changes[0]!;
      const movement = compareObservedState(
        { takenAt: EARLIER, repoSlug: 'owner/repo', state: { [field]: Array.isArray(value) ? ['a'] : field.startsWith('has') || typeof value === 'boolean' ? !value : 1 } },
        { repoSlug: 'owner/repo', [field]: value } as WorkflowObservedState,
      ).changes[0]!;
      expect(nowKnown.kind, field).toBe('now-known');
      expect(nowKnown.significance, field).toBeLessThan(movement.significance);
    }
  });

  it('reports a value that stopped being readable, and says a tool is the likely cause', () => {
    const delta = compareObservedState(snapshot({ openIssueCount: 12 }), current({}));
    const change = delta.changes.find(entry => entry.field === 'openIssueCount');
    expect(change?.kind).toBe('no-longer-readable');
    expect(change?.before).toBe('12');
    expect(change?.after).toBeUndefined();
    expect(change?.summary).toMatch(/no longer be read/);
    expect(change?.summary).toMatch(/tool stopped answering/);
  });

  it('ranks a value going quiet above the movement it hides', () => {
    // It explains why the rest of the page went silent, so it goes first.
    const delta = compareObservedState(
      snapshot({ openIssueCount: 12, staleIssueCount: 2 }),
      current({ staleIssueCount: 5 }),
    );
    expect(delta.changes[0]?.field).toBe('openIssueCount');
    expect(delta.changes[0]?.kind).toBe('no-longer-readable');
  });

  it('says nothing at all about a field neither reading could see', () => {
    const delta = compareObservedState(snapshot({}), current({}));
    expect(delta.status).toBe('unchanged');
    expect(delta.changes).toEqual([]);
  });
});

describe('direction is preserved, and which direction is good depends on the field', () => {
  it('reads more open issues as worse and fewer as better', () => {
    const worse = compareObservedState(snapshot({ openIssueCount: 4 }), current({ openIssueCount: 7 }));
    expect(worse.changes[0]?.kind).toBe('worsened');
    expect(worse.changes[0]?.summary).toBe('3 more open issues — 4 to 7');

    const better = compareObservedState(snapshot({ openIssueCount: 7 }), current({ openIssueCount: 4 }));
    expect(better.changes[0]?.kind).toBe('improved');
    expect(better.changes[0]?.summary).toBe('3 fewer open issues — 7 to 4');
  });

  it('reads more CI workflows as better, because the polarity is the field\'s not the number\'s', () => {
    const delta = compareObservedState(snapshot({ ciWorkflowCount: 1 }), current({ ciWorkflowCount: 3 }));
    expect(delta.changes[0]?.kind).toBe('improved');
  });

  it('singularises a movement of one', () => {
    const delta = compareObservedState(snapshot({ openIssueCount: 4 }), current({ openIssueCount: 5 }));
    expect(delta.changes[0]?.summary).toBe('1 more open issue — 4 to 5');
  });

  it('calls a flag turning on better when the flag is a good thing to have', () => {
    const delta = compareObservedState(snapshot({ hasCodeOwners: false }), current({ hasCodeOwners: true }));
    expect(delta.changes[0]?.kind).toBe('improved');
    expect(delta.changes[0]?.summary).toMatch(/is now in place/);
  });

  it('calls that same flag turning off worse', () => {
    const delta = compareObservedState(snapshot({ hasCodeOwners: true }), current({ hasCodeOwners: false }));
    expect(delta.changes[0]?.kind).toBe('worsened');
    expect(delta.changes[0]?.summary).toMatch(/no longer in place/);
  });

  it('does not moralise about a field with no better direction', () => {
    // A version changing, a profile changing, commits accumulating — news, but
    // not good or bad news, and pretending otherwise makes the whole list suspect.
    const version = compareObservedState(snapshot({ currentVersion: '0.202.0' }), current({ currentVersion: '0.203.0' }));
    expect(version.changes[0]?.kind).toBe('moved');
    expect(version.changes[0]?.summary).toBe('0.202.0 → 0.203.0');

    const ci = compareObservedState(snapshot({ ciStatus: 'pass' }), current({ ciStatus: 'fail' }));
    expect(ci.changes[0]?.kind).toBe('moved');
    expect(ci.changes[0]?.summary).toBe('pass → fail');
  });
});

describe('a delta does not report your own actions back to you', () => {
  it('ignores the current branch and a dirty working tree', () => {
    // Your position is not the project's movement, and a surface that tells you
    // that you edited a file is one you learn to skip.
    const delta = compareObservedState(
      snapshot({ currentBranch: 'develop', workingTreeClean: true }),
      current({ currentBranch: 'feat/123-thing', workingTreeClean: false }),
    );
    expect(delta.status).toBe('unchanged');
  });

  it('does not track a field that is implied by one it already tracks', () => {
    // Reporting one movement twice reads as two things happening.
    expect(DELTA_TRACKED_FIELDS).not.toContain('ghInstalled');
    expect(DELTA_TRACKED_FIELDS).not.toContain('hasChangelog');
    expect(DELTA_TRACKED_FIELDS).toContain('ghAuthenticated');
    expect(DELTA_TRACKED_FIELDS).toContain('changelogHasCurrentVersion');
  });
});

describe('lists compare as sets', () => {
  it('does not call a reordered list a change', () => {
    // `gh` promises no order, so a reorder is nothing anybody did.
    const delta = compareObservedState(
      snapshot({ protectedBranches: ['main', 'release'] }),
      current({ protectedBranches: ['release', 'main'] }),
    );
    expect(delta.status).toBe('unchanged');
  });

  it('reads losing a protected branch as worse, and says which are left', () => {
    const delta = compareObservedState(
      snapshot({ protectedBranches: ['main', 'release'] }),
      current({ protectedBranches: ['main'] }),
    );
    expect(delta.changes[0]?.kind).toBe('worsened');
    expect(delta.changes[0]?.before).toBe('main, release');
    expect(delta.changes[0]?.after).toBe('main');
  });

  it('renders an emptied list as none rather than an empty string', () => {
    const delta = compareObservedState(
      snapshot({ enabledTestingMethodologyIds: ['unit'] }),
      current({ enabledTestingMethodologyIds: [] }),
    );
    expect(delta.changes[0]?.after).toBe('none');
  });
});

describe('ranking is by consequence', () => {
  it('puts a red pipeline above a pile of issues', () => {
    const delta = compareObservedState(
      snapshot({ ciStatus: 'pass', openIssueCount: 2, declaredLabelCount: 3 }),
      current({ ciStatus: 'fail', openIssueCount: 40, declaredLabelCount: 4 }),
    );
    expect(delta.changes.map(entry => entry.field)).toEqual(['ciStatus', 'openIssueCount', 'declaredLabelCount']);
  });

  it('is stable for equal significance, so the list does not shuffle between renders', () => {
    const before = { staleIssueCount: 1, openDependencyPrCount: 1 };
    const after = current({ staleIssueCount: 2, openDependencyPrCount: 2 });
    const first = compareObservedState(snapshot(before), after).changes.map(entry => entry.field);
    const second = compareObservedState(snapshot(before), after).changes.map(entry => entry.field);
    expect(first).toEqual(second);
    expect(first).toEqual(['staleIssueCount', 'openDependencyPrCount']);
  });

  it('caps the list and says how many it left out', () => {
    const before: Partial<WorkflowObservedState> = {};
    const after: Record<string, unknown> = { repoSlug: 'owner/repo' };
    for (const [index, field] of DELTA_TRACKED_FIELDS.entries()) {
      // Only number-shaped fields, so every one is a genuine movement.
      if (field.endsWith('Count') || field === 'requiredApprovers' || field === 'commitsSinceLastTag') {
        (before as Record<string, unknown>)[field] = index;
        after[field] = index + 1;
      }
    }
    // Enough fields to exceed the cap, or this test proves nothing.
    const moved = Object.keys(before).length;
    expect(moved).toBeGreaterThan(MAX_REPORTED_CHANGES);

    const delta = compareObservedState(snapshot(before), after as WorkflowObservedState);
    expect(delta.changes).toHaveLength(MAX_REPORTED_CHANGES);
    expect(delta.droppedByCap).toBe(moved - MAX_REPORTED_CHANGES);
    // The headline counts everything, so the cap never reads as "only 8 moved".
    expect(summarizeObservedDelta(delta, NOW)).toContain(`${moved} things moved`);
  });
});

describe('the snapshot is a baseline, not an archive', () => {
  it('keeps only tracked fields', () => {
    const taken = takeObservedSnapshot(
      current({ openIssueCount: 3, currentBranch: 'develop', workingTreeClean: false }),
      NOW,
    );
    expect(taken.state.openIssueCount).toBe(3);
    expect(taken.state.currentBranch).toBeUndefined();
    expect(taken.takenAt).toBe(NOW);
    expect(taken.repoSlug).toBe('owner/repo');
  });

  it('omits a field rather than storing undefined, so unknown survives a JSON round-trip', () => {
    // `JSON.stringify` drops `undefined` values, so a snapshot that stored them
    // explicitly would read back as absent anyway — and the code must agree with
    // what storage actually does.
    const taken = takeObservedSnapshot(current({ openIssueCount: undefined }), NOW);
    expect('openIssueCount' in taken.state).toBe(false);
    const round = JSON.parse(JSON.stringify(taken)) as ObservedSnapshot;
    expect(compareObservedState(round, current({ openIssueCount: 5 })).changes[0]?.kind).toBe('now-known');
  });

  it('copies arrays so a later mutation of the live state cannot rewrite the past', () => {
    const branches = ['main'];
    const taken = takeObservedSnapshot(current({ protectedBranches: branches }), NOW);
    branches.push('release');
    expect(taken.state.protectedBranches).toEqual(['main']);
  });

  it('round-trips through JSON unchanged', () => {
    const taken = takeObservedSnapshot(
      current({ openIssueCount: 3, protectedBranches: ['main'], ciStatus: 'pass', profile: 'solo' }),
      NOW,
    );
    expect(JSON.parse(JSON.stringify(taken))).toEqual(taken);
  });

  it('states in the module that it must not be committed', async () => {
    // project_memory/ is git-tracked, so a watermark there would mean "when did
    // anybody last look" and would conflict on every glance at the dashboard.
    const { OBSERVED_SNAPSHOT_NOTE } = await import('../../src/core/observedDelta.js');
    expect(OBSERVED_SNAPSHOT_NOTE).toMatch(/git-tracked/);
    expect(OBSERVED_SNAPSHOT_NOTE).toMatch(/project_memory/);
  });
});

describe('the window is named, because "since you last looked" hides its own age', () => {
  it('describes recent windows in the units somebody thinks in', () => {
    expect(describeSince('2026-07-30T11:59:30.000Z', NOW)).toBe('in the last minute');
    expect(describeSince('2026-07-30T11:30:00.000Z', NOW)).toBe('in the last 30 minutes');
    expect(describeSince('2026-07-30T09:00:00.000Z', NOW)).toBe('in the last 3 hours');
    expect(describeSince('2026-07-29T09:00:00.000Z', NOW)).toBe('in the last 1 day');
    expect(describeSince('2026-07-25T12:00:00.000Z', NOW)).toBe('in the last 5 days');
    expect(describeSince('2026-07-10T12:00:00.000Z', NOW)).toBe('in the last 2 weeks');
  });

  it('names the date once the window is old enough that a duration would mislead', () => {
    // A quarter's drift read as this morning's news is the failure being avoided.
    expect(describeSince('2026-04-12T12:00:00.000Z', NOW)).toBe('since 2026-04-12');
  });

  it('does not invent a duration from a clock that disagrees with itself', () => {
    expect(describeSince('2026-08-30T12:00:00.000Z', NOW)).toBe('since 2026-08-30');
    expect(describeSince('not a date', NOW)).toBe('since an unknown time');
    expect(describeSince(undefined, NOW)).toBe('since an unknown time');
  });
});

describe('the headline reads without being studied', () => {
  it('says nothing moved when nothing moved, and names the window', () => {
    const delta = compareObservedState(snapshot({ openIssueCount: 3 }), current({ openIssueCount: 3 }));
    expect(delta.status).toBe('unchanged');
    expect(summarizeObservedDelta(delta, NOW)).toBe('Nothing tracked has moved in the last 3 hours.');
  });

  it('counts the directions separately, because three closed and three opened is not the same day', () => {
    const delta = compareObservedState(
      snapshot({ openIssueCount: 9, hasCodeOwners: false }),
      current({ openIssueCount: 4, hasCodeOwners: true }),
    );
    expect(summarizeObservedDelta(delta, NOW)).toBe('2 things moved in the last 3 hours, 2 the right way.');

    const bad = compareObservedState(snapshot({ openIssueCount: 4 }), current({ openIssueCount: 9 }));
    expect(summarizeObservedDelta(bad, NOW)).toBe('1 thing moved in the last 3 hours, 1 the wrong way.');
  });
});

describe('every tracked field can actually be reported', () => {
  it('produces a labelled, summarised change for each one', () => {
    // A field in the rule table that no branch can describe would appear as a
    // blank row — the silent kind of bug this codebase keeps finding.
    for (const field of DELTA_TRACKED_FIELDS) {
      const probe: Record<string, unknown> = { repoSlug: 'owner/repo' };
      const priorState: Record<string, unknown> = {};
      // Two distinguishable values of a plausible type for the field.
      const sample: [unknown, unknown] = field.endsWith('Count') || field === 'requiredApprovers'
        ? [1, 2]
        : field.startsWith('has') || field.endsWith('Enabled') || field === 'workflowConfigPresent'
          || field === 'ghAuthenticated'
          ? [false, true]
          : field === 'protectedBranches' || field === 'enabledTestingMethodologyIds'
            ? [['a'], ['a', 'b']]
            : ['before', 'after'];
      priorState[field] = sample[0];
      probe[field] = sample[1];

      const delta = compareObservedState(
        { takenAt: EARLIER, repoSlug: 'owner/repo', state: priorState },
        probe as WorkflowObservedState,
      );
      expect(delta.changes, field).toHaveLength(1);
      const change = delta.changes[0]!;
      expect(change.field, field).toBe(field);
      expect(change.label, field).toBeTruthy();
      expect(change.summary.trim(), field).toBeTruthy();
      expect(change.summary, field).not.toContain('undefined');
      expect(change.significance, field).toBeGreaterThan(0);
    }
  });
});
