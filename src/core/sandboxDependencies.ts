/**
 * Sandboxed execution — installed dependencies. A dependency volume, prepared
 * once per lockfile in a separate, approved, network-on step, so a command run
 * in the sandbox can load the project's packages when the host's own
 * `node_modules` cannot serve: it was built for Windows or macOS, or the
 * folder is a fresh worktree that has none.
 *
 * `sandboxPlan` decides that a command which loads installed packages runs only
 * with a ready volume for the mounted folder; this module decides what *ready*
 * means, names the volume, and plans and runs the preparation. Seven rules.
 *
 * 1. **The volume is named by what it holds.** Its key is a SHA-256 over the
 *    lockfile's bytes, the image digest, the package manager, the engine, the
 *    container platform, the user it was prepared as and whether install
 *    scripts ran. A changed lockfile is a different key, so a stale volume is
 *    never used: the command is refused with "dependencies not prepared" until
 *    somebody prepares the new one. The name is a constant prefix plus sixteen
 *    hex characters of the key — validated wherever it is read, never cleaned.
 * 2. **Ready is a record and a volume that agree.** A preparation that
 *    finished is recorded (per machine, in the editor's global state); the
 *    engine must still hold a volume of that name labelled with that key. A
 *    volume nobody recorded — a crash mid-install — is not ready, and a record
 *    whose volume is gone is not ready either.
 * 3. **Preparing is the only network-on step, and it is shown first.** One
 *    container runs the manager's constant install argv with the engine's
 *    default network, every capability dropped, no privilege escalation and the
 *    same limits as a command. It sees only `package.json` and the lockfile,
 *    mounted read-only — not the source, not `.npmrc`, not the environment —
 *    and writes only into the volume. `planSandboxDependencyPreparation`
 *    returns every argv and a disclosure; the command shows them before
 *    anything starts. On a Linux host a container with no network and only
 *    `CHOWN` first makes the empty volume the editor's user's, because a fresh
 *    volume is root's and the command runs as you.
 * 4. **Install scripts are off unless separately confirmed.** `--ignore-scripts`
 *    by default: a package that builds native code in a postinstall step may
 *    not work, and that is stated. The variant that runs them is a second,
 *    separately confirmed choice, keyed apart, because scripts are arbitrary
 *    code from every package in the lockfile running with network access.
 * 5. **Only declared managers, only one at a time.** npm, pnpm and Yarn 1,
 *    each with a constant argv. Bun, Yarn 2+ (Plug'n'Play has no
 *    node_modules), workspaces, several lockfiles and no lockfile are refused
 *    by a named rule rather than guessed at.
 * 6. **Never a symlink.** A manifest or lockfile that is not a regular file is
 *    refused: the engine follows a symlink when it mounts one, and a lockfile
 *    pointing at `~/.aws/credentials` would hand it to a network-on container.
 * 7. **Nothing here runs unattended.** Reading readiness is a read
 *    (`volume inspect`); preparing is an effect a dry run holds, and only a
 *    person's command starts it. A scheduled routine that finds no volume
 *    stops and says so.
 *
 * Pure apart from the injected engine runner and file reader and the dry-run
 * guard; clock injected.
 */

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { guardHostCommand, interceptDryRun } from './dryRunHost.js';
import { describeHostDryRunNotice, isDryRunBlockedError } from './dryRun.js';
import {
  SANDBOX_DEPENDENCY_TARGET,
  SANDBOX_DEPENDENCY_VOLUME_PREFIX,
  SANDBOX_MOUNT_TARGET,
  SANDBOX_PIDS_LIMIT,
  checkSandboxMountRoot,
  isSandboxDependencyVolumeName,
  parseSandboxImageReference,
  sandboxLimitArgs,
  sandboxUserArgs,
  type SandboxAttestation,
  type SandboxConfiguration,
  type SandboxDependencyState,
  type SandboxEngine,
  type SandboxHostFacts,
} from './sandboxPlan.js';
import type { SandboxProcessOutcome, SandboxProcessRunner } from './sandboxRunner.js';
import { redactSecrets } from '../utils/secretRedactor.js';

// ── Constants ────────────────────────────────────────────────────

/** The label every dependency volume carries, and the one the list and clean-up filter on. */
export const SANDBOX_DEPENDENCY_LABEL = 'atlasmind.deps=1';
const KEY_LABEL = 'atlasmind.deps.key';
/** Where preparations are recorded in the editor's global (per machine) state. */
export const SANDBOX_DEPENDENCY_RECORDS_KEY = 'atlasmind.sandbox.dependencyVolumes';
export const SANDBOX_DEPENDENCY_RECORDS_MAX = 32;
/** How long the install may take. A large lockfile on a slow link is minutes, not seconds. */
export const SANDBOX_DEPENDENCY_INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const STEP_TIMEOUT_MS = 60_000;
/** The largest manifest and lockfile read. A lockfile bigger than this is refused, not truncated. */
export const SANDBOX_DEPENDENCY_FILE_MAX_BYTES = 64 * 1024 * 1024;
const MANIFEST = 'package.json';

export type SandboxPackageManager = 'npm' | 'pnpm' | 'yarn';

export interface SandboxDependencyManager {
  id: SandboxPackageManager;
  /** In the order the manager itself prefers them. */
  lockfiles: readonly string[];
  /** The install, constant. The image must contain the manager. */
  install: readonly string[];
  ignoreScripts: string;
}

/**
 * The managers a volume can be prepared with, each a constant argv that
 * installs exactly the lockfile and refuses to change it. Nothing about the
 * command comes from the project: the files are only mounted.
 */
