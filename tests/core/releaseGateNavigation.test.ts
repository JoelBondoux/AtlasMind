import { describe, it, expect } from 'vitest';
import {
  RELEASE_GATE_DESTINATIONS,
  RELEASE_GATE_FILTERS,
  RELEASE_GATE_SORTS,
  RELEASE_GATE_STATUS_RANK,
  filterReleaseGates,
  isReleaseGateFilter,
  isReleaseGateSort,
  orderReleaseGates,
  resolveReleaseGateDestination,
  summarizeReleaseGateView,
} from '../../src/core/releaseGateNavigation';
import {
  evaluateReleaseGates,
  extractChangelogSection,
  type ReleaseGate,
  type ReleaseGateId,
} from '../../src/core/releasePreparation';

const gate = (id: ReleaseGateId, status: ReleaseGate['status'], label = id): ReleaseGate =>
  ({ id, label, status, detail: `${id} detail` });

describe('resolveReleaseGateDestination — declared, never inferred', () => {
  it('declares a destination for every gate the evaluator can produce', () => {
    // The evaluator is the authority on which ids exist. Reading them from a
    // real evaluation rather than from a hand-copied list is what stops this
    // table drifting behind a newly added gate.
    const changelog = '# Changelog\n\n## [1.2.3] - 2026-08-20\n\n- A change.\n';
    const produced = evaluateReleaseGates(
      { currentVersion: '1.2.3', changelog },
      extractChangelogSection(changelog, '1.2.3'),
    );
    expect(produced.length).toBeGreaterThan(0);
    for (const entry of produced) {
      expect(RELEASE_GATE_DESTINATIONS[entry.id], `no destination declared for ${entry.id}`).toBeDefined();
    }
  });

  it('returns undefined for an id nobody declared, rather than a plausible default', () => {
    expect(resolveReleaseGateDestination('not-a-gate')).toBeUndefined();
    expect(resolveReleaseGateDestination('')).toBeUndefined();
    expect(resolveReleaseGateDestination(undefined)).toBeUndefined();
    expect(resolveReleaseGateDestination(42)).toBeUndefined();
  });

  it('is not fooled by inherited object properties', () => {
    // The id arrives from a webview click. `toString` is on every object.
    expect(resolveReleaseGateDestination('toString')).toBeUndefined();
    expect(resolveReleaseGateDestination('constructor')).toBeUndefined();
  });

  it('resolves a declared id to its page or file', () => {
    expect(resolveReleaseGateDestination('ci-green')).toMatchObject({ kind: 'page', target: 'pipeline' });
    expect(resolveReleaseGateDestination('changelog-entry')).toMatchObject({ kind: 'file', target: 'CHANGELOG.md' });
  });

  it('never declares an absolute or traversing file target', () => {
    for (const destination of Object.values(RELEASE_GATE_DESTINATIONS)) {
      if (destination.kind === 'file') {
        expect(destination.target).not.toMatch(/^[/\\]|^[A-Za-z]:|\.\./);
      }
    }
  });
});

describe('orderReleaseGates — ranked by consequence, ties on declaration order', () => {
  const gates: ReleaseGate[] = [
    gate('changelog-entry', 'pass'),
    gate('notes-body', 'unknown'),
    gate('notes-clean', 'pass'),
    gate('version-ahead', 'fail'),
    gate('tag-free', 'unknown'),
    gate('clean-tree', 'fail'),
  ];

  it('puts blocked first, unknown next, ready last', () => {
    expect(orderReleaseGates(gates, 'urgency').map(entry => entry.status))
      .toEqual(['fail', 'fail', 'unknown', 'unknown', 'pass', 'pass']);
  });

  it('keeps evaluation order inside each band, so the list cannot shuffle', () => {
    expect(orderReleaseGates(gates, 'urgency').map(entry => entry.id))
      .toEqual(['version-ahead', 'clean-tree', 'notes-body', 'tag-free', 'changelog-entry', 'notes-clean']);
  });

  it('sorts unknown with the problems rather than with the passes', () => {
    // The rule releasePreparation is built on: an unknown is not a pass. An
    // ordering that sank it beside the passing gates would undo that at the
    // last surface before somebody tags.
    expect(RELEASE_GATE_STATUS_RANK.unknown).toBeLessThan(RELEASE_GATE_STATUS_RANK.pass);
    const [first] = orderReleaseGates([gate('changelog-entry', 'pass'), gate('tag-free', 'unknown')], 'urgency');
    expect(first?.status).toBe('unknown');
  });

  it('leaves evaluation order untouched in evaluation mode', () => {
    expect(orderReleaseGates(gates, 'evaluation').map(entry => entry.id)).toEqual(gates.map(entry => entry.id));
  });

  it('does not mutate the input', () => {
    const input = [...gates];
    orderReleaseGates(input, 'urgency');
    expect(input.map(entry => entry.id)).toEqual(gates.map(entry => entry.id));
  });
});

