/**
 * Connecting Unsloth Studio, and managing what it has downloaded and loaded.
 *
 * `unslothStudio.ts` is the contract; this is the part a person presses. Two
 * commands — **AtlasMind: Connect Unsloth Studio** and **AtlasMind: Manage
 * Unsloth Models** — plus the actions the Settings panel's local model advisor
 * delegates to (install, remove, and opening the manager), so the panel and the
 * command cannot disagree about how a model gets into Studio.
 *
 * Five decisions.
 *
 * **Identity before the key, and the key before it is stored.** Connecting
 * probes `/api/liveness` first and asks for nothing if the server does not
 * answer as Studio — port 8888 is Jupyter's too. The key is then tried against
 * `/api/inference/status` and stored only if Studio accepts it, so a mistyped
 * key fails where it was typed instead of as a silent "no models" later. It goes
 * to SecretStorage under the endpoint's own name and is sent to no other
 * endpoint.
 *
 * **Plain HTTP off the loopback asks first.** Studio serves a LAN with
 * `-H 0.0.0.0` over plain HTTP; the key would then cross the network
 * unencrypted, and the person deciding should be told before it does.
 *
 * **Every effect is confirmed and held by a dry run.** Downloading, loading,
 * unloading and deleting each go through `interceptDryRun`. Downloading and
 * deleting are modal, and say what the dialog cannot undo: a download is
 * Studio fetching gigabytes from Hugging Face; a delete removes every quant of
 * the repository from Studio's disk. Unloading is not modal — it frees memory
 * and the model can be loaded again — but a dry run still holds it.
 *
 * **The quant is chosen, not guessed.** The picker lists every quant Studio
 * reports with its size, whether it is already on disk and whether it fits
 * the largest GPU's VRAM, and puts first the one `suggestUnslothVariant`
 * picked, naming the rule that picked it.
 *
 * **A cancelled download is cancelled in Studio.** Closing the connection
 * does not stop Studio's work, so Cancel sends `cancel_load_request_id`, which
 * stops that attempt and never unloads a model already resident.
 */

import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

import { interceptDryRun } from '../core/dryRunHost.js';
import { defaultWorkspaceFolder } from '../utils/workspaceRoots.js';
import { probeGpuDevices } from '../providers/gpuProbe.js';
import { fetchUnslothCatalogCandidates, getCachedLocalModelCatalog } from '../providers/localModelCatalogSync.js';
import { LOCAL_MODEL_SYNC_CACHE_KEY } from '../providers/localModelSync.js';
import { resolveEndpointRuntime, runtimeOrigin } from '../providers/localRuntimeClient.js';
import {
  getConfiguredLocalEndpoints,
  localEndpointApiKeySecret,
  LOCAL_SHARED_API_KEY_SECRET,
  type LocalEndpointConfig,
} from '../providers/registry.js';
import {
  createUnslothStudioClient,
  describeUnslothFailure,
  isPlausibleUnslothApiKey,
  isValidHfRepoId,
  repoIdFromCatalogTag,
  decideUnslothRouting,
  suggestUnslothVariant,
  UNSLOTH_ROUTING_RULES,
  UNSLOTH_HUB_AUTHOR,
  UNSLOTH_STUDIO_DEFAULT_BASE_URL,
  UNSLOTH_TOOL_POLICY_CAVEAT,
  UNSLOTH_VARIANT_RULES,
  variantFitsVram,
  type UnslothDownloadedModel,
  type UnslothGgufVariant,
  type UnslothStudioClient,
} from '../providers/unslothStudio.js';

/** What a surface wants to hear back. Both optional; the commands also notify on their own. */
export interface UnslothCommandHooks {
  /** A status line for a panel that started the action. */
  report?: (message: string) => void | Promise<void>;
  /** Something Studio holds changed: refresh model lists. */
  onChanged?: () => void | Promise<void>;
}

interface UnslothConnection {
  endpoint: LocalEndpointConfig;
  origin: string;
  client: UnslothStudioClient;
}

const DEFAULT_ENDPOINT_ID = 'unsloth-studio';
const DOWNLOAD_POLL_MS = 2_000;

/** The first configured endpoint that is Unsloth Studio, by the shared runtime rule. */
function findUnslothEndpoint(configuration = vscode.workspace.getConfiguration('atlasmind')): LocalEndpointConfig | undefined {
  return getConfiguredLocalEndpoints({
    getEndpoints: () => configuration.get<unknown>('localOpenAiEndpoints'),
    getLegacyBaseUrl: () => configuration.get<string>('localOpenAiBaseUrl'),
  }).find(endpoint => resolveEndpointRuntime(endpoint) === 'unsloth');
}

