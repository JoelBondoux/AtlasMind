/**
 * Sandboxed execution — the pure core. What a command would be run *as*, decided
 * before anything is started, and the rules that decide whether it may be run
 * in a container at all.
 *
 * Every agent-issued command reaches one choke point — `runCommand` in
 * `extension.ts` — and that point runs it on the host: no shell (the
 * `windowsShimBypass` rule), inside the workspace (`assertInsideWorkspace`,
 * rooted through `utils/workspaceRoots.ts`), at below-normal priority, and with
 * the editor's **entire** environment, provider keys included. An approval
 * dialog is therefore the only thing between a model-chosen command and
 * everything the editor can reach. A sandbox is a second, structural answer:
 * the command runs, but in a container that has no network, no capabilities,
 * no host credentials and exactly one folder of the host's filesystem.
 *
 * This module decides; it starts nothing. Nothing here imports `vscode` or
 * `child_process`: `sandboxProbe.ts` fills a `SandboxProbe` and reads the
 * settings, and `sandboxRunner.ts` hands `argv` to the engine from `runCommand`
 * and the other covered paths. What is fixed here is the shape of the
 * guarantee, as values a test can walk:
 *
 * 1. **Only a digest-pinned image runs.** `name@sha256:<64 hex>` and nothing
 *    else. A tag is a pointer somebody else can move, so a tag-only reference
 *    is **refused, never coerced** — resolving it to "whatever it points at
 *    today" would turn the image somebody reviewed into the image the registry
 *    serves. A reference carrying both a tag and a digest is refused too: the
 *    engine ignores the tag, so it reads as something that is not what runs.
 * 2. **Only a Linux engine.** Docker Desktop in Windows-container mode answers
 *    `docker info` happily and runs nothing this argv describes; it is
 *    `unavailable`, not a weaker sandbox.
 * 3. **A stale probe is no probe.** An attestation lasts ten minutes from the
 *    reading it rests on. A daemon restarted into another mode, an image pulled
 *    over the pinned one, a context switched to a remote engine — none of these
 *    announce themselves, so "it was fine earlier" is not evidence now.
 * 4. **The argv is constant-shaped.** No network, every capability dropped, no
 *    privilege escalation, read-only root with a bounded `/tmp`, pid, CPU and
 *    memory limits, the image never pulled, and **exactly one** bind mount —
 *    the worktree or component root, by `--mount` (never `-v`, whose colon
 *    syntax a Windows drive letter breaks). Never the engine socket, never the
 *    home directory, never a credential folder, never the ssh agent. The
 *    environment is an allowlist with a validator per name; provider keys
 *    cannot cross because nothing names them. On a Linux host the command runs
 *    as the editor's own `uid:gid`, so files it writes are yours.
 * 5. **`require` never falls back to the host.** Under `require` the route is
 *    `sandbox` or `refuse` — a sandbox that is unavailable refuses the command
 *    and says which rule failed. There is deliberately no `prefer` mode: a
 *    mode that quietly runs on the host when the container is unavailable is
 *    exactly where a silent fallback would hide, and an unrecognised mode is
 *    read as `require`, because whoever wrote it wanted a sandbox.
 * 6. **Some commands are never sandboxed.** git (a worktree's metadata lives
 *    outside the mounted folder, and history belongs to the host's git tools),
 *    gh, container engines, network clients, and anything that publishes or
 *    installs — the vocabulary `scheduledRoutinePolicy` already uses, reused so
 *    the two cannot disagree about what an install is. Under `require` they are
 *    refused, not run on the host.
 * 7. **A sandbox changes where a command runs, not whether it is allowed.**
 *    `SANDBOX_INTERACTION_RULES` states what this slice leaves untouched: dry
 *    run still wins (a sandboxed run is still an effect), provenance taint is
 *    not relaxed, unattended routines are not unlocked, and approvals are not
 *    loosened.
 *
 * Pure: no `vscode`, no `child_process`, no I/O, clock injected.
 */

import * as path from 'node:path';
import { classifyUnattendedStep, type UnattendedStepRuleId } from './scheduledRoutinePolicy.js';
import type { LocalCiCapacity } from './localCiRunner.js';

// ── Vocabulary ───────────────────────────────────────────────────

export type SandboxEngine = 'docker' | 'podman';
export type SandboxEngineSetting = 'auto' | SandboxEngine;
/**
 * How strong the isolation boundary is. Only `container` is produced in this
 * slice; gVisor (`runsc`) and micro-VM runtimes are a later tier, declared here
 * so an attestation already says which one it vouches for.
 */
export type SandboxStrength = 'container' | 'gvisor' | 'microvm';
/** `off` runs on the host as today. There is no `prefer`. */
export type SandboxMode = 'off' | 'require';
export type SandboxHostOs = 'linux' | 'darwin' | 'win32';
export type SandboxCanary = 'passed' | 'failed' | 'not-run';

/**
 * One reading of the container engine, taken by the probe (a later slice).
 *
 * `serverOs` and `arch` are the engine's own report — the same `OSType` and
 * `Architecture` fields `localCiRunner.parseDockerInfo` already reads into a
 * `LocalCiCapacity`, so the probe fills them from that parser rather than a
 * second one. `runtimes` is the engine's runtime list as
 * `parseDockerGpuRuntimes` reads it.
 */
