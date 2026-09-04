import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPLIANCE_CONTROL_CATALOG, complianceControl } from '../../src/core/complianceControlCatalog.ts';
import {
  COMPLIANCE_DIR,
  COMPLIANCE_EVIDENCE_SSOT_PATH,
  COMPLIANCE_EVIDENCE_SUMMARY_PATH,
  MAX_COMPLIANCE_HISTORY,
  appendComplianceHistory,
  complianceNotesExist,
  complianceNotesTemplate,
  complianceRegimeNotesPath,
  complianceRegimePath,
  complianceRegimeSummaryPath,
  currentEvidenceFor,
  emptyEvidenceLibrary,
  evidenceById,
  evidenceUsage,
  orphanedEvidence,
  readComplianceEvidenceFile,
  readComplianceHistory,
  readComplianceNotes,
  readComplianceRegimeFile,
  renderComplianceEvidenceMarkdown,
  sanitizeComplianceEvidenceLibrary,
  sanitizeComplianceRegimeRegister,
  seedComplianceRegister,
  writeComplianceEvidenceLibrary,
  type ComplianceEvidence,
  type ComplianceHistoryEntry,
} from '../../src/core/complianceEvidenceRegister.ts';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const CATALOG = COMPLIANCE_CONTROL_CATALOG.soc2;

function workspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-compliance-'));
  mkdirSync(path.join(root, COMPLIANCE_DIR), { recursive: true });
  return root;
}

