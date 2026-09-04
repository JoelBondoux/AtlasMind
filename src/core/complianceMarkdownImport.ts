import {
  type ComplianceMethodologyId,
  type ComplianceRegimeCatalog,
} from './complianceControlCatalog.js';
import {
  seedComplianceRegister,
  type ComplianceAttribution,
  type ComplianceControlRecord,
  type ComplianceControlStatus,
  type ComplianceEvidence,
  type ComplianceEvidenceLibrary,
  type ComplianceRegimeRegister,
  type ComplianceReview,
} from './complianceEvidenceRegister.js';

/**
 * Bring a hand-edited control mapping into the register, rather than making
 * somebody retype it.
 *
 * The scaffolder used to write `<regime>.md` as a form a person filled in by
 * hand. That file is now *generated* from the register, so a project that had
 * genuinely filled one in would otherwise lose the work — or, worse, keep
 * editing a file that is overwritten on the next write.
 *
 * ── There is no special case for import ──────────────────────────────────
 *
 * The obvious shortcut is to trust an imported row because somebody clearly
 * typed it deliberately. That shortcut is the whole defect wearing a
 * sympathetic face: the register's invariants exist because a status with
 * nothing behind it is a claim, and a claim does not become evidence by being
 * old. So the import produces ordinary records and hands them to
 * `sanitizeComplianceRegimeRegister` like anything else. A row reading
 * `Satisfied` with no owner and `_none recorded_` lands at *Not assessed* with
 * its wording kept as a note — which is what it always was.
 *
 * ── What is preserved, and what is honestly not ──────────────────────────
 *
 * **The status is preserved where the row names an owner the roster knows.**
 * That is real work and throwing it away would be its own kind of dishonesty.
 * What cannot be preserved is *when* they asserted it: the old table had no
 * date column, so `assertedBy.at` becomes the import timestamp and the note
 * says so in as many words. A fabricated assertion date would be worse than a
 * missing one, because a Type II reader would compute a period from it.
 *
 * **The scaffolder's own pointer is dropped.** Rows carrying
 * `AtlasMind checks part of this — see Testing → Policy coverage` were written
 * by the tool, not by a person, and importing them as evidence would be
 * AtlasMind citing its own boilerplate back to itself.
 *
 * **The scoping prose becomes `scope.proposed`, never a decision.** The
 * scaffolder wrote that paragraph; nobody agreed to it, so the scope gate still
 * holds until a person adopts it.
 *
 * ── Only control rows are read ───────────────────────────────────────────
 *
 * Rows are taken from `### theme` sections under `## Controls` and nowhere
 * else. The `## Review log` table has the same pipe-delimited shape, and the
 * gate this replaces (`isAssessedControlMapping`) matched any cell in any table
 * in the document — which is how typing `Gap` as a reviewer's name could mark a
 * whole regime as evidenced.
 */

/** The scaffolder's own pointer. Written by the tool, never by a person. */
const SCAFFOLDER_POINTER = /atlasmind checks part of this/i;

/** Placeholders the scaffolder seeds. Not content. */
const PLACEHOLDER = /^_?(none recorded|unassigned|none|n\/a)_?$/i;

const STATUS_BY_LABEL: Readonly<Record<string, ComplianceControlStatus>> = {
  'not assessed': 'not-assessed',
  satisfied: 'satisfied',
  partial: 'partial',
  'in progress': 'in-progress',
  gap: 'gap',
  'not applicable': 'not-applicable',
};

export interface LegacyControlRow {
  readonly ref: string;
  readonly status: ComplianceControlStatus;
  readonly evidenceText?: string;
  readonly ownerText?: string;
}

export interface LegacyMappingParse {
  /** Rows found under `## Controls`, and nowhere else in the document. */
  readonly rows: readonly LegacyControlRow[];
  /** The scoping paragraph, as a proposal rather than a decision. */
  readonly proposedScope?: string;
  /** Rows from the review log, which are records rather than controls. */
  readonly reviewNotes: readonly string[];
  /** Refs the document names that this regime does not declare. */
  readonly unmatchedRefs: readonly string[];
}

function cells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return [];
  }
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim().replace(/^`|`$/g, '').replace(/\*\*/g, ''));
}

function isSeparator(row: readonly string[]): boolean {
  return row.length > 0 && row.every(cell => /^:?-{2,}:?$/.test(cell));
}

/**
 * Read a scaffolded mapping.
 *
 * Never throws: an unreadable document yields an empty parse, and the caller
 * reports "nothing to import" rather than failing.
 */
