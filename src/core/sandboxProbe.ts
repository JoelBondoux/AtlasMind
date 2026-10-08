/**
 * Sandboxed execution — the probe. One reading of the container engine, taken
 * on request, that fills the `SandboxProbe` `sandboxPlan.ts` judges.
 *
 * `sandboxPlan` decides what a reading has to show before a command may run in
 * a container; this is what takes the reading. It runs at most four kinds of
 * engine command, each a constant shape with the engine's name as the only
 * thing chosen:
 *
 * 1. `<engine> --version` — is the CLI installed;
 * 2. `<engine> info` as JSON — does the engine answer, which OS its containers
 *    run, and how it maps users (`parseDockerInfo` and
 *    `parseContainerEngineSecurity` in `localCiRunner.ts`, the parsers the local
 *    CI runner already uses, extended to Podman's shape rather than copied);
 * 3. `<engine> image inspect` of the configured reference — is that exact
 *    digest present **locally**. Nothing here pulls: an absent image is
 *    reported with the `pull` command for the person to run, because what an
 *    image is is their decision, not a side effect of checking;
 * 4. a **canary**: `buildSandboxArgv`'s own argv around the constant command
 *    `test -d /work`, so the reading proves the real shape starts on this
 *    engine — the mount, `--network none`, the dropped capabilities, the
 *    read-only root — rather than that some other container would.
 *
 * Five rules about the reading itself:
 *
 * - **Engines are tried in a declared order.** `auto` tries Docker, then
 *   Podman, and takes the first whose engine answers; a named engine is the
 *   only one tried. Nothing else is guessed at.
 * - **Only a validated reference reaches the engine.** `image inspect` is run
 *   only on a reference `parseSandboxImageReference` accepted, so a setting
 *   beginning with `-` is never read by the engine as a flag.
 * - **The canary runs only when it could prove something.** If a rule before
 *   `canary-passed` already fails, the canary is not run and the step says
 *   why — starting a container to confirm what is already known to fail would
 *   be an effect for nothing.
 * - **A dry run reads, and does not start.** `--version`, `info` and
 *   `image inspect` are reads `classifyHostCommand` passes; the canary is
 *   `run`, an effect, and a dry run refuses it. The reading then records the
 *   canary as *not run*, so the attestation is `unavailable` — never confirmed
 *   by a canary that did not happen.
 * - **A reading is dated when it starts**, and `SandboxProbeCache.fresh` keeps
 *   it only for `SANDBOX_PROBE_MAX_AGE_MS` — the same ten minutes the
 *   attestation itself allows — so nothing can treat an older reading as
 *   current.
 *
 * Settings are read here too, as a pure function over VS Code's `inspect()`
 * result, because two of them are a security boundary: the **image**, engine,
 * CPU and memory settings are machine-scoped and only the user's own value is
 * read — a repository must not be able to choose what runs your commands —
 * while `mode` takes the **tightest** value from any scope, so a repository may
 * ask for the sandbox but never switch it off.
 *
 * The probe and every function it calls take the engine runner injected; the
 * default runner at the bottom is the one place a process starts, through
 * `windowsShimBypass` (no shell, ever) and behind `guardHostCommand`.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { guardHostCommand } from './dryRunHost.js';
import { isDryRunBlockedError } from './dryRun.js';
import { parseContainerEngineSecurity, parseDockerInfo } from './localCiRunner.js';
import {
  SANDBOX_ATTESTATION_RULES,
  SANDBOX_MOUNT_TARGET,
  SANDBOX_NAME_PREFIX,
  SANDBOX_PROBE_MAX_AGE_MS,
  assessSandboxAttestation,
  buildSandboxArgv,
  parseSandboxImageReference,
  readSandboxMode,
  type SandboxAttestation,
  type SandboxAttestationRuleId,
  type SandboxConfiguration,
  type SandboxEngine,
  type SandboxEngineSetting,
  type SandboxHostFacts,
  type SandboxMode,
  type SandboxProbe,
} from './sandboxPlan.js';
import {
  createWorkspaceCommandProbe,
  resolveWorkspaceCommand,
  type WorkspaceCommandProbe,
} from './windowsShimBypass.js';
import {
  RELAX_TERMINAL_APPROVALS_SETTING_RULE,
  SANDBOX_RELAXATION_RULES,
  describeSandboxRelaxationState,
  type RelaxTerminalApprovalsReading,
} from './sandboxApprovalRelaxation.js';
import { redactSecrets } from '../utils/secretRedactor.js';

// ── Constants ────────────────────────────────────────────────────

/** `auto` tries these, in this order, and takes the first whose engine answers. */
export const SANDBOX_ENGINE_ORDER: readonly SandboxEngine[] = ['docker', 'podman'];

