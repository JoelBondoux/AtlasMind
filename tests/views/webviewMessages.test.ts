import { describe, expect, it } from 'vitest';
import { isSettingsMessage } from '../../src/views/settingsPanel.ts';
import { isModelProviderMessage } from '../../src/views/modelProviderPanel.ts';
import { isProjectRunCenterMessage, parseEditableProjectPlan } from '../../src/views/projectRunCenterPanel.ts';
import { isVisionPanelMessage, parseWorkspaceFileReference } from '../../src/views/visionPanel.ts';
import { isToolWebhookMessage } from '../../src/views/toolWebhookPanel.ts';
import { validatePanelMessage } from '../../src/views/mcpPanel.ts';
import { isAgentPanelMessage } from '../../src/views/agentManagerPanel.ts';
import { isSpecialistIntegrationsMessage } from '../../src/views/specialistIntegrationsPanel.ts';
import { isChatPanelMessage, parseFileReference } from '../../src/views/chatPanel.ts';
import { isCostDashboardMessage } from '../../src/views/costDashboardPanel.ts';
import { isProjectDashboardMessage, chooseDeployedVersionRef, normalizeDashboardPromptRequest } from '../../src/views/projectDashboardPanel.ts';
import { isProjectIdeationMessage } from '../../src/views/projectIdeationPanel.ts';

describe('validatePanelMessage', () => {
  it('accepts MCP add-server payloads that target an existing server for editing', () => {
    expect(validatePanelMessage({
      type: 'addServer',
      payload: {
        editServerId: 'shopify-1',
        name: 'Shopify MCP Server',
        transport: 'http',
        url: 'https://mcp.gossipier.io/mcp',
        enabled: true,
      },
    })).toEqual({
      type: 'addServer',
      payload: {
        editServerId: 'shopify-1',
        name: 'Shopify MCP Server',
        transport: 'http',
        url: 'https://mcp.gossipier.io/mcp',
        enabled: true,
      },
    });
  });
});

