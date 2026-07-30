import { describe, expect, it } from 'vitest';

import { sanitizeIssueDraft } from '../../src/core/issueTracker.js';
import {
  deriveRoadmapIssueDraft,
  draftableRoadmapItems,
  MAX_DERIVED_TITLE_LENGTH,
  type RoadmapDraftSource,
} from '../../src/core/roadmapIssueDraft.js';

function item(overrides: Partial<RoadmapDraftSource> = {}): RoadmapDraftSource {
  return {
    id: 'item-7',
    text: 'Add rate limiting to the public webhook endpoint',
    completed: false,
    focus: 'security',
    priorityScore: 60,
    priorityReason: 'Security items are raised first because the cost of being late is not proportional to the effort.',
    gates: [],
    ...overrides,
  };
}

const LABELS = ['bug', 'enhancement', 'documentation', 'security', 'tech-debt', 'mvp'];

describe('the derivation is deterministic', () => {
  it('produces a byte-identical draft for the same input', () => {
    // The point of no model being in this path: you can predict what the next
    // item will produce, and you can see the rule that chose a label.
    const first = deriveRoadmapIssueDraft(item(), LABELS);
    const second = deriveRoadmapIssueDraft(item(), LABELS);
    expect(first).toEqual(second);
  });

  it('carries the item text into the title', () => {
    expect(deriveRoadmapIssueDraft(item(), LABELS).title)
      .toBe('Add rate limiting to the public webhook endpoint');
  });

  it('keeps the roadmap id so the two can be reconciled', () => {
    expect(deriveRoadmapIssueDraft(item(), LABELS).roadmapItemId).toBe('item-7');
  });
});

describe('roadmap syntax is not part of the sentence', () => {
  it('strips gate tags from the title', () => {
    const draft = deriveRoadmapIssueDraft(
      item({ text: 'Add rate limiting #mvp #v1', gates: ['mvp', 'v1'] }),
      LABELS,
    );
    expect(draft.title).toBe('Add rate limiting');
  });

  it('strips a checkbox or bullet leader', () => {
    for (const raw of ['- [ ] Ship the thing', '- [x] Ship the thing', '* Ship the thing', '- Ship the thing']) {
      expect(deriveRoadmapIssueDraft(item({ text: raw }), LABELS).title, raw).toBe('Ship the thing');
    }
  });

  it('strips markdown emphasis, which reads as noise in a title', () => {
    expect(deriveRoadmapIssueDraft(item({ text: 'Fix the **broken** `parser`' }), LABELS).title)
      .toBe('Fix the broken parser');
  });

  it('collapses whitespace', () => {
    expect(deriveRoadmapIssueDraft(item({ text: '  Fix   the\tparser  ' }), LABELS).title)
      .toBe('Fix the parser');
  });
});

describe('a clamped title does not look like a bug', () => {
  it('cuts on a word boundary and marks the cut', () => {
    const long = `Rework ${'the extremely detailed subsystem '.repeat(8)}end`;
    const draft = deriveRoadmapIssueDraft(item({ text: long }), LABELS);
    expect(draft.title.length).toBeLessThanOrEqual(MAX_DERIVED_TITLE_LENGTH);
    expect(draft.title.endsWith('…')).toBe(true);

    // A title ending mid-word reads as a truncation bug, and somebody scanning a
    // list of issues cannot tell ours from theirs. Checked structurally: the kept
    // part must be a prefix of the original that stops exactly where a word does.
    // (Not by pattern — a clean cut whose last word is "the" also ends in a
    // lowercase letter, so a regex cannot tell the two apart.)
    const kept = draft.title.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long.charAt(kept.length)).toBe(' ');
    // And no dangling separator before the ellipsis.
    expect(draft.title).not.toMatch(/[ ,;:.]…$/);
  });

  it('keeps the full text in the body when the title was cut', () => {
    const long = `Rework ${'the extremely detailed subsystem '.repeat(8)}end`;
    const draft = deriveRoadmapIssueDraft(item({ text: long }), LABELS);
    expect(draft.body).toContain('end');
    expect(draft.body.length).toBeGreaterThan(draft.title.length);
  });

  it('leaves a short title untouched', () => {
    const draft = deriveRoadmapIssueDraft(item({ text: 'Short' }), LABELS);
    expect(draft.title).toBe('Short');
    expect(draft.title).not.toContain('…');
  });
});