/** The endpoint's own key, then the shared local key — the order the adapter sends them in. */
export async function readUnslothApiKey(secrets: vscode.SecretStorage, endpointId: string): Promise<string | undefined> {
  const own = localEndpointApiKeySecret(endpointId);
  const ownKey = own ? await secrets.get(own) : undefined;
  if (ownKey && ownKey.trim().length > 0) { return ownKey.trim(); }
  const shared = await secrets.get(LOCAL_SHARED_API_KEY_SECRET);
  return shared && shared.trim().length > 0 ? shared.trim() : undefined;
}

function openConnection(context: vscode.ExtensionContext): UnslothConnection | undefined {
  const endpoint = findUnslothEndpoint();
  const origin = endpoint ? runtimeOrigin(endpoint.baseUrl) : undefined;
  if (!endpoint || !origin) { return undefined; }
  return {
    endpoint,
    origin,
    client: createUnslothStudioClient(origin, { getApiKey: () => readUnslothApiKey(context.secrets, endpoint.id) }),
  };
}

async function say(hooks: UnslothCommandHooks | undefined, message: string, level: 'info' | 'warning' | 'error' = 'info'): Promise<void> {
  if (hooks?.report) {
    await hooks.report(message);
    return;
  }
  if (level === 'error') { void vscode.window.showErrorMessage(message); }
  else if (level === 'warning') { void vscode.window.showWarningMessage(message); }
  else { void vscode.window.showInformationMessage(message); }
}

async function changed(context: vscode.ExtensionContext, hooks: UnslothCommandHooks | undefined): Promise<void> {
  // Force the next local-model scan to ask Studio again rather than serve the hour-old cache.
  await context.globalState.update(LOCAL_MODEL_SYNC_CACHE_KEY, undefined);
  await hooks?.onChanged?.();
}

async function requireConnection(context: vscode.ExtensionContext, hooks: UnslothCommandHooks | undefined): Promise<UnslothConnection | undefined> {
  const connection = openConnection(context);
  if (connection) { return connection; }
  const message = 'No Unsloth Studio endpoint is configured. Connect Studio first: AtlasMind checks it is Studio before asking for its API key.';
  if (hooks?.report) {
    await hooks.report(message);
  }
  const choice = await vscode.window.showInformationMessage(message, 'Connect Unsloth Studio');
  if (choice === 'Connect Unsloth Studio') {
    await connectUnslothStudio(context, hooks);
    return openConnection(context);
  }
  return undefined;
}

/** `1234567890` → `1.1 GB`. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !(bytes > 0)) { return 'size unknown'; }
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) { return `${gib.toFixed(gib >= 100 ? 0 : 1)} GB`; }
  return `${Math.max(1, Math.round(bytes / (1024 ** 2)))} MB`;
}

/**
 * A Studio base URL, or why not.
 *
 * Accepts the origin or the `/v1` base and always returns the `/v1` base the
 * chat adapter needs. Refuses credentials in the URL (they would sit in a
 * settings file) and any other path, because the management API lives beside
 * `/v1` and a proxy path in front of it is not something to guess at.
 */
export function normalizeStudioBaseUrl(raw: string): { baseUrl: string; origin: string; plaintextOffLoopback: boolean } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: 'Enter a URL such as http://127.0.0.1:8888/v1.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Only http:// and https:// URLs are supported.' };
  }
  if (parsed.username || parsed.password) {
    return { error: 'Leave credentials out of the URL — the API key is asked for next and kept in the OS keychain.' };
  }
  if (parsed.search || parsed.hash) {
    return { error: 'Leave the query string and fragment out of the URL.' };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path !== '' && path !== '/v1') {
    return { error: 'Use the server address or its /v1 base; Unsloth Studio serves its management API beside /v1.' };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
  return {
    baseUrl: `${parsed.origin}/v1`,
    origin: parsed.origin,
    plaintextOffLoopback: parsed.protocol === 'http:' && !loopback,
  };
}

// ── Connect ─────────────────────────────────────────────────────────────────

