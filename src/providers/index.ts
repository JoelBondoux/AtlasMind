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
export { ProviderRegistry, LocalEchoAdapter, getConfiguredLocalBaseUrl, getDefaultLocalBaseUrl } from './registry.js';
