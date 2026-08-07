/**
 * Whether the trust policy still describes what the service actually serves.
 *
 * `lensDataTrust` answers this for fields that exist in a repository file. It
 * cannot answer it for a field the live service returns that nobody wrote down —
 * and that is the field worth knowing about, because it is unknown sensitivity
 * on real data currently crossing the wire.
 *
 * Four decisions.
 *
 * **`served-undeclared` is the finding this lens exists for.** A live service
 * serving a field that no rule in `.atlasmind/lens-data-trust.json` classifies is
 * the gap between what a project believes it handles and what it handles. It is
 * ranked first for that reason.
 *
 * **Unknown is never public.** An unclassified field is missing declared
 * evidence, not proof that the data is safe to log, cache, or send onward. This
 * is `lensDataTrust`'s notice, repeated here because the live path is where
 * somebody is most tempted to read silence as an all-clear.
 *
 * **A classification is never inferred from a field name.** Neither this module
 * nor `lensDataTrust` guesses that `email` is confidential. AtlasMind reading
 * sensitivity off a name would produce a policy nobody wrote, in a git-tracked
 * file, that a later reader could not distinguish from one somebody decided —
 * and a wrong guess in the safe-looking direction is silently worse than no
 * guess. The value is in showing the *gap*, and a fabricated classification
 * closes the gap without closing it.
 *
 * **A partial reading produces no `declared-absent`.** As in `lensLiveDrift`: if
 * the probe hit a budget, a declared field's absence from the reading is a
 * property of the budget. Reporting it as "your policy classifies something the
 * service no longer serves" would be an artefact.
 *
 * Pure + unit-tested. Reads shapes and declarations; never a value.
 */

import type {
  LensDataTrustFieldRule,
  LensDataTrustPolicyFile,
  LensLiveTrustItem,
  LensLiveTrustMap,
  LensLiveTrustStatus,
  LensProbeOutcome,
  LensServedContract,
} from '../types.js';
import { LENS_DATA_TRUST_FILE } from './lensDataTrust.js';

export const LENS_LIVE_TRUST_MAX_ITEMS = 500;

export interface LensLiveTrustInput {
  readonly served: LensServedContract;
  readonly policy: LensDataTrustPolicyFile;
  readonly outcome: LensProbeOutcome;
  /**
   * Repository contract ids this endpoint is expected to serve, so a policy rule
   * written against an unrelated contract is not reported as absent here.
   */
  readonly expectedContractIds: readonly string[];
  readonly outcomeReason?: string;
}

/** Declaration order is the ranking; ties break on it so the list cannot shuffle. */
const STATUS_RANK: readonly LensLiveTrustStatus[] = [
  'served-undeclared',
  'declared-absent',
  'confirmed',
  'unassessed',
];