export const SANDBOX_DEPENDENCY_MANAGERS: readonly SandboxDependencyManager[] = [
  {
    id: 'npm',
    lockfiles: ['npm-shrinkwrap.json', 'package-lock.json'],
    install: ['npm', 'ci', '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=error'],
    ignoreScripts: '--ignore-scripts',
  },
  {
    id: 'pnpm',
    lockfiles: ['pnpm-lock.yaml'],
    install: ['pnpm', 'install', '--frozen-lockfile', '--reporter=append-only'],
    ignoreScripts: '--ignore-scripts',
  },
  {
    id: 'yarn',
    lockfiles: ['yarn.lock'],
    install: ['yarn', 'install', '--frozen-lockfile', '--non-interactive', '--no-progress'],
    ignoreScripts: '--ignore-scripts',
  },
];

/** Lockfiles that are recognised and refused, so their presence is never read as "no lockfile". */
const UNSUPPORTED_LOCKFILES: readonly string[] = ['bun.lockb', 'bun.lock'];

/** Every file detection reads at the mounted folder's root. Constant names, so nothing a project says chooses a path. */
export const SANDBOX_DEPENDENCY_PROBE_FILES: readonly string[] = [
  MANIFEST,
  ...SANDBOX_DEPENDENCY_MANAGERS.flatMap(manager => manager.lockfiles),
  ...UNSUPPORTED_LOCKFILES,
  '.yarnrc.yml',
  'pnpm-workspace.yaml',
];

// ── Rules ────────────────────────────────────────────────────────

export type SandboxDependencyRuleId =
  | 'node-project'
  | 'manifest-readable'
  | 'no-workspaces'
  | 'lockfile-present'
  | 'one-manager'
  | 'supported-manager'
  | 'lockfile-readable'
  | 'attested'
  | 'platform-known'
  | 'prepared'
  | 'volume-present'
  | 'volume-matches'
  | 'assessed';

/** Evaluated in order; the first that fails is the one reported. `node-project` failing means nothing is needed. */
export const SANDBOX_DEPENDENCY_RULES: ReadonlyArray<{ id: SandboxDependencyRuleId; description: string }> = [
  { id: 'node-project', description: 'The mounted folder has a package.json. Without one there are no JavaScript dependencies to prepare, and nothing is required.' },
  { id: 'manifest-readable', description: 'package.json is a regular file — never a symlink — under 64 MB, and parses as a JSON object.' },
  {
    id: 'no-workspaces',
    description: 'The project declares no workspaces (package.json `workspaces`, or pnpm-workspace.yaml). A workspace needs every member\'s '
      + 'manifest, and only the root two files are mounted; workspaces are not supported yet.',
  },
  { id: 'lockfile-present', description: 'A lockfile is committed beside package.json. Without one, what an install fetches is decided on the day, so no volume is keyed to it.' },
  { id: 'one-manager', description: 'Exactly one package manager\'s lockfile is present. Two would be two answers to what is installed, and neither is guessed at.' },
  {
    id: 'supported-manager',
    description: 'The manager is npm, pnpm or Yarn 1. Bun is not supported yet, and Yarn 2+ installs with Plug\'n\'Play by default, which has no node_modules to put in a volume.',
  },
  { id: 'lockfile-readable', description: 'The lockfile is a regular file — never a symlink — under 64 MB.' },
  { id: 'attested', description: 'A confirmed sandbox attestation names the image digest and engine the volume is keyed to.' },
  { id: 'platform-known', description: 'The engine reported its architecture, which the packages\' native binaries depend on.' },
  {
    id: 'prepared',
    description: 'A preparation for this exact key finished on this machine: same lockfile bytes, image digest, manager, engine, platform and user. '
      + 'A changed lockfile is a new key, so it needs preparing again.',
  },
  { id: 'volume-present', description: 'The engine still holds the recorded volume. A volume removed outside AtlasMind is not ready.' },
  { id: 'volume-matches', description: 'The volume carries the key it was prepared for. A volume of the same name with another key is not this one.' },
  { id: 'assessed', description: 'The dependency state could be read at all. A read that failed is not ready.' },
];

function ruleText(id: SandboxDependencyRuleId): string {
  return SANDBOX_DEPENDENCY_RULES.find(rule => rule.id === id)!.description;
}

// ── Detection ────────────────────────────────────────────────────

/** One file at the folder's root, as read: absent, refused, or its bytes. */
export type SandboxDependencyFile =
  | { present: false }
  | { present: true; bytes: Uint8Array }
  | { present: true; refused: 'not-a-regular-file' | 'too-large' | 'unreadable' };

export type SandboxDependencyDetection =
  | { status: 'not-a-node-project'; reason: string }
  | { status: 'refused'; rule: SandboxDependencyRuleId; reason: string }
  | {
    status: 'found';
    manager: SandboxPackageManager;
    lockfile: string;
    lockfileSha256: string;
    /** Exactly the files the preparation mounts, read-only. */
    mounts: readonly string[];
  };

function present(files: Readonly<Record<string, SandboxDependencyFile | undefined>>, name: string): boolean {
  return files[name]?.present === true;
}

function refusedFile(file: SandboxDependencyFile | undefined): string | undefined {
  if (!file?.present || !('refused' in file)) {
    return undefined;
  }
  return file.refused === 'not-a-regular-file'
    ? 'is a symbolic link or not a regular file'
    : file.refused === 'too-large' ? 'is larger than 64 MB' : 'could not be read';
}

/**
 * Which manager and lockfile a folder's dependencies come from, by declared
 * rule, from the files at its root. Refused rather than guessed whenever the
 * answer is not exactly one supported lockfile.
 */
