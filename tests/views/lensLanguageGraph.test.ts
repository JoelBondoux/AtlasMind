import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeCommand, workspaceFolder, rootUri, callerUri, calleeUri, referenceUri } = vi.hoisted(() => {
  const uri = (path: string) => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` });
  return {
    executeCommand: vi.fn(),
    workspaceFolder: { name: 'atlasmind', index: 0, uri: uri('/workspace') },
    rootUri: uri('/workspace/src/root.ts'),
    callerUri: uri('/workspace/src/caller.ts'),
    calleeUri: uri('/workspace/src/callee.ts'),
    referenceUri: uri('/workspace/tests/root.test.ts'),
  };
});

vi.mock('vscode', () => ({
  Position: class {
    constructor(public readonly line: number, public readonly character: number) {}
  },
  SymbolKind: { 11: 'Function', Function: 11 },
  commands: { executeCommand },
  workspace: {
    workspaceFolders: [workspaceFolder],
    getWorkspaceFolder: vi.fn((uri: { path: string }) => uri.path.startsWith('/workspace/') ? workspaceFolder : undefined),
    asRelativePath: vi.fn((uri: { path: string }) => uri.path.replace('/workspace/', '')),
  },
}));

import { LensLanguageGraphAdapter } from '../../src/views/lensLanguageGraph';
import { createSourceLensTarget } from '../../src/core/lensTarget';

const range = (line: number) => ({
  start: { line, character: 0 },
  end: { line: line + 2, character: 1 },
});

const item = (name: string, uri: unknown, line: number) => ({
  name,
  detail: `${name}()`,
  kind: 11,
  uri,
  range: range(line),
  selectionRange: range(line),
});

describe('Lens VS Code language graph adapter', () => {
  beforeEach(() => {
    executeCommand.mockReset();
  });

  it('combines references and call hierarchy as bounded source evidence', async () => {
    const rootItem = item('root', rootUri, 4);
    const callerItem = item('caller', callerUri, 8);
    const calleeItem = item('callee', calleeUri, 12);
    executeCommand.mockImplementation(async (command: string, argument: unknown) => {
      if (command === 'vscode.prepareCallHierarchy') return [rootItem];
      if (command === 'vscode.provideIncomingCalls') return [{ from: callerItem, fromRanges: [range(9)] }];
      if (command === 'vscode.provideOutgoingCalls') {
        return argument === rootItem ? [{ to: calleeItem, fromRanges: [range(5)] }] : [];
      }
      if (command === 'vscode.executeReferenceProvider') {
        return [
          { uri: calleeUri, range: range(12) },
          { uri: referenceUri, range: range(3) },
        ];
      }
      return [];
    });
    const root = createSourceLensTarget({
      kind: 'symbol',
      label: 'root',
      workspace: { name: 'atlasmind', index: 0 },
      workspacePath: 'src/root.ts',
      range: { startLine: 5, startColumn: 1, endLine: 7, endColumn: 2 },
      symbolKind: 'Function',
    });

    const graph = await new LensLanguageGraphAdapter().buildPossibleFlow(root, rootUri as never);

    expect(graph.mode).toBe('possible');
    expect(graph.nodes.map(node => node.target.label)).toEqual(expect.arrayContaining([
      'root',
      'caller',
      'callee',
      'root.test.ts:4',
    ]));
    expect(graph.edges.map(edge => edge.relation)).toEqual(expect.arrayContaining([
      'calls',
      'references',
    ]));
    expect(graph.edges.every(edge => edge.evidence.kind === 'source')).toBe(true);
    expect(graph.notices.some(notice => notice.includes('not observed execution'))).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.prepareCallHierarchy',
      rootUri,
      expect.objectContaining({ line: 4, character: 0 }),
    );
  });

  it('keeps a partial graph and names an unavailable language-service relation', async () => {
    executeCommand.mockImplementation(async (command: string) => {
      if (command === 'vscode.prepareCallHierarchy') throw new Error('provider unavailable');
      if (command === 'vscode.executeReferenceProvider') return [];
      return [];
    });
    const root = createSourceLensTarget({
      kind: 'symbol',
      label: 'root',
      workspace: { name: 'atlasmind', index: 0 },
      workspacePath: 'src/root.ts',
      range: { startLine: 5, startColumn: 1, endLine: 7, endColumn: 2 },
      symbolKind: 'Function',
    });

    const graph = await new LensLanguageGraphAdapter().buildPossibleFlow(root, rootUri as never);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.notices.some(notice => notice.includes('Call hierarchy unavailable'))).toBe(true);
  });
});