/** Add (or repoint) the Unsloth Studio endpoint and store its key, after checking both. */
export async function connectUnslothStudio(context: vscode.ExtensionContext, hooks?: UnslothCommandHooks): Promise<boolean> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const existing = findUnslothEndpoint(configuration);

  const rawUrl = await vscode.window.showInputBox({
    title: 'Connect Unsloth Studio (1 of 2): address',
    prompt: 'Where Unsloth Studio is running. `unsloth studio` serves http://127.0.0.1:8888 by default.',
    value: existing?.baseUrl ?? UNSLOTH_STUDIO_DEFAULT_BASE_URL,
    ignoreFocusOut: true,
    validateInput: value => {
      const result = normalizeStudioBaseUrl(value);
      return 'error' in result ? result.error : undefined;
    },
  });
  if (rawUrl === undefined) { return false; }
  const target = normalizeStudioBaseUrl(rawUrl);
  if ('error' in target) { return false; }

  if (target.plaintextOffLoopback) {
    const proceed = await vscode.window.showWarningMessage(
      `${target.origin} is another machine reached over plain HTTP.`,
      {
        modal: true,
        detail: 'The Unsloth Studio API key would travel unencrypted on every request, and anyone on the network '
          + 'path could read it. Studio started with `--secure` publishes an HTTPS address instead.',
      },
      'Send it over plain HTTP',
    );
    if (proceed !== 'Send it over plain HTTP') { return false; }
  }

  // Identity first. Nothing is asked for, and nothing is sent, until the
  // server has said it is Studio.
  const probeClient = createUnslothStudioClient(target.origin);
  const probe = await probeClient.probe();
  if (!probe.reachable) {
    await say(hooks, describeUnslothFailure({ reason: 'unreachable' }, target.origin), 'error');
    return false;
  }
  if (!probe.isUnsloth) {
    await say(hooks, `${target.origin} answered, but not as Unsloth Studio, so AtlasMind did not ask for an API key. `
      + 'Check the port — 8888 is Jupyter\'s default too.', 'error');
    return false;
  }

  const key = await vscode.window.showInputBox({
    title: 'Connect Unsloth Studio (2 of 2): API key',
    prompt: 'Create a key in Unsloth Studio under Settings → API Access. It is kept in the OS keychain and sent to this endpoint only.',
    placeHolder: 'sk-unsloth-…',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => (isPlausibleUnslothApiKey(value.trim())
      ? undefined
      : 'An Unsloth Studio key starts with sk-unsloth-.'),
  });
  if (key === undefined) { return false; }
  const trimmedKey = key.trim();

  // Tried before it is stored: a key Studio rejects fails here, where it was typed.
  const verifier = createUnslothStudioClient(target.origin, { getApiKey: () => trimmedKey });
  const status = await verifier.status();
  if (!status.ok) {
    await say(hooks, `${describeUnslothFailure(status, target.origin)} The key was not stored.`, 'error');
    return false;
  }

  const endpoints = getConfiguredLocalEndpoints({
    getEndpoints: () => configuration.get<unknown>('localOpenAiEndpoints'),
    getLegacyBaseUrl: () => configuration.get<string>('localOpenAiBaseUrl'),
  });
  let endpointId = existing?.id;
  let next: LocalEndpointConfig[];
  if (existing) {
    next = endpoints.map(endpoint => (endpoint.id === existing.id
      ? { ...endpoint, baseUrl: target.baseUrl, runtime: 'unsloth' as const }
      : endpoint));
  } else {
    const used = new Set(endpoints.map(endpoint => endpoint.id));
    endpointId = DEFAULT_ENDPOINT_ID;
    for (let suffix = 2; used.has(endpointId); suffix += 1) { endpointId = `${DEFAULT_ENDPOINT_ID}-${suffix}`; }
    next = [...endpoints, { id: endpointId, label: 'Unsloth Studio', baseUrl: target.baseUrl, runtime: 'unsloth' }];
  }
  const secretName = endpointId ? localEndpointApiKeySecret(endpointId) : undefined;
  if (!endpointId || !secretName) {
    await say(hooks, 'AtlasMind could not derive a keychain name for this endpoint, so nothing was saved.', 'error');
    return false;
  }

  await configuration.update(
    'localOpenAiEndpoints',
    next,
    // Where the Settings panel writes endpoints, unless no folder is open.
    defaultWorkspaceFolder() ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
  );
  await context.secrets.store(secretName, trimmedKey);
  await changed(context, hooks);

  const loaded = status.value.loaded.length;
  const summary = `Connected Unsloth Studio at ${target.origin}${loaded > 0 ? ` (${loaded} model${loaded === 1 ? '' : 's'} loaded)` : ''}.`;
  const choice = await vscode.window.showInformationMessage(
    `${summary} ${UNSLOTH_TOOL_POLICY_CAVEAT}`,
    'Manage Unsloth Models',
  );
  if (hooks?.report) { await hooks.report(summary); }
  if (choice === 'Manage Unsloth Models') {
    await manageUnslothModels(context, hooks);
  }
  return true;
}

