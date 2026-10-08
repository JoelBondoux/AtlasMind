/**
 * AtlasMind: Check Execution Sandbox — the thin half of `sandboxProbe`.
 *
 * Reads the five sandbox settings, takes one reading of the container engine
 * on request, keeps it in the in-memory cache, and opens the result as a
 * markdown document: every attestation rule with its result and reason, every
 * probe step, the exact canary argv, and what to do about the rule that
 * failed.
 *
 * Three properties live here rather than in the module.
 *
 * **It only ever runs because somebody asked.** Nothing probes on activation
 * or on a timer: the probe starts processes and, past the reads, a container.
 *
 * **It says the sandbox is not enforced yet**, in the document and in the
 * notification, because a person who reads "Confirmed" in this version must
 * not conclude their agent's commands now run in a container. They do not.
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
  renderSandboxCheckReport,
  sharedSandboxProbeCache,
  type SandboxEngineRunner,
  type SandboxProbeCache,
  type SandboxProbeReport,
  type SandboxSettingInspection,
  type SandboxSettingKey,
} from '../core/sandboxProbe.js';
import type { SandboxHostFacts } from '../core/sandboxPlan.js';
import { defaultWorkspaceRootPath } from '../utils/workspaceRoots.js';

export interface SandboxCheckDeps {
  runner: SandboxEngineRunner;
  cache: SandboxProbeCache;
  host: SandboxHostFacts;
  /** The folder the canary mounts. */
  canaryRoot: () => string | undefined;
  now: () => Date;
  dryRun: () => boolean;
}

function defaultDeps(): SandboxCheckDeps {
  return {
    runner: createSandboxEngineRunner(),
    cache: sharedSandboxProbeCache(),
    host: readSandboxHostFacts(),
    canaryRoot: () => defaultWorkspaceRootPath(),
    now: () => new Date(),
    dryRun: () => isDryRunActive(),
  };
}

function inspectSandboxSetting(key: SandboxSettingKey): SandboxSettingInspection | undefined {
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

/** Run the check, start to finish. Returns the rendered report so a test can read what was shown. */
export async function checkExecutionSandbox(overrides: Partial<SandboxCheckDeps> = {}): Promise<string> {
  const deps = { ...defaultDeps(), ...overrides };
  const reading = readSandboxConfiguration(inspectSandboxSetting);
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
  const markdown = renderSandboxCheckReport({
    reading,
    ...(report ? { report } : {}),
    attestation,
    hostOs: deps.host.os,
    dryRun: deps.dryRun(),
    now,
  });

  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
  await vscode.window.showTextDocument(document, { preview: true });
  if (attestation.status === 'confirmed') {
    void vscode.window.showInformationMessage(
      `AtlasMind sandbox: confirmed (${attestation.engine}). Not enforced yet — agent commands still run on your machine in this version.`,
    );
  } else {
    void vscode.window.showWarningMessage(
      `AtlasMind sandbox: unavailable — ${attestation.reason} The report lists every rule and what to do.`,
    );
  }
  return markdown;
}
