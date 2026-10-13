/**
 * AtlasMind: Prepare Sandbox Dependencies, and AtlasMind: Remove Sandbox
 * Dependency Volumes — the thin halves of `sandboxDependencies`.
 *
 * Preparing is the one network-on step the execution sandbox has, so this
 * command is mostly about what it shows before anything starts:
 *
 * - **Only because somebody asked, and only in a trusted workspace.** Nothing
 *   prepares dependencies on activation, on a timer, or for a scheduled
 *   routine; a repository you have not trusted does not get to choose what is
 *   downloaded, even by asking.
 * - **Every engine command and what network access means, first.** The modal
 *   shows the plan's own disclosure and every argv, `network` marked, exactly
 *   as `planSandboxDependencyPreparation` composed them — not a summary beside
 *   them.
 * - **Install scripts are a second, separate confirmation.** The default runs
 *   with `--ignore-scripts`; the variant that runs them is its own button and
 *   its own warning, never the default action.
 * - **Dry run holds it**, before the first engine command.
 *
 * Removing volumes lists what the engine holds under AtlasMind's label beside
 * what this machine recorded, removes only what you pick, without `--force`
 * — a volume a running command still uses stays — and only after a modal.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { guardHostCommand } from '../core/dryRunHost.js';
import { isDryRunBlockedError } from '../core/dryRun.js';
import {
  SANDBOX_DEPENDENCY_LIST_ARGV,
  SANDBOX_DEPENDENCY_RECORDS_KEY,
  createSandboxDependencyReader,
  detectSandboxDependencies,
  forgetSandboxDependencyVolumes,
  parseSandboxDependencyVolumeList,
  planSandboxDependencyPreparation,
  readSandboxDependencyFile,
  readSandboxDependencyFiles,
  recordSandboxDependencyVolume,
  runSandboxDependencyPreparation,
  sandboxDependencyRemoveArgv,
  sanitizeSandboxDependencyRecords,
  type SandboxDependencyDetection,
  type SandboxDependencyPreparePlan,
  type SandboxDependencyRecord,
} from '../core/sandboxDependencies.js';
import {
  SANDBOX_ENGINE_ORDER,
  createSandboxEngineRunner,
  probeSandbox,
  readSandboxConfiguration,
  readSandboxHostFacts,
  sharedSandboxProbeCache,
  type SandboxProbeCache,
  type SandboxProbeReport,
} from '../core/sandboxProbe.js';
import { createSandboxProcessRunner, type SandboxProcessRunner } from '../core/sandboxRunner.js';
import type { SandboxAttestation, SandboxConfiguration, SandboxEngine, SandboxHostFacts } from '../core/sandboxPlan.js';
import { inspectSandboxSetting } from './sandboxCheckCommand.js';
import { defaultWorkspaceRootPath } from '../utils/workspaceRoots.js';

/** The editor's global state, as far as these commands use it. */
export interface SandboxDependencyStore {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SandboxDependencyCommandDeps {
  run: SandboxProcessRunner;
  cache: SandboxProbeCache;
  host: SandboxHostFacts;
  /** The folder whose dependencies are prepared: the default execution root, where agent commands run. */
  root: () => string | undefined;
  realpath: (target: string) => Promise<string>;
  probe: (configuration: SandboxConfiguration, canaryRoot: string) => Promise<SandboxProbeReport>;
  detect: (root: string) => Promise<SandboxDependencyDetection>;
  isTrusted: () => boolean;
  now: () => Date;
  runId: () => string;
}

function defaultDeps(): SandboxDependencyCommandDeps {
  const host = readSandboxHostFacts();
  return {
    run: createSandboxProcessRunner(),
    cache: sharedSandboxProbeCache(),
    host,
    root: () => defaultWorkspaceRootPath(),
    realpath: target => fs.realpath(target),
    probe: (configuration, canaryRoot) => probeSandbox({
      configuration,
      host,
      canaryRoot,
      runner: createSandboxEngineRunner(),
      now: () => new Date(),
    }),
    detect: async root => detectSandboxDependencies(await readSandboxDependencyFiles(root, readSandboxDependencyFile)),
    isTrusted: () => vscode.workspace.isTrusted,
    now: () => new Date(),
    runId: () => randomBytes(6).toString('hex'),
  };
}

function notify(level: 'info' | 'warning' | 'error', message: string): void {
  const text = `AtlasMind sandbox dependencies: ${message}`;
  if (level === 'error') {
    void vscode.window.showErrorMessage(text);
  } else if (level === 'warning') {
    void vscode.window.showWarningMessage(text);
  } else {
    void vscode.window.showInformationMessage(text);
  }
}

function readRecords(store: SandboxDependencyStore): SandboxDependencyRecord[] {
  return sanitizeSandboxDependencyRecords(store.get(SANDBOX_DEPENDENCY_RECORDS_KEY));
}

/** The plan as the modal shows it: the disclosure, then every command, in order, with network marked. */
export function describeSandboxDependencyPlan(plan: Extract<SandboxDependencyPreparePlan, { ok: true }>): string {
  return [
    ...plan.disclosure,
    '',
    'It runs exactly these, in order, with no shell:',
    ...plan.steps.map((step, index) =>
      `${index + 1}. ${step.network ? '[NETWORK] ' : ''}${step.purpose}\n   ${[plan.engine, ...step.argv].join(' ')}`),
    '',
    `If the install fails, ${plan.volume} is removed, so a half-prepared volume is never used.`,
  ].join('\n');
}

/** A confirmed attestation for the settings now, probing once (with progress) when there is none. */
async function confirmedAttestation(
  deps: SandboxDependencyCommandDeps,
  configuration: SandboxConfiguration,
  root: string,
): Promise<SandboxAttestation> {
  let attestation = deps.cache.attestation(configuration, deps.now());
  if (attestation.status !== 'confirmed') {
    const report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'AtlasMind: checking the execution sandbox…' },
      () => deps.probe(configuration, root),
    );
    deps.cache.record(report);
    attestation = deps.cache.attestation(configuration, deps.now());
  }
  return attestation;
}