// ── Manage ──────────────────────────────────────────────────────────────────

type ManageAction =
  | { kind: 'unload'; modelId: string }
  | { kind: 'model'; model: UnslothDownloadedModel }
  | { kind: 'discover' }
  | { kind: 'by-id' }
  | { kind: 'connect' };

interface ManagePick extends vscode.QuickPickItem {
  action?: ManageAction;
}

function isLoadedRepo(repoId: string, loaded: readonly string[]): boolean {
  const key = repoId.toLowerCase();
  return loaded.some(id => id.toLowerCase() === key || id.toLowerCase().startsWith(`${key}:`));
}

/** The manager: what is in memory, what is on disk, and how to get more. */
export async function manageUnslothModels(
  context: vscode.ExtensionContext,
  hooks?: UnslothCommandHooks,
  options?: { repoId?: string },
): Promise<void> {
  const connection = await requireConnection(context, hooks);
  if (!connection) { return; }

  const [status, downloaded, policy] = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Asking Unsloth Studio what it holds…' },
    () => Promise.all([connection.client.status(), connection.client.listDownloaded(), connection.client.servingPolicy()]),
  );
  if (!status.ok && !downloaded.ok) {
    await say(hooks, describeUnslothFailure(status, connection.origin), 'error');
    return;
  }
  const loaded = status.ok ? [...new Set([...status.value.loaded, ...status.value.serving])] : [];
  const onDisk = downloaded.ok ? downloaded.value : [];
  // What the routed model list will do with a downloaded model that is not
  // loaded — the same rule, so this list and that one say the same thing.
  const unloadedRule = UNSLOTH_ROUTING_RULES.find(rule =>
    rule.id === decideUnslothRouting({ loaded: false }, policy.ok ? policy.value : undefined).rule);

  if (options?.repoId) {
    const model = onDisk.find(candidate => candidate.repoId.toLowerCase() === options.repoId!.toLowerCase());
    if (model) {
      await manageDownloadedModel(context, connection, model, isLoadedRepo(model.repoId, loaded), hooks);
      return;
    }
  }

  const items: ManagePick[] = [];
  items.push({ label: 'In memory', kind: vscode.QuickPickItemKind.Separator });
  if (!status.ok) {
    items.push({ label: '$(warning) Could not read what is loaded', description: describeUnslothFailure(status) });
  } else if (loaded.length === 0) {
    items.push({
      label: '$(circle-outline) Nothing is loaded',
      description: unloadedRule?.routable
        ? 'Studio loads a downloaded model when AtlasMind asks for it'
        : 'AtlasMind can route only to a loaded model — load one below',
      ...(unloadedRule ? { detail: unloadedRule.description } : {}),
    });
  } else {
    for (const modelId of loaded) {
      items.push({
        label: `$(circle-filled) ${modelId}`,
        description: status.value.activeModel === modelId ? 'active' : 'loaded',
        detail: 'Select to unload it and free its memory.',
        action: { kind: 'unload', modelId },
      });
    }
  }

  items.push({ label: 'Downloaded', kind: vscode.QuickPickItemKind.Separator });
  if (!downloaded.ok) {
    items.push({ label: '$(warning) Could not read what is downloaded', description: describeUnslothFailure(downloaded) });
  } else if (onDisk.length === 0) {
    items.push({ label: '$(circle-outline) No GGUF models downloaded yet' });
  } else {
    for (const model of onDisk) {
      const facts = [formatBytes(model.sizeBytes)];
      if (isLoadedRepo(model.repoId, loaded)) {
        facts.push('loaded · AtlasMind routes to it');
      } else if (status.ok && unloadedRule) {
        facts.push(unloadedRule.routable ? 'Studio loads it on request' : 'not loaded · not routable until loaded');
      }
      if (model.hasVision) { facts.push('vision'); }
      if (model.partial) { facts.push('interrupted download'); }
      items.push({ label: `$(package) ${model.repoId}`, description: facts.join(' · '), action: { kind: 'model', model } });
    }
  }

  items.push({ label: 'Get a model', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: '$(search) Discover Unsloth models…',
    description: `Chat-model GGUF builds from huggingface.co/${UNSLOTH_HUB_AUTHOR}`,
    action: { kind: 'discover' },
  });
  items.push({
    label: '$(cloud-download) Download by Hugging Face repository id…',
    description: 'owner/name, e.g. unsloth/Qwen3-14B-GGUF',
    action: { kind: 'by-id' },
  });
  items.push({ label: 'Studio', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: '$(key) Change address or API key…',
    description: `${connection.endpoint.label} · ${connection.origin}`,
    action: { kind: 'connect' },
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: `Unsloth Studio — ${connection.origin}`,
    placeHolder: 'Choose a model to manage, or get a new one',
    matchOnDescription: true,
  });
  const action = picked?.action;
  if (!action) { return; }

  switch (action.kind) {
    case 'unload':
      await unloadUnslothModel(context, action.modelId, hooks);
      return;
    case 'model':
      await manageDownloadedModel(context, connection, action.model, isLoadedRepo(action.model.repoId, loaded), hooks);
      return;
    case 'discover':
      await discoverUnslothModels(context, hooks);
      return;
    case 'by-id': {
      const repo = await vscode.window.showInputBox({
        title: 'Download into Unsloth Studio',
        prompt: 'A Hugging Face repository that publishes GGUF quantisations.',
        placeHolder: 'unsloth/Qwen3-14B-GGUF',
        ignoreFocusOut: true,
        validateInput: value => (isValidHfRepoId(repoIdFromCatalogTag(value))
          ? undefined
          : 'Enter owner/name — letters, digits, dot, dash and underscore only.'),
      });
      if (repo === undefined) { return; }
      await installModelInUnsloth(context, repo, hooks);
      return;
    }
    case 'connect':
      await connectUnslothStudio(context, hooks);
      return;
  }
}

