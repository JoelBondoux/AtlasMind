/**
 * Unsloth Studio, spoken in its own native API.
 *
 * Studio serves OpenAI-compatible chat on `/v1`, which `LocalEchoAdapter` already
 * speaks, and a management API beside it that nothing in the OpenAI dialect
 * covers: what is downloaded, which quantisations a repository offers, loading
 * (which downloads first), unloading, and deleting a download. This module is
 * that second half. The contract was **read from Studio's source at
 * {@link UNSLOTH_STUDIO_VERIFIED_RELEASE}**, not inferred from its docs, which
 * cover only chat and model listing; it is pinned at
 * {@link UNSLOTH_STUDIO_VERIFIED_AT} the way `ACP_SPEC_VERIFIED_AT` pins ACP.
 *
 * Seven rules.
 *
 * **The port is a hint, never an identity.** Studio's default port, 8888, is
 * also Jupyter's. So no request carrying the `sk-unsloth-` key is sent until
 * the unauthenticated `GET /api/liveness` has answered with
 * `service: "Unsloth UI Backend"`. A Jupyter server, or anything else that
 * happens to be listening there, gets one harmless GET and never the key.
 *
 * **Server-side tools are switched off on every request.** Studio can run
 * Python, a shell and web search *itself*, inside a chat completion, and
 * `unsloth run` / `unsloth studio run` default them **on** for loopback.
 * Anything Studio runs that way bypasses AtlasMind's tool approval, sandbox,
 * dry run and provenance tracking entirely, because AtlasMind never sees a tool
 * call — only the answer. {@link UNSLOTH_SERVER_TOOLS_OFF} is added to every
 * completion sent to an Unsloth endpoint. It is honoured over the launcher
 * default, **but not over a process started with `--enable-tools`**, and Studio
 * does not publish which policy a process was started with — so
 * {@link UNSLOTH_TOOL_POLICY_CAVEAT} travels with every surface that connects
 * Studio, naming `--disable-tools` as the one switch the server cannot be
 * talked out of.
 *
 * **A 200 is not a success.** `/load` and `/unload` answer within 15 seconds
 * with the real status code; a slower call commits `200` and pads the body
 * with spaces, then reports a late failure *inside* it as
 * `{"_deferred_error": {status_code, detail}}`. Reading the status line alone
 * would report a failed download as a loaded model.
 *
 * **Input is validated, never cleaned.** A repository id and a quant label
 * reach Studio, which reaches Hugging Face; a nearly-valid id made plausible
 * fails later, somewhere nobody connects it back to the button. So
 * {@link isValidHfRepoId} and {@link isValidGgufVariant} refuse, and the client
 * returns `invalid-input` without sending anything.
 *
 * **What leaves the machine is Studio's to send, and the result says so.** A
 * load of a model that is not on disk makes Studio download it from Hugging
 * Face. AtlasMind does not forward a Hugging Face token: with an API key,
 * Studio refuses its own saved token too, so a gated repository answers
 * unauthorised and the right place to download it is Studio itself.
 *
 * **Third-party text is untrusted.** Every response is JSON from a process this
 * extension did not write. Nothing here throws; every failure is a typed
 * reason, and every `detail` shown to a person is control-stripped, clamped and
 * passed through the secret redactor, because an error message is exactly
 * where a server echoes back what it was sent.
 *
 * **Effects have names a scan can see.** The effectful methods are
 * `downloadAndLoad`, `unloadModel`, `cancelLoad` and `deleteDownload`, not
 * `load`/`unload`/`delete`: the dry-run coverage test cannot see a call through
 * an injected transport, so it matches these names instead, and a caller that
 * acts on Studio is forced to say which dry-run guard covers it.
 *
 * Transport and clock are injected, so this is unit-tested with no Studio
 * running.
 */

import type { FetchLike } from './localRuntimeClient.js';
import { redactSecrets } from '../utils/secretRedactor.js';

/** When the contract below was read from Studio's source. */
export const UNSLOTH_STUDIO_VERIFIED_AT = '2026-10-18';
/** The Studio release whose source the contract was read from. */
export const UNSLOTH_STUDIO_VERIFIED_RELEASE = 'v0.1.908-beta';

/** Studio's default port (`studio/backend/run.py`, `--port` default). Also Jupyter's. */
export const UNSLOTH_STUDIO_DEFAULT_PORT = '8888';
/** The OpenAI-compatible base URL a default `unsloth studio` serves. */
export const UNSLOTH_STUDIO_DEFAULT_BASE_URL = 'http://127.0.0.1:8888/v1';
/** What `GET /api/liveness` names itself as. The identity check, and the only one. */
export const UNSLOTH_STUDIO_SERVICE = 'Unsloth UI Backend';
/** The `owned_by` marker on every `/v1/models` entry Studio lists. */
export const UNSLOTH_OWNED_BY = 'unsloth-studio';
/** Every Studio API key starts with this. */
export const UNSLOTH_API_KEY_PREFIX = 'sk-unsloth-';
/** The Hugging Face organisation whose GGUF builds the discovery catalogue lists. */
export const UNSLOTH_HUB_AUTHOR = 'unsloth';