export interface SandboxProbe {
  engine: SandboxEngine;
  /** The engine's CLI answered `--version`. */
  cliPresent: boolean;
  /** `<engine> info` answered with something `parseDockerInfo` could read. */
  infoOk: boolean;
  serverOs: LocalCiCapacity['os'];
  arch: LocalCiCapacity['arch'];
  runtimes: readonly string[];
  /**
   * Whether the engine runs rootless. `undefined` is *unknown*, never "no":
   * uid mapping depends on it, and guessing would write files the host user
   * cannot own, or run the command as host root.
   */
  rootless?: boolean;
  /** The image reference the probe inspected, exactly as configured. */
  image: string;
  /** `sha256:<hex>` the engine reported for that image locally; absent when it is not present. */
  imageDigest?: string;
  /** A trivial command run inside the sandbox argv, proving the shape actually starts. */
  canary: SandboxCanary;
  /** ISO timestamp of the reading. */
  probedAt: string;
}

/** The settings a later slice declares (`mode`, `engine`, `image`, `cpus`, `memoryGb`). */
export interface SandboxConfiguration {
  mode: SandboxMode;
  engine: SandboxEngineSetting;
  /** A digest-pinned reference. `''` means no image is configured, which is `unavailable`. */
  image: string;
  cpus: number;
  memoryGb: number;
}

/** Facts about the machine the editor runs on. */
export interface SandboxHostFacts {
  os: string;
  /** The editor's own uid/gid. Required on a Linux host. */
  user?: { uid: number; gid: number };
  homeDir: string;
  /** Further paths the mount must never contain — the `SSH_AUTH_SOCK` socket, for one. */
  sensitivePaths?: readonly string[];
}

/** One command, as `runCommand` was asked for it — the requested executable, never the host-resolved shim. */
export interface SandboxInvocation {
  /** Lowercase alphanumerics, 8–32. Names the container so a later sweep can find it. */
  runId: string;
  executable: string;
  args: readonly string[];
  /** The worktree or component root: the one folder mounted. */
  root: string;
  /** Where the command runs. Must be inside `root`. */
  cwd: string;
  /** Candidate environment. Only `SANDBOX_ENV_ALLOWLIST` names with valid values cross. */
  env: Readonly<Record<string, string | undefined>>;
}

// ── Constants ────────────────────────────────────────────────────

export const SANDBOX_MOUNT_TARGET = '/work';
export const SANDBOX_NAME_PREFIX = 'atlasmind-sbx-';
/** The label an orphan sweep filters on. */
export const SANDBOX_LABEL = 'atlasmind.sandbox=1';
export const SANDBOX_PIDS_LIMIT = 512;
/** Writable scratch on a read-only root. `nosuid,nodev`; size-bounded so a runaway write fails rather than fills the VM. */
export const SANDBOX_TMPFS = '/tmp:rw,nosuid,nodev,size=512m';
/** How long one probe reading can be relied on. */
export const SANDBOX_PROBE_MAX_AGE_MS = 10 * 60 * 1000;
export const SANDBOX_CPU_RANGE = { min: 0.25, max: 64 } as const;
export const SANDBOX_MEMORY_GB_RANGE = { min: 0.5, max: 256 } as const;

/**
 * Set by AtlasMind, never passed through: the root is read-only, so a tool that
 * writes under `$HOME` (an npm cache, a config file) needs somewhere writable,
 * and the host's `HOME` would name a path that does not exist in the container.
 */
export const SANDBOX_FIXED_ENV: ReadonlyArray<readonly [string, string]> = [
  ['HOME', '/tmp'],
  ['TMPDIR', '/tmp'],
];

/**
 * The only environment that may cross, each with the shape its value must have.
 * A name absent here never crosses — which is how provider keys, tokens and
 * `SSH_AUTH_SOCK` are kept out without anybody having to list them. A listed
 * name with a value that fails its validator is **dropped and reported**, not
 * cleaned: a `NODE_OPTIONS` carrying `--require` is not a heap cap with extra
 * text, it is a different instruction.
 */
export const SANDBOX_ENV_ALLOWLIST: Readonly<Record<string, RegExp>> = {
  CI: /^(?:true|false|1|0)$/i,
  NODE_ENV: /^(?:test|development|production)$/,
  NODE_OPTIONS: /^--max-old-space-size=\d{2,6}$/,
  VITEST_MAX_WORKERS: /^\d{1,3}$/,
  JEST_MAX_WORKERS: /^\d{1,3}$/,
  FORCE_COLOR: /^[0-3]$/,
  NO_COLOR: /^[A-Za-z0-9]{0,8}$/,
  TZ: /^[A-Za-z0-9_+/-]{1,64}$/,
  LANG: /^[A-Za-z0-9_.@-]{1,64}$/,
  LC_ALL: /^[A-Za-z0-9_.@-]{1,64}$/,
};

/** Engine sockets a mount must never contain. A folder that is an ancestor of one would hand the container the engine. */
export const SANDBOX_ENGINE_SOCKETS: readonly string[] = [
  '/var/run/docker.sock',
  '/run/docker.sock',
  '/var/run/podman/podman.sock',
  '/run/podman/podman.sock',
];

/** Folders under `$HOME` that hold credentials. A root inside one is refused. */
export const SANDBOX_CREDENTIAL_DIRS: readonly string[] = [
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config/gcloud', '.config/gh',
];

// ── Rules ────────────────────────────────────────────────────────

