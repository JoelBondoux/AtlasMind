import { describe, it, expect, vi } from 'vitest';
import { SkillScannerPanel } from '../../src/views/skillScannerPanel';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn().mockReturnValue({
      webview: {
        onDidReceiveMessage: vi.fn(),
        asWebviewUri: vi.fn(),
      },
      onDidDispose: vi.fn(),
    }),
  },
  ViewColumn: {
    One: 1,
  },
  Uri: {
    joinPath: vi.fn(),
  },
}));

describe('SkillScannerPanel', () => {
  it('should create a new panel', () => {
    const mockContext = {
      extensionUri: 'file:///mock/extension/path',
      subscriptions: {
        push: vi.fn(),
      },
    };
    const mockRulesManager = {
      getEffectiveRules: vi.fn().mockReturnValue([]),
    };
    SkillScannerPanel.createOrShow(mockContext as any, mockRulesManager as any, vi.fn());
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
  });
});