/**
 * Added to every chat completion sent to an Unsloth endpoint.
 *
 * Both are declared fields on Studio's `ChatCompletionRequest`, so sending
 * them can never get a request refused. `enable_tools: false` beats the
 * launcher's tools-on default; `mcp_enabled: false` keeps Studio's own MCP
 * servers out of the loop as well.
 */
export const UNSLOTH_SERVER_TOOLS_OFF: Readonly<{ enable_tools: false; mcp_enabled: false }> = Object.freeze({
  enable_tools: false,
  mcp_enabled: false,
});

/** The one sentence every surface that connects Studio must show. */
export const UNSLOTH_TOOL_POLICY_CAVEAT =
  'AtlasMind asks Unsloth Studio to keep its own server-side tools (Python, shell, web search) off on every request, '
  + 'because anything Studio runs itself bypasses AtlasMind\'s approvals, sandbox and dry run. A Studio started with '
  + '`--enable-tools` overrides that request, and AtlasMind cannot read which policy a process was started with — '
  + 'start it with `--disable-tools` to make the setting one the server cannot be talked out of.';

/** Why a call produced no value. */
export type UnslothFailureReason =
  /** Nothing answered, or it timed out. */
  | 'unreachable'
  /** Something answered, but `/api/liveness` did not name Unsloth Studio. The key was not sent. */
  | 'not-unsloth'
  /** No API key is stored for this endpoint. Nothing was sent that needed one. */
  | 'no-key'
  /** Studio rejected the key (401/403), or a gated repository needs a Hugging Face token. */
  | 'unauthorized'
  /** AtlasMind refused to send: a repository id, quant or model id failed validation. */
  | 'invalid-input'
  /** Studio answered with an error, including one deferred into a padded 200. */
  | 'refused'
  /** Studio answered 2xx with a body that could not be read. */
  | 'malformed';

export type UnslothResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: UnslothFailureReason; status?: number; detail?: string };

/** What `GET /api/inference/status` says is in memory. */
export interface UnslothStatus {
  /** Studio's display id for the primary model, when one is active. */
  activeModel?: string;
  /** The quant the active model was loaded at, when it is a GGUF. */
  ggufVariant?: string;
  /** Models resident in memory, by the id `/v1/models` lists them under. */
  loaded: string[];
  /** Models answering requests: the active one and every one kept alongside. */
  serving: string[];
  /** Loads in flight. */
  loading: string[];
}

/** One GGUF repository Studio has on disk (`GET /api/models/cached-gguf`). */
export interface UnslothDownloadedModel {
  repoId: string;
  /** Total GGUF bytes on disk. `undefined` when not reported — never read as zero. */
  sizeBytes?: number;
  hasVision: boolean;
  /** A cancelled or interrupted download: on disk, not loadable. */
  partial: boolean;
  /** Seconds since the epoch, as Studio reports it, converted to milliseconds. */
  lastModifiedMs?: number;
}

/** One quantisation a repository offers (`GET /api/models/gguf-variants`). */
export interface UnslothGgufVariant {
  /** The quant label Studio loads by, e.g. `Q4_K_M` or `UD-Q4_K_XL`. */
  quant: string;
  /** What a picker should show, where Studio supplies one. */
  displayLabel?: string;
  /** Size of the weights. `0` where Studio did not know. */
  sizeBytes: number;
  /** Bytes a download would actually fetch (shards, companions). */
  downloadSizeBytes: number;
  downloaded: boolean;
  partial: boolean;
  contextLength?: number;
}

export interface UnslothVariantListing {
  repoId: string;
  variants: UnslothGgufVariant[];
  /** The quant Studio itself would pick. */
  defaultVariant?: string;
  hasVision: boolean;
  contextLength?: number;
}

/** `GET /api/models/gguf-download-progress`. Display only — never a completion signal. */
export interface UnslothDownloadProgress {
  downloadedBytes: number;
  expectedBytes: number;
  /** `downloadedBytes / expectedBytes`, clamped to 0..1; `undefined` when the total is unknown. */
  fraction?: number;
  completeOnDisk: boolean;
}

/** What a successful `POST /api/inference/load` reports. */
export interface UnslothLoadOutcome {
  /** The model id Studio now serves it under. */
  model: string;
  displayName?: string;
  /** Models Studio unloaded to make room — worth telling the person who asked. */
  evicted: string[];
  /** Studio's own non-blocking advisory about the load, when it has one. */
  memoryWarning?: string;
}

// ── Validation ───────────────────────────────────────────────────────────────

const HF_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9_])?$/;

/**
 * Whether a string is a Hugging Face `owner/name` repository id.
 *
 * Refuses rather than cleans: a leading `hf:` is the caller's to strip, and a
 * `..` segment, a third segment, whitespace or a URL is not a repository.
 */
export function isValidHfRepoId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 192) { return false; }
  const parts = value.split('/');
  if (parts.length !== 2) { return false; }
  return parts.every(part => HF_SEGMENT.test(part) && !part.includes('..'));
}