export type SandboxAttestationRuleId =
  | 'probed'
  | 'cli-present'
  | 'engine-answers'
  | 'engine-matches-setting'
  | 'linux-engine'
  | 'user-namespace-known'
  | 'image-pinned'
  | 'image-present'
  | 'canary-passed'
  | 'probe-fresh';

export interface SandboxRule<Id extends string> {
  id: Id;
  description: string;
}

/** All required for `confirmed`, evaluated in order; the first that fails is the one reported. */
export const SANDBOX_ATTESTATION_RULES: ReadonlyArray<SandboxRule<SandboxAttestationRuleId>> = [
  { id: 'probed', description: 'The engine has been probed. No reading is not a clean reading.' },
  { id: 'cli-present', description: 'The engine\'s command-line tool is installed and answers.' },
  { id: 'engine-answers', description: 'The engine itself answers `info` — a CLI with no daemon behind it runs nothing.' },
  { id: 'engine-matches-setting', description: 'The probed engine is the one the settings name, unless they say auto.' },
  { id: 'linux-engine', description: 'The engine runs Linux containers. Windows-container mode is unavailable, not a weaker sandbox.' },
  {
    id: 'user-namespace-known',
    description: 'How the engine maps users is known and safe: rootful Docker (so --user is the host user), rootless Podman (so keep-id is). '
      + 'Unknown is refused, because a wrong guess either writes files you cannot own or runs as host root.',
  },
  { id: 'image-pinned', description: 'The configured image is name@sha256:<64 hex>. A tag is a pointer somebody else can move, so it is refused, not resolved.' },
  { id: 'image-present', description: 'The probe found that exact digest locally. The sandbox never pulls; an absent image is not fetched on the night.' },
  { id: 'canary-passed', description: 'A trivial command ran inside the sandbox argv, so the shape is known to start on this engine.' },
  { id: 'probe-fresh', description: 'The reading is under ten minutes old and not dated in the future.' },
];

export type SandboxEligibilityRuleId =
  | 'git'
  | 'github-cli'
  | 'container-engine'
  | 'network-client'
  | 'leaves-the-machine'
  | 'changes-history'
  | 'installs-packages';

/** Commands that are never sandboxed, evaluated in order. Under `require` they are refused, never run on the host. */
export const SANDBOX_ELIGIBILITY_RULES: ReadonlyArray<SandboxRule<SandboxEligibilityRuleId>> = [
  {
    id: 'git',
    description: 'git is host-bound: a worktree\'s metadata lives outside the mounted folder, and history belongs to AtlasMind\'s git tools on the host.',
  },
  { id: 'github-cli', description: 'gh needs your credentials and the network, neither of which a sandbox has.' },
  { id: 'container-engine', description: 'A container engine inside the sandbox would need the engine socket, which is never mounted.' },
  { id: 'network-client', description: 'curl, ssh, rsync and the like exist to reach the network, and the sandbox has none.' },
  { id: 'leaves-the-machine', description: 'Pushes, publishes or deploys — the delivery reach table\'s outward commands. They need the network and are never sandboxed.' },
  { id: 'changes-history', description: 'Changes git history or acts on a pull request — host work by definition.' },
  {
    id: 'installs-packages',
    description: 'Installs or updates packages. What an install runs is decided by the registry, and the sandbox has no network; '
      + 'a separately approved dependency step is a later slice.',
  },
];

export type SandboxArgvRuleId =
  | 'engine'
  | 'image-pinned'
  | 'run-id'
  | 'host-os'
  | 'host-user'
  | 'limits'
  | 'mount-root'
  | 'mount-sensitive'
  | 'working-directory'
  | 'executable';

/** What a sandbox argv must satisfy before it is built. A failure refuses; nothing is cleaned into shape. */
export const SANDBOX_ARGV_RULES: ReadonlyArray<SandboxRule<SandboxArgvRuleId>> = [
  { id: 'engine', description: 'The engine is Docker or Podman.' },
  { id: 'image-pinned', description: 'The image is digest-pinned (name@sha256:<64 hex>), with no tag beside the digest.' },
  { id: 'run-id', description: 'The run id is 8–32 lowercase letters and digits, so the container name is one an orphan sweep can match.' },
  { id: 'host-os', description: 'The host is Linux, macOS or Windows — the three a Linux engine is reachable from.' },
  {
    id: 'host-user',
    description: 'On a Linux host the editor\'s uid:gid is known and is not root, and the engine maps it as itself — rootful Docker, '
      + 'or rootless Podman with keep-id — so the command runs as you and never as host root.',
  },
  { id: 'limits', description: 'CPU and memory are finite and in range. A limit that cannot be stated is not a limit.' },
  {
    id: 'mount-root',
    description: 'The mounted folder is absolute, already in normal form, not a filesystem root, and free of the characters the --mount syntax splits on.',
  },
  {
    id: 'mount-sensitive',
    description: 'The mounted folder is not, and does not contain, the home directory, a credential folder, an engine socket or the ssh agent.',
  },
  { id: 'working-directory', description: 'The command runs inside the mounted folder.' },
  {
    id: 'executable',
    description: 'The executable is a bare name or a ./relative path — the requested command, never a host path the container does not have.',
  },
];

export type SandboxPlanRuleId =
  | 'sandbox-off'
  | 'require-never-host'
  | 'attestation-expired'
  | 'attestation-for-other-configuration'
  | 'sandboxed';

