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
import type { ModelCapability, ModelInfo, SpecialistDomain } from '../types.js';
import { classifyModelRole } from './modelRole.js';

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