/** Run the prepare command, start to finish. Returns what it told the person, so a test can read it. */
export async function prepareSandboxDependencies(
  store: SandboxDependencyStore,
  overrides: Partial<SandboxDependencyCommandDeps> = {},
): Promise<string> {
  const deps = { ...defaultDeps(), ...overrides };
  const say = async (level: 'info' | 'warning' | 'error', message: string): Promise<string> => {
    notify(level, message);
    return message;
  };

  if (!deps.isTrusted()) {
    return say('warning', 'not prepared — this workspace is not trusted, and an untrusted repository does not choose what is downloaded.');
  }
  const reading = readSandboxConfiguration(inspectSandboxSetting);
  if (!reading.configuration) {
    return say('error', `the sandbox settings cannot be used: ${reading.problems.join(' ')}`);
  }
  const configuration = reading.configuration;
  const folder = deps.root();
  if (!folder) {
    return say('warning', 'no folder is open.');
  }
  let root: string;
  try {
    root = await deps.realpath(folder);
  } catch {
    return say('error', 'the folder could not be resolved.');
  }

  const attestation = await confirmedAttestation(deps, configuration, root);
  if (attestation.status !== 'confirmed') {
    return say('warning', `the sandbox is unavailable (${attestation.rule}): ${attestation.reason} Run AtlasMind: Check Execution Sandbox for every rule.`);
  }
  const detection = await deps.detect(root);
  if (detection.status !== 'found') {
    return say('warning', detection.status === 'not-a-node-project' ? `nothing to prepare. ${detection.reason}` : `not prepared — ${detection.reason}`);
  }

  const reader = createSandboxDependencyReader({
    host: deps.host,
    records: () => readRecords(store),
    run: deps.run,
    detect: async () => detection,
  });
  const current = await reader(root, attestation);
  if (current.status === 'ready') {
    const again = await vscode.window.showInformationMessage(
      `Dependencies for this ${current.lockfile} are already prepared in ${current.volume} (${current.preparedAt}).`,
      { modal: true, detail: 'Preparing again removes that volume and installs into a fresh one, with network access.' },
      'Prepare Again',
    );
    if (again !== 'Prepare Again') {
      return 'Already prepared; left as it is.';
    }
  }

  const runId = deps.runId();
  const plan = (installScripts: boolean) => planSandboxDependencyPreparation({
    detection,
    attestation,
    configuration,
    host: deps.host,
    root,
    installScripts,
    runId,
    now: deps.now(),
  });
  let chosen = plan(false);
  if (!chosen.ok) {
    return say('error', `not prepared — ${chosen.reason} [rule: ${chosen.rule}]`);
  }
  const answer = await vscode.window.showWarningMessage(
    `Prepare sandbox dependencies for ${chosen.lockfile} with ${chosen.manager}? This starts a container with network access.`,
    { modal: true, detail: describeSandboxDependencyPlan(chosen) },
    'Prepare',
    'Prepare With Install Scripts…',
  );
  if (answer === 'Prepare With Install Scripts…') {
    const withScripts = plan(true);
    if (!withScripts.ok) {
      return say('error', `not prepared — ${withScripts.reason} [rule: ${withScripts.rule}]`);
    }
    const confirmScripts = await vscode.window.showWarningMessage(
      'Run every package\'s install scripts, with network access?',
      {
        modal: true,
        detail: 'Install scripts are arbitrary code from every package in the lockfile — not only the ones you chose — and they run with '
          + 'network access. They see only package.json and the lockfile, but what they leave in the volume runs whenever a sandboxed '
          + `command loads those packages. Only do this for packages that need to build native code.\n\n${describeSandboxDependencyPlan(withScripts)}`,
      },
      'Run Install Scripts',
    );
    if (confirmScripts !== 'Run Install Scripts') {
      return 'Not prepared: install scripts were not confirmed.';
    }
    chosen = withScripts;
  } else if (answer !== 'Prepare') {
    return 'Not prepared: cancelled.';
  }

  const approved = chosen;
  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `AtlasMind: preparing sandbox dependencies (${approved.manager})…` },
    () => runSandboxDependencyPreparation(approved, { run: deps.run, now: deps.now }),
  );
  if (outcome.status === 'dry-run') {
    return say('info', `not prepared — ${outcome.detail}`);
  }
  if (outcome.status === 'failed') {
    return say('error', `the "${outcome.failedStep}" step failed: ${outcome.detail}`);
  }
  await store.update(SANDBOX_DEPENDENCY_RECORDS_KEY, recordSandboxDependencyVolume(readRecords(store), outcome.record));
  return say(
    'info',
    `prepared in ${outcome.record.volume}. Under atlasmind.sandbox.mode require, commands that load installed packages now run with them; `
      + `a change to ${outcome.record.lockfile} needs preparing again.`,
  );
}