async function manageDownloadedModel(
  context: vscode.ExtensionContext,
  connection: UnslothConnection,
  model: UnslothDownloadedModel,
  loaded: boolean,
  hooks: UnslothCommandHooks | undefined,
): Promise<void> {
  type Choice = vscode.QuickPickItem & { id: 'load' | 'unload' | 'remove' | 'open' };
  const choices: Choice[] = [
    { id: 'load', label: '$(play) Load or download a quantisation…', description: 'Lists every quant with its size and whether it fits your VRAM' },
    ...(loaded ? [{ id: 'unload' as const, label: '$(debug-stop) Unload', description: 'Free its memory; it stays on disk' }] : []),
    { id: 'remove', label: '$(trash) Remove from Unsloth…', description: `Delete ${formatBytes(model.sizeBytes)} from Studio's disk` },
    { id: 'open', label: '$(link-external) Open on Hugging Face' },
  ];
  const picked = await vscode.window.showQuickPick(choices, { title: model.repoId, placeHolder: 'What should Unsloth Studio do with it?' });
  if (!picked) { return; }
  switch (picked.id) {
    case 'load':
      await installModelInUnsloth(context, model.repoId, hooks);
      return;
    case 'unload': {
      const status = await connection.client.status();
      const ids = status.ok
        ? [...new Set([...status.value.loaded, ...status.value.serving])].filter(id => isLoadedRepo(model.repoId, [id]))
        : [];
      if (ids.length === 0) {
        await say(hooks, `${model.repoId} is no longer loaded.`);
        return;
      }
      for (const id of ids) { await unloadUnslothModel(context, id, hooks); }
      return;
    }
    case 'remove':
      await removeModelFromUnsloth(context, model.repoId, hooks);
      return;
    case 'open':
      await vscode.env.openExternal(vscode.Uri.parse(`https://huggingface.co/${model.repoId}`));
      return;
  }
}

