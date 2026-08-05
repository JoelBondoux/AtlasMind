/**
 * The command that runs a live probe, and the gate the operator actually sees.
 *
 * Everything that *decides* lives in `lensProbePolicy`; everything that
 * *performs* lives in `lensLiveTransport`. This file is the join, and its job is
 * to make sure the decision is presented honestly before anything is sent.
 *
 * Four decisions live here rather than in the pure core, because they are about
 * what a person is shown:
 *
 * **The endpoint list is read from the file every time.** Not cached, not held
 * in a panel's state. Somebody who edits `.atlasmind/lens-endpoints.json` to
 * remove a production entry has removed it, and a probe running from a stale
 * list would be reaching a destination that is no longer declared.
 *
 * **The confirmation names the destination in full.** The modal shows the label,
 * the stage, and the host — not a generic "probe this endpoint?" — because the
 * whole point of a type-to-confirm is that the operator reads what they are
 * confirming. The host is shown separately from the label so a mislabelled entry
 * cannot disguise where the request goes.
 *
 * **The secret is resolved through SecretStorage and never displayed.** The
 * resolver is passed as a closure to the runner, which calls it only after
 * authorization has passed, and nothing on this path logs or renders a value.
 *
 * **A refusal is shown, never swallowed.** Every outcome — including "you did
 * not confirm" — surfaces, because a button that sometimes silently does
 * nothing is one people stop trusting.
 */

import * as vscode from 'vscode';

import {
  extractJsonContractSources,
  extractSqlContractSources,
  extractTypeScriptContractSources,
} from '../core/lensContractSources.js';
import { LENS_DATA_TRUST_FILE, normalizeLensDataTrustPolicyFile } from '../core/lensDataTrust.js';
import {
  findLensEndpoint,
  isProtectedLensEndpoint,
  LENS_ENDPOINT_FILE,
  normalizeLensEndpointFile,
} from '../core/lensEndpoints.js';
import { describeConnection, summarizeConnectionString } from '../core/lensCredentials.js';
import { dialectOfKind, isDirectSqlKind, type LensProbeSettings } from '../core/lensProbePolicy.js';
import { analyzeLensProbeRun, runLensProbe, type LensProbeRun } from '../core/lensProbeRunner.js';
import { analyzeLensReachability } from '../core/lensReachability.js';
import type {
  LensContract,
  LensDataTrustPolicyFile,
  LensEndpointDeclaration,
  LensEndpointFile,
  LensProbeResult,
} from '../types.js';
import { performDirectSqlProbe, performSqlHttpProbe } from './lensDatabaseTransport.js';
import { showMissingLensDeclarationGuidance } from './lensDeclarationSetup.js';
import { LensLivePanel } from './lensLivePanel.js';
import { performHttpProbe, performMcpProbe } from './lensLiveTransport.js';

const MAX_SOURCE_FILES = 200;
const MAX_DISCOVERED_CONTRACTS = 200;
const SOURCE_GLOB = '**/*.{json,sql,ts,tsx}';
const SOURCE_EXCLUDE = '**/{node_modules,.git,out,dist,build,coverage,vendor,.next}/**';

/**
 * Results for this session only.
 *
 * Deliberately in memory. A probe result is an observation about a moment, and
 * `project_memory/` is git-tracked — writing "the staging database answered at
 * 14:02" into a committed file would put one developer's environment into
 * everybody's repository. (`buzzConversation` keeps the same rule for the same
 * reason.)
 */
const sessionResults = new Map<string, LensProbeResult>();