describe('isSettingsMessage', () => {
  // ── Valid messages ──────────────────────────────────────────

  it('accepts a valid setBudgetMode message', () => {
    expect(isSettingsMessage({ type: 'setBudgetMode', payload: 'cheap' })).toBe(true);
    expect(isSettingsMessage({ type: 'setBudgetMode', payload: 'balanced' })).toBe(true);
    expect(isSettingsMessage({ type: 'setBudgetMode', payload: 'expensive' })).toBe(true);
    expect(isSettingsMessage({ type: 'setBudgetMode', payload: 'auto' })).toBe(true);
  });

  it('accepts a valid setSpeedMode message', () => {
    expect(isSettingsMessage({ type: 'setSpeedMode', payload: 'fast' })).toBe(true);
    expect(isSettingsMessage({ type: 'setSpeedMode', payload: 'balanced' })).toBe(true);
    expect(isSettingsMessage({ type: 'setSpeedMode', payload: 'considered' })).toBe(true);
    expect(isSettingsMessage({ type: 'setSpeedMode', payload: 'auto' })).toBe(true);
  });

  it('accepts a valid local endpoint settings message', () => {
    expect(isSettingsMessage({ type: 'setLocalOpenAiBaseUrl', payload: 'http://127.0.0.1:11434/v1' })).toBe(true);
    expect(isSettingsMessage({ type: 'setLocalOpenAiBaseUrl', payload: 'https://localhost:1234/v1' })).toBe(true);
    expect(isSettingsMessage({
      type: 'setLocalOpenAiEndpoints',
      payload: [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' }],
    })).toBe(true);
  });

  it('accepts valid tool approval settings messages', () => {
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'always-ask' })).toBe(true);
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'ask-on-write' })).toBe(true);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: false })).toBe(true);
    expect(isSettingsMessage({ type: 'setAcpToolsEnabled', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setAcpToolsEnabled', payload: false })).toBe(true);
    expect(isSettingsMessage({ type: 'setAcpHideConsoleWindows', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setAcpHideConsoleWindows', payload: false })).toBe(true);
    expect(isSettingsMessage({ type: 'setAutoVerifyAfterWrite', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setAutoVerifyScripts', payload: 'test, lint' })).toBe(true);
  });

  it('accepts valid voice TTS settings messages', () => {
    expect(isSettingsMessage({ type: 'setVoiceTtsEnabled', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceTtsEnabled', payload: false })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceRate', payload: 0.5 })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceRate', payload: 1.35 })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoicePitch', payload: 0 })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoicePitch', payload: 1.2 })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceVolume', payload: 0 })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceVolume', payload: 0.85 })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceLanguage', payload: 'en-US' })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceLanguage', payload: '' })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceOutputDeviceId', payload: 'default-speaker' })).toBe(true);
    expect(isSettingsMessage({ type: 'setVoiceOutputDeviceId', payload: '' })).toBe(true);
  });

  it('accepts valid numeric threshold messages', () => {
    expect(isSettingsMessage({ type: 'setDailyCostLimitUsd', payload: 0 })).toBe(true);
    expect(isSettingsMessage({ type: 'setDailyCostLimitUsd', payload: 5.5 })).toBe(true);
    expect(isSettingsMessage({ type: 'setFeedbackRoutingWeight', payload: 0 })).toBe(true);
    expect(isSettingsMessage({ type: 'setFeedbackRoutingWeight', payload: 1.25 })).toBe(true);
    expect(isSettingsMessage({ type: 'setAutoVerifyTimeoutMs', payload: 120000 })).toBe(true);
    expect(isSettingsMessage({ type: 'setChatSessionTurnLimit', payload: 6 })).toBe(true);
    expect(isSettingsMessage({ type: 'setChatSessionContextChars', payload: 2500 })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: 5 })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectEstimatedFilesPerSubtask', payload: 3 })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectChangedFileReferenceLimit', payload: 10 })).toBe(true);
  });

  it('accepts quick action messages', () => {
    expect(isSettingsMessage({ type: 'purgeProjectMemory' })).toBe(true);
    expect(isSettingsMessage({ type: 'openChatView' })).toBe(true);
    expect(isSettingsMessage({ type: 'openChatPanel' })).toBe(true);
    expect(isSettingsMessage({ type: 'openChat' })).toBe(true);
    expect(isSettingsMessage({ type: 'openAgentPanel' })).toBe(true);
    expect(isSettingsMessage({ type: 'openPersonalityProfile' })).toBe(true);
    expect(isSettingsMessage({ type: 'openModelProviders' })).toBe(true);
    expect(isSettingsMessage({ type: 'openSpecialistIntegrations' })).toBe(true);
    expect(isSettingsMessage({ type: 'openProjectRunCenter' })).toBe(true);
    expect(isSettingsMessage({ type: 'setupLensDeclarations' })).toBe(true);
    expect(isSettingsMessage({ type: 'openVoicePanel' })).toBe(true);
    expect(isSettingsMessage({ type: 'openVisionPanel' })).toBe(true);
    expect(isSettingsMessage({ type: 'chooseAcpConsoleMode' })).toBe(true);
    expect(isSettingsMessage({ type: 'refreshTestingInventory' })).toBe(true);
    expect(isSettingsMessage({ type: 'createTestFile' })).toBe(true);
    expect(isSettingsMessage({ type: 'openCoverageReport' })).toBe(true);
    expect(isSettingsMessage({ type: 'openWorkspaceFile', payload: 'tests/commands.test.ts' })).toBe(true);
  });

  it('accepts only bounded sidebar restore identities', () => {
    expect(isSettingsMessage({
      type: 'restoreModelSidebarEntry',
      payload: 'model:local:local%2Fqwen%3A7b',
    })).toBe(true);
    expect(isSettingsMessage({ type: 'restoreModelSidebarEntry', payload: '' })).toBe(false);
    expect(isSettingsMessage({ type: 'restoreModelSidebarEntry', payload: 'provider:\nopenai' })).toBe(false);
    expect(isSettingsMessage({ type: 'restoreModelSidebarEntry', payload: 42 })).toBe(false);
    expect(isSettingsMessage({
      type: 'restoreModelSidebarEntry',
      payload: `provider:${'x'.repeat(4096)}`,
    })).toBe(false);
  });

  it('accepts a valid setProjectRunReportFolder message', () => {
    expect(isSettingsMessage({ type: 'setProjectRunReportFolder', payload: 'project_memory/ops' })).toBe(true);
  });

  it('accepts valid dependency monitoring governance messages', () => {
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringEnabled', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringEnabled', payload: false })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: ['dependabot'] })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: ['renovate'] })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: ['snyk'] })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: ['azure-devops'] })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: ['dependabot', 'renovate'] })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: ['dependabot', 'snyk', 'azure-devops'] })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: [] })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringSchedule', payload: 'daily' })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringSchedule', payload: 'weekly' })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringSchedule', payload: 'monthly' })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringIssueTemplate', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringIssueTemplate', payload: false })).toBe(true);
  });

  it('accepts a valid setExperimentalSkillLearningEnabled message', () => {
    expect(isSettingsMessage({ type: 'setExperimentalSkillLearningEnabled', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setExperimentalSkillLearningEnabled', payload: false })).toBe(true);
  });

  // ── Invalid messages ────────────────────────────────────────

  it('rejects null', () => {
    expect(isSettingsMessage(null)).toBe(false);
  });

  it('rejects primitives', () => {
    expect(isSettingsMessage(42)).toBe(false);
    expect(isSettingsMessage('hello')).toBe(false);
    expect(isSettingsMessage(true)).toBe(false);
  });

  it('rejects objects without type field', () => {
    expect(isSettingsMessage({ payload: 'cheap' })).toBe(false);
  });

  it('rejects unknown message types', () => {
    expect(isSettingsMessage({ type: 'hackTheSystem', payload: 'pwned' })).toBe(false);
  });

  it('rejects setBudgetMode with invalid payload', () => {
    expect(isSettingsMessage({ type: 'setBudgetMode', payload: 'ultra' })).toBe(false);
    expect(isSettingsMessage({ type: 'setBudgetMode', payload: 123 })).toBe(false);
  });

  it('rejects setSpeedMode with invalid payload', () => {
    expect(isSettingsMessage({ type: 'setSpeedMode', payload: 'turbo' })).toBe(false);
    expect(isSettingsMessage({ type: 'setSpeedMode', payload: null })).toBe(false);
  });

  it('rejects invalid local endpoint settings payloads', () => {
    expect(isSettingsMessage({ type: 'setLocalOpenAiBaseUrl', payload: '' })).toBe(false);
    expect(isSettingsMessage({ type: 'setLocalOpenAiBaseUrl', payload: 123 })).toBe(false);
    expect(isSettingsMessage({ type: 'setLocalOpenAiEndpoints', payload: [{ id: '', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' }] })).toBe(false);
    expect(isSettingsMessage({ type: 'setLocalOpenAiEndpoints', payload: [{ id: 'ollama', label: '', baseUrl: 'http://127.0.0.1:11434/v1' }] })).toBe(false);
    expect(isSettingsMessage({ type: 'setLocalOpenAiEndpoints', payload: [{ id: 'ollama', label: 'Ollama', baseUrl: '' }] })).toBe(false);
    expect(isSettingsMessage({ type: 'openWorkspaceFile', payload: '../secrets.env' })).toBe(false);
    expect(isSettingsMessage({ type: 'openWorkspaceFile', payload: 'C:/Windows/System32/drivers/etc/hosts' })).toBe(false);
  });

  it('rejects invalid tool approval payloads', () => {
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'let-it-rip' })).toBe(false);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: 'yes' })).toBe(false);
    expect(isSettingsMessage({ type: 'setAcpToolsEnabled', payload: 'yes' })).toBe(false);
    expect(isSettingsMessage({ type: 'setAcpHideConsoleWindows', payload: 'yes' })).toBe(false);
    expect(isSettingsMessage({ type: 'setAutoVerifyAfterWrite', payload: 'true' })).toBe(false);
  });

  it('rejects invalid voice TTS payloads', () => {
    expect(isSettingsMessage({ type: 'setVoiceTtsEnabled', payload: 'true' })).toBe(false);
    expect(isSettingsMessage({ type: 'setVoiceRate', payload: 0.49 })).toBe(false);
    expect(isSettingsMessage({ type: 'setVoiceRate', payload: 2.01 })).toBe(false);
    expect(isSettingsMessage({ type: 'setVoicePitch', payload: -0.1 })).toBe(false);
    expect(isSettingsMessage({ type: 'setVoicePitch', payload: 2.1 })).toBe(false);
    expect(isSettingsMessage({ type: 'setVoiceVolume', payload: -0.01 })).toBe(false);
    expect(isSettingsMessage({ type: 'setVoiceVolume', payload: 1.01 })).toBe(false);
    expect(isSettingsMessage({ type: 'setVoiceLanguage', payload: 7 })).toBe(false);
    expect(isSettingsMessage({ type: 'setVoiceOutputDeviceId', payload: true })).toBe(false);
  });

  it('rejects numeric thresholds below 1', () => {
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: 0 })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: -5 })).toBe(false);
    expect(isSettingsMessage({ type: 'setDailyCostLimitUsd', payload: -0.01 })).toBe(false);
    expect(isSettingsMessage({ type: 'setFeedbackRoutingWeight', payload: -0.01 })).toBe(false);
    expect(isSettingsMessage({ type: 'setFeedbackRoutingWeight', payload: 2.5 })).toBe(false);
  });

  it('rejects non-finite numeric thresholds', () => {
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: Infinity })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: NaN })).toBe(false);
  });

  it('rejects empty report folder', () => {
    expect(isSettingsMessage({ type: 'setProjectRunReportFolder', payload: '' })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectRunReportFolder', payload: '   ' })).toBe(false);
  });

  it('rejects invalid dependency monitoring governance payloads', () => {
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringEnabled', payload: 'true' })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: ['dependabot', 'mend'] })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringProviders', payload: 'dependabot' })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringSchedule', payload: 'hourly' })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectDependencyMonitoringIssueTemplate', payload: 1 })).toBe(false);
  });

  it('rejects non-boolean experimentalSkillLearningEnabled', () => {
    expect(isSettingsMessage({ type: 'setExperimentalSkillLearningEnabled', payload: 'yes' })).toBe(false);
    expect(isSettingsMessage({ type: 'setExperimentalSkillLearningEnabled', payload: 1 })).toBe(false);
  });
});

