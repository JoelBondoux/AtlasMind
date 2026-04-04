import * as vscode from 'vscode';
import type { CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter, ToolCall } from './adapter.js';
import { lookupCatalog } from './modelCatalog.js';

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
  /** Base URL up to (but not including) `/chat/completions`. No trailing slash. */
  baseUrl: string;
  /** SecretStorage key used to retrieve the API key. */
  secretKey: string;
  /** Human-readable name for error messages and UI. */
  displayName: string;
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
    private readonly secrets: vscode.SecretStorage,
  ) {
    this.providerId = config.providerId;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = await this.getApiKey();
    const payload = buildPayload(request);

    const result = await this.withRetries(async () => {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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
      model: `${this.config.providerId}/${result.model}`,
      inputTokens: result.usage?.prompt_tokens ?? 0,
      outputTokens: result.usage?.completion_tokens ?? 0,
      finishReason: mapFinishReason(choice?.finish_reason ?? null),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async listModels(): Promise<string[]> {
    const apiKey = await this.getApiKey();
    const response = await fetch(`${this.config.baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json() as OpenAiModelListResponse;
    if (!Array.isArray(payload.data)) {
      return [];
    }

    return payload.data
      .map(item => item.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
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

  private async withRetries<T>(work: () => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await work();
      } catch (error) {
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

// ── Payload builder ────────────────────────────────────────────────

function buildPayload(request: CompletionRequest): Record<string, unknown> {
  const messages = request.messages.map(m => {
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
    return { role: m.role, content: m.content };
  });

  const payload: Record<string, unknown> = {
    model: stripProviderPrefix(request.model),
    messages,
    max_tokens: request.maxTokens ?? 1024,
    temperature: request.temperature ?? 0.2,
  };

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
  const trimmed = modelId.trim();
  if (trimmed.includes('/')) {
    return trimmed;
  }
  return `${providerId}/${trimmed}`;
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
