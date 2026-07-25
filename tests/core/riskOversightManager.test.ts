import { describe, expect, it } from 'vitest';

import {
  findingWeight,
  hasBeenAssessed,
  mergeDomainFindings,
  normalizeRelPath,
  openFindings,
  parseRiskFindings,
  renderRiskOversightMarkdown,
  riskMatrixCounts,
  sanitizeRiskFindings,
  sanitizeRiskOversightConfig,
  seedRiskOversightConfig,
  MAX_RISK_HISTORY,
} from '../../src/core/riskOversightManager.ts';
import type { RiskFinding, RiskOversightConfig } from '../../src/types.ts';

function makeFinding(overrides: Partial<RiskFinding> = {}): RiskFinding {
  return {
    id: 'legal-example',
    domain: 'legal',
    title: 'Example finding',
    detail: 'Detail',
    likelihood: 'medium',
    impact: 'medium',
    confidence: 'high',
    status: 'open',
    evidence: [],
    raisedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeRelPath — path safety boundary', () => {
  it('accepts a simple workspace-relative path', () => {
    expect(normalizeRelPath('docs/legal.md')).toBe('docs/legal.md');
  });

  it('normalises backslashes and a leading ./', () => {
    expect(normalizeRelPath('.\\docs\\legal.md')).toBe('docs/legal.md');
  });

  it('strips a trailing slash', () => {
    expect(normalizeRelPath('docs/')).toBe('docs');
  });

  it('rejects parent traversal', () => {
    expect(normalizeRelPath('../secrets.txt')).toBe('');
    expect(normalizeRelPath('docs/../../etc/passwd')).toBe('');
    expect(normalizeRelPath('..')).toBe('');
  });

  it('rejects absolute paths and Windows drive letters', () => {
    expect(normalizeRelPath('/etc/passwd')).toBe('');
    expect(normalizeRelPath('C:\\Windows\\system32')).toBe('');
  });

  it('rejects non-strings and blanks', () => {
    expect(normalizeRelPath(undefined)).toBe('');
    expect(normalizeRelPath(42)).toBe('');
    expect(normalizeRelPath('   ')).toBe('');
  });
});

describe('parseRiskFindings — untrusted model-output boundary', () => {
  it('returns [] for absent, empty, or non-string input', () => {
    expect(parseRiskFindings(undefined)).toEqual([]);
    expect(parseRiskFindings('')).toEqual([]);
    expect(parseRiskFindings(42)).toEqual([]);
    expect(parseRiskFindings({ findings: [] })).toEqual([]);
  });

  it('returns [] when the response contains no JSON at all', () => {
    expect(parseRiskFindings('I reviewed the workspace and found nothing of concern.')).toEqual([]);
  });

  it('never throws on malformed JSON', () => {
    expect(() => parseRiskFindings('```json\n{ not valid json ,,, ```')).not.toThrow();
    expect(parseRiskFindings('```json\n{ not valid json ,,,\n```')).toEqual([]);
  });

  it('extracts a fenced JSON array surrounded by prose', () => {
    const response = 'Here is what I found.\n\n```json\n[{"domain":"legal","title":"A"}]\n```\n\nLet me know.';
    expect(parseRiskFindings(response)).toEqual([{ domain: 'legal', title: 'A' }]);
  });

  it('extracts a fenced object that wraps a findings array', () => {
    const response = '```json\n{"findings":[{"domain":"ethics","title":"B"}]}\n```';
    expect(parseRiskFindings(response)).toEqual([{ domain: 'ethics', title: 'B' }]);
  });

  it('extracts bare JSON with no code fence', () => {
    expect(parseRiskFindings('Findings: [{"domain":"commercial","title":"C"}]')).toEqual([
      { domain: 'commercial', title: 'C' },
    ]);
  });

  it('skips an unparseable fence and uses the next usable candidate', () => {
    const response = '```\nnot json\n```\n```json\n[{"domain":"legal","title":"D"}]\n```';
    expect(parseRiskFindings(response)).toEqual([{ domain: 'legal', title: 'D' }]);
  });
});