/** Whether a string is a GGUF quant label Studio could load by (`Q4_K_M`, `UD-IQ2_XXS`, `BF16`). */
export function isValidGgufVariant(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/.test(value);
}

/**
 * Whether a string has the shape of a Studio API key.
 *
 * Studio mints `sk-unsloth-` + 32 hex characters. The check accepts a wider
 * body than that so a future key format is not refused by AtlasMind before
 * Studio has had the chance to accept it; Studio, not this function, decides
 * whether a key is valid.
 */
export function isPlausibleUnslothApiKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith(UNSLOTH_API_KEY_PREFIX)
    && /^sk-unsloth-[A-Za-z0-9_-]{16,128}$/.test(value);
}

/** A model id as Studio reports it, for unloading. Printable and bounded; nothing else is assumed. */
export function isValidUnslothModelId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value);
}

/** An attempt id for a cancellable load. Generated by the caller; validated here. */
export function isValidLoadRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
}

/** `hf:unsloth/Foo-GGUF` → `unsloth/Foo-GGUF`; anything else is returned as given, for validation. */
export function repoIdFromCatalogTag(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.startsWith('hf:')) { return trimmed.slice(3); }
  if (trimmed.startsWith('hf.co/')) { return trimmed.slice(6); }
  return trimmed;
}

// ── Parsing (untrusted third-party JSON) ─────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonEmptyString(value: unknown, max = 512): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) { return undefined; }
  return trimmed;
}

function stringList(value: unknown, cap = 64): string[] {
  if (!Array.isArray(value)) { return []; }
  const out: string[] = [];
  for (const entry of value) {
    const text = nonEmptyString(entry);
    if (text && !out.includes(text)) { out.push(text); }
    if (out.length >= cap) { break; }
  }
  return out;
}

const DETAIL_MAX = 300;

/**
 * Text from Studio, made safe to show a person.
 *
 * FastAPI reports a failure as `{"detail": "…"}` or, for a validation error, a
 * list of `{msg}` objects; both are accepted. Control characters go, whitespace
 * collapses, the result is clamped, and the secret redactor runs last — an
 * error message is where a server echoes back what it was sent.
 */
export function sanitizeUnslothDetail(value: unknown): string | undefined {
  let text: string | undefined;
  if (typeof value === 'string') {
    text = value;
  } else if (Array.isArray(value)) {
    text = value
      .map(entry => (typeof entry === 'string' ? entry : asRecord(entry)?.['msg']))
      .filter((entry): entry is string => typeof entry === 'string')
      .join('; ');
  } else if (asRecord(value) && typeof asRecord(value)?.['message'] === 'string') {
    text = asRecord(value)?.['message'] as string;
  }
  if (!text) { return undefined; }
  const flattened = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flattened) { return undefined; }
  const clamped = flattened.length > DETAIL_MAX ? `${flattened.slice(0, DETAIL_MAX - 1)}…` : flattened;
  return redactSecrets(clamped).text;
}

/** `GET /api/liveness`. Only an exact service name is an identity. */
export function parseUnslothLiveness(payload: unknown): { isUnsloth: boolean } {
  const record = asRecord(payload);
  return { isUnsloth: record?.['service'] === UNSLOTH_STUDIO_SERVICE };
}

/** `GET /api/inference/status`. */
export function parseUnslothStatus(payload: unknown): UnslothStatus | undefined {
  const record = asRecord(payload);
  if (!record) { return undefined; }
  const activeModel = nonEmptyString(record['active_model']);
  const ggufVariant = nonEmptyString(record['gguf_variant'], 64);
  return {
    ...(activeModel ? { activeModel } : {}),
    ...(ggufVariant ? { ggufVariant } : {}),
    loaded: stringList(record['loaded']),
    serving: stringList(record['serving']),
    loading: stringList(record['loading']),
  };
}

/**
 * `GET /api/models/cached-gguf` → `{cached: [...]}`.
 *
 * `cache_path` is deliberately not kept: it is a host path (Studio redacts it
 * for API-key callers anyway), and nothing AtlasMind does needs to know where
 * Studio keeps its files. A row whose repository id does not validate is
 * dropped — it could not be loaded or deleted by id, so offering it would offer
 * a button that cannot work.
 */
export function parseUnslothCachedGguf(payload: unknown, cap = 200): UnslothDownloadedModel[] {
  const rows = asRecord(payload)?.['cached'];
  if (!Array.isArray(rows)) { return []; }
  const out: UnslothDownloadedModel[] = [];
  for (const entry of rows) {
    const row = asRecord(entry);
    const repoId = row?.['repo_id'];
    if (!row || !isValidHfRepoId(repoId)) { continue; }
    if (out.some(existing => existing.repoId.toLowerCase() === repoId.toLowerCase())) { continue; }
    const sizeBytes = nonNegativeNumber(row['size_bytes']);
    const lastModified = nonNegativeNumber(row['last_modified']);
    out.push({
      repoId,
      ...(sizeBytes !== undefined && sizeBytes > 0 ? { sizeBytes } : {}),
      hasVision: row['has_vision'] === true,
      partial: row['partial'] === true,
      ...(lastModified !== undefined && lastModified > 0 ? { lastModifiedMs: Math.round(lastModified * 1000) } : {}),
    });
    if (out.length >= cap) { break; }
  }
  return out;
}

