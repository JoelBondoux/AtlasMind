/**
 * Pure, host-independent heuristics for inferring model metadata from a model's
 * short identifier. Extracted verbatim from `src/extension.ts` to reduce the size
 * of the extension entry point and make these helpers directly unit-testable
 * without a VS Code host.
 *
 * These are best-effort fallbacks: the live discovery hints and the static
 * catalog (`modelCatalog.ts`) always take priority over these heuristics inside
 * `inferModelMetadata()`.
 */
import type { ModelCapability, ModelInfo, ProviderId, SpecialistDomain } from '../types.js';
import type { DiscoveredModel } from './adapter.js';
import type { LocalModelMeta } from './localModelSync.js';
import { lookupCatalog, lookupReasoningControl } from './modelCatalog.js';
import { classifyModelRole } from './modelRole.js';
import type { ProviderPricingEntry } from './providerPricingSync.js';

/**
 * Parameter count in billions, read from the model id (`qwen3:14b` → 14).
 *
 * Local model ids carry their size by convention and `ModelInfo` has nowhere to
 * put it, so this is the only source available at routing time. Returns
 * `undefined` when the id says nothing — the callers treat that as "no size
 * information", never as "small".
 *
 * The pattern requires a delimiter or a string boundary on both sides so `4b`
 * in `gpt-4b-preview` is read the same way `14b` in `qwen3:14b` is, while `b`
 * inside a word is never mistaken for a unit.
 */