/** Unsloth's chat-model GGUF builds, fresh from Hugging Face with the cached catalogue as the fallback. */
async function discoverUnslothModels(context: vscode.ExtensionContext, hooks?: UnslothCommandHooks): Promise<void> {
  const fresh = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Reading huggingface.co/${UNSLOTH_HUB_AUTHOR}…`, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        return await fetchUnslothCatalogCandidates(controller.signal);
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    },
  );
  const cached = (getCachedLocalModelCatalog(context.globalState) ?? [])
    .filter(candidate => candidate.recommendedTag.toLowerCase().startsWith(`hf:${UNSLOTH_HUB_AUTHOR}/`));
  const candidates = fresh.length > 0 ? fresh : cached;
  if (candidates.length === 0) {
    await say(hooks, `Could not read Unsloth's model list from huggingface.co. Enter a repository id instead (Manage Unsloth Models → Download by Hugging Face repository id).`, 'warning');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map(candidate => ({
      label: candidate.modelFamily,
      description: repoIdFromCatalogTag(candidate.recommendedTag),
      detail: `${candidate.workloadTags.join(', ')} · usually wants ${candidate.minVramGb !== undefined ? `${candidate.minVramGb} GB VRAM` : `${candidate.minRamGb} GB RAM`}`,
      tag: candidate.recommendedTag,
    })),
    {
      title: `Unsloth models${fresh.length > 0 ? '' : ' (cached list)'}`,
      placeHolder: 'Choose one to see its quantisations — nothing downloads until you confirm',
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!picked) { return; }
  await installModelInUnsloth(context, picked.tag, hooks);
}

// ── Install (download and load) ─────────────────────────────────────────────

interface VariantPick extends vscode.QuickPickItem {
  variant: UnslothGgufVariant;
}

async function largestVramBytes(): Promise<number | undefined> {
  try {
    const devices = await probeGpuDevices();
    const largest = devices.reduce((max, device) => Math.max(max, device.totalBytes ?? 0), 0);
    return largest > 0 ? largest : undefined;
  } catch {
    return undefined;
  }
}

function describeFit(variant: UnslothGgufVariant, vramBytes: number | undefined): string {
  const fits = variantFitsVram(variant, vramBytes);
  if (fits === undefined) {
    return vramBytes === undefined ? 'VRAM not measured' : 'size unknown';
  }
  return fits
    ? `fits in ${formatBytes(vramBytes)} VRAM`
    : `larger than ${formatBytes(vramBytes)} VRAM — will partly run on the CPU`;
}

/**
 * Pick a quant of `modelTag` and have Studio load it, downloading first if it
 * is not on disk. `modelTag` may be `owner/name` or a catalogue `hf:owner/name`.
 */