describe('isCostDashboardMessage', () => {
  it('accepts supported dashboard messages', () => {
    expect(isCostDashboardMessage({ type: 'resetHistory' })).toBe(true);
    expect(isCostDashboardMessage({ type: 'openSettings' })).toBe(true);
    expect(isCostDashboardMessage({ type: 'setTimescale', value: '30d' })).toBe(true);
    expect(isCostDashboardMessage({ type: 'setTimescale', value: 'mtd' })).toBe(true);
    expect(isCostDashboardMessage({ type: 'setTimescale', value: 'all' })).toBe(true);
    expect(isCostDashboardMessage({ type: 'setExcludeSubscriptionIncluded', value: true })).toBe(true);
    expect(isCostDashboardMessage({ type: 'openChatMessage', sessionId: 'chat-1', messageId: 'msg-1' })).toBe(true);
  });

  it('rejects malformed dashboard messages', () => {
    expect(isCostDashboardMessage({ type: 'setTimescale', value: 0 })).toBe(false);
    expect(isCostDashboardMessage({ type: 'setTimescale', value: '90d' })).toBe(false);
    expect(isCostDashboardMessage({ type: 'setExcludeSubscriptionIncluded', value: 'yes' })).toBe(false);
    expect(isCostDashboardMessage({ type: 'openChatMessage', sessionId: '', messageId: 'msg-1' })).toBe(false);
    expect(isCostDashboardMessage({ type: 'unknown' })).toBe(false);
  });
});

describe('isModelProviderMessage', () => {
  it('accepts a valid saveApiKey message', () => {
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'anthropic' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'openai' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'azure' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'bedrock' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'xai' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'cohere' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'copilot' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'local' })).toBe(true);
  });

  it('accepts a refreshModels message', () => {
    expect(isModelProviderMessage({ type: 'refreshModels' })).toBe(true);
    expect(isModelProviderMessage({ type: 'openSpecialistIntegrations' })).toBe(true);
    expect(isModelProviderMessage({ type: 'openSettings' })).toBe(true);
    expect(isModelProviderMessage({ type: 'openSettingsPage', payload: 'safety' })).toBe(true);
  });

  it('rejects null and primitives', () => {
    expect(isModelProviderMessage(null)).toBe(false);
    expect(isModelProviderMessage(42)).toBe(false);
    expect(isModelProviderMessage('hello')).toBe(false);
  });

  it('rejects objects without type', () => {
    expect(isModelProviderMessage({ payload: 'anthropic' })).toBe(false);
  });

  it('rejects unknown types', () => {
    expect(isModelProviderMessage({ type: 'deleteProvider', payload: 'anthropic' })).toBe(false);
  });

  it('rejects saveApiKey with invalid provider', () => {
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'unknown-provider' })).toBe(false);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 123 })).toBe(false);
  });

  it('rejects an unrecognised or inherited settings-page id', () => {
    expect(isModelProviderMessage({ type: 'openSettingsPage', payload: 'missing' })).toBe(false);
    expect(isModelProviderMessage({ type: 'openSettingsPage', payload: 'toString' })).toBe(false);
    expect(isModelProviderMessage({ type: 'openSettingsPage', payload: 123 })).toBe(false);
  });
});

describe('isSpecialistIntegrationsMessage', () => {
  it('accepts specialist provider credential and command messages', () => {
    expect(isSpecialistIntegrationsMessage({ type: 'configureProvider', payload: 'exa' })).toBe(true);
    expect(isSpecialistIntegrationsMessage({ type: 'configureProvider', payload: 'elevenlabs' })).toBe(true);
    expect(isSpecialistIntegrationsMessage({ type: 'openCommand', payload: 'atlasmind.openVoicePanel' })).toBe(true);
    expect(isSpecialistIntegrationsMessage({ type: 'openCommand', payload: 'atlasmind.openVisionPanel' })).toBe(true);
    expect(isSpecialistIntegrationsMessage({ type: 'openSettings' })).toBe(true);
  });

  it('rejects invalid specialist integration messages', () => {
    expect(isSpecialistIntegrationsMessage({ type: 'configureProvider', payload: 'openai' })).toBe(false);
    expect(isSpecialistIntegrationsMessage({ type: 'openCommand', payload: 'atlasmind.deleteEverything' })).toBe(false);
    expect(isSpecialistIntegrationsMessage(null)).toBe(false);
  });
});