/**
 * The trivial command the canary runs inside the sandbox argv. Constant: it
 * reads one directory and writes nothing, and exits 0 only if the mount is
 * where the argv says it is.
 */
export const SANDBOX_CANARY_COMMAND: { executable: string; args: readonly string[] } = {
  executable: 'test',
  args: ['-d', SANDBOX_MOUNT_TARGET],
};

/** How long each probe step may take. A container's first start on a desktop VM can take a while. */
export const SANDBOX_PROBE_TIMEOUTS_MS = {
  version: 10_000,
  info: 20_000,
  image: 20_000,
  canary: 60_000,
  cleanup: 15_000,
} as const;

/** The constant argv of every read the probe makes. The engine is the only thing chosen. */
function infoArgs(engine: SandboxEngine): string[] {
  // Docker's documented JSON form is a template; Podman documents `json`.
  return engine === 'docker' ? ['info', '--format', '{{json .}}'] : ['info', '--format', 'json'];
}

function imageInspectArgs(reference: string): string[] {
  return ['image', 'inspect', '--format', '{{json .RepoDigests}}', reference];
}

// ── Runner ───────────────────────────────────────────────────────

export type SandboxRunOutcome =
  | { ok: true; stdout: string }
  | {
    ok: false;
    /** `not-found`: no engine CLI to start. `dry-run`: refused by the dry run before starting. */
    kind: 'not-found' | 'exit' | 'timeout' | 'dry-run' | 'error';
    detail: string;
  };

/** Runs one engine command. Injected so every branch of the probe is testable without an engine. */
export type SandboxEngineRunner = (
  engine: SandboxEngine,
  args: readonly string[],
  timeoutMs: number,
) => Promise<SandboxRunOutcome>;

// ── Reading ──────────────────────────────────────────────────────

export type SandboxProbeStepId = 'cli' | 'info' | 'image' | 'canary' | 'canary-cleanup';
/** `blocked`: a dry run refused it. `skipped`: not attempted, and the detail says why. */
export type SandboxProbeStepOutcome = 'ok' | 'failed' | 'skipped' | 'blocked';

export interface SandboxProbeStep {
  engine: SandboxEngine;
  id: SandboxProbeStepId;
  outcome: SandboxProbeStepOutcome;
  /** What happened, for a person. Redacted, control-stripped and bounded. */
  detail: string;
}

export interface SandboxProbeReport {
  probe: SandboxProbe;
  /** Every step attempted or deliberately not attempted, in order, across every engine tried. */
  steps: SandboxProbeStep[];
  /** The canary's argv after the engine name, when one was built — shown so the check says exactly what it ran. */
  canaryArgv?: string[];
}

export interface SandboxProbeInput {
  configuration: SandboxConfiguration;
  host: SandboxHostFacts;
  /**
   * The folder the canary mounts: the root agent commands would run in. Absent
   * when no folder is open, and then the canary is not run.
   */
  canaryRoot?: string;
  runner: SandboxEngineRunner;
  now: () => Date;
  /** A fresh 8–32 character lowercase id for the canary container. */
  runId?: () => string;
}

/** Engine output is somebody else's text: redacted, stripped of control characters, a few lines at most. */
function cleanDetail(value: string): string {
  const redacted = redactSecrets(String(value ?? '')).text;
  const lines = redacted
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map(line => line.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3);
  const joined = lines.join(' — ');
  return joined.length > 300 ? `${joined.slice(0, 297)}…` : joined;
}

function outcomeDetail(outcome: Exclude<SandboxRunOutcome, { ok: true }>): string {
  const detail = cleanDetail(outcome.detail);
  switch (outcome.kind) {
    case 'not-found':
      return detail || 'The command-line tool was not found.';
    case 'timeout':
      return `It did not answer in time.${detail ? ` ${detail}` : ''}`;
    case 'dry-run':
      return 'Dry run is on, and this step starts a container, which is an effect — so it was not run.';
    default:
      return detail || 'It exited with an error and said nothing more.';
  }
}

interface EngineReading {
  engine: SandboxEngine;
  cliPresent: boolean;
  infoOk: boolean;
  serverOs: string;
  arch: string;
  runtimes: string[];
  rootless?: boolean;
}

