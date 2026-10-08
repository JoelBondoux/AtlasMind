/**
 * Sandboxed execution — the runner. Where `sandboxPlan` decides and
 * `sandboxProbe` reads the engine, this starts the container: under
 * `atlasmind.sandbox.mode = require`, every command an agent asks for runs in
 * the container `buildSandboxArgv` describes, or is refused with the rule that
 * stopped it. It is never run on the host instead.
 *
 * Six rules, each enforced here rather than at the call sites:
 *
 * 1. **`off` is untouched.** `isRequired()` is the only thing a caller asks
 *    before its own host path, and under `off` that path runs exactly as it
 *    always has: no probe, no engine process, no change to what it spawns. An
 *    unreadable mode is `require` — whoever wrote something other than `off`
 *    wanted a sandbox.
 * 2. **One session, one decision.** A `SandboxSession` freezes the settings and
 *    the attestation together, and the plan and the execution read only from
 *    it — so a reading that changes between "may this run?" and "run it" cannot
 *    split the two. A caller that decided something on a session (B4's approval
 *    gate) binds it with `SkillExecutionContext.withSandbox(session)`, the way
 *    `withResolutionRoot` binds a worktree; a bound session that has expired is
 *    refused, never silently re-probed, because a new reading would be a
 *    decision the caller did not make.
 * 3. **A stale reading is taken again, once, within a budget.** An unbound
 *    call with no fresh reading for the current image and engine re-probes
 *    (single-flight: concurrent commands share one probe) and gives up after
 *    `SANDBOX_REPROBE_BUDGET_MS`. A fresh reading that says *unavailable* is not
 *    re-taken — the ten-minute rule bounds how often an engine is asked.
 * 4. **Dry run wins.** It is decided before anything is probed or started, and
 *    the engine launch is graded again by `guardHostCommand` at the moment of
 *    spawning, for a switch turned on mid-call.
 * 5. **A container this runner started is stopped by its own name.** A timeout
 *    removes `atlasmind-sbx-<id>` with `rm --force` from the host — it kills a
 *    running container and removes one created but never started, which
 *    `kill` alone would leave behind. Deactivation does the same for every
 *    container still live. Neither is held by a dry run: they end only what a
 *    start already began.
 * 6. **An orphan is one no live call can own.** The activation sweep removes
 *    labelled containers whose name says they started longer ago than any
 *    command is allowed to run — never a younger one, which may belong to
 *    another window's command, and never one whose age cannot be read.
 *
 * The runner's process boundary is injected (`SandboxProcessRunner`); the real
 * one at the bottom resolves the engine through `windowsShimBypass` and starts
 * it with an argument vector, never a shell. Only the engine CLI inherits the
 * editor's environment — it needs `DOCKER_HOST` and its own config — and the
 * container gets only what `SANDBOX_ENV_ALLOWLIST` lets through.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { describeHostDryRunNotice, isDryRunBlockedError } from './dryRun.js';
import { guardHostCommand, interceptDryRun } from './dryRunHost.js';
import {
  SANDBOX_LABEL,
  SANDBOX_NAME_PREFIX,
  SANDBOX_PLAN_RULES,
  planExecution,
  type SandboxAttestation,
  type SandboxConfiguration,
  type SandboxEngine,
  type SandboxExecutionPlan,
  type SandboxHostFacts,
  type SandboxMode,
} from './sandboxPlan.js';
import {
  SANDBOX_ENGINE_ORDER,
  type SandboxConfigurationReading,
  type SandboxProbeCache,
  type SandboxProbeReport,
} from './sandboxProbe.js';
import { createWorkspaceCommandProbe, resolveWorkspaceCommand, type WorkspaceCommandProbe } from './windowsShimBypass.js';
import { clipCommandOutput } from '../utils/terminalOutput.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import type { SandboxSessionHandle } from '../types.js';

// ── Constants ────────────────────────────────────────────────────

/** The longest an unbound command waits for a re-probe before it is refused. */
export const SANDBOX_REPROBE_BUDGET_MS = 180_000;
/** How long removing a container by name may take. */
export const SANDBOX_CLEANUP_TIMEOUT_MS = 15_000;
/** How long one sweep step (`ps`, `rm`) may take. */
export const SANDBOX_SWEEP_TIMEOUT_MS = 20_000;
/**
 * A labelled container younger than this is never swept: it may be another
 * window's live command. Twice the longest timeout any caller may ask for
 * (`runCommand` clamps to five minutes), so no live call can be this old.
 */