describe('labels come only from the declared taxonomy', () => {
  it('picks the repository label matching the focus', () => {
    expect(deriveRoadmapIssueDraft(item({ focus: 'security' }), LABELS).labels).toEqual(['security']);
    expect(deriveRoadmapIssueDraft(item({ focus: 'feature' }), LABELS).labels).toEqual(['enhancement']);
    expect(deriveRoadmapIssueDraft(item({ focus: 'architecture' }), LABELS).labels).toEqual(['tech-debt']);
  });

  it('uses the repository spelling rather than ours', () => {
    // `Documentation` and `documentation` are one label to a human and two to
    // `gh` — filing with the wrong case creates a second label.
    const draft = deriveRoadmapIssueDraft(item({ focus: 'documentation' }), ['Documentation']);
    expect(draft.labels).toEqual(['Documentation']);
  });

  it('invents nothing when no candidate matches, and says what it dropped', () => {
    // An invented label is created on the repository as a side effect of filing —
    // a write nobody asked for, in a taxonomy the team agreed.
    const draft = deriveRoadmapIssueDraft(item({ focus: 'security' }), ['bug', 'question']);
    expect(draft.labels).toEqual([]);
    expect(draft.droppedLabels).toEqual(['security']);
    // Visible in the issue itself, so the omission is not silent.
    expect(draft.body).toContain('does not create labels');
    expect(draft.body).toContain('`security`');
  });

  it('produces no labels at all when none are known', () => {
    // A repository may have none, or they may not have been loaded. Both mean
    // "do not invent".
    const draft = deriveRoadmapIssueDraft(item(), []);
    expect(draft.labels).toEqual([]);
  });

  it('adds a gate as a label only where the repository already uses that word', () => {
    const withMvp = deriveRoadmapIssueDraft(item({ gates: ['mvp'] }), LABELS);
    expect(withMvp.labels).toEqual(['security', 'mvp']);

    const withoutIt = deriveRoadmapIssueDraft(item({ gates: ['v2'] }), LABELS);
    expect(withoutIt.labels).toEqual(['security']);
  });

  it('does not repeat a label that the focus already chose', () => {
    const draft = deriveRoadmapIssueDraft(item({ focus: 'security', gates: ['security'] }), LABELS);
    expect(draft.labels).toEqual(['security']);
  });
});

