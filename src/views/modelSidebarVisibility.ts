/**
 * User-level presentation preferences for the Models sidebar.
 *
 * This is deliberately separate from provider/model enablement. Hiding a row
 * must never change what the router can select, alter credentials, or write a
 * project setting merely because one operator wants a quieter sidebar.
 */
export const MODEL_SIDEBAR_HIDDEN_ENTRIES_KEY = 'atlasmind.models.sidebar.hiddenEntries.v1';

export type ModelSidebarHiddenEntry =
  | { kind: 'provider'; providerId: string }
  | { kind: 'model'; providerId: string; modelId: string }
  | { kind: 'bridge'; vendorId: string; agentId: string };

export interface ModelSidebarVisibilityReader {
  get<T>(key: string, defaultValue?: T): T | undefined;
}

export interface ModelSidebarVisibilityWriter extends ModelSidebarVisibilityReader {
  update(key: string, value: unknown): Thenable<void>;
}

const MAX_HIDDEN_ENTRIES = 500;
const MAX_IDENTIFIER_LENGTH = 512;

function sanitizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_IDENTIFIER_LENGTH
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function sanitizeEntry(value: unknown): ModelSidebarHiddenEntry | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record['kind'] === 'provider') {
    const providerId = sanitizeIdentifier(record['providerId']);
    return providerId ? { kind: 'provider', providerId } : undefined;
  }

  if (record['kind'] === 'model') {
    const providerId = sanitizeIdentifier(record['providerId']);
    const modelId = sanitizeIdentifier(record['modelId']);
    return providerId && modelId ? { kind: 'model', providerId, modelId } : undefined;
  }

  if (record['kind'] === 'bridge') {
    const vendorId = sanitizeIdentifier(record['vendorId']);
    const agentId = sanitizeIdentifier(record['agentId']);
    return vendorId && agentId ? { kind: 'bridge', vendorId, agentId } : undefined;
  }

  return undefined;
}

function encodeIdentifier(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Stable, browser-safe identity used only to identify a stored entry when the
 * Settings webview asks the extension host to restore it.
 */
export function modelSidebarHiddenEntryKey(entry: ModelSidebarHiddenEntry): string {
  switch (entry.kind) {
    case 'provider':
      return `provider:${encodeIdentifier(entry.providerId)}`;
    case 'model':
      return `model:${encodeIdentifier(entry.providerId)}:${encodeIdentifier(entry.modelId)}`;
    case 'bridge':
      return `bridge:${encodeIdentifier(entry.vendorId)}:${encodeIdentifier(entry.agentId)}`;
  }
}

export function readHiddenModelSidebarEntries(
  state: ModelSidebarVisibilityReader,
): ModelSidebarHiddenEntry[] {
  const stored = state.get<unknown>(MODEL_SIDEBAR_HIDDEN_ENTRIES_KEY, []);
  if (!Array.isArray(stored)) {
    return [];
  }

  const seen = new Set<string>();
  const entries: ModelSidebarHiddenEntry[] = [];
  for (const candidate of stored.slice(0, MAX_HIDDEN_ENTRIES)) {
    const entry = sanitizeEntry(candidate);
    if (!entry) {
      continue;
    }
    const key = modelSidebarHiddenEntryKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

export async function hideModelSidebarEntry(
  state: ModelSidebarVisibilityWriter,
  entry: ModelSidebarHiddenEntry,
): Promise<void> {
  const sanitized = sanitizeEntry(entry);
  if (!sanitized) {
    return;
  }

  const current = readHiddenModelSidebarEntries(state);
  const key = modelSidebarHiddenEntryKey(sanitized);
  if (current.some(candidate => modelSidebarHiddenEntryKey(candidate) === key)) {
    return;
  }

  await state.update(
    MODEL_SIDEBAR_HIDDEN_ENTRIES_KEY,
    [...current, sanitized].slice(0, MAX_HIDDEN_ENTRIES),
  );
}

/**
 * Restores only a key that is actually present in host storage. The webview
 * cannot invent another preference mutation by submitting an arbitrary id.
 */
export async function restoreModelSidebarEntry(
  state: ModelSidebarVisibilityWriter,
  entryKey: string,
): Promise<boolean> {
  const current = readHiddenModelSidebarEntries(state);
  const next = current.filter(entry => modelSidebarHiddenEntryKey(entry) !== entryKey);
  if (next.length === current.length) {
    return false;
  }
  await state.update(MODEL_SIDEBAR_HIDDEN_ENTRIES_KEY, next);
  return true;
}

export function isModelSidebarProviderHidden(
  entries: readonly ModelSidebarHiddenEntry[],
  providerId: string,
): boolean {
  return entries.some(entry => entry.kind === 'provider' && entry.providerId === providerId);
}

export function isModelSidebarModelHidden(
  entries: readonly ModelSidebarHiddenEntry[],
  providerId: string,
  modelId: string,
): boolean {
  return entries.some(entry =>
    entry.kind === 'model'
    && entry.providerId === providerId
    && entry.modelId === modelId,
  );
}

export function isModelSidebarBridgeHidden(
  entries: readonly ModelSidebarHiddenEntry[],
  vendorId: string,
  agentId: string,
): boolean {
  return entries.some(entry =>
    entry.kind === 'bridge'
    && entry.vendorId === vendorId
    && entry.agentId === agentId,
  );
}
