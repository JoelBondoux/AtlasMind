import { describe, expect, it } from 'vitest';
import { isSettingsMessage } from '../../src/views/settingsPanel.ts';
import { isModelProviderMessage } from '../../src/views/modelProviderPanel.ts';
import { isProjectRunCenterMessage, parseEditableProjectPlan } from '../../src/views/projectRunCenterPanel.ts';
import { isVisionPanelMessage, parseWorkspaceFileReference } from '../../src/views/visionPanel.ts';
import { isToolWebhookMessage } from '../../src/views/toolWebhookPanel.ts';
import { validatePanelMessage } from '../../src/views/mcpPanel.ts';
import { isAgentPanelMessage } from '../../src/views/agentManagerPanel.ts';
import { isSpecialistIntegrationsMessage } from '../../src/views/specialistIntegrationsPanel.ts';
import { isChatPanelMessage } from '../../src/views/chatPanel.ts';
import { isCostDashboardMessage } from '../../src/views/costDashboardPanel.ts';
import { isProjectDashboardMessage } from '../../src/views/projectDashboardPanel.ts';
import { isProjectIdeationMessage } from '../../src/views/projectIdeationPanel.ts';

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
  });

  it('accepts valid tool approval settings messages', () => {
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'always-ask' })).toBe(true);
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'ask-on-write' })).toBe(true);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: false })).toBe(true);
    expect(isSettingsMessage({ type: 'setAutoVerifyAfterWrite', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setAutoVerifyScripts', payload: 'test, lint' })).toBe(true);
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
    expect(isSettingsMessage({ type: 'openModelProviders' })).toBe(true);
    expect(isSettingsMessage({ type: 'openSpecialistIntegrations' })).toBe(true);
    expect(isSettingsMessage({ type: 'openProjectRunCenter' })).toBe(true);
    expect(isSettingsMessage({ type: 'openVoicePanel' })).toBe(true);
    expect(isSettingsMessage({ type: 'openVisionPanel' })).toBe(true);
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
  });

  it('rejects invalid tool approval payloads', () => {
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'let-it-rip' })).toBe(false);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: 'yes' })).toBe(false);
    expect(isSettingsMessage({ type: 'setAutoVerifyAfterWrite', payload: 'true' })).toBe(false);
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
    expect(isCostDashboardMessage({ type: 'setTimescaleDays', value: 30 })).toBe(true);
    expect(isCostDashboardMessage({ type: 'setExcludeSubscriptionIncluded', value: true })).toBe(true);
    expect(isCostDashboardMessage({ type: 'openChatMessage', sessionId: 'chat-1', messageId: 'msg-1' })).toBe(true);
  });

  it('rejects malformed dashboard messages', () => {
    expect(isCostDashboardMessage({ type: 'setTimescaleDays', value: 0 })).toBe(false);
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
    expect(isChatPanelMessage({ type: 'attachOpenFile', payload: 'src/extension.ts' })).toBe(true);
    expect(isChatPanelMessage({ type: 'removeAttachment', payload: 'file:src/extension.ts' })).toBe(true);
    expect(isChatPanelMessage({ type: 'resolveToolApproval', payload: { requestId: 'approval-1', decision: 'allow-once' } })).toBe(true);
    expect(isChatPanelMessage({ type: 'resolveToolApproval', payload: { requestId: 'approval-1', decision: 'deny' } })).toBe(true);
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
  });

  it('rejects invalid chat panel messages', () => {
    expect(isChatPanelMessage(null)).toBe(false);
    expect(isChatPanelMessage({ type: 'submitPrompt', payload: 123 })).toBe(false);
    expect(isChatPanelMessage({ type: 'submitPrompt', payload: { prompt: 'Explain', mode: 'launch' } })).toBe(false);
    expect(isChatPanelMessage({ type: 'deleteConversation' })).toBe(false);
    expect(isChatPanelMessage({ type: 'resolveToolApproval', payload: { requestId: 'approval-1', decision: 'maybe' } })).toBe(false);
    expect(isChatPanelMessage({ type: 'archiveSession', payload: 42 })).toBe(false);
    expect(isChatPanelMessage({ type: 'selectSession', payload: 42 })).toBe(false);
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
  });

  it('rejects invalid project run center messages', () => {
    expect(isProjectRunCenterMessage(null)).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'previewGoal', payload: 42 })).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'discussDraft', payload: { goal: 'x', planDraft: 42 } })).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'setRequireBatchApproval', payload: 'yes' })).toBe(false);
  });
});

describe('isProjectIdeationMessage', () => {
  it('accepts valid ideation panel messages', () => {
    expect(isProjectIdeationMessage({ type: 'ready' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'refresh' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'openCommand', payload: 'atlasmind.openProjectDashboard' })).toBe(true);
    expect(isProjectIdeationMessage({ type: 'openFile', payload: 'project_memory/ideas/atlas-ideation-board.md' })).toBe(true);
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
          kind: 'concept',
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
  });

  it('rejects invalid ideation panel messages', () => {
    expect(isProjectIdeationMessage(null)).toBe(false);
    expect(isProjectIdeationMessage({ type: 'openCommand', payload: '' })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'runIdeationLoop', payload: { prompt: '' } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'ingestPromptMedia', payload: { items: ['bad'] } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'ingestCanvasMedia', payload: { items: [{ transport: 'inline-image', name: 'x', mimeType: 'image/png' }] } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'saveIdeationBoard', payload: { cards: 'nope', connections: [] } })).toBe(false);
    expect(isProjectIdeationMessage({ type: 'promoteCardToProjectRun', payload: { cardId: '' } })).toBe(false);
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

describe('isProjectDashboardMessage', () => {
  it('accepts valid dashboard messages', () => {
    expect(isProjectDashboardMessage({ type: 'ready' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'refresh' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openCommand', payload: 'atlasmind.openChatView' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openPrompt', payload: 'Start by tightening the project vision.' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openFile', payload: 'SECURITY.md' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openRun', payload: 'run-1' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openSession', payload: 'chat-1' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'attachIdeationImages' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'clearIdeationImages' })).toBe(true);
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
  });

  it('rejects invalid dashboard messages', () => {
    expect(isProjectDashboardMessage(null)).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openCommand', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openPrompt', payload: '' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openFile', payload: 42 })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'runIdeationLoop', payload: { prompt: '' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'saveIdeationBoard', payload: { cards: 'nope', connections: [] } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'deleteDashboard' })).toBe(false);
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
    expect(isAgentPanelMessage({ type: 'select' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'save' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'delete' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'toggleEnabled' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'newAgent' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'cancel' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'refresh' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'openModelProviders' })).toBe(true);
    expect(isAgentPanelMessage({ type: 'openSettingsModels' })).toBe(true);
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
