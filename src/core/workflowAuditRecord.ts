/**
 * The workflow audit record — what was done, by whom, at what level, and why.
 *
 * Every other part of this workflow makes a determinism claim: branch names are
 * derived, pull-request titles are classified by rule, CI failures are matched
 * against an ordered table, release notes are copied verbatim. Those claims are
 * either verifiable or they are marketing. This is what makes them verifiable.
 *
 * **Fingerprints, not payloads.** A record stores a hash of the inputs and a
 * hash of the outputs, never the values. That is not a size optimisation — this
 * ledger lives in `project_memory/`, which is **git-tracked**, so storing what
 * was actually processed would commit issue bodies, review comments and CI logs
 * into the repository. Fingerprinting proves that the same input produced the
 * same output without publishing either.
 *
 * **A stage that cannot write its record does not proceed.** The ordering is
 * record-then-act, and it is the wrong way round from the obvious one on
 * purpose: a record written afterwards is missing exactly when it matters most,
 * because the run that crashed is the run somebody needs to read about. Writing
 * first can leave a record for an action that then failed — which is why
 * `outcome` exists, and why `started` is a real outcome rather than a gap.
 *
 * **Append-only.** Records transition through `complete` or `failed`; they are
 * never deleted or rewritten. The ledger is capped, but truncation is *stated*
 * in the file rather than applied silently — a ledger that quietly forgot is
 * worse than one that says how much it is holding.
 *
 * Pure and `vscode`-free; persistence uses node `fs` only.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WorkflowStageId } from './workflowCurriculum.js';
import type { AutomationLevel } from './workflowAutomation.js';

export const WORKFLOW_HISTORY_SSOT_PATH = 'project_memory/operations/workflow-history.json';
export const WORKFLOW_HISTORY_SUMMARY_SSOT_PATH = 'project_memory/operations/workflow-history.md';

/**
 * How many records the ledger retains.
 *
 * Bounded because it is committed, and an unbounded file in a repository
 * eventually becomes a file nobody diffs. Matches `MAX_RISK_HISTORY`.
 */
export const MAX_WORKFLOW_HISTORY = 1000;

/**
 * Who performed the action.
 *
 * Deliberately coarse. This file is committed, so a name or an email address
 * here would be personal data in a public repository — and it would add nothing:
 * git already records who committed the change, with far better provenance than
 * a string AtlasMind wrote about itself.
 */
export type WorkflowActor = 'user' | 'agent' | 'automation';

export type WorkflowRunOutcome = 'started' | 'complete' | 'failed' | 'refused';

export interface WorkflowGateResult {
  /** Which gate. `master`, `ceiling`, `capability`, `stage`, or a named check. */
  gate: string;
  passed: boolean;
  detail?: string;
}

export interface WorkflowRunRecord {
  /** Deterministic id: stage + timestamp + input fingerprint. */
  id: string;
  stageId: WorkflowStageId;
  /** What happened, in a few words. Never a payload. */
  action: string;
  at: string;
  actor: WorkflowActor;
  /** The level the stage asked for. */
  requestedLevel: AutomationLevel;
  /** The level the ladder actually allowed. */
  effectiveLevel: AutomationLevel;
  /** Which gate bound the level, when one did. */
  limitedBy?: string;
  gates: WorkflowGateResult[];
  inputsFingerprint: string;
  /** Absent until the action completes. Its absence is itself information. */
  outputsFingerprint?: string;
  outcome: WorkflowRunOutcome;
  /** Why it failed or was refused. Sanitized; never a payload. */
  detail?: string;
}

export interface WorkflowHistoryFile {
  version: 1;
  /** Records, newest first. */
  records: WorkflowRunRecord[];
  /**
   * How many records were dropped by the cap, cumulatively.
   *
   * Present so truncation is a stated fact rather than a silent one. A ledger
   * that quietly forgot is worse than one that says how much it is holding.
   */
  droppedByCap?: number;
}

// ── Fingerprinting ───────────────────────────────────────────────

