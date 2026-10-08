/**
 * Sandboxed execution — approval relaxation. The part of
 * `rm:sandboxed-execution-for-auto` that lets approvals loosen as autonomy
 * grows: a `terminal-write` that will run in a confirmed container may skip its
 * approval prompt, and only then.
 *
 * The trust shift is the whole design, so it is stated first. Today a terminal
 * write asks because the command can do anything the editor can — read every
 * credential, reach the network, change files outside the project. Under
 * `atlasmind.sandbox.mode = require` with a confirmed attestation it cannot: no
 * network, no host environment, one folder mounted, no capabilities. The
 * prompt existed to stand between a model and *the machine*; once the machine
 * is out of reach, what is left to approve is "may this change files in this
 * folder", which a person who switched this on has answered in advance. It
 * still changes every file in the mount, which is why it is opt-in, user-only
 * and off by default.
 *
 * Seven rules, enforced here rather than at the call site:
 *
 * 1. **Declared precedence, evaluated in order.** `SANDBOX_RELAXATION_RULES`
 *    is the table; the first rule that decides is the one reported. Dry run
 *    simulates before anything asks. The `allowTerminalWrite` ceiling refuses —
 *    it is checked before taint because a refusal is stricter than a fresh
 *    approval, and the gate already checks it first. Taint, the
 *    never-bypassable ceiling and the category all sit above the relaxation,
 *    so none of them can be relaxed by it.
 * 2. **Taint is never relaxed.** A container limits what a command can reach,
 *    not whether the model was steered into asking for it
 *    (`SANDBOX_INTERACTION_RULES` → `taint-not-relaxed`). A tainted turn asks —
 *    even after "I've seen the source", because that acknowledgement answered a
 *    dialog about the source, not one about skipping dialogs.
 * 3. **Only a terminal write, and only one AtlasMind can read.** The tool must
 *    be in `SANDBOX_RELAXABLE_TOOLS` and the exact command must be readable from
 *    its arguments, because the relaxation is decided on *this* invocation.
 *    `workspace-write`, `git-write`, `network` and the rest are untouched.
 * 4. **Your setting, not the repository's.** `relaxTerminalApprovals` counts
 *    only as `true` in your user settings; a workspace or folder value is
 *    ignored and named. A repository may require the sandbox; it may never
 *    loosen your approvals.
 * 5. **Decided on the session that will run it.** The decision rests on a
 *    `SandboxSession` the installed host opened, and the gate hands that same
 *    object back so the Orchestrator binds the call to it
 *    (`SkillExecutionContext.withSandbox`). The runner then plans on the frozen
 *    reading the gate used: an attestation that expires in between makes the
 *    run a refusal, never a prompt after the fact and never a run on the host.
 * 6. **`require`, confirmed, and routed to the sandbox.** The session must be
 *    `require`, its attestation confirmed, and `planExecution` must route this
 *    exact invocation to `sandbox` — an ineligible command (git, an install, a
 *    network client) asks as before, and is then refused by the runner anyway.
 * 7. **Every relaxed approval is cited.** The result carries an audit record
 *    naming the rule, the session, the attestation id and probe time, the image
 *    and its digest; the gate writes it to the output channel and the
 *    Orchestrator into the run record.
 *
 * Pure apart from the injected `openSession` and folder resolution; clock
 * injected. No `vscode`.
 */

import { planExecution, type SandboxAttestation, type SandboxConfiguration, type SandboxHostFacts, type SandboxMode } from './sandboxPlan.js';
import type { SandboxSettingInspection } from './sandboxProbe.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import type { ToolApprovalAudit, ToolInvocationPolicy } from '../types.js';

// ── Rules ────────────────────────────────────────────────────────

export type SandboxRelaxationRuleId =
  | 'dry-run'
  | 'terminal-write-ceiling'
  | 'taint'
  | 'never-bypassable'
  | 'terminal-write-only'
  | 'relaxation-off'
  | 'invocation-unreadable'
  | 'session-unavailable'
  | 'mode-not-require'
  | 'attestation-unconfirmed'
  | 'route-not-sandbox'
  | 'relaxed';