describe('isChatPanelMessage', () => {
  it('accepts valid chat panel messages', () => {
    expect(isChatPanelMessage({ type: 'submitPrompt', payload: { prompt: 'Explain the current routing logic.', mode: 'send' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'submitPrompt', payload: { prompt: 'Continue autonomously.', mode: 'steer' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'clearConversation' })).toBe(true);
    expect(isChatPanelMessage({ type: 'copyTranscript' })).toBe(true);
    expect(isChatPanelMessage({ type: 'saveTranscript' })).toBe(true);
    expect(isChatPanelMessage({ type: 'createSession' })).toBe(true);
    expect(isChatPanelMessage({ type: 'archiveSession', payload: 'chat-1' })).toBe(true);
    expect(isChatPanelMessage({ type: 'pickAttachments' })).toBe(true);
    expect(isChatPanelMessage({ type: 'attachOpenFiles' })).toBe(true);
    expect(isChatPanelMessage({ type: 'clearAttachments' })).toBe(true);
    expect(isChatPanelMessage({ type: 'selectSession', payload: 'chat-1' })).toBe(true);
    expect(isChatPanelMessage({ type: 'deleteSession', payload: 'chat-1' })).toBe(true);
    expect(isChatPanelMessage({ type: 'openProjectRun', payload: 'run-1' })).toBe(true);
    expect(isChatPanelMessage({ type: 'openProjectRunCenter', payload: 'run-1' })).toBe(true);
    expect(isChatPanelMessage({ type: 'insertCodeAtCursor', payload: { code: 'const a = 1;' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'queryFileMentions', payload: { query: 'chatPan' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'queryFileMentions', payload: { query: '' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'queryFileMentions', payload: { query: 'x'.repeat(201) } })).toBe(false);
    expect(isChatPanelMessage({ type: 'attachEditorSelection' })).toBe(true);
    expect(isChatPanelMessage({ type: 'attachProblems' })).toBe(true);
    expect(isChatPanelMessage({ type: 'applyCodeToFile', payload: { code: 'const a = 1;' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'createFileFromCode', payload: { code: 'x', language: 'ts' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'createFileFromCode', payload: { code: 'x' } })).toBe(true);
    // An empty block is nothing to act on, and the cap bounds what a crafted
    // message can hand the host in one go.
    expect(isChatPanelMessage({ type: 'insertCodeAtCursor', payload: { code: '' } })).toBe(false);
    expect(isChatPanelMessage({ type: 'insertCodeAtCursor', payload: { code: 'x'.repeat(200_001) } })).toBe(false);
    expect(isChatPanelMessage({ type: 'createFileFromCode', payload: { code: 'x', language: 'y'.repeat(41) } })).toBe(false);
    expect(isChatPanelMessage({ type: 'openProjectRunCenter', payload: 42 })).toBe(false);
    expect(isChatPanelMessage({ type: 'openFileReference', payload: 'src/views/chatPanel.ts:12' })).toBe(true);
    // The payload is markdown a model wrote, so its length is not something the
    // panel controls; an empty one names no file.
    expect(isChatPanelMessage({ type: 'openFileReference', payload: '' })).toBe(false);
    expect(isChatPanelMessage({ type: 'openFileReference', payload: 'x'.repeat(501) })).toBe(false);
    expect(isChatPanelMessage({ type: 'openFileReference', payload: 42 })).toBe(false);
    expect(isChatPanelMessage({ type: 'attachOpenFile', payload: 'src/extension.ts' })).toBe(true);
    expect(isChatPanelMessage({ type: 'removeAttachment', payload: 'file:src/extension.ts' })).toBe(true);
    expect(isChatPanelMessage({ type: 'resolveToolApproval', payload: { requestId: 'approval-1', decision: 'allow-once' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'resolveToolApproval', payload: { requestId: 'approval-1', decision: 'deny' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'resolveProjectRunProposal', payload: { entryId: 'msg-1', decision: 'start' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'resolveProjectRunProposal', payload: { entryId: 'msg-1', decision: 'save' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'resolveProjectRunProposal', payload: { entryId: 'msg-1', decision: 'cancel' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'raiseIterationLimitTemporary', payload: { entryId: 'msg-1', value: 15 } })).toBe(true);
    expect(isChatPanelMessage({ type: 'raiseIterationLimitPermanent', payload: { entryId: 'msg-1', value: 15 } })).toBe(true);
    expect(isChatPanelMessage({ type: 'raiseToolCallsPerTurnLimitTemporary', payload: { entryId: 'msg-1', value: 12 } })).toBe(true);
    expect(isChatPanelMessage({ type: 'voteAssistantMessage', payload: { entryId: 'msg-1', vote: 'up' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'voteAssistantMessage', payload: { entryId: 'msg-1', vote: 'down' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'voteAssistantMessage', payload: { entryId: 'msg-1', vote: 'clear' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'addDroppedItems', payload: ['src/extension.ts', 'https://example.com'] })).toBe(true);
    expect(isChatPanelMessage({
      type: 'ingestPromptMedia',
      payload: {
        items: [
          { transport: 'workspace-path', value: 'src/extension.ts' },
          { transport: 'url', value: 'https://example.com' },
          { transport: 'inline-file', name: 'snippet.png', mimeType: 'image/png', dataBase64: 'abc123' },
        ],
      },
    })).toBe(true);
      expect(isChatPanelMessage({ type: 'stopPrompt' })).toBe(true);
  });

  it('rejects invalid chat panel messages', () => {
    expect(isChatPanelMessage(null)).toBe(false);
    expect(isChatPanelMessage({ type: 'submitPrompt', payload: 123 })).toBe(false);
    expect(isChatPanelMessage({ type: 'submitPrompt', payload: { prompt: 'Explain', mode: 'launch' } })).toBe(false);
    expect(isChatPanelMessage({ type: 'deleteConversation' })).toBe(false);
    expect(isChatPanelMessage({ type: 'resolveToolApproval', payload: { requestId: 'approval-1', decision: 'maybe' } })).toBe(false);
    expect(isChatPanelMessage({ type: 'resolveProjectRunProposal', payload: { entryId: 'msg-1', decision: 'delete' } })).toBe(false);
    expect(isChatPanelMessage({ type: 'raiseIterationLimitPermanent', payload: { entryId: 'msg-1', value: Number.NaN } })).toBe(false);
    expect(isChatPanelMessage({ type: 'raiseIterationLimitTemporary', payload: { entryId: 'msg-1', value: 51 } })).toBe(false);
    expect(isChatPanelMessage({ type: 'raiseToolCallsPerTurnLimitPermanent', payload: { entryId: 'msg-1', value: 31 } })).toBe(false);
    expect(isChatPanelMessage({ type: 'archiveSession', payload: 42 })).toBe(false);
    expect(isChatPanelMessage({ type: 'selectSession', payload: 42 })).toBe(false);
    expect(isChatPanelMessage({ type: 'openProjectRunCenter' })).toBe(false);
    expect(isChatPanelMessage({ type: 'voteAssistantMessage', payload: { entryId: 'msg-1', vote: 'sideways' } })).toBe(false);
    expect(isChatPanelMessage({ type: 'addDroppedItems', payload: ['ok', 42] })).toBe(false);
    expect(isChatPanelMessage({ type: 'ingestPromptMedia', payload: { items: [{ transport: 'inline-file', name: 'bad.bin', dataBase64: '' }] } })).toBe(false);
    expect(isChatPanelMessage({ type: 'ingestPromptMedia', payload: { items: [{ transport: 'workspace-path', value: 42 }] } })).toBe(false);
  });
});

describe('isVisionPanelMessage', () => {
  it('accepts valid vision panel messages', () => {
    expect(isVisionPanelMessage({ type: 'attachImages' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'clearImages' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'submitPrompt', payload: 'Inspect these screenshots' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'openFileReference', payload: 'src/extension.ts#L10' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'copyResponse' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'saveResponse' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'openChatView' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'openSpecialistIntegrations' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'openSettingsModels' })).toBe(true);
  });

  it('rejects invalid vision panel messages', () => {
    expect(isVisionPanelMessage(null)).toBe(false);
    expect(isVisionPanelMessage({})).toBe(false);
    expect(isVisionPanelMessage({ type: 'submitPrompt', payload: 42 })).toBe(false);
    expect(isVisionPanelMessage({ type: 'deleteImages' })).toBe(false);
  });
});

describe('parseWorkspaceFileReference', () => {
  it('parses relative file references with line and column information', () => {
    const parsed = parseWorkspaceFileReference('src/extension.ts#L10C3', '/workspace');
    expect(parsed?.uri.fsPath.replace(/\\/g, '/').endsWith('/workspace/src/extension.ts')).toBe(true);
    expect(parsed?.line).toBe(9);
    expect(parsed?.column).toBe(2);
  });

  it('parses colon-based line references', () => {
    const parsed = parseWorkspaceFileReference('src/extension.ts:12:4', '/workspace');
    expect(parsed?.line).toBe(11);
    expect(parsed?.column).toBe(3);
  });

  it('rejects references outside the workspace root', () => {
    expect(parseWorkspaceFileReference('../secrets.txt', '/workspace')).toBeUndefined();
  });
});

describe('isProjectRunCenterMessage', () => {
  it('accepts valid project run center messages', () => {
    expect(isProjectRunCenterMessage({ type: 'previewGoal', payload: 'Build the onboarding flow' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'updatePlanDraft', payload: '{"subTasks":[]}' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'executePreview' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'refreshRuns' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'discussDraft', payload: { goal: 'Scope this', planDraft: '{"subTasks":[]}' } })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'deleteRun', payload: 'run-1' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'openIdeation' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'openRunReport', payload: 'project_memory/operations/run.json' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'openSourceControl' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'rollbackLastCheckpoint' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'selectRun', payload: 'run-1' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'approveNextBatch' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'pauseRun' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'resumeRun' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'retryFailedSubtasks' })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'setRequireBatchApproval', payload: true })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'setAutonomousMode', payload: true })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'setMirrorProgressToChat', payload: false })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'setInjectOutputIntoFollowUp', payload: true })).toBe(true);
    expect(isProjectRunCenterMessage({ type: 'openRunChat', payload: 'run-1' })).toBe(true);
  });

  it('rejects invalid project run center messages', () => {
    expect(isProjectRunCenterMessage(null)).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'previewGoal', payload: 42 })).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'discussDraft', payload: { goal: 'x', planDraft: 42 } })).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'setRequireBatchApproval', payload: 'yes' })).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'setAutonomousMode', payload: 'yes' })).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'openRunChat', payload: 9 })).toBe(false);
  });
});