export const SANDBOX_ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;
/** The most containers one sweep removes. */
export const SANDBOX_SWEEP_MAX = 64;
/** The exit code of a refused command: "found, but cannot be executed". */
export const SANDBOX_REFUSED_EXIT_CODE = 126;

/** `r` + nine base-36 digits of the start time in ms + eight hex — so the name carries its own age. */
const RUN_ID = /^r([0-9a-z]{9})([0-9a-f]{8})$/;
const OWN_NAME = new RegExp(`^${SANDBOX_NAME_PREFIX}(r[0-9a-z]{9}[0-9a-f]{8})$`);

// ── Which paths are covered ──────────────────────────────────────

export interface SandboxPathRow {
  id: string;
  /** Where the execution happens. */
  where: string;
  /** What `require` does to it. */
  underRequire: string;
}

/**
 * Every path by which an agent's request becomes a process on this machine, and
 * what `require` does to it. `tests/core/sandboxRunner.test.ts` checks each
 * `file` really asks the installed host.
 */
export const SANDBOX_COVERED_PATHS: ReadonlyArray<SandboxPathRow & { file: string }> = [
  {
    id: 'run-command',
    file: 'src/extension.ts',
    where: '`SkillExecutionContext.runCommand` — terminal-run, test-run, the workspace tools, npm scripts, code formatting, the post-write verification, and every git skill that reaches it',
    underRequire: 'In the sandbox, or refused. git, gh, engines, network clients, installs and publishes are refused by the eligibility rules.',
  },
  {
    id: 'routine-step',
    file: 'src/core/routineRunner.ts',
    where: 'A routine step — `/ship`, the Run Center and scheduled routines, which run in their own worktree',
    underRequire: 'In the sandbox as `sh -c <step>`, so the shell is the container\'s; the folder mounted is the one the run uses — a scheduled run\'s worktree. Or refused.',
  },
  {
    id: 'managed-terminal-follow-up',
    file: 'src/views/chatPanel.ts',
    where: 'The one follow-up command a model chooses after a managed-terminal command',
    underRequire: 'Refused: it would run in your own terminal on this machine, which the sandbox cannot contain. Your own command still runs — you typed it.',
  },
  {
    id: 'acp-execute',
    file: 'src/extension.ts',
    where: 'An ACP agent asking to execute a command (or a tool it cannot identify) under `atlasmind.acp.toolsEnabled`',
    underRequire: 'Declined: the agent would run it in its own process on this machine.',
  },
  {
    id: 'debug-launch',
    file: 'src/extension.ts',
    where: 'The model starting a debug session, or evaluating an expression in one',
    underRequire: 'Refused: the debuggee is a program on this machine.',
  },
];

/** Paths that execute on the host whatever the mode, and why each is not this runner's to contain. */
export const SANDBOX_HOST_PATHS: readonly SandboxPathRow[] = [
  {
    id: 'git-tools',
    where: 'The git context members (status, diff, log, branch, apply patch) and worktree isolation\'s own git',
    underRequire: 'On the host. Constant git argv owned by AtlasMind, classified as git tools with their own approvals; history belongs to the host.',
  },
  {
    id: 'operator-surfaces',
    where: 'What you start yourself: the managed terminal\'s own command, the Delivery run plan, promotions, local CI, website setup',
    underRequire: 'On the host. A person pressed the button and saw the command; the sandbox is for what an agent asks for.',
  },
  {
    id: 'mcp-tools',
    where: 'Tools of MCP servers you connected',
    underRequire: 'On the host, inside the server you configured. A server that runs commands is a trust grant you made when you added it.',
  },
  {
    id: 'synthesized-skills',
    where: 'A model-written skill under `atlasmind.experimentalSkillLearning`',
    underRequire: 'Runs in the extension host with the editor\'s privileges; it is off by default and every one asks you to review it first.',
  },
  {
    id: 'cli',
    where: 'The `atlasmind` CLI and the ACP agent process',
    underRequire: 'On the host. The CLI has no settings store, so it has no mode to honour.',
  },
];