/** `GET /api/models/gguf-variants`. A variant whose quant does not validate cannot be loaded by it, so it is dropped. */
export function parseUnslothGgufVariants(payload: unknown, cap = 64): UnslothVariantListing | undefined {
  const record = asRecord(payload);
  const repoId = record?.['repo_id'];
  if (!record || !isValidHfRepoId(repoId) || !Array.isArray(record['variants'])) { return undefined; }
  const variants: UnslothGgufVariant[] = [];
  for (const entry of record['variants']) {
    const row = asRecord(entry);
    const quant = row?.['quant'];
    if (!row || !isValidGgufVariant(quant)) { continue; }
    if (variants.some(existing => existing.quant.toLowerCase() === quant.toLowerCase())) { continue; }
    const sizeBytes = nonNegativeNumber(row['size_bytes']) ?? 0;
    const downloadSizeBytes = nonNegativeNumber(row['download_size_bytes']) ?? sizeBytes;
    const contextLength = nonNegativeNumber(row['context_length']);
    const displayLabel = nonEmptyString(row['display_label'], 120);
    variants.push({
      quant,
      ...(displayLabel ? { displayLabel } : {}),
      sizeBytes,
      downloadSizeBytes,
      downloaded: row['downloaded'] === true,
      partial: row['partial'] === true,
      ...(contextLength !== undefined && contextLength > 0 ? { contextLength: Math.round(contextLength) } : {}),
    });
    if (variants.length >= cap) { break; }
  }
  const defaultVariant = isValidGgufVariant(record['default_variant']) ? record['default_variant'] : undefined;
  const contextLength = nonNegativeNumber(record['context_length']);
  return {
    repoId,
    variants,
    ...(defaultVariant ? { defaultVariant } : {}),
    hasVision: record['has_vision'] === true,
    ...(contextLength !== undefined && contextLength > 0 ? { contextLength: Math.round(contextLength) } : {}),
  };
}

/** `GET /api/models/gguf-download-progress`. Studio's own `progress` field is not trusted; the ratio is recomputed. */
export function parseUnslothDownloadProgress(payload: unknown): UnslothDownloadProgress | undefined {
  const record = asRecord(payload);
  if (!record) { return undefined; }
  const downloadedBytes = nonNegativeNumber(record['downloaded_bytes']) ?? 0;
  const expectedBytes = nonNegativeNumber(record['expected_bytes']) ?? 0;
  return {
    downloadedBytes,
    expectedBytes,
    ...(expectedBytes > 0 ? { fraction: Math.min(1, Math.max(0, downloadedBytes / expectedBytes)) } : {}),
    completeOnDisk: record['complete_on_disk'] === true,
  };
}

/**
 * Read a `/load` or `/unload` body, padded or not.
 *
 * Leading spaces are the padding (JSON allows them); `_deferred_error` is a
 * failure that arrived after the status line had already said 200.
 */
export function parseUnslothDeferredBody(text: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: 'refused' | 'malformed'; status?: number; detail?: string } {
  const trimmed = text.trim();
  if (!trimmed) { return { ok: false, reason: 'malformed', detail: 'Unsloth Studio returned an empty response.' }; }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: 'malformed', detail: 'Unsloth Studio returned a response that is not JSON.' };
  }
  const record = asRecord(parsed);
  if (!record) { return { ok: false, reason: 'malformed', detail: 'Unsloth Studio returned an unexpected response.' }; }
  const deferred = asRecord(record['_deferred_error']);
  if (deferred) {
    const status = nonNegativeNumber(deferred['status_code']);
    const detail = sanitizeUnslothDetail(deferred['detail']);
    return { ok: false, reason: 'refused', ...(status !== undefined ? { status } : {}), ...(detail ? { detail } : {}) };
  }
  return { ok: true, payload: record };
}

// ── Which quant to suggest ──────────────────────────────────────────────────

/**
 * The share of VRAM a quant's weights may take and still be said to fit — the
 * rest is the context cache and the runtime's own overhead. A suggestion, not a
 * promise; Studio decides what it will actually offload.
 */
export const UNSLOTH_VARIANT_FIT_FRACTION = 0.85;

export type UnslothVariantRuleId =
  | 'downloaded-fits'
  | 'default-fits'
  | 'largest-fits'
  | 'smallest-offloads'
  | 'downloaded-unmeasured'
  | 'default-unmeasured'
  | 'smallest-unmeasured';

