import * as vscode from 'vscode';
import type { ChatMessage, CompletionRequest, CompletionResponse, ProviderAdapter, ToolCall } from './adapter.js';

/**
 * Adapter that executes requests through VS Code's Language Model API.
 * Supports tool calling via LanguageModelToolCallPart / LanguageModelToolResultPart.
 */
export class CopilotAdapter implements ProviderAdapter {
  readonly providerId = 'copilot';

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = await this.resolveModel(request.model);
    const messages = toLanguageModelMessages(request.messages);
    const options = buildRequestOptions(request);

    const response = await model.sendRequest(messages, options);

    let content = '';
    const toolCalls: ToolCall[] = [];

    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        content += chunk.value;
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

  async healthCheck(): Promise<boolean> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return models.length > 0;
  }

  private async resolveModel(modelId: string): Promise<vscode.LanguageModelChat> {
    const requestedModelId = stripCopilotPrefix(modelId);

    let matches: vscode.LanguageModelChat[] = [];
    if (requestedModelId && requestedModelId !== 'default') {
      matches = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        id: requestedModelId,
      });
    }

    if (matches.length === 0) {
      matches = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    }

    if (matches.length === 0) {
      throw new Error('No GitHub Copilot chat model is available in this VS Code session.');
    }

    return matches[0];
  }
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
      converted.push(vscode.LanguageModelChatMessage.User(message.content));
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

