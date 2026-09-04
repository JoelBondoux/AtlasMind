import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_CONTROL_CATALOG,
  complianceRegimeIds,
  requiresIndependence,
} from '../../src/core/complianceControlCatalog.ts';
import {
  absorbComplianceNotes,
  emptyEvidenceLibrary,
  evidenceFreshness,
  isEvidenceLive,
  isVerifiableLocator,
  normalizeRelPath,
  renderComplianceRegimeMarkdown,
  sanitizeComplianceEvidenceLibrary,
  sanitizeComplianceLocator,
  sanitizeComplianceRegimeRegister,
  seedComplianceRegister,
  hasBeenAssessed,
  hasScopeDecision,
  type ComplianceEvidenceLibrary,
} from '../../src/core/complianceEvidenceRegister.ts';
import { COMPLIANCE_DISCLAIMER } from '../../src/core/complianceReadiness.ts';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const CATALOG = COMPLIANCE_CONTROL_CATALOG['iso-27001'];

function libraryWith(id: string, kind: 'attestation' | 'independent' | 'artifact' = 'attestation'): ComplianceEvidenceLibrary {
  return sanitizeComplianceEvidenceLibrary({
    version: 1,
    evidence: [{
      id,
      kind,
      title: 'A record',
      locator: { kind: 'url', url: 'https://example.com/doc' },
      assertedBy: { contactId: 'person-1', source: 'human', at: '2026-08-01T00:00:00.000Z' },
    }],
    updatedAt: NOW.toISOString(),
  }, NOW);
}

function scopedRegister(controls: unknown[]): unknown {
  return {
    version: 1,
    regimeId: 'iso-27001',
    regime: CATALOG.regime,
    scope: {
      statement: 'Everything is in scope.',
      exclusions: [],
      decidedBy: { contactId: 'person-1', source: 'human', at: '2026-07-01T00:00:00.000Z' },
      decidedAt: '2026-07-01T00:00:00.000Z',
    },
    controls,
    reviews: [],
    updatedAt: NOW.toISOString(),
  };
}

describe('normalizeRelPath — the path safety boundary', () => {
  it('accepts a workspace-relative path', () => {
    expect(normalizeRelPath('docs/policy.md')).toBe('docs/policy.md');
  });

  it('rejects parent traversal', () => {
    expect(normalizeRelPath('../secrets.pdf')).toBe('');
    expect(normalizeRelPath('docs/../../etc/passwd')).toBe('');
    expect(normalizeRelPath('..')).toBe('');
  });

  it('rejects absolute paths and Windows drive letters', () => {
    // Machine-specific, committed to every clone, and on Windows it carries the
    // user's account name — a personal identifier through a side door.
    expect(normalizeRelPath('/etc/passwd')).toBe('');
    expect(normalizeRelPath('C:\\Compliance\\iso.pdf')).toBe('');
  });

  it('rejects non-strings and blanks', () => {
    expect(normalizeRelPath(undefined)).toBe('');
    expect(normalizeRelPath(42)).toBe('');
    expect(normalizeRelPath('   ')).toBe('');
  });
});

describe('sanitizeComplianceLocator — three honest forms and nothing else', () => {
  it('accepts https and derives the host', () => {
    const locator = sanitizeComplianceLocator({ kind: 'url', url: 'https://vanta.com/reports/soc2' });
    expect(locator).toEqual({ kind: 'url', url: 'https://vanta.com/reports/soc2', host: 'vanta.com' });
  });

  it('refuses plaintext http with no fallback', () => {
    expect(sanitizeComplianceLocator({ kind: 'url', url: 'http://vanta.com/x' })).toBeUndefined();
  });

  it('strips the query and fragment, which usually carry a token', () => {
    const locator = sanitizeComplianceLocator({
      kind: 'url',
      url: 'https://s3.example.com/report.pdf?X-Amz-Signature=deadbeef#page=4',
    });
    expect(locator).toEqual({ kind: 'url', url: 'https://s3.example.com/report.pdf', host: 's3.example.com' });
  });

  it('drops a URL carrying credentials rather than stripping them', () => {
    // A nearly-valid locator made plausible is worse than a missing one.
    expect(sanitizeComplianceLocator({ kind: 'url', url: 'https://u:p@vanta.com/x' })).toBeUndefined();
  });

  it('refuses loopback but allows an internal hostname', () => {
    expect(sanitizeComplianceLocator({ kind: 'url', url: 'https://localhost/x' })).toBeUndefined();
    expect(sanitizeComplianceLocator({ kind: 'url', url: 'https://127.0.0.1/x' })).toBeUndefined();
    expect(sanitizeComplianceLocator({ kind: 'url', url: 'https://intranet.corp/x' })?.kind).toBe('url');
  });

  it('drops an unparseable URL rather than repairing it into something plausible', () => {
    expect(sanitizeComplianceLocator({ kind: 'url', url: 'not a url' })).toBeUndefined();
  });

  it('accepts a described location as a first-class answer', () => {
    const locator = sanitizeComplianceLocator({
      kind: 'described',
      where: 'Held in Vanta; ask the security lead.',
    });
    expect(locator).toEqual({ kind: 'described', where: 'Held in Vanta; ask the security lead.' });
    expect(isVerifiableLocator(locator!)).toBe(false);
  });

  it('refuses an absolute path offered as a workspace file', () => {
    expect(sanitizeComplianceLocator({ kind: 'workspace-file', path: 'C:\\x\\iso.pdf' })).toBeUndefined();
  });
});