/** The suggestion rules, in the order they are tried. Published with every suggestion. */
export const UNSLOTH_VARIANT_RULES: ReadonlyArray<{ id: UnslothVariantRuleId; description: string }> = [
  { id: 'downloaded-fits', description: 'Already downloaded and fits in VRAM: no download and no CPU offload. The largest such.' },
  { id: 'default-fits', description: "Unsloth's own default quant, when it fits in VRAM." },
  { id: 'largest-fits', description: 'The largest quant that fits in VRAM with room left for the context cache.' },
  { id: 'smallest-offloads', description: 'Nothing fits: the smallest quant, which will partly run on the CPU and be slower.' },
  { id: 'downloaded-unmeasured', description: 'VRAM could not be measured: the largest quant already downloaded.' },
  { id: 'default-unmeasured', description: "VRAM could not be measured: Unsloth's own default quant." },
  { id: 'smallest-unmeasured', description: 'VRAM could not be measured and Unsloth names no default: the smallest quant.' },
];

export interface UnslothVariantSuggestion {
  quant: string;
  rule: UnslothVariantRuleId;
  /** `undefined` when VRAM was not measured or the quant's size is unknown — never guessed. */
  fits?: boolean;
}

/** Whether a quant fits in the given VRAM. `undefined` when either figure is unknown. */
export function variantFitsVram(variant: UnslothGgufVariant, vramBytes: number | undefined): boolean | undefined {
  if (vramBytes === undefined || !(vramBytes > 0) || !(variant.sizeBytes > 0)) { return undefined; }
  return variant.sizeBytes <= vramBytes * UNSLOTH_VARIANT_FIT_FRACTION;
}

/**
 * Which quant to put first in a picker.
 *
 * A partial download is never suggested: it is neither loadable as it stands
 * nor a reason to prefer that quant. Returns `undefined` only when there is
 * nothing to suggest.
 */
export function suggestUnslothVariant(
  listing: Pick<UnslothVariantListing, 'variants' | 'defaultVariant'>,
  vramBytes: number | undefined,
): UnslothVariantSuggestion | undefined {
  const candidates = listing.variants.filter(variant => !variant.partial);
  if (candidates.length === 0) { return undefined; }
  const bySizeDesc = [...candidates].sort((left, right) => right.sizeBytes - left.sizeBytes || left.quant.localeCompare(right.quant));
  const bySizeAsc = [...bySizeDesc].reverse();
  const defaultVariant = listing.defaultVariant
    ? candidates.find(variant => variant.quant.toLowerCase() === listing.defaultVariant!.toLowerCase())
    : undefined;
  const measured = vramBytes !== undefined && vramBytes > 0;

  if (measured) {
    const downloadedFit = bySizeDesc.find(variant => variant.downloaded && variantFitsVram(variant, vramBytes) === true);
    if (downloadedFit) { return { quant: downloadedFit.quant, rule: 'downloaded-fits', fits: true }; }
    if (defaultVariant && variantFitsVram(defaultVariant, vramBytes) === true) {
      return { quant: defaultVariant.quant, rule: 'default-fits', fits: true };
    }
    const largestFit = bySizeDesc.find(variant => variantFitsVram(variant, vramBytes) === true);
    if (largestFit) { return { quant: largestFit.quant, rule: 'largest-fits', fits: true }; }
    const smallest = bySizeAsc.find(variant => variant.sizeBytes > 0) ?? bySizeAsc[0];
    const fits = variantFitsVram(smallest, vramBytes);
    return { quant: smallest.quant, rule: 'smallest-offloads', ...(fits !== undefined ? { fits } : {}) };
  }

  const downloaded = bySizeDesc.find(variant => variant.downloaded);
  if (downloaded) { return { quant: downloaded.quant, rule: 'downloaded-unmeasured' }; }
  if (defaultVariant) { return { quant: defaultVariant.quant, rule: 'default-unmeasured' }; }
  const smallest = bySizeAsc.find(variant => variant.sizeBytes > 0) ?? bySizeAsc[0];
  return { quant: smallest.quant, rule: 'smallest-unmeasured' };
}

// ── Discovery: Unsloth's own GGUF builds on Hugging Face ─────────────────────

/** The public listing the catalogue reads. Sorted by downloads; nothing of the project is sent. */
export const UNSLOTH_HUB_LISTING_URL =
  `https://huggingface.co/api/models?author=${UNSLOTH_HUB_AUTHOR}&filter=gguf&sort=downloads&direction=-1&limit=60`;

/**
 * Tags that make a repository something other than a chat model.
 *
 * Unsloth's organisation publishes GGUF builds of video, image and speech
 * models beside the language models, and several rank near the top by
 * downloads. A recommendation list that offered a video generator as a coding
 * model would be wrong in the way that costs a 30 GB download to find out.
 */
export const UNSLOTH_HUB_EXCLUDED_TAGS: readonly string[] = [
  'text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'image-text-to-video', 'video-generation',
  'text-to-speech', 'text-to-audio', 'audio-to-audio', 'automatic-speech-recognition',
  'feature-extraction', 'sentence-similarity', 'text-classification', 'token-classification',
  'stable-diffusion.cpp', 'diffusers', 'sentence-transformers',
];

/** Pipeline tags that mean "talks". A repository needs one of these or the `conversational` tag. */
export const UNSLOTH_HUB_CHAT_PIPELINES: readonly string[] = ['text-generation', 'image-text-to-text'];

