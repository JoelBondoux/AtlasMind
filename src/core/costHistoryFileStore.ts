/**
 * Reading and writing a project's cost history as a file.
 *
 * The boundary rule that matters here is the one about **older records**. A
 * history written before `workspaceKey` and `cacheWriteTokens` existed is still
 * real spend and must still load — but it must not acquire fields it never had.
 * Defaulting a missing `cacheWriteTokens` to `0` would make an unpriceable
 * record look repriceable, and defaulting `workspaceKey` to the current
 * workspace would put another project's spend on this project's roadmap item.
 * So both stay absent, `costRepricing` grades them `partial`, and the surface
 * says so.
 *
 * Beyond that this is an ordinary untrusted-input boundary: the file is on disk,
 * a person can edit it, and in the `repository` location a colleague's commit can
 * change it. It never throws, and anything unreadable yields an empty history
 * rather than a crash — with the count of entries that could not be read, since
 * silently dropping half a history is worse than reporting a short one.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CostRecord } from '../types.js';
import { COST_HISTORY_MAX_RECORDS } from './costHistoryLocation.js';

export interface CostHistoryReadResult {
  records: CostRecord[];
  /** Entries present in the file that could not be read as a cost record. */
  unreadableCount: number;
  /** False when the file does not exist — distinct from an empty history. */
  existed: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * One entry, or `undefined`.
 *
 * Optional fields are copied **only when present and valid**. That is the whole
 * point: an absent field stays absent so downstream grading can tell "not
 * reported" from "zero".
 */
export function sanitizeCostRecord(value: unknown): CostRecord | undefined {
  if (!value || typeof value !== 'object') { return undefined; }
  const raw = value as Record<string, unknown>;
  if (typeof raw['model'] !== 'string' || typeof raw['timestamp'] !== 'string') { return undefined; }
  if (!isFiniteNumber(raw['inputTokens']) || !isFiniteNumber(raw['outputTokens']) || !isFiniteNumber(raw['costUsd'])) {
    return undefined;
  }

  const str = (key: string): string | undefined =>
    typeof raw[key] === 'string' && raw[key] ? raw[key] as string : undefined;
  const num = (key: string): number | undefined =>
    isFiniteNumber(raw[key]) ? raw[key] as number : undefined;

  return {
    taskId: str('taskId') ?? '',
    agentId: str('agentId') ?? '',
    model: raw['model'],
    inputTokens: raw['inputTokens'],
    outputTokens: raw['outputTokens'],
    costUsd: raw['costUsd'],
    timestamp: raw['timestamp'],
    ...(str('providerId') ? { providerId: str('providerId') as CostRecord['providerId'] } : {}),
    ...(str('pricingModel') ? { pricingModel: str('pricingModel') as CostRecord['pricingModel'] } : {}),
    ...(str('billingCategory') ? { billingCategory: str('billingCategory') as CostRecord['billingCategory'] } : {}),
    ...(str('sessionId') ? { sessionId: str('sessionId')! } : {}),
    ...(str('messageId') ? { messageId: str('messageId')! } : {}),
    ...(str('workspaceKey') ? { workspaceKey: str('workspaceKey')! } : {}),
    ...(str('roadmapItemId') ? { roadmapItemId: str('roadmapItemId')! } : {}),
    ...(raw['roadmapAttribution'] === 'session' || raw['roadmapAttribution'] === 'explicit'
      ? { roadmapAttribution: raw['roadmapAttribution'] }
      : {}),
    ...(num('cachedInputTokens') !== undefined ? { cachedInputTokens: num('cachedInputTokens')! } : {}),
    ...(num('cacheWriteTokens') !== undefined ? { cacheWriteTokens: num('cacheWriteTokens')! } : {}),
    ...(num('budgetCostUsd') !== undefined ? { budgetCostUsd: num('budgetCostUsd')! } : {}),
    ...(num('compressionSavingsUsd') !== undefined ? { compressionSavingsUsd: num('compressionSavingsUsd')! } : {}),
    ...(num('cacheSavingsUsd') !== undefined ? { cacheSavingsUsd: num('cacheSavingsUsd')! } : {}),
  };
}

interface CostHistoryDocument {
  version: 1;
  records: unknown;
}

/** Never throws. A missing file is an empty history that says it was missing. */
export async function readCostHistoryFile(filePath: string): Promise<CostHistoryReadResult> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return { records: [], unreadableCount: 0, existed: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A corrupt file is reported as existing-but-unreadable rather than absent,
    // so a caller does not overwrite it believing there was nothing there.
    return { records: [], unreadableCount: 0, existed: true };
  }

  const entries = Array.isArray((parsed as CostHistoryDocument | undefined)?.records)
    ? (parsed as CostHistoryDocument).records as unknown[]
    : Array.isArray(parsed) ? parsed as unknown[] : [];

  const records: CostRecord[] = [];
  let unreadableCount = 0;
  for (const entry of entries) {
    const record = sanitizeCostRecord(entry);
    if (record) { records.push(record); } else { unreadableCount += 1; }
  }

  return {
    records: records.slice(-COST_HISTORY_MAX_RECORDS),
    unreadableCount,
    existed: true,
  };
}

/**
 * Write the history, newest-bounded.
 *
 * Written through a temporary file and renamed, because the `repository`
 * location is a file git watches: a half-written JSON document appearing in
 * `git status` during a crash is a worse failure than a lost final record.
 */
export async function writeCostHistoryFile(filePath: string, records: readonly CostRecord[]): Promise<void> {
  const bounded = records.slice(-COST_HISTORY_MAX_RECORDS);
  const document: CostHistoryDocument = { version: 1, records: bounded };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}

/** Remove a history after it has been moved elsewhere. Absent is success. */
export async function deleteCostHistoryFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Already gone, or never written. Either way the caller's intent is met.
  }
}