/**
 * Canonical JSON: object keys sorted recursively, so key order cannot change a
 * fingerprint.
 *
 * Without this the whole determinism claim is worthless — `{a:1,b:2}` and
 * `{b:2,a:1}` describe the same input and would hash differently, so two
 * identical runs would look like a determinism breach and the check would cry
 * wolf until somebody turned it off.
 *
 * `undefined` is dropped rather than encoded, matching `JSON.stringify`, so an
 * absent key and an explicitly-undefined one agree.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => canonicalJson(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
}

/**
 * A fingerprint of any JSON-shaped value.
 *
 * Truncated to 16 hex characters — 64 bits. Long enough that an accidental
 * collision across a thousand records is not a practical concern, short enough
 * that a human comparing two records in a diff can actually do it by eye, which
 * is the whole point of putting it in a committed file. This is not a security
 * boundary: nothing decides an authorization from a fingerprint.
 */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex').slice(0, 16);
}

// ── Records ──────────────────────────────────────────────────────

export interface BeginWorkflowRunInput {
  stageId: WorkflowStageId;
  action: string;
  actor: WorkflowActor;
  requestedLevel: AutomationLevel;
  effectiveLevel: AutomationLevel;
  limitedBy?: string;
  gates?: WorkflowGateResult[];
  /** Whatever determines the outcome. Hashed, never stored. */
  inputs: unknown;
  /** ISO timestamp. Passed in so the record is reproducible in a test. */
  at: string;
}

/**
 * Open a record for an action that is about to happen.
 *
 * `outcome: 'started'` is a real state, not a placeholder. A run that never
 * reached `complete` left a record saying so, and that is more useful than
 * either no record or an optimistic one — it is the difference between "we do
 * not know what happened" and "it began and did not finish".
 */
export function beginWorkflowRun(input: BeginWorkflowRunInput): WorkflowRunRecord {
  const inputsFingerprint = fingerprint(input.inputs);
  return {
    id: `${input.stageId}-${input.at}-${inputsFingerprint}`,
    stageId: input.stageId,
    action: sanitizeDetail(input.action) ?? 'unnamed action',
    at: input.at,
    actor: input.actor,
    requestedLevel: input.requestedLevel,
    effectiveLevel: input.effectiveLevel,
    ...(input.limitedBy === undefined ? {} : { limitedBy: input.limitedBy }),
    gates: input.gates ?? [],
    inputsFingerprint,
    outcome: 'started',
  };
}

/** Close a record. Returns a new record; the input is never mutated. */
export function completeWorkflowRun(
  record: WorkflowRunRecord,
  result: { outputs?: unknown; outcome: Exclude<WorkflowRunOutcome, 'started'>; detail?: string },
): WorkflowRunRecord {
  return {
    ...record,
    outcome: result.outcome,
    // A failed run has no outputs, and fingerprinting `undefined` would produce
    // a real-looking hash for something that never existed.
    ...(result.outputs === undefined ? {} : { outputsFingerprint: fingerprint(result.outputs) }),
    ...(sanitizeDetail(result.detail) === undefined ? {} : { detail: sanitizeDetail(result.detail)! }),
  };
}

/** Strip control characters and clamp. Nothing here should carry a payload. */
function sanitizeDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 300) : undefined;
}

// ── Determinism ──────────────────────────────────────────────────

export interface DeterminismBreach {
  stageId: WorkflowStageId;
  action: string;
  inputsFingerprint: string;
  /** The differing output fingerprints, and one record id for each. */
  outputs: Array<{ outputsFingerprint: string; recordId: string; at: string }>;
}

/**
 * Where the same input produced different outputs.
 *
 * This is the check the whole record exists to make possible: two runs sharing
 * an `inputsFingerprint` must share an `outputsFingerprint`, and a mismatch
 * names the stage and both runs rather than reporting a bare count. A count
 * tells somebody they have a problem; the ids tell them where it is.
 *
 * Grouped by `(stageId, action, inputsFingerprint)` — the same inputs to
 * *different* actions have no reason to agree, and treating them as a breach
 * would fill the report with false positives nobody could act on.
 *
 * Incomplete runs are skipped. A run that failed has no output, and comparing
 * "no output" against a real one would report every failure as non-determinism.
 */