export function analyzeLensLiveTrust(input: LensLiveTrustInput): LensLiveTrustMap {
  const endpointId = input.served.endpointId;
  const id = `lens-live-trust:${stableHash(endpointId)}`;

  if (input.outcome !== 'reached') {
    return {
      version: 1,
      id,
      endpointId,
      items: [],
      undeclaredCount: 0,
      notices: [
        input.outcomeReason
          ?? 'The endpoint was not read, so nothing can be said about what it serves.',
        'An unassessed endpoint has no trust verdict. This is not a finding that everything is classified.',
      ],
      truncated: false,
    };
  }

  // Rules are keyed on `contractId:fieldPath`, and the served side has its own
  // contract ids. Matching therefore happens on the *served contract label* and
  // field path against every rule belonging to a contract this endpoint is
  // expected to serve — a served contract cannot carry a repository contract id,
  // and pretending it can would silently match nothing.
  const relevantRules = input.expectedContractIds.length > 0
    ? input.policy.fields.filter(rule => input.expectedContractIds.includes(rule.contractId))
    : input.policy.fields;
  const rulesByPath = new Map<string, LensDataTrustFieldRule>();
  for (const rule of relevantRules) {
    // First rule wins on a duplicate path across contracts. The policy
    // normalizer already refuses duplicate `contractId:fieldPath` pairs, so this
    // only arises when two contracts share a field name — where either rule is a
    // reasonable statement about that name and picking deterministically beats
    // reporting the field twice.
    if (!rulesByPath.has(rule.fieldPath)) {
      rulesByPath.set(rule.fieldPath, rule);
    }
  }

  const readingIsPartial = input.served.truncated
    || input.served.contracts.some(contract => contract.coverage !== 'complete');

  const items: LensLiveTrustItem[] = [];
  const servedPaths = new Set<string>();

  for (const contract of input.served.contracts) {
    for (const field of contract.fields) {
      servedPaths.add(field.path);
      const rule = rulesByPath.get(field.path);
      if (rule) {
        items.push(buildItem(
          endpointId,
          field.path,
          'confirmed',
          `The service serves \`${field.path}\`, and ${LENS_DATA_TRUST_FILE} classifies it as `
          + `${rule.classification}.`,
          rule,
        ));
        continue;
      }
      items.push(buildItem(
        endpointId,
        field.path,
        'served-undeclared',
        `The service serves \`${field.path}\`, and no rule in ${LENS_DATA_TRUST_FILE} classifies it. `
        + 'Its sensitivity is unknown, which is not the same as public.',
      ));
    }
  }

  if (!readingIsPartial) {
    for (const [fieldPath, rule] of rulesByPath) {
      if (servedPaths.has(fieldPath)) {
        continue;
      }
      items.push(buildItem(
        endpointId,
        fieldPath,
        'declared-absent',
        `${LENS_DATA_TRUST_FILE} classifies \`${fieldPath}\` as ${rule.classification}, and the service `
        + 'does not serve it. The rule may be describing something that no longer exists.',
        rule,
      ));
    }
  }

  const ranked = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const byStatus = STATUS_RANK.indexOf(left.item.status) - STATUS_RANK.indexOf(right.item.status);
      return byStatus !== 0 ? byStatus : left.index - right.index;
    })
    .map(entry => entry.item);

  const undeclaredCount = items.filter(item => item.status === 'served-undeclared').length;
  const truncated = input.served.truncated || ranked.length > LENS_LIVE_TRUST_MAX_ITEMS;

  return {
    version: 1,
    id,
    endpointId,
    items: ranked.slice(0, LENS_LIVE_TRUST_MAX_ITEMS),
    undeclaredCount,
    notices: [
      'This compares field *names and shapes* the service serves against declared policy. It reads no '
      + 'values, so it cannot confirm that a control is correctly implemented — only that a rule exists.',
      'An unknown classification is missing declared evidence, never proof that data is public. '
      + 'AtlasMind does not infer sensitivity from a field name.',
      ...(undeclaredCount > 0
        ? [`${undeclaredCount} served field${undeclaredCount === 1 ? ' has' : 's have'} no classification. `
          + `Add rules to ${LENS_DATA_TRUST_FILE} to close the gap.`]
        : []),
      ...(readingIsPartial
        ? ['The served reading was partial, so no declared rule is reported as describing something absent.']
        : []),
      ...(truncated
        ? [`This view is bounded to ${LENS_LIVE_TRUST_MAX_ITEMS} fields; the remainder is not shown.`]
        : []),
    ],
    truncated,
  };
}

function buildItem(
  endpointId: string,
  fieldPath: string,
  status: LensLiveTrustStatus,
  reason: string,
  rule?: LensDataTrustFieldRule,
): LensLiveTrustItem {
  return {
    id: `lens-live-trust-item:${stableHash(`${endpointId}:${fieldPath}:${status}`)}`,
    endpointId,
    fieldPath,
    status,
    ...(rule ? { classification: rule.classification } : {}),
    controls: rule?.controls ?? [],
    reason,
    evidence: rule
      ? { kind: 'declared', source: LENS_DATA_TRUST_FILE, confidence: 1 }
      : { kind: 'runtime', source: 'Live service probe', confidence: 1 },
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
