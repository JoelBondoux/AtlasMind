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
    (VoicePanel as any).currentPanel = undefined;
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

  it('renders a voice webview script with valid JavaScript syntax', () => {
    // Reset the module-level singleton so createOrShow rebuilds the HTML.
    (VoicePanel as any).currentPanel = undefined;
    const mockContext = { extensionUri: 'file:///mock', subscriptions: { push: vi.fn() } };
    const mockVoiceManager = { attachPanel: vi.fn() };
    VoicePanel.createOrShow(mockContext as any, mockVoiceManager as any);

    const panel = (vscode.window.createWebviewPanel as any).mock.results.at(-1).value;
    const html = panel.webview.html as string;
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    // Validate JS syntax (parse only) — catches template-literal escaping regressions
    // in the large injected capture/encode script.
    expect(() => new Function(scriptMatch![1])).not.toThrow();
  });
});
