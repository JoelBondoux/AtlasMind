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
  /** Opaque signature required by Google Gemini thinking models; must be echoed back verbatim in follow-up requests. */
  thoughtSignature?: string;
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
  /**
   * Stable identity for one logical provider turn.
   *
   * Adapters may use this to attach a retry to work already in flight instead
   * of paying for or executing the same prompt twice. Callers that do not
   * retry may omit it; it is never sent to the model.
   */
  requestId?: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  signal?: AbortSignal;
  /** Tools available to the model. When provided the model may respond with tool calls. */
  tools?: ToolDefinition[];
  /**
   * Per-turn authorization for a provider-native agent to use its own tools.
   *
   * This is distinct from `tools`, which contains AtlasMind function schemas.
   * Omitted or false means completion-only even when the provider's global
   * delegated-execution setting is enabled.
   */
  allowDelegatedToolExecution?: boolean;
  /**
   * Hint that this turn's stable prompt prefix (system head + tools) is expected
   * to be reused — e.g. a threaded conversation — so cache-capable providers
   * should write it to the prompt cache even without tools. Adapters that do not
   * support explicit caching ignore it.
   */
  cacheStablePrefix?: boolean;
}

export interface CompletionResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Portion of `inputTokens` that was served from the provider's prompt cache
   * (billed at the reduced cache-read rate), when the provider reports it. Used
   * for cache-savings accounting. Omitted when the provider does not surface
   * cache usage.
   */
  cachedInputTokens?: number;
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
  /**
   * Whether this provider can complete tool-backed work through its own
   * approval-gated agent tools instead of AtlasMind function calls.
   */
  delegatedToolExecution?: boolean;
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
  /**
   * Reasoning depth, when the adapter learned it from the agent rather than the
   * static catalog.
   *
   * Added for ACP effort variants (`acp/claude#high`), whose depth is not a fact
   * about a model name a catalog could hold — it is the effort tier the agent
   * offered on this session. The catalog still wins for everything it knows
   * about; this fills the gap for models that only exist because a provider
   * reported them.
   */
  reasoningDepth?: number;
  /**
   * Whether the model supports prompt caching, reported dynamically by the
   * provider's discovery so cache capability tracks provider changes. Overrides
   * the static catalog/provider-set fallback when present (including an explicit
   * `false` when a provider drops caching support).
   */
  supportsPromptCaching?: boolean;
  /** Dynamically discovered cache-read price per 1K input tokens (USD). */
  cachedInputPricePer1k?: number;
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