export interface LensLiveCommandContext {
  /** Resolves a SecretStorage key. Injected so this file holds no secret store. */
  readonly resolveSecret: (key: string) => Promise<string | undefined>;
  /** Skill ids of connected MCP tools, in `mcp:<server>:<tool>` form. */
  readonly listMcpToolIds: () => readonly string[];
  /** Invokes one connected MCP tool by skill id. */
  readonly invokeMcpTool: (skillId: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface EndpointPick extends vscode.QuickPickItem {
  endpoint: LensEndpointDeclaration;
}

/** Read the live-probe settings once, in one place. */
export function readLensProbeSettings(context: LensLiveCommandContext): LensProbeSettings {
  const config = vscode.workspace.getConfiguration('atlasmind.lens.live');
  return {
    enabled: config.get<boolean>('enabled', false),
    allowedStages: config.get<string[]>('allowedStages', ['local', 'development', 'staging']),
    fetchAvailable: typeof fetch === 'function',
    mcpToolIds: context.listMcpToolIds(),
    // The desktop extension host runs under Node and can open a socket; the web
    // one cannot. `process.versions.node` is the honest test — checking for the
    // driver module would load it at settings-read time, which is exactly the
    // activation cost lazy loading exists to avoid.
    directDriversAvailable: typeof process !== 'undefined' && Boolean(process.versions?.node),
  };
}

/**
 * How many endpoints are declared and how many have been probed this session.
 *
 * Returns `undefined` when the state could not be read at all, so the dashboard
 * reports the live lenses as *unassessed* rather than as cleanly disabled. The
 * distinction matters: "we looked and probing is off" and "we could not look"
 * produce the same zeros, and only one of them has earned a quiet card.
 */
export async function readLiveLensState(): Promise<{
  enabled: boolean;
  declaredEndpoints: number;
  probedEndpoints: number;
} | undefined> {
  try {
    const config = vscode.workspace.getConfiguration('atlasmind.lens.live');
    const folder = vscode.workspace.workspaceFolders?.[0];
    const file = folder ? await readEndpointFile(folder, { quiet: true }) : undefined;
    return {
      enabled: config.get<boolean>('enabled', false),
      declaredEndpoints: file?.endpoints.length ?? 0,
      probedEndpoints: [...sessionResults.values()].filter(result => result.outcome === 'reached').length,
    };
  } catch {
    return undefined;
  }
}

/** Probe one declared service and open the result. */
export async function probeLiveEndpoints(context: LensLiveCommandContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    void vscode.window.showInformationMessage('Open a workspace before probing live services with AtlasMind Lens.');
    return;
  }
  const folder = folders[0]!;

  const settings = readLensProbeSettings(context);
  if (!settings.enabled) {
    const choice = await vscode.window.showInformationMessage(
      'Live probing is off. The live lenses reach a service you declare, so they are off by default.',
      'Open settings',
    );
    if (choice === 'Open settings') {
      await openLiveSettings();
    }
    return;
  }

  const file = await readEndpointFile(folder, { quiet: false });
  if (!file) {
    return;
  }
  if (file.endpoints.length === 0) {
    await showMissingLensDeclarationGuidance('endpoints', folder);
    return;
  }

  const picked = await vscode.window.showQuickPick<EndpointPick>(
    file.endpoints.map(endpoint => ({
      label: endpoint.label,
      description: `${endpoint.kind} · ${endpoint.stage}${isProtectedLensEndpoint(endpoint) ? ' · protected' : ''}`,
      detail: describeDestination(endpoint),
      endpoint,
    })),
    {
      title: 'AtlasMind Lens — probe a declared service',
      placeHolder: 'AtlasMind reads the schema only: never a row, never a value, and it never writes.',
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!picked) {
    return;
  }
  const endpoint = findLensEndpoint(file, picked.endpoint.id);
  if (!endpoint) {
    return;
  }

  // The gate. Asked before anything is sent, and the runner refuses again
  // independently — this is the operator-facing half, not the enforcement.
  let typedConfirmation: string | undefined;
  if (isProtectedLensEndpoint(endpoint)) {
    const destination = isDirectSqlKind(endpoint.kind) || endpoint.kind === 'sql-http'
      ? await describeDatabaseDestination(endpoint, context)
      : describeDestination(endpoint);
    const typed = await vscode.window.showInputBox({
      title: `Probe ${endpoint.label}?`,
      prompt: endpoint.stage === 'unknown'
        ? `This endpoint does not state its stage, so it is treated as production. It points at ${destination}. Type the endpoint's label exactly to confirm.`
        : `This is a production endpoint at ${destination}. Type the endpoint's label exactly to confirm.`,
      placeHolder: endpoint.label,
      ignoreFocusOut: true,
      validateInput: value => value === endpoint.label
        ? undefined
        : `Type "${endpoint.label}" exactly to confirm this probe.`,
    });
    if (typed === undefined) {
      void vscode.window.showInformationMessage('Nothing was sent. The probe was not confirmed.');
      return;
    }
    typedConfirmation = typed;
  }

  const run = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `AtlasMind Lens: reading the schema ${endpoint.label} serves`,
      cancellable: false,
    },
    async () => runLensProbe({
      endpoint,
      settings,
      transport: request => {
        const observedAt = new Date().toISOString();
        if (request.kind === 'postgres' || request.kind === 'mysql') {
          return performDirectSqlProbe(request, endpoint.id, observedAt);
        }
        if (request.kind === 'sql-http') {
          return performSqlHttpProbe(request, endpoint.id, observedAt);
        }
        return request.kind === 'database'
          ? performMcpProbe(request, context.invokeMcpTool)
          : performHttpProbe(request);
      },
      resolveSecret: context.resolveSecret,
      ...(typedConfirmation !== undefined ? { typedConfirmation } : {}),
      probedThisRun: 0,
      now: () => new Date(),
    }),
  );

