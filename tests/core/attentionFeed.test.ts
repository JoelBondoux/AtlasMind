import { describe, expect, it } from 'vitest';
import {
  ATTENTION_VISIBLE_CAP,
  buildAttentionFeed,
  summarizeAttention,
  type AttentionInput,
} from '../../src/core/attentionFeed.ts';

/** A project where everything was assessed and everything is fine. */
const healthy: AttentionInput = {
  testing: { failing: 0, hasReport: true, uncovered: 0 },
  pipeline: { latestFailed: false, loaded: true },
  issues: { loaded: true, stale: 0, unassigned: 0 },
  ssot: { blocked: 0, warned: 0 },
  director: { overdue: 0 },
  documents: { reviewDue: 0, missing: 0 },
  risk: { assessed: true, open: 0 },
  debt: { scanned: true, open: 0, high: 0 },
  release: { blockedGates: 0 },
  delivery: { blockedPaths: 0 },
  workflow: { nextStepBlocked: false },
};

describe('the feed is empty when nothing needs you', () => {
  /**
   * The property that distinguishes this section from the twelve-card shortcut
   * grid that was removed from the Overview for being noise. A navigation grid
   * can never be empty; this must be.
   */
  it('produces nothing at all for a healthy project', () => {
    const feed = buildAttentionFeed(healthy);
    expect(feed.items).toEqual([]);
    expect(feed.totalCount).toBe(0);
  });

  it('never emits an item for a merely-numeric fact', () => {
    // "43% coverage" is state, not attention. A card that always shows a number
    // is a card people stop reading.
    const feed = buildAttentionFeed({
      ...healthy,
      testing: { failing: 0, hasReport: true, uncovered: 0 },
      ssot: { blocked: 0, warned: 12 },
    });
    // Warned entries are not blocked; nothing is stopped, so nothing is raised.
    expect(feed.items).toEqual([]);
  });
});

describe('unassessed is never reported as clear', () => {
  /**
   * The failure mode that would make this section actively harmful: silence
   * earned by not looking, presented as silence earned by everything passing.
   */
  it('separates "checked and clear" from "barely checked"', () => {
    expect(buildAttentionFeed(healthy).emptyState).toBe('clear');
    // A project where almost nothing could be read.
    expect(buildAttentionFeed({ ssot: { blocked: 0, warned: 0 } }).emptyState).toBe('unexamined');
    expect(buildAttentionFeed({}).emptyState).toBe('unexamined');
  });

  it('says so in words, not just a flag', () => {
    expect(summarizeAttention(buildAttentionFeed(healthy))).toMatch(/Nothing needs you/);
    expect(summarizeAttention(buildAttentionFeed({}))).toMatch(/Too little has been assessed/);
  });

  it.each([
    ['no test report', { testing: { failing: 0, hasReport: false, uncovered: 0 } }, 'tests-no-report'],
    ['issues unreadable', { issues: { loaded: false, stale: 0, unassigned: 0 } }, 'issues-unreadable'],
    ['risk never assessed', { risk: { assessed: false, open: 0 } }, 'risk-never-assessed'],
    ['debt never scanned', { debt: { scanned: false, open: 0, high: 0 } }, 'debt-never-scanned'],
  ] as const)('raises %s as unassessed rather than staying silent', (_name, input, id) => {
    const feed = buildAttentionFeed(input as AttentionInput);
    expect(feed.items.map(item => item.id)).toContain(id);
    expect(feed.items.find(item => item.id === id)?.urgency).toBe('unassessed');
  });

  it('does not count failures from a report that does not exist', () => {
    // Zero failing tests and no report are different claims. Only the second is
    // true here, and reporting "0 failing" would be a fabricated pass.
    const feed = buildAttentionFeed({ testing: { failing: 0, hasReport: false, uncovered: 0 } });
    expect(feed.items.map(item => item.id)).toEqual(['tests-no-report']);
  });

  it('withholds count-based rules whose page could not be read', () => {
    // A stale-issue count from an unreadable tracker would be invented.
    const feed = buildAttentionFeed({ issues: { loaded: false, stale: 99, unassigned: 99 } });
    expect(feed.items.map(item => item.id)).toEqual(['issues-unreadable']);
  });
});

