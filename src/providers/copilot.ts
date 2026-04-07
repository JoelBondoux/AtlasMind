import * as vscode from 'vscode';
import type { ChatMessage, CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter, ToolCall } from './adapter.js';
import { lookupCatalog } from './modelCatalog.js';

/**
 * Adapter that executes requests through VS Code's Language Model API.
 * Supports tool calling via LanguageModelToolCallPart / LanguageModelToolResultPart.
 */
export class CopilotAdapter implements ProviderAdapter {
  readonly providerId = 'copilot';

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.executeRequest(request);
  }

  async streamComplete(
    request: CompletionRequest,
    onTextChunk: (chunk: string) => void,
  ): Promise<CompletionResponse> {
    return this.executeRequest(request, onTextChunk);
  }

  private async executeRequest(
    request: CompletionRequest,
    onTextChunk?: (chunk: string) => void,
  ): Promise<CompletionResponse> {
    const model = await this.resolveModel(request.model);
    const messages = toLanguageModelMessages(request.messages);
    const options = buildRequestOptions(request);
    const cancellation = createCancellationTokenSource(request.signal);

    const response = await model.sendRequest(messages, options, cancellation.token);

    let content = '';
    const toolCalls: ToolCall[] = [];

    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        content += chunk.value;
        onTextChunk?.(chunk.value);
      } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: chunk.callId,
          name: chunk.name,
          arguments: chunk.input as Record<string, unknown>,
        });
      }
    }

    const inputTokens = await countInputTokens(model, messages);
    const outputTokens = content.trim().length > 0 ? await model.countTokens(content) : 0;
    const hasToolCalls = toolCalls.length > 0;
    cancellation.dispose();

    return {
      content: content.trim(),
      model: `copilot/${model.id}`,
      inputTokens,
      outputTokens,
      finishReason: hasToolCalls ? 'tool_calls' : 'stop',
      toolCalls: hasToolCalls ? toolCalls : undefined,
    };
  }

  async listModels(): Promise<string[]> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return models.map(model => `copilot/${model.id}`);
  }

  /**
   * Discover Copilot models with rich metadata extracted from the
   * VS Code Language Model API (context window, name, family)
   * combined with the well-known model catalog for pricing and capabilities.
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return models.map(model => {
      const fullId = `copilot/${model.id}`;
      const catalogEntry = lookupCatalog('copilot', model.family || model.id);

      const discovered: DiscoveredModel = {
        id: fullId,
        name: model.name || catalogEntry?.name,
        contextWindow: model.maxInputTokens || catalogEntry?.contextWindow,
        capabilities: catalogEntry?.capabilities,
        inputPricePer1k: catalogEntry?.inputPricePer1k,
        outputPricePer1k: catalogEntry?.outputPricePer1k,
        premiumRequestMultiplier: catalogEntry?.premiumRequestMultiplier,
      };

      return discovered;
    });
  }

  async healthCheck(): Promise<boolean> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return models.length > 0;
  }

  /**
   * Resolve a specific model for execution.
   *
   * Matching strategy (in order):
   * 1. Exact match on `id`.
   * 2. Family match — the requested ID may map to a model `family`.
   * 3. Fallback to the first available Copilot model.
   */
  private async resolveModel(modelId: string): Promise<vscode.LanguageModelChat> {
    const requestedId = stripCopilotPrefix(modelId);
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });

    if (allModels.length === 0) {
      throw new Error('No GitHub Copilot chat model is available in this VS Code session. Install GitHub Copilot Chat and sign in to use the Copilot provider.');
    }

    if (requestedId && requestedId !== 'default') {
      // 1. Exact ID match
      const exact = allModels.find(m => m.id === requestedId);
      if (exact) {
        return exact;
      }

      // 2. Family match (e.g. requested "gpt-4o" matches model.family "gpt-4o")
      const byFamily = allModels.find(m => m.family === requestedId);
      if (byFamily) {
        return byFamily;
      }

      // 3. Substring match on ID (e.g. requested "claude-sonnet-4" ⊂ longer versioned ID)
      const partial = allModels.find(m =>
        m.id.includes(requestedId) || requestedId.includes(m.id),
      );
      if (partial) {
        return partial;
      }
    }

    return allModels[0];
  }
}

function createCancellationTokenSource(signal?: AbortSignal): vscode.CancellationTokenSource {
  const source = new vscode.CancellationTokenSource();
  if (!signal) {
    return source;
  }
  const cancel = () => source.cancel();
  if (signal.aborted) {
    cancel();
    return source;
  }
  signal.addEventListener('abort', cancel, { once: true });
  const originalDispose = source.dispose.bind(source);
  source.dispose = () => {
    signal.removeEventListener('abort', cancel);
    originalDispose();
  };
  return source;
}

function toLanguageModelMessages(messages: ChatMessage[]): vscode.LanguageModelChatMessage[] {
  const systemInstructions = messages
    .filter(message => message.role === 'system')
    .map(message => message.content.trim())
    .filter(content => content.length > 0)
    .join('\n\n');

  const converted: vscode.LanguageModelChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    if (message.role === 'tool' && message.toolCallId) {
      // Tool result — feed back as a user message with a LanguageModelToolResultPart
      converted.push(
        vscode.LanguageModelChatMessage.User([
          new vscode.LanguageModelToolResultPart(
            message.toolCallId,
            [new vscode.LanguageModelTextPart(message.content)],
          ),
        ]),
      );
    } else if (message.role === 'assistant' && message.toolCalls?.length) {
      // Assistant tool-call message — use LanguageModelToolCallPart parts
      const parts = message.toolCalls.map(
        tc => new vscode.LanguageModelToolCallPart(tc.id, tc.name, tc.arguments),
      );
      converted.push(vscode.LanguageModelChatMessage.Assistant(parts));
    } else if (message.role === 'assistant') {
      converted.push(vscode.LanguageModelChatMessage.Assistant(message.content));
    } else {
      if (message.images?.length) {
        const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [
          new vscode.LanguageModelTextPart(message.content),
        ];
        for (const image of message.images) {
          parts.push(
            vscode.LanguageModelDataPart.image(
              Uint8Array.from(Buffer.from(image.dataBase64, 'base64')),
              image.mimeType,
            ),
          );
        }
        converted.push(vscode.LanguageModelChatMessage.User(parts));
      } else {
        converted.push(vscode.LanguageModelChatMessage.User(message.content));
      }
    }
  }

  if (systemInstructions.length > 0) {
    converted.unshift(
      vscode.LanguageModelChatMessage.User(
        `System instructions:\n${systemInstructions}`,
      ),
    );
  }

  return converted;
}

function buildRequestOptions(request: CompletionRequest): vscode.LanguageModelChatRequestOptions {
  const modelOptions: Record<string, unknown> = {};
  if (request.temperature !== undefined) {
    modelOptions.temperature = request.temperature;
  }
  if (request.maxTokens !== undefined) {
    modelOptions.max_tokens = request.maxTokens;
  }
  if (request.stop !== undefined) {
    modelOptions.stop = request.stop;
  }

  const options: vscode.LanguageModelChatRequestOptions = {
    justification: 'AtlasMind orchestrator model request',
    modelOptions,
  };

  if (request.tools && request.tools.length > 0) {
    options.tools = request.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
    }));
  }

  return options;
}

async function countInputTokens(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
): Promise<number> {
  const counts = await Promise.all(messages.map(message => model.countTokens(message)));
  return counts.reduce((sum, current) => sum + current, 0);
}

function stripCopilotPrefix(modelId: string): string {
  return modelId.startsWith('copilot/') ? modelId.slice('copilot/'.length) : modelId;
}

