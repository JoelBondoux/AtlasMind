import { describe, expect, it } from 'vitest';
import { isSettingsMessage } from '../../src/views/settingsPanel.ts';
import { isModelProviderMessage } from '../../src/views/modelProviderPanel.ts';
import { isProjectRunCenterMessage, parseEditableProjectPlan } from '../../src/views/projectRunCenterPanel.ts';
import { isVisionPanelMessage, parseWorkspaceFileReference } from '../../src/views/visionPanel.ts';

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

  it('accepts valid tool approval settings messages', () => {
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'always-ask' })).toBe(true);
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'ask-on-write' })).toBe(true);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: false })).toBe(true);
    expect(isSettingsMessage({ type: 'setAutoVerifyAfterWrite', payload: true })).toBe(true);
    expect(isSettingsMessage({ type: 'setAutoVerifyScripts', payload: 'test, lint' })).toBe(true);
  });

  it('accepts valid numeric threshold messages', () => {
    expect(isSettingsMessage({ type: 'setAutoVerifyTimeoutMs', payload: 120000 })).toBe(true);
    expect(isSettingsMessage({ type: 'setChatSessionTurnLimit', payload: 6 })).toBe(true);
    expect(isSettingsMessage({ type: 'setChatSessionContextChars', payload: 2500 })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: 5 })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectEstimatedFilesPerSubtask', payload: 3 })).toBe(true);
    expect(isSettingsMessage({ type: 'setProjectChangedFileReferenceLimit', payload: 10 })).toBe(true);
  });

  it('accepts a valid setProjectRunReportFolder message', () => {
    expect(isSettingsMessage({ type: 'setProjectRunReportFolder', payload: 'project_memory/ops' })).toBe(true);
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

  it('rejects invalid tool approval payloads', () => {
    expect(isSettingsMessage({ type: 'setToolApprovalMode', payload: 'let-it-rip' })).toBe(false);
    expect(isSettingsMessage({ type: 'setAllowTerminalWrite', payload: 'yes' })).toBe(false);
    expect(isSettingsMessage({ type: 'setAutoVerifyAfterWrite', payload: 'true' })).toBe(false);
  });

  it('rejects numeric thresholds below 1', () => {
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: 0 })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: -5 })).toBe(false);
  });

  it('rejects non-finite numeric thresholds', () => {
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: Infinity })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectApprovalFileThreshold', payload: NaN })).toBe(false);
  });

  it('rejects empty report folder', () => {
    expect(isSettingsMessage({ type: 'setProjectRunReportFolder', payload: '' })).toBe(false);
    expect(isSettingsMessage({ type: 'setProjectRunReportFolder', payload: '   ' })).toBe(false);
  });

  it('rejects non-boolean experimentalSkillLearningEnabled', () => {
    expect(isSettingsMessage({ type: 'setExperimentalSkillLearningEnabled', payload: 'yes' })).toBe(false);
    expect(isSettingsMessage({ type: 'setExperimentalSkillLearningEnabled', payload: 1 })).toBe(false);
  });
});

describe('isModelProviderMessage', () => {
  it('accepts a valid saveApiKey message', () => {
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'anthropic' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'openai' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'copilot' })).toBe(true);
    expect(isModelProviderMessage({ type: 'saveApiKey', payload: 'local' })).toBe(true);
  });

  it('accepts a refreshModels message', () => {
    expect(isModelProviderMessage({ type: 'refreshModels' })).toBe(true);
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

describe('isVisionPanelMessage', () => {
  it('accepts valid vision panel messages', () => {
    expect(isVisionPanelMessage({ type: 'attachImages' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'clearImages' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'submitPrompt', payload: 'Inspect these screenshots' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'openFileReference', payload: 'src/extension.ts#L10' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'copyResponse' })).toBe(true);
    expect(isVisionPanelMessage({ type: 'saveResponse' })).toBe(true);
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
    expect(isProjectRunCenterMessage({ type: 'setRequireBatchApproval', payload: 'yes' })).toBe(false);
    expect(isProjectRunCenterMessage({ type: 'deleteRun', payload: 'run-1' })).toBe(false);
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