describe('the body says where the issue came from', () => {
  const draft = deriveRoadmapIssueDraft(item({ gates: ['mvp'] }), LABELS);

  it('names the roadmap file, and deliberately not the item id', () => {
    // An issue that came from a roadmap and does not say so becomes a duplicate
    // the first time somebody reads the roadmap again — so the file is named.
    expect(draft.body).toContain('roadmap/improvement-plan.md');
    // But *not* the id. Roadmap ids are positional (`roadmap-${index + 1}`,
    // assigned after filtering), so inserting one item renumbers every item below
    // it and a quoted id would point somewhere else within a week. The item's own
    // text is already in the issue above, which is the durable reference.
    expect(draft.body).not.toContain('`item-7`');
    expect(draft.body).toContain(draft.title);
  });

  it('names the ideation card when the item came from one', () => {
    // The chain, one link at a time: card → roadmap item → issue. Following a
    // chain beats copying an issue number onto the card, which goes stale the
    // moment an issue is transferred or deleted.
    const withOrigin = deriveRoadmapIssueDraft(
      item({ origin: { cardId: 'card-9', cardTitle: 'Six weeks of support tickets', cardKind: 'evidence' } }),
      LABELS,
    );
    expect(withOrigin.body).toContain('`card-9`');
    expect(withOrigin.body).toContain('Six weeks of support tickets');
    expect(withOrigin.body).toContain('(evidence)');
    expect(withOrigin.origin?.cardId).toBe('card-9');
  });

  it('says nothing about a board when the item did not come from one', () => {
    expect(draft.body).not.toContain('ideation board');
    expect(draft.origin).toBeUndefined();
  });

  it('states that the two do not close each other', () => {
    expect(draft.body).toContain('closing this issue does not tick it off');
  });

  it('carries the priority reason rather than inventing a justification', () => {
    expect(draft.body).toContain('the cost of being late is not proportional');
  });

  it('names the gates it is tagged for', () => {
    expect(draft.body).toContain('`#mvp`');
  });

  it('has the sections in a fixed order', () => {
    const what = draft.body.indexOf('## What');
    const why = draft.body.indexOf('## Why now');
    const where = draft.body.indexOf('## Where this came from');
    expect(what).toBeGreaterThan(-1);
    expect(what).toBeLessThan(why);
    expect(why).toBeLessThan(where);
  });
});

describe('the draft survives the sanitizer it will be passed through', () => {
  it('is accepted unchanged in title and labels', () => {
    // A derived draft that the boundary sanitizer then rewrites would mean the
    // text somebody reviewed is not the text that gets posted.
    for (const focus of ['security', 'architecture', 'delivery', 'feature', 'documentation'] as const) {
      const draft = deriveRoadmapIssueDraft(item({ focus, gates: ['mvp'] }), LABELS);
      const safe = sanitizeIssueDraft(draft);
      expect(safe, focus).toBeDefined();
      expect(safe!.title, focus).toBe(draft.title);
      expect(safe!.labels, focus).toEqual(draft.labels);
    }
  });

  it('survives an item whose text is hostile', () => {
    // Roadmap text is a file in the workspace, so it is not trusted input.
    const draft = deriveRoadmapIssueDraft(
      item({ text: 'Fix  the\r\n parser <script>alert(1)</script>' }),
      LABELS,
    );
    const safe = sanitizeIssueDraft(draft);
    expect(safe).toBeDefined();
    expect(safe!.title).not.toContain('  ');
    expect(safe!.title).not.toContain('\n');
  });
});

describe('an already-finished item is not offered', () => {
  it('flags a completed item rather than pretending it is open', () => {
    expect(deriveRoadmapIssueDraft(item({ completed: true }), LABELS).alreadyComplete).toBe(true);
  });

  it('excludes completed items from the offer list', () => {
    // Raising an issue for finished work is never the intent, and offering it
    // invites a mis-click that posts publicly.
    const items = [item({ id: 'a' }), item({ id: 'b', completed: true }), item({ id: 'c' })];
    expect(draftableRoadmapItems(items).map(entry => entry.id)).toEqual(['a', 'c']);
  });

  it('orders by priority, then stably', () => {
    const items = [
      item({ id: 'low', priorityScore: 10 }),
      item({ id: 'high', priorityScore: 90 }),
      item({ id: 'mid-a', priorityScore: 50 }),
      item({ id: 'mid-b', priorityScore: 50 }),
    ];
    expect(draftableRoadmapItems(items).map(entry => entry.id)).toEqual(['high', 'mid-a', 'mid-b', 'low']);
    // Twice, because a list that reshuffles between renders makes a click land
    // on something other than what was aimed at.
    expect(draftableRoadmapItems(items).map(entry => entry.id))
      .toEqual(draftableRoadmapItems(items).map(entry => entry.id));
  });

  it('returns an empty list rather than throwing on no items', () => {
    expect(draftableRoadmapItems([])).toEqual([]);
  });
});