  sessionResults.set(endpoint.id, run.result);

  if (run.result.outcome !== 'reached') {
    // Shown, never swallowed. A button that sometimes silently does nothing is
    // one people stop trusting.
    void vscode.window.showWarningMessage(`${endpoint.label}: ${run.result.reason}`);
  }

  await openLiveResult(folder, file, endpoint, run);
}

async function openLiveResult(
  folder: vscode.WorkspaceFolder,
  file: LensEndpointFile,
  endpoint: LensEndpointDeclaration,
  run: LensProbeRun,
): Promise<void> {
  const contracts = await discoverContracts();
  const expected = endpoint.expectedContractIds.length > 0
    ? contracts.filter(contract => endpoint.expectedContractIds.includes(contract.id))
    // With nothing declared, compare against every contract found. Comparing
    // against none would report a successful probe as having nothing to say.
    : contracts;
  const trustPolicy = await readTrustPolicy(folder);

  const analysis = analyzeLensProbeRun({
    run,
    endpoint,
    declaredContracts: expected,
    ...(trustPolicy ? { trustPolicy } : {}),
  });

  const reachability = analyzeLensReachability({
    endpoints: file.endpoints,
    results: sessionResults,
    knownContractIds: contracts.map(contract => contract.id),
  });

  LensLivePanel.createOrShow({
    workspace: { name: folder.name, index: folder.index },
    endpoint,
    result: run.result,
    analysis,
    reachability,
    trustPolicyPresent: trustPolicy !== undefined,
    ...(run.health ? { health: run.health } : {}),
  });
}

export async function openLiveSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'atlasmind.lens.live');
}

async function readEndpointFile(
  folder: vscode.WorkspaceFolder,
  options: { quiet: boolean },
): Promise<LensEndpointFile | undefined> {
  const uri = vscode.Uri.joinPath(folder.uri, ...LENS_ENDPOINT_FILE.split('/'));
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as unknown;
  } catch (error) {
    if (isFileNotFound(error)) {
      return { version: 1, endpoints: [] };
    }
    if (!options.quiet) {
      void vscode.window.showWarningMessage(
        `AtlasMind Lens refused ${LENS_ENDPOINT_FILE} because it is malformed or unreadable.`,
      );
    }
    return undefined;
  }

  const normalized = normalizeLensEndpointFile(raw);
  if (!normalized) {
    if (!options.quiet) {
      void vscode.window.showWarningMessage(
        `AtlasMind Lens refused ${LENS_ENDPOINT_FILE}. Either the document is invalid, or an endpoint `
        + 'carries a credential value — this file is committed, so it may name a secret with `secretRef` '
        + 'but never hold one.',
      );
    }
    return undefined;
  }
  if (normalized.rejected.length > 0 && !options.quiet) {
    // Rejections are reported rather than dropped: one mistyped URL should not
    // silently disable an endpoint somebody believes is declared.
    void vscode.window.showWarningMessage(
      `${LENS_ENDPOINT_FILE}: ${normalized.rejected.length} endpoint(s) were refused. `
      + normalized.rejected.map(rejection => `#${rejection.index + 1}: ${rejection.reason}`).join(' '),
    );
  }
  return normalized.file;
}