/** What the gate does with a decision. `ask` means "the rules that applied before this opt-in decide". */
export type SandboxRelaxationOutcome = 'simulate' | 'refuse' | 'ask' | 'relaxed';

export interface SandboxRelaxationRule {
  id: SandboxRelaxationRuleId;
  outcome: SandboxRelaxationOutcome;
  description: string;
}

/** In precedence order: the first rule that decides is the one reported. */
export const SANDBOX_RELAXATION_RULES: readonly SandboxRelaxationRule[] = [
  {
    id: 'dry-run',
    outcome: 'simulate',
    description: 'Dry run is decided first: the call is described, not run, so nothing asks and nothing is relaxed.',
  },
  {
    id: 'terminal-write-ceiling',
    outcome: 'refuse',
    description: 'atlasmind.allowTerminalWrite is off, so terminal writes are refused. The sandbox does not lift the ceiling.',
  },
  {
    id: 'taint',
    outcome: 'ask',
    description: 'The turn has read untrusted content, so the fresh approval contextProvenance requires decides. '
      + 'A sandbox limits what a command can reach, not whether the model was steered into asking for it.',
  },
  {
    id: 'never-bypassable',
    outcome: 'ask',
    description: 'The call is on the never-bypassable list, which no grant reaches — this one included.',
  },
  {
    id: 'terminal-write-only',
    outcome: 'ask',
    description: 'Only a terminal write through a tool AtlasMind can read the exact command of is relaxed. '
      + 'File writes, git writes, network calls and everything else ask exactly as before.',
  },
  {
    id: 'relaxation-off',
    outcome: 'ask',
    description: 'atlasmind.sandbox.relaxTerminalApprovals is not true in your user settings. A workspace value is ignored: '
      + 'a repository may require the sandbox, but never loosen your approvals.',
  },
  {
    id: 'invocation-unreadable',
    outcome: 'ask',
    description: 'The exact command could not be read from the call\'s arguments, so nothing can show this invocation would run in the sandbox.',
  },
  {
    id: 'session-unavailable',
    outcome: 'ask',
    description: 'No sandbox session could be opened for the call — no sandbox host, a folder that could not be resolved, '
      + 'or sandbox settings that cannot be used.',
  },
  {
    id: 'mode-not-require',
    outcome: 'ask',
    description: 'atlasmind.sandbox.mode is not require, so the command would run on your machine. Relaxation needs require.',
  },
  {
    id: 'attestation-unconfirmed',
    outcome: 'ask',
    description: 'The sandbox session carries no confirmed attestation. Run AtlasMind: Check Execution Sandbox to see why.',
  },
  {
    id: 'route-not-sandbox',
    outcome: 'ask',
    description: 'planExecution does not route this exact command to the sandbox (ineligible, expired, or an argv rule refused it). '
      + 'It asks as before — and under require the runner refuses it anyway.',
  },
  {
    id: 'relaxed',
    outcome: 'relaxed',
    description: 'require, your opt-in, a confirmed attestation, and this exact command routed to the sandbox: it runs there without asking, '
      + 'bound to the session that was checked, and the approval is recorded with the attestation it rests on.',
  },
];

/**
 * The tools whose exact command the gate can read, and how. Only `terminal-run`
 * (`skills/terminalRun.ts`): `command` is the executable, `args` its argument
 * vector, `cwd` where it runs. `docker-cli` is a terminal write too, but every
 * engine command is ineligible, so it is not listed.
 */
export const SANDBOX_RELAXABLE_TOOLS: readonly string[] = ['terminal-run'];

// ── Setting ──────────────────────────────────────────────────────

export interface RelaxTerminalApprovalsReading {
  /** Only your user value of exactly `true` counts. */
  enabled: boolean;
  /** A workspace or folder value, named so nobody wonders why it did nothing. */
  ignored?: string;
  /** A user value that is not a boolean — refused, not coerced. */
  problem?: string;
}

export const RELAX_TERMINAL_APPROVALS_SETTING_RULE = 'Machine-scoped and read from your user settings only: '
  + 'a repository may require the sandbox, and can never loosen your approvals.';