export interface UnslothHubModel {
  repoId: string;
  downloads: number;
  hasVision: boolean;
}

/**
 * Read the Hugging Face listing. **Include by evidence, exclude by evidence:**
 * a repository is listed only when it carries the `conversational` tag or a
 * chat pipeline tag, and never when it carries an excluded tag — the top
 * repository by downloads carries no pipeline tag at all, only `conversational`,
 * so the pipeline tag alone would miss it.
 */
export function parseUnslothHubListing(payload: unknown, cap = 30): UnslothHubModel[] {
  if (!Array.isArray(payload)) { return []; }
  const out: UnslothHubModel[] = [];
  for (const entry of payload) {
    const row = asRecord(entry);
    const repoId = row?.['id'];
    if (!row || !isValidHfRepoId(repoId)) { continue; }
    if (!repoId.toLowerCase().startsWith(`${UNSLOTH_HUB_AUTHOR}/`)) { continue; }
    if (row['private'] === true || row['gated'] === true || row['gated'] === 'auto' || row['gated'] === 'manual') { continue; }
    const tags = Array.isArray(row['tags'])
      ? row['tags'].filter((tag): tag is string => typeof tag === 'string').map(tag => tag.toLowerCase())
      : [];
    const pipeline = typeof row['pipeline_tag'] === 'string' ? row['pipeline_tag'].toLowerCase() : undefined;
    const all = pipeline ? [...tags, pipeline] : tags;
    if (all.some(tag => UNSLOTH_HUB_EXCLUDED_TAGS.includes(tag))) { continue; }
    const chat = tags.includes('conversational') || (pipeline !== undefined && UNSLOTH_HUB_CHAT_PIPELINES.includes(pipeline));
    if (!chat) { continue; }
    if (out.some(existing => existing.repoId.toLowerCase() === repoId.toLowerCase())) { continue; }
    out.push({
      repoId,
      downloads: nonNegativeNumber(row['downloads']) ?? 0,
      hasVision: pipeline === 'image-text-to-text' || tags.includes('image-text-to-text') || tags.includes('multimodal'),
    });
    if (out.length >= cap) { break; }
  }
  return out;
}

// ── The client ──────────────────────────────────────────────────────────────

export interface UnslothStudioClientDeps {
  fetch?: FetchLike;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  /** The endpoint's own key. Read per call, so a key stored after the client was made is used. */
  getApiKey?: () => Promise<string | undefined> | string | undefined;
  now?: () => number;
}

export interface UnslothStudioClient {
  readonly origin: string;
  /** Unauthenticated. Says whether anything answered and whether it was Studio. */
  probe(signal?: AbortSignal): Promise<{ reachable: boolean; isUnsloth: boolean }>;
  status(signal?: AbortSignal): Promise<UnslothResult<UnslothStatus>>;
  listDownloaded(signal?: AbortSignal): Promise<UnslothResult<UnslothDownloadedModel[]>>;
  listVariants(repoId: string, signal?: AbortSignal): Promise<UnslothResult<UnslothVariantListing>>;
  downloadProgress(request: { repoId: string; variant: string; expectedBytes?: number }, signal?: AbortSignal): Promise<UnslothResult<UnslothDownloadProgress>>;
  /** Downloads first when the quant is not on disk. Long-running; cancel with {@link cancelLoad}. */
  downloadAndLoad(request: { repoId: string; variant: string; loadRequestId: string }, signal?: AbortSignal): Promise<UnslothResult<UnslothLoadOutcome>>;
  /** Cancels only that attempt. Studio guarantees it never unloads a resident model. */
  cancelLoad(request: { repoId: string; loadRequestId: string }, signal?: AbortSignal): Promise<UnslothResult<void>>;
  unloadModel(modelId: string, signal?: AbortSignal): Promise<UnslothResult<void>>;
  /** Studio refuses while the model is loaded; the refusal's detail says so. */
  deleteDownload(request: { repoId: string; variant?: string }, signal?: AbortSignal): Promise<UnslothResult<void>>;
}

const PROBE_TIMEOUT_MS = 4_000;
const READ_TIMEOUT_MS = 15_000;
/** Variant listing may ask Hugging Face for the repository's files. */
const VARIANTS_TIMEOUT_MS = 60_000;
/** Studio measures a 600 GB teardown at 160 s. */
const UNLOAD_TIMEOUT_MS = 10 * 60_000;
const DELETE_TIMEOUT_MS = 2 * 60_000;
/** A multi-hundred-gigabyte download is a long afternoon; past this, the caller's own cancel is the control. */
const LOAD_TIMEOUT_MS = 6 * 60 * 60_000;
/** How long a confirmed identity is trusted before `/api/liveness` is asked again. */
export const UNSLOTH_IDENTITY_TTL_MS = 30_000;

type HttpOutcome =
  | { kind: 'response'; ok: boolean; status: number; text: string }
  | { kind: 'unreachable' };

