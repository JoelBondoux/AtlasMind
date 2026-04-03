import * as vscode from 'vscode';
import type { CompletionRequest, CompletionResponse, ProviderAdapter, ToolCall } from './adapter.js';

interface AnthropicMessagesResponse {
  id: string;
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

type AnthropicMessagePayload = {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
};

interface AnthropicModelListResponse {
  data: Array<{ id: string }>;
}

/**
 * Minimal Anthropic adapter that uses SecretStorage credentials.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly providerId = 'anthropic';
  private readonly apiUrl = 'https://api.anthropic.com/v1/messages';

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = await this.getApiKey();
    const { system, messages } = splitSystemPrompt(request.messages);

    const payload = {
      model: stripProviderPrefix(request.model),
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.2,
      system,
      messages,
      stop_sequences: request.stop,
      tools: request.tools?.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    };

    const result = await this.withRetries(async () => {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`Anthropic request failed (${response.status}): ${body}`);
        (error as Error & { status?: number; retryAfterMs?: number }).status = response.status;
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const retryAfterSeconds = Number.parseInt(retryAfter, 10);
          if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
            (error as Error & { status?: number; retryAfterMs?: number }).retryAfterMs = retryAfterSeconds * 1000;
          }
        }
        throw error;
      }

      return response.json() as Promise<AnthropicMessagesResponse>;
    });

    const content = result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();

    const toolCalls: ToolCall[] = result.content
      .filter((block): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
      .map(block => ({
        id: block.id,
        name: block.name,
        arguments: block.input,
      }));

    return {
      content,
      model: `anthropic/${result.model}`,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      finishReason: mapFinishReason(result.stop_reason),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const apiKey = await this.getApiKey();
      const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      });

      if (!response.ok) {
        return this.getFallbackModels();
      }

      const payload = await response.json() as AnthropicModelListResponse;
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        return this.getFallbackModels();
      }

      return payload.data
        .map(model => model.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map(id => id.includes('/') ? id : `anthropic/${id}`);
    } catch {
      return this.getFallbackModels();
    }
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
    const key = await this.secrets.get('atlasmind.provider.anthropic.apiKey');
    if (!key || key.trim().length === 0) {
      throw new Error('Anthropic API key is not configured. Set it in AtlasMind: Manage Model Providers.');
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
        const retryable = maybe.status === 429 || (maybe.status !== undefined && maybe.status >= 500);
        const isLastAttempt = attempt === maxAttempts;
        if (!retryable || isLastAttempt) {
          throw error;
        }

        const waitMs = maybe.retryAfterMs ?? attempt * 750;
        await delay(waitMs);
      }
    }

    throw new Error('Anthropic retry loop exited unexpectedly.');
  }

  private getFallbackModels(): string[] {
    return [
      'anthropic/claude-3-5-haiku-latest',
      'anthropic/claude-3-7-sonnet-latest',
    ];
  }
}

function splitSystemPrompt(messages: CompletionRequest['messages']): {
  system: string | undefined;
  messages: AnthropicMessagePayload[];
} {
  const systemChunks: string[] = [];
  const converted: AnthropicMessagePayload[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemChunks.push(message.content);
      continue;
    }

    if (message.role === 'tool' && message.toolCallId) {
      converted.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
        }],
      });
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (message.content.trim().length > 0) {
        contentBlocks.push({ type: 'text', text: message.content });
      }
      for (const toolCall of message.toolCalls) {
        contentBlocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments,
        });
      }
      converted.push({ role: 'assistant', content: contentBlocks });
      continue;
    }

    if (message.role === 'user' || message.role === 'assistant') {
      converted.push({ role: message.role, content: message.content });
    }
  }

  return {
    system: systemChunks.length > 0 ? systemChunks.join('\n\n') : undefined,
    messages: converted,
  };
}

function stripProviderPrefix(modelId: string): string {
  return modelId.startsWith('anthropic/') ? modelId.slice('anthropic/'.length) : modelId;
}

function mapFinishReason(reason: AnthropicMessagesResponse['stop_reason']): CompletionResponse['finishReason'] {
  if (reason === 'tool_use') {
    return 'tool_calls';
  }
  if (reason === 'max_tokens') {
    return 'length';
  }
  if (reason === 'end_turn' || reason === 'stop_sequence') {
    return 'stop';
  }
  return 'error';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
