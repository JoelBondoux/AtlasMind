import { describe, expect, it } from 'vitest';

import {
  MAX_REGISTER_ROADMAP_LENGTH,
  MAX_REGISTER_TITLE_LENGTH,
  deriveRegisterIssueDraft,
  deriveRegisterRoadmapText,
  type RegisterFinding,
} from '../../src/core/registerHandoff.ts';
import { deriveCardRoadmapText } from '../../src/core/ideationDerivation.ts';

const finding = (overrides: Partial<RegisterFinding> = {}): RegisterFinding => ({
  kind: 'gap',
  id: 'gap-1',
  title: 'No CODEOWNERS file, so reviews are not routed to anyone',
  severity: 'medium',
  category: 'delivery',
  ...overrides,
});

describe('deriveRegisterRoadmapText', () => {
  it('states the work rather than the finding', () => {
    // Without the prefix the backlog reads as if the missing CODEOWNERS file
    // were the goal.
    expect(deriveRegisterRoadmapText(finding()).text)
      .toBe('Close: no CODEOWNERS file, so reviews are not routed to anyone');
  });

  it('uses a different verb per register, because they commit you to different things', () => {
    expect(deriveRegisterRoadmapText(finding({ kind: 'gap' })).prefix).toBe('Close');
    expect(deriveRegisterRoadmapText(finding({ kind: 'debt' })).prefix).toBe('Pay down');
    expect(deriveRegisterRoadmapText(finding({ kind: 'risk' })).prefix).toBe('Mitigate');
  });

  it('says “Mitigate” for a risk exactly as the ideation board does', () => {
    // Two vocabularies for one word would eventually mean different things on
    // two surfaces, and the backlog is where they would meet.
    const fromBoard = deriveCardRoadmapText({
      id: 'card-1', title: 'Retention claim is unevidenced', kind: 'risk',
    });
    expect(fromBoard.text.startsWith('Mitigate: ')).toBe(true);
    expect(deriveRegisterRoadmapText(finding({ kind: 'risk' })).prefix).toBe('Mitigate');
  });

  it('lower-cases a sentence-cased first word but never a name', () => {
    expect(deriveRegisterRoadmapText(finding({ title: 'GitHub Actions has no cache step' })).text)
      .toBe('Close: GitHub Actions has no cache step');
    expect(deriveRegisterRoadmapText(finding({ title: 'Reviews are unrouted' })).text)
      .toBe('Close: reviews are unrouted');
  });

  it('strips the gap analysis’s own bracketed markup out of the sentence', () => {
    expect(deriveRegisterRoadmapText(finding({ title: '[P1] [security] [gap] Secrets reach the log' })).text)
      .toBe('Close: secrets reach the log');
  });

  it('clamps a long finding on a word boundary and says it clamped', () => {
    const derived = deriveRegisterRoadmapText(finding({ title: 'word '.repeat(120).trim() }));
    expect(derived.text.length).toBeLessThanOrEqual(MAX_REGISTER_ROADMAP_LENGTH);
    expect(derived.clamped).toBe(true);
    expect(derived.text.endsWith('…')).toBe(true);
    expect(derived.text).not.toMatch(/wor…$/);
  });

  it('produces nothing from a finding with no text, rather than a bare prefix', () => {
    // "Close:" on its own would be a roadmap item nobody could act on.
    expect(deriveRegisterRoadmapText(finding({ title: '   ' })).text).toBe('');
  });

  it('is deterministic — the same finding yields the same line', () => {
    expect(deriveRegisterRoadmapText(finding())).toEqual(deriveRegisterRoadmapText(finding()));
  });
});