export function inferParametersBillions(shortId: string): number | undefined {
  const match = shortId.toLowerCase().match(/(?:^|[/:_.@-])(\d+(?:\.\d+)?)b(?:$|[/:_.@-])/);
  if (!match) { return undefined; }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Heuristic context-window inference from model name substrings. */
export function inferContextWindow(shortId: string): number {
  const normalized = shortId.toLowerCase();
  if (normalized.includes('gemini')) {
    return 1_000_000;
  }
  if (normalized.includes('claude')) {
    return 200_000;
  }
  if (normalized.includes('gpt-4.1') || normalized.includes('gpt4.1')) {
    return 1_000_000;
  }
  return 128_000;
}

/**
 * Heuristic capability inference from model name substrings.
 *
 * A provider lists everything it can serve, not everything that can answer a
 * question. A model whose role is not conversational gets **no capabilities at
 * all** rather than a reduced set: `chat` is the one the router treats as the
 * licence to route (`isRoutableChatModel`), and granting anything here would
 * leave a guard or embedding model in the candidate pool — at zero cost for a
 * local one, which is exactly where it wins. Checked for every provider, not
 * just local: `hasToolCalling` below is unconditionally true off-local, so
 * `dall-e-3` was reaching the router as a tool-capable chat model. See
 * `modelRole.ts` for the rule table and why an unrecognised model is always
 * conversational.
 */
export function inferCapabilities(shortId: string, isLocal = false): ModelInfo['capabilities'] {
  if (!classifyModelRole(shortId).conversational) {
    return [];
  }
  const normalized = shortId.toLowerCase();

  const isReasoning =
    normalized.includes('reason') || normalized.includes('r1') || /\bo[1-4]\b/.test(normalized) ||
    normalized.includes('thinking');
  const isVision = normalized.includes('vision') || normalized.includes('image') || normalized.includes('vl');

  const hasToolCalling = !isLocal || normalized.includes('coder') || normalized.includes('instruct') ||
    normalized.includes('devstral') || normalized.includes('mistral') || normalized.includes('qwen') ||
    /\bllama/.test(normalized) || normalized.includes('command');

  const capabilities: ModelInfo['capabilities'] = ['chat', 'code'];
  if (hasToolCalling) capabilities.push('function_calling');
  if (isVision) capabilities.push('vision');
  if (isReasoning) capabilities.push('reasoning');

  return capabilities;
}

/** Heuristic specialist-domain inference from model name substrings. */
export function inferSpecialistDomains(shortId: string, capabilities: readonly ModelCapability[]): SpecialistDomain[] {
  const normalized = shortId.toLowerCase();
  const domains = new Set<SpecialistDomain>();

  if (capabilities.includes('vision')) {
    domains.add('visual-analysis');
  }
  if (/(?:sonar|research|retriev|citation|search)/i.test(normalized)) {
    domains.add('research');
  }
  if (/(?:tts|stt|speech|audio|voice|transcrib)/i.test(normalized)) {
    domains.add('voice');
  }
  if (/(?:image-?gen|text-?to-?image|stable-?diffusion|sdxl|dall-?e|flux|sora|veo|runway|video-?gen|media-?gen)/i.test(normalized)) {
    domains.add('media-generation');
  }
  if (/(?:robot|robotic|ros\d?|kinematic|trajectory|motion-?planning|control-?loop|pid)/i.test(normalized)) {
    domains.add('robotics');
  }
  if (/(?:simulat|monte-?carlo|scenario-?model|what-?if)/i.test(normalized)) {
    domains.add('simulation');
  }

  return [...domains];
}

/** Heuristic pricing estimate from model name substrings. */
export function inferPricing(shortId: string): { input: number; output: number } {
  const normalized = shortId.toLowerCase();

  const isCheap = /\bmini/.test(normalized) || normalized.includes('nano') ||
    normalized.includes('flash') || normalized.includes('small') || normalized.includes('free');
  const isReasoning =
    normalized.includes('reason') || normalized.includes('r1') || /\bo[1-4]\b/.test(normalized) ||
    normalized.includes('thinking');
  const isPremium = normalized.includes('pro') || normalized.includes('ultra') ||
    normalized.includes('large') || normalized.includes('max') || isReasoning;

  if (isCheap) {
    return { input: 0.0001, output: 0.0004 };
  }
  if (isPremium) {
    return { input: 0.002, output: 0.008 };
  }
  return { input: 0.0006, output: 0.0024 };
}

/** A discovered id in the router's `<provider>/<model>` form, whatever the provider reported. */
export function normalizeModelId(providerId: ProviderId, modelId: string): string {
  const trimmed = modelId.trim();
  const withoutModelsPrefix = trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
  if (withoutModelsPrefix.startsWith(`${providerId}/`)) {
    return withoutModelsPrefix;
  }
  return `${providerId}/${withoutModelsPrefix}`;
}

/**
 * Infer model metadata for a newly-discovered model ID.
 *
 * Resolution order:
 * 1. Values from the `DiscoveredModel` hint (runtime API data).
 * 2. Well-known model catalog lookup.
 * 3. Substring-based heuristic fallback.
 */
export function inferModelMetadata(
  providerId: ProviderId,
  modelId: string,
  hint?: DiscoveredModel,
  liveMeta?: LocalModelMeta,
  dynamicPricing?: ProviderPricingEntry,
): ModelInfo {
  const shortId = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const catalogEntry = lookupCatalog(providerId, modelId);
  const isLocalProvider = providerId === 'local';

  // Merge sources: liveMeta > hint > dynamicPricing (live scrape) > catalog > heuristic
  const name = liveMeta?.name ?? hint?.name ?? catalogEntry?.name ?? toDisplayModelName(shortId);
  const contextWindow = liveMeta?.contextWindow ?? hint?.contextWindow ?? dynamicPricing?.contextWindow ?? catalogEntry?.contextWindow ?? inferContextWindow(shortId);
  const capabilities = liveMeta?.capabilities ?? hint?.capabilities ?? catalogEntry?.capabilities ?? inferCapabilities(shortId, isLocalProvider);
  const delegatedToolExecution = hint?.delegatedToolExecution;
  const specialistDomains = mergeSpecialistDomains(
    catalogEntry?.specialistDomains,
    hint?.specialistDomains,
    inferSpecialistDomains(shortId, capabilities),
  );
  const inputPricePer1k = isLocalProvider ? 0 : (hint?.inputPricePer1k ?? dynamicPricing?.inputPer1k ?? catalogEntry?.inputPricePer1k ?? inferPricing(shortId).input);
  const outputPricePer1k = isLocalProvider ? 0 : (hint?.outputPricePer1k ?? dynamicPricing?.outputPer1k ?? catalogEntry?.outputPricePer1k ?? inferPricing(shortId).output);
  const premiumRequestMultiplier = hint?.premiumRequestMultiplier ?? catalogEntry?.premiumRequestMultiplier;
  // Carry the catalog's authoritative routing annotations through the merge.
  // Without these, every model populated via discovery loses its reasoning depth
  // and latency class, so the router falls back to heuristics — collapsing genuine
  // depth-3 reasoners (Opus, DeepSeek R1, Nemotron Ultra) to depth 2 and under-
  // ranking them for high-reasoning tasks.
  // Catalog first, because it is the curated answer for every model that has
  // one. The hint is the fallback for models the catalog cannot know about —
  // an ACP effort variant's depth is a property of the tier the agent offered
  // on this session, not of a model name anybody could enumerate in advance.
  const reasoningDepth = catalogEntry?.reasoningDepth ?? hint?.reasoningDepth;
  const latencyClass = catalogEntry?.latencyClass;
  // Which thinking-depth parameter this model accepts on *this* provider. A
  // provider-scoped declared table, never the cross-provider catalog fallback:
  // Claude through another vendor's endpoint is not a model that accepts
  // Anthropic's request field there.
  const reasoningControl = lookupReasoningControl(providerId, modelId);
  // Cache capability is dynamic — providers change model capabilities over time.
  // Prefer the runtime discovery hint and live pricing scrape over the static
  // catalog so the router tracks those changes; an explicit hint `false`
  // overrides the catalog. The router still applies a provider-set bootstrap
  // fallback when no source has annotated the model yet.
  const supportsPromptCaching = hint?.supportsPromptCaching ?? catalogEntry?.supportsPromptCaching;
  const cachedInputPricePer1k = isLocalProvider
    ? undefined
    : (hint?.cachedInputPricePer1k ?? dynamicPricing?.cachedInputPer1k ?? catalogEntry?.cachedInputPricePer1k);

  return {
    id: modelId,
    provider: providerId,
    name,
    contextWindow,
    inputPricePer1k,
    outputPricePer1k,
    capabilities,
    ...(delegatedToolExecution !== undefined ? { delegatedToolExecution } : {}),
    ...(specialistDomains.length > 0 ? { specialistDomains } : {}),
    enabled: true,
    ...(premiumRequestMultiplier !== undefined && premiumRequestMultiplier !== 1
      ? { premiumRequestMultiplier }
      : {}),
    ...(reasoningDepth !== undefined ? { reasoningDepth } : {}),
    ...(latencyClass !== undefined ? { latencyClass } : {}),
    ...(reasoningControl !== undefined ? { reasoningControl } : {}),
    ...(supportsPromptCaching !== undefined ? { supportsPromptCaching } : {}),
    ...(cachedInputPricePer1k !== undefined ? { cachedInputPricePer1k } : {}),
  };
}

export function mergeSpecialistDomains(...sources: Array<readonly SpecialistDomain[] | undefined>): SpecialistDomain[] {
  const merged = new Set<SpecialistDomain>();
  for (const source of sources) {
    for (const domain of source ?? []) {
      merged.add(domain);
    }
  }
  return [...merged];
}

function toDisplayModelName(modelId: string): string {
  return modelId
    .split(/[-._]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
