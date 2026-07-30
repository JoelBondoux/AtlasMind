/**
 * The `atlasmind.research.*` settings, read once and in one place.
 *
 * Kept pure by taking a reader rather than importing `vscode`: a
 * `WorkspaceConfiguration` satisfies {@link ResearchConfigurationReader}
 * structurally, so the extension passes the real thing and a test passes a plain
 * object. The settings themselves are a boundary like any other — user-editable
 * JSON that reaches a scheduler which decides whether to spend money — so every
 * value is validated here and nothing downstream re-parses it.
 *
 * Two defaults are deliberate rather than conservative-by-habit.
 * `atlasmind.research.enabled` is `false` because a research scan reaches the
 * network and spends on somebody else's model, and `monthlySpendCapUsd` is `0`,
 * which means *no automatic run may spend anything*. Turning research on is a
 * decision; letting it run on its own is a second, separate one, and collapsing
 * them into a single switch would make the first one carry a cost nobody agreed
 * to.
 */

import {
  isResearchAutomationLevel,
  sanitizeResearchScanSettings,
  type ResearchAutomationLevel,
  type ResearchScanSettings,
} from './researchSchedule.js';
import { isResearchSourcePreference, type ResearchSourcePreference } from './researchSources.js';

/** The subset of `vscode.WorkspaceConfiguration` this needs. */
export interface ResearchConfigurationReader {
  get<T>(section: string): T | undefined;
}

export interface ResearchSettings {
  readonly enabled: boolean;
  readonly automationLevel: ResearchAutomationLevel;
  readonly scans: Readonly<Record<string, ResearchScanSettings>>;
  readonly searchSource: ResearchSourcePreference;
  readonly monthlySpendCapUsd: number;
}

/** A cap above which a typo stops being a budget and starts being an accident. */
export const MAX_MONTHLY_SPEND_CAP_USD = 1000;

export function readResearchSettings(configuration: ResearchConfigurationReader): ResearchSettings {
  const level = configuration.get<string>('research.automationLevel');
  const source = configuration.get<string>('research.searchSource');
  const cap = configuration.get<number>('research.monthlySpendCapUsd');
  return {
    enabled: configuration.get<boolean>('research.enabled') === true,
    automationLevel: isResearchAutomationLevel(level) ? level : 'observe',
    scans: sanitizeResearchScanSettings(configuration.get<unknown>('research.scans')),
    searchSource: isResearchSourcePreference(source) ? source : 'auto',
    monthlySpendCapUsd: typeof cap === 'number' && Number.isFinite(cap)
      ? Math.min(MAX_MONTHLY_SPEND_CAP_USD, Math.max(0, cap))
      : 0,
  };
}

/**
 * The counts the attention feed needs, or `undefined`.
 *
 * `undefined` when research is switched off — and that is the point of this
 * function existing rather than the caller assembling the object. Research is the
 * one attention-feed group whose absence means "deliberately off" rather than
 * "not assessed", and passing a group full of zeroes instead would make a
 * disabled feature raise items forever.
 */
export function researchAttentionInput(
  settings: ResearchSettings,
  schedule: { dueNow: readonly unknown[]; neverScanned: readonly unknown[]; scans: readonly { state: string }[] },
): { due: number; neverScanned: number; blocked: number } | undefined {
  if (!settings.enabled) {
    return undefined;
  }
  return {
    due: schedule.dueNow.length,
    neverScanned: schedule.neverScanned.length,
    blocked: schedule.scans.filter(scan => scan.state === 'blocked').length,
  };
}