async function readEngine(
  engine: SandboxEngine,
  runner: SandboxEngineRunner,
  steps: SandboxProbeStep[],
): Promise<EngineReading> {
  const reading: EngineReading = { engine, cliPresent: false, infoOk: false, serverOs: '', arch: '', runtimes: [] };
  const version = await safeRun(runner, engine, ['--version'], SANDBOX_PROBE_TIMEOUTS_MS.version);
  if (!version.ok) {
    steps.push({ engine, id: 'cli', outcome: version.kind === 'dry-run' ? 'blocked' : 'failed', detail: outcomeDetail(version) });
    steps.push({ engine, id: 'info', outcome: 'skipped', detail: `The ${engine} command-line tool did not answer, so its engine was not asked.` });
    return reading;
  }
  reading.cliPresent = true;
  steps.push({ engine, id: 'cli', outcome: 'ok', detail: cleanDetail(version.stdout) || `${engine} answered.` });

  const info = await safeRun(runner, engine, infoArgs(engine), SANDBOX_PROBE_TIMEOUTS_MS.info);
  if (!info.ok) {
    steps.push({
      engine,
      id: 'info',
      outcome: info.kind === 'dry-run' ? 'blocked' : 'failed',
      detail: `The engine did not answer — it may not be running. ${outcomeDetail(info)}`,
    });
    return reading;
  }
  const capacity = parseDockerInfo(info.stdout);
  if (!capacity) {
    steps.push({
      engine,
      id: 'info',
      outcome: 'failed',
      detail: 'The engine answered, but not with an OS, architecture, CPU count and memory AtlasMind could read.',
    });
    return reading;
  }
  const security = parseContainerEngineSecurity(info.stdout);
  reading.infoOk = true;
  reading.serverOs = capacity.os;
  reading.arch = capacity.arch;
  reading.runtimes = security.runtimes;
  if (security.rootless !== undefined) {
    reading.rootless = security.rootless;
  }
  steps.push({
    engine,
    id: 'info',
    outcome: 'ok',
    detail: `${capacity.os} containers on ${capacity.arch}, ${capacity.cpuCount} CPUs, ${capacity.memoryGb} GB; `
      + (security.rootless === undefined ? 'whether it runs rootless was not reported.' : security.rootless ? 'rootless.' : 'rootful.'),
  });
  return reading;
}