export function findDeterminismBreaches(
  records: readonly WorkflowRunRecord[],
): DeterminismBreach[] {
  const groups = new Map<string, WorkflowRunRecord[]>();
  for (const record of records) {
    if (record.outputsFingerprint === undefined || record.outcome !== 'complete') {
      continue;
    }
    // Grouped on all three: the same inputs to a *different* action have no
    // reason to agree, and treating them as one group would fill the report
    // with false positives nobody could act on.
    const key = `${record.stageId} ${record.action} ${record.inputsFingerprint}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const breaches: DeterminismBreach[] = [];
  for (const group of groups.values()) {
    const distinct = new Map<string, WorkflowRunRecord>();
    for (const record of group) {
      if (!distinct.has(record.outputsFingerprint!)) {
        distinct.set(record.outputsFingerprint!, record);
      }
    }
    if (distinct.size < 2) {
      continue;
    }
    const first = group[0]!;
    breaches.push({
      stageId: first.stageId,
      action: first.action,
      inputsFingerprint: first.inputsFingerprint,
      outputs: [...distinct.values()]
        .map(record => ({
          outputsFingerprint: record.outputsFingerprint!,
          recordId: record.id,
          at: record.at,
        }))
        // Oldest first: the question is what changed, and that reads forwards.
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    });
  }

  return breaches;
}

export interface WorkflowHistorySummary {
  total: number;
  /** Runs that began and never reached a terminal outcome. */
  unfinished: number;
  failed: number;
  refused: number;
  /** Counts per stage, for the chart. */
  byStage: Array<{ key: string; label: string; value: number }>;
  /** Counts per outcome. */
  byOutcome: Array<{ key: string; label: string; value: number }>;
  breaches: DeterminismBreach[];
  droppedByCap: number;
}

export function summarizeWorkflowHistory(file: WorkflowHistoryFile): WorkflowHistorySummary {
  const records = file.records;
  const stageCounts = new Map<string, number>();
  const outcomeCounts = new Map<string, number>();

  for (const record of records) {
    stageCounts.set(record.stageId, (stageCounts.get(record.stageId) ?? 0) + 1);
    outcomeCounts.set(record.outcome, (outcomeCounts.get(record.outcome) ?? 0) + 1);
  }

  return {
    total: records.length,
    unfinished: outcomeCounts.get('started') ?? 0,
    failed: outcomeCounts.get('failed') ?? 0,
    refused: outcomeCounts.get('refused') ?? 0,
    byStage: [...stageCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, label: key, value })),
    byOutcome: [...outcomeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, label: key, value })),
    breaches: findDeterminismBreaches(records),
    droppedByCap: file.droppedByCap ?? 0,
  };
}

// ── Reading ──────────────────────────────────────────────────────

const EMPTY_HISTORY: WorkflowHistoryFile = { version: 1, records: [] };

/**
 * Read the ledger. Total: a malformed file reads as empty rather than throwing.
 *
 * Empty and unreadable deliberately produce the same value here, because they
 * lead to the same action — start appending — and the alternative would be a
 * surface reporting "your audit trail is corrupt" for a repository that simply
 * has not run anything yet.
 */
export function readWorkflowHistory(workspaceRoot: string): WorkflowHistoryFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspaceRoot, WORKFLOW_HISTORY_SSOT_PATH), 'utf8'));
  } catch {
    return { ...EMPTY_HISTORY, records: [] };
  }
  return sanitizeWorkflowHistory(parsed);
}

export function sanitizeWorkflowHistory(input: unknown): WorkflowHistoryFile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...EMPTY_HISTORY, records: [] };
  }
  const raw = input as Record<string, unknown>;
  const records = Array.isArray(raw['records'])
    ? raw['records']
      .slice(0, MAX_WORKFLOW_HISTORY)
      .map(entry => sanitizeRecord(entry))
      .filter((entry): entry is WorkflowRunRecord => entry !== undefined)
    : [];
  const dropped = Number(raw['droppedByCap']);
  return {
    version: 1,
    records,
    ...(Number.isFinite(dropped) && dropped > 0 ? { droppedByCap: Math.floor(dropped) } : {}),
  };
}

const OUTCOMES: readonly WorkflowRunOutcome[] = ['started', 'complete', 'failed', 'refused'];
const ACTORS: readonly WorkflowActor[] = ['user', 'agent', 'automation'];
const LEVELS: readonly AutomationLevel[] = ['off', 'observe', 'draft', 'propose', 'auto'];

function sanitizeRecord(entry: unknown): WorkflowRunRecord | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const raw = entry as Record<string, unknown>;
  const id = sanitizeDetail(raw['id']);
  const stageId = raw['stageId'];
  const at = sanitizeDetail(raw['at']);
  const inputsFingerprint = sanitizeDetail(raw['inputsFingerprint']);
  // A record missing any of these is not a record — it is a fragment, and
  // repairing it would fabricate history, which is the one thing an audit
  // trail must never do.
  if (!id || typeof stageId !== 'string' || !at || !inputsFingerprint) {
    return undefined;
  }

  const outcome = OUTCOMES.includes(raw['outcome'] as WorkflowRunOutcome)
    ? raw['outcome'] as WorkflowRunOutcome
    : 'started';
  const actor = ACTORS.includes(raw['actor'] as WorkflowActor)
    ? raw['actor'] as WorkflowActor
    : 'automation';
  const level = (value: unknown): AutomationLevel =>
    LEVELS.includes(value as AutomationLevel) ? value as AutomationLevel : 'off';

  return {
    id,
    stageId: stageId as WorkflowStageId,
    action: sanitizeDetail(raw['action']) ?? 'unnamed action',
    at,
    actor,
    requestedLevel: level(raw['requestedLevel']),
    effectiveLevel: level(raw['effectiveLevel']),
    ...(sanitizeDetail(raw['limitedBy']) === undefined ? {} : { limitedBy: sanitizeDetail(raw['limitedBy'])! }),
    gates: Array.isArray(raw['gates'])
      ? raw['gates'].slice(0, 20)
        .map(gate => sanitizeGate(gate))
        .filter((gate): gate is WorkflowGateResult => gate !== undefined)
      : [],
    inputsFingerprint,
    ...(sanitizeDetail(raw['outputsFingerprint']) === undefined
      ? {} : { outputsFingerprint: sanitizeDetail(raw['outputsFingerprint'])! }),
    outcome,
    ...(sanitizeDetail(raw['detail']) === undefined ? {} : { detail: sanitizeDetail(raw['detail'])! }),
  };
}

function sanitizeGate(entry: unknown): WorkflowGateResult | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const raw = entry as Record<string, unknown>;
  const gate = sanitizeDetail(raw['gate']);
  if (!gate) {
    return undefined;
  }
  return {
    gate,
    passed: raw['passed'] === true,
    ...(sanitizeDetail(raw['detail']) === undefined ? {} : { detail: sanitizeDetail(raw['detail'])! }),
  };
}

// ── Writing ──────────────────────────────────────────────────────

/**
 * Append a record, newest first, capped.
 *
 * Appending a record whose `id` already exists **replaces** it. That is the one
 * non-append operation, and it exists for exactly one purpose: closing a record
 * that was opened before the action ran. Anything else would be rewriting
 * history.
 */
export function appendWorkflowRecord(
  file: WorkflowHistoryFile,
  record: WorkflowRunRecord,
): WorkflowHistoryFile {
  const existing = file.records.findIndex(entry => entry.id === record.id);
  const records = existing >= 0
    ? file.records.map((entry, index) => (index === existing ? record : entry))
    : [record, ...file.records];

  const kept = records.slice(0, MAX_WORKFLOW_HISTORY);
  const dropped = (file.droppedByCap ?? 0) + Math.max(0, records.length - kept.length);

  return {
    version: 1,
    records: kept,
    ...(dropped > 0 ? { droppedByCap: dropped } : {}),
  };
}

/**
 * The human-readable mirror.
 *
 * Shows the twenty most recent records rather than all of them — a thousand
 * rows in a markdown file is not something anybody reads, and the JSON is
 * already the complete record. Deterministic, so the same ledger renders
 * byte-identically.
 */
export function renderWorkflowHistoryMarkdown(file: WorkflowHistoryFile): string {
  const summary = summarizeWorkflowHistory(file);
  const lines: string[] = [
    '# Workflow history',
    '',
    '> Generated from `workflow-history.json` by AtlasMind. Append-only — records',
    '> transition, they are never deleted or rewritten. Hand edits are lost.',
    '',
    `- **Records held:** ${summary.total}${summary.droppedByCap > 0 ? ` (${summary.droppedByCap} older records dropped by the ${MAX_WORKFLOW_HISTORY}-record cap)` : ''}`,
    `- **Unfinished:** ${summary.unfinished} · **failed:** ${summary.failed} · **refused:** ${summary.refused}`,
    '',
    'Inputs and outputs are recorded as **fingerprints, not values**. This file is',
    'committed, so storing what was processed would put issue bodies, review',
    'comments and CI logs into the repository. A fingerprint proves the same input',
    'produced the same output without publishing either.',
    '',
  ];

  if (summary.breaches.length > 0) {
    lines.push(
      '## Determinism breaches',
      '',
      'The same inputs produced different outputs. Each row names both runs.',
      '',
      '| Stage | Action | Inputs | Outputs |',
      '|---|---|---|---|',
      ...summary.breaches.map(breach => [
        '', breach.stageId, breach.action, `\`${breach.inputsFingerprint}\``,
        breach.outputs.map(output => `\`${output.outputsFingerprint}\` (${output.at})`).join(' vs '),
        '',
      ].join(' | ').trim()),
      '',
    );
  }

  lines.push(
    '## Recent runs',
    '',
    '| When | Stage | Action | Level | Outcome | Inputs | Outputs |',
    '|---|---|---|---|---|---|---|',
  );

  for (const record of file.records.slice(0, 20)) {
    lines.push([
      '',
      record.at,
      record.stageId,
      record.action,
      record.effectiveLevel === record.requestedLevel
        ? `\`${record.effectiveLevel}\``
        : `\`${record.effectiveLevel}\` (asked for \`${record.requestedLevel}\`${record.limitedBy ? `, capped by ${record.limitedBy}` : ''})`,
      record.outcome,
      `\`${record.inputsFingerprint}\``,
      record.outputsFingerprint ? `\`${record.outputsFingerprint}\`` : '—',
      '',
    ].join(' | ').trim());
  }

  if (file.records.length === 0) {
    lines.push('| _no runs recorded yet_ | | | | | | |');
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Persist the ledger and its mirror.
 *
 * The caller must treat a rejection as fatal to the action it was recording:
 * **a stage that cannot write its record does not proceed.** That rule is the
 * reason this returns a promise that is allowed to reject rather than swallowing
 * the error the way the best-effort writers elsewhere do.
 */
export async function writeWorkflowHistory(
  workspaceRoot: string,
  file: WorkflowHistoryFile,
): Promise<void> {
  const jsonPath = path.join(workspaceRoot, WORKFLOW_HISTORY_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, WORKFLOW_HISTORY_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(file, null, 2), 'utf-8'),
    writeFile(summaryPath, renderWorkflowHistoryMarkdown(file), 'utf-8'),
  ]);
}

