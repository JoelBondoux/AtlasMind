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

/** Heuristic capability inference from model name substrings. */
export function inferCapabilities(shortId: string, isLocal = false): ModelInfo['capabilities'] {
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
