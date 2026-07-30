/**
 * Provider adapters barrel export.
 * Individual provider implementations will be added here.
 */

export { type ProviderAdapter, type CompletionRequest, type CompletionResponse, type ChatMessage, type ToolDefinition, type ToolCall, type DiscoveredModel } from './adapter.js';
export { AnthropicAdapter } from './anthropic.js';
export { BedrockAdapter, BEDROCK_ACCESS_KEY_SECRET, BEDROCK_MODEL_IDS_SETTING, BEDROCK_REGION_SETTING, BEDROCK_SECRET_KEY_SECRET, BEDROCK_SESSION_TOKEN_SECRET, getConfiguredBedrockModelIds, getConfiguredBedrockRegion } from './bedrock.js';
export { ClaudeCliAdapter, CLAUDE_CLI_PROVIDER_ID, CLAUDE_CLI_SETUP_URL, probeClaudeCli } from './claude-cli.js';
export { AcpAdapter, AcpAuthRequiredError, ACP_PROVIDER_ID, ACP_SETUP_URL, ACP_PROVIDER_BRIDGES, VERIFIED_ACP_AGENTS, SELF_INSTALLED_ACP_AGENTS, acpInstallCommand, findAcpBridge, parseAcpAgentSettings, resetAcpProbeCache, type AcpAgentConfig, type AcpPermissionPolicy, type AcpProbeResult, type AcpProviderBridge, type AcpToolEventListener, type VerifiedAcpAgent } from './acp.js';
export { acpToolRisk, chooseAllowOption, chooseDenyOption, describeAcpToolCall, resolveAcpPermission, selectAcpMcpServers, type AcpToolRisk, type SkippedAcpMcpServer } from './acpPermission.js';
export { ACP_PERMISSION_METHOD, ACP_TOOL_KINDS, ACP_TOOL_CALL_STATUSES, type AcpMcpServer, type AcpPermissionOption, type AcpPermissionRequest, type AcpToolCall, type AcpToolKind } from './acpProtocol.js';
export { CopilotAdapter } from './copilot.js';
export { OpenAiCompatibleAdapter } from './openai-compatible.js';
export { OpenRouterAdapter } from './openrouter.js';
export { lookupCatalog, type CatalogEntry } from './modelCatalog.js';
export {
	ProviderRegistry,
	LocalEchoAdapter,
	type LocalEndpointConfig,
	decodeLocalEndpointModelId,
	describeLocalModel,
	encodeLocalEndpointModelId,
	getConfiguredLocalBaseUrl,
	getConfiguredLocalEndpoints,
	getDefaultLocalBaseUrl,
	inferLocalEndpointLabel,
} from './registry.js';
