/**
 * MissionRegistry — persistence + audit trail for autonomous mission runs.
 *
 * Like {@link ./deliveryManager}, persistence is `vscode`-free (node `fs` only)
 * so the serialisation logic is unit-testable in isolation. The single source of
 * truth is `project_memory/operations/missions.json`; a human-readable
 * `missions.md` runbook mirror is regenerated on every write so a developer can
 * audit what an unattended loop did without opening JSON.
 *
 * Safety-first:
 *  - No secret values are persisted — guardrails store labels/paths only, and
 *    long synthesis/output text is trimmed to a bounded preview before writing.
 *  - Records are capped ({@link MAX_MISSION_RECORDS}) so the audit log cannot
 *    grow without bound.
 */

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import type {
  MissionCapabilityRecord,
  MissionIterationResult,
  MissionRunRecord,
} from '../types.js';
import { MAX_MISSION_RECORDS, MAX_MISSION_TEXT_PERSIST } from '../constants.js';

export const MISSIONS_SSOT_PATH = 'project_memory/operations/missions.json';
export const MISSIONS_SUMMARY_SSOT_PATH = 'project_memory/operations/missions.md';

interface MissionStore {
  version: 1;
  missions: MissionRunRecord[];
}

function isMissionStore(value: unknown): value is MissionStore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return c['version'] === 1 && Array.isArray(c['missions']);
}

// ── Persistence (node fs; vscode-free) ───────────────────────────

export function readMissionStore(workspaceRoot: string): MissionStore {
  const storePath = path.join(workspaceRoot, MISSIONS_SSOT_PATH);
  try {
    const raw = readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isMissionStore(parsed) ? parsed : { version: 1, missions: [] };
  } catch {
    return { version: 1, missions: [] };
  }
}

export async function writeMissionStore(workspaceRoot: string, store: MissionStore): Promise<void> {
  const storePath = path.join(workspaceRoot, MISSIONS_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, MISSIONS_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(storePath), { recursive: true });
  await Promise.all([
    writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8'),
    writeFile(summaryPath, renderMissionsMarkdown(store.missions), 'utf-8'),
  ]);
}

// ── Trimming (keep the audit log lean; never persist huge outputs) ─

function trimText(value: string): string {
  if (value.length <= MAX_MISSION_TEXT_PERSIST) {
    return value;
  }
  return `${value.slice(0, MAX_MISSION_TEXT_PERSIST)}\n…[trimmed for audit]`;
}

function trimIteration(it: MissionIterationResult): MissionIterationResult {
  return {
    ...it,
    synthesis: trimText(it.synthesis ?? ''),
    subTaskResults: (it.subTaskResults ?? []).map(r => ({
      ...r,
      output: trimText(r.output ?? ''),
      // Drop heavy nested artifacts from the persisted audit copy.
      artifacts: undefined,
    })),
  };
}

/** Produce a persistence-safe copy of a record (trimmed text, deduped capabilities). */
export function toPersistedRecord(record: MissionRunRecord): MissionRunRecord {
  return {
    ...record,
    iterations: (record.iterations ?? []).map(trimIteration),
    createdCapabilities: dedupeCapabilities(record.createdCapabilities ?? []),
  };
}

