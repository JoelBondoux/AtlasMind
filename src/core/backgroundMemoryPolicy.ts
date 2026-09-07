/**
 * Whether background memory work may call a model or write a file, and where.
 *
 * Until this existed, a timer registered during `activate()` sent up to 4 000
 * characters of raw project memory to whatever model routing picked — possibly a
 * cloud provider — with no redaction, no privacy classification, no approval and
 * no way to turn it off. It then wrote the model's reply back into project
 * files. Installing the extension was sufficient to trigger all of it. See
 * `docs/security-data-flow.md` §2 for the traced chain.
 *
 * Six rules.
 *
 * **Off is the default, and off means no request is issued at all** — not a
 * request that is discarded, not a provider that is resolved and unused. A
 * feature that reaches the network before checking whether it is enabled has
 * already done the thing the setting exists to prevent.
 *
 * **`local-only` is enforced on the resolved provider, not requested of the
 * router.** The bug this replaces passed `'local'` as a *fallback* argument that
 * read like a constraint, so a cheap cloud model satisfied it. Locality is
 * therefore checked after resolution, against the provider that would actually
 * receive the bytes.
 *
 * **An unrecognised mode resolves to `off`.** A typo in settings must not be the
 * reason project memory reaches a cloud provider — the same rule the cost
 * history location applies, for the same reason.
 *
 * **No prior setting is migrated into a permissive mode.** There is no value of
 * an old setting that can be read as consent to send project memory off-machine,
 * because no old setting ever asked that question.
 *
 * **Blocked is reported, never silent.** Every refusal carries a rule id and a
 * sentence, so the output channel can say what happened instead of a background
 * task quietly doing nothing.
 *
 * **Repeated identical failures are deduplicated, not discarded.** A background
 * task that fails every cycle must not produce a notification every cycle, and
 * must not become invisible either. The signature is the dedupe key; the
 * diagnostic is always available.
 *
 * Pure: no `vscode`, no `fs`, no clock, no network.
 */

/** How background summarisation may reach a model. */
export type BackgroundSummarizationMode = 'off' | 'local-only' | 'routed';

/** What background self-healing may do to project files. */
export type MemorySelfHealingMode = 'off' | 'report-only' | 'ask' | 'apply';

export const DEFAULT_BACKGROUND_SUMMARIZATION_MODE: BackgroundSummarizationMode = 'off';
export const DEFAULT_MEMORY_SELF_HEALING_MODE: MemorySelfHealingMode = 'report-only';

/**
 * Provider ids treated as running on this machine.
 *
 * Deliberately a short allowlist rather than a "not in the cloud list" check:
 * `ProviderId` is an open union, so an unrecognised provider added tomorrow
 * would pass a negative test and fail this one. Unknown must not read as local.
 */
const LOCAL_PROVIDER_IDS: ReadonlySet<string> = new Set(['local']);

export function isLocalProviderId(providerId: string | undefined): boolean {
  return providerId !== undefined && LOCAL_PROVIDER_IDS.has(providerId);
}

export function resolveBackgroundSummarizationMode(value: unknown): BackgroundSummarizationMode {
  return value === 'local-only' || value === 'routed' ? value : DEFAULT_BACKGROUND_SUMMARIZATION_MODE;
}

export function resolveMemorySelfHealingMode(value: unknown): MemorySelfHealingMode {
  return value === 'off' || value === 'ask' || value === 'apply'
    ? value
    : DEFAULT_MEMORY_SELF_HEALING_MODE;
}

export const BACKGROUND_MEMORY_RULES = [
  {
    id: 'summarization-off',
    description: 'Background summarisation is off. No model request is made. Enable atlasmind.memory.backgroundSummarizationMode to change this.',
  },
  {
    id: 'local-only-no-local-provider',
    description: 'Background summarisation is set to local-only and the model that routing selected is not a local provider. Nothing was sent. Configure a local model for the memory agent, or choose the routed mode explicitly.',
  },
  {
    id: 'no-provider',
    description: 'No provider could be resolved for the selected model, so nothing was sent.',
  },
  { id: 'allowed', description: 'The request is permitted by the configured mode.' },
] as const;

export type BackgroundGateDecision =
  | { status: 'allowed'; rule: 'allowed'; external: boolean }
  | { status: 'blocked'; rule: string; reason: string };

function ruleText(id: string): string {
  return BACKGROUND_MEMORY_RULES.find(rule => rule.id === id)?.description ?? id;
}

function block(rule: string): BackgroundGateDecision {
  return { status: 'blocked', rule, reason: ruleText(rule) };
}

/**
 * May this background summarisation proceed to the given provider?
 *
 * `providerId` is the provider that would *actually* receive the request, after
 * routing and resolution — not what was asked for. That ordering is the fix.
 */
export function decideBackgroundSummarization(
  mode: BackgroundSummarizationMode,
  providerId: string | undefined,
): BackgroundGateDecision {
  if (mode === 'off') {
    return block('summarization-off');
  }
  if (providerId === undefined || providerId === '') {
    return block('no-provider');
  }
  if (mode === 'local-only' && !isLocalProviderId(providerId)) {
    return block('local-only-no-local-provider');
  }
  return { status: 'allowed', rule: 'allowed', external: !isLocalProviderId(providerId) };
}

/**
 * Whether the mode reaches a model at all.
 *
 * Checked by the caller *before* selecting a model, so that under `off` no
 * routing happens, no provider is resolved and no request is prepared. The gate
 * above still refuses, but a feature that only refuses at the last moment has
 * already read the file it was not supposed to send.
 */
export function backgroundSummarizationRunsAtAll(mode: BackgroundSummarizationMode): boolean {
  return mode !== 'off';
}

/** Whether self-healing may modify project files without asking. */
export function selfHealingMayWrite(mode: MemorySelfHealingMode): boolean {
  return mode === 'apply';
}

/** Whether self-healing may scan and report. */
export function selfHealingMayScan(mode: MemorySelfHealingMode): boolean {
  return mode !== 'off';
}

/**
 * Suppresses repeats of an unchanged failure without hiding it.
 *
 * A background task failing every cycle must not notify every cycle; it must
 * also not become invisible, which is what the previous `catch {}` achieved. The
 * signature identifies "the same failure"; a different one notifies immediately,
 * and a recovery resets so the next occurrence is heard.
 */
export class BackgroundFailureNotices {
  private lastSignature: string | undefined;

  /** True when this failure should be surfaced to the user. */
  shouldNotify(signature: string): boolean {
    if (signature === this.lastSignature) {
      return false;
    }
    this.lastSignature = signature;
    return true;
  }

  /** Call when the operation succeeds, so a recurrence is reported again. */
  clear(): void {
    this.lastSignature = undefined;
  }
}
