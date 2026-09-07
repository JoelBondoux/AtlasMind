/**
 * Turning what the managers hold into what the report renders.
 *
 * Kept apart from `producerReport.ts` on purpose: that module owns the *shape*
 * of a status document and must stay ignorant of where the facts came from,
 * while this one knows the registers and nothing about markdown or HTML. The
 * split is what lets both be tested without a workspace.
 *
 * Pure. Every input is passed in — a caller that could not read a register
 * passes `undefined`, which becomes a stated gap rather than an empty section.
 * That distinction is the whole reason this function takes optionals instead of
 * reading files itself: `undefined` and `[]` mean different things and only the
 * caller knows which happened.
 *
 * Two rules beyond that.
 *
 * **Only open risks reach the report.** A register keeps resolved and dismissed
 * findings forever, deliberately — but a status page listing forty closed risks
 * buries the three that are live. Closed findings are a register concern, not a
 * status concern.
 *
 * **A stage with no branch has no version to report, and is not "not ready".**
 * Readiness here means *the pipeline declared it and nothing blocks it*, which
 * is a different question from whether a deployment happened.
 */

import type { CostRecord, DeliveryConfig, RiskFinding, RiskOversightConfig } from '../types.js';
import type {
  ProducerReportCostLine,
  ProducerReportDeliveryStage,
  ProducerReportGateProgress,
  ProducerReportInput,
  ProducerReportRisk,
} from './producerReport.js';
import { buildRoadmapCostReport } from './roadmapCostAttribution.js';
import { ROADMAP_ITEMS_END_MARKER, ROADMAP_ITEMS_START_MARKER } from './roadmapReconcile.js';
import { extractItemGates, parseRoadmapGates, type RoadmapGate } from './roadmapGates.js';
import { extractRoadmapNodeAnchor } from './roadmapGraphStore.js';

/** One backlog line, as the report cares about it. */
export interface GatheredRoadmapItem {
  nodeId?: string;
  text: string;
  completed: boolean;
  gates: readonly string[];
}

/**
 * Read the managed block of `improvement-plan.md`.
 *
 * Only the block between the markers is read. Prose above and below it is
 * documentation, and a `- [ ]` line in an example would otherwise become a
 * roadmap item — the same reason the debt scanner refuses markers that are not
 * the first word of a comment.
 */
export function parseRoadmapItemsForReport(markdown: string): GatheredRoadmapItem[] {
  const start = markdown.indexOf(ROADMAP_ITEMS_START_MARKER);
  const end = markdown.indexOf(ROADMAP_ITEMS_END_MARKER);
  if (start === -1 || end === -1 || end < start) { return []; }

  const gates = parseRoadmapGates(markdown);
  const block = markdown.slice(start + ROADMAP_ITEMS_START_MARKER.length, end);
  const items: GatheredRoadmapItem[] = [];

  for (const line of block.split(/\r?\n/)) {
    const match = /^\s*-\s*\[( |x|X)\]\s+(.*)$/.exec(line);
    if (!match) { continue; }
    const completed = match[1]!.toLowerCase() === 'x';
    const anchored = extractRoadmapNodeAnchor(match[2]!.trim());
    const withGates = extractItemGates(anchored.text, gates);
    items.push({
      ...(anchored.nodeId ? { nodeId: anchored.nodeId } : {}),
      text: withGates.text.trim(),
      completed,
      gates: withGates.gates,
    });
  }

  return items;
}

/**
 * Progress per declared gate.
 *
 * A gate nobody has tagged an item with is reported with a total of zero rather
 * than omitted — a declared gate with no work against it is a fact worth seeing,
 * and dropping it would make an empty milestone indistinguishable from one that
 * does not exist.
 */
function gateProgress(
  items: readonly GatheredRoadmapItem[],
  gates: readonly RoadmapGate[],
): ProducerReportGateProgress[] {
  return gates.map(gate => {
    const tagged = items.filter(item => item.gates.includes(gate.id));
    return {
      gate: gate.label ?? gate.id,
      total: tagged.length,
      delivered: tagged.filter(item => item.completed).length,
    };
  });
}

