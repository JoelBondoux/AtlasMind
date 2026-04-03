/**
 * Provider adapters barrel export.
 * Individual provider implementations will be added here.
 */

export { type ProviderAdapter, type CompletionRequest, type CompletionResponse, type ChatMessage, type ToolDefinition, type ToolCall } from './adapter.js';
export { AnthropicAdapter } from './anthropic.js';
export { CopilotAdapter } from './copilot.js';

import type { CompletionRequest, CompletionResponse, ProviderAdapter } from './adapter.js';

/**
 * In-memory provider registry used by the orchestrator.
 */
export class ProviderRegistry {
	private readonly adapters = new Map<string, ProviderAdapter>();

	register(adapter: ProviderAdapter): void {
		this.adapters.set(adapter.providerId, adapter);
	}

	get(providerId: string): ProviderAdapter | undefined {
		return this.adapters.get(providerId);
	}

	list(): ProviderAdapter[] {
		return [...this.adapters.values()];
	}
}

/**
 * Local fallback adapter used for offline development.
 */
export class LocalEchoAdapter implements ProviderAdapter {
	readonly providerId = 'local';

	async complete(request: CompletionRequest): Promise<CompletionResponse> {
		const lastUserMessage = [...request.messages]
			.reverse()
			.find(message => message.role === 'user')?.content ?? '';

		const content = `Local adapter response: ${lastUserMessage}`;
		return {
			content,
			model: request.model,
			inputTokens: estimateTokens(request.messages.map(m => m.content).join('\n')),
			outputTokens: estimateTokens(content),
			finishReason: 'stop',
		};
	}

	async listModels(): Promise<string[]> {
		return ['local/echo-1'];
	}

	async healthCheck(): Promise<boolean> {
		return true;
	}
}

function estimateTokens(text: string): number {
	// Rough estimate for tracking and UX until provider-native usage is wired.
	return Math.max(1, Math.ceil(text.length / 4));
}