describe('filterReleaseGates', () => {
  const gates: ReleaseGate[] = [
    gate('changelog-entry', 'pass'),
    gate('notes-body', 'unknown'),
    gate('version-ahead', 'fail'),
  ];

  it('treats "outstanding" as everything that is not a pass', () => {
    expect(filterReleaseGates(gates, 'outstanding').map(entry => entry.status).sort())
      .toEqual(['fail', 'unknown']);
  });

  it('separates blocked from unknown, because only one of them is your fault', () => {
    expect(filterReleaseGates(gates, 'blocked').map(entry => entry.id)).toEqual(['version-ahead']);
    expect(filterReleaseGates(gates, 'unknown').map(entry => entry.id)).toEqual(['notes-body']);
  });

  it('admits everything under "all"', () => {
    expect(filterReleaseGates(gates, 'all')).toHaveLength(3);
  });
});

describe('summarizeReleaseGateView — a filtered board says it is filtered', () => {
  const gates: ReleaseGate[] = [
    gate('changelog-entry', 'pass'),
    gate('notes-body', 'unknown'),
    gate('version-ahead', 'fail'),
    gate('clean-tree', 'pass'),
  ];

  it('states the hidden remainder rather than presenting a subset as the whole', () => {
    const view = summarizeReleaseGateView(gates, 'blocked', 'urgency');
    expect(view.gates).toHaveLength(1);
    expect(view.hidden).toBe(3);
    expect(view.summary).toContain('3 hidden');
  });

  it('counts every status over the unfiltered set, so a chip cannot report zero blocked while filtered', () => {
    const view = summarizeReleaseGateView(gates, 'ready', 'urgency');
    expect(view.gates.every(entry => entry.status === 'pass')).toBe(true);
    expect(view.counts).toEqual({ fail: 1, unknown: 1, pass: 2 });
  });

  it('says nothing is hidden when nothing is', () => {
    const view = summarizeReleaseGateView(gates, 'all', 'urgency');
    expect(view.hidden).toBe(0);
    expect(view.summary).toContain('All 4 gates shown');
  });

  it('distinguishes an empty filter result from an unevaluated board', () => {
    const empty = summarizeReleaseGateView([], 'all', 'urgency');
    expect(empty.summary).toBe('No gates evaluated.');

    const filteredToNothing = summarizeReleaseGateView([gate('changelog-entry', 'pass')], 'blocked', 'urgency');
    expect(filteredToNothing.summary).not.toBe('No gates evaluated.');
    expect(filteredToNothing.summary).toContain('1 hidden');
  });

  it('orders the surviving gates by the requested sort', () => {
    const view = summarizeReleaseGateView(gates, 'all', 'urgency');
    expect(view.gates.map(entry => entry.status)).toEqual(['fail', 'unknown', 'pass', 'pass']);
  });
});

describe('filter and sort ids arriving from a webview', () => {
  it('accepts only declared values', () => {
    for (const entry of RELEASE_GATE_FILTERS) {
      expect(isReleaseGateFilter(entry.id)).toBe(true);
    }
    for (const entry of RELEASE_GATE_SORTS) {
      expect(isReleaseGateSort(entry.id)).toBe(true);
    }
    expect(isReleaseGateFilter('everything')).toBe(false);
    expect(isReleaseGateFilter('toString')).toBe(false);
    expect(isReleaseGateSort('label')).toBe(false);
    expect(isReleaseGateSort(null)).toBe(false);
  });

  it('offers "Needs you" as a distinct filter from "Blocked"', () => {
    // Collapsing them would let an unknown gate disappear from the working set,
    // which is the habit this stage exists to break.
    const ids = RELEASE_GATE_FILTERS.map(entry => entry.id);
    expect(ids).toContain('outstanding');
    expect(ids).toContain('blocked');
    expect(ids).toContain('unknown');
  });
});