export const SANDBOX_PLAN_RULES: ReadonlyArray<SandboxRule<SandboxPlanRuleId>> = [
  { id: 'sandbox-off', description: 'The sandbox is off, so the command runs on the host exactly as it does today.' },
  {
    id: 'require-never-host',
    description: 'Under require, a command the sandbox cannot run is refused. It is never run on the host instead — there is no prefer mode for a fallback to hide in.',
  },
  { id: 'attestation-expired', description: 'The attestation outlived the ten-minute reading it rests on, so the engine is probed again before anything runs.' },
  {
    id: 'attestation-for-other-configuration',
    description: 'The attestation vouches for a different image or engine than the settings now name.',
  },
  { id: 'sandboxed', description: 'Eligible, attested, and the argv passed every rule: the command runs in the sandbox.' },
];

export type SandboxInteractionRuleId =
  | 'dry-run-wins'
  | 'taint-not-relaxed'
  | 'unattended-unchanged'
  | 'approvals-unchanged';

/**
 * How the sandbox meets features that already decide whether a command runs.
 * Stated as rules rather than wiring, because in each case the answer is that
 * the sandbox changes nothing — and that has to be written down before a later
 * slice is tempted to let "it's in a container" stand in for one of them.
 */
export const SANDBOX_INTERACTION_RULES: ReadonlyArray<SandboxRule<SandboxInteractionRuleId>> = [
  {
    id: 'dry-run-wins',
    description: 'A sandboxed run is still an effect: it executes the command and can change every file in the mounted folder. '
      + 'Dry run is decided first, and `classifyHostCommand` grades the engine launch as an effect, so a dry run records it and runs nothing.',
  },
  {
    id: 'taint-not-relaxed',
    description: 'A container limits what a command can reach, not whether the model was steered into asking for it. '
      + 'A terminal write after untrusted content still needs the fresh approval `contextProvenance` requires; a sandbox is not a release valve.',
  },
  {
    id: 'unattended-unchanged',
    description: 'Scheduled routines keep refusing what `scheduledRoutinePolicy` refuses. A later dependency volume could let tests run unattended '
      + 'without an install, but nothing here changes that policy, and installs stay refused by the same vocabulary.',
  },
  {
    id: 'approvals-unchanged',
    description: 'Tool approvals are not relaxed by the sandbox in this slice. Any relaxation is a later, separate opt-in that also requires a confirmed attestation.',
  },
];

// ── Mode ─────────────────────────────────────────────────────────

/**
 * Read a mode setting. Absent or `off` is off; anything else — `require`, a
 * typo, a `prefer` somebody hoped existed — is `require`, because a person who
 * wrote a value other than `off` wanted a sandbox, and the safe reading of an
 * unrecognised wish for one is the one that refuses rather than the one that
 * quietly does nothing.
 */
export function readSandboxMode(value: unknown): SandboxMode {
  return value === undefined || value === null || value === 'off' ? 'off' : 'require';
}

// ── Image ────────────────────────────────────────────────────────

const IMAGE_COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const IMAGE_REGISTRY = '[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?';
const PINNED_IMAGE = new RegExp(
  `^(?:(${IMAGE_REGISTRY})/)?(${IMAGE_COMPONENT}(?:/${IMAGE_COMPONENT})*)@(sha256:[a-f0-9]{64})$`,
);

export type SandboxImageReference =
  | { ok: true; reference: string; name: string; digest: string }
  | { ok: false; reason: string };

/**
 * Validate a configured image. Refused, never coerced: no lowercasing, no
 * trimming, no resolving a tag to the digest it points at today.
 */