/** A runner that throws is a failed step, never a crashed probe. */
async function safeRun(
  runner: SandboxEngineRunner,
  engine: SandboxEngine,
  args: readonly string[],
  timeoutMs: number,
): Promise<SandboxRunOutcome> {
  try {
    const outcome = await runner(engine, args, timeoutMs);
    if (outcome && typeof outcome === 'object' && (outcome.ok === true || outcome.ok === false)) {
      return outcome.ok ? { ok: true, stdout: typeof outcome.stdout === 'string' ? outcome.stdout : '' } : outcome;
    }
    return { ok: false, kind: 'error', detail: 'The engine runner returned nothing readable.' };
  } catch (error) {
    return {
      ok: false,
      kind: isDryRunBlockedError(error) ? 'dry-run' : 'error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Whether `image inspect`'s `RepoDigests` output records the pinned digest. */
export function repoDigestsInclude(raw: string, digest: string): boolean {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      && value.slice(0, 64).some(entry => typeof entry === 'string' && entry.endsWith(`@${digest}`));
  } catch {
    return false;
  }
}

function defaultRunId(): string {
  return `canary${randomBytes(6).toString('hex')}`;
}

/**
 * Take one reading. Never throws: every failure is a step with a reason, and
 * the returned `probe` is what `assessSandboxAttestation` judges.
 */
export async function probeSandbox(input: SandboxProbeInput): Promise<SandboxProbeReport> {
  const started = input.now();
  const probedAt = started.toISOString();
  const { configuration, runner } = input;
  const steps: SandboxProbeStep[] = [];
  const engines = configuration.engine === 'auto' ? [...SANDBOX_ENGINE_ORDER] : [configuration.engine];

  const readings: EngineReading[] = [];
  for (const engine of engines) {
    const reading = await readEngine(engine, runner, steps);
    readings.push(reading);
    if (reading.infoOk) {
      break;
    }
  }
  // The first engine that answered; else the first that is at least installed;
  // else the first tried, so the reported failure is about the preferred engine.
  const chosen = readings.find(reading => reading.infoOk)
    ?? readings.find(reading => reading.cliPresent)
    ?? readings[0]!;

  const probe: SandboxProbe = {
    engine: chosen.engine,
    cliPresent: chosen.cliPresent,
    infoOk: chosen.infoOk,
    serverOs: chosen.serverOs,
    arch: chosen.arch,
    runtimes: chosen.runtimes,
    ...(chosen.rootless === undefined ? {} : { rootless: chosen.rootless }),
    image: configuration.image,
    canary: 'not-run',
    probedAt,
  };
  const engine = chosen.engine;

  // Image: only a reference that parsed as pinned is ever handed to the engine.
  const image = parseSandboxImageReference(configuration.image);
  if (!chosen.infoOk) {
    steps.push({ engine, id: 'image', outcome: 'skipped', detail: 'The engine did not answer, so the image was not looked for.' });
  } else if (!image.ok) {
    steps.push({ engine, id: 'image', outcome: 'skipped', detail: `${image.reason} Nothing was looked up.` });
  } else {
    const inspected = await safeRun(runner, engine, imageInspectArgs(image.reference), SANDBOX_PROBE_TIMEOUTS_MS.image);
    if (inspected.ok && repoDigestsInclude(inspected.stdout, image.digest)) {
      probe.imageDigest = image.digest;
      steps.push({ engine, id: 'image', outcome: 'ok', detail: `${image.reference} is present locally.` });
    } else if (inspected.ok) {
      steps.push({
        engine,
        id: 'image',
        outcome: 'failed',
        detail: `An image answered to ${image.reference}, but its recorded digests do not include ${image.digest}.`,
      });
    } else {
      steps.push({
        engine,
        id: 'image',
        outcome: inspected.kind === 'dry-run' ? 'blocked' : 'failed',
        detail: inspected.kind === 'exit'
          ? `${image.reference} is not present locally. AtlasMind never pulls it for you.`
          : outcomeDetail(inspected),
      });
    }
  }

  // Canary: only when every rule before it already passes, so it can prove something.
  const beforeCanary = assessSandboxAttestation({ ...probe, canary: 'passed' }, configuration, started);
  if (beforeCanary.status === 'unavailable') {
    steps.push({
      engine,
      id: 'canary',
      outcome: 'skipped',
      detail: `Not run: the "${beforeCanary.rule}" rule already fails, so a canary would prove nothing.`,
    });
    return { probe, steps };
  }
  if (!input.canaryRoot) {
    steps.push({ engine, id: 'canary', outcome: 'skipped', detail: 'Not run: no folder is open, so there is nothing to mount.' });
    return { probe, steps };
  }
  const runId = (input.runId ?? defaultRunId)();
  const built = buildSandboxArgv({
    engine,
    image: configuration.image,
    runId,
    host: input.host,
    rootless: probe.rootless === true,
    cpus: configuration.cpus,
    memoryGb: configuration.memoryGb,
    executable: SANDBOX_CANARY_COMMAND.executable,
    args: SANDBOX_CANARY_COMMAND.args,
    root: input.canaryRoot,
    cwd: input.canaryRoot,
    env: {},
  });
  if (!built.ok) {
    steps.push({
      engine,
      id: 'canary',
      outcome: 'skipped',
      detail: `Not run: the sandbox argv was refused by its "${built.rule}" rule. ${built.reason} A command in this folder would be refused the same way.`,
    });
    return { probe, steps };
  }
  const canary = await safeRun(runner, built.command, built.argv, SANDBOX_PROBE_TIMEOUTS_MS.canary);
  if (canary.ok) {
    probe.canary = 'passed';
    steps.push({ engine, id: 'canary', outcome: 'ok', detail: 'The canary started inside the sandbox argv and found the mounted folder.' });
  } else if (canary.kind === 'dry-run') {
    steps.push({ engine, id: 'canary', outcome: 'blocked', detail: outcomeDetail(canary) });
  } else {
    probe.canary = 'failed';
    steps.push({ engine, id: 'canary', outcome: 'failed', detail: outcomeDetail(canary) });
    if (canary.kind === 'timeout') {
      // The CLI was stopped; the container it asked for may still be starting.
      // It is named, so it can be removed by that name and nothing else.
      const cleanup = await safeRun(
        runner,
        built.command,
        ['rm', '--force', `${SANDBOX_NAME_PREFIX}${runId}`],
        SANDBOX_PROBE_TIMEOUTS_MS.cleanup,
      );
      steps.push({
        engine,
        id: 'canary-cleanup',
        outcome: cleanup.ok ? 'ok' : cleanup.kind === 'dry-run' ? 'blocked' : 'failed',
        detail: cleanup.ok ? 'Removed the canary container by name.' : outcomeDetail(cleanup),
      });
    }
  }
  return { probe, steps, canaryArgv: built.argv };
}

// ── Cache ────────────────────────────────────────────────────────

/**
 * The latest reading, in memory only. A reading is a fact about this machine
 * at one moment, so it is never written anywhere a later session or another
 * person could mistake it for a current one.
 */
export class SandboxProbeCache {
  private reading: SandboxProbeReport | undefined;

  record(report: SandboxProbeReport): void {
    this.reading = report;
  }

  /** The reading, whatever its age. */
  latest(): SandboxProbeReport | undefined {
    return this.reading;
  }

  /**
   * The reading only while the attestation could still rest on it — younger
   * than `SANDBOX_PROBE_MAX_AGE_MS` and not dated in the future, B1's rule.
   */
  fresh(now: Date): SandboxProbeReport | undefined {
    const probedAt = this.reading ? Date.parse(this.reading.probe.probedAt) : Number.NaN;
    if (!Number.isFinite(probedAt)) {
      return undefined;
    }
    const age = now.getTime() - probedAt;
    return age >= 0 && age < SANDBOX_PROBE_MAX_AGE_MS ? this.reading : undefined;
  }

  /** What the latest reading vouches for now — stale, mismatched and absent readings all say so. */
  attestation(configuration: Pick<SandboxConfiguration, 'engine' | 'image'>, now: Date): SandboxAttestation {
    return assessSandboxAttestation(this.reading?.probe, configuration, now);
  }
}

let sharedCache: SandboxProbeCache | undefined;

/** The one cache the check command writes and `sandboxRunner` reads, so a check counts for the next command. */
export function sharedSandboxProbeCache(): SandboxProbeCache {
  sharedCache ??= new SandboxProbeCache();
  return sharedCache;
}

// ── Settings ─────────────────────────────────────────────────────

export type SandboxSettingKey = 'mode' | 'engine' | 'image' | 'cpus' | 'memoryGb';

/** The fields of VS Code's `WorkspaceConfiguration.inspect()` this reads. */
export interface SandboxSettingInspection {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

export const SANDBOX_SETTING_DEFAULTS: Readonly<SandboxConfiguration> = {
  mode: 'off',
  engine: 'auto',
  image: '',
  cpus: 2,
  memoryGb: 4,
};

/** How each setting is read. Published so the check can show the rule beside the value. */
export const SANDBOX_SETTING_RULES: Readonly<Record<SandboxSettingKey, string>> = {
  mode: 'Tightest scope wins: if your user settings, the workspace or a folder asks for require, it is require. '
    + 'A repository may ask for the sandbox; it can never switch it off.',
  engine: 'Machine-scoped: only your user value is read. Which engine runs commands is a fact about this computer.',
  image: 'Machine-scoped: only your user value is read. A repository must never choose the image your commands run in.',
  cpus: 'Machine-scoped: only your user value is read.',
  memoryGb: 'Machine-scoped: only your user value is read.',
};

export interface SandboxConfigurationReading {
  /** Present only when every setting was readable. Absent means the probe does not run. */
  configuration?: SandboxConfiguration;
  /** A setting that is not a value AtlasMind can use — refused, not coerced into one. */
  problems: string[];
  /** Values set in a scope that is not read, named so nobody wonders why they did nothing. */
  ignored: string[];
}

const ENGINE_SETTINGS: readonly SandboxEngineSetting[] = ['auto', 'docker', 'podman'];

function machineValue(
  key: SandboxSettingKey,
  inspection: SandboxSettingInspection | undefined,
  ignored: string[],
): unknown {
  if (inspection?.workspaceValue !== undefined || inspection?.workspaceFolderValue !== undefined) {
    ignored.push(
      `A workspace or folder value for atlasmind.sandbox.${key} was ignored. ${SANDBOX_SETTING_RULES[key]}`,
    );
  }
  if (inspection?.globalValue !== undefined) {
    return inspection.globalValue;
  }
  return inspection?.defaultValue !== undefined ? inspection.defaultValue : SANDBOX_SETTING_DEFAULTS[key];
}

/**
 * The mode alone, by the tightest-scope rule: `require` if any scope asks for
 * it. Separate from `readSandboxConfiguration` because the mode must be known
 * even when another setting is unusable — a `require` beside a mistyped CPU
 * limit refuses every command, and must never read as `off`.
 */
export function readSandboxModeSetting(inspection: SandboxSettingInspection | undefined): SandboxMode {
  const declared = [inspection?.globalValue, inspection?.workspaceValue, inspection?.workspaceFolderValue]
    .filter(value => value !== undefined && value !== null);
  return declared.some(value => readSandboxMode(value) === 'require') ? 'require' : 'off';
}

/**
 * Read the five sandbox settings from their per-scope values. Pure: the
 * caller passes `inspect()`.
 */
export function readSandboxConfiguration(
  inspect: (key: SandboxSettingKey) => SandboxSettingInspection | undefined,
): SandboxConfigurationReading {
  const problems: string[] = [];
  const ignored: string[] = [];

  const mode = readSandboxModeSetting(inspect('mode'));

  const engine = machineValue('engine', inspect('engine'), ignored);
  if (typeof engine !== 'string' || !ENGINE_SETTINGS.includes(engine as SandboxEngineSetting)) {
    problems.push('atlasmind.sandbox.engine must be auto, docker or podman. It is refused rather than guessed at.');
  }
  const image = machineValue('image', inspect('image'), ignored);
  if (typeof image !== 'string') {
    problems.push('atlasmind.sandbox.image must be a string: an image pinned as name@sha256:<digest>, or empty.');
  }
  const cpus = machineValue('cpus', inspect('cpus'), ignored);
  if (typeof cpus !== 'number' || !Number.isFinite(cpus)) {
    problems.push('atlasmind.sandbox.cpus must be a number.');
  }
  const memoryGb = machineValue('memoryGb', inspect('memoryGb'), ignored);
  if (typeof memoryGb !== 'number' || !Number.isFinite(memoryGb)) {
    problems.push('atlasmind.sandbox.memoryGb must be a number.');
  }
  if (problems.length > 0) {
    return { problems, ignored };
  }
  return {
    configuration: {
      mode,
      engine: engine as SandboxEngineSetting,
      image: image as string,
      cpus: cpus as number,
      memoryGb: memoryGb as number,
    },
    problems,
    ignored,
  };
}

// ── Host ─────────────────────────────────────────────────────────

/**
 * Facts about this machine the argv needs: the OS, your uid:gid on Linux, your
 * home directory, and the ssh agent's socket so it is never mounted.
 */
export function readSandboxHostFacts(env: NodeJS.ProcessEnv = process.env): SandboxHostFacts {
  const platform = os.platform();
  let user: SandboxHostFacts['user'];
  if (platform === 'linux') {
    try {
      const info = os.userInfo();
      user = { uid: info.uid, gid: info.gid };
    } catch {
      // Unknown stays unknown; buildSandboxArgv refuses a Linux host without it.
    }
  }
  const agent = env['SSH_AUTH_SOCK'];
  return {
    os: platform,
    ...(user ? { user } : {}),
    homeDir: os.homedir(),
    sensitivePaths: typeof agent === 'string' && agent && path.isAbsolute(agent) ? [agent] : [],
  };
}

// ── Remediation and report ───────────────────────────────────────

export interface SandboxRemediationContext {
  engine: SandboxEngine;
  image: string;
  hostOs: string;
}

/**
 * What to do about the rule that failed, as steps a person runs themselves.
 * Nothing here is done for them: installing an engine, switching its mode and
 * choosing and pulling an image are each a decision about their machine.
 */
export function describeSandboxRemediation(rule: SandboxAttestationRuleId, context: SandboxRemediationContext): string[] {
  const engine = context.engine;
  const pinned = parseSandboxImageReference(context.image);
  switch (rule) {
    case 'probed':
    case 'probe-fresh':
      return ['Run **AtlasMind: Check Execution Sandbox** again. A reading counts for ten minutes.'];
    case 'cli-present':
      return [
        context.hostOs === 'linux'
          ? 'Install Docker Engine (https://docs.docker.com/engine/install/) or Podman (https://podman.io/docs/installation).'
          : 'Install Docker Desktop (https://docs.docker.com/desktop/) or Podman Desktop (https://podman-desktop.io/).',
        'Make sure `docker --version` (or `podman --version`) works in a new terminal, then reload this window — a tool installed after VS Code started is often not on its PATH yet.',
      ];
    case 'engine-answers':
      return [
        engine === 'podman'
          ? (context.hostOs === 'linux' ? 'Start Podman\'s service, or check `podman info` works in a terminal.' : 'Start the Podman machine: `podman machine start`.')
          : (context.hostOs === 'linux' ? 'Start the Docker daemon: `sudo systemctl start docker`.' : 'Start Docker Desktop and wait until it says the engine is running.'),
        `Check \`${engine} info\` answers in a terminal, then run the check again.`,
      ];
    case 'engine-matches-setting':
      return ['Set `atlasmind.sandbox.engine` (user settings) to `auto`, or to the engine that is installed.'];
    case 'linux-engine':
      return [
        engine === 'docker'
          ? 'Docker Desktop is in Windows-container mode. Right-click its tray icon and choose **Switch to Linux containers…**.'
          : 'The Podman machine must run Linux containers; recreate it with `podman machine init` if it does not.',
      ];
    case 'user-namespace-known':
      return engine === 'docker'
        ? ['Use rootful Docker (Docker Desktop and the default Docker Engine install are). Rootless Docker is not supported yet, because its user mapping would write files your account cannot own.']
        : ['Run Podman rootless (its default): `podman info` should report `rootless: true`. Rootful Podman runs containers as host root and is not used.'];
    case 'image-pinned':
      return [
        'Choose an image that has the tools your project\'s commands need — for a Node project, the official `node` image at the version you use. It is your choice; AtlasMind does not pick one.',
        `Pull it by its tag once: \`${engine} pull node:22-bookworm-slim\` (substitute your choice).`,
        `Read its digest: \`${engine} image inspect --format "{{index .RepoDigests 0}}" node:22-bookworm-slim\` — it prints \`name@sha256:<64 hex>\`.`,
        'Set `atlasmind.sandbox.image` in your **user** settings to exactly that value. A tag alone is refused: it is a pointer somebody else can move.',
      ];
    case 'image-present':
      return pinned.ok
        ? [
          `Pull the pinned image yourself: \`${engine} pull ${pinned.reference}\`. Pulling by digest fetches exactly that image and nothing else.`,
          'Then run the check again. AtlasMind never pulls an image on its own.',
        ]
        : ['Set `atlasmind.sandbox.image` to an image pinned by digest first.'];
    case 'canary-passed':
      return [
        'Read the canary step above for what the engine said.',
        'The image must contain `test` (any image with coreutils or busybox does; distroless images do not).',
        context.hostOs === 'linux'
          ? 'The folder must be readable by your user inside the container.'
          : 'The folder must be one the engine can share: in Docker Desktop, Settings → Resources → File sharing.',
        'If dry run is on, the canary is not run — starting a container is an effect. Turn dry run off to check.',
      ];
    default:
      return [];
  }
}

export interface SandboxCheckReportInput {
  reading: SandboxConfigurationReading;
  report?: SandboxProbeReport;
  attestation: SandboxAttestation;
  hostOs: string;
  /** Whether a dry run was on when the check ran. */
  dryRun: boolean;
  now: Date;
  /**
   * The mode as `readSandboxModeSetting` reads it. Passed separately because
   * unusable settings leave `reading.configuration` absent, and a `require`
   * must still be reported as one.
   */
  mode?: SandboxMode;
  /**
   * Your opt-in to relaxed terminal approvals and the ceiling it sits under.
   * Absent, the report says nothing about relaxation rather than guessing.
   */
  relaxation?: { setting: RelaxTerminalApprovalsReading; allowTerminalWrite: boolean };
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * The check as a markdown document. Every attestation rule is listed with its
 * result: passed, failed with the reason, or not evaluated because a rule
 * above it failed — the first failure is the one to fix, and a rule after it is
 * not reported as passing when nothing checked it.
 */
export function renderSandboxCheckReport(input: SandboxCheckReportInput): string {
  const { reading, report, attestation } = input;
  const lines: string[] = ['# AtlasMind execution sandbox', ''];
  const mode = input.mode ?? reading.configuration?.mode ?? 'off';
  if (attestation.status === 'confirmed') {
    lines.push(`**Confirmed** — ${attestation.engine}, ${attestation.image}. Attestation \`${attestation.id}\`, valid until ${attestation.expiresAt}.`);
  } else {
    lines.push(`**Unavailable** — rule \`${attestation.rule}\`: ${attestation.reason}`);
  }
  lines.push(
    '',
    `Checked ${input.now.toISOString()}. Mode: **${mode}**.`,
    '',
    mode === 'require'
      ? '> **Enforced.** The mode is `require`: every agent command runs in this sandbox or is refused, with the rule that '
        + 'stopped it — never on your machine instead. git, and anything that installs, publishes or reaches the network, '
        + 'is refused rather than run. Approvals are unchanged unless you opted in to relaxed terminal approvals — '
        + 'see *Approval relaxation* below.'
      : '> **Off.** The mode is `off`, so agent commands run on your machine, behind the same approvals as always. '
        + 'Set `atlasmind.sandbox.mode` to `require` to run them in this sandbox or refuse them.',
    '',
  );
  if (input.dryRun) {
    lines.push('> Dry run is on: the engine was read, but the canary container was not started, so the sandbox cannot be confirmed.', '');
  }

  if (reading.problems.length > 0) {
    lines.push('## Settings that cannot be used', '', ...reading.problems.map(problem => `- ${problem}`), '', 'Nothing was probed.', '');
  }
  if (reading.ignored.length > 0) {
    lines.push('## Settings that were ignored', '', ...reading.ignored.map(note => `- ${note}`), '');
  }

  lines.push('## Attestation rules', '', '| Rule | Result | Why |', '|---|---|---|');
  const failedIndex = attestation.status === 'unavailable'
    ? SANDBOX_ATTESTATION_RULES.findIndex(rule => rule.id === attestation.rule)
    : -1;
  SANDBOX_ATTESTATION_RULES.forEach((rule, index) => {
    let result: string;
    let why: string;
    if (failedIndex === -1 || index < failedIndex) {
      result = 'passed';
      why = rule.description;
    } else if (index === failedIndex && attestation.status === 'unavailable') {
      result = '**failed**';
      why = attestation.reason;
    } else {
      result = 'not evaluated';
      why = 'A rule above it failed; it is not reported as passing when nothing checked it.';
    }
    lines.push(`| \`${rule.id}\` | ${result} | ${cell(why)} |`);
  });
  lines.push('');

  if (report) {
    lines.push('## What the probe did', '', '| Engine | Step | Outcome | Detail |', '|---|---|---|---|');
    for (const step of report.steps) {
      lines.push(`| ${step.engine} | ${step.id} | ${step.outcome} | ${cell(step.detail)} |`);
    }
    lines.push('');
    if (report.canaryArgv) {
      lines.push('The canary ran exactly this (no shell):', '', '```', [report.probe.engine, ...report.canaryArgv].join(' '), '```', '');
    }
  }

  if (attestation.status === 'unavailable') {
    const steps = describeSandboxRemediation(attestation.rule, {
      engine: report?.probe.engine ?? (reading.configuration?.engine === 'podman' ? 'podman' : 'docker'),
      image: reading.configuration?.image ?? '',
      hostOs: input.hostOs,
    });
    if (steps.length > 0) {
      lines.push('## What to do', '', ...steps.map((step, index) => `${index + 1}. ${step}`), '');
    }
  }

  if (input.relaxation) {
    const view = describeSandboxRelaxationState({
      setting: input.relaxation.setting,
      mode,
      allowTerminalWrite: input.relaxation.allowTerminalWrite,
      attestation,
    });
    lines.push('## Approval relaxation', '', `**${view.headline}** (\`${view.state}\`). ${view.detail}`, '');
    if (input.relaxation.setting.problem) {
      lines.push(`- ${input.relaxation.setting.problem}`, '');
    }
    lines.push(
      'A terminal write skips its prompt only when every rule below lets it; the first that decides is the one that applies.',
      '',
      '| Rule | Outcome | Why |',
      '|---|---|---|',
      ...SANDBOX_RELAXATION_RULES.map(rule => `| \`${rule.id}\` | ${rule.outcome} | ${cell(rule.description)} |`),
      '',
    );
  }

  lines.push(
    '## How the settings are read',
    '',
    ...(Object.keys(SANDBOX_SETTING_RULES) as SandboxSettingKey[]).map(key => `- \`atlasmind.sandbox.${key}\` — ${SANDBOX_SETTING_RULES[key]}`),
    ...(input.relaxation ? [`- \`atlasmind.sandbox.relaxTerminalApprovals\` — ${RELAX_TERMINAL_APPROVALS_SETTING_RULE}`] : []),
    '',
  );
  return lines.join('\n');
}

// ── Default runner ───────────────────────────────────────────────

interface ExecFileFailure extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: string | null;
}

/**
 * The real runner. The engine is resolved through `windowsShimBypass` and
 * started with an argument vector — never a shell — and only a real
 * executable is accepted: an engine name that resolves to a script shim is not
 * the engine. Every command is graded by `guardHostCommand` first, so a dry run
 * lets the reads through and refuses the canary.
 */
export function createSandboxEngineRunner(
  commandProbe: WorkspaceCommandProbe = createWorkspaceCommandProbe(),
): SandboxEngineRunner {
  return async (engine, args, timeoutMs) => {
    if (engine !== 'docker' && engine !== 'podman') {
      return { ok: false, kind: 'error', detail: 'Only docker and podman are run.' };
    }
    try {
      guardHostCommand('sandbox', engine, args);
    } catch (error) {
      if (isDryRunBlockedError(error)) {
        return { ok: false, kind: 'dry-run', detail: error.message };
      }
      throw error;
    }
    const resolution = resolveWorkspaceCommand(engine, args, commandProbe);
    if (resolution.status === 'unresolved') {
      return { ok: false, kind: 'not-found', detail: resolution.reason };
    }
    if (resolution.status === 'node') {
      return {
        ok: false,
        kind: 'not-found',
        detail: `\`${engine}\` resolved to a script shim (${resolution.viaShim}), not the engine's own executable.`,
      };
    }
    return new Promise<SandboxRunOutcome>(resolve => {
      execFile(
        resolution.command,
        resolution.args,
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ ok: true, stdout: String(stdout) });
            return;
          }
          const failure = error as ExecFileFailure;
          if (failure.code === 'ENOENT') {
            resolve({ ok: false, kind: 'not-found', detail: `\`${engine}\` was not found on PATH.` });
          } else if (failure.killed || failure.signal) {
            resolve({ ok: false, kind: 'timeout', detail: String(stderr ?? '') });
          } else {
            resolve({ ok: false, kind: 'exit', detail: String(stderr || stdout || failure.message || '') });
          }
        },
      );
    });
  };
}
