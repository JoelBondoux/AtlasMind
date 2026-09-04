import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_CONTROL_CATALOG,
  requiresIndependence,
} from '../../src/core/complianceControlCatalog.ts';
import {
  CONTROL_ATTENTION_ORDER,
  QUESTION_RULES,
  buildComplianceSnapshot,
  nextUnassessedControl,
  reachableStatuses,
  type ComplianceSnapshotInput,
} from '../../src/core/complianceDashboard.ts';
import { gradeComplianceRegime } from '../../src/core/complianceReadiness.ts';
import {
  emptyEvidenceLibrary,
  sanitizeComplianceEvidenceLibrary,
  seedComplianceRegister,
  type ComplianceEvidence,
  type ComplianceEvidenceLibrary,
  type ComplianceRegimeRegister,
} from '../../src/core/complianceEvidenceRegister.ts';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const ISO = COMPLIANCE_CONTROL_CATALOG['iso-27001'];

const PATHS: ComplianceSnapshotInput['paths'] = {
  evidence: 'project_memory/operations/compliance/compliance-evidence.json',
  evidenceSummary: 'project_memory/operations/compliance/compliance-evidence.md',
  register: id => `project_memory/operations/compliance/${id}.json`,
  summary: id => `project_memory/operations/compliance/${id}.md`,
  notes: id => `project_memory/operations/compliance/${id}-user-edit.md`,
};

function human(at = '2026-08-01T00:00:00.000Z') {
  return { contactId: 'person-1', source: 'human' as const, at };
}

function library(entries: Partial<ComplianceEvidence>[]): ComplianceEvidenceLibrary {
  return sanitizeComplianceEvidenceLibrary({
    version: 1,
    evidence: entries.map((entry, index) => ({
      id: `ev-${index}`,
      kind: 'attestation',
      title: `Record ${index}`,
      locator: { kind: 'url', url: `https://example.com/${index}` },
      assertedBy: human(),
      ...entry,
    })),
  }, NOW);
}

function scoped(register: ComplianceRegimeRegister): ComplianceRegimeRegister {
  return {
    ...register,
    scope: {
      statement: 'Everything is in scope.',
      exclusions: [],
      decidedBy: human(),
      decidedAt: '2026-07-01T00:00:00.000Z',
    },
  };
}

function snapshot(options: {
  register?: ComplianceRegimeRegister;
  lib?: ComplianceEvidenceLibrary;
} = {}) {
  const lib = options.lib ?? emptyEvidenceLibrary(NOW);
  const registers = new Map(options.register ? [[ISO.policyId, options.register]] : []);
  const reading = gradeComplianceRegime({
    catalog: ISO,
    ...(options.register ? { register: options.register } : {}),
    library: lib,
    now: NOW,
  });
  return buildComplianceSnapshot({
    readings: [reading],
    registers,
    demotions: new Map(),
    library: lib,
    labels: new Map([[ISO.policyId, 'ISO 27001']]),
    notesPresent: new Set(),
    paths: PATHS,
    now: NOW,
  });
}

describe('the page states what has not been done', () => {
  it('reports a regime with no register as unregistered rather than clean', () => {
    const view = snapshot();
    expect(view.regimes[0]!.registered).toBe(false);
    expect(view.regimes[0]!.readinessLabel).toBe('Not examined');
    expect(view.summary).toContain('no register at all');
  });

  it('carries the disclaimer onto the page payload', () => {
    expect(snapshot().disclaimer).toContain('does not and cannot determine compliance');
  });

  it('says nothing is declared rather than showing an empty board', () => {
    const view = buildComplianceSnapshot({
      readings: [],
      registers: new Map(),
      demotions: new Map(),
      library: emptyEvidenceLibrary(NOW),
      labels: new Map(),
      notesPresent: new Set(),
      paths: PATHS,
      now: NOW,
    });
    expect(view.summary).toContain('No governance regime is enabled');
    expect(view.questions).toEqual([]);
  });
});

describe('what an assessor would ask next', () => {
  it('asks for the mapping first when there is none', () => {
    const view = snapshot();
    expect(view.questions[0]!.ruleId).toBe('question-no-register');
    expect(view.questions[0]!.question).toContain('Where is your control mapping?');
  });

  it('asks about scope before anything else once a register exists', () => {
    const view = snapshot({ register: seedComplianceRegister(ISO, NOW) });
    expect(view.questions[0]!.ruleId).toBe('question-unscoped');
  });

  it('leads with lapsed evidence, because a lapsed claim has become false', () => {
    const lib = library([{
      id: 'ev-old',
      title: 'Our certificate',
      kind: 'independent',
      issuer: 'A body',
      validUntil: '2026-01-01T00:00:00.000Z',
    }]);
    const external = ISO.controls.find(control => requiresIndependence(control))!;
    const base = scoped(seedComplianceRegister(ISO, NOW));
    const register: ComplianceRegimeRegister = {
      ...base,
      controls: base.controls.map(control => control.ref === external.ref
        ? { ...control, status: 'satisfied' as const, assertedBy: human(), evidenceIds: ['ev-old'] }
        : control),
    };
    const view = snapshot({ register, lib });
    const expired = view.questions.find(question => question.ruleId === 'question-evidence-expired');
    expect(expired).toBeDefined();
    expect(expired!.question).toContain('expired on 2026-01-01');
  });

  it('names every question rule it can emit', () => {
    const declared = new Set(QUESTION_RULES.map(rule => rule.id));
    for (const question of snapshot({ register: seedComplianceRegister(ISO, NOW) }).questions) {
      expect(declared.has(question.ruleId), question.ruleId).toBe(true);
    }
  });

  it('caps the list rather than listing every unassessed control', () => {
    const view = snapshot({ register: scoped(seedComplianceRegister(ISO, NOW)) });
    expect(view.questions.length).toBeLessThanOrEqual(8);
  });
});