describe('isProjectIdeationMessage', () => {
  it('accepts valid ideation panel messages', () => {
    expect(isProjectIdeationMessage({ type: 'ready' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'refresh' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'openIdeationDashboard' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'openCommand', payload: 'atlasmind.openProjectDashboard' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'openFile', payload: 'project_memory/ideas/atlas-ideation-board.md' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'createIdeationWorkspace' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'selectIdeationWorkspace', payload: { workspaceId: 'research-track' } })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'deleteIdeationWorkspace', payload: { workspaceId: 'research-track' } })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'clearPromptAttachments' })).toBe(true);
    expect(isProjectIdeationMessage({
      type: 'runIdeationLoop',
      payload: { prompt: 'Pressure-test this concept', speakResponse: false },
    })).toBe(true);
    expect(isProjectIdeationMessage({
      type: 'ingestPromptMedia',
      payload: {
        items: [
          { transport: 'workspace-path', value: 'docs/architecture.md' },
          { transport: 'url', value: 'https://example.com/reference' },
        ],
      },
    })).toBe(true);
    expect(isProjectIdeationMessage({
      type: 'ingestCanvasMedia',
      payload: {
        cardId: 'card-1',
        items: [{ transport: 'inline-image', name: 'mock.png', mimeType: 'image/png', dataBase64: 'Zm9v' }],
      },
    })).toBe(true);
    expect(isProjectIdeationMessage({
      type: 'saveIdeationBoard',
      payload: {
        cards: [{
          id: 'card-1',
          title: 'Idea',
          body: 'Notes',
          kind: 'idea',
          author: 'user',
          x: 0,
          y: 0,
          color: 'sun',
          imageSources: [],
          media: [],
          tags: ['hypothesis'],
          confidence: 55,
          evidenceStrength: 35,
          riskScore: 25,
          costToValidate: 20,
          syncTargets: ['domain'],
          revision: 1,
          createdAt: '2026-04-06T10:00:00.000Z',
          updatedAt: '2026-04-06T10:00:00.000Z',
        }],
        connections: [{
          id: 'link-1',
          fromCardId: 'card-1',
          toCardId: 'card-1',
          label: 'supports',
          style: 'dotted',
          direction: 'none',
          relation: 'supports',
        }],
        constraints: {
          budget: '£5k',
          timeline: '4 weeks',
          teamSize: '2',
          riskTolerance: 'medium',
          technicalStack: 'TypeScript',
        },
        focusCardId: 'card-1',
        nextPrompts: ['What risk matters most?'],
      },
    })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'promoteCardToProjectRun', payload: { cardId: 'card-1' } })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'extractEvidenceFromCard', payload: { cardId: 'card-1' } })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'generateValidationBrief', payload: { cardId: 'card-1' } })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'syncCardToSsot', payload: { cardId: 'card-1' } })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'archiveCard', payload: { cardId: 'card-1', archive: true } })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'archiveCard', payload: { cardId: 'card-1', archive: false } })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'runDeepBoardAnalysis' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'generateReviewCheckpoint', payload: { cardId: 'card-1' } })).toBe(true);
  });

  it('rejects invalid ideation panel messages', () => {
    expect(isProjectIdeationMessage(null)).toBe(false);
    expect(isProjectIdeationMessage({ type: 'openCommand', payload: '' })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'selectIdeationWorkspace', payload: { workspaceId: '' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'deleteIdeationWorkspace', payload: { workspaceId: '' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'runIdeationLoop', payload: { prompt: '' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'ingestPromptMedia', payload: { items: ['bad'] } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'ingestCanvasMedia', payload: { items: [{ transport: 'inline-image', name: 'x', mimeType: 'image/png' }] } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'saveIdeationBoard', payload: { cards: 'nope', connections: [] } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'promoteCardToProjectRun', payload: { cardId: '' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'extractEvidenceFromCard', payload: { cardId: '' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'generateValidationBrief', payload: { cardId: '' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'syncCardToSsot', payload: { cardId: '' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'archiveCard', payload: { cardId: 'card-1', archive: 'yes' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'archiveCard', payload: { cardId: '', archive: true } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'generateReviewCheckpoint', payload: { cardId: '' } })).toBe(false);
  });
});

describe('parseEditableProjectPlan', () => {
  it('parses an editable run-center plan draft', () => {
    const plan = parseEditableProjectPlan(
      'Build onboarding',
      'run-1',
      JSON.stringify({
        subTasks: [
          {
            id: 'plan',
            title: 'Plan work',
            description: 'Outline the implementation approach.',
            role: 'architect',
            skills: ['file-read'],
            dependsOn: [],
          },
          {
            id: 'ship',
            title: 'Ship feature',
            description: 'Implement the feature.',
            role: 'backend-engineer',
            skills: ['file-read', 'file-write'],
            dependsOn: ['plan'],
          },
        ],
      }),
    );

    expect(plan?.id).toBe('run-1');
    expect(plan?.goal).toBe('Build onboarding');
    expect(plan?.subTasks.map(task => task.id)).toEqual(['plan', 'ship']);
  });

  it('rejects invalid plan drafts', () => {
    expect(parseEditableProjectPlan('Goal', 'run-1', '{"subTasks":"bad"}')).toBeUndefined();
  });
});

describe('isProjectDashboardMessage — risk oversight', () => {
  it('accepts a run for a known domain or for all', () => {
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis', payload: { domain: 'ethics' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis', payload: { domain: 'legal' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis', payload: { domain: 'commercial' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis', payload: { domain: 'all' } })).toBe(true);
  });

  it('rejects a run for an unknown domain', () => {
    // A risk run costs a real model call, so an unrecognised domain is refused
    // outright rather than coerced to a default.
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis', payload: { domain: 'security' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis', payload: { domain: '' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis', payload: {} })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis', payload: null })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'runRiskAnalysis' })).toBe(false);
  });

  it('accepts a status change to any recorded lifecycle state', () => {
    for (const status of ['open', 'accepted', 'mitigated', 'closed', 'dismissed']) {
      expect(isProjectDashboardMessage({
        type: 'setRiskFindingStatus',
        payload: { findingId: 'legal-gpl', status },
      }), status).toBe(true);
    }
    expect(isProjectDashboardMessage({
      type: 'setRiskFindingStatus',
      payload: { findingId: 'legal-gpl', status: 'accepted', note: 'Owned by the board' },
    })).toBe(true);
  });

  it('rejects a status change with an unknown status, blank id, or bad note', () => {
    expect(isProjectDashboardMessage({ type: 'setRiskFindingStatus', payload: { findingId: 'x', status: 'deleted' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'setRiskFindingStatus', payload: { findingId: '  ', status: 'open' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'setRiskFindingStatus', payload: { status: 'open' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'setRiskFindingStatus', payload: { findingId: 'x', status: 'open', note: 42 } })).toBe(false);
  });

  it('accepts a risk filter string', () => {
    expect(isProjectDashboardMessage({ type: 'setRiskFilter', payload: 'high:high' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'setRiskFilter', payload: '' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'setRiskFilter', payload: 7 })).toBe(false);
  });

  it('preserves sourcePage for every page in the nav, including privacy and risk', () => {
    // Regression: `privacy` shipped in the webview nav but was missing from the
    // page-id allowlist, so "Ask Atlas" raised from that page silently lost its
    // origin. Asserted on the normaliser because isProjectDashboardMessage returns
    // true either way — it cannot observe whether sourcePage survived.
    for (const sourcePage of ['risk', 'privacy', 'overview', 'score', 'branches', 'repo', 'runtime', 'testing', 'ssot', 'roadmap', 'gapAnalysis', 'security', 'delivery', 'director', 'documents', 'ideation']) {
      expect(
        normalizeDashboardPromptRequest({ prompt: 'Look at this', sourcePage }),
        sourcePage,
      ).toEqual({ prompt: 'Look at this', sourcePage });
    }
  });

  it('drops an unknown sourcePage instead of passing it through', () => {
    expect(normalizeDashboardPromptRequest({ prompt: 'Look at this', sourcePage: 'not-a-page' }))
      .toEqual({ prompt: 'Look at this' });
  });
});

describe('isProjectDashboardMessage', () => {
  it('keeps local CI terminal command text host-owned', () => {
    expect(isProjectDashboardMessage({ type: 'copyLocalCiQueueCommand' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'sendLocalCiQueueCommandToTerminal' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'copyLocalCiQueueCommand', payload: 'gh run evil' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'sendLocalCiQueueCommandToTerminal', payload: 'gh run evil' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'copyLocalCiCancelCommand', payload: 31979448869 })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'sendLocalCiCancelCommandToTerminal', payload: 31979448869 })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'copyLocalCiCancelCommand', payload: '31979448869' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'sendLocalCiCancelCommandToTerminal', payload: -1 })).toBe(false);
  });

  /**
   * The trusted workflow decides which GitHub jobs may run on this machine, so
   * neither its review nor its creation may accept anything from the webview.
   * Both carry no payload at all: the host re-derives the repository, branch,
   * label and filename, which is what stops a crafted message naming a
   * different file or a different repository condition.
   */
  it('keeps trusted-workflow review and creation entirely host-derived', () => {
    expect(isProjectDashboardMessage({ type: 'assessTrustedCiWorkflow' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'createTrustedCiStarter' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'assessTrustedCiWorkflow', payload: '../../etc/passwd' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'createTrustedCiStarter', payload: { repoSlug: 'attacker/repo' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'createTrustedCiStarter', payload: 'evil.yml' })).toBe(false);
  });

  /**
   * The install runs commands. The webview may ask for one, but every command
   * is a constant in the host, so a payload could only ever be an attempt to
   * supply one — refused in the shape of the message rather than downstream.
   */
  it('accepts no payload on the GitHub CLI install request', () => {
    expect(isProjectDashboardMessage({ type: 'installGitHubCli' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'installGitHubCli', payload: 'curl evil.sh | sh' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'installGitHubCli', payload: { command: 'rm' } })).toBe(false);
  });

  it('accepts valid dashboard messages', () => {
    expect(isProjectDashboardMessage({ type: 'ready' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'refresh' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'fetchBranches' })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'saveBranchPreferences',
      payload: {
        branchView: 'ready',
        branchSort: 'activity',
        branchSortDirection: 'desc',
        branchGroup: 'readiness',
        branchScmChips: true,
      },
    })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'activateBranch', payload: 'remote:refs/remotes/origin/feat/example' })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'runBranchWorkflow',
      payload: { branchId: 'local:refs/heads/feat/example', action: 'push' },
    })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'discussBranch', payload: 'remote:refs/remotes/origin/feat/example' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'inspectBranch', payload: 'remote:refs/remotes/origin/feat/example' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openBranchChangeStory', payload: 'remote:refs/remotes/origin/feat/example' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'reviewBranchCleanup', payload: 'local:refs/heads/feat/example' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openBranchPullRequest', payload: 'local:refs/heads/feat/example' })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'compareBranches',
      payload: {
        leftId: 'local:refs/heads/feat/one',
        rightId: 'remote:refs/remotes/origin/feat/two',
      },
    })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openCommand', payload: 'atlasmind.openChatView' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openPrompt', payload: 'Start by tightening the project vision.' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openPrompt', payload: { prompt: 'What is the sharpest missing risk or blocker that still needs a card?', sourcePage: 'ideation' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openFile', payload: 'SECURITY.md' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openRun', payload: 'run-1' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openSession', payload: 'chat-1' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'attachIdeationImages' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'clearIdeationImages' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'addIdeationEvidence', payload: 'gap-analysis:gap-1' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'runGapAnalysis' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'fixActivatedTesting' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'createCiStarter' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'reviewCiWorkflow', payload: 'ci.yml' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openTestingFixChat' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'discussTestingPolicy', payload: { id: 'unit' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'discussDashboardError' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'draftIssueFromPullRequest', payload: { number: 152 } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'addressGap', payload: 'gap-1' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'resolveGapItem', payload: 'gap-1' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'resolveGapGroup', payload: 'P1' })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'runIdeationLoop',
      payload: { prompt: 'Pressure-test this concept', speakResponse: false },
    })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'saveIdeationBoard',
      payload: {
        cards: [{
          id: 'card-1',
          title: 'Idea',
          body: 'Notes',
          kind: 'concept',
          author: 'user',
          x: 0,
          y: 0,
          color: 'sun',
          imageSources: [],
          createdAt: '2026-04-06T10:00:00.000Z',
          updatedAt: '2026-04-06T10:00:00.000Z',
        }],
        connections: [],
        focusCardId: 'card-1',
        nextPrompts: ['What risk matters most?'],
      },
    })).toBe(true);
    // Project Director messages.
    expect(isProjectDashboardMessage({ type: 'seedDirectorFromRepo' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'copyContact', payload: 'contact-1' })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'saveDirectorConfig',
      payload: { version: 1, project: { name: 'P' }, contacts: [], stakeholders: [], teamMembers: [], responsibilities: [], assignments: [], followUps: [], settings: {} },
    })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openContactDeepLink', payload: { contactId: 'c1', linkId: 'l1' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'assignRunOwner', payload: { runId: 'run-1', contactId: 'c1' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'assignRunOwner', payload: { runId: 'run-1', contactId: '' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'assignDashboardWorkOwner', payload: { targetId: 'work-1', contactId: 'c1' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'assignDashboardWorkOwner', payload: { targetId: 'work-1', contactId: '' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openPrompt', payload: { prompt: 'Who owns releases?', sourcePage: 'director' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'directorSendComms', payload: { intent: 'email', contactId: 'c1', subject: 'Hi', body: 'Hello' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'directorSendComms', payload: { intent: 'schedule', contactId: 'c1' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'directorSendComms', payload: { intent: 'message', contactId: 'c1', body: 'ping' } })).toBe(true);
  });

  it('rejects invalid dashboard messages', () => {
    expect(isProjectDashboardMessage(null)).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openCommand', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openPrompt', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openPrompt', payload: { prompt: '', sourcePage: 'ideation' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openFile', payload: 42 })).toBe(false);
    expect(isProjectDashboardMessage({
      type: 'saveBranchPreferences',
      payload: {
        branchView: 'ready',
        branchSort: 'recent-ish',
        branchSortDirection: 'desc',
        branchGroup: 'readiness',
        branchScmChips: true,
      },
    })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'activateBranch', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'activateBranch', payload: 42 })).toBe(false);
    expect(isProjectDashboardMessage({
      type: 'runBranchWorkflow',
      payload: { branchId: 'local:refs/heads/feat/example', action: 'force-push' },
    })).toBe(false);
    expect(isProjectDashboardMessage({
      type: 'runBranchWorkflow',
      payload: { branchId: '', action: 'push' },
    })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'discussBranch', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'discussBranch', payload: 42 })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'inspectBranch', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openBranchChangeStory', payload: 42 })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'reviewBranchCleanup', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openBranchPullRequest', payload: 42 })).toBe(false);
    expect(isProjectDashboardMessage({
      type: 'compareBranches',
      payload: { leftId: 'same', rightId: 'same' },
    })).toBe(false);
    expect(isProjectDashboardMessage({
      type: 'compareBranches',
      payload: { leftId: 'left' },
    })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'runIdeationLoop', payload: { prompt: '' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'fixActivatedTestin' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'reviewCiWorkflow', payload: '../ci.yml' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'reviewCiWorkflow', payload: 'ci.yml; rm -rf' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'createCiStarter', payload: { content: 'run: hostile' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'discussTestingPolicy', payload: { id: 'made-up' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'discussTestingPolicy', payload: { id: 42 } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'draftIssueFromPullRequest', payload: { number: 0 } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'draftIssueFromPullRequest', payload: { number: '152' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'saveIdeationBoard', payload: { cards: 'nope', connections: [] } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'addIdeationEvidence', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'addIdeationEvidence', payload: 'not-a-source:record-1' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'addIdeationEvidence', payload: 42 })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'addressGap', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'resolveGapItem', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'resolveGapGroup', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'deleteDashboard' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'copyContact', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'saveDirectorConfig', payload: { version: 1, contacts: [] } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openContactDeepLink', payload: { contactId: 'c1' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'assignRunOwner', payload: { runId: '', contactId: 'c1' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'assignDashboardWorkOwner', payload: { targetId: '', contactId: 'c1' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'assignDashboardWorkOwner', payload: { targetId: 'x'.repeat(81), contactId: 'c1' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'assignDashboardWorkOwner', payload: { targetId: 'work-1', contactId: 42 } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'directorSendComms', payload: { intent: 'sms', contactId: 'c1' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'directorSendComms', payload: { intent: 'email', contactId: '' } })).toBe(false);
  });
});

