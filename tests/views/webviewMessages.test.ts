import { describe, expect, it } from 'vitest';
import { isSettingsMessage } from '../../src/views/settingsPanel.ts';
import { isModelProviderMessage } from '../../src/views/modelProviderPanel.ts';

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

  it('accepts valid numeric threshold messages', () => {
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
