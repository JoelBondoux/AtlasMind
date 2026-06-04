import { describe, it, expect, vi } from 'vitest';
import { VoicePanel } from '../../src/views/voicePanel';
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

describe('VoicePanel', () => {
  it('should create a new panel', () => {
    const mockContext = {
      extensionUri: 'file:///mock/extension/path',
      subscriptions: {
        push: vi.fn(),
      },
    };
    const mockVoiceManager = {
      attachPanel: vi.fn(),
    };
    VoicePanel.createOrShow(mockContext as any, mockVoiceManager as any);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
  });
});