// ── Types ────────────────────────────────────────────────────────

/**
 * The settings and the attestation one decision rests on, frozen together.
 * Nothing in a session changes after it is opened, and only a session this host
 * opened is honoured: `SandboxSessionHandle` is what a skill context carries.
 */
export interface SandboxSession extends SandboxSessionHandle {
  readonly mode: SandboxMode;
  /** Absent under `off`, and when the settings could not be used. */
  readonly configuration?: Readonly<SandboxConfiguration>;
  /** Absent under `off`, and when the settings could not be used. */
  readonly attestation?: SandboxAttestation;
  /** Why the settings could not be used. */
  readonly problems: readonly string[];
  readonly host: SandboxHostFacts;
  readonly openedAt: string;
}

export interface SandboxCommandRequest {
  /** As requested — a bare name or a `./` path, never the host-resolved shim. */
  executable: string;
  args: readonly string[];
  /** The one folder mounted: a worktree, or the folder the command belongs to. */
  root: string;
  cwd: string;
  /** Candidate environment; only the allowlist crosses. */
  env: Readonly<Record<string, string | undefined>>;
  timeoutMs: number;
  /** Where the request came from, for the dry-run record. */
  surface?: string;
}

/** The same shape `runCommand` returns. */
export interface SandboxCommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SandboxProcessOutcome =
  | { kind: 'exited'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'timeout'; stdout: string; stderr: string }
  | { kind: 'not-found'; detail: string }
  | { kind: 'error'; detail: string };

/** Starts one engine command. Injected so every branch is testable without an engine. */
export type SandboxProcessRunner = (
  engine: SandboxEngine,
  argv: readonly string[],
  options: { timeoutMs: number },
) => Promise<SandboxProcessOutcome>;

export interface SandboxHostDeps {
  /** The tightest-scope mode (`readSandboxModeSetting`). */
  readMode: () => SandboxMode;
  readConfiguration: () => SandboxConfigurationReading;
  cache: SandboxProbeCache;
  /** Takes one reading; the canary mounts `canaryRoot`. */
  probe: (configuration: SandboxConfiguration, canaryRoot: string) => Promise<SandboxProbeReport>;
  run: SandboxProcessRunner;
  host: SandboxHostFacts;
  now: () => Date;
  realpath: (target: string) => Promise<string>;
  randomHex?: (bytes: number) => string;
  log?: (line: string) => void;
}

export interface SandboxSweepReport {
  removed: string[];
  /** Why nothing was swept, when nothing was. */
  skipped?: string;
}

// ── Pure helpers ─────────────────────────────────────────────────

const STAGE_LEADS: Readonly<Record<Extract<SandboxExecutionPlan, { route: 'refuse' }>['stage'], string>> = {
  eligibility: 'never run in the sandbox',
  attestation: 'sandbox unavailable',
  plan: 'sandbox unavailable',
  argv: 'the sandbox cannot run it as asked',
};

function requireNeverHost(): string {
  return SANDBOX_PLAN_RULES.find(rule => rule.id === 'require-never-host')!.description;
}

/** The text a refused command returns, naming the rule. */
export function describeSandboxRefusal(plan: Extract<SandboxExecutionPlan, { route: 'refuse' }>): string {
  const check = plan.stage === 'attestation' || plan.stage === 'plan'
    ? ' Run AtlasMind: Check Execution Sandbox to see every rule and what to do.'
    : '';
  return `Not run: ${STAGE_LEADS[plan.stage]} — ${plan.reason} [rule: ${plan.stage}/${plan.rule}; atlasmind.sandbox.mode is require]${check}`;
}

/**
 * Which labelled containers are orphans: named by this runner, and started
 * longer ago than `SANDBOX_ORPHAN_MIN_AGE_MS`. A name whose age cannot be read
 * (a canary's, a foreign one) is never an orphan — unknown is not old. Never
 * one still live here, never one dated in the future, and at most
 * `SANDBOX_SWEEP_MAX`.
 */