/** Read `atlasmind.sandbox.relaxTerminalApprovals` from its per-scope values. */
export function readRelaxTerminalApprovalsSetting(inspection: SandboxSettingInspection | undefined): RelaxTerminalApprovalsReading {
  const reading: RelaxTerminalApprovalsReading = { enabled: false };
  if (inspection?.workspaceValue !== undefined || inspection?.workspaceFolderValue !== undefined) {
    reading.ignored = `A workspace or folder value for atlasmind.sandbox.relaxTerminalApprovals was ignored. ${RELAX_TERMINAL_APPROVALS_SETTING_RULE}`;
  }
  const value = inspection?.globalValue;
  if (value === undefined || value === null) {
    return reading;
  }
  if (typeof value !== 'boolean') {
    reading.problem = 'atlasmind.sandbox.relaxTerminalApprovals must be true or false. It is read as false rather than guessed at.';
    return reading;
  }
  reading.enabled = value;
  return reading;
}

// ── Decision ─────────────────────────────────────────────────────

/** The fields of `SandboxSession` the decision reads. */
export interface SandboxRelaxationSession {
  readonly id: string;
  readonly mode: SandboxMode;
  readonly configuration?: Readonly<SandboxConfiguration>;
  readonly attestation?: SandboxAttestation;
  readonly host: SandboxHostFacts;
}

export interface SandboxRelaxationFacts {
  toolName: string;
  args: Record<string, unknown>;
  policy: ToolInvocationPolicy;
  dryRun: boolean;
  allowTerminalWrite: boolean;
  /** The call reached the gate with a taint escalation — acknowledged or not. */
  tainted: boolean;
  /** `toolBypassCeiling(policy)`: the reason no grant reaches this call, if one applies. */
  bypassCeiling?: string;
  relaxSetting: RelaxTerminalApprovalsReading;
}

export interface SandboxRelaxationDeps<S extends SandboxRelaxationSession> {
  /** The installed host's `openSession`. Absent when no sandbox host is installed. */
  openSession?: (root: string) => Promise<S>;
  /** The real root to mount and the real working directory; `undefined` when either cannot be resolved. */
  resolveFolders: (cwd: string | undefined) => Promise<{ root: string; cwd: string } | undefined>;
  now: () => Date;
}

export type SandboxRelaxationDecision<S extends SandboxRelaxationSession = SandboxRelaxationSession> =
  | {
    outcome: Exclude<SandboxRelaxationOutcome, 'relaxed'>;
    rule: Exclude<SandboxRelaxationRuleId, 'relaxed'>;
    reason: string;
  }
  | {
    outcome: 'relaxed';
    rule: 'relaxed';
    reason: string;
    /** The exact object the gate checked — bind the call to this one. */
    session: S;
    audit: ToolApprovalAudit;
  };

/** The run id `planExecution` is asked with at the gate. It names no container: nothing is started here. */
const GATE_PLAN_RUN_ID = 'rapprovalgate000';

function ruleOf(id: SandboxRelaxationRuleId): SandboxRelaxationRule {
  return SANDBOX_RELAXATION_RULES.find(rule => rule.id === id)!;
}

function notRelaxed(id: Exclude<SandboxRelaxationRuleId, 'relaxed'>, detail?: string): SandboxRelaxationDecision<never> {
  const rule = ruleOf(id);
  return {
    outcome: rule.outcome as Exclude<SandboxRelaxationOutcome, 'relaxed'>,
    rule: id,
    reason: detail ? `${rule.description} ${detail}` : rule.description,
  };
}

interface ReadInvocation {
  executable: string;
  args: string[];
  cwd?: string;
}

/** The exact command `terminal-run` will hand `runCommand`, or why it cannot be read. */
function readInvocation(toolName: string, args: Record<string, unknown>): ReadInvocation | string {
  if (toolName !== 'terminal-run') {
    return `${toolName} is not a tool whose command can be read.`;
  }
  const command = args?.['command'];
  if (typeof command !== 'string' || command.trim().length === 0) {
    return 'The call names no command.';
  }
  const rawArgs = args['args'];
  if (rawArgs !== undefined && (!Array.isArray(rawArgs) || rawArgs.some(value => typeof value !== 'string'))) {
    return 'The arguments are not a list of strings.';
  }
  const cwd = args['cwd'];
  if (cwd !== undefined && typeof cwd !== 'string') {
    return 'The working directory is not a string.';
  }
  return {
    executable: command.trim(),
    args: Array.isArray(rawArgs) ? [...rawArgs as string[]] : [],
    ...(typeof cwd === 'string' && cwd.trim() ? { cwd: cwd.trim() } : {}),
  };
}

