/**
 * One research scan, start to finish.
 *
 * Everything the run touches is injected, so the sequence can be tested without
 * an editor, a model, or a network — and so the one property that matters most
 * is checkable rather than assumed:
 *
 * **A scan that cannot look never calls the model.** The feasibility check
 * happens first and, when it fails, the run records a `no-source` outcome and
 * returns. It does not "try anyway and see what comes back", because what comes
 * back would be fluent, specific, indistinguishable from research, and free of
 * any signal that nobody looked anything up. A test asserts the model was not
 * invoked; without that assertion this is a comment, and comments do not stop
 * anybody spending money on a hallucinated market report.
 *
 * Three smaller decisions follow from the same posture.
 *
 * **A failed model call is recorded, not swallowed.** The register keeps a run
 * with `outcome: 'failed'`, which `hasBeenScanned` deliberately does not count as
 * an assessment — so the scan still reads as never answered, and the attempt is
 * still visible. Both facts are true and neither implies the other.
 *
 * **What the run could not assess is carried into the record**, not just into the
 * message on screen. A hybrid scan that read the repository and could not reach
 * the outside world is a partial answer, and a register that stored it as a whole
 * one would be lying by omission the next time anybody read it.
 *
 * **The roadmap comparison is computed here, from the caller's roadmap.** It
 * feeds the severity rule that asks whether a competitor covers something this
 * project also claims — a fact about *our* repository, which a model has no
 * business asserting.
 */

import {
  buildResearchScanPrompt,
  researchScan,
  type ResearchScanId,
} from './researchScanCatalog.js';
import {
  parseResearchFindings,
  recordScanRun,
  reconcileScanFindings,
  sanitizeIncomingFindings,
  type ResearchHistoryEntry,
  type ResearchRegister,
  type ResearchRunOutcome,
} from './researchRegister.js';
import { assessScanFeasibility, type ResearchSourceResolution } from './researchSources.js';

/** What the agent returned, or why it did not. */
export type ResearchAgentResult =
  | { readonly ok: true; readonly text: string; readonly costUsd?: number }
  | { readonly ok: false; readonly error: string };

export interface ResearchRunDeps {
  /** Runs the scan's advisor. Never called when the scan cannot look. */
  runAgent(agentId: string, prompt: string): Promise<ResearchAgentResult>;
  getRegister(): ResearchRegister;
  saveRegister(register: ResearchRegister): Promise<void>;
  appendHistory(entry: ResearchHistoryEntry): Promise<void>;
  /** What can answer an outward question right now. */
  sources: ResearchSourceResolution;
  /** The project in one line, so a scan is about this rather than the category. */
  projectSummary: string;
  /** Normalized roadmap item text, for the overlap rule. */
  roadmapTitles: ReadonlySet<string>;
  now: Date;
}

export interface ResearchRunResult {
  readonly scanId: ResearchScanId;
  readonly outcome: ResearchRunOutcome;
  /** One sentence, safe to show as-is. */
  readonly message: string;
  readonly findings: number;
  readonly questions: number;
  readonly superseded: number;
  readonly unreadable: number;
  /** Present whenever part of the question went unanswered. */
  readonly unassessed?: string;
  /** Present on `no-source`: what would make the scan possible. */
  readonly setupStep?: string;
}

