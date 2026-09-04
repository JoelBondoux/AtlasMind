import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPLIANCE_CONTROL_CATALOG } from '../../src/core/complianceControlCatalog.ts';
import {
  describeLegacyImport,
  hasImportableMapping,
  parseLegacyControlMapping,
  planLegacyImport,
} from '../../src/core/complianceMarkdownImport.ts';
import {
  emptyEvidenceLibrary,
  sanitizeComplianceRegimeRegister,
} from '../../src/core/complianceEvidenceRegister.ts';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const ISO = COMPLIANCE_CONTROL_CATALOG['iso-27001'];
const SOC2 = COMPLIANCE_CONTROL_CATALOG.soc2;

/** A mapping in the shape the scaffolder actually wrote. */
function mapping(rows: string[], options: { reviewLog?: string[] } = {}): string {
  return [
    '# ISO/IEC 27001 — control mapping',
    '',
    '## Before this mapping means anything',
    '',
    'Which Annex A controls are applicable, and which are excluded with a stated justification.',
    '',
    '## Controls',
    '',
    'Status is one of: `Not assessed` · `Satisfied` · `Partial` · `Gap` · `Not applicable`.',
    '',
    '### Governance and organisational',
    '',
    '| Ref | Requirement | Status | Evidence | Owner |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## Review log',
    '',
    '| Date | Scope | By |',
    '|---|---|---|',
    ...(options.reviewLog ?? []),
    '',
  ].join('\n');
}

const ROSTER = new Map([['jo', 'contact-jo'], ['sam patel', 'contact-sam']]);

function plan(markdown: string, catalog = ISO) {
  return planLegacyImport({
    markdown,
    catalog,
    library: emptyEvidenceLibrary(NOW),
    rosterByName: ROSTER,
    now: NOW,
  });
}

describe('only control rows are read', () => {
  /**
   * The gate this replaces matched any cell in any table in the document, so
   * typing `Gap` as a reviewer's name marked a whole regime as evidenced. The
   * review log has the same pipe-delimited shape as the control table.
   */
  it('never reads the review log as a control', () => {
    const parsed = parseLegacyControlMapping(
      mapping(
        ['| `A.5.1` | Policy | Not assessed | _none recorded_ | _unassigned_ |'],
        { reviewLog: ['| 2026-01-01 | Annual review | Gap |'] },
      ),
      ISO,
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.ref).toBe('A.5.1');
    expect(parsed.reviewNotes).toHaveLength(1);
  });

  it('ignores the status legend in the preamble', () => {
    const parsed = parseLegacyControlMapping(mapping([]), ISO);
    expect(parsed.rows).toHaveLength(0);
  });

  it('reports a control from an earlier edition rather than importing it', () => {
    const parsed = parseLegacyControlMapping(
      mapping(['| `A.9.2.3` | From the 2013 edition | Satisfied | done | Jo |']),
      ISO,
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.unmatchedRefs).toEqual(['A.9.2.3']);
  });
});

describe('a status is carried only where somebody is named', () => {
  /**
   * The register's invariants would demote an unattributed status on the next
   * read anyway. Doing it here lets the confirmation say so *before* anything
   * is written, which is the number somebody actually needs.
   */
  it('demotes a Satisfied row with no owner, keeping its wording', () => {
    const result = plan(mapping([
      '| `A.5.1` | Policy | Satisfied | _none recorded_ | _unassigned_ |',
    ]));
    expect(result.demotedRows).toHaveLength(1);
    expect(result.demotedRows[0]!.why).toContain('nobody the status is asserted by');

    const control = result.register.controls.find(entry => entry.ref === 'A.5.1')!;
    expect(control.status).toBe('not-assessed');
    expect(control.note).toContain('read "Satisfied"');
    expect(control.note).toContain('not carried as recorded');
  });

  it('demotes a row whose owner the roster does not know, and says who', () => {
    const result = plan(mapping([
      '| `A.5.1` | Policy | Satisfied | We wrote one | Alex |',
    ]));
    expect(result.demotedRows[0]!.why).toContain('"Alex", who is not on the Director roster');
  });

  it('carries a row whose owner is on the roster', () => {
    const result = plan(mapping([
      '| `A.5.1` | Policy | Satisfied | Held in the policy folder | Jo |',
    ]));
    expect(result.demotedRows).toHaveLength(0);
    const control = result.register.controls.find(entry => entry.ref === 'A.5.1')!;
    expect(control.status).toBe('satisfied');
    expect(control.assertedBy?.contactId).toBe('contact-jo');
    expect(control.assertedBy?.source).toBe('human');
  });

  it('is explicit that the date is the import date, not the assertion date', () => {
    // The old table had no date column. Inventing one would let a Type II
    // reader compute a period from a number nobody stood behind.
    const result = plan(mapping(['| `A.5.1` | Policy | Satisfied | Yes | Jo |']));
    const control = result.register.controls.find(entry => entry.ref === 'A.5.1')!;
    expect(control.note).toContain('when it was imported rather than when it was asserted');
    expect(control.assertedBy?.at).toBe(NOW.toISOString());
  });
});