export function parseLegacyControlMapping(
  markdown: string,
  catalog: ComplianceRegimeCatalog,
): LegacyMappingParse {
  const rows: LegacyControlRow[] = [];
  const reviewNotes: string[] = [];
  const unmatchedRefs: string[] = [];
  const declared = new Set(catalog.controls.map(control => control.ref));

  let section: 'none' | 'scope' | 'controls' | 'reviews' = 'none';
  const scopeLines: string[] = [];

  for (const line of (markdown ?? '').split('\n')) {
    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const title = heading[2]!.toLowerCase();
      if (level === 2) {
        section = title.startsWith('before this mapping')
          ? 'scope'
          : title.startsWith('controls')
            ? 'controls'
            : title.startsWith('review log')
              ? 'reviews'
              : 'none';
      }
      // A `###` inside `## Controls` is a theme heading and keeps the section.
      continue;
    }

    if (section === 'scope') {
      const text = line.trim();
      if (text && !text.startsWith('>')) {
        scopeLines.push(text);
      }
      continue;
    }

    const row = cells(line);
    if (row.length === 0 || isSeparator(row)) {
      continue;
    }

    if (section === 'reviews') {
      // Records, not controls. Kept so nothing in the document is silently lost.
      const text = row.filter(cell => cell && !PLACEHOLDER.test(cell)).join(' · ');
      if (text && !/^date\b/i.test(text)) {
        reviewNotes.push(text);
      }
      continue;
    }

    if (section !== 'controls' || row.length < 5) {
      continue;
    }
    const [ref, , statusCell, evidenceCell, ownerCell] = row;
    if (!ref || /^ref$/i.test(ref)) {
      continue;
    }
    if (!declared.has(ref)) {
      // Reported, never imported. It may belong to an earlier edition.
      unmatchedRefs.push(ref);
      continue;
    }
    const status = STATUS_BY_LABEL[(statusCell ?? '').toLowerCase()] ?? 'not-assessed';
    const evidenceText = evidenceCell && !PLACEHOLDER.test(evidenceCell)
      && !SCAFFOLDER_POINTER.test(evidenceCell)
      ? evidenceCell
      : undefined;
    const ownerText = ownerCell && !PLACEHOLDER.test(ownerCell) ? ownerCell : undefined;
    rows.push({
      ref,
      status,
      ...(evidenceText ? { evidenceText } : {}),
      ...(ownerText ? { ownerText } : {}),
    });
  }

  const proposedScope = scopeLines.join(' ').trim();
  return {
    rows,
    ...(proposedScope ? { proposedScope } : {}),
    reviewNotes,
    unmatchedRefs,
  };
}

/** What the import would do, computed before anything is written. */
export interface LegacyImportPlan {
  readonly regimeId: ComplianceMethodologyId;
  /** Rows carrying a status of any kind. */
  readonly recordedRows: number;
  /**
   * Rows whose status cannot be carried across as recorded.
   *
   * Named separately from `recordedRows` because this is the number somebody
   * needs to see *before* agreeing to the import, not afterwards.
   */
  readonly demotedRows: readonly { readonly ref: string; readonly was: string; readonly why: string }[];
  readonly carriedRows: number;
  readonly unmatchedRefs: readonly string[];
  readonly reviewNotes: number;
  readonly proposedScope?: string;
  readonly register: ComplianceRegimeRegister;
  readonly library: ComplianceEvidenceLibrary;
}

export interface LegacyImportInput {
  readonly markdown: string;
  readonly catalog: ComplianceRegimeCatalog;
  readonly library: ComplianceEvidenceLibrary;
  /** Roster names to contact ids, lowercased, for matching the Owner column. */
  readonly rosterByName: ReadonlyMap<string, string>;
  readonly now: Date;
}

const STATUS_LABEL: Readonly<Record<ComplianceControlStatus, string>> = {
  'not-assessed': 'Not assessed',
  'in-progress': 'In progress',
  partial: 'Partial',
  satisfied: 'Satisfied',
  gap: 'Gap',
  'not-applicable': 'Not applicable',
};

/**
 * Build the register the import would write, and the count of what it cannot
 * carry across.
 *
 * Pure, and separate from writing on purpose: the confirmation shows the
 * demotion count, and a count computed after the write would be a report on
 * something already done.
 */