export function detectSandboxDependencies(
  files: Readonly<Record<string, SandboxDependencyFile | undefined>>,
): SandboxDependencyDetection {
  const manifest = files[MANIFEST];
  if (!manifest?.present) {
    return { status: 'not-a-node-project', reason: 'There is no package.json at the mounted folder, so it has no JavaScript dependencies to prepare.' };
  }
  const manifestProblem = refusedFile(manifest);
  if (manifestProblem || !('bytes' in manifest)) {
    return { status: 'refused', rule: 'manifest-readable', reason: `package.json ${manifestProblem ?? 'could not be read'}. ${ruleText('manifest-readable')}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(manifest.bytes).toString('utf8'));
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'refused', rule: 'manifest-readable', reason: `package.json does not parse as a JSON object. ${ruleText('manifest-readable')}` };
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'workspaces') || present(files, 'pnpm-workspace.yaml')) {
    return { status: 'refused', rule: 'no-workspaces', reason: ruleText('no-workspaces') };
  }
  const managers = SANDBOX_DEPENDENCY_MANAGERS.filter(manager => manager.lockfiles.some(name => present(files, name)));
  const unsupported = UNSUPPORTED_LOCKFILES.filter(name => present(files, name));
  if (managers.length === 0 && unsupported.length === 0) {
    return { status: 'refused', rule: 'lockfile-present', reason: ruleText('lockfile-present') };
  }
  const found = [...managers.map(manager => manager.id), ...(unsupported.length > 0 ? ['bun'] : [])];
  if (found.length > 1) {
    return { status: 'refused', rule: 'one-manager', reason: `Lockfiles of ${found.join(' and ')} are both present. ${ruleText('one-manager')}` };
  }
  const manager = managers[0];
  if (!manager) {
    return { status: 'refused', rule: 'supported-manager', reason: `Bun's lockfile is present. ${ruleText('supported-manager')}` };
  }
  const lockfile = manager.lockfiles.find(name => present(files, name))!;
  const lock = files[lockfile];
  const lockProblem = refusedFile(lock);
  if (lockProblem || !lock || !lock.present || !('bytes' in lock)) {
    return { status: 'refused', rule: 'lockfile-readable', reason: `${lockfile} ${lockProblem ?? 'could not be read'}. ${ruleText('lockfile-readable')}` };
  }
  if (manager.id === 'yarn'
    && (present(files, '.yarnrc.yml') || Buffer.from(lock.bytes.subarray(0, 4096)).toString('utf8').includes('__metadata:'))) {
    return { status: 'refused', rule: 'supported-manager', reason: `yarn.lock is Yarn 2 or later. ${ruleText('supported-manager')}` };
  }
  return {
    status: 'found',
    manager: manager.id,
    lockfile,
    lockfileSha256: createHash('sha256').update(lock.bytes).digest('hex'),
    mounts: [MANIFEST, lockfile],
  };
}

// ── Key ──────────────────────────────────────────────────────────

export interface SandboxDependencyKeyInput {
  manager: SandboxPackageManager;
  lockfileSha256: string;
  imageDigest: string;
  engine: SandboxEngine;
  arch: string;
  /** `uid:gid` on a Linux host; `image-user` elsewhere, where the engine's VM owns the files. */
  owner: string;
  installScripts: boolean;
}

const ARCH_ALIASES: Readonly<Record<string, string>> = { amd64: 'x64', x86_64: 'x64', aarch64: 'arm64' };

/** The engine's architecture as one token, or `undefined` when it is not one. Never guessed. */
export function normalizeSandboxArch(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const lowered = value.trim().toLowerCase();
  const arch = ARCH_ALIASES[lowered] ?? lowered;
  return /^[a-z0-9_]{2,24}$/.test(arch) ? arch : undefined;
}

/** Who owns the volume's files: the editor's user on a Linux host, the image's user elsewhere. */
function volumeOwner(host: SandboxHostFacts): string | undefined {
  if (host?.os !== 'linux') {
    return 'image-user';
  }
  const user = host.user;
  return user && Number.isInteger(user.uid) && Number.isInteger(user.gid) && user.uid > 0 && user.gid >= 0
    ? `${user.uid}:${user.gid}`
    : undefined;
}

/**
 * The volume a preparation of exactly these inputs lives in. Deterministic:
 * the same inputs always name the same volume, and changing any one — the
 * lockfile above all — names another.
 */
export function deriveSandboxDependencyKey(
  input: SandboxDependencyKeyInput,
): { ok: true; key: string; volume: string } | { ok: false; reason: string } {
  if (!SANDBOX_DEPENDENCY_MANAGERS.some(manager => manager.id === input?.manager)) {
    return { ok: false, reason: 'The package manager is not one a volume can be prepared with.' };
  }
  if (typeof input.lockfileSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.lockfileSha256)) {
    return { ok: false, reason: 'The lockfile hash is not a SHA-256.' };
  }
  if (typeof input.imageDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(input.imageDigest)) {
    return { ok: false, reason: 'The image digest is not sha256:<64 hex>.' };
  }
  if (input.engine !== 'docker' && input.engine !== 'podman') {
    return { ok: false, reason: 'No supported engine was named.' };
  }
  const arch = normalizeSandboxArch(input.arch);
  if (!arch) {
    return { ok: false, reason: 'The engine\'s architecture is unknown.' };
  }
  if (typeof input.owner !== 'string' || !/^(?:\d{1,10}:\d{1,10}|image-user)$/.test(input.owner)) {
    return { ok: false, reason: 'Who owns the volume\'s files is unknown.' };
  }
  const material = [
    'atlasmind-deps/v1',
    `manager=${input.manager}`,
    `lockfile=sha256:${input.lockfileSha256}`,
    `image=${input.imageDigest}`,
    `engine=${input.engine}`,
    `platform=linux/${arch}`,
    `owner=${input.owner}`,
    `scripts=${input.installScripts === true ? 1 : 0}`,
  ].join('\n');
  const key = createHash('sha256').update(material).digest('hex');
  return { ok: true, key, volume: `${SANDBOX_DEPENDENCY_VOLUME_PREFIX}${key.slice(0, 16)}` };
}

// ── Records ──────────────────────────────────────────────────────