export async function runResearchScan(
  scanId: ResearchScanId,
  deps: ResearchRunDeps,
): Promise<ResearchRunResult> {
  const scan = researchScan(scanId);
  const stamp = deps.now.toISOString();
  const feasibility = assessScanFeasibility(scan.evidenceClass, deps.sources);

  if (!feasibility.canRun) {
    // Refused before the model is reached. This is the point of the module.
    const register = recordScanRun(deps.getRegister(), {
      scanId,
      ranAt: stamp,
      outcome: 'no-source',
      findingCount: 0,
      questionCount: 0,
      ...(feasibility.unassessed ? { unassessed: feasibility.unassessed } : {}),
    });
    await deps.saveRegister(register);
    await deps.appendHistory({
      id: `run-${scanId}-${stamp}`,
      kind: 'scan-run',
      scanId,
      at: stamp,
      summary: `${scan.label} was not run: no research source could answer it.`,
    });
    return {
      scanId,
      outcome: 'no-source',
      message: `${scan.label} was not run. ${feasibility.reason ?? deps.sources.noSourceReason ?? 'No research source is available.'}`,
      findings: 0,
      questions: 0,
      superseded: 0,
      unreadable: 0,
      ...(feasibility.unassessed ? { unassessed: feasibility.unassessed } : {}),
      ...(deps.sources.setupStep ? { setupStep: deps.sources.setupStep } : {}),
    };
  }

  const prompt = buildResearchScanPrompt(scanId, {
    projectSummary: deps.projectSummary,
    canDiscover: deps.sources.canDiscover,
    ...(feasibility.unassessed ? { unassessed: feasibility.unassessed } : {}),
  });

  const result = await deps.runAgent(scan.agentId, prompt);
  if (!result.ok) {
    const register = recordScanRun(deps.getRegister(), {
      scanId,
      ranAt: stamp,
      outcome: 'failed',
      findingCount: 0,
      questionCount: 0,
      unassessed: 'The run did not complete, so nothing about this question was assessed.',
    });
    await deps.saveRegister(register);
    await deps.appendHistory({
      id: `run-${scanId}-${stamp}`,
      kind: 'scan-run',
      scanId,
      at: stamp,
      summary: `${scan.label} failed: ${result.error}`,
    });
    return {
      scanId,
      outcome: 'failed',
      message: `${scan.label} failed: ${result.error}`,
      findings: 0,
      questions: 0,
      superseded: 0,
      unreadable: 0,
      unassessed: 'The run did not complete.',
    };
  }

  const raw = parseResearchFindings(result.text);
  const sanitized = sanitizeIncomingFindings(raw, scanId, deps.now, { roadmapTitles: deps.roadmapTitles });
  // Questions are reconciled alongside findings: they are records too, and
  // leaving them out would mean a claim demoted last month reappears as new
  // every single run.
  const incoming = [...sanitized.findings, ...sanitized.questions];
  const reconciled = reconcileScanFindings(deps.getRegister().findings, incoming, scanId, deps.now);

  const register = recordScanRun(
    { ...deps.getRegister(), findings: reconciled.findings },
    {
      scanId,
      ranAt: stamp,
      outcome: 'ok',
      findingCount: sanitized.findings.length,
      questionCount: sanitized.questions.length,
      ...(feasibility.unassessed ? { unassessed: feasibility.unassessed } : {}),
      ...(deps.sources.selected ? { source: deps.sources.selected } : {}),
      ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
    },
  );
  await deps.saveRegister(register);
  await deps.appendHistory({
    id: `run-${scanId}-${stamp}`,
    kind: 'scan-run',
    scanId,
    at: stamp,
    summary: `${scan.label} recorded ${sanitized.findings.length} finding`
      + `${sanitized.findings.length === 1 ? '' : 's'} and ${sanitized.questions.length} `
      + `unsourced claim${sanitized.questions.length === 1 ? '' : 's'}.`,
  });

  return {
    scanId,
    outcome: 'ok',
    message: describeRun(scan.label, sanitized.findings.length, sanitized.questions.length, reconciled.superseded),
    findings: sanitized.findings.length,
    questions: sanitized.questions.length,
    superseded: reconciled.superseded,
    unreadable: sanitized.unreadable,
    ...(feasibility.unassessed ? { unassessed: feasibility.unassessed } : {}),
  };
}

/**
 * The sentence a user reads afterwards.
 *
 * "Nothing recorded" and "nothing found" are different claims and the second one
 * is not ours to make when everything the model said arrived without a source —
 * so the unsourced count is stated rather than folded into a zero.
 */
function describeRun(label: string, findings: number, questions: number, superseded: number): string {
  const parts: string[] = [];
  if (findings === 0 && questions === 0) {
    return `${label}: nothing material found.`;
  }
  if (findings > 0) {
    parts.push(`${findings} finding${findings === 1 ? '' : 's'}`);
  }
  if (questions > 0) {
    parts.push(
      `${questions} claim${questions === 1 ? '' : 's'} with no source, kept as question${questions === 1 ? '' : 's'} rather than evidence`,
    );
  }
  if (superseded > 0) {
    parts.push(`${superseded} earlier finding${superseded === 1 ? '' : 's'} no longer reproduced`);
  }
  return `${label}: ${parts.join(', ')}.`;
}
