import { describe, it, vi } from 'vitest';
import { ScannerRulesManager } from '../../src/core/scannerRulesManager';


vi.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: vi.fn().mockResolvedValue(new TextEncoder().encode('[]')),
    },
  },
  Uri: {
    joinPath: vi.fn(),
  },
}));

describe('ScannerRulesManager', () => {
  it('should load rules', async () => {
    const mockContext = {
      extensionUri: 'file:///mock/extension/path',
      globalState: {
        get: vi.fn(),
      },
    };
    new ScannerRulesManager(mockContext.globalState);
    
    
  });
});
