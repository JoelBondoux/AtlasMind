import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectRegisterFindings } from '../../src/views/projectDashboardPanel.ts';

/**
 * The mapping from three registers onto one hand-off.
 *
 * `registerHandoff` deliberately does not decide whether a finding is still
 * outstanding, because only the register knows what its own status vocabulary
 * means — an `accepted` risk is a decision somebody took and closed, while an
 * `accepted` debt entry is work somebody agreed to carry. This is where that
 * judgement is actually made, and getting it wrong is silent: the button simply
 * appears on something nobody wanted raised, or fails to appear on something
 * they did.
 */

type Snapshot = Parameters<typeof collectRegisterFindings>[0];

/**
 * A snapshot fragment.
 *
 * Cast once, here, rather than at every call site: `collectRegisterFindings`
 * reads three fields out of a much larger snapshot, and building the whole thing
 * for each case would bury the one difference each test is actually about.
 */
function snapshot(overrides: Record<string, unknown> = {}): Snapshot {
  return {
    gapAnalysis: { completed: true, items: [], lastRun: null },
    debt: { entries: [] },
    risk: { findings: [] },
    ...overrides,
  } as unknown as Snapshot;
}

const gapItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'gap-1',
  priority: 'P2',
  category: 'delivery',
  type: 'gap',
  text: 'No CODEOWNERS file',
  resolved: false,
  source: 'analysis',
  ...overrides,
}) as never;

const debtEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'debt-1',
  domain: 'code',
  title: 'TODO: replace the shim',
  evidencePath: 'src/a.ts',
  evidenceLine: 12,
  detectedAt: '2026-08-01T00:00:00.000Z',
  severity: 'medium',
  rule: 'TODO marker',
  status: 'open',
  transitions: [],
  ...overrides,
}) as never;

const riskFinding = (overrides: Record<string, unknown> = {}) => ({
  id: 'risk-1',
  domain: 'legal',
  title: 'Retention claim unevidenced',
  detail: 'The policy page states 30 days.',
  likelihood: 'medium',
  impact: 'high',
  confidence: 'medium',
  status: 'open',
  evidence: ['docs/privacy.md'],
  raisedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
}) as never;

describe('gap findings', () => {
  it('maps a gap onto the hand-off, keyed the way the webview names it', () => {
    const findings = collectRegisterFindings(snapshot({
      gapAnalysis: { completed: true, items: [gapItem()], lastRun: null },
    }));
    expect(findings.get('gap::gap-1')?.finding).toMatchObject({
      kind: 'gap', id: 'gap-1', category: 'delivery', severity: 'medium',
    });
  });

  it('translates the gap analysis’s own priority words into severity', () => {
    const findings = collectRegisterFindings(snapshot({
      gapAnalysis: {
        completed: true,
        lastRun: null,
        items: [
          gapItem({ id: 'a', priority: 'P1' }),
          gapItem({ id: 'b', priority: 'P2' }),
          gapItem({ id: 'c', priority: 'P3' }),
        ],
      },
    }));
    expect(findings.get('gap::a')?.finding.severity).toBe('high');
    expect(findings.get('gap::b')?.finding.severity).toBe('medium');
    expect(findings.get('gap::c')?.finding.severity).toBe('low');
  });

  it('never treats praise as work', () => {
    // The gap analysis records what it likes as well as what it does not.
    const findings = collectRegisterFindings(snapshot({
      gapAnalysis: { completed: true, lastRun: null, items: [gapItem({ id: 'p', type: 'praise' })] },
    }));
    expect(findings.get('gap::p')?.outstanding).toBe(false);
  });

  it('stops offering a gap somebody marked resolved', () => {
    const findings = collectRegisterFindings(snapshot({
      gapAnalysis: { completed: true, lastRun: null, items: [gapItem({ resolved: true })] },
    }));
    expect(findings.get('gap::gap-1')?.outstanding).toBe(false);
  });
});

describe('debt entries', () => {
  it('carries the evidence and the rule that graded it', () => {
    const findings = collectRegisterFindings(snapshot({ debt: { entries: [debtEntry()] } }));
    expect(findings.get('debt::debt-1')?.finding).toMatchObject({
      kind: 'debt', category: 'code', evidencePath: 'src/a.ts', evidenceLine: 12, rule: 'TODO marker',
    });
  });

  it('treats an accepted or scheduled entry as still outstanding', () => {
    // Accepting debt is agreeing to carry it, not deciding it is gone.
    for (const status of ['open', 'accepted', 'scheduled']) {
      const findings = collectRegisterFindings(snapshot({ debt: { entries: [debtEntry({ status })] } }));
      expect(findings.get('debt::debt-1')?.outstanding, status).toBe(true);
    }
  });

  it('stops offering a resolved or obsolete entry', () => {
    for (const status of ['resolved', 'obsolete']) {
      const findings = collectRegisterFindings(snapshot({ debt: { entries: [debtEntry({ status })] } }));
      expect(findings.get('debt::debt-1')?.outstanding, status).toBe(false);
    }
  });
});