describe('isToolWebhookMessage', () => {
  it('accepts valid setEnabled messages', () => {
    expect(isToolWebhookMessage({ type: 'setEnabled', payload: true })).toBe(true);
    expect(isToolWebhookMessage({ type: 'setEnabled', payload: false })).toBe(true);
  });

  it('accepts valid setUrl messages', () => {
    expect(isToolWebhookMessage({ type: 'setUrl', payload: 'https://example.com' })).toBe(true);
  });

  it('accepts valid setToken messages', () => {
    expect(isToolWebhookMessage({ type: 'setToken', payload: 'abc123' })).toBe(true);
  });

  it('accepts valid setTimeoutMs messages', () => {
    expect(isToolWebhookMessage({ type: 'setTimeoutMs', payload: 5000 })).toBe(true);
  });

  it('accepts valid setEvents messages', () => {
    expect(isToolWebhookMessage({ type: 'setEvents', payload: ['tool.started', 'tool.completed'] })).toBe(true);
  });

  it('accepts payload-less messages', () => {
    expect(isToolWebhookMessage({ type: 'clearToken' })).toBe(true);
    expect(isToolWebhookMessage({ type: 'sendTest' })).toBe(true);
    expect(isToolWebhookMessage({ type: 'clearHistory' })).toBe(true);
    expect(isToolWebhookMessage({ type: 'refresh' })).toBe(true);
    expect(isToolWebhookMessage({ type: 'openSettingsSafety' })).toBe(true);
  });

  it('rejects null and primitives', () => {
    expect(isToolWebhookMessage(null)).toBe(false);
    expect(isToolWebhookMessage(42)).toBe(false);
    expect(isToolWebhookMessage('hello')).toBe(false);
  });

  it('rejects objects without type', () => {
    expect(isToolWebhookMessage({ payload: true })).toBe(false);
  });

  it('rejects unknown types', () => {
    expect(isToolWebhookMessage({ type: 'deleteServer' })).toBe(false);
  });

  it('rejects setEnabled with non-boolean payload', () => {
    expect(isToolWebhookMessage({ type: 'setEnabled', payload: 'yes' })).toBe(false);
  });

  it('rejects setUrl with non-string payload', () => {
    expect(isToolWebhookMessage({ type: 'setUrl', payload: 123 })).toBe(false);
  });

  it('rejects setTimeoutMs below 1000', () => {
    expect(isToolWebhookMessage({ type: 'setTimeoutMs', payload: 999 })).toBe(false);
  });

  it('rejects setTimeoutMs with non-finite value', () => {
    expect(isToolWebhookMessage({ type: 'setTimeoutMs', payload: Infinity })).toBe(false);
  });

  it('rejects setEvents with invalid event names', () => {
    expect(isToolWebhookMessage({ type: 'setEvents', payload: ['tool.started', 'invalid'] })).toBe(false);
  });

  it('rejects setEvents with non-array payload', () => {
    expect(isToolWebhookMessage({ type: 'setEvents', payload: 'tool.started' })).toBe(false);
  });
});

