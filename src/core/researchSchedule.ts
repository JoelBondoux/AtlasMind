/**
 * When a research scan is **due** — which is not the same as when one runs.
 *
 * A VS Code extension has no daemon, and these scans reach the network and spend
 * money on somebody else's model. AtlasMind's standing rule for both of those is
 * that nothing happens on a timer without an explicit opt-in, so this module
 * computes a *fact* — this scan is 41 days past its cadence — and leaves the
 * decision to the ladder above it.
 *
 * Four rules are enforced here rather than trusted to the caller.
 *
 * **A missed window is not a backlog.** Six weeks with the editor closed produces
 * one due scan, not six. Due-ness is derived from the last run, never accumulated,
 * because a queue of skipped runs would be an artefact of when somebody opened
 * their laptop rather than of anything that happened in the world.
 *
 * **The file asks; the settings decide.** A scan may request `auto` and get
 * `observe`, exactly as a workflow stage can. The effective level is
 * `min(master, scan)` and every reduction is stated in the same sentence as the
 * request — a ceiling that silently lowers something is a ceiling nobody can
 * debug.
 *
 * **A failed or source-less run is not an assessment.** `hasBeenScanned` is
 * deliberately strict about this: a scan that has only ever failed reports
 * `never`, not `current`. Reporting "last run: yesterday" for a run that answered
 * nothing is how a register earns silence by not looking.
 *
 * **A blocker is named, never implied.** Master gate off, no source, spend cap
 * reached — each produces a `blocked` state carrying the reason, because a scan
 * that simply never becomes due looks identical to one that is working fine.
 *
 * Pure and clock-injected: no `Date.now()`, no `vscode`, no I/O.
 */

import {
  RESEARCH_SCANS,
  isResearchScanId,
  type ResearchScanId,
} from './researchScanCatalog.js';
import { hasBeenScanned, lastRunFor, type ResearchRegister } from './researchRegister.js';

/** How far AtlasMind may go on its own. Ordered; `min` of two is the lower rung. */
export type ResearchAutomationLevel = 'observe' | 'propose' | 'auto';

const LEVEL_RANK: Readonly<Record<ResearchAutomationLevel, number>> = {
  observe: 0,
  propose: 1,
  auto: 2,
};

export function isResearchAutomationLevel(value: unknown): value is ResearchAutomationLevel {
  return value === 'observe' || value === 'propose' || value === 'auto';
}

/** The lower of two rungs. Deny-by-default in shape: an unknown value reads as `observe`. */
export function minAutomationLevel(
  a: ResearchAutomationLevel,
  b: ResearchAutomationLevel,
): ResearchAutomationLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

export interface ResearchScanSettings {
  readonly enabled?: boolean;
  readonly cadenceDays?: number;
  readonly automationLevel?: ResearchAutomationLevel;
}

export interface ResearchScheduleInput {
  /** `atlasmind.research.enabled`. Deny by default. */
  readonly enabled: boolean;
  /** `atlasmind.research.automationLevel` — the ceiling, not the value. */
  readonly masterLevel: ResearchAutomationLevel;
  /** Per-scan overrides, keyed by scan id. Unknown keys are ignored. */
  readonly scans: Readonly<Record<string, ResearchScanSettings>>;
  readonly register: ResearchRegister;
  /**
   * Whether any source can answer an external question right now. Absent means
   * *not determined* and is treated as unavailable — the safe direction.
   */
  readonly sourceAvailable: boolean;
  /** `0` means no automatic run may spend anything. */
  readonly monthlySpendCapUsd: number;
  readonly spentThisMonthUsd: number;
  readonly now: Date;
}

/**
 * `never` and `current` are the two that must not be confused: one says nothing
 * is known, the other says something is known and still fresh.
 */
export type ResearchDueState = 'never' | 'due' | 'current' | 'disabled' | 'blocked';

