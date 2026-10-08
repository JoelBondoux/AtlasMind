/**
 * AtlasMind: Check Execution Sandbox — the thin half of `sandboxProbe`.
 *
 * Reads the five sandbox settings (and whether you opted in to relaxed
 * terminal approvals), takes one reading of the container engine
 * on request, keeps it in the in-memory cache, and opens the result as a
 * markdown document: every attestation rule with its result and reason, every
 * probe step, the exact canary argv, and what to do about the rule that
 * failed.
 *
 * Three properties live here rather than in the module.
 *
 * **The check only ever runs because somebody asked.** It never probes on
 * activation or on a timer. (Under `require`, the runner re-probes on its own
 * when a command needs a fresh reading — that is `sandboxRunner`'s rule, and
 * it writes the same cache this reads.)
 *
 * **It says what the mode makes of the result**, in the document and in the
 * notification: "Confirmed" under `off` means the sandbox *could* run your
 * commands and does not, and a person who reads it must not conclude they now
 * run in a container.
 *
 * **The folder the canary mounts is the default execution root** — the one
 * `runCommand` resolves against — so the check proves the folder commands
 * would actually run in can be mounted, rather than some other folder.
 */

import * as vscode from 'vscode';
import { isDryRunActive } from '../core/dryRunHost.js';
import {
  createSandboxEngineRunner,
  probeSandbox,
  readSandboxConfiguration,
  readSandboxHostFacts,
  readSandboxModeSetting,
  renderSandboxCheckReport,
  sharedSandboxProbeCache,
  type SandboxEngineRunner,
  type SandboxProbeCache,
  type SandboxProbeReport,
  type SandboxSettingInspection,
  type SandboxSettingKey,
} from '../core/sandboxProbe.js';
import type { SandboxAttestation, SandboxDependencyState, SandboxHostFacts } from '../core/sandboxPlan.js';
import { readRelaxTerminalApprovalsSetting } from '../core/sandboxApprovalRelaxation.js';
import {
  SANDBOX_DEPENDENCY_RECORDS_KEY,
  createSandboxDependencyReader,
  sanitizeSandboxDependencyRecords,
  type SandboxDependencyRecord,
} from '../core/sandboxDependencies.js';
import { createSandboxProcessRunner } from '../core/sandboxRunner.js';
import { defaultWorkspaceRootPath } from '../utils/workspaceRoots.js';

export interface SandboxCheckDeps {
  runner: SandboxEngineRunner;
  cache: SandboxProbeCache;
  host: SandboxHostFacts;
  /** The folder the canary mounts. */
  canaryRoot: () => string | undefined;
  now: () => Date;
  dryRun: () => boolean;
  /** The preparations this machine recorded (the editor's global state). */
  records: () => readonly SandboxDependencyRecord[];
  /** Whether a dependency volume is ready for a folder — the reader the runner uses. */
  dependencies?: (root: string, attestation: SandboxAttestation) => Promise<SandboxDependencyState>;
}

function defaultDeps(): SandboxCheckDeps {
  return {
    records: () => [],
    runner: createSandboxEngineRunner(),
    cache: sharedSandboxProbeCache(),
    host: readSandboxHostFacts(),
    canaryRoot: () => defaultWorkspaceRootPath(),
    now: () => new Date(),
    dryRun: () => isDryRunActive(),
  };
}

/** One sandbox setting's per-scope values. The runner reads the settings through this too, so the two cannot disagree. */
export function inspectSandboxSetting(key: SandboxSettingKey): SandboxSettingInspection | undefined {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  // Literal keys, so the settings-integrity check can see each one is read.
  switch (key) {
    case 'mode': return configuration.inspect('sandbox.mode');
    case 'engine': return configuration.inspect('sandbox.engine');
    case 'image': return configuration.inspect('sandbox.image');
    case 'cpus': return configuration.inspect('sandbox.cpus');
    case 'memoryGb': return configuration.inspect('sandbox.memoryGb');
    default: return undefined;
  }
}

/**
 * `atlasmind.sandbox.relaxTerminalApprovals`, per scope. Read separately from
 * the five above because it is not part of what the probe needs; only its user
 * value counts (`readRelaxTerminalApprovalsSetting`).
 */
export function inspectSandboxRelaxSetting(): SandboxSettingInspection | undefined {
  return vscode.workspace.getConfiguration('atlasmind').inspect('sandbox.relaxTerminalApprovals');
}

/** Run the check, start to finish. Returns the rendered report so a test can read what was shown. */
export async function checkExecutionSandbox(
  overrides: Partial<SandboxCheckDeps> = {},
  store?: { get(key: string): unknown },
): Promise<string> {
  const deps: SandboxCheckDeps = {
    ...defaultDeps(),
    ...(store ? { records: () => sanitizeSandboxDependencyRecords(store.get(SANDBOX_DEPENDENCY_RECORDS_KEY)) } : {}),
    ...overrides,
  };
  const reading = readSandboxConfiguration(inspectSandboxSetting);
  const mode = readSandboxModeSetting(inspectSandboxSetting('mode'));
  let report: SandboxProbeReport | undefined;
  if (reading.configuration) {
    const configuration = reading.configuration;
    report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'AtlasMind: checking the execution sandbox…' },
      () => probeSandbox({
        configuration,
        host: deps.host,
        canaryRoot: deps.canaryRoot(),
        runner: deps.runner,
        now: deps.now,
      }),
    );
    deps.cache.record(report);
  }
  const now = deps.now();
  // The cache is what a later runner reads, so the check reports through it.
  const attestation = reading.configuration
    ? deps.cache.attestation(reading.configuration, now)
    : {
      status: 'unavailable' as const,
      rule: 'probed' as const,
      reason: 'The sandbox settings could not be used, so nothing was probed.',
    };
  // The same reader the runner uses, so the report and the next command agree
  // about whether dependencies are ready for this folder's lockfile.
  const canaryRoot = deps.canaryRoot();
  let dependencyState: SandboxDependencyState | undefined;
  if (reading.configuration && canaryRoot) {
    const readDependencies = deps.dependencies ?? createSandboxDependencyReader({
      host: deps.host,
      records: deps.records,
      run: createSandboxProcessRunner(),
    });
    dependencyState = await readDependencies(canaryRoot, attestation).catch(() => undefined);
  }
  const markdown = renderSandboxCheckReport({
    reading,
    ...(report ? { report } : {}),
    attestation,
    hostOs: deps.host.os,
    dryRun: deps.dryRun(),
    now,
    mode,
    dependencies: { ...(dependencyState ? { state: dependencyState } : {}), records: deps.records() },
    relaxation: {
      setting: readRelaxTerminalApprovalsSetting(inspectSandboxRelaxSetting()),
      allowTerminalWrite: vscode.workspace.getConfiguration('atlasmind').get<boolean>('allowTerminalWrite', false) === true,
    },
  });

  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
  await vscode.window.showTextDocument(document, { preview: true });
  if (attestation.status === 'confirmed') {
    void vscode.window.showInformationMessage(
      mode === 'require'
        ? `AtlasMind sandbox: confirmed (${attestation.engine}). The mode is require — agent commands run in it or are refused.`
        : `AtlasMind sandbox: confirmed (${attestation.engine}), but the mode is off — agent commands still run on your machine. Set atlasmind.sandbox.mode to require to use it.`,
    );
  } else {
    void vscode.window.showWarningMessage(
      `AtlasMind sandbox: unavailable — ${attestation.reason} The report lists every rule and what to do.`,
    );
  }
  return markdown;
}
