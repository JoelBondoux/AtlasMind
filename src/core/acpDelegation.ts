/**
 * Handing a turn — a planner subtask, usually — to an ACP agent, and keeping
 * AtlasMind's own record of what it did.
 *
 * Tier 3 of `project_memory/roadmap/acp-integration.md`. The agent supplies
 * execution; AtlasMind keeps authorization, the rollback point and the record.
 * The agent's account of its work (tool calls, a plan) arrives over the wire
 * and is useful, but it is a claim: Codex reports an edit's path only in a
 * diff block, Claude only in `locations`, and a shell command reports nothing
 * about the files it touched. So the record of what changed is taken from the
 * workspace, before and after, and the agent's account is checked against it.
 *
 * Six rules.
 *
 * 1. **The workspace is the record, the agent's account is a cross-check.**
 *    `changedFiles` comes from git — `status --porcelain` before and after, with
 *    content hashes so a file that was already dirty and was edited again still
 *    counts — and a change no reported call named is listed as *unreported*
 *    rather than dropped or blamed on the nearest call.
 * 2. **No git, no verification — and it says so.** Outside a repository, or if
 *    git cannot answer, the record is `unverified` with the reason, and lists
 *    only what the agent reported. An empty `changedFiles` there would read as
 *    "changed nothing", which nobody observed.
 * 3. **Checkpoint at approval, before the write.** Every edit asks first
 *    (`ACP_ASKING_MODES`), so the files an approved edit names are snapshotted
 *    while they are still as they were. An edit that names no file, or a file
 *    outside the folder the turn was given, is refused: AtlasMind cannot take a
 *    rollback point for it, and an edit it could not undo is not one it agreed
 *    to on these terms.
 * 4. **A change with no rollback point is named.** A command can change files
 *    no edit named; those are listed as `notCheckpointed`, so nobody believes a
 *    rollback will restore them.
 * 5. **Only constant git commands.** The arguments are module constants; no
 *    path or text from the agent reaches git's command line. Paths reach
 *    `hash-object` on stdin, one per line, which is the interface it documents
 *    for exactly this.
 * 6. **Bounded.** Past `MAX_RECONCILED_ENTRIES` dirty paths the comparison is
 *    abandoned as unverified rather than half-done, because a partial list
 *    reads as a complete one.
 *
 * Pure apart from the injected `runGit`.
 */

import * as nodePath from 'node:path';
import type { ChangedWorkspaceFile, DelegatedExecutionRecord, ToolExecutionArtifact } from '../types.js';
import type { DelegatedPlanStep, DelegatedToolCall } from '../providers/adapter.js';

/** The tool name a delegated edit's checkpoint is filed under. */
export const ACP_DELEGATED_EDIT_CHECKPOINT_TOOL = 'acp-delegated-edit';

/**
 * `--porcelain` paths are relative to the *repository* root whatever the
 * working directory, while `hash-object` resolves paths against its working
 * directory; a workspace that is a subfolder of its repository needs the
 * prefix to line the two up, and `-- .` keeps the status to that subfolder.
 */
export const GIT_PREFIX_ARGS: readonly string[] = ['rev-parse', '--show-prefix'];
export const GIT_STATUS_ARGS: readonly string[] = ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'];
export const GIT_HASH_ARGS: readonly string[] = ['hash-object', '--stdin-paths'];

/** Beyond this many uncommitted paths the before/after comparison is not attempted. */
export const MAX_RECONCILED_ENTRIES = 5_000;

/** Operation kinds that change files and therefore need a rollback point. */
const FILE_CHANGING_KINDS: ReadonlySet<string> = new Set(['edit', 'delete', 'move']);

export type RunGit = (args: readonly string[], cwd: string, stdin?: string) => Promise<string>;

/** Uncommitted state of a working tree: relative POSIX path → porcelain code and content hash. */
export type GitWorkingState =
  | { kind: 'git'; entries: Map<string, { code: string; hash?: string }> }
  | { kind: 'unavailable'; reason: string };

