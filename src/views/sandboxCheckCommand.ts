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

/** Run the check, start to finish. Returns the rendered report so a test can read what was shown. */
export async function checkExecutionSandbox(overrides: Partial<SandboxCheckDeps> = {}): Promise<string> {
  const deps = { ...defaultDeps(), ...overrides };
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
  const markdown = renderSandboxCheckReport({
    reading,
    ...(report ? { report } : {}),
    attestation,
    hostOs: deps.host.os,
    dryRun: deps.dryRun(),
    now,
    mode,
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