export function parseSandboxImageReference(value: unknown): SandboxImageReference {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'No sandbox image is configured.' };
  }
  if (value.length > 512) {
    return { ok: false, reason: 'The image reference is longer than any real one.' };
  }
  const match = PINNED_IMAGE.exec(value);
  if (match) {
    const registry = match[1];
    const name = registry ? `${registry}/${match[2]}` : match[2]!;
    return { ok: true, reference: value, name, digest: match[3]! };
  }
  if (/@sha256:/i.test(value)) {
    if (/:[^/@]+@sha256:/.test(value.replace(/^[^/]+:[0-9]{1,5}\//, ''))) {
      return {
        ok: false,
        reason: `"${value}" carries a tag beside its digest. The engine ignores the tag, so it reads as something that is not what runs — pin by digest alone.`,
      };
    }
    return { ok: false, reason: `"${value}" has a digest that is not sha256 followed by 64 lowercase hex characters, or a name the engine would not accept.` };
  }
  return {
    ok: false,
    reason: `"${value}" is not pinned by digest. A tag is a pointer somebody else can move, so it is refused rather than resolved — use name@sha256:<digest>.`,
  };
}

// ── Attestation ──────────────────────────────────────────────────

export type SandboxAttestation =
  | {
    status: 'confirmed';
    /** Stable for one reading of one image; an approval record can cite it. */
    id: string;
    engine: SandboxEngine;
    strength: SandboxStrength;
    image: string;
    digest: string;
    rootless: boolean;
    probedAt: string;
    expiresAt: string;
    rules: readonly SandboxAttestationRuleId[];
  }
  | { status: 'unavailable'; rule: SandboxAttestationRuleId; reason: string };

function unavailable(rule: SandboxAttestationRuleId, reason: string): SandboxAttestation {
  return { status: 'unavailable', rule, reason };
}

/**
 * Whether one probe reading vouches for running in the sandbox now. Every rule
 * in `SANDBOX_ATTESTATION_RULES` must pass; the first that does not is the one
 * reported, so the person reading it fixes the root cause first.
 */
export function assessSandboxAttestation(
  probe: SandboxProbe | undefined,
  configuration: Pick<SandboxConfiguration, 'engine' | 'image'>,
  now: Date,
): SandboxAttestation {
  if (!probe || typeof probe !== 'object') {
    return unavailable('probed', 'The container engine has not been probed, so nothing vouches for a sandbox.');
  }
  if (probe.engine !== 'docker' && probe.engine !== 'podman') {
    return unavailable('probed', 'The probe names an engine AtlasMind does not drive.');
  }
  if (probe.cliPresent !== true) {
    return unavailable('cli-present', `The ${probe.engine} command-line tool is not installed or did not answer.`);
  }
  if (probe.infoOk !== true) {
    return unavailable('engine-answers', `${probe.engine} is installed but its engine did not answer — it may not be running.`);
  }
  if (configuration.engine !== 'auto' && configuration.engine !== probe.engine) {
    return unavailable('engine-matches-setting', `The settings name ${configuration.engine}, but the probe read ${probe.engine}.`);
  }
  const serverOs = typeof probe.serverOs === 'string' ? probe.serverOs : '';
  if (serverOs !== 'linux') {
    return unavailable(
      'linux-engine',
      serverOs
        ? `The engine runs ${serverOs} containers. Only a Linux engine runs this sandbox; switch to Linux containers.`
        : 'The engine did not say which operating system its containers run, so it is not assumed to be Linux.',
    );
  }
  if (typeof probe.rootless !== 'boolean') {
    return unavailable('user-namespace-known', 'Whether the engine runs rootless is unknown, so how it maps users is unknown.');
  }
  if (probe.engine === 'docker' && probe.rootless) {
    return unavailable(
      'user-namespace-known',
      'Rootless Docker maps users through a subordinate range, so the command would write files your account cannot own. Not supported yet.',
    );
  }
  if (probe.engine === 'podman' && !probe.rootless) {
    return unavailable('user-namespace-known', 'Rootful Podman runs containers as host root. Only rootless Podman is used.');
  }
  const image = parseSandboxImageReference(configuration.image);
  if (!image.ok) {
    return unavailable('image-pinned', image.reason);
  }
  if (probe.image !== configuration.image || probe.imageDigest !== image.digest) {
    return unavailable(
      'image-present',
      probe.image !== configuration.image
        ? 'The probe inspected a different image than the one configured. Probe again.'
        : `The pinned image ${image.reference} is not present locally. The sandbox never pulls; pull it yourself, then probe again.`,
    );
  }
  if (probe.canary !== 'passed') {
    return unavailable(
      'canary-passed',
      probe.canary === 'failed'
        ? 'The canary command failed inside the sandbox, so this engine does not start the sandbox shape.'
        : 'The canary command has not been run, so nothing shows the sandbox shape starts on this engine.',
    );
  }
  const probedAtMs = typeof probe.probedAt === 'string' ? Date.parse(probe.probedAt) : Number.NaN;
  if (!Number.isFinite(probedAtMs)) {
    return unavailable('probe-fresh', 'The probe reading carries no readable time, so its age is unknown.');
  }
  const age = now.getTime() - probedAtMs;
  if (age < 0) {
    return unavailable('probe-fresh', 'The probe reading is dated in the future, so its age cannot be trusted.');
  }
  if (age >= SANDBOX_PROBE_MAX_AGE_MS) {
    return unavailable('probe-fresh', `The probe reading is ${Math.floor(age / 60000)} minutes old. Probe again.`);
  }
  const probedAt = new Date(probedAtMs).toISOString();
  return {
    status: 'confirmed',
    id: `sbx-att-${image.digest.slice('sha256:'.length, 'sha256:'.length + 12)}-${probedAtMs.toString(36)}`,
    engine: probe.engine,
    strength: 'container',
    image: image.reference,
    digest: image.digest,
    rootless: probe.rootless,
    probedAt,
    expiresAt: new Date(probedAtMs + SANDBOX_PROBE_MAX_AGE_MS).toISOString(),
    rules: SANDBOX_ATTESTATION_RULES.map(rule => rule.id),
  };
}

// ── Eligibility ──────────────────────────────────────────────────

export type SandboxEligibility =
  | { eligible: true }
  | { eligible: false; rule: SandboxEligibilityRuleId; reason: string };

const ENGINE_EXECUTABLES: ReadonlySet<string> = new Set([
  'docker', 'podman', 'nerdctl', 'buildah', 'docker-compose', 'kubectl', 'helm', 'minikube', 'kind',
]);
const NETWORK_EXECUTABLES: ReadonlySet<string> = new Set([
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'nc', 'ncat', 'netcat', 'telnet',
]);

const UNATTENDED_TO_ELIGIBILITY: Readonly<Record<UnattendedStepRuleId, SandboxEligibilityRuleId>> = {
  'leaves-the-machine': 'leaves-the-machine',
  'changes-history': 'changes-history',
  'installs-packages': 'installs-packages',
};

function executableBaseName(executable: string): string {
  const base = String(executable ?? '').trim().split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/, '');
}

