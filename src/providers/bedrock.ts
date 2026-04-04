import * as vscode from 'vscode';
import { createHash, createHmac } from 'node:crypto';
import type { CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter, ToolCall } from './adapter.js';
import { lookupCatalog } from './modelCatalog.js';

export const BEDROCK_REGION_SETTING = 'bedrock.region';
export const BEDROCK_MODEL_IDS_SETTING = 'bedrock.modelIds';
export const BEDROCK_ACCESS_KEY_SECRET = 'atlasmind.provider.bedrock.accessKeyId';
export const BEDROCK_SECRET_KEY_SECRET = 'atlasmind.provider.bedrock.secretAccessKey';
export const BEDROCK_SESSION_TOKEN_SECRET = 'atlasmind.provider.bedrock.sessionToken';

interface BedrockConverseResponse {
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  output?: {
    message?: {
      content?: Array<
        | { text?: string }
        | { toolUse?: { toolUseId: string; name: string; input?: Record<string, unknown> } }
      >;
    };
  };
}

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export class BedrockAdapter implements ProviderAdapter {
  readonly providerId = 'bedrock';

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const region = getConfiguredBedrockRegion();
    if (!region) {
      throw new Error('Amazon Bedrock region is not configured. Set it in AtlasMind: Manage Model Providers.');
    }

    const credentials = await this.getCredentials();
    const modelId = stripProviderPrefix(request.model);
    const payload = JSON.stringify(buildBedrockPayload(request));
    const url = new URL(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`);
    const signed = signAwsRequest(url, 'POST', payload, region, 'bedrock', credentials);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: signed.headers,
      body: payload,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Amazon Bedrock request failed (${response.status}): ${body}`);
    }

    const result = await response.json() as BedrockConverseResponse;
    return toCompletionResponse(request.model, result);
  }

  async listModels(): Promise<string[]> {
    return getConfiguredBedrockModelIds().map(modelId => ensureProviderPrefix(this.providerId, modelId));
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    const ids = await this.listModels();
    return ids.map(id => {
      const entry = lookupCatalog(this.providerId, id);
      return {
        id,
        name: entry?.name,
        contextWindow: entry?.contextWindow,
        capabilities: entry?.capabilities,
        inputPricePer1k: entry?.inputPricePer1k,
        outputPricePer1k: entry?.outputPricePer1k,
        premiumRequestMultiplier: entry?.premiumRequestMultiplier,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    const region = getConfiguredBedrockRegion();
    const modelIds = getConfiguredBedrockModelIds();
    if (!region || modelIds.length === 0) {
      return false;
    }

    try {
      await this.getCredentials();
      return true;
    } catch {
      return false;
    }
  }

  private async getCredentials(): Promise<AwsCredentials> {
    const accessKeyId = (await this.secrets.get(BEDROCK_ACCESS_KEY_SECRET))?.trim() || process.env['AWS_ACCESS_KEY_ID']?.trim();
    const secretAccessKey = (await this.secrets.get(BEDROCK_SECRET_KEY_SECRET))?.trim() || process.env['AWS_SECRET_ACCESS_KEY']?.trim();
    const sessionToken = (await this.secrets.get(BEDROCK_SESSION_TOKEN_SECRET))?.trim() || process.env['AWS_SESSION_TOKEN']?.trim();

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Amazon Bedrock credentials are not configured. Set them in AtlasMind: Manage Model Providers.');
    }

    return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
  }
}

export function getConfiguredBedrockRegion(): string {
  const value = vscode.workspace.getConfiguration('atlasmind').get<string>(BEDROCK_REGION_SETTING, '');
  return typeof value === 'string' ? value.trim() : '';
}

export function getConfiguredBedrockModelIds(): string[] {
  const value = vscode.workspace.getConfiguration('atlasmind').get<string[]>(BEDROCK_MODEL_IDS_SETTING, []);
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(item => item.length > 0);
}

function buildBedrockPayload(request: CompletionRequest): Record<string, unknown> {
  const system = request.messages
    .filter(message => message.role === 'system' && message.content.trim().length > 0)
    .map(message => ({ text: message.content }));

  const messages = request.messages
    .filter(message => message.role !== 'system')
    .map(message => toBedrockMessage(message));

  const payload: Record<string, unknown> = {
    messages,
    inferenceConfig: {
      maxTokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.2,
      ...(request.stop?.length ? { stopSequences: request.stop } : {}),
    },
  };

  if (system.length > 0) {
    payload['system'] = system;
  }

  if (request.tools?.length) {
    payload['toolConfig'] = {
      tools: request.tools.map(tool => ({
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: { json: tool.parameters },
        },
      })),
    };
  }

  return payload;
}

function toBedrockMessage(message: CompletionRequest['messages'][number]): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [{
        toolResult: {
          toolUseId: message.toolCallId,
          content: [{ text: message.content }],
          status: 'success',
        },
      }],
    };
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    const content: Array<Record<string, unknown>> = [];
    if (message.content.trim().length > 0) {
      content.push({ text: message.content });
    }
    for (const toolCall of message.toolCalls) {
      content.push({
        toolUse: {
          toolUseId: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments,
        },
      });
    }
    return { role: 'assistant', content };
  }

  return {
    role: message.role,
    content: [{ text: message.content }],
  };
}

function toCompletionResponse(requestModel: string, response: BedrockConverseResponse): CompletionResponse {
  const content = response.output?.message?.content ?? [];
  const text = content
    .flatMap(item => 'text' in item && typeof item.text === 'string' ? [item.text] : [])
    .join('\n')
    .trim();
  const toolCalls: ToolCall[] = content
    .flatMap(item => 'toolUse' in item && item.toolUse
      ? [{
          id: item.toolUse.toolUseId,
          name: item.toolUse.name,
          arguments: item.toolUse.input ?? {},
        }]
      : []);

  return {
    content: text,
    model: requestModel,
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
    finishReason: mapStopReason(response.stopReason, toolCalls.length > 0),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function mapStopReason(stopReason: string | undefined, hasToolCalls: boolean): CompletionResponse['finishReason'] {
  if (hasToolCalls || stopReason === 'tool_use') {
    return 'tool_calls';
  }
  if (stopReason === 'max_tokens') {
    return 'length';
  }
  return 'stop';
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

function signAwsRequest(
  url: URL,
  method: string,
  body: string,
  region: string,
  service: string,
  credentials: AwsCredentials,
): { headers: Record<string, string> } {
  const amzDate = toAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalQuery = canonicalizeQuery(url.searchParams);
  const host = url.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (credentials.sessionToken) {
    headers['x-amz-security-token'] = credentials.sessionToken;
  }

  const sortedHeaders = Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const);
  const canonicalHeaders = sortedHeaders.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = sortedHeaders.map(([name]) => name).join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalizePath(url.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = getSignatureKey(credentials.secretAccessKey, dateStamp, region, service);
  const signature = hmacHex(signingKey, stringToSign);

  return {
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': 'application/json',
    },
  };
}

function canonicalizePath(pathname: string): string {
  return pathname
    .split('/')
    .map(segment => awsEncodeURIComponent(segment))
    .join('/');
}

function canonicalizeQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = leftKey.localeCompare(rightKey);
      return keyOrder !== 0 ? keyOrder : leftValue.localeCompare(rightValue);
    })
    .map(([key, value]) => `${awsEncodeURIComponent(key)}=${awsEncodeURIComponent(value)}`)
    .join('&');
}

function awsEncodeURIComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function hmacHex(key: Buffer | string, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function getSignatureKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function toAmzDate(date: Date): string {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return iso.slice(0, 15) + 'Z';
}