/** One finished preparation, as recorded on this machine. Never a secret; a path and some hashes. */
export interface SandboxDependencyRecord {
  volume: string;
  key: string;
  /** The folder it was prepared from. Only for saying "the lockfile changed since"; readiness is by key. */
  root: string;
  manager: SandboxPackageManager;
  lockfile: string;
  lockfileSha256: string;
  engine: SandboxEngine;
  image: string;
  arch: string;
  installScripts: boolean;
  preparedAt: string;
}

/** Read back what the global state holds. Anything malformed is dropped, not repaired. */
export function sanitizeSandboxDependencyRecords(raw: unknown): SandboxDependencyRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const records: SandboxDependencyRecord[] = [];
  for (const entry of raw.slice(0, SANDBOX_DEPENDENCY_RECORDS_MAX * 2)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const value = entry as Record<string, unknown>;
    const manager = SANDBOX_DEPENDENCY_MANAGERS.find(candidate => candidate.id === value['manager']);
    const engine = value['engine'];
    if (!isSandboxDependencyVolumeName(value['volume'])
      || typeof value['key'] !== 'string' || !/^[0-9a-f]{64}$/.test(value['key'])
      || value['volume'] !== `${SANDBOX_DEPENDENCY_VOLUME_PREFIX}${value['key'].slice(0, 16)}`
      || typeof value['root'] !== 'string' || value['root'].length > 4096
      || !manager
      || typeof value['lockfile'] !== 'string' || !manager.lockfiles.includes(value['lockfile'])
      || typeof value['lockfileSha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(value['lockfileSha256'])
      || (engine !== 'docker' && engine !== 'podman')
      || typeof value['image'] !== 'string' || !parseSandboxImageReference(value['image']).ok
      || !normalizeSandboxArch(value['arch'])
      || typeof value['installScripts'] !== 'boolean'
      || typeof value['preparedAt'] !== 'string' || !Number.isFinite(Date.parse(value['preparedAt']))) {
      continue;
    }
    records.push({
      volume: value['volume'],
      key: value['key'],
      root: value['root'],
      manager: manager.id,
      lockfile: value['lockfile'],
      lockfileSha256: value['lockfileSha256'],
      engine,
      image: value['image'],
      arch: normalizeSandboxArch(value['arch'])!,
      installScripts: value['installScripts'],
      preparedAt: new Date(Date.parse(value['preparedAt'])).toISOString(),
    });
  }
  return records.slice(0, SANDBOX_DEPENDENCY_RECORDS_MAX);
}

/** Add or replace one record (by volume), newest first, capped. */
export function recordSandboxDependencyVolume(
  records: readonly SandboxDependencyRecord[],
  record: SandboxDependencyRecord,
): SandboxDependencyRecord[] {
  return [record, ...records.filter(entry => entry.volume !== record.volume)].slice(0, SANDBOX_DEPENDENCY_RECORDS_MAX);
}

/** Drop the records for volumes that were removed. */
export function forgetSandboxDependencyVolumes(
  records: readonly SandboxDependencyRecord[],
  volumes: readonly string[],
): SandboxDependencyRecord[] {
  const gone = new Set(volumes);
  return records.filter(entry => !gone.has(entry.volume));
}

// ── Engine commands ──────────────────────────────────────────────

/** Read one volume's labels. A read, so a dry run lets it through. */
export function sandboxVolumeInspectArgv(volume: string): string[] {
  return ['volume', 'inspect', '--format', '{{json .Labels}}', volume];
}

/** List AtlasMind's dependency volumes, by label. A read. */
export const SANDBOX_DEPENDENCY_LIST_ARGV: readonly string[] = [
  'volume', 'ls', '--filter', `label=${SANDBOX_DEPENDENCY_LABEL}`, '--format', '{{.Name}}',
];

export type SandboxVolumeInspection =
  | { status: 'present'; labels: Readonly<Record<string, string>> }
  | { status: 'absent' }
  | { status: 'unknown'; detail: string };

/** What `volume inspect` said. "No such volume" is absent; anything else unreadable is unknown, never absent. */
export function parseSandboxVolumeInspection(outcome: SandboxProcessOutcome): SandboxVolumeInspection {
  if (outcome.kind === 'exited' && outcome.exitCode === 0) {
    try {
      const value = JSON.parse(outcome.stdout.trim() || 'null') as unknown;
      const labels: Record<string, string> = {};
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, label] of Object.entries(value as Record<string, unknown>).slice(0, 64)) {
          if (typeof label === 'string') {
            labels[name] = label;
          }
        }
      }
      return { status: 'present', labels };
    } catch {
      return { status: 'unknown', detail: 'The engine described the volume in a form AtlasMind could not read.' };
    }
  }
  if (outcome.kind === 'exited' && /no such volume/i.test(outcome.stderr)) {
    return { status: 'absent' };
  }
  return { status: 'unknown', detail: outcome.kind === 'exited' ? clean(outcome.stderr) || 'The engine refused to say.' : clean('detail' in outcome ? outcome.detail : 'It did not answer in time.') };
}

/** The volume names in `volume ls` output — only names AtlasMind makes, de-duplicated and capped. */
export function parseSandboxDependencyVolumeList(stdout: string): string[] {
  const names = String(stdout ?? '').split(/\r?\n/).map(line => line.trim()).filter(isSandboxDependencyVolumeName);
  return [...new Set(names)].slice(0, 256);
}

/** Remove volumes by name. No `--force`: a volume a running command still mounts stays, and the engine says so. */
export function sandboxDependencyRemoveArgv(volumes: readonly string[]): string[] | undefined {
  const valid = volumes.filter(isSandboxDependencyVolumeName);
  return valid.length > 0 && valid.length === volumes.length ? ['volume', 'rm', ...valid] : undefined;
}

// ── Readiness ────────────────────────────────────────────────────