describe('ranking is by consequence, not magnitude', () => {
  it('puts a red pipeline above forty stale issues', () => {
    // The ObservedDelta rule, applied here. Sorting by count would invert this.
    const feed = buildAttentionFeed({
      ...healthy,
      pipeline: { latestFailed: true, loaded: true },
      issues: { loaded: true, stale: 40, unassigned: 12 },
    });
    const ids = feed.items.map(item => item.id);
    expect(ids.indexOf('ci-red')).toBeLessThan(ids.indexOf('issues-stale'));
  });

  it('orders the three urgencies now → soon → unassessed', () => {
    const feed = buildAttentionFeed({
      testing: { failing: 2, hasReport: true, uncovered: 3 },
      risk: { assessed: false, open: 0 },
      director: { overdue: 1 },
    });
    const urgencies = feed.items.map(item => item.urgency);
    const rank = { now: 0, soon: 1, unassessed: 2 } as const;
    const ranks = urgencies.map(u => rank[u]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('is stable — the same input yields the same order', () => {
    // A list that shuffles between renders is a list nobody can read.
    const input: AttentionInput = {
      ...healthy,
      testing: { failing: 1, hasReport: true, uncovered: 2 },
      director: { overdue: 3 },
      risk: { assessed: true, open: 4 },
    };
    expect(buildAttentionFeed(input).items.map(i => i.id))
      .toEqual(buildAttentionFeed(input).items.map(i => i.id));
  });
});

describe('truncation is never silent', () => {
  const noisy: AttentionInput = {
    testing: { failing: 3, hasReport: true, uncovered: 2 },
    pipeline: { latestFailed: true, loaded: true },
    issues: { loaded: true, stale: 9, unassigned: 4 },
    ssot: { blocked: 2, warned: 1 },
    director: { overdue: 5 },
    documents: { reviewDue: 7, missing: 1 },
    risk: { assessed: true, open: 3 },
    debt: { scanned: true, open: 20, high: 4 },
    release: { blockedGates: 2 },
    delivery: { blockedPaths: 1 },
    workflow: { nextStepBlocked: true, nextStepTitle: 'Open a pull request' },
  };

  it('caps the visible list and states the remainder', () => {
    const feed = buildAttentionFeed(noisy);
    expect(feed.items).toHaveLength(ATTENTION_VISIBLE_CAP);
    expect(feed.totalCount).toBeGreaterThan(ATTENTION_VISIBLE_CAP);
    expect(feed.droppedByCap).toBe(feed.totalCount - ATTENTION_VISIBLE_CAP);
  });

  it('keeps the most consequential items when it truncates', () => {
    // Dropping the red pipeline to show a stale document would defeat the point.
    const feed = buildAttentionFeed(noisy);
    expect(feed.items.every(item => item.urgency === 'now')).toBe(true);
  });

  it('counts every urgency even when they are not all shown', () => {
    const feed = buildAttentionFeed(noisy);
    const total = feed.counts.now + feed.counts.soon + feed.counts.unassessed;
    expect(total).toBe(feed.totalCount);
    expect(feed.counts.soon).toBeGreaterThan(0);
  });
});

describe('every item can be acted on and checked', () => {
  const feed = buildAttentionFeed({
    testing: { failing: 1, hasReport: true, uncovered: 1 },
    pipeline: { latestFailed: true, loaded: true },
    risk: { assessed: false, open: 0 },
    ssot: { blocked: 1, warned: 0 },
  });

  it('routes every item to the page that owns the fact', () => {
    const pages = new Set(['testing', 'pipeline', 'risk', 'ssot', 'issues', 'debt', 'release', 'delivery', 'director', 'documents', 'workflow']);
    expect(feed.items.length).toBeGreaterThan(0);
    for (const item of feed.items) {
      expect(pages, item.id).toContain(item.pageTarget);
    }
  });

  it('names the rule that graded it', () => {
    // A severity you cannot argue with is one you end up ignoring. Every item
    // publishes the rule behind it, as the debt register does.
    for (const item of feed.items) {
      expect(item.rule, item.id).toBeTruthy();
      expect(item.rule.length, item.id).toBeGreaterThan(10);
    }
  });

  it('gives every item a distinct id', () => {
    const ids = feed.items.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('explains itself rather than only counting', () => {
    for (const item of feed.items) {
      expect(item.detail.length, item.id).toBeGreaterThan(20);
    }
  });
});

describe('summarizeAttention', () => {
  it('leads with what needs attention now', () => {
    const feed = buildAttentionFeed({
      ...healthy,
      director: { overdue: 2 },
      risk: { assessed: true, open: 1 },
    });
    expect(summarizeAttention(feed)).toMatch(/^1 needing attention now/);
  });

  it('is carried on the feed, so no surface has to phrase it again', () => {
    // A renderer that assembled its own headline could say "all clear" where
    // the module says "too little has been assessed" — the one confusion this
    // module exists to prevent, reintroduced one screen later.
    for (const input of [healthy, {}, { director: { overdue: 2 } }] as AttentionInput[]) {
      const feed = buildAttentionFeed(input);
      expect(feed.summary).toBe(summarizeAttention(feed));
      expect(feed.summary.length).toBeGreaterThan(0);
    }
  });

  it('mentions unassessed separately from real findings', () => {
    const feed = buildAttentionFeed({
      director: { overdue: 1 },
      risk: { assessed: false, open: 0 },
    });
    const summary = summarizeAttention(feed);
    expect(summary).toContain('1 needing attention now');
    expect(summary).toContain('1 unassessed');
  });
});
