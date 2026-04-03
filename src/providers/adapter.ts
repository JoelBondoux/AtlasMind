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
   * List available models from this provider.
   */
  listModels(): Promise<string[]>;

  /**
   * Check whether the provider is reachable and authenticated.
   */
  healthCheck(): Promise<boolean>;
}