export function planLegacyImport(input: LegacyImportInput): LegacyImportPlan {
  const { catalog, now } = input;
  const parse = parseLegacyControlMapping(input.markdown, catalog);
  const stamp = now.toISOString();
  const importedOn = stamp.slice(0, 10);

  const demoted: { ref: string; was: string; why: string }[] = [];
  const newEvidence: ComplianceEvidence[] = [];
  const seeded = seedComplianceRegister(catalog, now);
  const byRef = new Map(parse.rows.map(row => [row.ref, row]));

  const controls: ComplianceControlRecord[] = seeded.controls.map(control => {
    const row = byRef.get(control.ref);
    if (!row || row.status === 'not-assessed') {
      return { ...control, provenance: 'migrated-markdown' as const };
    }

    const ownerId = row.ownerText
      ? input.rosterByName.get(row.ownerText.toLowerCase())
      : undefined;

    const noteParts = [`Imported from the hand-edited mapping on ${importedOn}, where it read "${STATUS_LABEL[row.status]}".`];
    if (row.evidenceText) {
      noteParts.push(`The evidence column said: ${row.evidenceText}`);
    }

    // No named owner means no asserter, and the sanitizer would demote it on
    // the next read anyway. Doing it here lets the confirmation say so first.
    if (!ownerId) {
      demoted.push({
        ref: control.ref,
        was: STATUS_LABEL[row.status],
        why: row.ownerText
          ? `The owner column said "${row.ownerText}", who is not on the Director roster.`
          : 'No owner was recorded, so there is nobody the status is asserted by.',
      });
      return {
        ...control,
        provenance: 'migrated-markdown' as const,
        note: `${noteParts.join(' ')} It is not carried as recorded because no asserter was named.`,
      };
    }

    // The old table had no date column. The import date is a real fact; the
    // assertion date is not knowable, and inventing one would let a Type II
    // reader compute a period from a number nobody stood behind.
    const assertedBy: ComplianceAttribution = { contactId: ownerId, source: 'human', at: stamp };

    const evidenceIds: string[] = [];
    if (row.evidenceText && row.status !== 'not-applicable') {
      const id = `ev-imported-${control.ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      newEvidence.push({
        id,
        kind: 'attestation',
        title: `${control.ref} — imported note`,
        locator: { kind: 'described', where: row.evidenceText },
        assertedBy,
        createdAt: stamp,
        updatedAt: stamp,
      });
      evidenceIds.push(id);
    }

    return {
      ...control,
      status: row.status,
      ...(row.status === 'not-applicable' && row.evidenceText ? { justification: row.evidenceText } : {}),
      evidenceIds,
      ownerContactId: ownerId,
      assertedBy,
      provenance: 'migrated-markdown' as const,
      note: `${noteParts.join(' ')} The original recorded no date, so the date above is when it was imported rather than when it was asserted.`,
      transitions: [{ at: stamp, status: row.status, by: assertedBy, note: 'Imported from the hand-edited mapping.' }],
    };
  });

  const reviews: ComplianceReview[] = [];
  const register: ComplianceRegimeRegister = {
    ...seeded,
    ...(parse.proposedScope ? { scope: { exclusions: [], proposed: parse.proposedScope } } : {}),
    controls,
    reviews,
    importedFrom: { format: 'markdown-v1', at: stamp, demotedRows: demoted.length },
  };

  const library: ComplianceEvidenceLibrary = {
    version: 1,
    evidence: [...input.library.evidence, ...newEvidence],
    updatedAt: stamp,
  };

  const recorded = parse.rows.filter(row => row.status !== 'not-assessed').length;
  return {
    regimeId: catalog.policyId,
    recordedRows: recorded,
    demotedRows: demoted,
    carriedRows: recorded - demoted.length,
    unmatchedRefs: parse.unmatchedRefs,
    reviewNotes: parse.reviewNotes.length,
    ...(parse.proposedScope ? { proposedScope: parse.proposedScope } : {}),
    register,
    library,
  };
}

/** Is there a hand-edited mapping worth offering to import? */
export function hasImportableMapping(markdown: string | undefined, catalog: ComplianceRegimeCatalog): boolean {
  if (!markdown) {
    return false;
  }
  // A mapping AtlasMind generated says so in its own header; re-importing one
  // would be the tool reading its own output back in.
  if (/Generated by AtlasMind/i.test(markdown)) {
    return false;
  }
  return parseLegacyControlMapping(markdown, catalog).rows.length > 0;
}

/** One sentence for a confirmation dialog. Says the uncomfortable half first. */
export function describeLegacyImport(plan: LegacyImportPlan): string {
  const parts = [`${plan.register.controls.length} controls, ${plan.recordedRows} with a recorded status.`];
  if (plan.demotedRows.length > 0) {
    parts.push(
      `${plan.demotedRows.length} of those cannot be carried across as recorded — they name no owner the `
      + 'roster knows, so there is nobody the status is asserted by. They import as Not assessed with '
      + 'their original wording kept as a note. Nothing is deleted.',
    );
  }
  if (plan.carriedRows > 0) {
    parts.push(`${plan.carriedRows} will carry across, dated today rather than when they were first asserted.`);
  }
  if (plan.unmatchedRefs.length > 0) {
    parts.push(
      `${plan.unmatchedRefs.length} row${plan.unmatchedRefs.length === 1 ? '' : 's'} name a control this regime `
      + `does not declare (${plan.unmatchedRefs.slice(0, 3).join(', ')}) and will not be imported.`,
    );
  }
  if (plan.proposedScope) {
    parts.push('The scoping paragraph is kept as a proposal, not a decision — you still adopt it.');
  }
  return parts.join(' ');
}
