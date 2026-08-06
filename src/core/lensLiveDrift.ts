/**
 * How what the repository declares differs from what the service actually serves.
 *
 * The question The User asked — where does the data break, dead-end, or fail its
 * schema — answered by comparing two contracts built the same way: one from a
 * file, one from a live probe. `absent-remotely` is the finding worth having.
 * It means the code declares a field or table that the running service does not
 * serve, which is a dead end and a schema failure at once, and it is the one
 * thing no static lens can ever see.
 *
 * Five decisions.
 *
 * **`absent-remotely` and `undeclared-remotely` never collapse into "mismatch".**
 * They need opposite fixes — the first is code expecting something that is gone,
 * the second is a service serving something nobody wrote down — and a single
 * combined class would hide which one you are looking at at exactly the moment
 * it matters.
 *
 * **A partial reading reports nothing as absent.** If the probe hit a budget, or
 * the served contract came back `partial`, then "declared but not served" is
 * indistinguishable from "declared and past the cap". So a truncated reading
 * downgrades every `absent-remotely` to a stated non-finding rather than
 * publishing schema failures a budget invented. This is the rule most likely to
 * be broken by accident and the most alarming when it is.
 *
 * **A contract nobody could pair is `unmatched`, not `absent`.** A declared
 * contract with no served counterpart *by name* usually means the naming
 * conventions differ, not that a table vanished. It is reported as its own
 * result with the labels on both sides shown, so a person can see the mismatch
 * and fix the pairing — never as several hundred missing fields.
 *
 * **Matching is exact, then case-insensitive, and says which.** An aggressive
 * normalizer that folded `user_id` into `userId` would manufacture matches
 * across a genuine snake-case/camel-case boundary and hide a real transform. The
 * case-insensitive pass is a *fallback* and every finding it produces says so.
 *
 * **`unassessed` is never `matched`.** A probe that did not run yields a report
 * whose outcome carries that, with no findings — not a clean bill of health.
 * (`attentionFeed`'s fifth rule, at the one place where silence would be most
 * convincing.)
 *
 * Pure + unit-tested. Nothing here probes; it is handed both sides.
 */

import type {
  LensContract,
  LensContractField,
  LensContractFindingSeverity,
  LensEvidence,
  LensLiveDriftFinding,
  LensLiveDriftKind,
  LensLiveDriftReport,
  LensProbeOutcome,
  LensServedContract,
} from '../types.js';
import { normalizeLensContract } from './lensContract.js';

export const LENS_LIVE_DRIFT_MAX_FINDINGS = 1_000;

export interface LensLiveDriftInput {
  readonly declared: LensContract;
  readonly served: LensServedContract;
  readonly outcome: LensProbeOutcome;
  /** Set when the probe did not run or did not complete. */
  readonly outcomeReason?: string;
}

/** One declared contract paired against the served contract that matched it. */
export interface LensLiveContractPairing {
  readonly declaredContractId: string;
  readonly declaredLabel: string;
  readonly servedLabel?: string;
  readonly matched: boolean;
  /** How the pair was found, published so a fallback match is visible as one. */
  readonly matchKind: 'exact' | 'case-insensitive' | 'unmatched';
}

/**
 * Compare one declared contract against a probe's served contracts.
 *
 * The served side is a list, so the declared contract is first paired with the
 * served contract that shares its name. An unpaired declared contract is a
 * result in its own right, not a pile of missing fields.
 */