/** The rules above the session, which need nothing opened or resolved. */
function decideBeforeSession(facts: SandboxRelaxationFacts): SandboxRelaxationDecision<never> | ReadInvocation {
  if (facts.dryRun) {
    return notRelaxed('dry-run');
  }
  if (facts.policy?.category === 'terminal-write' && facts.allowTerminalWrite !== true) {
    return notRelaxed('terminal-write-ceiling');
  }
  if (facts.tainted) {
    return notRelaxed('taint');
  }
  if (facts.bypassCeiling) {
    return notRelaxed('never-bypassable', facts.bypassCeiling);
  }
  if (facts.policy?.category !== 'terminal-write' || !SANDBOX_RELAXABLE_TOOLS.includes(facts.toolName)) {
    return notRelaxed('terminal-write-only');
  }
  if (facts.relaxSetting?.enabled !== true) {
    return notRelaxed('relaxation-off', facts.relaxSetting?.problem);
  }
  const invocation = readInvocation(facts.toolName, facts.args);
  if (typeof invocation === 'string') {
    return notRelaxed('invocation-unreadable', invocation);
  }
  return invocation;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The audit record for one relaxed approval. Composed here so no caller can cite less. */
function buildAudit(
  session: SandboxRelaxationSession,
  attestation: Extract<SandboxAttestation, { status: 'confirmed' }>,
  policy: ToolInvocationPolicy,
  taskId: string | undefined,
): ToolApprovalAudit {
  const summary = clip(redactSecrets(String(policy?.summary ?? 'a terminal write')).text.replace(/[\r\n]+/g, ' '), 160);
  const line = `[approval] Ran without asking${taskId ? ` (task ${taskId})` : ''} — ${summary}. `
    + 'Rule sandbox-relaxation/relaxed: atlasmind.sandbox.mode require, relaxTerminalApprovals on, attestation confirmed, routed to the sandbox. '
    + `Session ${session.id}; attestation ${attestation.id}, probed ${attestation.probedAt}, valid until ${attestation.expiresAt}; `
    + `${attestation.engine} ${attestation.strength}, image ${attestation.image} (${attestation.digest}).`;
  return {
    rule: 'sandbox-relaxation/relaxed',
    line,
    sandboxSessionId: session.id,
    attestationId: attestation.id,
    probedAt: attestation.probedAt,
    expiresAt: attestation.expiresAt,
    image: attestation.image,
    digest: attestation.digest,
  };
}

/**
 * Whether this call's approval prompt may be skipped because it will run in a
 * confirmed sandbox. Opens a session only once every rule above the session has
 * passed — a person who never opted in gets no probe from this.
 *
 * Never throws: anything unreadable is a rule that says `ask`.
 */
export async function evaluateSandboxApprovalRelaxation<S extends SandboxRelaxationSession>(
  facts: SandboxRelaxationFacts & { taskId?: string },
  deps: SandboxRelaxationDeps<S>,
): Promise<SandboxRelaxationDecision<S>> {
  const before = decideBeforeSession(facts);
  if ('outcome' in before) {
    return before;
  }
  if (!deps.openSession) {
    return notRelaxed('session-unavailable', 'No sandbox host is installed in this process.');
  }
  let folders: { root: string; cwd: string } | undefined;
  try {
    folders = await deps.resolveFolders(before.cwd);
  } catch {
    folders = undefined;
  }
  if (!folders) {
    return notRelaxed('session-unavailable', 'The folder the command would run in could not be resolved.');
  }
  let session: S;
  try {
    session = await deps.openSession(folders.root);
  } catch {
    return notRelaxed('session-unavailable', 'The sandbox session could not be opened.');
  }
  if (!session || typeof session !== 'object') {
    return notRelaxed('session-unavailable', 'The sandbox host returned no session.');
  }
  if (session.mode !== 'require') {
    return notRelaxed('mode-not-require');
  }
  if (!session.configuration) {
    return notRelaxed('session-unavailable', 'The sandbox settings cannot be used.');
  }
  const attestation = session.attestation;
  if (!attestation || attestation.status !== 'confirmed') {
    return notRelaxed('attestation-unconfirmed', attestation?.status === 'unavailable' ? attestation.reason : undefined);
  }
  const plan = planExecution(
    { runId: GATE_PLAN_RUN_ID, executable: before.executable, args: before.args, root: folders.root, cwd: folders.cwd, env: {} },
    attestation,
    session.configuration,
    session.host,
    deps.now(),
  );
  if (plan.route !== 'sandbox') {
    return notRelaxed(
      'route-not-sandbox',
      plan.route === 'refuse' ? `(${plan.stage}/${plan.rule})` : '(the plan named the host)',
    );
  }
  return {
    outcome: 'relaxed',
    rule: 'relaxed',
    reason: ruleOf('relaxed').description,
    session,
    audit: buildAudit(session, attestation, facts.policy, facts.taskId),
  };
}

// ── State, for the status bar and the check report ───────────────

export type SandboxRelaxationState =
  | 'off'
  | 'setting-ignored'
  | 'mode-off'
  | 'terminal-writes-blocked'
  | 'waiting-for-attestation'
  | 'active';

export interface SandboxRelaxationStateInput {
  setting: RelaxTerminalApprovalsReading;
  mode: SandboxMode;
  allowTerminalWrite: boolean;
  attestation?: SandboxAttestation;
}

export interface SandboxRelaxationStateView {
  state: SandboxRelaxationState;
  /** Whether a terminal write could skip its prompt right now. */
  active: boolean;
  headline: string;
  detail: string;
}

/**
 * What the relaxation does right now, in words. `active` only when every
 * standing condition holds; each per-call rule (taint, the exact command, the
 * session at the moment of the call) still applies on top, and the detail says
 * so — a status that read "no prompts" without that would overstate it.
 */
export function describeSandboxRelaxationState(input: SandboxRelaxationStateInput): SandboxRelaxationStateView {
  const perCall = 'Each call is still checked: a turn that read untrusted content asks, a command the sandbox would not run asks, '
    + 'and the run is bound to the session that was checked.';
  if (!input.setting.enabled) {
    return input.setting.ignored
      ? {
        state: 'setting-ignored',
        active: false,
        headline: 'Terminal writes ask as before',
        detail: `${input.setting.ignored} Approvals are unchanged.`,
      }
      : {
        state: 'off',
        active: false,
        headline: 'Terminal writes ask as before',
        detail: 'atlasmind.sandbox.relaxTerminalApprovals is off, so approvals are unchanged by the sandbox.',
      };
  }
  if (input.mode !== 'require') {
    return {
      state: 'mode-off',
      active: false,
      headline: 'Terminal writes ask as before',
      detail: 'relaxTerminalApprovals is on but atlasmind.sandbox.mode is off, so commands run on your machine and every terminal write asks.',
    };
  }
  if (!input.allowTerminalWrite) {
    return {
      state: 'terminal-writes-blocked',
      active: false,
      headline: 'Terminal writes are refused',
      detail: 'atlasmind.allowTerminalWrite is off, so terminal writes are refused whatever the sandbox says. The ceiling is not lifted by it.',
    };
  }
  if (input.attestation?.status !== 'confirmed') {
    return {
      state: 'waiting-for-attestation',
      active: false,
      headline: 'Terminal writes ask until the sandbox is confirmed',
      detail: input.attestation?.status === 'unavailable'
        ? `No confirmed attestation (${input.attestation.rule}: ${input.attestation.reason}), so terminal writes ask as before.`
        : 'No confirmed attestation yet, so terminal writes ask as before. The first command re-probes the engine.',
    };
  }
  return {
    state: 'active',
    active: true,
    headline: 'Terminal writes run sandboxed without asking',
    detail: `Attestation ${input.attestation.id} (${input.attestation.image}) is confirmed until ${input.attestation.expiresAt}. ${perCall}`,
  };
}
