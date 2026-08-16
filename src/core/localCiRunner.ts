import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pipeGhStdoutOrThrow, runGhOrThrow } from './ghClient.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import { sanitizeTerminalOutput } from '../utils/terminalOutput.js';
import { probeGpuDevices } from '../providers/gpuProbe.js';
import type { GpuDevice } from '../providers/gpuProbeParse.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_LOCAL_CI_IMAGE = 'ghcr.io/actions/actions-runner@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda';
export const LOCAL_CI_MIN_CPUS = 2;
export const LOCAL_CI_MIN_MEMORY_GB = 4;
export const LOCAL_CI_PIDS_LIMIT = 1024;
const LOCAL_CI_LABEL = 'com.atlasmind.local-ci=true';

export type LocalCiShutdownPolicy = 'ifStartedByAtlasMind' | 'never' | 'always';
export type LocalCiLifecycle =
  | 'disabled'
  | 'not-inspected'
  | 'inspecting'
  | 'blocked'
  | 'ready'
  | 'starting'
  | 'waiting'
  | 'running'
  | 'finished'
  | 'failed';

export interface LocalCiRunnerConfiguration {
  enabled: boolean;
  workflowFile: string;
  trustedBranch: string;
  runnerLabel: string;
  image: string;
  shutdownPolicy: LocalCiShutdownPolicy;
  maxCpus: number;
  maxMemoryGb: number;
}

export interface LocalCiCapacity {
  cpuCount: number;
  memoryGb: number;
  os: string;
  arch: string;
}

export interface LocalCiResourcePlan {
  cpus: number;
  memoryGb: number;
  pidsLimit: number;
  reserveCpus: number;
  reserveMemoryGb: number;
  basedOn: 'host' | 'docker-engine';
  provisional: boolean;
  blockers: string[];
  explanation: string;
}

export interface LocalCiEngineSnapshot {
  cliInstalled: boolean;
  available: boolean;
  desktopAvailable: boolean;
  startedByAtlasMind: boolean;
  os?: string;
  arch?: string;
  cpuCount?: number;
  memoryGb?: number;
  version?: string;
  imagePresent?: boolean;
  resolvedImageId?: string;
  otherRunningContainers: number;
}

export interface LocalCiGpuDevice {
  name: string;
  index?: number;
  totalGb?: number;
  usedGb?: number;
  freeGb?: number;
  measurement: 'live-memory' | 'reported-total' | 'identity-only';
}

export interface LocalCiGpuSnapshot {
  detection: 'not-inspected' | 'detected' | 'not-detected';
  devices: LocalCiGpuDevice[];
  /** Whether Docker advertised a GPU-capable runtime; not proof that a container was granted a GPU. */
  dockerRuntimeKnown: boolean;
  dockerRuntimeAvailable: boolean;
  dockerRuntimes: string[];
  /** Detection is informational. This runner deliberately never supplies `--gpus`. */
  accessPolicy: 'disabled';
}

export interface LocalCiQueuedRun {
  databaseId: number;
  workflowName: string;
  displayTitle: string;
  event: string;
  headBranch: string;
  headSha: string;
  createdAt: string;
}

export interface LocalCiRunnerSnapshot {
  provider: 'github-actions';
  executor: 'docker';
  lifecycle: LocalCiLifecycle;
  enabled: boolean;
  host: LocalCiCapacity;
  engine: LocalCiEngineSnapshot;
  gpu: LocalCiGpuSnapshot;
  resources: LocalCiResourcePlan;
  workflowFile: string;
  trustedBranch: string;
  runnerLabel: string;
  image: string;
  shutdownPolicy: LocalCiShutdownPolicy;
  evidenceLabel: string;
  blockers: string[];
  warnings: string[];
  message: string;
  queuedRun?: LocalCiQueuedRun;
  containerName?: string;
  lastOutput?: string;
  updatedAt: string;
}

export interface LocalCiStartPlan {
  repoSlug: string;
  runnerLabel: string;
  image: string;
  workflowFile: string;
  trustedBranch: string;
  currentSha: string;
  queuedRun: LocalCiQueuedRun;
  resources: LocalCiResourcePlan;
  engineWillStart: boolean;
  imageMayBePulled: boolean;
  shutdownPolicy: LocalCiShutdownPolicy;
}