describe('the invariants are re-enforced on read', () => {
  const target = CATALOG.controls.find(c => !requiresIndependence(c))!.ref;

  function readBack(controlOverrides: Record<string, unknown>, library = libraryWith('ev-1')) {
    return sanitizeComplianceRegimeRegister(
      scopedRegister([{ ref: target, requirement: 'r', evidenceIds: [], transitions: [], ...controlOverrides }]),
      'iso-27001',
      library,
      NOW,
    );
  }

  it('demotes a status whose every evidence reference is missing from the library', () => {
    const { register, demotions } = readBack({
      status: 'satisfied',
      evidenceIds: ['ev-does-not-exist'],
      assertedBy: { contactId: 'person-1', source: 'human', at: '2026-08-01T00:00:00.000Z' },
    });
    expect(register.controls.find(c => c.ref === target)!.status).toBe('not-assessed');
    expect(demotions[0]!.rule).toBe('evidence-reference-missing');
  });

  it('demotes a status with no asserter and date', () => {
    const { register, demotions } = readBack({ status: 'satisfied', evidenceIds: ['ev-1'] });
    expect(register.controls.find(c => c.ref === target)!.status).toBe('not-assessed');
    expect(demotions[0]!.rule).toBe('status-unattributed');
  });

  /**
   * The single most important assertion in this suite.
   *
   * AtlasMind may draft narrative. It may never assert that a control is met.
   * The refusal is structural — a `source` other than `human` cannot carry a
   * status — rather than a check on wording, which a model could satisfy.
   */
  it('refuses a status asserted by a model draft rather than a person', () => {
    const { register, demotions } = readBack({
      status: 'satisfied',
      evidenceIds: ['ev-1'],
      assertedBy: { contactId: 'person-1', source: 'atlas-draft', at: '2026-08-01T00:00:00.000Z' },
    });
    expect(register.controls.find(c => c.ref === target)!.status).toBe('not-assessed');
    expect(demotions[0]!.rule).toBe('status-not-human-attributed');
  });

  it('demotes a not-applicable with no written justification', () => {
    const { register, demotions } = readBack({
      status: 'not-applicable',
      assertedBy: { contactId: 'person-1', source: 'human', at: '2026-08-01T00:00:00.000Z' },
    });
    expect(register.controls.find(c => c.ref === target)!.status).toBe('not-assessed');
    expect(demotions[0]!.rule).toBe('exclusion-unjustified');
  });

  it('reads every control as not assessed while no scope decision exists', () => {
    const { register, demotions } = sanitizeComplianceRegimeRegister(
      {
        version: 1,
        regimeId: 'iso-27001',
        scope: { exclusions: [] },
        controls: CATALOG.controls.map(c => ({
          ref: c.ref,
          requirement: c.requirement,
          status: 'satisfied',
          evidenceIds: ['ev-1'],
          assertedBy: { contactId: 'person-1', source: 'human', at: '2026-08-01T00:00:00.000Z' },
          transitions: [],
        })),
        reviews: [],
      },
      'iso-27001',
      libraryWith('ev-1'),
      NOW,
    );
    expect(register.controls.every(c => c.status === 'not-assessed')).toBe(true);
    expect(demotions.every(d => d.rule === 'scope-not-decided')).toBe(true);
  });

  it('reports a control the regime does not declare rather than importing it', () => {
    const { register, demotions } = sanitizeComplianceRegimeRegister(
      scopedRegister([{ ref: 'A.9.2.3', requirement: 'from the 2013 edition', status: 'satisfied', evidenceIds: [], transitions: [] }]),
      'iso-27001',
      libraryWith('ev-1'),
      NOW,
    );
    expect(register.controls.some(c => c.ref === 'A.9.2.3')).toBe(false);
    expect(demotions[0]!.rule).toBe('control-not-in-catalog');
  });

  it('keeps the previous wording on the control so nothing is lost, only re-labelled', () => {
    const { register } = readBack({
      status: 'satisfied',
      evidenceIds: ['ev-1'],
      note: 'We did this in March.',
    });
    expect(register.controls.find(c => c.ref === target)!.note).toBe('We did this in March.');
  });

  it('refuses a scope decision that names no person', () => {
    const { register } = sanitizeComplianceRegimeRegister(
      {
        version: 1,
        regimeId: 'iso-27001',
        scope: { statement: 'Everything', exclusions: [], decidedAt: '2026-07-01T00:00:00.000Z' },
        controls: [],
        reviews: [],
      },
      'iso-27001',
      emptyEvidenceLibrary(NOW),
      NOW,
    );
    expect(hasScopeDecision(register)).toBe(false);
  });
});