export interface SandboxDependencyReaderDeps {
  /** One file at the folder's root, without following a symlink. */
  readFile: (absolutePath: string) => Promise<SandboxDependencyFile>;
  /** Detection already made for this folder; absent, the files are read with `readFile`. */
  detect?: (root: string) => Promise<SandboxDependencyDetection>;
  records: () => readonly SandboxDependencyRecord[];
  inspectVolume: (engine: SandboxEngine, volume: string) => Promise<SandboxVolumeInspection>;
}

function notPrepared(root: string, rule: SandboxDependencyRuleId, reason: string): SandboxDependencyState {
  return { status: 'not-prepared', root, rule, reason };
}

/** Read the files detection needs from one folder. Constant names only. */
export async function readSandboxDependencyFiles(
  root: string,
  readOne: SandboxDependencyReaderDeps['readFile'],
): Promise<Record<string, SandboxDependencyFile>> {
  const files: Record<string, SandboxDependencyFile> = {};
  for (const name of SANDBOX_DEPENDENCY_PROBE_FILES) {
    try {
      files[name] = await readOne(path.join(root, name));
    } catch {
      files[name] = { present: true, refused: 'unreadable' };
    }
  }
  return files;
}

/**
 * Whether a ready dependency volume exists for this folder's current
 * lockfile, as `sandboxPlan` needs to know. Never throws; every failure is a
 * named rule, and only `ready` lets a command that needs packages run.
 */
export async function readSandboxDependencyState(
  root: string,
  attestation: SandboxAttestation | undefined,
  host: SandboxHostFacts,
  deps: SandboxDependencyReaderDeps,
): Promise<SandboxDependencyState> {
  try {
    const detection = deps.detect
      ? await deps.detect(root)
      : detectSandboxDependencies(await readSandboxDependencyFiles(root, deps.readFile));
    if (detection.status === 'not-a-node-project') {
      return { status: 'not-a-node-project', root, reason: detection.reason };
    }
    if (detection.status === 'refused') {
      return notPrepared(root, detection.rule, detection.reason);
    }
    if (!attestation || attestation.status !== 'confirmed') {
      return notPrepared(root, 'attested', `${ruleText('attested')} There is none, so no volume can be matched to this lockfile.`);
    }
    if (!normalizeSandboxArch(attestation.arch)) {
      return notPrepared(root, 'platform-known', ruleText('platform-known'));
    }
    const owner = volumeOwner(host);
    const keys = [false, true].map(installScripts => deriveSandboxDependencyKey({
      manager: detection.manager,
      lockfileSha256: detection.lockfileSha256,
      imageDigest: attestation.digest,
      engine: attestation.engine,
      arch: attestation.arch ?? '',
      owner: owner ?? '',
      installScripts,
    }));
    const wanted = new Set(keys.flatMap(key => (key.ok ? [key.key] : [])));
    if (wanted.size === 0) {
      const failed = keys.find(key => !key.ok);
      return notPrepared(root, 'platform-known', failed && !failed.ok ? failed.reason : ruleText('platform-known'));
    }
    const records = deps.records();
    const record = records.find(entry => wanted.has(entry.key));
    if (!record) {
      const earlier = records.find(entry => entry.root === root && entry.manager === detection.manager);
      return notPrepared(
        root,
        'prepared',
        earlier
          ? `${detection.lockfile} has changed since dependencies were prepared on ${earlier.preparedAt.slice(0, 10)}, so that volume is not used. Prepare them again.`
          : `No dependencies are prepared for this ${detection.lockfile} with this image.`,
      );
    }
    const inspected = await deps.inspectVolume(attestation.engine, record.volume);
    if (inspected.status === 'absent') {
      return notPrepared(root, 'volume-present', `The volume ${record.volume} was prepared but is no longer there. Prepare dependencies again.`);
    }
    if (inspected.status === 'unknown') {
      return notPrepared(root, 'volume-present', `Whether the volume ${record.volume} is still there could not be read: ${inspected.detail}`);
    }
    if (inspected.labels[KEY_LABEL] !== record.key) {
      return notPrepared(root, 'volume-matches', `${record.volume} does not carry the key it was prepared for. ${ruleText('volume-matches')}`);
    }
    return {
      status: 'ready',
      root,
      volume: record.volume,
      key: record.key,
      manager: record.manager,
      lockfile: record.lockfile,
      installScripts: record.installScripts,
      preparedAt: record.preparedAt,
    };
  } catch (error) {
    return notPrepared(root, 'assessed', `${ruleText('assessed')} (${clean(error instanceof Error ? error.message : String(error))})`);
  }
}

/**
 * The reader the sandbox host, the check and the prepare command all use, so
 * the three cannot disagree about what "ready" means: the real file reader,
 * the recorded preparations, and `volume inspect` — a read, graded as one.
 */
export function createSandboxDependencyReader(input: {
  host: SandboxHostFacts;
  records: () => readonly SandboxDependencyRecord[];
  run: SandboxProcessRunner;
  detect?: (root: string) => Promise<SandboxDependencyDetection>;
}): (root: string, attestation: SandboxAttestation | undefined) => Promise<SandboxDependencyState> {
  return (root, attestation) => readSandboxDependencyState(root, attestation, input.host, {
    readFile: readSandboxDependencyFile,
    ...(input.detect ? { detect: input.detect } : {}),
    records: input.records,
    inspectVolume: async (engine, volume) => {
      const argv = sandboxVolumeInspectArgv(volume);
      guardHostCommand('sandbox-dependencies', engine, argv, { userInitiated: false });
      return parseSandboxVolumeInspection(await safeRun(input.run, engine, argv, STEP_TIMEOUT_MS));
    },
  });
}