export function analyzeLensLiveDrift(input: LensLiveDriftInput): LensLiveDriftReport {
  const declared = normalizeLensContract(input.declared);
  if (!declared) {
    throw new Error('AtlasMind Lens refused an invalid declared contract for live drift.');
  }

  const endpointId = input.served.endpointId;
  const baseId = `lens-live-drift:${stableHash(`${endpointId}:${declared.id}`)}`;

  if (input.outcome !== 'reached') {
    // Nothing was read, so nothing can be said about drift. Reporting zero
    // findings *with* the outcome is the honest answer; reporting zero findings
    // alone would read as "no drift found".
    return {
      version: 1,
      id: baseId,
      endpointId,
      declaredContractId: declared.id,
      outcome: input.outcome,
      findings: [],
      notices: [
        input.outcomeReason
          ?? 'The endpoint was not read, so no comparison was made. This is not a finding of "no drift".',
        'An unassessed endpoint is not a healthy one.',
      ],
      truncated: false,
    };
  }

  const pairing = pairContract(declared, input.served.contracts);
  if (!pairing.matched || !pairing.served) {
    return {
      version: 1,
      id: baseId,
      endpointId,
      declaredContractId: declared.id,
      outcome: input.outcome,
      findings: [],
      notices: [
        `The service served no schema named \`${declared.label}\`. `
        + `It served: ${describeServedLabels(input.served.contracts)}.`,
        'This is reported as an unmatched pairing rather than as missing fields, because differing '
        + 'naming conventions are a far more common cause than a schema that disappeared.',
      ],
      truncated: input.served.truncated,
    };
  }

  const servedContract = pairing.served;
  const servedByPath = new Map(servedContract.fields.map(field => [field.path, field]));
  const servedByLowerPath = new Map(
    servedContract.fields.map(field => [field.path.toLowerCase(), field]),
  );

  // A partial reading cannot support an absence claim. Computed once and stated
  // in the notices rather than checked at each finding, so it cannot be missed
  // at one branch.
  const readingIsPartial = input.served.truncated || servedContract.coverage !== 'complete';

  const findings: LensLiveDriftFinding[] = [];
  const consumedServed = new Set<string>();

  for (const declaredField of declared.fields) {
    const exact = servedByPath.get(declaredField.path);
    const fallback = exact ? undefined : servedByLowerPath.get(declaredField.path.toLowerCase());
    const servedField = exact ?? fallback;

    if (!servedField) {
      if (!readingIsPartial) {
        findings.push(buildFinding(
          endpointId,
          declared.id,
          'absent-remotely',
          'error',
          'Declared, but not served',
          `The repository declares \`${declaredField.path}\`, and the live service does not serve it. `
          + 'Code reading this field has a dead end.',
          declaredField.path,
          describeShape(declaredField),
          undefined,
          declaredField,
        ));
      }
      continue;
    }

    consumedServed.add(servedField.path);
    const viaFallback = Boolean(fallback);
    const fallbackNote = viaFallback
      ? ' Matched by name ignoring case, so the two sides spell this field differently.'
      : '';

    if (!typesAgree(declaredField.dataType, servedField.dataType)) {
      findings.push(buildFinding(
        endpointId,
        declared.id,
        'type-changed',
        'error',
        'Served type differs from the declared type',
        `The repository declares \`${declaredField.dataType}\` and the service serves `
        + `\`${servedField.dataType}\`.${fallbackNote}`,
        declaredField.path,
        describeShape(declaredField),
        describeShape(servedField),
        declaredField,
      ));
      continue;
    }

    // Only a *narrowing* is reported: the service serving `nullable` where the
    // repository declares `non-null` is a live source of nulls the code does not
    // expect. The reverse is the service being stricter than the declaration,
    // which breaks nothing that is currently running.
    if (declaredField.nullability === 'non-null' && servedField.nullability === 'nullable') {
      findings.push(buildFinding(
        endpointId,
        declared.id,
        'nullability-changed',
        'warning',
        'Service may serve null where the code expects a value',
        `The repository declares \`${declaredField.path}\` non-null; the service serves it nullable.`
        + fallbackNote,
        declaredField.path,
        'non-null',
        'nullable',
        declaredField,
      ));
      continue;
    }

    if (declaredField.presence === 'required' && servedField.presence === 'optional') {
      findings.push(buildFinding(
        endpointId,
        declared.id,
        'presence-changed',
        'warning',
        'Required field is optional on the service',
        `The repository requires \`${declaredField.path}\`; the service declares it optional, so a `
        + `response may omit it.${fallbackNote}`,
        declaredField.path,
        'required',
        'optional',
        declaredField,
      ));
      continue;
    }

    findings.push(buildFinding(
      endpointId,
      declared.id,
      'matched',
      'info',
      'Declared shape matches what is served',
      `\`${declaredField.path}\` agrees on type, nullability, and presence.${fallbackNote}`,
      declaredField.path,
      describeShape(declaredField),
      describeShape(servedField),
      declaredField,
    ));
  }

  for (const servedField of servedContract.fields) {
    if (consumedServed.has(servedField.path)) {
      continue;
    }
    findings.push(buildFinding(
      endpointId,
      declared.id,
      'undeclared-remotely',
      'warning',
      'Served, but not declared',
      `The live service serves \`${servedField.path}\`, and the repository contract does not declare it. `
      + 'Nothing in the code is reading it, and nothing has classified it.',
      servedField.path,
      undefined,
      describeShape(servedField),
      servedField,
    ));
  }

  const truncated = input.served.truncated || findings.length > LENS_LIVE_DRIFT_MAX_FINDINGS;
  return {
    version: 1,
    id: baseId,
    endpointId,
    declaredContractId: declared.id,
    outcome: input.outcome,
    findings: findings.slice(0, LENS_LIVE_DRIFT_MAX_FINDINGS),
    notices: [
      `Compared \`${declared.label}\` against the live \`${servedContract.label}\`, observed at ${input.served.observedAt}.`,
      'This reads declared shape only. No rows, records, or field values were read from the service.',
      ...(pairing.matchKind === 'case-insensitive'
        ? ['The two schemas were paired by name ignoring case; confirm they are the same thing.']
        : []),
      ...(readingIsPartial
        ? ['The served reading was partial, so no field is reported as missing — a budget must not '
          + 'manufacture a schema failure. Fields the service does serve are still compared.']
        : []),
      ...(truncated
        ? [`The report reached its published budget of ${LENS_LIVE_DRIFT_MAX_FINDINGS} findings.`]
        : []),
    ],
    truncated,
  };
}