export interface LocalCiWorkflowAssessment {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

interface DockerInfoShape {
  OSType?: unknown;
  Architecture?: unknown;
  NCPU?: unknown;
  MemTotal?: unknown;
  ServerVersion?: unknown;
  Runtimes?: unknown;
  DefaultRuntime?: unknown;
}

interface QueuedRunShape {
  databaseId?: unknown;
  workflowName?: unknown;
  displayTitle?: unknown;
  event?: unknown;
  headBranch?: unknown;
  headSha?: unknown;
  status?: unknown;
  createdAt?: unknown;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function bounded(value: unknown, limit = 240): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function bytesToRoundedGb(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.round((value / (1024 ** 3)) * 10) / 10
    : undefined;
}

export function summarizeLocalCiGpuDevices(devices: readonly GpuDevice[]): LocalCiGpuDevice[] {
  return devices.slice(0, 16).map(device => {
    // Win32_VideoController truncates large cards to roughly 4 GB. Preserve the
    // identity but omit that misleading number; nvidia-smi and macOS readings
    // remain usable where the source can stand behind them.
    const totalGb = device.totalUntrustworthy ? undefined : bytesToRoundedGb(device.totalBytes);
    const usedGb = bytesToRoundedGb(device.usedBytes);
    const freeGb = bytesToRoundedGb(device.freeBytes);
    return {
      name: bounded(device.name, 160) || 'Unknown GPU',
      ...(device.index === undefined ? {} : { index: Math.max(0, Math.floor(device.index)) }),
      ...(totalGb === undefined ? {} : { totalGb }),
      ...(usedGb === undefined ? {} : { usedGb }),
      ...(freeGb === undefined ? {} : { freeGb }),
      measurement: freeGb !== undefined || usedGb !== undefined
        ? 'live-memory'
        : totalGb !== undefined ? 'reported-total' : 'identity-only',
    };
  });
}

export function parseDockerGpuRuntimes(raw: string): Pick<LocalCiGpuSnapshot,
  'dockerRuntimeKnown' | 'dockerRuntimeAvailable' | 'dockerRuntimes'> {
  try {
    const parsed = JSON.parse(raw) as DockerInfoShape;
    const runtimes = parsed.Runtimes && typeof parsed.Runtimes === 'object' && !Array.isArray(parsed.Runtimes)
      ? Object.keys(parsed.Runtimes as Record<string, unknown>)
        .map(value => value.trim().toLowerCase())
        .filter(value => /^[a-z0-9._-]{1,40}$/.test(value))
        .slice(0, 20)
        .sort((left, right) => left.localeCompare(right))
      : [];
    const defaultRuntime = bounded(parsed.DefaultRuntime, 40).toLowerCase();
    return {
      dockerRuntimeKnown: true,
      dockerRuntimeAvailable: runtimes.some(runtime => runtime === 'nvidia' || runtime.includes('gpu'))
        || defaultRuntime === 'nvidia',
      dockerRuntimes: runtimes,
    };
  } catch {
    return { dockerRuntimeKnown: false, dockerRuntimeAvailable: false, dockerRuntimes: [] };
  }
}

export function normalizeLocalCiArch(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'amd64' || normalized === 'x86_64' || normalized === 'x64') {
    return 'x64';
  }
  if (normalized === 'arm64' || normalized === 'aarch64') {
    return 'arm64';
  }
  return normalized.replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'unknown';
}

function detectLocalCiHostCapacity(): LocalCiCapacity {
  return {
    cpuCount: Math.max(1, os.cpus().length),
    memoryGb: Math.max(1, Math.floor((os.totalmem() / (1024 ** 3)) * 10) / 10),
    os: os.platform(),
    arch: normalizeLocalCiArch(os.arch()),
  };
}

export function resolveLocalCiRunnerLabel(pattern: string, arch: string): string {
  const value = pattern.replaceAll('{arch}', normalizeLocalCiArch(arch)).trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) ? value : '';
}

export function planLocalCiResources(
  host: LocalCiCapacity,
  engine: LocalCiCapacity | undefined,
  limits: Pick<LocalCiRunnerConfiguration, 'maxCpus' | 'maxMemoryGb'>,
): LocalCiResourcePlan {
  const capacity = engine ?? host;
  const basedOn = engine ? 'docker-engine' as const : 'host' as const;
  const reserveCpus = Math.max(1, Math.ceil(capacity.cpuCount * 0.25));
  const reserveMemoryGb = Math.max(2, Math.ceil(capacity.memoryGb * 0.25));
  const configuredCpuCap = Math.max(0, Math.floor(limits.maxCpus));
  const configuredMemoryCap = Math.max(0, Math.floor(limits.maxMemoryGb));
  const cpus = Math.max(0, Math.min(configuredCpuCap, Math.floor(capacity.cpuCount - reserveCpus)));
  const memoryGb = Math.max(0, Math.min(configuredMemoryCap, Math.floor(capacity.memoryGb - reserveMemoryGb)));
  const blockers: string[] = [];
  if (cpus < LOCAL_CI_MIN_CPUS) {
    blockers.push(`The calculated ${cpus}-CPU limit is below the safe ${LOCAL_CI_MIN_CPUS}-CPU minimum.`);
  }
  if (memoryGb < LOCAL_CI_MIN_MEMORY_GB) {
    blockers.push(`The calculated ${memoryGb} GB memory limit is below the safe ${LOCAL_CI_MIN_MEMORY_GB} GB minimum.`);
  }
  return {
    cpus,
    memoryGb,
    pidsLimit: LOCAL_CI_PIDS_LIMIT,
    reserveCpus,
    reserveMemoryGb,
    basedOn,
    provisional: engine === undefined,
    blockers,
    explanation: `${capacity.cpuCount} CPUs / ${capacity.memoryGb} GB ${basedOn === 'docker-engine' ? 'visible to Docker' : 'on the host'}; `
      + `reserve ${reserveCpus} CPUs / ${reserveMemoryGb} GB, then apply caps of ${configuredCpuCap} CPUs / ${configuredMemoryCap} GB.`,
  };
}

