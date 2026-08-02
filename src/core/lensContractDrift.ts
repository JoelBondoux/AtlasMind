import type {
  LensContractDriftFinding,
  LensContractDriftReport,
  LensContractDriftSummary,
  LensContractFindingClass,
  LensContractFindingSeverity,
  LensContractReview,
  LensFieldWire,
} from '../types.js';

export const LENS_CONTRACT_MAX_FINDINGS = 1_000;

const FINDING_CLASSES: LensContractFindingClass[] = [
  'definite-conflict',
  'likely-drift',
  'missing-evidence',
  'intentional-transform',
  'dead-wire',
  'dropped-wire',
  'undocumented-wire',
];

/**
 * Project normalized field wires into explicit drift finding classes.
 *
 * This function does not rediscover links. In particular, an unmatched field
 * remains missing evidence; it is never upgraded to a dropped/dead wire merely
 * because the adapter could not find its counterpart.
 */
export function analyzeLensContractDrift(review: LensContractReview): LensContractDriftReport {
  const findings = review.wires
    .map(classifyWire)
    .filter((finding): finding is LensContractDriftFinding => Boolean(finding));
  const truncated = review.truncated || findings.length > LENS_CONTRACT_MAX_FINDINGS;
  const bounded = findings.slice(0, LENS_CONTRACT_MAX_FINDINGS);
  return {
    version: 1,
    id: `lens-contract-drift:${stableHash(review.id)}`,
    reviewId: review.id,
    findings: bounded,
    summary: summarizeFindings(bounded),
    notices: [
      'Finding classes interpret normalized wiring evidence; they do not prove runtime behaviour.',
      'Missing evidence remains informational and is not treated as a dropped, dead, or undocumented wire.',
      ...(truncated ? [`The drift report exceeded ${LENS_CONTRACT_MAX_FINDINGS} findings or inherited a truncated wiring review.`] : []),
    ],
    truncated,
  };
}

function classifyWire(wire: LensFieldWire): LensContractDriftFinding | undefined {
  if (wire.status === 'exact') {
    return undefined;
  }
  let findingClass: LensContractFindingClass;
  let severity: LensContractFindingSeverity;
  let label: string;
  let reason = wire.reason;

  if (wire.status === 'incompatible') {
    findingClass = 'definite-conflict';
    severity = 'error';
    label = 'Declared shapes conflict';
  } else if (wire.status === 'unverified' && hasStaleExplicitEndpoint(wire)) {
    findingClass = 'dead-wire';
    severity = 'warning';
    label = 'Explicit mapping endpoint is missing';
    reason = `A repository mapping names a field that this contract pair does not declare. ${wire.reason}`;
  } else if (wire.status === 'unverified') {
    findingClass = 'missing-evidence';
    severity = 'info';
    label = 'Connection lacks evidence';
  } else if (wire.status === 'dropped') {
    findingClass = 'dropped-wire';
    severity = wire.intentional ? 'info' : 'warning';
    label = wire.intentional ? 'Intentional field drop' : 'Field drop needs review';
  } else if (wire.status === 'introduced' && !wire.intentional) {
    findingClass = 'undocumented-wire';
    severity = 'warning';
    label = 'Introduced field is not marked intentional';
  } else if (wire.status === 'transformed' && !wire.intentional) {
    findingClass = 'likely-drift';
    severity = 'warning';
    label = 'Non-intentional transformation';
  } else if (wire.status === 'inferred') {
    findingClass = 'likely-drift';
    severity = 'warning';
    label = 'Connection is inferred';
  } else {
    findingClass = 'intentional-transform';
    severity = 'info';
    label = wire.status === 'introduced' ? 'Intentional field introduction' : 'Intentional field transformation';
  }

  return {
    id: `lens-contract-finding:${stableHash(`${wire.id}:${findingClass}`)}`,
    wireId: wire.id,
    findingClass,
    severity,
    label,
    reason,
    suppressed: wire.suppressed,
    ...(wire.suppressionReason ? { suppressionReason: wire.suppressionReason } : {}),
  };
}

function hasStaleExplicitEndpoint(wire: LensFieldWire): boolean {
  return Boolean(
    wire.mappingKind &&
    ((wire.from && !wire.fromFieldId) || (wire.to && !wire.toFieldId)),
  );
}

function summarizeFindings(findings: LensContractDriftFinding[]): LensContractDriftSummary {
  const byClass = Object.fromEntries(FINDING_CLASSES.map(findingClass => [findingClass, 0])) as Record<
    LensContractFindingClass,
    number
  >;
  let active = 0;
  let suppressed = 0;
  let errors = 0;
  let warnings = 0;
  let information = 0;
  for (const finding of findings) {
    byClass[finding.findingClass] += 1;
    if (finding.suppressed) {
      suppressed += 1;
      continue;
    }
    active += 1;
    if (finding.severity === 'error') errors += 1;
    else if (finding.severity === 'warning') warnings += 1;
    else information += 1;
  }
  return { total: findings.length, active, suppressed, errors, warnings, information, byClass };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