export interface ResearchScanStatus {
  readonly scanId: ResearchScanId;
  readonly label: string;
  readonly state: ResearchDueState;
  readonly effectiveLevel: ResearchAutomationLevel;
  /** Set whenever the effective level is lower than the scan asked for. */
  readonly levelReason?: string;
  readonly cadenceDays: number;
  readonly lastRunAt?: string;
  readonly daysSinceRun?: number;
  /** Negative when overdue. Absent when the scan has never produced an answer. */
  readonly dueInDays?: number;
  /** Why it cannot run, when it cannot. Named rather than implied. */
  readonly blocker?: string;
}

export interface ResearchSchedule {
  readonly scans: readonly ResearchScanStatus[];
  /** Enabled, unblocked, and past cadence. */
  readonly dueNow: readonly ResearchScanStatus[];
  /** Enabled and never assessed. Unknown, not clean. */
  readonly neverScanned: readonly ResearchScanStatus[];
  /** One line, for a status bar or an attention card. */
  readonly summary: string;
}

/** The default cadence a scan falls back to, clamped so a typo cannot mean "hourly". */
export const MIN_CADENCE_DAYS = 1;
export const MAX_CADENCE_DAYS = 365;

function resolveCadence(declared: number | undefined, fallback: number): number {
  if (typeof declared !== 'number' || !Number.isFinite(declared)) {
    return fallback;
  }
  return Math.min(MAX_CADENCE_DAYS, Math.max(MIN_CADENCE_DAYS, Math.round(declared)));
}

function daysBetween(from: number, to: number): number {
  return Math.floor((to - from) / 86_400_000);
}

export function buildResearchSchedule(input: ResearchScheduleInput): ResearchSchedule {
  const nowMs = input.now.getTime();
  const capReached = input.monthlySpendCapUsd <= 0
    || input.spentThisMonthUsd >= input.monthlySpendCapUsd;

  const scans: ResearchScanStatus[] = RESEARCH_SCANS.map(scan => {
    const settings: ResearchScanSettings = input.scans[scan.id] ?? {};
    const cadenceDays = resolveCadence(settings.cadenceDays, scan.cadenceDays);
    const requested: ResearchAutomationLevel = isResearchAutomationLevel(settings.automationLevel)
      ? settings.automationLevel
      : 'observe';
    const effectiveLevel = minAutomationLevel(input.masterLevel, requested);
    const levelReason = effectiveLevel === requested
      ? undefined
      : `Requested \`${requested}\`, capped to \`${effectiveLevel}\` by atlasmind.research.automationLevel.`;

    const run = lastRunFor(input.register, scan.id);
    const assessed = hasBeenScanned(input.register, scan.id);
    // `lastRunAt` reports the last *attempt*, because "tried yesterday and got
    // nothing" is worth seeing. `assessed` decides the state, because an attempt
    // that answered nothing is not an assessment.
    const lastRunAt = run?.ranAt;
    const daysSinceRun = run ? daysBetween(Date.parse(run.ranAt), nowMs) : undefined;

    const base = {
      scanId: scan.id,
      label: scan.label,
      effectiveLevel,
      ...(levelReason ? { levelReason } : {}),
      cadenceDays,
      ...(lastRunAt ? { lastRunAt } : {}),
      ...(daysSinceRun === undefined || Number.isNaN(daysSinceRun) ? {} : { daysSinceRun }),
    };

    if (!input.enabled) {
      return { ...base, state: 'disabled' as const, blocker: 'Research is switched off (atlasmind.research.enabled).' };
    }
    if (settings.enabled !== true) {
      return { ...base, state: 'disabled' as const, blocker: 'This scan has not been switched on.' };
    }
    if (!input.sourceAvailable) {
      return {
        ...base,
        state: 'blocked' as const,
        blocker: 'No research source is configured, so this scan could only guess.',
      };
    }
    if (effectiveLevel === 'auto' && capReached) {
      return {
        ...base,
        state: 'blocked' as const,
        blocker: input.monthlySpendCapUsd <= 0
          ? 'No monthly spend is allowed, so nothing may run automatically.'
          : 'The monthly research spend cap has been reached.',
      };
    }
    if (!assessed) {
      return { ...base, state: 'never' as const };
    }
    // Due-ness is measured from the last run that actually answered. A failed
    // attempt yesterday does not reset the clock on a scan that last worked in May.
    const lastOk = lastOkRunAt(input.register, scan.id);
    const sinceOk = lastOk === undefined ? undefined : daysBetween(lastOk, nowMs);
    const dueInDays = sinceOk === undefined ? undefined : cadenceDays - sinceOk;
    if (dueInDays !== undefined && dueInDays <= 0) {
      return { ...base, state: 'due' as const, dueInDays };
    }
    return { ...base, state: 'current' as const, ...(dueInDays === undefined ? {} : { dueInDays }) };
  });

  const dueNow = scans.filter(scan => scan.state === 'due');
  const neverScanned = scans.filter(scan => scan.state === 'never');
  return { scans, dueNow, neverScanned, summary: summarizeSchedule(scans, input.enabled) };
}

