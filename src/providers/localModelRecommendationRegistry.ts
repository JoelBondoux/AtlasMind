import * as path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export type LocalRecommendationWorkloadTag = 'code' | 'reasoning' | 'vision' | 'general';

export interface ReleaseAwareLocalCandidate {
  modelFamily: string;
  recommendedTag: string;
  installHint: string;
  minRamGb: number;
  minVramGb?: number;
  releaseWeight: number;
  workloadTags: LocalRecommendationWorkloadTag[];
}

export const LOCAL_MODEL_RECOMMENDATION_OVERRIDE_RELATIVE_PATH = '.atlasmind/local-model-recommendations.json';

const DEFAULT_RELEASE_AWARE_LOCAL_CANDIDATES: ReadonlyArray<ReleaseAwareLocalCandidate> = [
  {
    modelFamily: 'Qwen 3 14B',
    recommendedTag: 'qwen3:14b',
    installHint: 'Ollama: ollama pull qwen3:14b',
    minRamGb: 16,
    minVramGb: 8,
    releaseWeight: 10,
    workloadTags: ['code', 'reasoning', 'general'],
  },
  {
    modelFamily: 'Devstral Small',
    recommendedTag: 'devstral:latest',
    installHint: 'Ollama: ollama pull devstral',
    minRamGb: 16,
    minVramGb: 8,
    releaseWeight: 9,
    workloadTags: ['code', 'general'],
  },
  {
    modelFamily: 'Gemma 3 12B',
    recommendedTag: 'gemma3:12b',
    installHint: 'Ollama: ollama pull gemma3:12b',
    minRamGb: 18,
    minVramGb: 10,
    releaseWeight: 9,
    workloadTags: ['vision', 'code', 'general'],
  },
  {
    modelFamily: 'Phi-4',
    recommendedTag: 'phi4:latest',
    installHint: 'Ollama: ollama pull phi4',
    minRamGb: 8,
    minVramGb: 4,
    releaseWeight: 8,
    workloadTags: ['code', 'general'],
  },
  {
    modelFamily: 'Gemma 3 4B',
    recommendedTag: 'gemma3:4b',
    installHint: 'Ollama: ollama pull gemma3:4b',
    minRamGb: 8,
    minVramGb: 4,
    releaseWeight: 8,
    workloadTags: ['vision', 'general'],
  },
  {
    modelFamily: 'Qwen 3 30B',
    recommendedTag: 'qwen3:30b',
    installHint: 'Ollama: ollama pull qwen3:30b',
    minRamGb: 42,
    minVramGb: 20,
    releaseWeight: 7,
    workloadTags: ['reasoning', 'code'],
  },
  {
    modelFamily: 'Llama 3.3 70B',
    recommendedTag: 'llama3.3:70b',
    installHint: 'Ollama: ollama pull llama3.3:70b',
    minRamGb: 64,
    minVramGb: 24,
    releaseWeight: 6,
    workloadTags: ['reasoning', 'general'],
  },
];

export const WORKLOAD_TAG_SET = new Set<LocalRecommendationWorkloadTag>(['code', 'reasoning', 'vision', 'general']);

/**
 * Return the candidate list using the priority chain:
 *   workspace override JSON > remote synced catalog > bundled defaults
 */
export function getLocalModelRecommendationCandidates(
  workspaceRoot?: string,
  remoteCandidates?: ReadonlyArray<ReleaseAwareLocalCandidate>,
): ReadonlyArray<ReleaseAwareLocalCandidate> {
  const overrides = loadLocalRecommendationOverrides(workspaceRoot);
  if (overrides.length > 0) {
    return overrides;
  }
  if (remoteCandidates && remoteCandidates.length > 0) {
    return remoteCandidates;
  }
  return DEFAULT_RELEASE_AWARE_LOCAL_CANDIDATES;
}

function loadLocalRecommendationOverrides(workspaceRoot?: string): ReleaseAwareLocalCandidate[] {
  if (!workspaceRoot) {
    return [];
  }

  const overridePath = path.join(workspaceRoot, LOCAL_MODEL_RECOMMENDATION_OVERRIDE_RELATIVE_PATH);
  if (!existsSync(overridePath)) {
    return [];
  }

  try {
    const raw = readFileSync(overridePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed
      .map(normalizeCandidate)
      .filter((candidate): candidate is ReleaseAwareLocalCandidate => Boolean(candidate));

    return normalized;
  } catch {
    return [];
  }
}

function normalizeCandidate(candidate: unknown): ReleaseAwareLocalCandidate | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined;
  }

  const record = candidate as Record<string, unknown>;
  const modelFamily = typeof record['modelFamily'] === 'string' ? record['modelFamily'].trim() : '';
  const recommendedTag = typeof record['recommendedTag'] === 'string' ? record['recommendedTag'].trim() : '';
  const installHint = typeof record['installHint'] === 'string' ? record['installHint'].trim() : '';
  const minRamGb = typeof record['minRamGb'] === 'number' && Number.isFinite(record['minRamGb'])
    ? Math.max(1, Math.round(record['minRamGb']))
    : NaN;
  const minVramGb = typeof record['minVramGb'] === 'number' && Number.isFinite(record['minVramGb'])
    ? Math.max(1, Math.round(record['minVramGb']))
    : undefined;
  const releaseWeight = typeof record['releaseWeight'] === 'number' && Number.isFinite(record['releaseWeight'])
    ? Math.max(1, Math.min(20, Math.round(record['releaseWeight'])))
    : NaN;

  if (!modelFamily || !recommendedTag || !installHint || !Number.isFinite(minRamGb) || !Number.isFinite(releaseWeight)) {
    return undefined;
  }

  const rawTags = Array.isArray(record['workloadTags']) ? record['workloadTags'] : [];
  const workloadTags = rawTags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim().toLowerCase())
    .filter((tag): tag is LocalRecommendationWorkloadTag => WORKLOAD_TAG_SET.has(tag as LocalRecommendationWorkloadTag));

  if (workloadTags.length === 0) {
    workloadTags.push('general');
  }

  return {
    modelFamily,
    recommendedTag,
    installHint,
    minRamGb,
    ...(minVramGb !== undefined ? { minVramGb } : {}),
    releaseWeight,
    workloadTags,
  };
}
