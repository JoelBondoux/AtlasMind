import { describe, expect, it } from 'vitest';

import {
  hasBeenScanned,
  lastRunFor,
  openResearchFindings,
  parseResearchFindings,
  recordDerivedCard,
  recordScanRun,
  reconcileScanFindings,
  renderResearchMarkdown,
  researchQuestions,
  sanitizeCitation,
  sanitizeIncomingFindings,
  sanitizeResearchRegister,
  seedResearchRegister,
  transitionResearchFinding,
  type ResearchFinding,
  type ResearchRegister,
} from '../../src/core/researchRegister.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');
const LATER = new Date('2026-08-30T12:00:00.000Z');

function citation(url = 'https://example.com/post'): Record<string, unknown> {
  return { url, title: 'A post', fetchedAt: NOW.toISOString() };
}

function finding(overrides: Partial<ResearchFinding> = {}): ResearchFinding {
  return {
    id: 'competition-acme-shipped-a-planner',
    scanId: 'competition',
    kind: 'finding',
    title: 'Acme shipped a planner',
    detail: 'Announced on their changelog.',
    severity: 'low',
    rule: 'a single cited observation',
    citations: [{ url: 'https://example.com/post', host: 'example.com', fetchedAt: NOW.toISOString() }],
    status: 'open',
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    transitions: [],
    ...overrides,
  };
}

function register(overrides: Partial<ResearchRegister> = {}): ResearchRegister {
  return { ...seedResearchRegister(NOW), ...overrides };
}

describe('citations are a retrieval promise', () => {
  it('accepts https and rejects everything else', () => {
    expect(sanitizeCitation(citation(), NOW.toISOString())?.host).toBe('example.com');
    expect(sanitizeCitation(citation('http://example.com/post'), NOW.toISOString())).toBeUndefined();
    expect(sanitizeCitation(citation('ftp://example.com'), NOW.toISOString())).toBeUndefined();
    expect(sanitizeCitation(citation('not a url'), NOW.toISOString())).toBeUndefined();
    expect(sanitizeCitation({}, NOW.toISOString())).toBeUndefined();
  });

  it('accepts a bare string, which is the shape models produce most often', () => {
    expect(sanitizeCitation('https://example.com/x', NOW.toISOString())?.url)
      .toBe('https://example.com/x');
  });
});

describe('the citation gate lives in the sanitizer, not in a prompt', () => {
  it('records a cited claim as a finding and an uncited one as a question', () => {
    const result = sanitizeIncomingFindings(
      [
        { title: 'Acme shipped a planner', detail: 'Seen on their changelog.', citations: [citation()] },
        { title: 'The market is probably growing', detail: 'It feels that way.' },
      ],
      'competition',
      NOW,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe('finding');
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.kind).toBe('question');
    // Demoted, not discarded: the thought is worth keeping, just not as evidence.
    expect(result.questions[0]!.title).toBe('The market is probably growing');
  });

  it('demotes a claim whose only citation was unusable', () => {
    const result = sanitizeIncomingFindings(
      [{ title: 'Insecure source', citations: ['http://example.com'] }],
      'market',
      NOW,
    );
    expect(result.findings).toHaveLength(0);
    expect(result.questions).toHaveLength(1);
  });

  it('counts distinct hosts, so three links to one site are one source', () => {
    const result = sanitizeIncomingFindings(
      [{
        title: 'Repeated on one site',
        citations: [citation('https://example.com/a'), citation('https://example.com/b')],
      }],
      'market',
      NOW,
    );
    expect(result.findings[0]!.severity).toBe('low');

    const corroborated = sanitizeIncomingFindings(
      [{
        title: 'Repeated across two sites',
        citations: [citation('https://example.com/a'), citation('https://other.test/b')],
      }],
      'market',
      NOW,
    );
    expect(corroborated.findings[0]!.severity).toBe('medium');
  });

  it('uses the roadmap the caller supplied, never a model assertion', () => {
    const result = sanitizeIncomingFindings(
      [{ title: 'Rival ships offline mode', citations: [citation()] }],
      'competition',
      NOW,
      { roadmapTitles: new Set(['rival ships offline mode']) },
    );
    expect(result.findings[0]!.severity).toBe('high');
  });
});