/**
 * Parse `git status --porcelain=v1 -z`. Each entry is `XY path`, NUL-ended; a
 * rename or copy is followed by its original path as a separate field, which
 * is skipped — the new path is the one that exists.
 */
export function parsePorcelainZ(output: string): Map<string, string> {
  const entries = new Map<string, string>();
  const fields = output.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field || field.length < 4) {
      continue;
    }
    const code = field.slice(0, 2);
    const filePath = field.slice(3);
    entries.set(filePath, code);
    if (code[0] === 'R' || code[0] === 'C') {
      index += 1;
    }
  }
  return entries;
}

function isDeletedCode(code: string): boolean {
  return code[0] === 'D' || code[1] === 'D';
}

/** Read the working tree's uncommitted state. Never throws. */
export async function captureGitWorkingState(root: string, runGit: RunGit | undefined): Promise<GitWorkingState> {
  if (!runGit) {
    return { kind: 'unavailable', reason: 'no git runner is available here' };
  }
  let status: string;
  let prefix: string;
  try {
    prefix = (await runGit(GIT_PREFIX_ARGS, root)).trim();
    status = await runGit(GIT_STATUS_ARGS, root);
  } catch (error) {
    return { kind: 'unavailable', reason: `git could not report the working tree (${describe(error)})` };
  }
  const codes = new Map<string, string>();
  for (const [repoPath, code] of parsePorcelainZ(status)) {
    if (!prefix || repoPath.startsWith(prefix)) {
      codes.set(prefix ? repoPath.slice(prefix.length) : repoPath, code);
    }
  }
  if (codes.size > MAX_RECONCILED_ENTRIES) {
    return { kind: 'unavailable', reason: `more than ${MAX_RECONCILED_ENTRIES} uncommitted paths — too many to compare reliably` };
  }
  const present = [...codes.entries()].filter(([, code]) => !isDeletedCode(code)).map(([filePath]) => filePath);
  const hashes = new Map<string, string>();
  if (present.length > 0) {
    try {
      const output = await runGit(GIT_HASH_ARGS, root, `${present.join('\n')}\n`);
      const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (lines.length !== present.length) {
        return { kind: 'unavailable', reason: 'git did not hash every uncommitted file' };
      }
      present.forEach((filePath, index) => hashes.set(filePath, lines[index]!));
    } catch (error) {
      return { kind: 'unavailable', reason: `git could not hash the uncommitted files (${describe(error)})` };
    }
  }
  const entries = new Map<string, { code: string; hash?: string }>();
  for (const [filePath, code] of codes) {
    const hash = hashes.get(filePath);
    entries.set(filePath, hash ? { code, hash } : { code });
  }
  return { kind: 'git', entries };
}

/**
 * What changed between two readings of one working tree. A path dirty in both
 * counts only if its content differs; a path dirty before and clean after was
 * put back to what is committed, which is a change too.
 */
export function reconcileWorkingStates(
  before: Extract<GitWorkingState, { kind: 'git' }>,
  after: Extract<GitWorkingState, { kind: 'git' }>,
): ChangedWorkspaceFile[] {
  const changed = new Map<string, ChangedWorkspaceFile['status']>();
  for (const [filePath, now] of after.entries) {
    const was = before.entries.get(filePath);
    if (!was) {
      changed.set(filePath, now.code === '??' || now.code[0] === 'A' ? 'created' : isDeletedCode(now.code) ? 'deleted' : 'modified');
      continue;
    }
    if (isDeletedCode(now.code) && !isDeletedCode(was.code)) {
      changed.set(filePath, 'deleted');
    } else if (!isDeletedCode(now.code) && isDeletedCode(was.code)) {
      changed.set(filePath, 'created');
    } else if (was.hash !== now.hash) {
      changed.set(filePath, 'modified');
    }
  }
  for (const [filePath, was] of before.entries) {
    if (!after.entries.has(filePath)) {
      // Now matches what is committed. An untracked file that vanished was
      // deleted; anything else was restored, which is a modification.
      changed.set(filePath, was.code === '??' ? 'deleted' : 'modified');
    }
  }
  return [...changed.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, status]) => ({ relativePath, status }));
}