describe('sanitizeRiskFindings — clamps and coerces model output', () => {
  it('returns [] for non-arrays', () => {
    expect(sanitizeRiskFindings(undefined)).toEqual([]);
    expect(sanitizeRiskFindings({})).toEqual([]);
  });

  it('drops entries with no usable domain or title', () => {
    const clean = sanitizeRiskFindings([
      { domain: 'legal', title: 'Keeps this' },
      { domain: 'astrology', title: 'Unknown domain' },
      { domain: 'legal' },
      null,
      'nonsense',
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0]!.title).toBe('Keeps this');
  });

  it('coerces unknown enums to safe defaults', () => {
    const [finding] = sanitizeRiskFindings([
      { domain: 'legal', title: 'X', likelihood: 'catastrophic', impact: '', confidence: 'certain', status: 'resolved' },
    ]);
    expect(finding!.likelihood).toBe('medium');
    expect(finding!.impact).toBe('medium');
    // An unlabelled claim has not earned trust, and a finding is never silently resolved.
    expect(finding!.confidence).toBe('low');
    expect(finding!.status).toBe('open');
  });

  it('rejects path-unsafe evidence but keeps safe entries', () => {
    const [finding] = sanitizeRiskFindings([
      { domain: 'legal', title: 'X', evidence: ['LICENSE', '../../etc/passwd', '/etc/shadow', 'docs/terms.md'] },
    ]);
    expect(finding!.evidence).toEqual(['LICENSE', 'docs/terms.md']);
  });

  it('generates collision-safe ids', () => {
    const clean = sanitizeRiskFindings([
      { domain: 'legal', title: 'Same title' },
      { domain: 'legal', title: 'Same title' },
      { domain: 'legal', title: 'Same title' },
    ]);
    const ids = clean.map(finding => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('clamps oversized strings instead of failing', () => {
    const [finding] = sanitizeRiskFindings([
      { domain: 'ethics', title: 'T'.repeat(5000), detail: 'D'.repeat(50_000) },
    ]);
    expect(finding!.title.length).toBeLessThanOrEqual(240);
    expect(finding!.detail.length).toBeLessThanOrEqual(2000);
  });
});

describe('sanitizeRiskOversightConfig — untrusted payload boundary', () => {
  it('returns undefined for a bad top-level shape', () => {
    expect(sanitizeRiskOversightConfig(null)).toBeUndefined();
    expect(sanitizeRiskOversightConfig({ version: 2, findings: [], runs: [] })).toBeUndefined();
    expect(sanitizeRiskOversightConfig({ version: 1, findings: 'nope', runs: [] })).toBeUndefined();
    expect(sanitizeRiskOversightConfig({ version: 1, findings: [] })).toBeUndefined();
  });

  it('accepts a well-formed payload and de-duplicates runs by domain', () => {
    const clean = sanitizeRiskOversightConfig({
      version: 1,
      findings: [{ domain: 'legal', title: 'A' }],
      runs: [
        { domain: 'legal', ranAt: '2026-01-01T00:00:00.000Z', findingCount: 1 },
        { domain: 'legal', ranAt: '2026-02-01T00:00:00.000Z', findingCount: 9 },
        { domain: 'nonsense', ranAt: '2026-02-01T00:00:00.000Z', findingCount: 1 },
      ],
    });
    expect(clean).toBeDefined();
    expect(clean!.findings).toHaveLength(1);
    expect(clean!.runs).toHaveLength(1);
    expect(clean!.runs[0]!.findingCount).toBe(1);
  });

  it('falls back to a valid date when ranAt is unparseable', () => {
    const clean = sanitizeRiskOversightConfig({
      version: 1,
      findings: [],
      runs: [{ domain: 'ethics', ranAt: 'not-a-date', findingCount: 0 }],
    });
    expect(Number.isNaN(Date.parse(clean!.runs[0]!.ranAt))).toBe(false);
  });
});

describe('mergeDomainFindings — re-runs must not undo human decisions', () => {
  it('preserves an accepted status when the advisor reports the finding again', () => {
    const existing = [makeFinding({ status: 'accepted', statusNote: 'Owned by legal', likelihood: 'low' })];
    const incoming = [makeFinding({ likelihood: 'high', detail: 'Refreshed detail' })];
    const merged = mergeDomainFindings(existing, incoming, 'legal');

    expect(merged).toHaveLength(1);
    // Human decision survives, advisor's fresh assessment is taken.
    expect(merged[0]!.status).toBe('accepted');
    expect(merged[0]!.statusNote).toBe('Owned by legal');
    expect(merged[0]!.likelihood).toBe('high');
    expect(merged[0]!.detail).toBe('Refreshed detail');
  });

  it('appends genuinely new findings', () => {
    const merged = mergeDomainFindings(
      [makeFinding({ title: 'First' })],
      [makeFinding({ title: 'Second' })],
      'legal',
    );
    expect(merged.map(finding => finding.title)).toEqual(['First', 'Second']);
  });

  it('keeps findings the advisor no longer reports', () => {
    const merged = mergeDomainFindings([makeFinding({ title: 'Previously raised' })], [], 'legal');
    expect(merged).toHaveLength(1);
  });

  it('ignores incoming findings from a different domain', () => {
    const merged = mergeDomainFindings([], [makeFinding({ domain: 'ethics', title: 'Other' })], 'legal');
    expect(merged).toHaveLength(0);
  });
});

describe('risk derivations', () => {
  it('treats only open findings as live exposure', () => {
    const config: RiskOversightConfig = {
      version: 1,
      runs: [],
      findings: [
        makeFinding({ id: 'a', status: 'open' }),
        makeFinding({ id: 'b', status: 'accepted' }),
        makeFinding({ id: 'c', status: 'mitigated' }),
        makeFinding({ id: 'd', status: 'dismissed' }),
      ],
    };
    expect(openFindings(config).map(finding => finding.id)).toEqual(['a']);
  });

  it('reports not-yet-assessed until a run or a finding exists', () => {
    expect(hasBeenAssessed(undefined)).toBe(false);
    expect(hasBeenAssessed(seedRiskOversightConfig())).toBe(false);
    expect(hasBeenAssessed({ version: 1, findings: [], runs: [{ domain: 'legal', ranAt: 'x', findingCount: 0 }] })).toBe(true);
  });

  it('weights a finding by likelihood x impact, discounted by confidence', () => {
    expect(findingWeight(makeFinding({ likelihood: 'high', impact: 'high', confidence: 'high' }))).toBe(9);
    expect(findingWeight(makeFinding({ likelihood: 'low', impact: 'low', confidence: 'high' }))).toBe(1);
    // A low-confidence claim carries half the weight of the same high-confidence one.
    expect(findingWeight(makeFinding({ likelihood: 'high', impact: 'high', confidence: 'low' }))).toBe(4.5);
  });

  it('counts findings per matrix cell', () => {
    const counts = riskMatrixCounts([
      makeFinding({ likelihood: 'high', impact: 'high' }),
      makeFinding({ likelihood: 'high', impact: 'high' }),
      makeFinding({ likelihood: 'low', impact: 'medium' }),
    ]);
    expect(counts['high:high']).toBe(2);
    expect(counts['low:medium']).toBe(1);
    expect(counts['low:low']).toBeUndefined();
  });
});

describe('renderRiskOversightMarkdown', () => {
  it('states the not-professional-advice boundary', () => {
    const md = renderRiskOversightMarkdown(seedRiskOversightConfig());
    expect(md).toContain('advisory only and are not professional advice');
    expect(md).toContain('qualified review');
  });

  it('says nothing here blocks a release', () => {
    const md = renderRiskOversightMarkdown(seedRiskOversightConfig());
    expect(md).toContain('Nothing here blocks a commit, a promotion, or a release');
  });

  it('discloses the history cap rather than truncating silently', () => {
    const md = renderRiskOversightMarkdown(seedRiskOversightConfig());
    expect(md).toContain(String(MAX_RISK_HISTORY));
    expect(md).toContain('is complete and is not truncated');
  });

  it('renders the expected sections and an empty state', () => {
    const md = renderRiskOversightMarkdown(seedRiskOversightConfig());
    expect(md).toContain('# Risk Oversight');
    expect(md).toContain('## Last analysed');
    expect(md).toContain('## Open findings (0)');
    expect(md).toContain('_No oversight analysis has been run yet._');
    expect(md).toContain('_No findings recorded._');
  });

  it('lists open findings under their domain with evidence', () => {
    const md = renderRiskOversightMarkdown({
      version: 1,
      runs: [{ domain: 'legal', ranAt: '2026-03-04T00:00:00.000Z', findingCount: 1 }],
      findings: [makeFinding({ title: 'GPL dependency', evidence: ['package.json'], recommendation: 'Ask counsel' })],
    });
    expect(md).toContain('## Open findings (1)');
    expect(md).toContain('### Legal');
    expect(md).toContain('**GPL dependency**');
    expect(md).toContain('`package.json`');
    expect(md).toContain('Recommended: Ask counsel');
    expect(md).toContain('2026-03-04');
  });

  it('separates resolved findings and records the human note', () => {
    const md = renderRiskOversightMarkdown({
      version: 1,
      runs: [],
      findings: [makeFinding({ status: 'accepted', statusNote: 'Risk owned by the board' })],
    });
    expect(md).toContain('## Resolved and accepted (1)');
    expect(md).toContain('Accepted (consciously owned)');
    expect(md).toContain('Risk owned by the board');
    expect(md).toContain('_No open findings —');
  });
});