describe('reachable statuses explain the ceiling rather than hiding it', () => {
  const external = ISO.controls.find(control => requiresIndependence(control))!;

  function readingFor(ref: string, register: ComplianceRegimeRegister, lib: ComplianceEvidenceLibrary) {
    return gradeComplianceRegime({ catalog: ISO, register, library: lib, now: NOW })
      .controls.find(control => control.ref === ref)!;
  }

  it('withholds satisfied when nothing is attached, and says so', () => {
    const register = scoped(seedComplianceRegister(ISO, NOW));
    const lib = emptyEvidenceLibrary(NOW);
    const reach = reachableStatuses(readingFor(external.ref, register, lib), []);
    expect(reach.statuses).not.toContain('satisfied');
    expect(reach.ceilingReason).toContain('nothing for a satisfied status to rest on');
  });

  it('withholds satisfied on an attestation for an independence-only control', () => {
    const lib = library([{ id: 'ev-self', kind: 'attestation' }]);
    const register = scoped(seedComplianceRegister(ISO, NOW));
    const reach = reachableStatuses(readingFor(external.ref, register, lib), [lib.evidence[0]!]);
    expect(reach.statuses).not.toContain('satisfied');
    expect(reach.ceilingReason).toContain('outside the project');
  });

  it('offers satisfied once an outside statement is attached', () => {
    const lib = library([{
      id: 'ev-cert',
      kind: 'independent',
      issuer: 'A certification body',
      locator: { kind: 'url', url: 'https://certs.example.com/x', host: 'certs.example.com' },
    }]);
    const register = scoped(seedComplianceRegister(ISO, NOW));
    const reach = reachableStatuses(readingFor(external.ref, register, lib), [lib.evidence[0]!]);
    expect(reach.statuses).toContain('satisfied');
    expect(reach.ceilingReason).toBeUndefined();
  });

  it('withholds satisfied when the only record is a description', () => {
    const lib = library([{
      id: 'ev-drawer',
      kind: 'independent',
      issuer: 'A body',
      locator: { kind: 'described', where: 'In the drawer' },
    }]);
    const register = scoped(seedComplianceRegister(ISO, NOW));
    const reach = reachableStatuses(readingFor(external.ref, register, lib), [lib.evidence[0]!]);
    expect(reach.statuses).not.toContain('satisfied');
    expect(reach.ceilingReason).toContain('not the document');
  });
});

describe('the per-control walk', () => {
  it('goes to a never-assessed control before a failing one', () => {
    // An unexamined control is the one nobody has thought about.
    const next = nextUnassessedControl({
      controls: [{ reading: 'gap', ref: 'B' }, { reading: 'not-assessed', ref: 'A' }],
    });
    expect(next?.ref).toBe('A');
  });

  it('falls through the declared order', () => {
    expect(CONTROL_ATTENTION_ORDER).toEqual(['not-assessed', 'gap', 'expired', 'awaiting-independent']);
    expect(nextUnassessedControl({ controls: [{ reading: 'expired', ref: 'C' }] })?.ref).toBe('C');
  });

  it('returns nothing when every control carries a decision', () => {
    expect(nextUnassessedControl({ controls: [{ reading: 'satisfied-self', ref: 'A' }] })).toBeUndefined();
  });
});

describe('the evidence library view', () => {
  it('puts what has lapsed before what is merely current', () => {
    const lib = library([
      { id: 'ev-fine', title: 'Current' },
      { id: 'ev-dead', title: 'Lapsed', validUntil: '2026-01-01T00:00:00.000Z' },
      { id: 'ev-soon', title: 'Expiring', validUntil: '2026-10-01T00:00:00.000Z' },
    ]);
    const view = snapshot({ lib });
    expect(view.evidence.map(entry => entry.title).slice(0, 2)).toEqual(['Lapsed', 'Expiring']);
    expect(view.expiredCount).toBe(1);
    expect(view.expiringSoonCount).toBe(1);
  });

  it('marks a described record as not producible without dismissing it', () => {
    const lib = library([{ id: 'ev-x', locator: { kind: 'described', where: 'Held in Vanta' } }]);
    const view = snapshot({ lib });
    expect(view.evidence[0]!.verifiable).toBe(false);
    expect(view.evidence[0]!.locatorLabel).toBe('Held in Vanta');
  });

  it('never carries a full URL, only its host', () => {
    const lib = library([{ id: 'ev-u', locator: { kind: 'url', url: 'https://vanta.com/reports/x', host: 'vanta.com' } }]);
    expect(snapshot({ lib }).evidence[0]!.locatorLabel).toBe('vanta.com');
  });

  it('reports a record nothing references as orphaned', () => {
    const lib = library([{ id: 'ev-lonely' }]);
    const view = snapshot({ register: scoped(seedComplianceRegister(ISO, NOW)), lib });
    expect(view.orphanedEvidenceIds).toContain('ev-lonely');
  });
});
