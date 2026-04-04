/**
 * Provider adapters barrel export.
 * Individual provider implementations will be added here.
 */

export { type ProviderAdapter, type CompletionRequest, type CompletionResponse, type ChatMessage, type ToolDefinition, type ToolCall, type DiscoveredModel } from './adapter.js';
export { AnthropicAdapter } from './anthropic.js';
export { BedrockAdapter, BEDROCK_ACCESS_KEY_SECRET, BEDROCK_MODEL_IDS_SETTING, BEDROCK_REGION_SETTING, BEDROCK_SECRET_KEY_SECRET, BEDROCK_SESSION_TOKEN_SECRET, getConfiguredBedrockModelIds, getConfiguredBedrockRegion } from './bedrock.js';
export { CopilotAdapter } from './copilot.js';
export { OpenAiCompatibleAdapter } from './openai-compatible.js';
export { lookupCatalog, type CatalogEntry } from './modelCatalog.js';

import * as vscode from 'vscode';
import type { CompletionRequest, CompletionResponse, ProviderAdapter } from './adapter.js';
import type { DiscoveredModel, ToolCall } from './adapter.js';
import { lookupCatalog } from './modelCatalog.js';

const LOCAL_OPENAI_BASE_URL_SETTING = 'localOpenAiBaseUrl';
const LOCAL_OPENAI_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';

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
 * Local provider adapter. Uses a configured OpenAI-compatible local endpoint when
 * available, otherwise falls back to a simple echo response.
 */
export class LocalEchoAdapter implements ProviderAdapter {
	readonly providerId = 'local';

	constructor(private readonly secrets?: vscode.SecretStorage) {}

	async complete(request: CompletionRequest): Promise<CompletionResponse> {
		const baseUrl = getConfiguredLocalBaseUrl();
		if (baseUrl) {
			return this.completeWithLocalEndpoint(baseUrl, request);
		}

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
		const baseUrl = getConfiguredLocalBaseUrl();
		if (baseUrl) {
			return this.listEndpointModels(baseUrl);
		}
		return ['local/echo-1'];
	}

	async discoverModels(): Promise<DiscoveredModel[]> {
		const baseUrl = getConfiguredLocalBaseUrl();
		if (!baseUrl) {
			return [{
				id: 'local/echo-1',
				name: 'Local Echo',
				contextWindow: 8000,
				capabilities: ['chat'],
				inputPricePer1k: 0,
				outputPricePer1k: 0,
			}];
		}

		const ids = await this.listEndpointModels(baseUrl);
		return ids.map(id => {
			const entry = lookupCatalog(this.providerId, id);
			return {
				id,
				name: entry?.name ?? stripProviderPrefix(id),
				contextWindow: entry?.contextWindow,
				capabilities: entry?.capabilities,
				inputPricePer1k: 0,
				outputPricePer1k: 0,
			};
		});
	}

	async healthCheck(): Promise<boolean> {
		const baseUrl = getConfiguredLocalBaseUrl();
		if (!baseUrl) {
			return true;
		}

		try {
			const response = await fetch(`${baseUrl}/models`, {
				method: 'GET',
				headers: await this.buildHeaders(),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	private async completeWithLocalEndpoint(baseUrl: string, request: CompletionRequest): Promise<CompletionResponse> {
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: await this.buildHeaders(),
			body: JSON.stringify(buildPayload(request)),
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Local endpoint request failed (${response.status}): ${body}`);
		}

		const payload = await response.json() as OpenAiChatResponse;
		const choice = payload.choices[0];
		const content = choice?.message?.content ?? '';
		const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map(tc => ({
			id: tc.id,
			name: tc.function.name,
			arguments: parseArguments(tc.function.arguments),
		}));

		return {
			content: content.trim(),
			model: ensureProviderPrefix(this.providerId, payload.model),
			inputTokens: payload.usage?.prompt_tokens ?? 0,
			outputTokens: payload.usage?.completion_tokens ?? 0,
			finishReason: mapFinishReason(choice?.finish_reason ?? null),
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		};
	}

	private async listEndpointModels(baseUrl: string): Promise<string[]> {
		const response = await fetch(`${baseUrl}/models`, {
			method: 'GET',
			headers: await this.buildHeaders(),
		});

		if (!response.ok) {
			return ['local/echo-1'];
		}

		const payload = await response.json() as OpenAiModelListResponse;
		if (!Array.isArray(payload.data)) {
			return ['local/echo-1'];
		}

		const ids = payload.data
			.map(item => item.id)
			.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
			.map(id => ensureProviderPrefix(this.providerId, id));

		return ids.length > 0 ? ids : ['local/echo-1'];
	}

	private async buildHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		const apiKey = this.secrets
			? await this.secrets.get('atlasmind.provider.local.apiKey')
			: undefined;
		if (apiKey && apiKey.trim().length > 0) {
			headers['Authorization'] = `Bearer ${apiKey.trim()}`;
		}

		return headers;
	}
}

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

function buildPayload(request: CompletionRequest): Record<string, unknown> {
	const messages = request.messages.map(message => {
		if (message.role === 'tool') {
			return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
		}
		if (message.role === 'assistant' && message.toolCalls?.length) {
			return {
				role: 'assistant',
				content: message.content || null,
				tool_calls: message.toolCalls.map(toolCall => ({
					id: toolCall.id,
					type: 'function',
					function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
				})),
			};
		}
		if (message.role === 'user' && message.images?.length) {
			return {
				role: 'user',
				content: [
					{ type: 'text', text: message.content },
					...message.images.map(image => ({
						type: 'image_url',
						image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` },
					})),
				],
			};
		}
		return { role: message.role, content: message.content };
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
		payload['tools'] = request.tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
		payload['tool_choice'] = 'auto';
	}

	return payload;
}

function ensureProviderPrefix(providerId: string, modelId: string): string {
	const trimmed = modelId.trim();
	if (trimmed.includes('/')) {
		return trimmed;
	}
	return `${providerId}/${trimmed}`;
}

function stripProviderPrefix(modelId: string): string {
	const slash = modelId.indexOf('/');
	return slash >= 0 ? modelId.slice(slash + 1) : modelId;
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

export function getConfiguredLocalBaseUrl(): string | undefined {
	const raw = vscode.workspace.getConfiguration('atlasmind').get<string>(LOCAL_OPENAI_BASE_URL_SETTING);
	if (typeof raw !== 'string' || raw.trim().length === 0) {
		return undefined;
	}
	return raw.trim().replace(/\/+$/, '');
}

export function getDefaultLocalBaseUrl(): string {
	return LOCAL_OPENAI_DEFAULT_BASE_URL;
}

function estimateTokens(text: string): number {
	// Rough estimate for tracking and UX until provider-native usage is wired.
	return Math.max(1, Math.ceil(text.length / 4));
}