export function selectSandboxOrphans(names: readonly string[], now: Date, live: ReadonlySet<string>): string[] {
  const orphans: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    const match = OWN_NAME.exec(name);
    if (!match || live.has(name)) {
      continue;
    }
    const id = RUN_ID.exec(match[1]!);
    const startedMs = id ? parseInt(id[1]!, 36) : Number.NaN;
    const age = now.getTime() - startedMs;
    if (Number.isFinite(age) && age >= SANDBOX_ORPHAN_MIN_AGE_MS) {
      orphans.push(name);
    }
    if (orphans.length >= SANDBOX_SWEEP_MAX) {
      break;
    }
  }
  return orphans;
}

function refused(stderr: string, exitCode = SANDBOX_REFUSED_EXIT_CODE): SandboxCommandResult {
  return { ok: false, exitCode, stdout: '', stderr };
}

function describeCommand(request: SandboxCommandRequest): string {
  const shown = [request.executable, ...request.args].join(' ');
  return shown.length > 160 ? `${shown.slice(0, 157)}…` : shown;
}


function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── The host ─────────────────────────────────────────────────────

export class SandboxHost {
  private readonly live = new Map<string, SandboxEngine>();
  /** Every session this host opened. A bound session must be one of these. */
  private readonly opened = new WeakSet<object>();
  private probing: Promise<void> | undefined;
  private sessionCount = 0;

  constructor(private readonly deps: SandboxHostDeps) {}

  /** The mode the settings say now. An unreadable mode is `require`. */
  liveMode(): SandboxMode {
    try {
      return this.deps.readMode() === 'off' ? 'off' : 'require';
    } catch {
      return 'require';
    }
  }

  /**
   * Whether a command must go through the sandbox: the bound session asks for
   * it, or the settings do now. The tighter of the two, so a session opened
   * under `off` cannot carry a command past a `require` set since.
   */
  isRequired(bound?: SandboxSessionHandle): boolean {
    return bound?.mode === 'require' || this.liveMode() === 'require';
  }

  /** Containers this host started and has not yet seen finish. */
  liveContainers(): string[] {
    return [...this.live.keys()];
  }

  /**
   * Open a session for a caller that will decide something on it and then run
   * through it. Under `off`, nothing is read or probed.
   */
  async openSession(executionRoot?: string): Promise<SandboxSession> {
    if (this.liveMode() === 'off') {
      return this.freeze({ id: this.sessionId(), mode: 'off', problems: [], host: this.deps.host, openedAt: this.deps.now().toISOString() });
    }
    let root: string | undefined;
    if (executionRoot) {
      try {
        root = await this.deps.realpath(executionRoot);
      } catch {
        root = undefined;
      }
    }
    return this.openRequiredSession(root);
  }

  /**
   * Run one command under `require`: in the sandbox, or refused. Never on the
   * host. The caller has already asked `isRequired`.
   */
  async runCommand(request: SandboxCommandRequest, bound?: SandboxSessionHandle): Promise<SandboxCommandResult> {
    const dryRun = interceptDryRun({
      surface: request.surface ?? 'sandbox',
      kind: 'process',
      summary: `run \`${describeCommand(request)}\` in the execution sandbox`,
      details: { command: request.executable, args: [...request.args] },
    });
    if (dryRun) {
      return refused(describeHostDryRunNotice(dryRun));
    }

    let root: string;
    let cwd: string;
    try {
      root = await this.deps.realpath(request.root);
      cwd = await this.deps.realpath(request.cwd);
    } catch (error) {
      return refused(
        `Not run: sandbox unavailable — the folder to mount could not be resolved (${redactSecrets(messageOf(error)).text}). ${requireNeverHost()}`,
      );
    }

    let session: SandboxSession;
    if (bound?.mode === 'require') {
      // A session somebody else assembled could claim any attestation, so only
      // one this host opened is honoured.
      if (!this.opened.has(bound)) {
        return refused(
          `Not run: sandbox unavailable — the sandbox session this command was bound to was not opened by AtlasMind's sandbox host. ${requireNeverHost()}`,
        );
      }
      session = bound as SandboxSession;
    } else {
      session = await this.openRequiredSession(root);
    }
    if (!session.configuration) {
      return refused(
        `Not run: sandbox unavailable — the sandbox settings cannot be used: ${session.problems.join(' ')} ${requireNeverHost()}`,
      );
    }

    const runId = this.newRunId();
    const plan = planExecution(
      { runId, executable: request.executable, args: request.args, root, cwd, env: request.env },
      session.attestation,
      session.configuration,
      session.host,
      this.deps.now(),
    );
    if (plan.route === 'refuse') {
      return refused(describeSandboxRefusal(plan));
    }
    if (plan.route !== 'sandbox') {
      // Unreachable: a require session's configuration is require. Refused
      // rather than trusted, because the alternative is the host.
      return refused(`Not run: the sandbox plan did not name a container. ${requireNeverHost()}`);
    }
    return this.execute(plan, runId, request.timeoutMs);
  }