describe('fetched text is untrusted input', () => {
  it('strips control characters and redacts secrets', () => {
    const result = sanitizeIncomingFindings(
      [{
        title: 'Leaky\u0007 title',
        detail: 'Their docs show api_key=abcdefghijklmnopqrstuvwx in the sample.',
        citations: [citation()],
      }],
      'technology',
      NOW,
    );
    const recorded = result.findings[0]!;
    expect(recorded.title).not.toContain('\u0007');
    expect(recorded.detail).toContain('[REDACTED]');
    expect(recorded.detail).not.toContain('abcdefghijklmnopqrstuvwx');
  });

  it('collapses the same claim stated twice in one reply', () => {
    const result = sanitizeIncomingFindings(
      [
        { title: 'Same claim', citations: [citation()] },
        { title: 'Same claim.', citations: [citation('https://other.test/x')] },
      ],
      'market',
      NOW,
    );
    expect(result.findings).toHaveLength(1);
  });

  it('counts entries it could not read rather than dropping them silently', () => {
    const result = sanitizeIncomingFindings(['nonsense', 42, { detail: 'no title' }], 'market', NOW);
    expect(result.unreadable).toBe(3);
  });
});

describe('parsing a model reply never throws', () => {
  it('reads a fenced block, a bare array, and gives up quietly on prose', () => {
    expect(parseResearchFindings('```json\n{"findings":[{"title":"x"}]}\n```')).toHaveLength(1);
    expect(parseResearchFindings('[{"title":"x"}]')).toHaveLength(1);
    expect(parseResearchFindings('I could not find anything.')).toEqual([]);
    expect(parseResearchFindings('```json\nnot json\n```')).toEqual([]);
    expect(parseResearchFindings('')).toEqual([]);
  });
});

describe('reconciliation keeps human decisions', () => {
  it('supersedes an open finding the new scan did not reproduce', () => {
    const result = reconcileScanFindings([finding()], [], 'competition', LATER);
    expect(result.findings[0]!.status).toBe('superseded');
    expect(result.superseded).toBe(1);
    expect(result.findings[0]!.transitions).toHaveLength(1);
  });

  it('never supersedes something a person decided about', () => {
    for (const status of ['accepted', 'actioned', 'dismissed'] as const) {
      const result = reconcileScanFindings([finding({ status })], [], 'competition', LATER);
      expect(result.findings[0]!.status).toBe(status);
      expect(result.superseded).toBe(0);
    }
  });

  it('reopens a superseded finding the world produced again', () => {
    const result = reconcileScanFindings(
      [finding({ status: 'superseded' })],
      [finding({ severity: 'medium' })],
      'competition',
      LATER,
    );
    expect(result.findings[0]!.status).toBe('open');
    expect(result.findings[0]!.severity).toBe('medium');
    expect(result.findings[0]!.lastSeenAt).toBe(LATER.toISOString());
  });

  it('leaves other scans alone', () => {
    const other = finding({ id: 'market-something', scanId: 'market' });
    const result = reconcileScanFindings([other], [], 'competition', LATER);
    expect(result.findings[0]!.status).toBe('open');
    expect(result.superseded).toBe(0);
  });

  it('adds what is genuinely new', () => {
    const result = reconcileScanFindings([], [finding()], 'competition', LATER);
    expect(result.added).toBe(1);
    expect(result.findings).toHaveLength(1);
  });
});