interface ListedVolume {
  engine: SandboxEngine;
  volume: string;
}

async function listVolumes(deps: SandboxDependencyCommandDeps, engines: readonly SandboxEngine[]): Promise<{ volumes: ListedVolume[]; answered: SandboxEngine[] }> {
  const volumes: ListedVolume[] = [];
  const answered: SandboxEngine[] = [];
  for (const engine of engines) {
    guardHostCommand('sandbox-dependencies', engine, SANDBOX_DEPENDENCY_LIST_ARGV, { userInitiated: true });
    let outcome;
    try {
      outcome = await deps.run(engine, SANDBOX_DEPENDENCY_LIST_ARGV, { timeoutMs: 20_000 });
    } catch {
      continue;
    }
    if (outcome?.kind === 'exited' && outcome.exitCode === 0) {
      answered.push(engine);
      volumes.push(...parseSandboxDependencyVolumeList(outcome.stdout).map(volume => ({ engine, volume })));
    }
  }
  return { volumes, answered };
}

/** Run the clean-up command. Returns what it told the person. */
export async function removeSandboxDependencyVolumes(
  store: SandboxDependencyStore,
  overrides: Partial<SandboxDependencyCommandDeps> = {},
): Promise<string> {
  const deps = { ...defaultDeps(), ...overrides };
  const reading = readSandboxConfiguration(inspectSandboxSetting);
  const engine = reading.configuration?.engine;
  const engines: SandboxEngine[] = engine === 'docker' || engine === 'podman' ? [engine] : [...SANDBOX_ENGINE_ORDER];
  const { volumes, answered } = await listVolumes(deps, engines);
  if (answered.length === 0) {
    void vscode.window.showWarningMessage('AtlasMind sandbox dependencies: no container engine answered, so nothing could be listed.');
    return 'No engine answered.';
  }
  if (volumes.length === 0) {
    void vscode.window.showInformationMessage('AtlasMind sandbox dependencies: there are no AtlasMind dependency volumes to remove.');
    return 'Nothing to remove.';
  }
  const records = readRecords(store);
  const picked = await vscode.window.showQuickPick(
    volumes.map(entry => {
      const record = records.find(candidate => candidate.volume === entry.volume);
      return {
        label: entry.volume,
        description: record
          ? `${record.manager} · ${record.lockfile} · prepared ${record.preparedAt.slice(0, 10)}${record.installScripts ? ' · install scripts ran' : ''}`
          : `${entry.engine} · not recorded on this machine`,
        detail: record ? record.root : 'Labelled as an AtlasMind dependency volume, but no preparation on this machine recorded it.',
        entry,
      };
    }),
    { canPickMany: true, title: 'Remove sandbox dependency volumes', placeHolder: 'Choose the volumes to remove' },
  );
  if (!picked || picked.length === 0) {
    return 'Nothing removed.';
  }
  const confirm = await vscode.window.showWarningMessage(
    `Remove ${picked.length} sandbox dependency volume(s)?`,
    {
      modal: true,
      detail: `${picked.map(item => item.label).join('\n')}\n\nRemoval is permanent. A volume a running command still uses is left in place. `
        + 'A command that needs one is refused until you prepare dependencies again.',
    },
    'Remove',
  );
  if (confirm !== 'Remove') {
    return 'Nothing removed.';
  }
  const removed: string[] = [];
  const failures: string[] = [];
  for (const group of engines) {
    const names = picked.filter(item => item.entry.engine === group).map(item => item.entry.volume);
    const argv = names.length > 0 ? sandboxDependencyRemoveArgv(names) : undefined;
    if (!argv) {
      continue;
    }
    try {
      guardHostCommand('sandbox-dependencies', group, argv, { userInitiated: true });
    } catch (error) {
      if (isDryRunBlockedError(error)) {
        void vscode.window.showInformationMessage(`AtlasMind sandbox dependencies: not removed — ${error.message}`);
        return 'Dry run: nothing removed.';
      }
      throw error;
    }
    const outcome = await deps.run(group, argv, { timeoutMs: 60_000 }).catch(() => undefined);
    // What is gone is read back from the engine, not assumed from the exit code.
    const after = await listVolumes(deps, [group]);
    const still = new Set(after.volumes.map(entry => entry.volume));
    for (const name of names) {
      (still.has(name) ? failures : removed).push(name);
    }
    if (outcome?.kind === 'exited' && outcome.exitCode !== 0 && failures.length > 0) {
      failures.push(`(${group}: ${outcome.stderr.split(/\r?\n/)[0]?.slice(0, 200) ?? 'it refused'})`);
    }
  }
  await store.update(SANDBOX_DEPENDENCY_RECORDS_KEY, forgetSandboxDependencyVolumes(records, removed));
  const message = `removed ${removed.length} volume(s).${failures.length > 0 ? ` Not removed (in use, or the engine refused): ${failures.join(' ')}` : ''}`;
  notify(failures.length > 0 ? 'warning' : 'info', message);
  return message;
}
