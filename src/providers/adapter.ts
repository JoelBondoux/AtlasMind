/**
 * Provider adapter interface.
 * Each LLM provider implements this to normalise request/response shapes.
 */

// ── Tool calling ─────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the input parameters. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  /** Provider-assigned unique identifier for this call. */
  id: string;
  /** Name of the tool to invoke. */
  name: string;
  /** Parsed arguments from the model. */
  arguments: Record<string, unknown>;
}

// ── Chat messages ────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Optional image attachments associated with a user message. */
  images?: TaskImageAttachment[];
  /** Required when role is 'tool' – references the tool call being answered. */
  toolCallId?: string;
  /** Required when role is 'tool' – name of the tool that produced this result. */
  toolName?: string;
  /** Populated on 'assistant' messages when the model requests tool executions. */
  toolCalls?: ToolCall[];
}

// ── Request / Response ───────────────────────────────────────────

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  signal?: AbortSignal;
  /** Tools available to the model. When provided the model may respond with tool calls. */
  tools?: ToolDefinition[];
}

export interface CompletionResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: 'stop' | 'length' | 'error' | 'tool_calls';
  /** Populated when finishReason is 'tool_calls'. */
  toolCalls?: ToolCall[];
}

// ── Discovery ────────────────────────────────────────────────────

import type { ModelCapability, SpecialistDomain, TaskImageAttachment } from '../types.js';

/**
 * Partial model metadata returned during runtime discovery.
 * Fields are optional — callers merge these hints with catalog
 * data and heuristic fallbacks.
 */
export interface DiscoveredModel {
  /** Fully qualified model ID, e.g. `copilot/gpt-4o`. */
  id: string;
  /** Human-readable display name. */
  name?: string;
  /** Maximum input context window in tokens. */
  contextWindow?: number;
  /** Known capabilities of this model. */
  capabilities?: ModelCapability[];
  /** Optional domain tags used by specialist routing. */
  specialistDomains?: SpecialistDomain[];
  /** Estimated or actual cost per 1 000 input tokens (USD). */
  inputPricePer1k?: number;
  /** Estimated or actual cost per 1 000 output tokens (USD). */
  outputPricePer1k?: number;
  /**
   * Premium-request multiplier for subscription providers.
   * Standard models = 1 (or omitted), premium = 2+.
   */
  premiumRequestMultiplier?: number;
}

/**
 * All provider adapters implement this interface.
 */
export interface ProviderAdapter {
  readonly providerId: string;

  /**
   * Send a chat completion request and return the response.
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Stream text chunks as they arrive while still returning the final
   * structured completion response. Optional; callers fall back to `complete()`.
   */
  streamComplete?(
    request: CompletionRequest,
    onTextChunk: (chunk: string) => void,
  ): Promise<CompletionResponse>;

  /**
   * List available model IDs from this provider.
   */
  listModels(): Promise<string[]>;

  /**
   * Discover available models with as much metadata as the
   * provider API exposes.  When implemented, the orchestrator
   * prefers this over `listModels()` for richer routing data.
   */
  discoverModels?(): Promise<DiscoveredModel[]>;

  /**
   * Check whether the provider is reachable and authenticated.
   */
  healthCheck(): Promise<boolean>;
}