export async function installModelInUnsloth(
  context: vscode.ExtensionContext,
  modelTag: string,
  hooks?: UnslothCommandHooks,
): Promise<void> {
  const repoId = repoIdFromCatalogTag(modelTag);
  if (!isValidHfRepoId(repoId)) {
    await say(hooks, `Refusing to send "${modelTag.slice(0, 120)}" to Unsloth Studio: it is not a Hugging Face owner/name repository id.`, 'error');
    return;
  }
  const connection = await requireConnection(context, hooks);
  if (!connection) { return; }

  const [listing, vramBytes] = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Asking Unsloth Studio which quantisations ${repoId} offers…` },
    () => Promise.all([connection.client.listVariants(repoId), largestVramBytes()]),
  );
  if (!listing.ok) {
    await say(hooks, describeUnslothFailure(listing, connection.origin), 'error');
    return;
  }
  if (listing.value.variants.length === 0) {
    await say(hooks, `${repoId} offers no GGUF quantisation Unsloth Studio can load.`, 'warning');
    return;
  }

  const suggestion = suggestUnslothVariant(listing.value, vramBytes);
  const rule = suggestion ? UNSLOTH_VARIANT_RULES.find(entry => entry.id === suggestion.rule) : undefined;
  const ordered = [...listing.value.variants].sort((left, right) => {
    if (suggestion) {
      if (left.quant === suggestion.quant) { return -1; }
      if (right.quant === suggestion.quant) { return 1; }
    }
    return right.sizeBytes - left.sizeBytes || left.quant.localeCompare(right.quant);
  });
  const picked = await vscode.window.showQuickPick<VariantPick>(
    ordered.map(variant => {
      const onDisk = variant.downloaded
        ? 'on disk'
        : variant.partial
          ? 'interrupted download — loading resumes it'
          : `${formatBytes(variant.downloadSizeBytes || variant.sizeBytes)} to download`;
      const suggested = suggestion?.quant === variant.quant;
      return {
        label: `${suggested ? '$(star-full) ' : ''}${variant.displayLabel ?? variant.quant}`,
        description: `${formatBytes(variant.sizeBytes)} · ${onDisk}`,
        detail: `${describeFit(variant, vramBytes)}${variant.contextLength ? ` · ${variant.contextLength.toLocaleString()} tokens context` : ''}`
          + `${suggested && rule ? ` · suggested: ${rule.description}` : ''}`,
        variant,
      };
    }),
    {
      title: `${repoId} — choose a quantisation`,
      placeHolder: listing.value.defaultVariant
        ? `Unsloth's default is ${listing.value.defaultVariant}. Nothing downloads until you confirm.`
        : 'Nothing downloads until you confirm.',
      matchOnDescription: true,
    },
  );
  if (!picked) { return; }
  const variant = picked.variant;

  const needsDownload = !variant.downloaded;
  const bytes = variant.downloadSizeBytes || variant.sizeBytes;
  const confirmLabel = needsDownload ? 'Download and load' : 'Load';
  const confirmed = await vscode.window.showWarningMessage(
    needsDownload
      ? `Download ${repoId} ${variant.quant} (${formatBytes(bytes)}) into Unsloth Studio and load it?`
      : `Load ${repoId} ${variant.quant} in Unsloth Studio?`,
    {
      modal: true,
      detail: [
        needsDownload
          ? 'Unsloth Studio downloads it from Hugging Face into its own cache — AtlasMind sends nothing but the repository id and quant.'
          : 'It is already on disk; nothing is downloaded.',
        'Studio may unload another model it holds to make room; AtlasMind will say which.',
        describeFit(variant, vramBytes) + '.',
      ].join('\n\n'),
    },
    confirmLabel,
  );
  if (confirmed !== confirmLabel) { return; }

  if (interceptDryRun({
    surface: 'local-model-install',
    kind: 'network',
    summary: needsDownload
      ? `download ${repoId} ${variant.quant} into Unsloth Studio and load it`
      : `load ${repoId} ${variant.quant} in Unsloth Studio`,
    details: { repoId, variant: variant.quant, runtime: 'unsloth' },
    wouldHaveAsked: true,
  })) {
    return;
  }

  const loadRequestId = randomUUID();
  await say(hooks, needsDownload
    ? `Downloading ${repoId} ${variant.quant} into Unsloth Studio — progress is in the notification. Large models take a while.`
    : `Loading ${repoId} ${variant.quant} in Unsloth Studio…`);

  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Unsloth Studio: ${needsDownload ? 'downloading' : 'loading'} ${repoId} ${variant.quant}`,
      cancellable: true,
    },
    async (progress, token) => {
      const controller = new AbortController();
      let cancelled = false;
      token.onCancellationRequested(() => {
        cancelled = true;
        // Closing the connection does not stop Studio; cancel the attempt
        // itself, which never unloads a model that is already resident.
        void connection.client.cancelLoad({ repoId, loadRequestId }).finally(() => controller.abort());
      });

      let lastPercent = 0;
      let polling = needsDownload;
      const poll = async (): Promise<void> => {
        while (polling && !controller.signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, DOWNLOAD_POLL_MS));
          if (!polling) { return; }
          const reading = await connection.client.downloadProgress({ repoId, variant: variant.quant, expectedBytes: bytes });
          if (!reading.ok || reading.value.fraction === undefined) { continue; }
          const percent = Math.floor(reading.value.fraction * 100);
          if (percent > lastPercent) {
            progress.report({
              increment: percent - lastPercent,
              message: `${formatBytes(reading.value.downloadedBytes)} of ${formatBytes(reading.value.expectedBytes)}`,
            });
            lastPercent = percent;
          }
          if (reading.value.completeOnDisk) {
            progress.report({ message: 'downloaded — loading into memory' });
            return;
          }
        }
      };
      const poller = poll();
      try {
        const result = await connection.client.downloadAndLoad({ repoId, variant: variant.quant, loadRequestId }, controller.signal);
        return { result, cancelled };
      } finally {
        polling = false;
        await poller.catch(() => undefined);
      }
    },
  );

  // A load that finished before the cancel reached Studio is loaded; say so
  // rather than report a cancellation that did not happen.
  if (outcome.cancelled && !outcome.result.ok) {
    await say(hooks, `Cancelled the Unsloth Studio ${needsDownload ? 'download' : 'load'} of ${repoId} ${variant.quant}.`);
    await changed(context, hooks);
    return;
  }
  if (!outcome.result.ok) {
    await say(hooks, `Unsloth Studio could not load ${repoId} ${variant.quant}. ${describeUnslothFailure(outcome.result, connection.origin)}`, 'error');
    await changed(context, hooks);
    return;
  }

  const loaded = outcome.result.value;
  const notes: string[] = [];
  if (loaded.evicted.length > 0) { notes.push(`Studio unloaded ${loaded.evicted.join(', ')} to make room.`); }
  if (loaded.memoryWarning) { notes.push(loaded.memoryWarning); }
  await say(hooks, `Loaded ${loaded.displayName ?? loaded.model} in Unsloth Studio. AtlasMind can route to it now.${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`);
  await changed(context, hooks);
}

// ── Unload and remove ──────────────────────────────────────────────────────

/** Free a model's memory. It stays on disk and can be loaded again. */
async function unloadUnslothModel(context: vscode.ExtensionContext, modelId: string, hooks?: UnslothCommandHooks): Promise<void> {
  const connection = await requireConnection(context, hooks);
  if (!connection) { return; }
  if (interceptDryRun({
    surface: 'local-model-unload',
    kind: 'network',
    summary: `unload ${modelId} from Unsloth Studio`,
    details: { modelId, runtime: 'unsloth' },
  })) {
    return;
  }
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Unloading ${modelId} from Unsloth Studio…` },
    () => connection.client.unloadModel(modelId),
  );
  if (!result.ok) {
    await say(hooks, `Unsloth Studio did not unload ${modelId}. ${describeUnslothFailure(result, connection.origin)}`, 'error');
    return;
  }
  await say(hooks, `Unloaded ${modelId} from Unsloth Studio. It is still on disk.`);
  await changed(context, hooks);
}