/** Open findings only, worst first, with the recorded decision when there is one. */
export function openRisks(config: RiskOversightConfig | undefined): ProducerReportRisk[] | undefined {
  if (!config) { return undefined; }
  const severityRank = (finding: RiskFinding): number => {
    const impact = { low: 1, medium: 2, high: 3, critical: 4 }[finding.impact as string] ?? 0;
    const likelihood = { low: 1, medium: 2, high: 3 }[finding.likelihood as string] ?? 0;
    return impact * 10 + likelihood;
  };

  return config.findings
    .filter(finding => finding.status === 'open')
    .sort((left, right) => severityRank(right) - severityRank(left) || left.title.localeCompare(right.title))
    .map(finding => ({
      title: finding.title,
      severity: `${finding.impact} impact, ${finding.likelihood} likelihood`,
      status: finding.status,
      // Absent rather than a placeholder: the report renders "No decision
      // recorded", which is a different statement from an empty note.
      ...(finding.statusNote ? { decision: finding.statusNote } : {}),
    }));
}

/**
 * Stages in pipeline order.
 *
 * `ready` reports whether the stage is declared and unprotected-or-satisfiable,
 * not whether something was deployed to it — the report says "delivery
 * readiness", and claiming a deployment we did not observe would be the wrong
 * kind of confident.
 */
export function deliveryReadiness(config: DeliveryConfig | undefined): ProducerReportDeliveryStage[] | undefined {
  if (!config) { return undefined; }
  return [...config.stages]
    .sort((left, right) => left.rank - right.rank)
    .map(stage => ({
      name: stage.name,
      ready: Boolean(stage.branchRef),
      ...(stage.branchRef ? {} : { blockedBy: 'No branch declared for this stage' }),
    }));
}

/** Cost lines per roadmap item, labelled with the item's text rather than its id. */
function costLines(
  records: readonly CostRecord[] | undefined,
  items: readonly GatheredRoadmapItem[],
  pricingNote: string | undefined,
  comparisonNote: string | undefined,
): ProducerReportInput['cost'] | undefined {
  if (!records) { return undefined; }
  const report = buildRoadmapCostReport(records);
  const labelFor = (nodeId: string): string =>
    items.find(item => item.nodeId === nodeId)?.text ?? nodeId;

  const lines: ProducerReportCostLine[] = report.items.map(item => ({
    label: labelFor(item.roadmapItemId),
    costUsd: item.costUsd,
    ...(item.explicitRequestCount === 0 ? { inferred: true } : {}),
    ...(item.unpricedRequestCount > 0 ? { unpricedRequestCount: item.unpricedRequestCount } : {}),
  }));

  return {
    lines,
    unattributedCostUsd: report.unattributedCostUsd,
    totalCostUsd: report.totalCostUsd,
    ...(pricingNote ? { pricingNote } : {}),
    ...(comparisonNote ? { comparisonNote } : {}),
  };
}

export interface GatherInput {
  projectName: string;
  generatedAt: Date;
  version?: string;
  /** `undefined` when the backlog could not be read — not the same as an empty backlog. */
  roadmapMarkdown?: string;
  riskConfig?: RiskOversightConfig;
  deliveryConfig?: DeliveryConfig;
  costRecords?: readonly CostRecord[];
  /**
   * How old the prices behind the cost figures are.
   *
   * Passed in rather than read here, so this module stays pure and the caller —
   * which knows the clock — decides. A report generated without it simply omits
   * the note; it never claims the prices are current.
   */
  pricingNote?: string;
  /**
   * The counterfactual sentence, when a comparison model is nominated.
   *
   * Composed by the caller with `describeCounterfactual`, because only the
   * caller can resolve a model's rates. Absent means no comparison was asked
   * for — never a saving of zero.
   */
  comparisonNote?: string;
}

/** Assemble everything the renderer needs, preserving every could-not-read as a gap. */
export function buildProducerReportInput(input: GatherInput): ProducerReportInput {
  const items = input.roadmapMarkdown === undefined
    ? undefined
    : parseRoadmapItemsForReport(input.roadmapMarkdown);
  const gates = input.roadmapMarkdown === undefined
    ? undefined
    : parseRoadmapGates(input.roadmapMarkdown);
  const risks = openRisks(input.riskConfig);
  const delivery = deliveryReadiness(input.deliveryConfig);
  const cost = costLines(input.costRecords, items ?? [], input.pricingNote, input.comparisonNote);

  return {
    projectName: input.projectName,
    generatedAt: input.generatedAt,
    ...(input.version ? { version: input.version } : {}),
    ...(items && gates ? { gates: gateProgress(items, gates) } : {}),
    ...(risks ? { risks } : {}),
    ...(delivery ? { delivery } : {}),
    ...(cost ? { cost } : {}),
  };
}