/**
 * Holds the ledger for the extension host.
 *
 * `record()` writes before returning, and lets the rejection through. Every call
 * site must therefore `await` it *before* doing the thing it describes — which
 * is the whole contract, expressed in the one place a caller cannot avoid
 * noticing it.
 */
export class WorkflowAuditLedger {
  private file: WorkflowHistoryFile;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.file = workspaceRoot ? readWorkflowHistory(workspaceRoot) : { version: 1, records: [] };
  }

  getFile(): WorkflowHistoryFile {
    return this.file;
  }

  getSummary(): WorkflowHistorySummary {
    return summarizeWorkflowHistory(this.file);
  }

  reload(): void {
    this.file = this.workspaceRoot ? readWorkflowHistory(this.workspaceRoot) : { version: 1, records: [] };
  }

  /**
   * Append a record and persist it. Rejects if it cannot be written.
   *
   * Without a workspace there is nowhere to write, and no action to record
   * either — every workflow action needs a repository. The in-memory ledger
   * still updates so a surface has something to show.
   */
  async record(record: WorkflowRunRecord): Promise<void> {
    this.file = appendWorkflowRecord(this.file, record);
    if (this.workspaceRoot) {
      await writeWorkflowHistory(this.workspaceRoot, this.file);
    }
  }
}
