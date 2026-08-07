/**
 * Which declared services answered, and which are dead ends.
 *
 * The Live Contract Drift lens asks "does the shape still agree?" — which
 * presumes the service answered at all. This one asks the prior question, and it
 * is its own lens rather than a field on the drift report because the two fail
 * differently and get fixed by different people: a drifted schema is a code
 * change, an unreachable endpoint is an environment.
 *
 * Four rules.
 *
 * **`unassessed` is never `unreachable`.** The distinction the whole lens turns
 * on. "Nobody looked" and "we looked and nothing was there" are different facts,
 * and merging them would light up every endpoint as a dead end on a laptop that
 * is simply offline — training people to ignore the one that is real. So an
 * endpoint that was never probed, or whose probe was refused by policy, is
 * reported in its own bucket and counted separately.
 *
 * **A refusal is not a failure.** `refused` and `unauthorized` stay distinct
 * from `unreachable`: the first two mean AtlasMind decided not to ask or was
 * turned away at the door, the third means nothing answered. Reporting a
 * production endpoint you declined to confirm as "unreachable" would be a lie
 * about somebody else's infrastructure.
 *
 * **A dangling contract id is a dead end in the other direction.** An endpoint
 * whose `expectedContractIds` name a contract the repository no longer has is
 * carried explicitly rather than dropped. That is the "declared, then deleted"
 * case, and quietly ignoring an unresolvable id is how it stays invisible.
 *
 * **Empty is stated, never implied.** No declared endpoints yields a map that
 * says so and names the file to write, rather than a clean green nothing.
 *
 * Pure + unit-tested. Nothing here probes; it is handed the results.
 */

import type {
  LensEndpointDeclaration,
  LensProbeResult,
  LensReachabilityItem,
  LensReachabilityMap,
} from '../types.js';
import { LENS_ENDPOINT_FILE } from './lensEndpoints.js';

export const LENS_REACHABILITY_MAX_ITEMS = 100;

export interface LensReachabilityInput {
  readonly endpoints: readonly LensEndpointDeclaration[];
  /**
   * Probe results by endpoint id. An endpoint with no entry is `unassessed` —
   * absence here means *not looked at*, and is never read as a failure.
   */
  readonly results: ReadonlyMap<string, LensProbeResult>;
  /** Contract ids the repository actually has, for the dangling-reference check. */
  readonly knownContractIds: readonly string[];
}

/**
 * Rank by consequence, not by count.
 *
 * Declaration order is the ranking. `unreachable` leads because a declared
 * service that does not answer is the actionable failure; `unassessed` sits
 * above `reached` because an unexamined endpoint is not a healthy one and
 * burying it under the working ones is how it stays unexamined.
 */
const OUTCOME_RANK: readonly LensProbeResult['outcome'][] = [
  'unreachable',
  'unauthorized',
  'refused',
  'unassessed',
  'reached',
];

export function analyzeLensReachability(input: LensReachabilityInput): LensReachabilityMap {
  const known = new Set(input.knownContractIds);
  const items: LensReachabilityItem[] = input.endpoints.map(endpoint => {
    const result = input.results.get(endpoint.id);
    const danglingContractIds = endpoint.expectedContractIds.filter(id => !known.has(id));
    const outcome = result?.outcome ?? 'unassessed';
    return {
      id: `lens-reachability-item:${stableHash(endpoint.id)}`,
      endpointId: endpoint.id,
      label: endpoint.label,
      kind: endpoint.kind,
      stage: endpoint.stage,
      outcome,
      reason: result?.reason ?? 'This endpoint has not been probed in this session.',
      ...(result?.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      danglingContractIds,
      evidence: outcome === 'reached'
        ? { kind: 'runtime' as const, source: 'Live service probe', confidence: 1 }
        // Not `runtime`: nothing was observed. The endpoint's existence is
        // declared, and that is all this row can attest to.
        : { kind: 'declared' as const, source: LENS_ENDPOINT_FILE, confidence: 1 },
    };
  });

  // Ties break on declaration order, so the list cannot shuffle between two
  // renders of the same state.
  const ranked = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const byOutcome = OUTCOME_RANK.indexOf(left.item.outcome) - OUTCOME_RANK.indexOf(right.item.outcome);
      return byOutcome !== 0 ? byOutcome : left.index - right.index;
    })
    .map(entry => entry.item);

  const reachedCount = items.filter(item => item.outcome === 'reached').length;
  const unreachableCount = items.filter(item => item.outcome === 'unreachable').length;
  // `refused` and `unauthorized` are counted as unassessed, not as failures:
  // in both cases nothing was learned about whether the service is up.
  const unassessedCount = items.filter(
    item => item.outcome === 'unassessed' || item.outcome === 'refused' || item.outcome === 'unauthorized',
  ).length;
  const dangling = items.filter(item => item.danglingContractIds.length > 0);
  const truncated = ranked.length > LENS_REACHABILITY_MAX_ITEMS;

  return {
    version: 1,
    id: `lens-reachability:${stableHash(input.endpoints.map(endpoint => endpoint.id).join('|'))}`,
    items: ranked.slice(0, LENS_REACHABILITY_MAX_ITEMS),
    reachedCount,
    unreachableCount,
    unassessedCount,
    notices: buildNotices(items.length, unassessedCount, dangling.length, truncated),
    truncated,
  };
}

function buildNotices(
  total: number,
  unassessedCount: number,
  danglingCount: number,
  truncated: boolean,
): string[] {
  if (total === 0) {
    return [
      `No services are declared. Write \`${LENS_ENDPOINT_FILE}\` to tell AtlasMind which databases `
      + 'and APIs this project talks to.',
      'An empty map means nothing was declared, not that nothing is broken.',
    ];
  }
  return [
    'Reachability describes whether a declared service answered a shape-reading request. It reads no '
    + 'rows and proves nothing about whether the service is behaving correctly.',
    ...(unassessedCount > 0
      ? [`${unassessedCount} endpoint${unassessedCount === 1 ? ' was' : 's were'} not assessed — never probed, `
        + 'refused by policy, or turned away. That is not the same as unreachable, and is not a clean result.']
      : []),
    ...(danglingCount > 0
      ? [`${danglingCount} endpoint${danglingCount === 1 ? '' : 's'} name a repository contract that no longer `
        + 'exists. That is a dead end pointing the other way.']
      : []),
    ...(truncated
      ? [`More than ${LENS_REACHABILITY_MAX_ITEMS} endpoints are declared; this view is bounded and the remainder is not shown.`]
      : []),
  ];
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