describe('risk findings', () => {
  it('grades on impact and carries the first cited evidence path', () => {
    const findings = collectRegisterFindings(snapshot({ risk: { findings: [riskFinding()] } }));
    expect(findings.get('risk::risk-1')?.finding).toMatchObject({
      kind: 'risk', category: 'legal', severity: 'high', evidencePath: 'docs/privacy.md',
    });
  });

  it('treats an accepted risk as closed, unlike an accepted debt entry', () => {
    // The distinction the shared module refuses to make, made here: accepting a
    // risk is a decision somebody took, and offering to raise work for it would
    // quietly re-open a closed question.
    for (const status of ['accepted', 'mitigated', 'dismissed', 'closed']) {
      const findings = collectRegisterFindings(snapshot({ risk: { findings: [riskFinding({ status })] } }));
      expect(findings.get('risk::risk-1')?.outstanding, status).toBe(false);
    }
    const open = collectRegisterFindings(snapshot({ risk: { findings: [riskFinding({ status: 'open' })] } }));
    expect(open.get('risk::risk-1')?.outstanding).toBe(true);
  });

  it('reports no evidence path rather than an empty one', () => {
    const findings = collectRegisterFindings(snapshot({ risk: { findings: [riskFinding({ evidence: [] })] } }));
    expect(findings.get('risk::risk-1')?.finding).not.toHaveProperty('evidencePath');
  });
});

describe('the three registers share one key space', () => {
  it('keeps ids from different registers apart', () => {
    const findings = collectRegisterFindings(snapshot({
      gapAnalysis: { completed: true, lastRun: null, items: [gapItem({ id: 'same' })] },
      debt: { entries: [debtEntry({ id: 'same' })] },
      risk: { findings: [riskFinding({ id: 'same' })] },
    }));
    expect([...findings.keys()].sort()).toEqual(['debt::same', 'gap::same', 'risk::same']);
  });
});

describe('the webview names a finding and composes nothing', () => {
  const WEBVIEW = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');

  it('sends only the key for both hand-offs', () => {
    const dispatch = WEBVIEW.slice(WEBVIEW.indexOf("action === 'raise-register-work'"));
    expect(dispatch.slice(0, 600)).toContain("type: action === 'raise-register-work' ? 'raiseRegisterWork' : 'draftRegisterIssue'");
    expect(dispatch.slice(0, 600)).toContain("payload: String(payload || '')");
    // No title, no body, no labels — the host derives all of it.
    expect(dispatch.slice(0, 600)).not.toContain('title:');
    expect(dispatch.slice(0, 600)).not.toContain('labels');
  });

  it('offers the same two controls on all three registers', () => {
    for (const kind of ['gap', 'debt', 'risk']) {
      expect(WEBVIEW, `${kind} has no hand-off`).toContain(`renderRegisterHandoff('${kind}'`);
    }
  });

  it('says a finding is already on the roadmap instead of offering to add it twice', () => {
    const handoff = WEBVIEW.slice(WEBVIEW.indexOf('function renderRegisterHandoff'));
    expect(handoff.slice(0, 1600)).toContain('on the roadmap');
    expect(handoff.slice(0, 1600)).toContain('registerRaisedOn');
  });
});

describe('the host side', () => {
  const HOST = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');

  it('resolves a named finding against the snapshot it last published', () => {
    expect(HOST).toContain('private resolveRegisterFinding');
    expect(HOST).toContain('this.registerFindings.get(key)');
  });

  it('shows the exact roadmap line before writing it', () => {
    const raise = HOST.slice(HOST.indexOf('private async handleRaiseRegisterWork'));
    expect(raise.slice(0, 4000)).toContain('modal: true');
    expect(raise.slice(0, 4000)).toContain('derivation.text');
  });

  it('records provenance only after the roadmap write succeeded', () => {
    const raise = HOST.slice(HOST.indexOf('private async handleRaiseRegisterWork'));
    const body = raise.slice(0, 4000);
    expect(body.indexOf('addRoadmapItemFromExternalSurface')).toBeLessThan(body.indexOf('recordRoadmapOrigin'));
  });

  it('refuses to raise the same finding twice', () => {
    const raise = HOST.slice(HOST.indexOf('private async handleRaiseRegisterWork'));
    expect(raise.slice(0, 4000)).toContain('already on the roadmap');
  });

  it('drafts into the composer rather than onto the tracker', () => {
    const draft = HOST.slice(HOST.indexOf('private async handleDraftRegisterIssue'));
    expect(draft.slice(0, 3000)).toContain("type: 'issueDraft'");
    expect(draft.slice(0, 3000)).not.toContain('createIssue');
  });
});