describe('transitions and provenance', () => {
  it('records a decision with its note', () => {
    const before = register({ findings: [finding()] });
    const after = transitionResearchFinding(before, finding().id, 'dismissed', LATER, 'Not our segment.');
    expect(after.findings[0]!.status).toBe('dismissed');
    expect(after.findings[0]!.transitions[0]).toMatchObject({ status: 'dismissed', note: 'Not our segment.' });
  });

  it('returns the register untouched for an unknown id', () => {
    const before = register({ findings: [finding()] });
    expect(transitionResearchFinding(before, 'nope', 'dismissed', LATER)).toBe(before);
  });

  it('links a finding to the card it became', () => {
    const before = register({ findings: [finding()] });
    const after = recordDerivedCard(before, finding().id, 'card-9', LATER);
    expect(after.findings[0]!.derivedCardId).toBe('card-9');
    expect(after.findings[0]!.status).toBe('actioned');
  });
});

describe('a failed run is not an assessment', () => {
  it('reports never-scanned for a run that answered nothing', () => {
    let state = register();
    state = recordScanRun(state, {
      scanId: 'market', ranAt: NOW.toISOString(), outcome: 'no-source', findingCount: 0, questionCount: 0,
    });
    expect(hasBeenScanned(state, 'market')).toBe(false);
    // The attempt is still visible — "tried and got nothing" is worth seeing.
    expect(lastRunFor(state, 'market')?.outcome).toBe('no-source');

    state = recordScanRun(state, {
      scanId: 'market', ranAt: LATER.toISOString(), outcome: 'ok', findingCount: 2, questionCount: 0,
    });
    expect(hasBeenScanned(state, 'market')).toBe(true);
  });
});

describe('the persisted file is a boundary too', () => {
  it('demotes a stored finding whose citations were edited away', () => {
    const sanitized = sanitizeResearchRegister({
      version: 1,
      runs: [],
      findings: [{ ...finding(), kind: 'finding', citations: [], severity: 'high' }],
    }, NOW);
    expect(sanitized.findings[0]!.kind).toBe('question');
    expect(sanitized.findings[0]!.severity).toBe('low');
  });

  it('coerces an unreadable run outcome to failed, never to ok', () => {
    const sanitized = sanitizeResearchRegister({
      version: 1,
      findings: [],
      runs: [{ scanId: 'market', ranAt: NOW.toISOString(), outcome: 'splendid' }],
    }, NOW);
    expect(sanitized.runs[0]!.outcome).toBe('failed');
    expect(hasBeenScanned(sanitized, 'market')).toBe(false);
  });

  it('drops entries for scans that do not exist', () => {
    const sanitized = sanitizeResearchRegister({
      version: 1,
      findings: [{ ...finding(), scanId: 'gap' }],
      runs: [{ scanId: 'gap', ranAt: NOW.toISOString(), outcome: 'ok' }],
    }, NOW);
    expect(sanitized.findings).toHaveLength(0);
    expect(sanitized.runs).toHaveLength(0);
  });

  it('seeds from junk rather than throwing', () => {
    expect(sanitizeResearchRegister(null, NOW).findings).toEqual([]);
    expect(sanitizeResearchRegister('nope', NOW).runs).toEqual([]);
  });
});

describe('the mirror', () => {
  const state = recordScanRun(
    register({ findings: [finding(), finding({ id: 'market-hunch', scanId: 'market', kind: 'question', citations: [] })] }),
    { scanId: 'competition', ranAt: NOW.toISOString(), outcome: 'ok', findingCount: 1, questionCount: 0 },
  );

  it('publishes the rule table and the catalog', () => {
    const markdown = renderResearchMarkdown(state);
    expect(markdown).toContain('## How a finding is graded');
    expect(markdown).toContain('## The scan catalog');
  });

  it('says how much has never been assessed rather than only what was found', () => {
    const markdown = renderResearchMarkdown(state);
    expect(markdown).toContain('have never produced an answer');
    expect(markdown).toContain('Unknown rather than clear');
  });

  it('keeps questions out of the findings section and says why', () => {
    const markdown = renderResearchMarkdown(state);
    expect(markdown).toContain('## Questions to research');
    expect(markdown).toContain('not** evidence');
    expect(openResearchFindings(state)).toHaveLength(1);
    expect(researchQuestions(state)).toHaveLength(1);
  });

  it('links every source', () => {
    expect(renderResearchMarkdown(state)).toContain('(https://example.com/post)');
  });
});