function ineligible(rule: SandboxEligibilityRuleId): SandboxEligibility {
  const row = SANDBOX_ELIGIBILITY_RULES.find(entry => entry.id === rule)!;
  return { eligible: false, rule, reason: row.description };
}

/**
 * Whether a command may be run in the sandbox at all. Executable names first,
 * then the shared unattended-step vocabulary over the whole command line, so
 * `bash -c "npm publish"` is caught the same way a routine step would be.
 */
export function assessSandboxEligibility(executable: string, args: readonly string[]): SandboxEligibility {
  const name = executableBaseName(executable);
  if (name === 'git') {
    return ineligible('git');
  }
  if (name === 'gh') {
    return ineligible('github-cli');
  }
  if (ENGINE_EXECUTABLES.has(name)) {
    return ineligible('container-engine');
  }
  if (NETWORK_EXECUTABLES.has(name)) {
    return ineligible('network-client');
  }
  const text = [String(executable ?? ''), ...(args ?? []).map(arg => String(arg ?? ''))].join(' ');
  const unattended = classifyUnattendedStep(text);
  if (unattended) {
    return ineligible(UNATTENDED_TO_ELIGIBILITY[unattended.id]);
  }
  return { eligible: true };
}

// ── Argv ─────────────────────────────────────────────────────────

export interface SandboxRunSpec {
  engine: SandboxEngine;
  image: string;
  runId: string;
  host: SandboxHostFacts;
  /** Whether the engine is rootless — decides how the user is mapped. */
  rootless: boolean;
  cpus: number;
  memoryGb: number;
  executable: string;
  args: readonly string[];
  root: string;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}

export type SandboxArgvResult =
  | {
    ok: true;
    /** The engine executable to start; never a shell. */
    command: SandboxEngine;
    /** Everything after it, starting with `run`. */
    argv: string[];
    /** Allowlisted names whose value failed its validator, so it did not cross. Names only, never values. */
    rejectedEnv: string[];
  }
  | { ok: false; rule: SandboxArgvRuleId; reason: string };

function refuseArgv(rule: SandboxArgvRuleId, reason: string): SandboxArgvResult {
  return { ok: false, rule, reason };
}

function isHostOs(value: string): value is SandboxHostOs {
  return value === 'linux' || value === 'darwin' || value === 'win32';
}

/** `path.posix` and `path.win32` share one shape; which applies is the host's, not this process's. */
type PathApi = typeof path.posix;

function pathApiFor(os: SandboxHostOs): PathApi {
  return os === 'win32' ? path.win32 : path.posix;
}

/** `child` is `parent` or somewhere beneath it. */
function isWithinOrEqual(api: PathApi, child: string, parent: string): boolean {
  const relative = api.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative));
}