describe('the evidence library boundary', () => {
  it('drops a record with no usable locator rather than keeping a locator-less one', () => {
    const library = sanitizeComplianceEvidenceLibrary({
      version: 1,
      evidence: [{
        id: 'ev-bad',
        kind: 'independent',
        title: 'A certificate',
        locator: { kind: 'url', url: 'http://insecure.example.com/x' },
        assertedBy: { contactId: 'p', source: 'human', at: '2026-08-01T00:00:00.000Z' },
      }],
    }, NOW);
    expect(library.evidence).toHaveLength(0);
  });

  it('coerces an unreadable kind to the one that claims least', () => {
    const library = sanitizeComplianceEvidenceLibrary({
      version: 1,
      evidence: [{
        id: 'ev-x',
        kind: 'certified-by-somebody',
        title: 'A record',
        locator: { kind: 'described', where: 'somewhere' },
        assertedBy: { contactId: 'p', source: 'human', at: '2026-08-01T00:00:00.000Z' },
      }],
    }, NOW);
    // Never `independent` — that would manufacture assurance from a bad field.
    expect(library.evidence[0]!.kind).toBe('attestation');
  });

  it('never throws on hostile input', () => {
    expect(() => sanitizeComplianceEvidenceLibrary(null, NOW)).not.toThrow();
    expect(() => sanitizeComplianceEvidenceLibrary('nonsense', NOW)).not.toThrow();
    expect(() => sanitizeComplianceEvidenceLibrary({ evidence: 'not an array' }, NOW)).not.toThrow();
  });

  it('gives unique ids to records that collide', () => {
    const library = sanitizeComplianceEvidenceLibrary({
      version: 1,
      evidence: [1, 2].map(() => ({
        id: 'ev-same',
        kind: 'attestation',
        title: 'A record',
        locator: { kind: 'described', where: 'somewhere' },
        assertedBy: { contactId: 'p', source: 'human', at: '2026-08-01T00:00:00.000Z' },
      })),
    }, NOW);
    expect(new Set(library.evidence.map(e => e.id)).size).toBe(2);
  });
});

describe('freshness is derived, never stored', () => {
  const base = libraryWith('ev-1').evidence[0]!;

  it('reads no stated expiry apart from current', () => {
    expect(evidenceFreshness(base, NOW)).toBe('no-expiry');
  });

  it('reads a date inside the horizon as expiring, and past it as lapsed', () => {
    expect(evidenceFreshness({ ...base, validUntil: '2026-10-01T00:00:00.000Z' }, NOW)).toBe('expiring');
    expect(evidenceFreshness({ ...base, validUntil: '2026-08-01T00:00:00.000Z' }, NOW)).toBe('expired');
    expect(evidenceFreshness({ ...base, validUntil: '2028-01-01T00:00:00.000Z' }, NOW)).toBe('current');
  });

  it('treats a retired record as not live whatever its dates say', () => {
    expect(isEvidenceLive({ ...base, retiredAt: '2026-08-20T00:00:00.000Z' }, 12, NOW)).toBe(false);
  });
});