  /**
   * Remove every container this host started that is still live. For
   * deactivation: a window closing must not leave a command running in a
   * container nobody will collect.
   */
  async stopOwnContainers(): Promise<string[]> {
    const names = [...this.live.entries()];
    await Promise.all(names.map(([name, engine]) => this.removeOwn(engine, name)));
    return names.map(([name]) => name);
  }

  /**
   * Remove labelled containers no live call can own. Only under `require` — a
   * person who never turned the sandbox on gets no engine process from it.
   */
  async sweepOrphans(): Promise<SandboxSweepReport> {
    if (this.liveMode() !== 'require') {
      return { removed: [], skipped: 'The sandbox mode is off, so nothing was swept.' };
    }
    let engines: SandboxEngine[] = [...SANDBOX_ENGINE_ORDER];
    try {
      const engine = this.deps.readConfiguration().configuration?.engine;
      if (engine === 'docker' || engine === 'podman') {
        engines = [engine];
      }
    } catch {
      // Unreadable settings: look at every engine.
    }
    const removed: string[] = [];
    for (const engine of engines) {
      const listArgs = ['ps', '--all', '--filter', `label=${SANDBOX_LABEL}`, '--format', '{{.Names}}'];
      let listed: SandboxProcessOutcome;
      try {
        guardHostCommand('sandbox-sweep', engine, listArgs, { userInitiated: false });
        listed = await this.deps.run(engine, listArgs, { timeoutMs: SANDBOX_SWEEP_TIMEOUT_MS });
      } catch (error) {
        this.log(`[sandbox] sweep: could not list ${engine} containers: ${messageOf(error)}`);
        continue;
      }
      if (listed.kind !== 'exited' || listed.exitCode !== 0) {
        continue;
      }
      const orphans = selectSandboxOrphans(listed.stdout.split(/\r?\n/), this.deps.now(), new Set(this.live.keys()));
      if (orphans.length === 0) {
        continue;
      }
      const removeArgs = ['rm', '--force', ...orphans];
      try {
        guardHostCommand('sandbox-sweep', engine, removeArgs, { userInitiated: false });
      } catch (error) {
        if (isDryRunBlockedError(error)) {
          this.log(`[sandbox] sweep: dry run is on, so ${orphans.length} orphaned container(s) were recorded, not removed.`);
          continue;
        }
        throw error;
      }
      const outcome = await this.safeRun(engine, removeArgs, SANDBOX_SWEEP_TIMEOUT_MS);
      if (outcome.kind === 'exited' && outcome.exitCode === 0) {
        removed.push(...orphans);
        this.log(`[sandbox] sweep: removed ${orphans.length} orphaned ${engine} container(s): ${orphans.join(', ')}`);
      }
    }
    return { removed };
  }

  // ── Internals ──────────────────────────────────────────────────

  /** Freeze a session and remember that this host opened it. */
  private freeze(session: SandboxSession): SandboxSession {
    const frozen = Object.freeze({
      ...session,
      problems: Object.freeze([...session.problems]),
      ...(session.configuration ? { configuration: Object.freeze({ ...session.configuration }) } : {}),
    });
    this.opened.add(frozen);
    return frozen;
  }