const MOUNT_FORBIDDEN_CHARS = /[,"\r\n\0]/;

function checkRoot(api: PathApi, os: SandboxHostOs, root: string): string | undefined {
  if (typeof root !== 'string' || !root) {
    return 'No folder was given to mount.';
  }
  if (MOUNT_FORBIDDEN_CHARS.test(root)) {
    return 'The folder\'s path contains a comma, quote or line break, which the --mount syntax would split into further options.';
  }
  const absolute = os === 'win32' ? /^[A-Za-z]:\\/.test(root) : root.startsWith('/');
  if (!absolute) {
    return os === 'win32'
      ? 'The folder must be an absolute drive path (C:\\…). UNC and relative paths are not mounted.'
      : 'The folder must be an absolute path.';
  }
  if (api.parse(root).root === root) {
    return 'A filesystem root is never mounted.';
  }
  if (api.normalize(root) !== root || /[\\/]$/.test(root)) {
    return 'The folder path is not in normal form. It is refused rather than normalised, so what is mounted is exactly what was checked.';
  }
  return undefined;
}

function checkSensitive(api: PathApi, os: SandboxHostOs, root: string, host: SandboxHostFacts): string | undefined {
  const home = typeof host.homeDir === 'string' ? host.homeDir : '';
  if (!home || !api.isAbsolute(home)) {
    return 'The home directory is unknown, so the mount cannot be shown not to contain it.';
  }
  if (isWithinOrEqual(api, home, root)) {
    return 'The folder is, or contains, your home directory.';
  }
  for (const dir of SANDBOX_CREDENTIAL_DIRS) {
    if (isWithinOrEqual(api, root, api.join(home, ...dir.split('/')))) {
      return `The folder is inside ~/${dir}, which holds credentials.`;
    }
  }
  const sockets = os === 'win32' ? [] : SANDBOX_ENGINE_SOCKETS;
  for (const socket of [...sockets, ...(host.sensitivePaths ?? [])]) {
    if (typeof socket === 'string' && socket && api.isAbsolute(socket) && isWithinOrEqual(api, socket, root)) {
      return `The folder contains ${socket}, which is never mounted.`;
    }
  }
  return undefined;
}

const BARE_EXECUTABLE = /^[A-Za-z0-9_+][A-Za-z0-9._+-]*$/;
const PATH_SEGMENT = /^[A-Za-z0-9._+-]+$/;

/** A bare name, or `./a/b` whose segments are plain names — `.bin` yes, `..` never. */
function isContainerExecutable(value: string): boolean {
  if (BARE_EXECUTABLE.test(value)) {
    return true;
  }
  if (!value.startsWith('./') || value.length > 256) {
    return false;
  }
  const segments = value.slice(2).split('/');
  return segments.every(segment => PATH_SEGMENT.test(segment) && segment !== '.' && segment !== '..');
}

function formatCpus(cpus: number): string | undefined {
  if (typeof cpus !== 'number' || !Number.isFinite(cpus)
    || cpus < SANDBOX_CPU_RANGE.min || cpus > SANDBOX_CPU_RANGE.max
    || Number(cpus.toFixed(2)) !== cpus) {
    return undefined;
  }
  return String(cpus);
}

function memoryMb(memoryGb: number): number | undefined {
  if (typeof memoryGb !== 'number' || !Number.isFinite(memoryGb)
    || memoryGb < SANDBOX_MEMORY_GB_RANGE.min || memoryGb > SANDBOX_MEMORY_GB_RANGE.max) {
    return undefined;
  }
  return Math.round(memoryGb * 1024);
}

function validId(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x7fffffff;
}

/**
 * Filter the candidate environment through the allowlist. Returned sorted, so
 * the same inputs always produce the same argv.
 */
export function selectSandboxEnv(
  env: Readonly<Record<string, string | undefined>>,
): { pairs: Array<[string, string]>; rejected: string[] } {
  const pairs: Array<[string, string]> = [];
  const rejected: string[] = [];
  for (const name of Object.keys(SANDBOX_ENV_ALLOWLIST).sort()) {
    if (!Object.prototype.hasOwnProperty.call(env ?? {}, name)) {
      continue;
    }
    const value = env[name];
    if (value === undefined) {
      continue;
    }
    if (typeof value === 'string' && SANDBOX_ENV_ALLOWLIST[name]!.test(value)) {
      pairs.push([name, value]);
    } else {
      rejected.push(name);
    }
  }
  return { pairs, rejected };
}

/**
 * The constant-shaped engine argv for one command. Every rule in
 * `SANDBOX_ARGV_RULES` is checked first and a failure refuses; nothing here
 * normalises an input into shape. The order of the flags is fixed, so a golden
 * test can pin it.
 */
export function buildSandboxArgv(spec: SandboxRunSpec): SandboxArgvResult {
  const engine = spec.engine;
  if (engine !== 'docker' && engine !== 'podman') {
    return refuseArgv('engine', 'No supported engine was named.');
  }
  const image = parseSandboxImageReference(spec.image);
  if (!image.ok) {
    return refuseArgv('image-pinned', image.reason);
  }
  if (typeof spec.runId !== 'string' || !/^[a-z0-9]{8,32}$/.test(spec.runId)) {
    return refuseArgv('run-id', 'The run id must be 8–32 lowercase letters and digits.');
  }
  const hostOs = spec.host?.os;
  if (typeof hostOs !== 'string' || !isHostOs(hostOs)) {
    return refuseArgv('host-os', `A Linux engine is not reachable from ${String(hostOs || 'this host')} in a way AtlasMind supports.`);
  }
  const user = spec.host.user;
  if (hostOs === 'linux') {
    if (!user || !validId(user.uid) || !validId(user.gid)) {
      return refuseArgv('host-user', 'On a Linux host the editor\'s uid and gid must be known, or files written in the sandbox could not be yours.');
    }
    if (user.uid === 0) {
      return refuseArgv('host-user', 'The editor is running as root. A sandboxed command never runs as host root.');
    }
    if (spec.rootless !== (engine === 'podman')) {
      return refuseArgv(
        'host-user',
        engine === 'docker'
          ? 'Rootless Docker maps users through a subordinate range, so --user would write files your account cannot own.'
          : 'Rootful Podman runs containers as host root; only rootless Podman with keep-id is used.',
      );
    }
  }
  const cpus = formatCpus(spec.cpus);
  const memory = memoryMb(spec.memoryGb);
  if (cpus === undefined || memory === undefined) {
    return refuseArgv(
      'limits',
      `CPU must be ${SANDBOX_CPU_RANGE.min}–${SANDBOX_CPU_RANGE.max} (two decimals at most) and memory ${SANDBOX_MEMORY_GB_RANGE.min}–${SANDBOX_MEMORY_GB_RANGE.max} GB.`,
    );
  }
  const api = pathApiFor(hostOs);
  const rootProblem = checkRoot(api, hostOs, spec.root);
  if (rootProblem) {
    return refuseArgv('mount-root', rootProblem);
  }
  const sensitive = checkSensitive(api, hostOs, spec.root, spec.host);
  if (sensitive) {
    return refuseArgv('mount-sensitive', sensitive);
  }
  if (typeof spec.cwd !== 'string' || !spec.cwd || !api.isAbsolute(spec.cwd) || !isWithinOrEqual(api, spec.cwd, spec.root)) {
    return refuseArgv('working-directory', 'The command\'s working directory is not inside the mounted folder.');
  }
  const relative = api.relative(spec.root, spec.cwd);
  const segments = relative ? relative.split(api.sep) : [];
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\r\n\0]/.test(segment))) {
    return refuseArgv('working-directory', 'The working directory could not be expressed inside the mounted folder.');
  }
  const workdir = [SANDBOX_MOUNT_TARGET, ...segments].join('/');
  const executable = typeof spec.executable === 'string' ? spec.executable : '';
  if (!isContainerExecutable(executable)) {
    return refuseArgv(
      'executable',
      'The executable must be a bare command name or a ./relative path. A host path names a file the container does not have.',
    );
  }
  const { pairs, rejected } = selectSandboxEnv(spec.env ?? {});

  const argv: string[] = [
    'run', '--rm', '--init', '--pull', 'never',
    '--name', `${SANDBOX_NAME_PREFIX}${spec.runId}`,
    '--label', SANDBOX_LABEL,
    '--network', 'none',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', SANDBOX_TMPFS,
    '--pids-limit', String(SANDBOX_PIDS_LIMIT),
    '--cpus', cpus,
    '--memory', `${memory}m`,
    '--memory-swap', `${memory}m`,
  ];
  if (hostOs === 'linux' && user) {
    if (engine === 'podman') {
      // Rootless Podman (the only Podman attested) maps the host user to itself.
      argv.push('--userns', 'keep-id');
    }
    argv.push('--user', `${user.uid}:${user.gid}`);
  }
  argv.push(
    '--mount', `type=bind,source=${spec.root},target=${SANDBOX_MOUNT_TARGET}`,
    '--workdir', workdir,
  );
  for (const [name, value] of SANDBOX_FIXED_ENV) {
    argv.push('--env', `${name}=${value}`);
  }
  for (const [name, value] of pairs) {
    argv.push('--env', `${name}=${value}`);
  }
  // After the image the engine stops reading options: everything that follows
  // is the command and its arguments, passed through untouched and never to a
  // shell, inside the container as outside it.
  argv.push(image.reference, executable, ...(spec.args ?? []).map(arg => String(arg)));
  return { ok: true, command: engine, argv, rejectedEnv: rejected };
}