describe('deriveRegisterIssueDraft', () => {
  const DECLARED = ['bug', 'security', 'documentation', 'Dependencies', 'critical'];

  it('takes only labels the repository already declares', () => {
    const draft = deriveRegisterIssueDraft(finding({ category: 'security' }), DECLARED);
    expect(draft.labels).toEqual(['security']);
  });

  it('uses the repository’s own spelling', () => {
    // `Dependencies` and `dependencies` are one label to a human and two to `gh`.
    const draft = deriveRegisterIssueDraft(finding({ kind: 'debt', category: 'dependency' }), DECLARED);
    expect(draft.labels).toEqual(['Dependencies']);
  });

  it('invents nothing when the taxonomy has no match, and states what it dropped', () => {
    const draft = deriveRegisterIssueDraft(finding({ category: 'ui-ux' }), DECLARED);
    expect(draft.labels).toEqual([]);
    expect(draft.droppedLabels).toEqual(['ui']);
    expect(draft.body).toContain('does not create labels');
  });

  it('produces no labels at all when none have been loaded', () => {
    const draft = deriveRegisterIssueDraft(finding({ category: 'security' }), []);
    expect(draft.labels).toEqual([]);
  });

  it('adds a severity label only for a high finding', () => {
    expect(deriveRegisterIssueDraft(finding({ severity: 'high', category: 'security' }), DECLARED).labels)
      .toEqual(['security', 'critical']);
    expect(deriveRegisterIssueDraft(finding({ severity: 'medium', category: 'security' }), DECLARED).labels)
      .toEqual(['security']);
  });

  it('says where it came from, and that the two records stay separate', () => {
    const draft = deriveRegisterIssueDraft(finding(), DECLARED);
    expect(draft.body).toContain('gap analysis');
    // The register and the issue are separate records; pretending otherwise is
    // how a register quietly stops being true.
    expect(draft.body).toContain('closing this issue does not resolve the entry');
  });

  it('names the rule that graded it, where the register has one', () => {
    expect(deriveRegisterIssueDraft(finding({ rule: 'FIXME marker' }), DECLARED).body)
      .toContain('FIXME marker');
  });

  it('quotes the evidence path and line when the register points at one', () => {
    const draft = deriveRegisterIssueDraft(
      finding({ kind: 'debt', evidencePath: 'src/core/a.ts', evidenceLine: 42 }),
      DECLARED,
    );
    expect(draft.body).toContain('`src/core/a.ts`, line 42');
  });

  it('omits the evidence section entirely when there is none', () => {
    expect(deriveRegisterIssueDraft(finding(), DECLARED).body).not.toContain('## Evidence');
  });

  it('includes a longer detail without repeating the title', () => {
    const withDetail = deriveRegisterIssueDraft(
      finding({ kind: 'risk', title: 'Retention claim unevidenced', detail: 'The policy page states 30 days; nothing enforces it.' }),
      DECLARED,
    );
    expect(withDetail.body).toContain('nothing enforces it');

    const echoed = deriveRegisterIssueDraft(finding({ detail: finding().title }), DECLARED);
    expect(echoed.body.split('No CODEOWNERS file').length - 1).toBe(1);
  });

  it('clamps a title on a word boundary', () => {
    const draft = deriveRegisterIssueDraft(finding({ title: 'word '.repeat(80).trim() }), DECLARED);
    expect(draft.title.length).toBeLessThanOrEqual(MAX_REGISTER_TITLE_LENGTH);
    expect(draft.title.endsWith('…')).toBe(true);
  });

  it('carries the register and its id, so the two can be reconciled later', () => {
    const draft = deriveRegisterIssueDraft(finding({ kind: 'risk', id: 'risk-9' }), DECLARED);
    expect(draft).toMatchObject({ registerKind: 'risk', registerId: 'risk-9' });
  });

  it('is deterministic — the same finding yields a byte-identical draft', () => {
    expect(deriveRegisterIssueDraft(finding(), DECLARED))
      .toEqual(deriveRegisterIssueDraft(finding(), DECLARED));
  });

  it('never throws on a finding with nothing in it', () => {
    const draft = deriveRegisterIssueDraft(finding({ title: '', detail: undefined }), []);
    expect(draft.title).toBe('');
    expect(draft.body).toContain('(no description recorded)');
  });
});