export function createUnslothStudioClient(origin: string, deps?: UnslothStudioClientDeps): UnslothStudioClient {
  const fetchLike = deps?.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const timers = deps?.timers ?? { setTimeout, clearTimeout };
  const now = deps?.now ?? (() => Date.now());
  let identityConfirmedAt: number | undefined;

  async function send(
    pathAndQuery: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<HttpOutcome> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) { controller.abort(); }
    const timer = timers.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchLike(`${origin}${pathAndQuery}`, { ...init, signal: controller.signal });
      const text = await response.text();
      return { kind: 'response', ok: response.ok, status: response.status, text };
    } catch {
      return { kind: 'unreachable' };
    } finally {
      timers.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function probe(signal?: AbortSignal): Promise<{ reachable: boolean; isUnsloth: boolean }> {
    const outcome = await send('/api/liveness', { method: 'GET' }, PROBE_TIMEOUT_MS, signal);
    if (outcome.kind === 'unreachable') { return { reachable: false, isUnsloth: false }; }
    let payload: unknown;
    try { payload = JSON.parse(outcome.text); } catch { payload = undefined; }
    const isUnsloth = outcome.ok && parseUnslothLiveness(payload).isUnsloth;
    if (isUnsloth) { identityConfirmedAt = now(); }
    return { reachable: true, isUnsloth };
  }

  /** The gate in front of every request that carries the key. */
  async function authorise(signal?: AbortSignal): Promise<{ ok: true; key: string } | { ok: false; reason: UnslothFailureReason; detail?: string }> {
    const fresh = identityConfirmedAt !== undefined && now() - identityConfirmedAt < UNSLOTH_IDENTITY_TTL_MS;
    if (!fresh) {
      const probed = await probe(signal);
      if (!probed.reachable) { return { ok: false, reason: 'unreachable' }; }
      if (!probed.isUnsloth) {
        return {
          ok: false,
          reason: 'not-unsloth',
          detail: `${origin} answered, but not as Unsloth Studio, so the API key was not sent.`,
        };
      }
    }
    let key: string | undefined;
    try {
      key = (await deps?.getApiKey?.())?.trim();
    } catch {
      key = undefined;
    }
    if (!key) { return { ok: false, reason: 'no-key' }; }
    return { ok: true, key };
  }

  async function authed(
    pathAndQuery: string,
    init: { method: string; body?: unknown },
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ ok: true; text: string; status: number } | { ok: false; reason: UnslothFailureReason; status?: number; detail?: string }> {
    const gate = await authorise(signal);
    if (!gate.ok) { return gate; }
    const headers: Record<string, string> = { Authorization: `Bearer ${gate.key}` };
    if (init.body !== undefined) { headers['Content-Type'] = 'application/json'; }
    const outcome = await send(
      pathAndQuery,
      { method: init.method, headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) },
      timeoutMs,
      signal,
    );
    if (outcome.kind === 'unreachable') { return { ok: false, reason: 'unreachable' }; }
    if (!outcome.ok) {
      let detail: string | undefined;
      try { detail = sanitizeUnslothDetail(asRecord(JSON.parse(outcome.text))?.['detail']); } catch { detail = undefined; }
      if (outcome.status === 401 || outcome.status === 403) {
        // A rejected key may have been revoked; the next call asks again.
        identityConfirmedAt = undefined;
        return { ok: false, reason: 'unauthorized', status: outcome.status, ...(detail ? { detail } : {}) };
      }
      return { ok: false, reason: 'refused', status: outcome.status, ...(detail ? { detail } : {}) };
    }
    return { ok: true, text: outcome.text, status: outcome.status };
  }

  function readJson<T>(text: string, parse: (payload: unknown) => T | undefined): UnslothResult<T> {
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { return { ok: false, reason: 'malformed' }; }
    const value = parse(payload);
    return value === undefined ? { ok: false, reason: 'malformed' } : { ok: true, value };
  }

  return {
    origin,
    probe,

    async status(signal) {
      const response = await authed('/api/inference/status', { method: 'GET' }, READ_TIMEOUT_MS, signal);
      if (!response.ok) { return response; }
      return readJson(response.text, parseUnslothStatus);
    },

    async listDownloaded(signal) {
      const response = await authed('/api/models/cached-gguf', { method: 'GET' }, READ_TIMEOUT_MS, signal);
      if (!response.ok) { return response; }
      return readJson(response.text, payload => (asRecord(payload) ? parseUnslothCachedGguf(payload) : undefined));
    },

    async listVariants(repoId, signal) {
      if (!isValidHfRepoId(repoId)) { return { ok: false, reason: 'invalid-input', detail: 'Not a Hugging Face repository id.' }; }
      const response = await authed(
        `/api/models/gguf-variants?repo_id=${encodeURIComponent(repoId)}`,
        { method: 'GET' },
        VARIANTS_TIMEOUT_MS,
        signal,
      );
      if (!response.ok) { return response; }
      return readJson(response.text, parseUnslothGgufVariants);
    },

    async downloadProgress(request, signal) {
      if (!isValidHfRepoId(request.repoId) || !isValidGgufVariant(request.variant)) {
        return { ok: false, reason: 'invalid-input' };
      }
      const expected = Math.max(0, Math.floor(request.expectedBytes ?? 0));
      const query = `repo_id=${encodeURIComponent(request.repoId)}&variant=${encodeURIComponent(request.variant)}&expected_bytes=${expected}`;
      const response = await authed(`/api/models/gguf-download-progress?${query}`, { method: 'GET' }, READ_TIMEOUT_MS, signal);
      if (!response.ok) { return response; }
      return readJson(response.text, parseUnslothDownloadProgress);
    },

    async downloadAndLoad(request, signal) {
      if (!isValidHfRepoId(request.repoId) || !isValidGgufVariant(request.variant) || !isValidLoadRequestId(request.loadRequestId)) {
        return { ok: false, reason: 'invalid-input', detail: 'The repository id or quant is not one AtlasMind will send.' };
      }
      const response = await authed('/api/inference/load', {
        method: 'POST',
        body: { model_path: request.repoId, gguf_variant: request.variant, load_request_id: request.loadRequestId },
      }, LOAD_TIMEOUT_MS, signal);
      if (!response.ok) { return response; }
      const body = parseUnslothDeferredBody(response.text);
      if (!body.ok) { return body; }
      const model = nonEmptyString(body.payload['model']);
      if (!model) { return { ok: false, reason: 'malformed', detail: 'Unsloth Studio did not say which model it loaded.' }; }
      const displayName = nonEmptyString(body.payload['display_name'], 200);
      const memoryWarning = sanitizeUnslothDetail(body.payload['memory_warning']);
      return {
        ok: true,
        value: {
          model,
          ...(displayName ? { displayName } : {}),
          evicted: stringList(body.payload['evicted']),
          ...(memoryWarning ? { memoryWarning } : {}),
        },
      };
    },

    async cancelLoad(request, signal) {
      if (!isValidHfRepoId(request.repoId) || !isValidLoadRequestId(request.loadRequestId)) {
        return { ok: false, reason: 'invalid-input' };
      }
      const response = await authed('/api/inference/unload', {
        method: 'POST',
        body: { model_path: request.repoId, cancel_load_request_id: request.loadRequestId },
      }, UNLOAD_TIMEOUT_MS, signal);
      if (!response.ok) { return response; }
      const body = parseUnslothDeferredBody(response.text);
      return body.ok ? { ok: true, value: undefined } : body;
    },

    async unloadModel(modelId, signal) {
      if (!isValidUnslothModelId(modelId)) { return { ok: false, reason: 'invalid-input' }; }
      const response = await authed('/api/inference/unload', {
        method: 'POST',
        body: { model_path: modelId },
      }, UNLOAD_TIMEOUT_MS, signal);
      if (!response.ok) { return response; }
      const body = parseUnslothDeferredBody(response.text);
      if (!body.ok) { return body; }
      // Studio answers `status: "unloaded"`. Anything else is not a confirmation.
      return body.payload['status'] === 'unloaded'
        ? { ok: true, value: undefined }
        : { ok: false, reason: 'malformed', detail: 'Unsloth Studio did not confirm the unload.' };
    },

    async deleteDownload(request, signal) {
      if (!isValidHfRepoId(request.repoId) || (request.variant !== undefined && !isValidGgufVariant(request.variant))) {
        return { ok: false, reason: 'invalid-input' };
      }
      const response = await authed('/api/models/delete-cached', {
        method: 'DELETE',
        body: { repo_id: request.repoId, ...(request.variant ? { variant: request.variant } : {}) },
      }, DELETE_TIMEOUT_MS, signal);
      if (!response.ok) { return response; }
      return { ok: true, value: undefined };
    },
  };
}