describe('what the evidence column becomes', () => {
  it('becomes a described record, since the mapping never held a document', () => {
    const result = plan(mapping(['| `A.5.1` | Policy | Satisfied | Held in Confluence | Jo |']));
    const evidence = result.library.evidence.find(entry => entry.title.includes('A.5.1'))!;
    expect(evidence.kind).toBe('attestation');
    expect(evidence.locator).toEqual({ kind: 'described', where: 'Held in Confluence' });
  });

  it('drops the scaffolder’s own pointer rather than citing it back', () => {
    // Written by the tool, not by a person. Importing it would be AtlasMind
    // reading its own boilerplate as evidence.
    const result = plan(mapping([
      '| `A.5.15` | Access control | Satisfied | AtlasMind checks part of this — see Testing → Policy coverage | Jo |',
    ]));
    expect(result.library.evidence).toHaveLength(0);
    const control = result.register.controls.find(entry => entry.ref === 'A.5.15')!;
    expect(control.evidenceIds).toEqual([]);
  });

  it('drops the seeded placeholders', () => {
    const result = plan(mapping(['| `A.5.1` | Policy | Satisfied | _none recorded_ | Jo |']));
    expect(result.library.evidence).toHaveLength(0);
  });

  it('uses the evidence column as the justification for a Not applicable row', () => {
    // The scaffolded document says so: "A Not applicable needs a justification
    // in the Evidence column."
    const result = plan(mapping([
      '| `A.7.9` | Off-premises assets | Not applicable | We have no premises of our own | Jo |',
    ]));
    const control = result.register.controls.find(entry => entry.ref === 'A.7.9')!;
    expect(control.status).toBe('not-applicable');
    expect(control.justification).toBe('We have no premises of our own');
  });
});

describe('scope is proposed, never decided', () => {
  it('keeps the scaffolder’s paragraph as a proposal', () => {
    // The scaffolder wrote it; nobody agreed to it, so the scope gate holds.
    const result = plan(mapping(['| `A.5.1` | Policy | Satisfied | Yes | Jo |']));
    expect(result.register.scope.proposed).toContain('Which Annex A controls are applicable');
    expect(result.register.scope.decidedAt).toBeUndefined();
  });

  it('means every imported status still reads Not assessed until scope is adopted', () => {
    // The invariants do the work: the scope gate applies to imported rows
    // exactly as it applies to typed ones.
    const result = plan(mapping(['| `A.5.1` | Policy | Satisfied | Yes | Jo |']));
    const { register } = sanitizeComplianceRegimeRegister(
      result.register, 'iso-27001', result.library, NOW,
    );
    expect(register.controls.find(entry => entry.ref === 'A.5.1')!.status).toBe('not-assessed');
  });
});

describe('the import is offered once, and only for a hand-written file', () => {
  it('refuses a mapping AtlasMind generated', () => {
    const generated = '# x\n\n> Generated by AtlasMind from the JSON file beside this one.\n\n'
      + mapping(['| `A.5.1` | Policy | Satisfied | Yes | Jo |']);
    expect(hasImportableMapping(generated, ISO)).toBe(false);
  });

  it('offers a hand-written one with rows in it', () => {
    expect(hasImportableMapping(mapping(['| `A.5.1` | Policy | Satisfied | Yes | Jo |']), ISO)).toBe(true);
  });

  it('does not offer an empty one', () => {
    expect(hasImportableMapping(mapping([]), ISO)).toBe(false);
    expect(hasImportableMapping(undefined, ISO)).toBe(false);
  });

  it('stamps importedFrom so a second import cannot run', () => {
    const result = plan(mapping(['| `A.5.1` | Policy | Satisfied | Yes | Jo |']));
    expect(result.register.importedFrom?.format).toBe('markdown-v1');
    expect(result.register.importedFrom?.demotedRows).toBe(0);
  });
});

describe('the confirmation says the uncomfortable half first', () => {
  it('leads with what cannot be carried across', () => {
    const result = plan(mapping([
      '| `A.5.1` | Policy | Satisfied | Yes | Jo |',
      '| `A.5.2` | Roles | Satisfied | Yes | _unassigned_ |',
    ]));
    const text = describeLegacyImport(result);
    expect(text.indexOf('cannot be carried across')).toBeLessThan(text.indexOf('will carry across'));
    expect(text).toContain('Nothing is deleted');
  });
});

describe('this repository’s own mappings', () => {
  /**
   * All of them are entirely `Not assessed`, so the import is a no-op here —
   * which means the demotion path would never be exercised by hand. That is
   * exactly why it is pinned above.
   */
  it('parses the real soc2.md into its declared controls and nothing else', () => {
    const markdown = readFileSync(
      path.join(process.cwd(), 'project_memory', 'operations', 'compliance', 'soc2.md'),
      'utf8',
    );
    const parsed = parseLegacyControlMapping(markdown, SOC2);
    expect(parsed.rows.length).toBe(SOC2.controls.length - 1); // REPORT-1 is new
    expect(parsed.unmatchedRefs).toEqual([]);
    expect(parsed.rows.every(row => row.status === 'not-assessed')).toBe(true);
  });

  it('imports it as nothing recorded, because nothing was', () => {
    const markdown = readFileSync(
      path.join(process.cwd(), 'project_memory', 'operations', 'compliance', 'soc2.md'),
      'utf8',
    );
    const result = plan(markdown, SOC2);
    expect(result.recordedRows).toBe(0);
    expect(result.demotedRows).toEqual([]);
    expect(result.library.evidence).toHaveLength(0);
  });
});