  private async openRequiredSession(root: string | undefined): Promise<SandboxSession> {
    const id = this.sessionId();
    const base = { id, mode: 'require' as const, host: this.deps.host };
    let reading: SandboxConfigurationReading;
    try {
      reading = this.deps.readConfiguration();
    } catch (error) {
      reading = { problems: [`The sandbox settings could not be read (${messageOf(error)}).`], ignored: [] };
    }
    if (!reading.configuration) {
      return this.freeze({ ...base, problems: reading.problems, openedAt: this.deps.now().toISOString() });
    }
    // The session is require whatever the reading's own mode field says, so a
    // plan made on it can never route to the host.
    const configuration: SandboxConfiguration = { ...reading.configuration, mode: 'require' };
    if (root && this.needsReading(configuration)) {
      await this.reprobe(configuration, root);
    }
    const now = this.deps.now();
    return this.freeze({
      ...base,
      configuration,
      attestation: this.deps.cache.attestation(configuration, now),
      problems: [],
      openedAt: now.toISOString(),
    });
  }

  /** No reading young enough, or one taken of a different image or engine. */
  private needsReading(configuration: SandboxConfiguration): boolean {
    const fresh = this.deps.cache.fresh(this.deps.now());
    if (!fresh) {
      return true;
    }
    return fresh.probe.image !== configuration.image
      || (configuration.engine !== 'auto' && fresh.probe.engine !== configuration.engine);
  }