/** The real file reader: `lstat` first, so a symlink is refused rather than followed. */
export async function readSandboxDependencyFile(absolutePath: string): Promise<SandboxDependencyFile> {
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { present: false } : { present: true, refused: 'unreadable' };
  }
  if (!stats.isFile()) {
    return { present: true, refused: 'not-a-regular-file' };
  }
  if (stats.size > SANDBOX_DEPENDENCY_FILE_MAX_BYTES) {
    return { present: true, refused: 'too-large' };
  }
  try {
    return { present: true, bytes: await readFile(absolutePath) };
  } catch {
    return { present: true, refused: 'unreadable' };
  }
}

// ── Preparation plan ─────────────────────────────────────────────

export type SandboxDependencyStepId = 'remove-previous' | 'create-volume' | 'set-ownership' | 'install';

export interface SandboxDependencyStep {
  id: SandboxDependencyStepId;
  purpose: string;
  /** Whether this step's container can reach the network. Only `install` can. */
  network: boolean;
  argv: string[];
  timeoutMs: number;
}

export type SandboxDependencyPlanRuleId =
  | 'detected'
  | 'attested'
  | 'configuration-matches'
  | 'run-id'
  | 'mount'
  | 'host-user'
  | 'limits'
  | 'key';

export type SandboxDependencyPreparePlan =
  | {
    ok: true;
    engine: SandboxEngine;
    volume: string;
    key: string;
    manager: SandboxPackageManager;
    lockfile: string;
    lockfileSha256: string;
    installScripts: boolean;
    root: string;
    image: string;
    arch: string;
    /** In order. Every argv follows the engine name; none is a shell. */
    steps: SandboxDependencyStep[];
    /** Removes a volume whose install failed, so a half-prepared one never exists under the name. */
    cleanup: string[];
    /** The install container's name, removed by that name if it times out. */
    installContainer: string;
    /** What this does, in sentences, shown verbatim before anything starts. */
    disclosure: string[];
  }
  | { ok: false; rule: SandboxDependencyPlanRuleId; reason: string };

export interface SandboxDependencyPrepareInput {
  detection: SandboxDependencyDetection;
  attestation: SandboxAttestation | undefined;
  configuration: Pick<SandboxConfiguration, 'engine' | 'image' | 'cpus' | 'memoryGb'>;
  host: SandboxHostFacts;
  /** The folder whose package.json and lockfile are mounted. Already resolved. */
  root: string;
  installScripts: boolean;
  /** 8–32 lowercase letters and digits. */
  runId: string;
  now: Date;
}

function refusePlan(rule: SandboxDependencyPlanRuleId, reason: string): SandboxDependencyPreparePlan {
  return { ok: false, rule, reason };
}

/**
 * Every engine command a preparation runs, decided before any of them starts.
 * Constant-shaped: the folder, the volume, the user and the limits are the
 * only things chosen, and each is validated here.
 */