describe('the notes file is prose and can never carry a decision', () => {
  it('cannot introduce a control row, and neutralises a pasted table', () => {
    const notes = absorbComplianceNotes(
      ['## Context', '', '| A.5.1 | x | Satisfied | y | z |', ''].join('\n'),
      CATALOG,
    );
    const context = notes.sections.get('context')!;
    expect(context.startsWith('\\|')).toBe(true);
    expect(notes.perControl.size).toBe(0);
  });

  it('places a note beside the control it names', () => {
    const notes = absorbComplianceNotes(
      ['### A.7.9', '', 'No premises of our own — everyone is remote.'].join('\n'),
      CATALOG,
    );
    expect(notes.perControl.get('A.7.9')).toContain('No premises of our own');
  });

  it('keeps an unmatched heading rather than dropping somebody’s prose', () => {
    const notes = absorbComplianceNotes(
      ['## Something Else', '', 'Worth saying anyway.'].join('\n'),
      CATALOG,
    );
    expect(notes.sections.size).toBe(0);
    expect(notes.unmatched).toHaveLength(1);
    expect(notes.unmatched[0]!.body).toContain('Worth saying anyway');
    expect(notes.unmatched[0]!.why).toContain('not one of the sections');
  });

  it('reports a heading naming a control this regime does not declare', () => {
    const notes = absorbComplianceNotes(['### CC6.1', '', 'Wrong regime.'].join('\n'), CATALOG);
    expect(notes.unmatched[0]!.why).toContain('not a control this regime declares');
  });

  it('absorbs nothing when there is no notes file', () => {
    const notes = absorbComplianceNotes(undefined, CATALOG);
    expect(notes.sections.size).toBe(0);
    expect(notes.perControl.size).toBe(0);
    expect(notes.unmatched).toHaveLength(0);
  });
});

describe('the seeded register and its mirror', () => {
  it('seeds every control not assessed, with no scope decision', () => {
    const register = seedComplianceRegister(CATALOG, NOW);
    expect(register.controls).toHaveLength(CATALOG.controls.length);
    expect(register.controls.every(c => c.status === 'not-assessed')).toBe(true);
    expect(hasScopeDecision(register)).toBe(false);
    expect(hasBeenAssessed(register)).toBe(false);
  });

  it('renders a mirror that states the disclaimer and the scope gate', () => {
    const markdown = renderComplianceRegimeMarkdown(
      seedComplianceRegister(CATALOG, NOW),
      emptyEvidenceLibrary(NOW),
      CATALOG,
      { disclaimer: COMPLIANCE_DISCLAIMER },
      NOW,
    );
    expect(markdown).toContain(COMPLIANCE_DISCLAIMER);
    expect(markdown).toContain('No scope decision is recorded');
    expect(markdown).toContain('Controls only an outside party can close');
    expect(markdown).toContain('-user-edit.md');
  });

  it('names the edition mismatch rather than re-pointing the assessment', () => {
    const register = {
      ...seedComplianceRegister(CATALOG, NOW),
      assessedAgainst: { name: 'ISO/IEC 27001', edition: '2013' },
    };
    const markdown = renderComplianceRegimeMarkdown(
      register,
      emptyEvidenceLibrary(NOW),
      CATALOG,
      {
        disclaimer: COMPLIANCE_DISCLAIMER,
        standard: { name: 'ISO/IEC 27001', edition: '2022', verifiedAt: '2026-06-14T00:00:00.000Z' },
      },
      NOW,
    );
    expect(markdown).toContain('made against ISO/IEC 27001 2013');
    expect(markdown).toContain('have not been re-pointed');
  });
});

describe('every regime can be seeded and read back without loss', () => {
  it('round-trips all twenty-four', () => {
    for (const id of complianceRegimeIds()) {
      const catalog = COMPLIANCE_CONTROL_CATALOG[id];
      const seeded = seedComplianceRegister(catalog, NOW);
      const { register } = sanitizeComplianceRegimeRegister(seeded, id, emptyEvidenceLibrary(NOW), NOW);
      expect(register.controls.map(c => c.ref), id).toEqual(catalog.controls.map(c => c.ref));
    }
  });
});