describe('validatePanelMessage (MCP)', () => {
  it('validates addServer with stdio transport', () => {
    const msg = validatePanelMessage({
      type: 'addServer',
      payload: { name: 'test', transport: 'stdio', command: 'node', enabled: true },
    });
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('addServer');
  });

  it('validates addServer with http transport', () => {
    const msg = validatePanelMessage({
      type: 'addServer',
      payload: { name: 'test', transport: 'http', url: 'https://example.com', enabled: true },
    });
    expect(msg).not.toBeNull();
  });

  it('validates removeServer', () => {
    const msg = validatePanelMessage({ type: 'removeServer', payload: { id: 'abc' } });
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('removeServer');
  });

  it('validates reconnect', () => {
    const msg = validatePanelMessage({ type: 'reconnect', payload: { id: 'abc' } });
    expect(msg).not.toBeNull();
  });

  it('validates toggleEnabled', () => {
    const msg = validatePanelMessage({ type: 'toggleEnabled', payload: { id: 'abc', enabled: true } });
    expect(msg).not.toBeNull();
  });

  it('validates refresh', () => {
    const msg = validatePanelMessage({ type: 'refresh' });
    expect(msg).not.toBeNull();
  });

  it('validates MCP quick-action navigation messages', () => {
    expect(validatePanelMessage({ type: 'openSettingsSafety' })).toEqual({ type: 'openSettingsSafety' });
    expect(validatePanelMessage({ type: 'openAgentPanel' })).toEqual({ type: 'openAgentPanel' });
    expect(validatePanelMessage({ type: 'discussPanelStatus' })).toEqual({ type: 'discussPanelStatus' });
    expect(validatePanelMessage({ type: 'discussServerError', payload: { id: 'server-123' } }))
      .toEqual({ type: 'discussServerError', payload: { id: 'server-123' } });
  });

  it('rejects null', () => {
    expect(validatePanelMessage(null)).toBeNull();
  });

  it('rejects addServer without name', () => {
    expect(validatePanelMessage({
      type: 'addServer',
      payload: { name: '', transport: 'stdio', command: 'node', enabled: true },
    })).toBeNull();
  });

  it('rejects addServer with invalid transport', () => {
    expect(validatePanelMessage({
      type: 'addServer',
      payload: { name: 'test', transport: 'ws', command: 'node', enabled: true },
    })).toBeNull();
  });

  it('rejects removeServer without id', () => {
    expect(validatePanelMessage({ type: 'removeServer', payload: { id: '' } })).toBeNull();
    expect(validatePanelMessage({ type: 'discussServerError', payload: { id: '../server' } })).toBeNull();
  });

  it('rejects toggleEnabled without boolean enabled', () => {
    expect(validatePanelMessage({ type: 'toggleEnabled', payload: { id: 'abc', enabled: 'yes' } })).toBeNull();
  });

  it('rejects unknown types', () => {
    expect(validatePanelMessage({ type: 'destroyServer' })).toBeNull();
  });
});