export function planSandboxDependencyPreparation(input: SandboxDependencyPrepareInput): SandboxDependencyPreparePlan {
  const detection = input.detection;
  if (!detection || detection.status !== 'found') {
    return refusePlan('detected', detection?.status === 'refused'
      ? detection.reason
      : 'The folder has no package.json, so there are no dependencies to prepare.');
  }
  const manager = SANDBOX_DEPENDENCY_MANAGERS.find(candidate => candidate.id === detection.manager);
  if (!manager || !manager.lockfiles.includes(detection.lockfile)) {
    return refusePlan('detected', 'The package manager is not one a volume can be prepared with.');
  }
  const attestation = input.attestation;
  if (!attestation || attestation.status !== 'confirmed') {
    return refusePlan('attested', attestation?.status === 'unavailable'
      ? `The sandbox is unavailable (${attestation.rule}): ${attestation.reason}`
      : 'The container engine has not been probed. Run AtlasMind: Check Execution Sandbox first.');
  }
  const nowMs = input.now.getTime();
  if (!(nowMs >= Date.parse(attestation.probedAt) && nowMs < Date.parse(attestation.expiresAt))) {
    return refusePlan('attested', 'The sandbox attestation has expired. Probe again.');
  }
  if (attestation.image !== input.configuration.image
    || (input.configuration.engine !== 'auto' && input.configuration.engine !== attestation.engine)) {
    return refusePlan('configuration-matches', 'The attestation vouches for a different image or engine than the settings now name.');
  }
  if (typeof input.runId !== 'string' || !/^[a-z0-9]{8,32}$/.test(input.runId)) {
    return refusePlan('run-id', 'The run id must be 8–32 lowercase letters and digits.');
  }
  const mount = checkSandboxMountRoot(input.root, input.host);
  if (mount) {
    return refusePlan('mount', mount.reason);
  }
  const user = sandboxUserArgs(attestation.engine, attestation.rootless, input.host);
  if (!user.ok) {
    return refusePlan('host-user', user.reason);
  }
  const limits = sandboxLimitArgs(input.configuration.cpus, input.configuration.memoryGb);
  if (!limits) {
    return refusePlan('limits', 'CPU or memory is outside the range a limit can state.');
  }
  const owner = volumeOwner(input.host);
  const installScripts = input.installScripts === true;
  const derived = deriveSandboxDependencyKey({
    manager: manager.id,
    lockfileSha256: detection.lockfileSha256,
    imageDigest: attestation.digest,
    engine: attestation.engine,
    arch: attestation.arch ?? '',
    owner: owner ?? '',
    installScripts,
  });
  if (!derived.ok) {
    return refusePlan('key', derived.reason);
  }
  const engine = attestation.engine;
  const volume = derived.volume;
  const image = attestation.image;
  const separator = input.host.os === 'win32' ? '\\' : '/';
  const volumeMount = `type=volume,source=${volume},target=${SANDBOX_DEPENDENCY_TARGET}`;
  const userIsPodmanKeepId = engine === 'podman' && input.host.os === 'linux' ? ['--userns', 'keep-id'] : [];
  const installContainer = `atlasmind-deps-prep-${input.runId}`;
  const install = [...manager.install, ...(installScripts ? [] : [manager.ignoreScripts])];

  const steps: SandboxDependencyStep[] = [
    {
      id: 'remove-previous',
      purpose: `Remove any earlier ${volume}, so what is installed starts empty. It fails, and nothing else runs, if a command is still using it.`,
      network: false,
      argv: ['volume', 'rm', '--force', volume],
      timeoutMs: STEP_TIMEOUT_MS,
    },
    {
      id: 'create-volume',
      purpose: `Create ${volume}, labelled with the key it is prepared for.`,
      network: false,
      argv: [
        'volume', 'create',
        '--label', SANDBOX_DEPENDENCY_LABEL,
        '--label', `${KEY_LABEL}=${derived.key}`,
        '--label', `atlasmind.deps.manager=${manager.id}`,
        '--label', `atlasmind.deps.scripts=${installScripts ? 1 : 0}`,
        volume,
      ],
      timeoutMs: STEP_TIMEOUT_MS,
    },
  ];
  if (input.host.os === 'linux') {
    steps.push({
      id: 'set-ownership',
      purpose: `Make the empty volume yours (${owner}). No network, and the only permission it keeps is changing a file's owner.`,
      network: false,
      argv: [
        'run', '--rm', '--init', '--pull', 'never',
        '--name', `atlasmind-deps-own-${input.runId}`,
        '--label', 'atlasmind.deps.prepare=1',
        '--network', 'none',
        '--cap-drop', 'ALL',
        '--cap-add', 'CHOWN',
        '--security-opt', 'no-new-privileges',
        '--read-only',
        '--pids-limit', '64',
        ...userIsPodmanKeepId,
        '--user', '0:0',
        '--mount', volumeMount,
        image, 'chown', owner!, SANDBOX_DEPENDENCY_TARGET,
      ],
      timeoutMs: STEP_TIMEOUT_MS,
    });
  }
  steps.push({
    id: 'install',
    purpose: `Install exactly ${detection.lockfile} into the volume with ${manager.id}. This is the only container with network access.`,
    network: true,
    argv: [
      'run', '--rm', '--init', '--pull', 'never',
      '--name', installContainer,
      '--label', 'atlasmind.deps.prepare=1',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', String(SANDBOX_PIDS_LIMIT),
      ...limits,
      ...user.args,
      ...detection.mounts.map(name =>
        `type=bind,source=${input.root}${separator}${name},target=${SANDBOX_MOUNT_TARGET}/${name},readonly`)
        .flatMap(spec => ['--mount', spec]),
      '--mount', volumeMount,
      '--workdir', SANDBOX_MOUNT_TARGET,
      '--env', 'HOME=/tmp',
      '--env', 'TMPDIR=/tmp',
      image,
      ...install,
    ],
    timeoutMs: SANDBOX_DEPENDENCY_INSTALL_TIMEOUT_MS,
  });

  const disclosure = [
    `One container reaches the network: it runs \`${install.join(' ')}\` in ${image}, and can fetch whatever ${detection.lockfile} names `
      + 'from its registry — and anything those packages point at.',
    `It sees only package.json and ${detection.lockfile} from ${input.root}, mounted read-only: not your source, not .npmrc, `
      + 'not your environment or credentials. Every capability is dropped.',
    `It writes only into the volume ${volume}, which is mounted over node_modules whenever an agent command runs in the sandbox for this lockfile.`,
    installScripts
      ? 'Install scripts RUN. They are arbitrary code from every package in the lockfile, running with network access. They see only '
        + 'the two files above, but what they leave in the volume runs whenever a sandboxed command loads those packages.'
      : 'Install scripts are not run (--ignore-scripts). A package that builds or downloads native code in an install step may not work; '
        + 'packages that ship prebuilt binaries as optional dependencies (esbuild, rollup, swc and most others) do.',
    'A project .npmrc is not mounted, so a private registry or its token is not used. Behind a TLS-intercepting proxy the image must '
      + 'already trust its certificate.',
    ...(input.host.os === 'linux'
      ? [`First, a container with no network and only the permission to change ownership makes the empty volume yours (${owner}).`]
      : []),
  ];

  return {
    ok: true,
    engine,
    volume,
    key: derived.key,
    manager: manager.id,
    lockfile: detection.lockfile,
    lockfileSha256: detection.lockfileSha256,
    installScripts,
    root: input.root,
    image,
    arch: normalizeSandboxArch(attestation.arch)!,
    steps,
    cleanup: ['volume', 'rm', '--force', volume],
    installContainer,
    disclosure,
  };
}

// ── Preparation run ──────────────────────────────────────────────

export interface SandboxDependencyStepResult {
  id: SandboxDependencyStepId | 'cleanup';
  ok: boolean;
  detail: string;
}

export type SandboxDependencyPrepareOutcome =
  | { status: 'prepared'; record: SandboxDependencyRecord; steps: SandboxDependencyStepResult[] }
  | { status: 'failed'; failedStep: SandboxDependencyStepId; detail: string; steps: SandboxDependencyStepResult[] }
  | { status: 'dry-run'; detail: string };

/** Engine output is somebody else's text: redacted, control-stripped, the last few lines, bounded. */
function clean(value: string): string {
  const lines = redactSecrets(String(value ?? '')).text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map(line => line.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-6);
  const joined = lines.join(' — ');
  return joined.length > 600 ? `…${joined.slice(-599)}` : joined;
}

function describeOutcome(outcome: SandboxProcessOutcome): string {
  switch (outcome.kind) {
    case 'exited':
      return outcome.exitCode === 0 ? (clean(outcome.stdout) || 'Done.') : `Exited ${outcome.exitCode}: ${clean(outcome.stderr || outcome.stdout) || 'it said nothing more.'}`;
    case 'timeout':
      return `Did not finish in time. ${clean(outcome.stderr)}`.trim();
    default:
      return clean(outcome.detail) || 'It could not be started.';
  }
}