/** Pair a declared contract with the served contract of the same name. */
export function pairContract(
  declared: LensContract,
  served: readonly LensContract[],
): LensLiveContractPairing & { served?: LensContract } {
  // The served label carries a ` (live)` suffix so a person can tell the two
  // apart on screen. Stripping it here keeps that presentational choice from
  // silently breaking every pairing.
  const strip = (label: string): string => label.replace(/\s*\(live\)\s*$/i, '').trim();

  const exact = served.find(candidate => strip(candidate.label) === declared.label);
  if (exact) {
    return {
      declaredContractId: declared.id,
      declaredLabel: declared.label,
      servedLabel: exact.label,
      matched: true,
      matchKind: 'exact',
      served: exact,
    };
  }
  const insensitive = served.find(
    candidate => strip(candidate.label).toLowerCase() === declared.label.toLowerCase(),
  );
  if (insensitive) {
    return {
      declaredContractId: declared.id,
      declaredLabel: declared.label,
      servedLabel: insensitive.label,
      matched: true,
      matchKind: 'case-insensitive',
      served: insensitive,
    };
  }
  return {
    declaredContractId: declared.id,
    declaredLabel: declared.label,
    matched: false,
    matchKind: 'unmatched',
  };
}

/**
 * Whether two declared type names describe the same shape.
 *
 * Deliberately shallow. `unknown` on either side agrees with anything, because
 * one side failing to state a type is missing evidence rather than a conflict —
 * the distinction `lensContractDrift` already keeps. Beyond that this compares
 * names case-insensitively and does not attempt to equate `varchar` with
 * `string`: a cross-vocabulary equivalence table would be guessing, and a
 * false "these agree" is worse here than a visible one somebody dismisses.
 */
export function typesAgree(declared: string, served: string): boolean {
  const left = declared.trim().toLowerCase();
  const right = served.trim().toLowerCase();
  if (left === 'unknown' || right === 'unknown' || left === '' || right === '') {
    return true;
  }
  return left === right;
}

function describeShape(field: LensContractField): string {
  return `${field.dataType} · ${field.presence} · ${field.nullability}`;
}

function describeServedLabels(contracts: readonly LensContract[]): string {
  if (contracts.length === 0) {
    return 'nothing readable';
  }
  const shown = contracts.slice(0, 8).map(contract => `\`${contract.label}\``).join(', ');
  return contracts.length > 8 ? `${shown} and ${contracts.length - 8} more` : shown;
}

function buildFinding(
  endpointId: string,
  declaredContractId: string,
  kind: LensLiveDriftKind,
  severity: LensContractFindingSeverity,
  label: string,
  reason: string,
  fieldPath: string,
  declared: string | undefined,
  served: string | undefined,
  evidenceField: LensContractField,
): LensLiveDriftFinding {
  const evidence: LensEvidence = kind === 'undeclared-remotely'
    ? { kind: 'runtime', source: 'Live service probe', confidence: 1 }
    : evidenceField.evidence;
  return {
    id: `lens-live-finding:${stableHash(`${endpointId}:${declaredContractId}:${fieldPath}:${kind}`)}`,
    kind,
    severity,
    label,
    reason,
    fieldPath,
    ...(declared ? { declared } : {}),
    ...(served ? { served } : {}),
    ...(evidenceField.target ? { target: evidenceField.target } : {}),
    evidence,
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