function dedupeCapabilities(caps: MissionCapabilityRecord[]): MissionCapabilityRecord[] {
  const seen = new Set<string>();
  const out: MissionCapabilityRecord[] = [];
  for (const cap of caps) {
    const key = `${cap.kind}:${cap.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cap);
    }
  }
  return out;
}

// ── Markdown mirror ──────────────────────────────────────────────

export function renderMissionsMarkdown(missions: MissionRunRecord[]): string {
  const lines: string[] = [];
  lines.push('# Missions');
  lines.push('');
  lines.push('> Maintained by AtlasMind (Mission Control / `/loop`). Human-readable mirror of');
  lines.push('> `missions.json` — the audit trail of autonomous goal-seeking loop runs.');
  lines.push('');

  if (missions.length === 0) {
    lines.push('_No missions have been run yet._');
    lines.push('');
    return lines.join('\n');
  }

  const ordered = [...missions].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  for (const m of ordered) {
    lines.push(`## ${m.goal}`);
    lines.push('');
    lines.push(`- **Status:** ${m.status}${m.stopReason ? ` (${m.stopReason})` : ''}`);
    lines.push(`- **Outcome:** ${m.achieved ? '✅ goal achieved' : '⏹️ stopped without achieving the goal'}`);
    lines.push(`- **Iterations:** ${m.iterations.length} / ${m.config.budget.maxIterations}`);
    lines.push(`- **Cost:** $${m.totalCostUsd.toFixed(4)} / $${m.config.budget.maxCostUsd.toFixed(2)} cap`);
    lines.push(`- **Tokens:** ${m.totalInputTokens + m.totalOutputTokens} / ${m.config.budget.maxTokens} cap`);
    lines.push(`- **Started:** ${m.createdAt} · **Updated:** ${m.updatedAt}`);
    if (m.config.guardrails.instructions.length > 0) {
      lines.push(`- **Guardrails:** ${m.config.guardrails.instructions.map(g => `“${g}”`).join('; ')}`);
    }
    if (m.config.guardrails.protectedPaths && m.config.guardrails.protectedPaths.length > 0) {
      lines.push(`- **Protected paths:** ${m.config.guardrails.protectedPaths.map(p => `\`${p}\``).join(', ')}`);
    }
    lines.push('');

    if (m.iterations.length > 0) {
      lines.push('| # | Verdict | Confidence | Cost | Files | Next focus |');
      lines.push('|---|---|---|---|---|---|');
      for (const it of m.iterations) {
        const focus = (it.verdict.nextFocus || '—').replace(/\|/g, '\\|').slice(0, 80);
        lines.push(
          `| ${it.index} | ${it.verdict.verdict} | ${(it.verdict.confidence * 100).toFixed(0)}% | $${it.costUsd.toFixed(4)} | ${it.changedFiles.length} | ${focus} |`,
        );
      }
      lines.push('');
    }

    if (m.createdCapabilities.length > 0) {
      lines.push('**Capabilities discovered/created:**');
      for (const cap of m.createdCapabilities) {
        lines.push(`- ${cap.kind} \`${cap.id}\` (${cap.source})`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Workspace-scoped store for mission run records. Reads the persisted audit log
 * at construction; `save()` upserts a record, trims it, caps the history, and
 * regenerates the markdown mirror. Persistence is best-effort: if the workspace
 * is read-only the in-memory list is still updated.
 */
export class MissionRegistry {
  private missions: MissionRunRecord[];
  // Lightweight change notification (vscode-free): consumers such as the Cost
  // Dashboard subscribe to re-render live mission cost as iterations are saved.
  private readonly listeners = new Set<() => void>();

  constructor(private readonly workspaceRoot: string | undefined) {
    this.missions = workspaceRoot ? readMissionStore(workspaceRoot).missions : [];
  }

  list(): MissionRunRecord[] {
    return [...this.missions].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  get(id: string): MissionRunRecord | undefined {
    return this.missions.find(m => m.id === id);
  }

  /** Currently active mission runs (running or paused at a checkpoint). */
  listActive(): MissionRunRecord[] {
    return this.list().filter(m => m.status === 'running' || m.status === 'awaiting-checkpoint');
  }

  /** Subscribe to change notifications. Returns a disposable to unsubscribe. */
  onChange(listener: () => void): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private emitChange(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A failing subscriber must not break persistence or other listeners.
      }
    }
  }

  /**
   * Insert or update a mission record, then persist. The newest
   * {@link MAX_MISSION_RECORDS} records are retained.
   */
  async save(record: MissionRunRecord): Promise<void> {
    const persisted = toPersistedRecord({ ...record, updatedAt: new Date().toISOString() });
    const idx = this.missions.findIndex(m => m.id === persisted.id);
    if (idx >= 0) {
      this.missions[idx] = persisted;
    } else {
      this.missions.push(persisted);
    }
    // Keep only the newest N by createdAt.
    this.missions = [...this.missions]
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, MAX_MISSION_RECORDS);

    if (this.workspaceRoot) {
      try {
        await writeMissionStore(this.workspaceRoot, { version: 1, missions: this.missions });
      } catch {
        // Best-effort: in-memory state is still updated.
      }
    }
    this.emitChange();
  }
}
