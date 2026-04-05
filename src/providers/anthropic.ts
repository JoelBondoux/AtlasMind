import type { CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter, ToolCall } from './adapter.js';
import { lookupCatalog } from './modelCatalog.js';
import type { SecretStore } from '../runtime/secrets.js';

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

  constructor(private readonly secrets: SecretStore) {}

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

  async streamComplete(
    request: CompletionRequest,
    onTextChunk: (chunk: string) => void,
  ): Promise<CompletionResponse> {
    const apiKey = await this.getApiKey();
    const { system, messages } = splitSystemPrompt(request.messages);

    const payload = {
      model: stripProviderPrefix(request.model),
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.2,
      system,
      messages,
      stop_sequences: request.stop,
      stream: true,
      tools: request.tools?.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    };

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(`Anthropic stream request failed (${response.status}): ${body}`);
    }

    let contentText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let model = request.model;
    let stopReason: string | null = null;
    const toolCalls: ToolCall[] = [];
    let currentToolId = '';
    let currentToolName = '';
    let currentToolInput = '';

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

          let event: Record<string, unknown>;
          try { event = JSON.parse(data); } catch { continue; }

          const type = event['type'] as string | undefined;
          if (type === 'message_start') {
            const msg = event['message'] as Record<string, unknown> | undefined;
            if (msg) {
              model = `anthropic/${msg['model'] as string}`;
              const usage = msg['usage'] as Record<string, number> | undefined;
              if (usage) { inputTokens = usage['input_tokens'] ?? 0; }
            }
          } else if (type === 'content_block_start') {
            const block = event['content_block'] as Record<string, unknown> | undefined;
            if (block?.['type'] === 'tool_use') {
              currentToolId = block['id'] as string;
              currentToolName = block['name'] as string;
              currentToolInput = '';
            }
          } else if (type === 'content_block_delta') {
            const delta = event['delta'] as Record<string, unknown> | undefined;
            if (delta?.['type'] === 'text_delta') {
              const text = delta['text'] as string;
              contentText += text;
              onTextChunk(text);
            } else if (delta?.['type'] === 'input_json_delta') {
              currentToolInput += delta['partial_json'] as string;
            }
          } else if (type === 'content_block_stop') {
            if (currentToolId) {
              let parsedInput: Record<string, unknown> = {};
              try { parsedInput = JSON.parse(currentToolInput); } catch { /* empty */ }
              toolCalls.push({ id: currentToolId, name: currentToolName, arguments: parsedInput });
              currentToolId = '';
              currentToolName = '';
              currentToolInput = '';
            }
          } else if (type === 'message_delta') {
            const delta = event['delta'] as Record<string, unknown> | undefined;
            stopReason = (delta?.['stop_reason'] as string) ?? null;
            const usage = event['usage'] as Record<string, number> | undefined;
            if (usage) { outputTokens = usage['output_tokens'] ?? 0; }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: contentText.trim(),
      model,
      inputTokens,
      outputTokens,
      finishReason: mapFinishReason(stopReason as AnthropicMessagesResponse['stop_reason']),
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

  async discoverModels(): Promise<DiscoveredModel[]> {
    const ids = await this.listModels();
    return ids.map(id => {
      const entry = lookupCatalog('anthropic', id);
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

    if (message.role === 'user' && message.images?.length) {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (message.content.trim().length > 0) {
        contentBlocks.push({ type: 'text', text: message.content });
      }
      for (const image of message.images) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType,
            data: image.dataBase64,
          },
        });
      }
      converted.push({ role: 'user', content: contentBlocks });
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
