import type { CompletionRequest, CompletionResponse, ProviderAdapter } from './adapter.js';
import type { DiscoveredModel, ToolCall } from './adapter.js';
import { lookupCatalog } from './modelCatalog.js';
import type { SecretStore } from '../runtime/secrets.js';

const LOCAL_OPENAI_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const LOCAL_MODEL_ID_DELIMITER = '@@';

export interface LocalEndpointConfig {
  id: string;
  label: string;
  baseUrl: string;
}

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

export class LocalEchoAdapter implements ProviderAdapter {
  readonly providerId = 'local';

  constructor(
    private readonly options?: {
      secrets?: SecretStore;
      getEndpoints?: () => unknown;
      getBaseUrl?: () => string | undefined;
    },
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const endpoints = this.resolveEndpoints();
    const configuredEndpoint = resolveLocalEndpointForModel(request.model, endpoints) ?? endpoints[0];
    if (configuredEndpoint && !isBuiltinLocalEchoModel(request.model)) {
      return this.completeWithLocalEndpoint(configuredEndpoint, request);
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
    const endpoints = this.resolveEndpoints();
    if (endpoints.length > 0) {
      const perEndpointModels = await Promise.all(endpoints.map(async endpoint => {
        const ids = await this.listEndpointModels(endpoint);
        return ids.filter(modelId => !isBuiltinLocalEchoModel(modelId));
      }));
      const combined = perEndpointModels.flat();
      return combined.length > 0 ? combined : ['local/echo-1'];
    }
    return ['local/echo-1'];
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    const endpoints = this.resolveEndpoints();
    if (endpoints.length === 0) {
      return [{
        id: 'local/echo-1',
        name: 'Local Echo',
        contextWindow: 8000,
        capabilities: ['chat'],
        inputPricePer1k: 0,
        outputPricePer1k: 0,
      }];
    }

    const discovered = await Promise.all(endpoints.map(async endpoint => {
      const ids = await this.listEndpointModels(endpoint);
      return ids
        .filter(id => !isBuiltinLocalEchoModel(id))
        .map(id => {
          const rawModelId = decodeLocalEndpointModelId(id).rawModelId;
          const entry = lookupCatalog(this.providerId, ensureProviderPrefix(this.providerId, rawModelId));
          return {
            id,
            name: `${entry?.name ?? rawModelId} (${endpoint.label})`,
            contextWindow: entry?.contextWindow,
            capabilities: entry?.capabilities,
            inputPricePer1k: 0,
            outputPricePer1k: 0,
          } satisfies DiscoveredModel;
        });
    }));

    const combined = discovered.flat();
    return combined.length > 0 ? combined : [{
      id: 'local/echo-1',
      name: 'Local Echo',
      contextWindow: 8000,
      capabilities: ['chat'],
      inputPricePer1k: 0,
      outputPricePer1k: 0,
    }];
  }

  async healthCheck(): Promise<boolean> {
    const endpoints = this.resolveEndpoints();
    if (endpoints.length === 0) {
      return true;
    }

    const results = await Promise.all(endpoints.map(async endpoint => {
      try {
        const response = await fetch(`${endpoint.baseUrl}/models`, {
          method: 'GET',
          headers: await this.buildHeaders(),
        });
        return response.ok;
      } catch {
        return false;
      }
    }));

    return results.some(Boolean);
  }

  private async completeWithLocalEndpoint(endpoint: LocalEndpointConfig, request: CompletionRequest): Promise<CompletionResponse> {
    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: request.signal,
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
      model: encodeLocalEndpointModelId(endpoint.id, payload.model),
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      finishReason: mapFinishReason(choice?.finish_reason ?? null),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private async listEndpointModels(endpoint: LocalEndpointConfig): Promise<string[]> {
    const response = await fetch(`${endpoint.baseUrl}/models`, {
      method: 'GET',
      headers: await this.buildHeaders(),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json() as OpenAiModelListResponse;
    if (!Array.isArray(payload.data)) {
      return [];
    }

    const ids = payload.data
      .map(item => item.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map(id => encodeLocalEndpointModelId(endpoint.id, id));

    return ids;
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = this.options?.secrets
      ? await this.options.secrets.get('atlasmind.provider.local.apiKey')
      : undefined;
    if (apiKey && apiKey.trim().length > 0) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    return headers;
  }

  private resolveBaseUrl(): string | undefined {
    return getConfiguredLocalBaseUrl(this.options?.getBaseUrl);
  }

  private resolveEndpoints(): LocalEndpointConfig[] {
    return getConfiguredLocalEndpoints({
      getEndpoints: this.options?.getEndpoints,
      getLegacyBaseUrl: this.options?.getBaseUrl,
    });
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
    if (message.role === 'system') {
      return { role: 'system', content: message.content };
    }
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
    model: decodeLocalEndpointModelId(request.model).rawModelId,
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

function isBuiltinLocalEchoModel(modelId: string): boolean {
  return stripProviderPrefix(modelId).trim() === 'echo-1';
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

export function getConfiguredLocalBaseUrl(getValue?: () => string | undefined): string | undefined {
  const raw = getValue?.() ?? process.env['ATLASMIND_LOCAL_OPENAI_BASE_URL'];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }
  return raw.trim().replace(/\/+$/, '');
}

export function getConfiguredLocalEndpoints(options?: {
  getEndpoints?: () => unknown;
  getLegacyBaseUrl?: () => string | undefined;
}): LocalEndpointConfig[] {
  const configured = options?.getEndpoints?.();
  const fromArray = normalizeConfiguredLocalEndpoints(configured);
  if (fromArray.length > 0) {
    return fromArray;
  }

  const legacyBaseUrl = getConfiguredLocalBaseUrl(options?.getLegacyBaseUrl);
  if (!legacyBaseUrl) {
    return [];
  }

  return [{
    id: buildLocalEndpointId(inferLocalEndpointLabel(legacyBaseUrl), 0, new Set()),
    label: inferLocalEndpointLabel(legacyBaseUrl),
    baseUrl: legacyBaseUrl,
  }];
}

export function inferLocalEndpointLabel(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '11434') {
      return 'Ollama';
    }
    if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '1234') {
      return 'LM Studio';
    }

    const host = parsed.hostname === '127.0.0.1' ? 'localhost' : parsed.hostname;
    return parsed.port ? `${host}:${parsed.port}` : host;
  } catch {
    return 'Local Endpoint';
  }
}

export function encodeLocalEndpointModelId(endpointId: string, modelId: string): string {
  const rawModelId = modelId.trim().replace(/^local\//, '');
  return ensureProviderPrefix('local', `${endpointId}${LOCAL_MODEL_ID_DELIMITER}${rawModelId}`);
}

export function decodeLocalEndpointModelId(modelId: string): { endpointId?: string; rawModelId: string } {
  const stripped = stripProviderPrefix(modelId).trim();
  const delimiterIndex = stripped.indexOf(LOCAL_MODEL_ID_DELIMITER);
  if (delimiterIndex < 0) {
    return { rawModelId: stripped };
  }

  return {
    endpointId: stripped.slice(0, delimiterIndex),
    rawModelId: stripped.slice(delimiterIndex + LOCAL_MODEL_ID_DELIMITER.length),
  };
}

export function describeLocalModel(modelId: string, endpoints: LocalEndpointConfig[]): string {
  const decoded = decodeLocalEndpointModelId(modelId);
  if (!decoded.endpointId) {
    return decoded.rawModelId;
  }

  const endpoint = endpoints.find(candidate => candidate.id === decoded.endpointId);
  return endpoint ? `${endpoint.label}: ${decoded.rawModelId}` : decoded.rawModelId;
}

export function getDefaultLocalBaseUrl(): string {
  return LOCAL_OPENAI_DEFAULT_BASE_URL;
}

function normalizeConfiguredLocalEndpoints(value: unknown): LocalEndpointConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const usedIds = new Set<string>();
  const normalized: LocalEndpointConfig[] = [];
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const baseUrl = typeof record['baseUrl'] === 'string' ? record['baseUrl'].trim().replace(/\/+$/, '') : '';
    if (baseUrl.length === 0) {
      continue;
    }

    const label = typeof record['label'] === 'string' && record['label'].trim().length > 0
      ? record['label'].trim()
      : inferLocalEndpointLabel(baseUrl);

    let id = typeof record['id'] === 'string' ? sanitizeLocalEndpointId(record['id']) : '';
    if (!id) {
      id = buildLocalEndpointId(label, index, usedIds);
    } else if (usedIds.has(id)) {
      id = buildLocalEndpointId(label, index, usedIds);
    } else {
      usedIds.add(id);
    }

    normalized.push({ id, label, baseUrl });
  }

  return normalized;
}

function buildLocalEndpointId(label: string, index: number, usedIds: Set<string>): string {
  const base = sanitizeLocalEndpointId(label) || `endpoint-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function sanitizeLocalEndpointId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function resolveLocalEndpointForModel(modelId: string, endpoints: LocalEndpointConfig[]): LocalEndpointConfig | undefined {
  const decoded = decodeLocalEndpointModelId(modelId);
  if (decoded.endpointId) {
    return endpoints.find(endpoint => endpoint.id === decoded.endpointId);
  }

  return endpoints.length === 1 ? endpoints[0] : undefined;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}