/** Delete every downloaded quant of a repository from Studio's disk, unloading it first if it is loaded. */
export async function removeModelFromUnsloth(context: vscode.ExtensionContext, modelTag: string, hooks?: UnslothCommandHooks): Promise<void> {
  const repoId = repoIdFromCatalogTag(modelTag);
  if (!isValidHfRepoId(repoId)) {
    await say(hooks, 'Refusing to remove that model: it is not a Hugging Face owner/name repository id.', 'error');
    return;
  }
  const connection = await requireConnection(context, hooks);
  if (!connection) { return; }

  const [downloaded, status] = await Promise.all([connection.client.listDownloaded(), connection.client.status()]);
  if (!downloaded.ok) {
    await say(hooks, describeUnslothFailure(downloaded, connection.origin), 'error');
    return;
  }
  const model = downloaded.value.find(candidate => candidate.repoId.toLowerCase() === repoId.toLowerCase());
  if (!model) {
    await say(hooks, `${repoId} is not in Unsloth Studio's downloads.`, 'warning');
    await changed(context, hooks);
    return;
  }
  // An unreadable status is not "nothing is loaded": Studio refuses to delete a
  // loaded model, and says so, which is the honest fallback.
  const loadedIds = status.ok
    ? [...new Set([...status.value.loaded, ...status.value.serving])].filter(id => isLoadedRepo(repoId, [id]))
    : [];

  const action = loadedIds.length > 0 ? 'Unload and remove' : 'Remove';
  const confirmed = await vscode.window.showWarningMessage(
    `${loadedIds.length > 0 ? 'Unload and remove' : 'Remove'} ${repoId} (${formatBytes(model.sizeBytes)}) from Unsloth Studio?`,
    {
      modal: true,
      detail: 'Every downloaded quantisation of this repository is deleted from Studio\'s disk. '
        + 'Getting it back means downloading it from Hugging Face again.',
    },
    action,
  );
  if (confirmed !== action) { return; }

  if (interceptDryRun({
    surface: 'local-model-remove',
    kind: 'network',
    summary: `delete ${repoId} from Unsloth Studio`,
    details: { repoId, runtime: 'unsloth' },
    wouldHaveAsked: true,
  })) {
    return;
  }

  for (const id of loadedIds) {
    const unloaded = await connection.client.unloadModel(id);
    if (!unloaded.ok) {
      await say(hooks, `Unsloth Studio did not unload ${id}, so ${repoId} was not removed. ${describeUnslothFailure(unloaded, connection.origin)}`, 'error');
      return;
    }
  }
  const deleted = await connection.client.deleteDownload({ repoId });
  if (!deleted.ok) {
    await say(hooks, `Unsloth Studio did not remove ${repoId}. ${describeUnslothFailure(deleted, connection.origin)}`, 'error');
    await changed(context, hooks);
    return;
  }
  await say(hooks, `Removed ${repoId} from Unsloth Studio.`);
  await changed(context, hooks);
}