/** One line saying why a call failed, for a notification. Never includes the key. */
export function describeUnslothFailure(failure: { reason: UnslothFailureReason; status?: number; detail?: string }, origin?: string): string {
  const where = origin ? ` at ${origin}` : '';
  switch (failure.reason) {
    case 'unreachable':
      return `Unsloth Studio is not answering${where}. Start it with \`unsloth studio\` (or \`unsloth studio run --disable-tools\`) and try again.`;
    case 'not-unsloth':
      return failure.detail ?? `The server${where} did not identify itself as Unsloth Studio, so the API key was not sent.`;
    case 'no-key':
      return 'No Unsloth Studio API key is stored for this endpoint. Run "AtlasMind: Connect Unsloth Studio" to add one (create it in Studio under Settings → API Access).';
    case 'unauthorized':
      return `Unsloth Studio rejected the request (${failure.status ?? 401})${failure.detail ? `: ${failure.detail}` : ''}. The key may have been revoked; a gated Hugging Face repository has to be downloaded from Studio itself, which holds your Hugging Face token.`;
    case 'invalid-input':
      return failure.detail ?? 'AtlasMind refused to send that request: the repository id or quant is not valid.';
    case 'refused':
      return `Unsloth Studio refused${failure.status !== undefined ? ` (${failure.status})` : ''}${failure.detail ? `: ${failure.detail}` : '.'}`;
    case 'malformed':
      return failure.detail ?? 'Unsloth Studio answered, but not in a shape AtlasMind could read.';
  }
}