function lastOkRunAt(register: ResearchRegister, scanId: ResearchScanId): number | undefined {
  const ok = register.runs
    .filter(run => run.scanId === scanId && run.outcome === 'ok')
    .map(run => Date.parse(run.ranAt))
    .filter(value => !Number.isNaN(value))
    .sort((a, b) => b - a);
  return ok[0];
}

function summarizeSchedule(scans: readonly ResearchScanStatus[], enabled: boolean): string {
  if (!enabled) {
    return 'Research is switched off.';
  }
  const due = scans.filter(scan => scan.state === 'due').length;
  const never = scans.filter(scan => scan.state === 'never').length;
  const blocked = scans.filter(scan => scan.state === 'blocked').length;
  const parts: string[] = [];
  if (due > 0) {
    parts.push(`${due} due`);
  }
  if (never > 0) {
    parts.push(`${never} never assessed`);
  }
  if (blocked > 0) {
    parts.push(`${blocked} blocked`);
  }
  if (parts.length === 0) {
    const active = scans.filter(scan => scan.state === 'current').length;
    return active === 0
      // Not "all clear": nothing is switched on, so nothing was looked at.
      ? 'No research scans are switched on.'
      : `${active} scan${active === 1 ? '' : 's'} up to date.`;
  }
  return parts.join(', ') + '.';
}

/**
 * The one scan an automatic pass may run, or nothing.
 *
 * **One at a time, deliberately.** Seven scans coming due in the same week must
 * not become seven model runs on the morning somebody opens their editor. The
 * oldest overdue scan goes first — never-assessed ahead of overdue, because
 * unknown is a worse state than stale — and ties break on catalog order so the
 * choice cannot shuffle between activations.
 */
export function nextAutomaticScan(schedule: ResearchSchedule): ResearchScanStatus | undefined {
  const catalogOrder = new Map(RESEARCH_SCANS.map((scan, index) => [scan.id, index]));
  const eligible = schedule.scans.filter(scan =>
    scan.effectiveLevel === 'auto' && (scan.state === 'never' || scan.state === 'due'));
  if (eligible.length === 0) {
    return undefined;
  }
  return [...eligible].sort((a, b) => {
    if (a.state !== b.state) {
      return a.state === 'never' ? -1 : 1;
    }
    const overdueA = a.dueInDays ?? 0;
    const overdueB = b.dueInDays ?? 0;
    if (overdueA !== overdueB) {
      return overdueA - overdueB;
    }
    return (catalogOrder.get(a.scanId) ?? 0) - (catalogOrder.get(b.scanId) ?? 0);
  })[0];
}

/**
 * Read the per-scan settings block out of raw configuration.
 *
 * Configuration is user-editable JSON, so it is a boundary: an unknown scan id is
 * dropped rather than carried, and a malformed level reads as `observe`.
 */
export function sanitizeResearchScanSettings(
  value: unknown,
): Record<string, ResearchScanSettings> {
  const out: Record<string, ResearchScanSettings> = {};
  if (typeof value !== 'object' || value === null) {
    return out;
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isResearchScanId(key) || typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const cadence = typeof entry['cadenceDays'] === 'number' ? entry['cadenceDays'] : undefined;
    out[key] = {
      enabled: entry['enabled'] === true,
      ...(cadence === undefined ? {} : { cadenceDays: cadence }),
      automationLevel: isResearchAutomationLevel(entry['automationLevel'])
        ? entry['automationLevel']
        : 'observe',
    };
  }
  return out;
}