export function parseDockerInfo(raw: string): LocalCiCapacity | undefined {
  try {
    const value = JSON.parse(raw) as DockerInfoShape;
    const cpuCount = finitePositive(value.NCPU);
    const memoryBytes = finitePositive(value.MemTotal);
    const dockerOs = bounded(value.OSType, 40).toLowerCase();
    const arch = normalizeLocalCiArch(bounded(value.Architecture, 40));
    if (!cpuCount || !memoryBytes || !dockerOs || arch === 'unknown') {
      return undefined;
    }
    return {
      cpuCount: Math.floor(cpuCount),
      memoryGb: Math.floor((memoryBytes / (1024 ** 3)) * 10) / 10,
      os: dockerOs,
      arch,
    };
  } catch {
    return undefined;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate the deliberately narrow workflow contract accepted by the local
 * executor. A runner label routes work; these checks are what authorise it.
 */
export function assessTrustedLocalCiWorkflow(
  text: string,
  input: { repoSlug: string; branch: string; runnerLabel: string },
): LocalCiWorkflowAssessment {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const normalized = text.replace(/\r\n/g, '\n');
  const exact = (value: string): RegExp => new RegExp(escapeRegex(value), 'i');

  if (/\bpull_request(?:_target)?\b|\bworkflow_run\b|^\s*schedule\s*:/im.test(normalized)) {
    blockers.push('The workflow has an untrusted or indirect trigger; local runners accept only owner-gated push/manual jobs.');
  }
  if (!/^\s{2}workflow_dispatch\s*:/m.test(normalized) && !/^\s{2}push\s*:/m.test(normalized)) {
    blockers.push('The workflow has neither a push nor manual trigger.');
  }
  if (!exact(`branches: [${input.branch}]`).test(normalized)
    && !new RegExp(`^\\s+[- ]+${escapeRegex(input.branch)}\\s*$`, 'm').test(normalized)) {
    blockers.push(`The workflow is not visibly restricted to the trusted branch "${input.branch}".`);
  }
  if (!exact(`github.repository == '${input.repoSlug}'`).test(normalized)
    && !exact(`github.repository == "${input.repoSlug}"`).test(normalized)) {
    blockers.push(`The job does not require the exact repository ${input.repoSlug}.`);
  }
  if (!exact(`github.ref == 'refs/heads/${input.branch}'`).test(normalized)
    && !exact(`github.ref == "refs/heads/${input.branch}"`).test(normalized)) {
    blockers.push(`The job does not require refs/heads/${input.branch}.`);
  }
  if (!/github\.actor\s*==\s*github\.repository_owner/i.test(normalized)) {
    blockers.push('The job does not require the triggering actor to be the repository owner.');
  }
  const routedJobs = [...normalized.matchAll(new RegExp(
    `runs-on:\\s*\\[?\\s*${escapeRegex(input.runnerLabel)}\\s*\\]?`,
    'gi',
  ))];
  if (routedJobs.length !== 1) {
    blockers.push(routedJobs.length > 1
      ? `More than one job uses ${input.runnerLabel}; an ephemeral worker accepts exactly one job.`
      : `No job is routed exclusively to ${input.runnerLabel}.`);
  }
  if (!/^permissions:\s*\n(?:^[ \t]+[^\n]*\n)*?^[ \t]+contents:\s*read\s*$/m.test(normalized)) {
    blockers.push('Top-level permissions must explicitly grant contents: read.');
  }
  if (/^[ \t]+[A-Za-z-]+:\s*write\s*$/m.test(normalized) || /id-token:\s*write/i.test(normalized)) {
    blockers.push('The workflow grants a write permission.');
  }
  if (/\$\{\{\s*secrets\./i.test(normalized)) {
    blockers.push('The workflow references a GitHub secret; local runner jobs must be secret-free.');
  }
  if (/uses:\s*actions\/checkout@/i.test(normalized) && !/persist-credentials:\s*false/i.test(normalized)) {
    blockers.push('Checkout must set persist-credentials: false.');
  }
  const actionRefs = [...normalized.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)\s*$/gim)].map(match => match[1] ?? '');
  for (const actionRef of actionRefs) {
    if (actionRef.startsWith('docker://')) {
      if (!/@sha256:[a-f0-9]{64}$/i.test(actionRef)) {
        blockers.push(`Container action ${actionRef.slice(0, 100)} is not digest-pinned.`);
      }
    } else if (!/@[a-f0-9]{40}$/i.test(actionRef)) {
      blockers.push(`Action ${actionRef.slice(0, 100)} is not pinned to a full commit SHA.`);
    }
  }
  if (actionRefs.length === 0) {
    warnings.push('The workflow uses no external actions; verify that this is intentional.');
  }
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

function safeFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return redactSecrets(sanitizeTerminalOutput(raw)).text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function execCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs = 15_000,
  maxBuffer = 1024 * 1024,
): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], {
    cwd,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer,
  });
  return String(stdout).trim();
}

function defaultEngine(): LocalCiEngineSnapshot {
  return {
    cliInstalled: false,
    available: false,
    desktopAvailable: false,
    startedByAtlasMind: false,
    otherRunningContainers: 0,
  };
}

function defaultGpu(): LocalCiGpuSnapshot {
  return {
    detection: 'not-inspected',
    devices: [],
    dockerRuntimeKnown: false,
    dockerRuntimeAvailable: false,
    dockerRuntimes: [],
    accessPolicy: 'disabled',
  };
}

