/**
 * Provider adapter interface.
 * Each LLM provider implements this to normalise request/response shapes.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface CompletionResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: 'stop' | 'length' | 'error';
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