async function safeRun(run: SandboxProcessRunner, engine: SandboxEngine, argv: readonly string[], timeoutMs: number): Promise<SandboxProcessOutcome> {
  try {
    const outcome = await run(engine, argv, { timeoutMs });
    return outcome && typeof outcome === 'object' && typeof outcome.kind === 'string'
      ? outcome
      : { kind: 'error', detail: 'The engine runner returned nothing readable.' };
  } catch (error) {
    return { kind: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Run a plan a person approved. The whole preparation is one effect a dry run
 * records and holds; each step is graded again as it starts. A failure after
 * the volume exists removes it, so a half-prepared volume never carries the
 * name, and a timed-out install's container is removed by its own name.
 * Only a finished install is recorded.
 */
export async function runSandboxDependencyPreparation(
  plan: Extract<SandboxDependencyPreparePlan, { ok: true }>,
  deps: { run: SandboxProcessRunner; now: () => Date },
): Promise<SandboxDependencyPrepareOutcome> {
  const held = interceptDryRun({
    surface: 'sandbox-dependencies',
    kind: 'process',
    summary: `prepare sandbox dependencies (${plan.manager}, ${plan.lockfile}) into ${plan.volume}, with network access`,
    details: { volume: plan.volume, steps: plan.steps.map(step => [plan.engine, ...step.argv].join(' ')) },
  });
  if (held) {
    return { status: 'dry-run', detail: describeHostDryRunNotice(held) };
  }
  const results: SandboxDependencyStepResult[] = [];
  let volumeCreated = false;
  for (const step of plan.steps) {
    try {
      guardHostCommand('sandbox-dependencies', plan.engine, step.argv, { userInitiated: true });
    } catch (error) {
      if (isDryRunBlockedError(error)) {
        return { status: 'dry-run', detail: error.message };
      }
      throw error;
    }
    const outcome = await safeRun(deps.run, plan.engine, step.argv, step.timeoutMs);
    const ok = outcome.kind === 'exited' && outcome.exitCode === 0;
    results.push({ id: step.id, ok, detail: describeOutcome(outcome) });
    if (step.id === 'create-volume' && ok) {
      volumeCreated = true;
    }
    if (!ok) {
      if (step.id === 'install' && outcome.kind !== 'exited') {
        const removed = await safeRun(deps.run, plan.engine, ['rm', '--force', plan.installContainer], STEP_TIMEOUT_MS);
        results.push({ id: 'cleanup', ok: removed.kind === 'exited' && removed.exitCode === 0, detail: `Removed ${plan.installContainer}.` });
      }
      if (volumeCreated) {
        const removed = await safeRun(deps.run, plan.engine, plan.cleanup, STEP_TIMEOUT_MS);
        results.push({
          id: 'cleanup',
          ok: removed.kind === 'exited' && removed.exitCode === 0,
          detail: removed.kind === 'exited' && removed.exitCode === 0
            ? `Removed ${plan.volume}, so a half-prepared volume is never used.`
            : `Could not remove ${plan.volume}: ${describeOutcome(removed)} It is not recorded, so it is not used.`,
        });
      }
      return { status: 'failed', failedStep: step.id, detail: results.find(result => result.id === step.id && !result.ok)?.detail ?? '', steps: results };
    }
  }
  return {
    status: 'prepared',
    steps: results,
    record: {
      volume: plan.volume,
      key: plan.key,
      root: plan.root,
      manager: plan.manager,
      lockfile: plan.lockfile,
      lockfileSha256: plan.lockfileSha256,
      engine: plan.engine,
      image: plan.image,
      arch: plan.arch,
      installScripts: plan.installScripts,
      preparedAt: deps.now().toISOString(),
    },
  };
}

// ── Report ───────────────────────────────────────────────────────

/** The dependency section of the Check Execution Sandbox report. */
export function renderSandboxDependencySection(state: SandboxDependencyState | undefined, records: readonly SandboxDependencyRecord[] = []): string[] {
  const lines = ['## Dependencies', ''];
  if (!state) {
    lines.push('Not assessed: no folder is open, or the sandbox settings could not be used.', '');
  } else if (state.status === 'ready') {
    lines.push(
      `**Ready** — \`${state.volume}\` holds ${state.lockfile} installed with ${state.manager}`
        + `${state.installScripts ? ', install scripts run' : ', install scripts not run'}, prepared ${state.preparedAt}. `
        + 'It is mounted over node_modules for every command that runs in the sandbox for this folder.',
      '',
    );
  } else if (state.status === 'not-a-node-project') {
    lines.push(`**Not needed** — ${state.reason}`, '');
  } else {
    lines.push(
      `**Not prepared** — rule \`${state.rule}\`: ${state.reason}`,
      '',
      'Under require, a command that loads installed packages is refused until they are prepared; the host\'s own node_modules is never '
        + 'used instead. Run **AtlasMind: Prepare Sandbox Dependencies** — it shows every command and what network access means before '
        + 'anything starts. Scheduled routines never prepare them.',
      '',
    );
  }
  lines.push(
    '| Rule | Why |',
    '|---|---|',
    // Backslash first, or it escapes the escape. See `markdownCell` in `debtRegister`.
    ...SANDBOX_DEPENDENCY_RULES.map(rule => `| \`${rule.id}\` | ${rule.description.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} |`),
    '',
  );
  if (records.length > 0) {
    lines.push(
      `${records.length} dependency volume(s) recorded on this machine. They accumulate as lockfiles change; `
        + '**AtlasMind: Remove Sandbox Dependency Volumes** lists them and removes the ones you choose.',
      '',
    );
  }
  return lines;
}