// ── Plan ─────────────────────────────────────────────────────────

export type SandboxExecutionPlan =
  | { route: 'host'; rule: 'sandbox-off'; reason: string }
  | {
    route: 'sandbox';
    rule: 'sandboxed';
    command: SandboxEngine;
    argv: string[];
    attestationId: string;
    rejectedEnv: string[];
  }
  | {
    route: 'refuse';
    /** Which table the refusing rule comes from. */
    stage: 'eligibility' | 'attestation' | 'plan' | 'argv';
    rule: SandboxEligibilityRuleId | SandboxAttestationRuleId | SandboxPlanRuleId | SandboxArgvRuleId;
    reason: string;
  };

function planRule(id: SandboxPlanRuleId): string {
  return SANDBOX_PLAN_RULES.find(rule => rule.id === id)!.description;
}

/**
 * Where one command runs. `off` → the host, unchanged. Anything else is read as
 * `require`, and then the answer is the sandbox or a refusal naming the rule —
 * never the host. Nothing is started: the caller gets an argv to hand to the
 * engine, or a reason to show.
 */
export function planExecution(
  invocation: SandboxInvocation,
  attestation: SandboxAttestation | undefined,
  configuration: SandboxConfiguration,
  host: SandboxHostFacts,
  now: Date,
): SandboxExecutionPlan {
  if (readSandboxMode(configuration?.mode) === 'off') {
    return { route: 'host', rule: 'sandbox-off', reason: planRule('sandbox-off') };
  }
  const eligibility = assessSandboxEligibility(invocation?.executable ?? '', invocation?.args ?? []);
  if (!eligibility.eligible) {
    return {
      route: 'refuse',
      stage: 'eligibility',
      rule: eligibility.rule,
      reason: `${eligibility.reason} ${planRule('require-never-host')}`,
    };
  }
  if (!attestation || attestation.status !== 'confirmed') {
    return {
      route: 'refuse',
      stage: 'attestation',
      rule: attestation?.status === 'unavailable' ? attestation.rule : 'probed',
      reason: attestation?.status === 'unavailable'
        ? `The sandbox is unavailable: ${attestation.reason} ${planRule('require-never-host')}`
        : `The container engine has not been probed. ${planRule('require-never-host')}`,
    };
  }
  const nowMs = now.getTime();
  const expiresMs = Date.parse(attestation.expiresAt);
  const probedMs = Date.parse(attestation.probedAt);
  if (!Number.isFinite(expiresMs) || !Number.isFinite(probedMs) || nowMs >= expiresMs || nowMs < probedMs) {
    return { route: 'refuse', stage: 'plan', rule: 'attestation-expired', reason: planRule('attestation-expired') };
  }
  if (attestation.image !== configuration.image
    || (configuration.engine !== 'auto' && configuration.engine !== attestation.engine)) {
    return {
      route: 'refuse',
      stage: 'plan',
      rule: 'attestation-for-other-configuration',
      reason: planRule('attestation-for-other-configuration'),
    };
  }
  const built = buildSandboxArgv({
    engine: attestation.engine,
    image: configuration.image,
    runId: invocation.runId,
    host,
    rootless: attestation.rootless,
    cpus: configuration.cpus,
    memoryGb: configuration.memoryGb,
    executable: invocation.executable,
    args: invocation.args,
    root: invocation.root,
    cwd: invocation.cwd,
    env: invocation.env,
  });
  if (!built.ok) {
    return { route: 'refuse', stage: 'argv', rule: built.rule, reason: `${built.reason} ${planRule('require-never-host')}` };
  }
  return {
    route: 'sandbox',
    rule: 'sandboxed',
    command: built.command,
    argv: built.argv,
    attestationId: attestation.id,
    rejectedEnv: built.rejectedEnv,
  };
}