  private async reprobe(configuration: SandboxConfiguration, root: string): Promise<void> {
    if (!this.probing) {
      this.probing = (async () => {
        try {
          this.deps.cache.record(await this.deps.probe(configuration, root));
        } catch (error) {
          this.log(`[sandbox] the engine could not be probed: ${messageOf(error)}`);
        }
      })().finally(() => {
        this.probing = undefined;
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>(resolve => {
      timer = setTimeout(resolve, SANDBOX_REPROBE_BUDGET_MS);
    });
    try {
      await Promise.race([this.probing, budget]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async execute(
    plan: Extract<SandboxExecutionPlan, { route: 'sandbox' }>,
    runId: string,
    timeoutMs: number,
  ): Promise<SandboxCommandResult> {
    const name = `${SANDBOX_NAME_PREFIX}${runId}`;
    try {
      guardHostCommand('sandbox', plan.command, plan.argv);
    } catch (error) {
      if (isDryRunBlockedError(error)) {
        return refused(error.message);
      }
      throw error;
    }
    this.live.set(name, plan.command);
    let outcome: SandboxProcessOutcome;
    try {
      outcome = await this.safeRun(plan.command, plan.argv, timeoutMs);
      if (outcome.kind !== 'exited') {
        // The CLI is gone; the container it asked for may not be.
        await this.removeOwn(plan.command, name);
      }
    } finally {
      this.live.delete(name);
    }
    const notes = plan.rejectedEnv.length > 0
      ? `\n[sandbox] Not passed into the container, because the value failed its check: ${plan.rejectedEnv.join(', ')}.`
      : '';
    switch (outcome.kind) {
      case 'exited':
        return {
          ok: outcome.exitCode === 0,
          exitCode: outcome.exitCode,
          stdout: clipCommandOutput(outcome.stdout),
          stderr: clipCommandOutput(`${outcome.stderr}${notes}`),
        };
      case 'timeout':
        return {
          ok: false,
          exitCode: 1,
          stdout: clipCommandOutput(outcome.stdout),
          stderr: clipCommandOutput(
            `${outcome.stderr}\n[sandbox] Timed out after ${Math.round(timeoutMs / 1000)}s; the container ${name} was removed.${notes}`,
          ),
        };
      case 'not-found':
        return refused(
          `Not run: sandbox unavailable — the ${plan.command} command-line tool could not be started: `
            + `${redactSecrets(outcome.detail).text} ${requireNeverHost()}`,
          127,
        );
      default:
        return refused(`The sandboxed command failed to run: ${redactSecrets(outcome.detail).text}${notes}`, 1);
    }
  }

  /** `rm --force` by the container's own name. Not dry-run-held: it ends only what a start began. */
  private async removeOwn(engine: SandboxEngine, name: string): Promise<void> {
    const outcome = await this.safeRun(engine, ['rm', '--force', name], SANDBOX_CLEANUP_TIMEOUT_MS);
    if (outcome.kind !== 'exited') {
      this.log(`[sandbox] could not remove ${name}; the activation sweep will, once it is old enough.`);
    }
  }

  private async safeRun(engine: SandboxEngine, argv: readonly string[], timeoutMs: number): Promise<SandboxProcessOutcome> {
    try {
      const outcome = await this.deps.run(engine, argv, { timeoutMs });
      return outcome && typeof outcome === 'object' && typeof outcome.kind === 'string'
        ? outcome
        : { kind: 'error', detail: 'The engine runner returned nothing readable.' };
    } catch (error) {
      return { kind: 'error', detail: messageOf(error) };
    }
  }

  private newRunId(): string {
    const time = this.deps.now().getTime().toString(36).padStart(9, '0').slice(-9);
    const random = (this.deps.randomHex ?? defaultRandomHex)(4).toLowerCase().replace(/[^0-9a-f]/g, '0').padEnd(8, '0').slice(0, 8);
    return `r${time}${random}`;
  }

  private sessionId(): string {
    this.sessionCount += 1;
    return `sbx-session-${this.deps.now().getTime().toString(36)}-${this.sessionCount}`;
  }

  private log(line: string): void {
    try {
      this.deps.log?.(line);
    } catch {
      // Logging is best-effort.
    }
  }
}

function defaultRandomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

// ── The installed host ───────────────────────────────────────────

let installed: SandboxHost | undefined;

/**
 * Install the process's sandbox host — once, at activation, beside the dry-run
 * host. A process that installed none (a unit test, the CLI) has no sandbox
 * settings and reads as `off`. Returns an uninstaller for disposal and tests.
 */
export function installSandboxHost(host: SandboxHost): () => void {
  installed = host;
  return () => {
    if (installed === host) {
      installed = undefined;
    }
  };
}

/** The installed host, which every covered path asks before executing. */
export function installedSandboxHost(): SandboxHost | undefined {
  return installed;
}

/**
 * The refusal for a path that executes on this machine and cannot be
 * sandboxed at all (a debug launch, a managed-terminal follow-up), when the
 * mode is `require`; `undefined` when it may proceed.
 */
export function hostExecutionRefusal(what: string, bound?: SandboxSessionHandle): string | undefined {
  if (!installed?.isRequired(bound)) {
    return undefined;
  }
  return `Not run: atlasmind.sandbox.mode is require, and ${what} runs on this machine, outside the sandbox. ${requireNeverHost()}`;
}

// ── Default process runner ───────────────────────────────────────

interface ExecFileFailure extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: string | null;
}

/**
 * The real runner. The engine is resolved through `windowsShimBypass` and
 * started with an argument vector — never a shell — and only a real executable
 * is accepted. It does not grade dry run itself: `SandboxHost` does, before it
 * calls this, and calls it ungraded only to remove a container it started.
 */
export function createSandboxProcessRunner(
  commandProbe: WorkspaceCommandProbe = createWorkspaceCommandProbe(),
): SandboxProcessRunner {
  return async (engine, argv, { timeoutMs }) => {
    if (engine !== 'docker' && engine !== 'podman') {
      return { kind: 'error', detail: 'Only docker and podman are run.' };
    }
    const resolution = resolveWorkspaceCommand(engine, argv, commandProbe);
    if (resolution.status === 'unresolved') {
      return { kind: 'not-found', detail: resolution.reason };
    }
    if (resolution.status === 'node') {
      return { kind: 'not-found', detail: `\`${engine}\` resolved to a script shim (${resolution.viaShim}), not the engine's own executable.` };
    }
    return new Promise<SandboxProcessOutcome>(resolve => {
      execFile(
        resolution.command,
        resolution.args,
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', shell: false },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ kind: 'exited', exitCode: 0, stdout: String(stdout), stderr: String(stderr) });
            return;
          }
          const failure = error as ExecFileFailure;
          if (failure.code === 'ENOENT') {
            resolve({ kind: 'not-found', detail: `\`${engine}\` was not found on PATH.` });
          } else if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            // Node killed the CLI for talking too much — not a timeout, and the
            // container is still running; the host removes it by name.
            resolve({ kind: 'error', detail: 'The command wrote more than 4 MiB of output, so it was stopped.' });
          } else if (failure.killed || failure.signal) {
            resolve({ kind: 'timeout', stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
          } else if (typeof failure.code === 'number') {
            resolve({ kind: 'exited', exitCode: failure.code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
          } else {
            resolve({ kind: 'error', detail: `${failure.message}${stderr ? ` ${String(stderr)}` : ''}` });
          }
        },
      );
    });
  };
}
