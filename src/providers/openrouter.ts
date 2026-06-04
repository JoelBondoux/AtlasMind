/**
 * OpenRouter provider adapter.
 *
 * OpenRouter is a model aggregator that exposes 200+ models from many upstream
 * providers (Anthropic, OpenAI, Google, Mistral, Meta, etc.) behind a single
 * OpenAI-compatible API.  Its /api/v1/models endpoint returns live per-model
 * pricing, which we consume directly so prices stay accurate without scraping.
 *
 * Completion and streaming requests are delegated to OpenAiCompatibleAdapter.
 * discoverModels() is overridden to parse the rich OpenRouter model list.
 *
 * Docs: https://openrouter.ai/docs
 */

import type { CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter } from './adapter.js';
import { OpenAiCompatibleAdapter } from './openai-compatible.js';
import type { SecretStore } from '../runtime/secrets.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HTTP_REFERER = 'https://github.com/JoelBondoux/AtlasMind';
const OPENROUTER_APP_TITLE = 'AtlasMind';

interface OpenRouterModelEntry {
  id: string;
  name: string;
  context_length: number;
  architecture?: {
    modality?: string;
  };
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
}

interface OpenRouterModelList {
  data: OpenRouterModelEntry[];
}

/**
 * Adapter for the OpenRouter model aggregator API.
 *
 * Delegates completions and streaming to an inner OpenAiCompatibleAdapter
 * (adding the required HTTP-Referer and X-Title headers).  discoverModels()
 * reads pricing and capability data directly from the /api/v1/models endpoint.
 */
export class OpenRouterAdapter implements ProviderAdapter {
  readonly providerId = 'openrouter';
  private readonly inner: OpenAiCompatibleAdapter;
  private readonly secrets: SecretStore;

  constructor(secrets: SecretStore) {
    this.secrets = secrets;
    this.inner = new OpenAiCompatibleAdapter(
      {
        providerId: 'openrouter',
        baseUrl: OPENROUTER_BASE_URL,
        secretKey: 'atlasmind.provider.openrouter.apiKey',
        displayName: 'OpenRouter',
        additionalHeaders: () => ({
          'HTTP-Referer': OPENROUTER_HTTP_REFERER,
          'X-Title': OPENROUTER_APP_TITLE,
        }),
      },
      secrets,
    );
  }

  complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.inner.complete(request);
  }

  streamComplete(
    request: CompletionRequest,
    onTextChunk: (chunk: string) => void,
  ): Promise<CompletionResponse> {
    return this.inner.streamComplete(request, onTextChunk);
  }

  listModels(): Promise<string[]> {
    return this.inner.listModels();
  }

  healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    let apiKey: string | undefined;
    try {
      const key = await this.secrets.get('atlasmind.provider.openrouter.apiKey');
      if (key?.trim()) {
        apiKey = key.trim();
      }
    } catch {
      // continue — OpenRouter allows listing models without auth
    }

    try {
      const headers: Record<string, string> = {
        'HTTP-Referer': OPENROUTER_HTTP_REFERER,
        'X-Title': OPENROUTER_APP_TITLE,
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, { headers });
      if (!response.ok) {
        return this.inner.discoverModels();
      }

      const payload = await response.json() as OpenRouterModelList;
      if (!Array.isArray(payload?.data)) {
        return this.inner.discoverModels();
      }

      return payload.data.map(entry => toDiscoveredModel(entry));
    } catch {
      return this.inner.discoverModels();
    }
  }
}

function toDiscoveredModel(entry: OpenRouterModelEntry): DiscoveredModel {
  const modelId = `openrouter/${entry.id}`;
  const modality = entry.architecture?.modality ?? '';
  const hasVision = modality.includes('image');

  const capabilities: DiscoveredModel['capabilities'] = ['chat', 'code', 'function_calling'];
  if (hasVision) {
    capabilities.push('vision');
  }

  // OpenRouter pricing is USD per token; multiply by 1 000 for per-1k rate.
  const inputPricePer1k = parsePricePerToken(entry.pricing?.prompt) * 1000;
  const outputPricePer1k = parsePricePerToken(entry.pricing?.completion) * 1000;

  return {
    id: modelId,
    name: entry.name,
    contextWindow: entry.context_length > 0 ? entry.context_length : undefined,
    capabilities,
    inputPricePer1k: Number.isFinite(inputPricePer1k) ? inputPricePer1k : undefined,
    outputPricePer1k: Number.isFinite(outputPricePer1k) ? outputPricePer1k : undefined,
  };
}

function parsePricePerToken(raw: string | number | undefined): number {
  if (raw === undefined || raw === null) {
    return 0;
  }
  const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
  return Number.isFinite(n) ? n : 0;
}