describe('isAgentPanelMessage', () => {
  it('accepts valid agent panel message types', () => {
    expect(isAgentPanelMessage({ type: 'select', payload: { id: 'reviewer' } })).toBe(true);
    expect(isAgentPanelMessage({
      type: 'save',
      payload: {
        id: 'reviewer',
        name: 'Reviewer',
        role: 'code reviewer',
        description: 'Reviews changes.',
        systemPrompt: 'Review carefully.',
        allowedModels: '',
        costLimitUsd: '',
        skills: '',
        autoUpdateExcluded: false,
        skillsAutoManaged: true,
        testingModelOverridesJson: '{}',
        completionRubric: 'Report evidence.',
        incompletePatterns: 'TODO',
      },
    })).toBe(true);
    expect(isAgentPanelMessage({ type: 'delete', payload: { id: 'reviewer' } })).toBe(true);
    expect(isAgentPanelMessage({ type: 'toggleEnabled', payload: { id: 'reviewer', enabled: false } })).toBe(true);
    expect(isAgentPanelMessage({ type: 'setAutoUpdateCadence', payload: { cadence: 'weekly' } })).toBe(true);
    expect(isAgentPanelMessage({ type: 'newAgent' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'cancel' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'refresh' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'openModelProviders' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'openModelsView' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'openSettingsModels' })).toBe(true);
  });

  it('rejects malformed agent action payloads', () => {
    expect(isAgentPanelMessage({ type: 'select' })).toBe(false);
    expect(isAgentPanelMessage({ type: 'save', payload: {} })).toBe(false);
    expect(isAgentPanelMessage({ type: 'delete', payload: { id: '' } })).toBe(false);
    expect(isAgentPanelMessage({ type: 'toggleEnabled', payload: { id: 'reviewer', enabled: 'yes' } })).toBe(false);
    expect(isAgentPanelMessage({ type: 'setAutoUpdateCadence', payload: { cadence: 'hourly' } })).toBe(false);
  });

  it('rejects null and primitives', () => {
    expect(isAgentPanelMessage(null)).toBe(false);
    expect(isAgentPanelMessage(42)).toBe(false);
    expect(isAgentPanelMessage('select')).toBe(false);
  });

  it('rejects objects without type', () => {
    expect(isAgentPanelMessage({ payload: 'test' })).toBe(false);
  });

  it('rejects unknown types', () => {
    expect(isAgentPanelMessage({ type: 'deleteAll' })).toBe(false);
  });
});

describe('chooseDeployedVersionRef', () => {
  const refSet = (...refs: string[]) => (ref: string) => refs.includes(ref);

  it('prefers the remote-tracking ref so a stale local release branch is not read', () => {
    // Both exist: the deployed version lives on the remote, so origin/master wins.
    expect(chooseDeployedVersionRef('master', refSet('master', 'origin/master'))).toBe('origin/master');
  });

  it('falls back to the local ref when there is no remote (offline/local-only repo)', () => {
    expect(chooseDeployedVersionRef('master', refSet('master'))).toBe('master');
  });

  it('uses the remote ref when only it exists (local branch never checked out)', () => {
    expect(chooseDeployedVersionRef('master', refSet('origin/master'))).toBe('origin/master');
  });

  it('returns undefined when neither the local nor remote ref exists', () => {
    expect(chooseDeployedVersionRef('master', refSet('develop', 'origin/develop'))).toBeUndefined();
    expect(chooseDeployedVersionRef('', refSet('master'))).toBeUndefined();
  });

  it('handles an explicit origin/ ref, falling back to its local short name', () => {
    expect(chooseDeployedVersionRef('origin/master', refSet('origin/master'))).toBe('origin/master');
    expect(chooseDeployedVersionRef('origin/master', refSet('master'))).toBe('master');
  });
});

describe('file references in a reply', () => {
  it('separates the line anchor from the path in every spelling a model uses', () => {
    // `src/a.ts:12` names no file on any platform, so the anchor has to come off
    // before the path is resolved — otherwise every linked line number is a
    // "file not found" for a file that is right there.
    expect(parseFileReference('src/a.ts')).toEqual({ path: 'src/a.ts' });
    expect(parseFileReference('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(parseFileReference('src/a.ts:12:5')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(parseFileReference('src/a.ts#L12')).toEqual({ path: 'src/a.ts', line: 12 });
    // A range is a place to go, not a selection to make.
    expect(parseFileReference('src/a.ts#L12-20')).toEqual({ path: 'src/a.ts', line: 12 });
  });

  it('leaves a Windows drive letter attached to its path', () => {
    expect(parseFileReference('C:\repo\src\a.ts')).toEqual({ path: 'C:\repo\src\a.ts' });
  });

  it('yields nothing for a reference that names no file', () => {
    // A bare anchor would otherwise resolve to the workspace root and open a
    // folder for a link that named no file at all.
    expect(parseFileReference('#L12')).toBeUndefined();
    expect(parseFileReference('   ')).toBeUndefined();
  });
});