export function initialLocalCiRunnerSnapshot(configuration: LocalCiRunnerConfiguration): LocalCiRunnerSnapshot {
  const host = detectLocalCiHostCapacity();
  const runnerLabel = resolveLocalCiRunnerLabel(configuration.runnerLabel, host.arch);
  return {
    provider: 'github-actions',
    executor: 'docker',
    lifecycle: configuration.enabled ? 'not-inspected' : 'disabled',
    enabled: configuration.enabled,
    host,
    engine: defaultEngine(),
    gpu: defaultGpu(),
    resources: planLocalCiResources(host, undefined, configuration),
    workflowFile: configuration.workflowFile,
    trustedBranch: configuration.trustedBranch,
    runnerLabel,
    image: configuration.image,
    shutdownPolicy: configuration.shutdownPolicy,
    evidenceLabel: `Linux container (${runnerLabel.endsWith('arm64') ? 'arm64' : 'x64'}); not native ${host.os} evidence`,
    blockers: configuration.enabled ? [] : ['Local CI is disabled in machine settings.'],
    warnings: ['Docker capacity and installed images have not been inspected.'],
    message: configuration.enabled ? 'Inspect this machine before starting a runner.' : 'Enable local CI in machine settings to use this executor.',
    updatedAt: new Date().toISOString(),
  };
}

/** One-job, ephemeral GitHub runner lifecycle. Never dispatches or reruns CI. */
export class LocalCiRunnerManager {
  private snapshot: LocalCiRunnerSnapshot;
  private operationRunning = false;
  private startedDesktop = false;
  private runnerProcess: ChildProcessWithoutNullStreams | undefined;

  constructor(
    private readonly workspaceRoot: string,
    configuration: LocalCiRunnerConfiguration,
    private readonly log: (line: string) => void = () => undefined,
    private readonly changed: () => void = () => undefined,
  ) {
    this.snapshot = initialLocalCiRunnerSnapshot(configuration);
  }

  getSnapshot(): LocalCiRunnerSnapshot {
    return {
      ...this.snapshot,
      host: { ...this.snapshot.host },
      engine: { ...this.snapshot.engine },
      gpu: { ...this.snapshot.gpu, devices: this.snapshot.gpu.devices.map(device => ({ ...device })), dockerRuntimes: [...this.snapshot.gpu.dockerRuntimes] },
      resources: { ...this.snapshot.resources, blockers: [...this.snapshot.resources.blockers] },
      blockers: [...this.snapshot.blockers],
      warnings: [...this.snapshot.warnings],
      ...(this.snapshot.queuedRun ? { queuedRun: { ...this.snapshot.queuedRun } } : {}),
    };
  }

  applyConfiguration(configuration: LocalCiRunnerConfiguration): void {
    if (['starting', 'waiting', 'running'].includes(this.snapshot.lifecycle)) {
      return;
    }
    const host = detectLocalCiHostCapacity();
    const engineCapacity = this.snapshot.engine.available
      && this.snapshot.engine.cpuCount && this.snapshot.engine.memoryGb
      && this.snapshot.engine.os && this.snapshot.engine.arch
      ? {
        cpuCount: this.snapshot.engine.cpuCount,
        memoryGb: this.snapshot.engine.memoryGb,
        os: this.snapshot.engine.os,
        arch: this.snapshot.engine.arch,
      }
      : undefined;
    const runnerLabel = resolveLocalCiRunnerLabel(configuration.runnerLabel, engineCapacity?.arch ?? host.arch);
    this.update({
      enabled: configuration.enabled,
      lifecycle: configuration.enabled ? 'not-inspected' : 'disabled',
      host,
      resources: planLocalCiResources(host, engineCapacity, configuration),
      workflowFile: configuration.workflowFile,
      trustedBranch: configuration.trustedBranch,
      runnerLabel,
      image: configuration.image,
      shutdownPolicy: configuration.shutdownPolicy,
      blockers: configuration.enabled ? [] : ['Local CI is disabled in machine settings.'],
      warnings: ['Settings changed; inspect the executor again before starting.'],
      message: configuration.enabled ? 'Settings changed; inspect this machine again.' : 'Local CI is disabled in machine settings.',
      queuedRun: undefined,
      containerName: undefined,
      lastOutput: undefined,
    });
  }