function evidence(overrides: Partial<ComplianceEvidence> = {}): ComplianceEvidence {
  return {
    id: 'ev-1',
    kind: 'attestation',
    title: 'A record',
    locator: { kind: 'url', url: 'https://example.com/doc', host: 'example.com' },
    assertedBy: { contactId: 'person-1', source: 'human', at: '2026-08-01T00:00:00.000Z' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('paths', () => {
  it('keeps the register, its mirror and the notes file apart', () => {
    expect(complianceRegimePath('soc2')).toBe(`${COMPLIANCE_DIR}/soc2.json`);
    expect(complianceRegimeSummaryPath('soc2')).toBe(`${COMPLIANCE_DIR}/soc2.md`);
    expect(complianceRegimeNotesPath('soc2')).toBe(`${COMPLIANCE_DIR}/soc2-user-edit.md`);
  });

  it('gives each regime its own file so one corrupt register cannot lose another', () => {
    expect(complianceRegimePath('iso-27001')).not.toBe(complianceRegimePath('soc2'));
  });
});

describe('reads never throw and never invent a document', () => {
  it('returns nothing for a workspace with no register at all', () => {
    const root = workspace();
    expect(readComplianceEvidenceFile(root).config).toBeUndefined();
    expect(readComplianceRegimeFile(root, 'soc2').config).toBeUndefined();
    expect(readComplianceHistory(root)).toEqual([]);
    expect(readComplianceNotes(root, 'soc2')).toBeUndefined();
    expect(complianceNotesExist(root, 'soc2')).toBe(false);
  });

  it('survives unparseable JSON rather than failing the page', () => {
    const root = workspace();
    writeFileSync(path.join(root, COMPLIANCE_EVIDENCE_SSOT_PATH), '{ not json', 'utf8');
    writeFileSync(path.join(root, complianceRegimePath('soc2')), 'nonsense', 'utf8');
    expect(readComplianceEvidenceFile(root).config).toBeUndefined();
    expect(readComplianceRegimeFile(root, 'soc2').config).toBeUndefined();
  });

  it('refuses a register written by a newer build rather than seeding over it', () => {
    // Overwriting an assessor-visible audit record with a build that could not
    // read it is not an inconvenience; it is a compliance incident with a git
    // commit attached.
    const root = workspace();
    writeFileSync(
      path.join(root, complianceRegimePath('soc2')),
      JSON.stringify({ version: 99, regimeId: 'soc2', controls: [] }),
      'utf8',
    );
    const read = readComplianceRegimeFile(root, 'soc2');
    expect(read.preserveExisting).toBe(true);
    expect(read.notice).toBeTruthy();
  });
});

describe('writing the evidence library', () => {
  it('writes the JSON and its mirror together', () => {
    const root = workspace();
    const library = sanitizeComplianceEvidenceLibrary(
      { version: 1, evidence: [evidence()] },
      NOW,
    );
    writeComplianceEvidenceLibrary(root, library, [], NOW);

    expect(existsSync(path.join(root, COMPLIANCE_EVIDENCE_SSOT_PATH))).toBe(true);
    const mirror = readFileSync(path.join(root, COMPLIANCE_EVIDENCE_SUMMARY_PATH), 'utf8');
    expect(mirror).toContain('A record');
    expect(mirror).toContain('never copies an artifact');
  });

  it('reads back what it wrote', () => {
    const root = workspace();
    const library = sanitizeComplianceEvidenceLibrary({ version: 1, evidence: [evidence()] }, NOW);
    writeComplianceEvidenceLibrary(root, library, [], NOW);
    const back = readComplianceEvidenceFile(root);
    expect(back.config?.evidence[0]!.title).toBe('A record');
  });

  it('says nothing has been recorded rather than rendering an empty table', () => {
    const mirror = renderComplianceEvidenceMarkdown(emptyEvidenceLibrary(NOW), [], NOW);
    expect(mirror).toContain('No evidence has been recorded yet');
  });

  it('retains retired records and says why they are kept', () => {
    const library = sanitizeComplianceEvidenceLibrary({
      version: 1,
      evidence: [evidence({ id: 'ev-old', retiredAt: '2026-05-01T00:00:00.000Z', retiredNote: 'Superseded' })],
    }, NOW);
    const mirror = renderComplianceEvidenceMarkdown(library, [], NOW);
    expect(mirror).toContain('Retired');
    expect(mirror).toContain('Superseded');
    expect(mirror).toContain('an assessor may ask about that period');
  });

  it('marks an expired record in the mirror rather than showing a bare date', () => {
    const library = sanitizeComplianceEvidenceLibrary({
      version: 1,
      evidence: [evidence({ validUntil: '2026-01-01T00:00:00.000Z' })],
    }, NOW);
    expect(renderComplianceEvidenceMarkdown(library, [], NOW)).toContain('(expired)');
  });
});

describe('history', () => {
  const entry = (id: string): ComplianceHistoryEntry => ({
    id,
    kind: 'status-set',
    summary: `Set ${id}`,
    at: NOW.toISOString(),
  });

  it('appends newest first', () => {
    const root = workspace();
    appendComplianceHistory(root, entry('a'));
    appendComplianceHistory(root, entry('b'));
    expect(readComplianceHistory(root).map(e => e.id)).toEqual(['b', 'a']);
  });

  it('caps rather than growing without bound, and the mirror states the cap', () => {
    const root = workspace();
    for (let i = 0; i < 5; i += 1) {
      appendComplianceHistory(root, entry(`e${i}`));
    }
    expect(readComplianceHistory(root).length).toBeLessThanOrEqual(MAX_COMPLIANCE_HISTORY);
    expect(renderComplianceEvidenceMarkdown(emptyEvidenceLibrary(NOW), [], NOW))
      .toContain(String(MAX_COMPLIANCE_HISTORY));
  });
});

describe('one record, many controls', () => {
  /**
   * The reason the evidence library is a separate file. One SOC 2 report
   * evidences ISO A.5.19, SOC 2 CC9.2 and HIPAA 164.308(b); held inside each
   * regime its expiry would be three facts that can disagree, and renewing it
   * would be three edits.
   */
  const library = sanitizeComplianceEvidenceLibrary({
    version: 1,
    evidence: [evidence({ id: 'ev-shared' }), evidence({ id: 'ev-lonely' })],
  }, NOW);

  const first = CATALOG.controls[0]!.ref;
  const second = CATALOG.controls[1]!.ref;
  const seeded = seedComplianceRegister(CATALOG, NOW);
  const register = {
    ...seeded,
    controls: seeded.controls.map(c =>
      c.ref === first || c.ref === second ? { ...c, evidenceIds: ['ev-shared'] } : c),
  };

  it('reports every control a record is doing work for', () => {
    const usage = evidenceUsage('ev-shared', [register]);
    expect(usage.map(u => u.controlRef).sort()).toEqual([first, second].sort());
    expect(usage.every(u => u.regimeId === 'soc2')).toBe(true);
  });

  it('reports a record nothing references as orphaned', () => {
    const orphans = orphanedEvidence(library, [register]).map(e => e.id);
    expect(orphans).toEqual(['ev-lonely']);
  });

  it('indexes the library by id, skipping nothing live', () => {
    expect([...evidenceById(library).keys()].sort()).toEqual(['ev-lonely', 'ev-shared']);
  });
});

describe('currentEvidenceFor applies the control period, not just the stated expiry', () => {
  const target = CATALOG.controls.find(c => c.accepts.includes('attestation'))!.ref;

  function forAssertedAt(at: string): number {
    const library = sanitizeComplianceEvidenceLibrary({
      version: 1,
      evidence: [evidence({ id: 'ev-dated', assertedBy: { contactId: 'p', source: 'human', at } })],
    }, NOW);
    const seeded = seedComplianceRegister(CATALOG, NOW);
    const register = {
      ...seeded,
      scope: {
        statement: 'all',
        exclusions: [],
        decidedBy: { contactId: 'p', source: 'human' as const, at: '2026-07-01T00:00:00.000Z' },
        decidedAt: '2026-07-01T00:00:00.000Z',
      },
      controls: seeded.controls.map(c => (c.ref === target ? { ...c, evidenceIds: ['ev-dated'] } : c)),
    };
    return currentEvidenceFor(register, target, library, NOW).length;
  }

  it('counts a recent record', () => {
    expect(forAssertedAt('2026-08-01T00:00:00.000Z')).toBe(1);
  });

  it('drops one older than the period the control allows, with no stated expiry', () => {
    // No `validUntil` at all — "no stated expiry" is not the same as current.
    expect(forAssertedAt('2023-08-01T00:00:00.000Z')).toBe(0);
  });

  it('reports nothing for a control the regime does not declare', () => {
    const seeded = seedComplianceRegister(CATALOG, NOW);
    expect(currentEvidenceFor(seeded, 'NOT-A-REF', emptyEvidenceLibrary(NOW), NOW)).toEqual([]);
  });
});

describe('the notes file is created once and never rewritten', () => {
  it('offers a template that explains it carries prose, never decisions', () => {
    const template = complianceNotesTemplate(CATALOG);
    expect(template).toContain('It carries prose, never decisions');
    expect(template).toContain('## Context');
    expect(template).toContain('## Assessor narrative');
    expect(template).toContain('## Remediation plan');
    // It names a real control of this regime as the per-control example.
    expect(complianceControl(CATALOG, CATALOG.controls[0]!.ref)).toBeDefined();
    expect(template).toContain(`### ${CATALOG.controls[0]!.ref}`);
  });

  it('is read back verbatim when a person has written one', () => {
    const root = workspace();
    writeFileSync(
      path.join(root, complianceRegimeNotesPath('soc2')),
      '## Context\n\nWe are a UK-only processor.\n',
      'utf8',
    );
    expect(complianceNotesExist(root, 'soc2')).toBe(true);
    expect(readComplianceNotes(root, 'soc2')).toContain('UK-only processor');
  });

  it('is untouched by a register write', () => {
    const root = workspace();
    const notes = path.join(root, complianceRegimeNotesPath('soc2'));
    writeFileSync(notes, '## Context\n\nMine.\n', 'utf8');
    writeComplianceEvidenceLibrary(root, emptyEvidenceLibrary(NOW), [], NOW);
    expect(readFileSync(notes, 'utf8')).toContain('Mine.');
  });
});

describe('a register on disk is graded by the invariants, not by what it claims', () => {
  it('reads a hand-written satisfied row with no asserter as not assessed', () => {
    const root = workspace();
    const first = CATALOG.controls[0]!.ref;
    writeFileSync(path.join(root, complianceRegimePath('soc2')), JSON.stringify({
      version: 1,
      regimeId: 'soc2',
      scope: {
        statement: 'all',
        exclusions: [],
        decidedBy: { contactId: 'p', source: 'human', at: '2026-07-01T00:00:00.000Z' },
        decidedAt: '2026-07-01T00:00:00.000Z',
      },
      controls: [{ ref: first, requirement: 'r', status: 'satisfied', evidenceIds: [], transitions: [] }],
      reviews: [],
    }), 'utf8');

    const stored = readComplianceRegimeFile(root, 'soc2').config;
    const { register, demotions } = sanitizeComplianceRegimeRegister(
      stored, 'soc2', emptyEvidenceLibrary(NOW), NOW,
    );
    expect(register.controls.find(c => c.ref === first)!.status).toBe('not-assessed');
    expect(demotions).toHaveLength(1);
  });
});
