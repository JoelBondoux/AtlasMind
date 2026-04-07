import type { CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter, ToolCall } from './adapter.js';
import { lookupCatalog } from './modelCatalog.js';
import type { SecretStore } from '../runtime/secrets.js';

// ── OpenAI response shapes ────────────────────────────────────────

interface OpenAiChatResponse {
  id: string;
  model: string;
  choices: Array<{
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface OpenAiModelListResponse {
  data: Array<{ id: string }>;
}

export interface OpenAiCompatibleProviderConfig {
  /** Provider ID matching ProviderId in types.ts. */
  providerId: string;
  /** Compatibility mode for request payload shape. */
  compatibilityMode?: 'generic-chat-completions' | 'openai-modern-chat';
  /** Base URL up to the configured endpoint path. No trailing slash. */
  baseUrl: string;
  /** Optional dynamic base URL resolver used when the endpoint is workspace-configured. */
  resolveBaseUrl?: () => Promise<string> | string;
  /** SecretStorage key used to retrieve the API key. */
  secretKey: string;
  /** Human-readable name for error messages and UI. */
  displayName: string;
  /** Path appended to `baseUrl` for chat completions. Defaults to `/chat/completions`. */
  chatCompletionsPath?: string;
  /** Optional dynamic resolver for chat completion paths based on the requested model ID. */
  resolveChatCompletionsPath?: (requestModel: string) => string;
  /** Path appended to `baseUrl` for model discovery. Defaults to `/models`. Set `null` to disable discovery fetches. */
  modelsPath?: string | null;
  /** Static model IDs used when the upstream API does not expose a usable `/models` catalog. */
  staticModels?: string[];
  /** Optional dynamic model list provider. Useful for deployment-based providers such as Azure OpenAI. */
  modelListProvider?: () => Promise<string[]> | string[];
  /** Header name used for API key authentication. Defaults to `Authorization`. */
  authHeaderName?: string;
  /** Authentication scheme for the configured auth header. Defaults to `bearer`. */
  authScheme?: 'bearer' | 'raw';
  /** Additional request headers added to both execution and discovery requests. */
  additionalHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
}

/**
 * Generic adapter for OpenAI-compatible chat completion APIs.
 *
 * Used for OpenAI, z.ai (GLM), DeepSeek, Mistral, and Google Gemini
 * (via Google AI Studio's OpenAI-compatible endpoint).
 */
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly providerId: string;

  constructor(
    private readonly config: OpenAiCompatibleProviderConfig,
    private readonly secrets: SecretStore,
  ) {
    this.providerId = config.providerId;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = await this.getApiKey();
    const payload = buildPayload(request, this.config.compatibilityMode);
    const additionalHeaders = await this.getAdditionalHeaders();
    const baseUrl = await this.getBaseUrl();

    const result = await this.withRetries(async () => {
      const response = await fetch(`${baseUrl}${this.resolveChatCompletionsPath(request.model)}`, {
        method: 'POST',
        signal: request.signal,
        headers: {
          ...this.buildAuthHeaders(apiKey),
          ...additionalHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(
          `${this.config.displayName} request failed (${response.status}): ${body}`,
        );
        (error as Error & { status?: number; retryAfterMs?: number }).status = response.status;
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const retryAfterSeconds = Number.parseInt(retryAfter, 10);
          if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
            (error as Error & { status?: number; retryAfterMs?: number }).retryAfterMs =
              retryAfterSeconds * 1000;
          }
        }
        throw error;
      }

      return response.json() as Promise<OpenAiChatResponse>;
    });

    const choice = result.choices[0];
    const content = choice?.message?.content ?? '';
    const rawToolCalls = choice?.message?.tool_calls ?? [];

    const toolCalls: ToolCall[] = rawToolCalls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseArguments(tc.function.arguments),
    }));

    return {
      content: content.trim(),
      model: normalizeProviderModelId(this.config.providerId, result.model),
      inputTokens: result.usage?.prompt_tokens ?? 0,
      outputTokens: result.usage?.completion_tokens ?? 0,
      finishReason: mapFinishReason(choice?.finish_reason ?? null),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async streamComplete(
    request: CompletionRequest,
    onTextChunk: (chunk: string) => void,
  ): Promise<CompletionResponse> {
    const apiKey = await this.getApiKey();
    const payload = {
      ...buildPayload(request, this.config.compatibilityMode),
      stream: true,
      ...(this.config.compatibilityMode === 'openai-modern-chat'
        ? { stream_options: { include_usage: true } }
        : {}),
    };
    const additionalHeaders = await this.getAdditionalHeaders();
    const baseUrl = await this.getBaseUrl();

    const response = await fetch(`${baseUrl}${this.resolveChatCompletionsPath(request.model)}`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        ...this.buildAuthHeaders(apiKey),
        ...additionalHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(`${this.config.displayName} stream request failed (${response.status}): ${body}`);
    }

    let contentText = '';
    let model = request.model;
    let finishReason: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    const toolCallParts = new Map<number, { id: string; name: string; args: string }>();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

    try {
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        const value = chunk.value;
        if (done) { break; }
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) { continue; }
          const data = line.slice(6).trim();
          if (data === '[DONE]') { continue; }

          let chunk: Record<string, unknown>;
          try { chunk = JSON.parse(data); } catch { continue; }

          if (chunk['model']) { model = normalizeProviderModelId(this.config.providerId, chunk['model'] as string); }

          const choices = chunk['choices'] as Array<Record<string, unknown>> | undefined;
          if (!choices?.length) {
            // Check for usage in the final chunk
            const usage = chunk['usage'] as Record<string, number> | undefined;
            if (usage) {
              inputTokens = usage['prompt_tokens'] ?? inputTokens;
              outputTokens = usage['completion_tokens'] ?? outputTokens;
            }
            continue;
          }
          const choice = choices[0];
          const delta = choice['delta'] as Record<string, unknown> | undefined;

          if (choice['finish_reason']) {
            finishReason = choice['finish_reason'] as string;
          }

          if (delta?.['content']) {
            const text = delta['content'] as string;
            contentText += text;
            onTextChunk(text);
          }

          // Accumulate streamed tool calls
          const tcDeltas = delta?.['tool_calls'] as Array<Record<string, unknown>> | undefined;
          if (tcDeltas) {
            for (const tc of tcDeltas) {
              const idx = tc['index'] as number;
              const existing = toolCallParts.get(idx) ?? { id: '', name: '', args: '' };
              if (tc['id']) { existing.id = tc['id'] as string; }
              const fn = tc['function'] as Record<string, string> | undefined;
              if (fn?.['name']) { existing.name = fn['name']; }
              if (fn?.['arguments']) { existing.args += fn['arguments']; }
              toolCallParts.set(idx, existing);
            }
          }

          // Check for usage block in stream_options
          const usage = chunk['usage'] as Record<string, number> | undefined;
          if (usage) {
            inputTokens = usage['prompt_tokens'] ?? inputTokens;
            outputTokens = usage['completion_tokens'] ?? outputTokens;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls: ToolCall[] = [...toolCallParts.values()]
      .filter(tc => tc.id && tc.name)
      .map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: parseArguments(tc.args),
      }));

    return {
      content: contentText.trim(),
      model,
      inputTokens,
      outputTokens,
      finishReason: mapFinishReason(finishReason as OpenAiChatResponse['choices'][0]['finish_reason']),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async listModels(): Promise<string[]> {
    const apiKey = await this.getApiKey();
    const additionalHeaders = await this.getAdditionalHeaders();
    const baseUrl = await this.getBaseUrl();
    const discoveredIds: string[] = [];

    if (this.config.modelsPath !== null) {
      const response = await fetch(`${baseUrl}${this.config.modelsPath ?? '/models'}`, {
        method: 'GET',
        headers: {
          ...this.buildAuthHeaders(apiKey),
          ...additionalHeaders,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const payload = await response.json() as OpenAiModelListResponse;
        if (Array.isArray(payload.data)) {
          discoveredIds.push(...payload.data
            .map(item => item.id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
        }
      }
    }

    if (this.config.staticModels?.length) {
      discoveredIds.push(...this.config.staticModels);
    }

    if (this.config.modelListProvider) {
      const provided = await this.config.modelListProvider();
      discoveredIds.push(...provided);
    }

    return [...new Set(discoveredIds)]
      .map(id => ensureProviderPrefix(this.config.providerId, id));
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    const ids = await this.listModels();
    return ids.map(id => {
      const entry = lookupCatalog(this.config.providerId, id);
      return {
        id,
        name: entry?.name,
        contextWindow: entry?.contextWindow,
        capabilities: entry?.capabilities,
        inputPricePer1k: entry?.inputPricePer1k,
        outputPricePer1k: entry?.outputPricePer1k,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getApiKey();
      return true;
    } catch {
      return false;
    }
  }

  private async getApiKey(): Promise<string> {
    const key = await this.secrets.get(this.config.secretKey);
    if (!key || key.trim().length === 0) {
      throw new Error(
        `${this.config.displayName} API key is not configured. ` +
        `Set it in AtlasMind: Manage Model Providers.`,
      );
    }
    return key.trim();
  }

  private buildAuthHeaders(apiKey: string): Record<string, string> {
    const authHeaderName = this.config.authHeaderName ?? 'Authorization';
    const authScheme = this.config.authScheme ?? 'bearer';
    return {
      [authHeaderName]: authScheme === 'raw' ? apiKey : `Bearer ${apiKey}`,
    };
  }

  private resolveChatCompletionsPath(requestModel: string): string {
    if (this.config.resolveChatCompletionsPath) {
      return this.config.resolveChatCompletionsPath(requestModel);
    }
    return this.config.chatCompletionsPath ?? '/chat/completions';
  }

  private async getAdditionalHeaders(): Promise<Record<string, string>> {
    if (!this.config.additionalHeaders) {
      return {};
    }
    return await this.config.additionalHeaders();
  }

  private async getBaseUrl(): Promise<string> {
    const resolved = this.config.resolveBaseUrl ? await this.config.resolveBaseUrl() : this.config.baseUrl;
    return resolved.replace(/\/+$/, '');
  }

  private async withRetries<T>(work: () => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        const maybe = error as Error & { status?: number; retryAfterMs?: number };
        const retryable =
          maybe.status === 429 || (maybe.status !== undefined && maybe.status >= 500);
        const isLastAttempt = attempt === maxAttempts;
        if (!retryable || isLastAttempt) {
          throw error;
        }
        const waitMs = maybe.retryAfterMs ?? attempt * 750;
        await new Promise<void>(resolve => setTimeout(resolve, waitMs));
      }
    }
    throw new Error('Unreachable');
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

// ── Payload builder ────────────────────────────────────────────────

function buildPayload(
  request: CompletionRequest,
  compatibilityMode: OpenAiCompatibleProviderConfig['compatibilityMode'] = 'generic-chat-completions',
): Record<string, unknown> {
  const strippedModel = stripProviderPrefix(request.model);
  const messages = request.messages.map(m => {
    if (m.role === 'system' && compatibilityMode === 'openai-modern-chat') {
      return { role: 'developer', content: m.content };
    }
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    if (m.role === 'user' && m.images?.length) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          ...m.images.map(image => ({
            type: 'image_url',
            image_url: {
              url: `data:${image.mimeType};base64,${image.dataBase64}`,
            },
          })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const payload: Record<string, unknown> = {
    model: strippedModel,
    messages,
  };

  if (shouldIncludeTemperature(strippedModel, compatibilityMode, request.temperature)) {
    payload['temperature'] = request.temperature ?? 0.2;
  }

  payload[
    compatibilityMode === 'openai-modern-chat'
      ? 'max_completion_tokens'
      : 'max_tokens'
  ] = request.maxTokens ?? 1024;

  if (request.stop?.length) {
    payload['stop'] = request.stop;
  }

  if (request.tools?.length) {
    payload['tools'] = request.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    payload['tool_choice'] = 'auto';
  }

  return payload;
}

// ── Utilities ──────────────────────────────────────────────────────

function stripProviderPrefix(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

function ensureProviderPrefix(providerId: string, modelId: string): string {
  return normalizeProviderModelId(providerId, modelId);
}

function normalizeProviderModelId(providerId: string, modelId: string): string {
  const trimmed = modelId.trim();
  const withoutModelsPrefix = trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
  if (withoutModelsPrefix.startsWith(`${providerId}/`)) {
    return withoutModelsPrefix;
  }
  return `${providerId}/${withoutModelsPrefix}`;
}

function shouldIncludeTemperature(
  strippedModelId: string,
  compatibilityMode: OpenAiCompatibleProviderConfig['compatibilityMode'],
  requestedTemperature: number | undefined,
): boolean {
  if (requestedTemperature === undefined && compatibilityMode === 'openai-modern-chat' && isOpenAiFixedTemperatureModel(strippedModelId)) {
    return false;
  }

  if (compatibilityMode !== 'openai-modern-chat') {
    return true;
  }

  return !isOpenAiFixedTemperatureModel(strippedModelId);
}

function isOpenAiFixedTemperatureModel(modelId: string): boolean {
  return /^(?:gpt-5(?:$|[-.])|o1(?:$|[-.])|o3(?:$|[-.])|o4(?:$|[-.]))/i.test(modelId.trim());
}

function mapFinishReason(reason: string | null): CompletionResponse['finishReason'] {
  if (reason === 'tool_calls') { return 'tool_calls'; }
  if (reason === 'length') { return 'length'; }
  if (reason === 'error') { return 'error'; }
  return 'stop';
}

function parseArguments(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}