export interface PathRules {
  platform: string;
}

function pathApi(rules: PathRules): typeof nodePath.posix {
  return rules.platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

/** A path relative to `root` in POSIX form, or undefined when it is not inside it. */
function relativeInside(root: string, candidate: string, rules: PathRules): string | undefined {
  const api = pathApi(rules);
  const absolute = api.isAbsolute(candidate) ? api.normalize(candidate) : api.resolve(root, candidate);
  const relative = api.relative(api.normalize(root), absolute);
  if (!relative || relative.startsWith('..') || api.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(api.sep).join('/');
}

export type DelegatedCheckpointPlan =
  | { action: 'none' }
  | { action: 'checkpoint'; absolutePaths: string[]; relativePaths: string[] }
  | { action: 'refuse'; reason: string };

/** What to snapshot before an approved operation is allowed to run. */
export function planDelegatedCheckpoint(call: DelegatedToolCall, root: string, rules: PathRules): DelegatedCheckpointPlan {
  if (!FILE_CHANGING_KINDS.has(call.kind)) {
    return { action: 'none' };
  }
  if (call.locations.length === 0) {
    return {
      action: 'refuse',
      reason: `the agent asked to ${call.kind} without naming the file, so AtlasMind could not take a rollback point first`,
    };
  }
  const api = pathApi(rules);
  const absolutePaths: string[] = [];
  const relativePaths: string[] = [];
  for (const location of call.locations) {
    const relative = relativeInside(root, location, rules);
    if (relative === undefined) {
      return {
        action: 'refuse',
        reason: `the agent asked to ${call.kind} ${location}, which is outside the folder this turn was given`,
      };
    }
    relativePaths.push(relative);
    absolutePaths.push(api.join(api.normalize(root), ...relative.split('/')));
  }
  return { action: 'checkpoint', absolutePaths, relativePaths };
}

function sameFile(left: string, right: string, rules: PathRules): boolean {
  return rules.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** The record of one delegated turn, or of several merged. */
export function buildDelegatedExecutionRecord(input: {
  model: string;
  root: string;
  rules: PathRules;
  before: GitWorkingState;
  after: GitWorkingState;
  toolCalls: readonly DelegatedToolCall[];
  checkpointedPaths: readonly string[];
  checkpointTaskId?: string;
  plan?: readonly DelegatedPlanStep[];
}): DelegatedExecutionRecord {
  const reported = input.toolCalls
    .flatMap(call => call.locations)
    .map(location => relativeInside(input.root, location, input.rules))
    .filter((location): location is string => location !== undefined);
  const base = {
    model: input.model,
    toolCallCount: input.toolCalls.length,
    ...(input.checkpointTaskId ? { checkpointTaskId: input.checkpointTaskId } : {}),
    ...(input.plan && input.plan.length > 0 ? { plan: input.plan.map(step => ({ ...step })) } : {}),
  };
  if (input.before.kind !== 'git' || input.after.kind !== 'git') {
    const reason = input.before.kind !== 'git' ? input.before.reason : (input.after as { reason: string }).reason;
    const reportedChanges = input.toolCalls
      .filter(call => FILE_CHANGING_KINDS.has(call.kind) && call.status !== 'failed')
      .flatMap(call => call.locations)
      .map(location => relativeInside(input.root, location, input.rules))
      .filter((location): location is string => location !== undefined);
    return {
      ...base,
      verification: 'unverified',
      verificationNote: `What changed could not be checked against the workspace: ${reason}. The files listed are the ones the agent reported.`,
      changedFiles: [...new Set(reportedChanges)].sort().map(relativePath => ({ relativePath, status: 'modified' as const })),
      unreportedChanges: [],
      notCheckpointed: [],
    };
  }
  const changedFiles = reconcileWorkingStates(input.before, input.after);
  const named = (candidate: string) => reported.some(location => sameFile(location, candidate, input.rules));
  const checkpointed = (candidate: string) => input.checkpointedPaths.some(location => sameFile(location, candidate, input.rules));
  return {
    ...base,
    verification: 'git',
    changedFiles,
    unreportedChanges: changedFiles.filter(file => !named(file.relativePath)).map(file => file.relativePath),
    notCheckpointed: changedFiles.filter(file => !checkpointed(file.relativePath)).map(file => file.relativePath),
  };
}

/** Two records for one task — a re-prompt, or another attempt — as one. */
export function mergeDelegatedExecutionRecords(
  earlier: DelegatedExecutionRecord,
  later: DelegatedExecutionRecord,
): DelegatedExecutionRecord {
  const files = new Map(earlier.changedFiles.map(file => [file.relativePath, file]));
  for (const file of later.changedFiles) {
    const previous = files.get(file.relativePath);
    // Created and then edited is still created; anything else takes the latest.
    files.set(file.relativePath, previous?.status === 'created' && file.status === 'modified' ? previous : file);
  }
  const union = (left: readonly string[], right: readonly string[]) => [...new Set([...left, ...right])].sort();
  const verification = earlier.verification === 'git' && later.verification === 'git' ? 'git' : 'unverified';
  const note = later.verificationNote ?? earlier.verificationNote;
  return {
    model: later.model,
    verification,
    ...(verification === 'unverified' && note ? { verificationNote: note } : {}),
    changedFiles: [...files.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    unreportedChanges: union(earlier.unreportedChanges, later.unreportedChanges),
    notCheckpointed: union(earlier.notCheckpointed, later.notCheckpointed),
    toolCallCount: earlier.toolCallCount + later.toolCallCount,
    ...(later.checkpointTaskId ?? earlier.checkpointTaskId ? { checkpointTaskId: later.checkpointTaskId ?? earlier.checkpointTaskId } : {}),
    ...(later.plan ?? earlier.plan ? { plan: later.plan ?? earlier.plan } : {}),
  };
}

/** The agent's tool calls, as entries in the run record's tool list. */
export function delegatedToolArtifacts(
  calls: readonly DelegatedToolCall[],
  durationsMs: ReadonlyMap<string, number>,
  checkpointedCallIds: ReadonlySet<string>,
): ToolExecutionArtifact[] {
  return calls.map(call => ({
    toolName: `acp:${call.kind}`,
    durationMs: Math.max(0, Math.round(durationsMs.get(call.toolCallId) ?? 0)),
    checkpointed: checkpointedCallIds.has(call.toolCallId),
    resultPreview: `${call.status}${call.title ? `: ${call.title}` : ''}${call.locations.length > 0 ? ` (${call.locations.map(location => nodePath.basename(location.replace(/\\/g, '/'))).join(', ')})` : ''}`.slice(0, 300),
  }));
}

/**
 * The live tool-round line the chat view already renders for AtlasMind's own
 * tools (`[TOOL_EXEC]` + JSON + text), so a delegated agent's work shows in
 * the same place rather than only in an output channel.
 */
export function formatDelegatedToolRound(calls: readonly DelegatedToolCall[], round: number): string {
  const tools = calls.slice(-20).map(call => ({
    name: `acp:${call.kind}${call.title ? ` ${call.title}` : ''}`.slice(0, 80),
    status: call.status === 'completed' ? 'done' : call.status === 'failed' ? 'failed' : 'pending',
  }));
  const active = calls.some(call => call.status === 'pending' || call.status === 'in_progress');
  const data = { type: 'tool-round', round, toolCount: calls.length, tools, isActive: active };
  return `[TOOL_EXEC]${JSON.stringify(data)}Delegated agent: ${calls.length} operation(s) so far.`;
}

/**
 * One line saying what the delegated agent changed and how that was checked —
 * including when it was not checked, which must never read like "nothing".
 */
export function describeDelegatedExecution(record: DelegatedExecutionRecord): string {
  const count = record.changedFiles.length;
  const files = count === 0 ? 'no files' : count === 1 ? '1 file' : `${count} files`;
  if (record.verification !== 'git') {
    return `Delegated agent reported changing ${files}; not checked against the workspace (${record.verificationNote ?? 'no reason recorded'}).`;
  }
  const notes = [
    record.unreportedChanges.length > 0 ? `${record.unreportedChanges.length} it did not report` : '',
    record.notCheckpointed.length > 0 ? `${record.notCheckpointed.length} with no rollback point (${record.notCheckpointed.slice(0, 3).join(', ')}${record.notCheckpointed.length > 3 ? ', …' : ''})` : '',
  ].filter(Boolean);
  return `Delegated agent changed ${files}, checked against git${notes.length > 0 ? ` — ${notes.join('; ')}` : ''}.`;
}

/** One line for the agent's own plan, for progress output. */
export function describeDelegatedPlan(steps: readonly DelegatedPlanStep[]): string {
  const done = steps.filter(step => step.status === 'completed').length;
  const current = steps.find(step => step.status === 'in_progress');
  return `Agent plan: ${done}/${steps.length} done${current ? ` — now: ${current.content.slice(0, 120)}` : ''}.`;
}

const MAX_PERSISTED_PATHS = 500;
const MAX_PERSISTED_PLAN_STEPS = 50;

function readPathList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0 && entry.length <= 1_000).slice(0, MAX_PERSISTED_PATHS)
    : [];
}

/**
 * Read a delegation record back from run history. Persisted state is read as
 * untrusted: anything unrecognised is dropped, lists are bounded, and a record
 * that does not say how it was verified is `unverified` — never `git`, which
 * would vouch for a comparison nobody can show was made.
 */
export function sanitizeDelegatedExecutionRecord(raw: unknown): DelegatedExecutionRecord | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const model = typeof record['model'] === 'string' ? record['model'].slice(0, 200) : '';
  if (!model) {
    return undefined;
  }
  const changedFiles: ChangedWorkspaceFile[] = Array.isArray(record['changedFiles'])
    ? record['changedFiles'].slice(0, MAX_PERSISTED_PATHS).flatMap(entry => {
      const file = entry as Record<string, unknown> | null;
      const relativePath = typeof file?.['relativePath'] === 'string' ? file['relativePath'].slice(0, 1_000) : '';
      const status = file?.['status'];
      return relativePath && (status === 'created' || status === 'modified' || status === 'deleted')
        ? [{ relativePath, status }]
        : [];
    })
    : [];
  const plan: DelegatedPlanStep[] = Array.isArray(record['plan'])
    ? record['plan'].slice(0, MAX_PERSISTED_PLAN_STEPS).flatMap((entry): DelegatedPlanStep[] => {
      const step = entry as Record<string, unknown> | null;
      const content = typeof step?.['content'] === 'string' ? step['content'].slice(0, 300) : '';
      const status = step?.['status'];
      const priority = step?.['priority'];
      return content
        ? [{
          content,
          status: status === 'in_progress' || status === 'completed' ? status : 'pending',
          ...(priority === 'high' || priority === 'medium' || priority === 'low' ? { priority } : {}),
        }]
        : [];
    })
    : [];
  const verification = record['verification'] === 'git' ? 'git' : 'unverified';
  const note = typeof record['verificationNote'] === 'string' ? record['verificationNote'].slice(0, 500) : undefined;
  const toolCallCount = typeof record['toolCallCount'] === 'number' && Number.isFinite(record['toolCallCount'])
    ? Math.max(0, Math.floor(record['toolCallCount']))
    : 0;
  const checkpointTaskId = typeof record['checkpointTaskId'] === 'string' ? record['checkpointTaskId'].slice(0, 200) : undefined;
  return {
    model,
    verification,
    ...(verification === 'unverified' ? { verificationNote: note ?? 'Recorded without saying how it was checked.' } : {}),
    changedFiles,
    unreportedChanges: readPathList(record['unreportedChanges']),
    notCheckpointed: readPathList(record['notCheckpointed']),
    ...(checkpointTaskId ? { checkpointTaskId } : {}),
    toolCallCount,
    ...(plan.length > 0 ? { plan } : {}),
  };
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 200);
}