  private update(patch: Partial<LocalCiRunnerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, updatedAt: new Date().toISOString() };
    this.changed();
  }

  async inspect(configuration: LocalCiRunnerConfiguration): Promise<LocalCiRunnerSnapshot> {
    const retainedLifecycle = ['starting', 'waiting', 'running'].includes(this.snapshot.lifecycle)
      ? this.snapshot.lifecycle
      : undefined;
    this.update({ lifecycle: retainedLifecycle ?? (configuration.enabled ? 'inspecting' : 'disabled'), message: 'Inspecting the local executor…' });
    const host = detectLocalCiHostCapacity();
    const engine = defaultEngine();
    const gpuDevices = summarizeLocalCiGpuDevices(await probeGpuDevices().catch(() => []));
    const gpu: LocalCiGpuSnapshot = {
      detection: gpuDevices.length > 0 ? 'detected' : 'not-detected',
      devices: gpuDevices,
      dockerRuntimeKnown: false,
      dockerRuntimeAvailable: false,
      dockerRuntimes: [],
      accessPolicy: 'disabled',
    };
    const blockers: string[] = [];
    const warnings: string[] = [];

    try {
      engine.cliInstalled = Boolean(await execCommand('docker', ['--version'], this.workspaceRoot));
    } catch {
      blockers.push('Docker CLI is not installed or is not on PATH.');
    }
    if (engine.cliInstalled) {
      try {
        await execCommand('docker', ['desktop', 'version'], this.workspaceRoot);
        engine.desktopAvailable = true;
      } catch {
        engine.desktopAvailable = false;
      }
      try {
        const raw = await execCommand('docker', ['info', '--format', '{{json .}}'], this.workspaceRoot);
        const capacity = parseDockerInfo(raw);
        if (capacity) {
          engine.available = true;
          engine.os = capacity.os;
          engine.arch = capacity.arch;
          engine.cpuCount = capacity.cpuCount;
          engine.memoryGb = capacity.memoryGb;
          try {
            const parsed = JSON.parse(raw) as DockerInfoShape;
            engine.version = bounded(parsed.ServerVersion, 80) || undefined;
          } catch {
            // Capacity was already parsed; a missing display version is harmless.
          }
          Object.assign(gpu, parseDockerGpuRuntimes(raw));
          try {
            const rows = await execCommand('docker', ['ps', '--format', '{{json .}}'], this.workspaceRoot);
            engine.otherRunningContainers = rows.split(/\r?\n/).filter(line => line.trim() && !line.includes(LOCAL_CI_LABEL)).length;
          } catch {
            warnings.push('Running containers could not be counted, so AtlasMind will not stop Docker Desktop.');
          }
        }
      } catch {
        warnings.push(engine.desktopAvailable
          ? 'Docker Desktop is stopped. AtlasMind can start it after the run confirmation.'
          : 'The Docker engine is not running, and no Docker Desktop CLI was detected for safe lifecycle control.');
      }
    }

    const engineCapacity = engine.available && engine.cpuCount && engine.memoryGb && engine.os && engine.arch
      ? { cpuCount: engine.cpuCount, memoryGb: engine.memoryGb, os: engine.os, arch: engine.arch }
      : undefined;
    const resources = planLocalCiResources(host, engineCapacity, configuration);
    blockers.push(...resources.blockers);
    if (engine.available && engine.os !== 'linux') {
      blockers.push(`The selected Docker engine reports ${engine.os}; this executor produces Linux evidence only.`);
    }

    const runnerLabel = resolveLocalCiRunnerLabel(configuration.runnerLabel, engine.arch ?? host.arch);
    if (!runnerLabel) {
      blockers.push('The configured runner label is invalid after architecture expansion.');
    }
    if (!/^[A-Za-z0-9._/@:-]{1,300}$/.test(configuration.image)) {
      blockers.push('The configured runner image is not a valid immutable image reference.');
    }

    if (engine.available && blockers.length === 0) {
      try {
        const imageId = await execCommand('docker', ['image', 'inspect', configuration.image, '--format', '{{.Id}}'], this.workspaceRoot);
        engine.imagePresent = /^sha256:[a-f0-9]{64}$/i.test(imageId);
        if (engine.imagePresent) {
          engine.resolvedImageId = imageId;
        }
      } catch {
        engine.imagePresent = false;
        if (!/@sha256:[a-f0-9]{64}$/i.test(configuration.image)) {
          blockers.push('The configured image is not installed. AtlasMind only auto-pulls digest-pinned images.');
        } else {
          warnings.push('The digest-pinned runner image is not installed and will be pulled after confirmation.');
        }
      }
    }

    if (!configuration.enabled) {
      blockers.unshift('Local CI is disabled in machine settings.');
    }
    if (engine.cliInstalled && !engine.available && !engine.desktopAvailable) {
      blockers.push('Start the Docker engine yourself; AtlasMind will not start or stop an unmanaged system service.');
    }

    const lifecycle = retainedLifecycle ?? (!configuration.enabled ? 'disabled' : blockers.length > 0 ? 'blocked' : 'ready');
    const arch = engine.arch ?? normalizeLocalCiArch(host.arch);
    this.update({
      lifecycle,
      enabled: configuration.enabled,
      host,
      engine: { ...engine, startedByAtlasMind: this.startedDesktop },
      gpu,
      resources,
      workflowFile: configuration.workflowFile,
      trustedBranch: configuration.trustedBranch,
      runnerLabel,
      image: configuration.image,
      shutdownPolicy: configuration.shutdownPolicy,
      evidenceLabel: `Linux container (${arch}); not native ${host.os} evidence`,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      message: lifecycle === 'ready'
        ? 'The local executor is ready for a queued trusted job.'
        : lifecycle === 'blocked' ? 'Resolve the safety blockers before starting a runner.'
          : lifecycle === 'disabled' ? 'Enable local CI in machine settings to use this executor.'
            : this.snapshot.message,
      ...(retainedLifecycle ? {} : { queuedRun: undefined, containerName: undefined }),
    });
    return this.getSnapshot();
  }

  async prepare(configuration: LocalCiRunnerConfiguration): Promise<LocalCiStartPlan> {
    if (!configuration.enabled) {
      throw new Error('Local CI is disabled in machine settings.');
    }
    const inspected = await this.inspect(configuration);
    if (inspected.blockers.length > 0) {
      throw new Error(inspected.blockers.join(' '));
    }
    if (!/^[A-Za-z0-9._-]+\.ya?ml$/i.test(configuration.workflowFile)) {
      throw new Error('The workflow setting must be one YAML filename inside .github/workflows.');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(configuration.trustedBranch)) {
      throw new Error('The trusted branch setting is invalid.');
    }

    const repoSlug = (await runGhOrThrow(this.workspaceRoot, [
      'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner',
    ])).trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoSlug)) {
      throw new Error('GitHub returned an invalid repository identity.');
    }
    const currentSha = (await execCommand('git', ['rev-parse', 'HEAD'], this.workspaceRoot)).toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(currentSha)) {
      throw new Error('The current Git commit could not be resolved.');
    }
    const currentBranch = (await execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], this.workspaceRoot)).trim();
    if (currentBranch !== configuration.trustedBranch) {
      throw new Error(`The current checkout is ${currentBranch || 'detached'}, not the trusted branch ${configuration.trustedBranch}.`);
    }

    const workflowRelative = path.posix.join('.github', 'workflows', configuration.workflowFile);
    const dirty = await execCommand('git', ['status', '--porcelain', '--', workflowRelative], this.workspaceRoot);
    if (dirty) {
      throw new Error('The trusted workflow has uncommitted changes. Commit and review it before lending this machine to GitHub.');
    }
    const workflowPath = path.join(this.workspaceRoot, '.github', 'workflows', configuration.workflowFile);
    const workflowText = await fs.readFile(workflowPath, 'utf8');
    const runnerLabel = resolveLocalCiRunnerLabel(configuration.runnerLabel, inspected.engine.arch ?? inspected.host.arch);
    const workflowAssessment = assessTrustedLocalCiWorkflow(workflowText, {
      repoSlug,
      branch: configuration.trustedBranch,
      runnerLabel,
    });
    if (!workflowAssessment.ok) {
      throw new Error(workflowAssessment.blockers.join(' '));
    }

    const workflowDir = path.dirname(workflowPath);
    const otherFiles = (await fs.readdir(workflowDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name) && entry.name !== configuration.workflowFile);
    for (const entry of otherFiles) {
      const other = await fs.readFile(path.join(workflowDir, entry.name), 'utf8').catch(() => '');
      if (other.includes(runnerLabel)) {
        throw new Error(`Runner label ${runnerLabel} also appears in ${entry.name}; a queued job there could claim this machine.`);
      }
    }

    const rawRuns = await runGhOrThrow(this.workspaceRoot, [
      'run', 'list', '--workflow', configuration.workflowFile,
      '--branch', configuration.trustedBranch, '--status', 'queued', '--limit', '100',
      '--json', 'databaseId,workflowName,displayTitle,event,headBranch,headSha,status,createdAt',
    ]);
    const parsedQueuedRuns = parseQueuedRuns(rawRuns);
    if (parsedQueuedRuns.length >= 100) {
      throw new Error('The trusted workflow queue is too large to prove that only one matching job exists. Cancel stale runs first.');
    }
    const queuedRuns = parsedQueuedRuns.filter(run => run.headSha.toLowerCase() === currentSha);
    if (queuedRuns.length !== 1) {
      throw new Error(queuedRuns.length === 0
        ? 'No matching queued run exists for the current commit. Push or manually queue the trusted workflow first.'
        : 'More than one matching run is queued for this commit. Cancel duplicates before starting the runner.');
    }
    const queuedRun = queuedRuns[0]!;
    if (queuedRun.event !== 'push' && queuedRun.event !== 'workflow_dispatch') {
      throw new Error(`Queued event ${queuedRun.event || 'unknown'} is not trusted by the local executor.`);
    }
    const actor = (await runGhOrThrow(this.workspaceRoot, [
      'api', `repos/${repoSlug}/actions/runs/${queuedRun.databaseId}`, '--jq', '.actor.login',
    ])).trim();
    if (actor.toLowerCase() !== repoSlug.split('/')[0]!.toLowerCase()) {
      throw new Error(`The queued run was triggered by ${actor || 'an unknown actor'}, not the repository owner.`);
    }

    const runnersRaw = await runGhOrThrow(this.workspaceRoot, [
      'api', `repos/${repoSlug}/actions/runners?per_page=100`, '--paginate', '--slurp',
    ]);
    if (registeredRunnerNames(runnersRaw, runnerLabel).length > 0) {
      throw new Error(`A runner with label ${runnerLabel} is already registered. Remove the stale or competing runner first.`);
    }
    this.update({ queuedRun, warnings: workflowAssessment.warnings, message: 'One trusted queued run passed the preflight checks.' });
    return {
      repoSlug,
      runnerLabel,
      image: configuration.image,
      workflowFile: configuration.workflowFile,
      trustedBranch: configuration.trustedBranch,
      currentSha,
      queuedRun,
      resources: inspected.resources,
      engineWillStart: !inspected.engine.available,
      imageMayBePulled: inspected.engine.imagePresent === false,
      shutdownPolicy: configuration.shutdownPolicy,
    };
  }

  async start(
    configuration: LocalCiRunnerConfiguration,
    authorize: (plan: LocalCiStartPlan) => Promise<boolean>,
  ): Promise<void> {
    if (this.operationRunning || this.runnerProcess) {
      throw new Error('A local runner operation is already in progress.');
    }
    this.operationRunning = true;
    try {
      const plan = await this.prepare(configuration);
      if (!await authorize(plan)) {
        this.update({ lifecycle: 'ready', message: 'The local runner start was cancelled.' });
        return;
      }
      this.update({ lifecycle: 'starting', message: 'Starting the isolated one-job runner…' });
      await this.ensureDockerEngine();
      const inspected = await this.inspect(configuration);
      if (!inspected.engine.available || inspected.engine.os !== 'linux' || inspected.resources.blockers.length > 0) {
        throw new Error('Docker capacity changed after startup and no longer meets the safe runner policy.');
      }
      const actualLabel = resolveLocalCiRunnerLabel(configuration.runnerLabel, inspected.engine.arch ?? inspected.host.arch);
      if (actualLabel !== plan.runnerLabel) {
        throw new Error(`Docker reports ${inspected.engine.arch}; the queued workflow expects ${plan.runnerLabel}, so AtlasMind will not mislabel the evidence.`);
      }
      const imageId = await this.ensureImage(configuration.image);
      const containerName = `atlasmind-ci-${plan.currentSha.slice(0, 12)}-${randomUUID().slice(0, 8)}`.toLowerCase();
      const runnerName = `atlasmind-${os.hostname().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 30)}-${plan.currentSha.slice(0, 8)}`;
      const resources = inspected.resources;
      const script = [
        'set -euo pipefail',
        'IFS= read -r TOKEN',
        './config.sh --url "$1" --token "$TOKEN" --ephemeral --unattended --no-default-labels --labels "$2" --name "$3"',
        'unset TOKEN',
        'exec ./run.sh',
      ].join('; ');
      const dockerArgs = [
        'run', '--rm', '--init', '--pull', 'never', '--interactive',
        '--name', containerName,
        '--label', LOCAL_CI_LABEL,
        '--label', `com.atlasmind.local-ci.run=${String(plan.queuedRun.databaseId)}`,
        '--cpus', String(resources.cpus),
        '--memory', `${resources.memoryGb}g`,
        '--memory-swap', `${resources.memoryGb}g`,
        '--pids-limit', String(resources.pidsLimit),
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges:true',
        '--entrypoint', '/bin/bash',
        imageId,
        '-lc', script, '_', `https://github.com/${plan.repoSlug}`, actualLabel, runnerName,
      ];
      const child = spawn('docker', dockerArgs, {
        cwd: this.workspaceRoot,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.runnerProcess = child;
      this.attachRunnerOutput(child, containerName, configuration);
      this.update({
        lifecycle: 'starting',
        containerName,
        resources,
        engine: { ...inspected.engine, resolvedImageId: imageId, imagePresent: true, startedByAtlasMind: this.startedDesktop },
        message: 'Registering an ephemeral runner without retaining its token…',
      });
      try {
        await pipeGhStdoutOrThrow(this.workspaceRoot, [
          'api', '--method', 'POST', `repos/${plan.repoSlug}/actions/runners/registration-token`, '--jq', '.token',
        ], child.stdin, { timeoutMs: 20_000 });
      } catch (error) {
        await this.removeOwnedContainer(containerName);
        throw error;
      }
      this.update({ lifecycle: 'waiting', message: 'The ephemeral runner is online and waiting to claim the queued job.' });
    } catch (error) {
      const detail = safeFailure(error);
      this.log(`[failed] ${detail}`);
      this.update({ lifecycle: 'failed', message: detail, blockers: [detail] });
      if (this.startedDesktop && !this.runnerProcess) {
        await this.applyShutdownPolicy(configuration.shutdownPolicy);
      }
      throw error;
    } finally {
      this.operationRunning = false;
    }
  }

  private async ensureDockerEngine(): Promise<void> {
    try {
      await execCommand('docker', ['info', '--format', '{{.OSType}}'], this.workspaceRoot);
      return;
    } catch {
      // Continue to the explicitly managed Docker Desktop path.
    }
    if (!this.snapshot.engine.desktopAvailable) {
      throw new Error('Docker is stopped and AtlasMind cannot safely start an unmanaged engine.');
    }
    this.log('[engine] Starting Docker Desktop.');
    await execCommand('docker', ['desktop', 'start'], this.workspaceRoot, 120_000, 256 * 1024);
    this.startedDesktop = true;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      try {
        await execCommand('docker', ['info', '--format', '{{.OSType}}'], this.workspaceRoot, 5_000);
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
    }
    this.startedDesktop = false;
    throw new Error('Docker Desktop started but its engine did not become ready within 45 seconds.');
  }

  private async ensureImage(image: string): Promise<string> {
    try {
      const installed = await execCommand('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], this.workspaceRoot);
      if (/^sha256:[a-f0-9]{64}$/i.test(installed)) {
        return installed;
      }
    } catch {
      // Pull below, but only for an immutable reference.
    }
    if (!/@sha256:[a-f0-9]{64}$/i.test(image)) {
      throw new Error('The configured image is not installed and is not digest-pinned, so AtlasMind will not pull it.');
    }
    this.log(`[image] Pulling pinned runner image ${image}.`);
    await execCommand('docker', ['pull', image], this.workspaceRoot, 300_000, 4 * 1024 * 1024);
    const resolved = await execCommand('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], this.workspaceRoot);
    if (!/^sha256:[a-f0-9]{64}$/i.test(resolved)) {
      throw new Error('Docker did not resolve the runner image to an immutable image id.');
    }
    return resolved;
  }

  private attachRunnerOutput(
    child: ChildProcessWithoutNullStreams,
    containerName: string,
    configuration: LocalCiRunnerConfiguration,
  ): void {
    const consume = (chunk: Buffer | string): void => {
      const display = redactSecrets(sanitizeTerminalOutput(String(chunk))).text;
      for (const rawLine of display.split('\n')) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        this.log(`[runner] ${line.slice(0, 1000)}`);
        if (/Running job:/i.test(line) && this.snapshot.lifecycle !== 'running') {
          this.update({ lifecycle: 'running', message: 'The queued CI job is running on this machine.', lastOutput: line.slice(0, 240) });
        } else if (/Listening for Jobs|Waiting for a job/i.test(line) && this.snapshot.lifecycle === 'starting') {
          this.update({ lifecycle: 'waiting', message: 'The ephemeral runner is online and waiting for the queued job.', lastOutput: line.slice(0, 240) });
        } else {
          this.snapshot = { ...this.snapshot, lastOutput: line.slice(0, 240), updatedAt: new Date().toISOString() };
        }
      }
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', error => {
      const detail = safeFailure(error);
      this.log(`[runner error] ${detail}`);
      this.update({ lifecycle: 'failed', message: detail, blockers: [detail] });
    });
    child.on('close', code => {
      this.runnerProcess = undefined;
      void this.finishRun(containerName, configuration, code);
    });
  }

  private async finishRun(containerName: string, configuration: LocalCiRunnerConfiguration, code: number | null): Promise<void> {
    this.log(`[runner] Container ${containerName} exited with code ${String(code)}.`);
    const cleanExit = code === 0;
    this.update({
      lifecycle: cleanExit ? 'finished' : 'failed',
      message: cleanExit
        ? 'The ephemeral runner finished and removed its registration. Refresh CI to read the job verdict.'
        : `The runner process exited with code ${String(code)}. Open the AtlasMind Local CI output for details.`,
      ...(cleanExit ? { blockers: [] } : { blockers: [`Runner process exited with code ${String(code)}.`] }),
    });
    await this.applyShutdownPolicy(configuration.shutdownPolicy);
  }

  private async applyShutdownPolicy(policy: LocalCiShutdownPolicy): Promise<void> {
    const shouldStop = policy === 'always' || (policy === 'ifStartedByAtlasMind' && this.startedDesktop);
    if (!shouldStop || !this.snapshot.engine.desktopAvailable) {
      return;
    }
    let otherContainers = 1;
    try {
      const rows = await execCommand('docker', ['ps', '--format', '{{json .}}'], this.workspaceRoot);
      otherContainers = rows.split(/\r?\n/).filter(line => line.trim() && !line.includes(LOCAL_CI_LABEL)).length;
    } catch {
      this.log('[engine] Docker container inventory could not be read; leaving Docker Desktop open.');
      return;
    }
    if (otherContainers > 0) {
      this.log(`[engine] Leaving Docker Desktop open because ${otherContainers} other container(s) are running.`);
      this.update({ warnings: [...new Set([...this.snapshot.warnings, `Docker Desktop stayed open because ${otherContainers} other container(s) are running.`])] });
      return;
    }
    try {
      this.log('[engine] Stopping Docker Desktop under the configured shutdown policy.');
      await execCommand('docker', ['desktop', 'stop'], this.workspaceRoot, 120_000, 256 * 1024);
      this.startedDesktop = false;
      this.update({ engine: { ...this.snapshot.engine, available: false, startedByAtlasMind: false }, message: `${this.snapshot.message} Docker Desktop was stopped.` });
    } catch (error) {
      this.log(`[engine] Docker Desktop was left open: ${safeFailure(error)}`);
    }
  }

  private async removeOwnedContainer(containerName: string): Promise<void> {
    if (!/^atlasmind-ci-[a-f0-9-]{10,60}$/.test(containerName)) {
      return;
    }
    try {
      await execCommand('docker', ['rm', '--force', containerName], this.workspaceRoot, 30_000, 256 * 1024);
    } catch {
      // It may already have exited under --rm.
    }
  }
}

export function parseQueuedRuns(raw: string): LocalCiQueuedRun[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((entry): LocalCiQueuedRun[] => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }
      const row = entry as QueuedRunShape;
      const databaseId = finitePositive(row.databaseId);
      const headSha = bounded(row.headSha, 40).toLowerCase();
      const status = bounded(row.status, 30).toLowerCase();
      if (!databaseId || !/^[a-f0-9]{40}$/.test(headSha) || status !== 'queued') {
        return [];
      }
      return [{
        databaseId: Math.floor(databaseId),
        workflowName: bounded(row.workflowName, 160),
        displayTitle: bounded(row.displayTitle, 240),
        event: bounded(row.event, 40),
        headBranch: bounded(row.headBranch, 160),
        headSha,
        createdAt: bounded(row.createdAt, 80),
      }];
    });
  } catch {
    return [];
  }
}

export function registeredRunnerNames(raw: string, runnerLabel: string): string[] {
  try {
    const value = JSON.parse(raw) as { runners?: unknown } | Array<{ runners?: unknown }>;
    const pages = Array.isArray(value) ? value : [value];
    const runners = pages.flatMap(page => Array.isArray(page?.runners) ? page.runners : []);
    if (runners.length === 0) {
      return [];
    }
    return runners.flatMap(entry => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }
      const runner = entry as { name?: unknown; labels?: unknown };
      const labels = Array.isArray(runner.labels)
        ? runner.labels.flatMap(label => label && typeof label === 'object' && typeof (label as { name?: unknown }).name === 'string'
          ? [(label as { name: string }).name]
          : [])
        : [];
      const name = bounded(runner.name, 160);
      return labels.includes(runnerLabel) && name ? [name] : [];
    });
  } catch {
    return [];
  }
}