async function readTrustPolicy(
  folder: vscode.WorkspaceFolder,
): Promise<LensDataTrustPolicyFile | undefined> {
  const uri = vscode.Uri.joinPath(folder.uri, ...LENS_DATA_TRUST_FILE.split('/'));
  try {
    const raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as unknown;
    return normalizeLensDataTrustPolicyFile(raw);
  } catch {
    // Absent is not a fault here: the Live Data Trust lens simply reports that
    // no policy exists to compare against.
    return undefined;
  }
}

async function discoverContracts(): Promise<LensContract[]> {
  const uris = await vscode.workspace.findFiles(SOURCE_GLOB, SOURCE_EXCLUDE, MAX_SOURCE_FILES);
  const contracts: LensContract[] = [];
  for (const uri of uris) {
    if (contracts.length >= MAX_DISCOVERED_CONTRACTS) {
      break;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const workspacePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    if (!folder || workspacePath.startsWith('..') || workspacePath.startsWith('/')) {
      continue;
    }
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const input = { workspace: { name: folder.name, index: folder.index }, workspacePath, text: document.getText() };
      const lowerPath = workspacePath.toLowerCase();
      const extraction = lowerPath.endsWith('.sql')
        ? extractSqlContractSources(input)
        : lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')
          ? extractTypeScriptContractSources(input)
          : extractJsonContractSources(input);
      contracts.push(...extraction.contracts.slice(0, MAX_DISCOVERED_CONTRACTS - contracts.length));
    } catch {
      // A file that will not open is not a probe failure. Skipped silently here
      // because the drift report already states what it compared against.
    }
  }
  return contracts;
}

/**
 * Describe where a probe would go.
 *
 * Shown separately from the label in the confirmation, so a mislabelled entry
 * cannot disguise its destination. For HTTP this is the origin and path; for a
 * database it is the MCP server, since that is the whole of what AtlasMind knows
 * about where it connects.
 */
function describeDestination(endpoint: LensEndpointDeclaration): string {
  if (endpoint.kind === 'database') {
    return `the MCP server \`${endpoint.mcpServerId ?? 'unnamed'}\``;
  }
  if (!endpoint.url) {
    return 'an unstated destination';
  }
  try {
    const url = new URL(endpoint.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint.url;
  }
}

/**
 * Describe where a direct database probe would connect.
 *
 * Async because the host is inside the stored connection string, which means
 * reading SecretStorage — and it is worth the round trip: a confirmation that
 * cannot name the host is one where a production string pasted into a staging
 * endpoint is invisible at exactly the moment it matters. Only ever the parsed
 * summary; the string itself never reaches a dialog.
 */
async function describeDatabaseDestination(
  endpoint: LensEndpointDeclaration,
  context: LensLiveCommandContext,
): Promise<string> {
  const dialect = dialectOfKind(endpoint.kind);
  if (!dialect || !endpoint.secretRef) {
    return endpoint.vendor ? `the ${endpoint.vendor} SQL endpoint` : 'a stored connection';
  }
  const stored = await context.resolveSecret(endpoint.secretRef);
  if (stored === undefined) {
    return `\`${endpoint.secretRef}\` (nothing stored yet)`;
  }
  const summary = summarizeConnectionString(stored, dialect);
  return summary ? describeConnection(summary) : 'a stored connection string that could not be parsed';
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound' ||
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'FileNotFound';
}
