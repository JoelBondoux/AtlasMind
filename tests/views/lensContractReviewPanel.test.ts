import { describe, expect, it, vi } from 'vitest';

const {
  createWebviewPanel,
  postMessage,
  showTextDocument,
  showQuickPick,
  revealPreferredChatSurface,
  workspaceFolder,
  messageHandlers,
  panel,
} = vi.hoisted(() => {
  const messageHandlers: Array<(message: unknown) => void> = [];
  const uri = (path: string) => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` });
  const webview = {
    html: '',
    cspSource: 'vscode-webview:',
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn((handler: (message: unknown) => void) => {
      messageHandlers.push(handler);
      return { dispose: vi.fn() };
    }),
  };
  const panel = {
    webview,
    reveal: vi.fn(),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
  };
  return {
    createWebviewPanel: vi.fn(() => panel),
    postMessage: webview.postMessage,
    showTextDocument: vi.fn(),
    showQuickPick: vi.fn(),
    revealPreferredChatSurface: vi.fn(),
    workspaceFolder: { name: 'atlasmind', index: 0, uri: uri('/workspace') },
    messageHandlers,
    panel,
  };
});

vi.mock('vscode', () => ({
  ViewColumn: { Beside: 2 },
  Selection: class {
    constructor(
      public readonly startLine: number,
      public readonly startColumn: number,
      public readonly endLine: number,
      public readonly endColumn: number,
    ) {}
  },
  Uri: {
    joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({
      scheme: 'file',
      path: `${base.path}/${parts.join('/')}`,
      fsPath: `${base.fsPath}/${parts.join('/')}`,
      toString: () => `file://${base.path}/${parts.join('/')}`,
    }),
  },
  window: {
    createWebviewPanel,
    showTextDocument,
    showQuickPick,
    showWarningMessage: vi.fn(),
  },
  workspace: {
    workspaceFolders: [workspaceFolder],
    getWorkspaceFolder: vi.fn(() => workspaceFolder),
    asRelativePath: vi.fn((uri: { path: string }) => uri.path.replace('/workspace/', '')),
  },
}));

vi.mock('../../src/views/chatPanel', () => ({ revealPreferredChatSurface }));

import { normalizeLensContract, normalizeLensContractMappingFile } from '../../src/core/lensContract';
import { createSourceLensTarget } from '../../src/core/lensTarget';
import { LensContractReviewPanel } from '../../src/views/lensContractReviewPanel';

function contract(id: string, label: string, fieldId: string, fieldLabel: string, dataType = 'string') {
  const target = createSourceLensTarget({
    kind: 'code-range',
    label: fieldLabel,
    workspace: { name: 'atlasmind', index: 0 },
    workspacePath: 'contracts/user.json',
    range: { startLine: 3, startColumn: 2, endLine: 3, endColumn: 12 },
  });
  return normalizeLensContract({
    version: 1,
    id,
    label,
    layer: id.startsWith('api') ? 'api' : 'database',
    sourceKind: id.startsWith('api') ? 'openapi' : 'sql',
    coverage: 'complete',
    target,
    fields: [{
      id: fieldId,
      path: fieldLabel,
      label: fieldLabel,
      dataType,
      presence: 'required',
      nullability: 'non-null',
      target,
      evidence: { kind: 'declared', source: 'test fixture' },
    }],
  })!;
}

describe('Lens contract review panel', () => {
  it('posts normalized review data after ready and resolves field/wire actions in the host', async () => {
    const upstream = contract('api:user', 'User request', 'api:email', '</script><script>bad()</script>');
    const downstream = contract('database:users', 'users', 'db:email', '</script><script>bad()</script>', 'number');
    const mappingFile = normalizeLensContractMappingFile({ version: 1, mappings: [], suppressions: [] })!;
    showQuickPick.mockResolvedValue({ label: 'Remove field', changeKind: 'remove' });

    LensContractReviewPanel.createOrShow({
      upstream,
      downstream,
      mappingFile,
      relations: [{
        id: 'relation:users-account',
        kind: 'foreign-key',
        label: 'users.email → accounts.id',
        from: { contractLabel: 'users', contractId: downstream.id, fieldPath: fieldLabel(downstream), fieldId: 'db:email' },
        to: { contractLabel: 'accounts', fieldPath: 'id' },
        target: downstream.fields[0]!.target,
        evidence: { kind: 'declared', source: 'SQL FOREIGN KEY', confidence: 1 },
      }],
      sourceNotices: [],
    });

    expect(panel.webview.html).toContain('Field wiring');
    expect(panel.webview.html).toContain('Contract drift review');
    expect(panel.webview.html).toContain('Relationship map');
    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).not.toContain('bad()');
    const handleMessage = messageHandlers.at(-1);
    handleMessage?.({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'snapshot',
      snapshot: expect.objectContaining({
        review: expect.objectContaining({ wires: expect.any(Array) }),
        drift: expect.objectContaining({ findings: expect.any(Array), summary: expect.any(Object) }),
        relations: expect.arrayContaining([expect.objectContaining({ kind: 'foreign-key' })]),
      }),
    }));

    handleMessage?.({ type: 'openField', fieldId: 'api:email' });
    await vi.waitFor(() => expect(showTextDocument).toHaveBeenCalled());
    const snapshot = postMessage.mock.calls.at(-1)?.[0]?.snapshot;
    const wireId = snapshot.review.wires[0].id as string;
    handleMessage?.({ type: 'askWire', wireId });
    await vi.waitFor(() => expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      contextPatch: expect.objectContaining({
        atlasmindLens: expect.objectContaining({
          target: expect.objectContaining({ detail: expect.stringContaining('definite-conflict') }),
        }),
      }),
    })));

    handleMessage?.({ type: 'previewImpact', fieldId: 'api:email' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'impact',
      impact: expect.objectContaining({ changeKind: 'remove', items: expect.any(Array) }),
    })));
    const impact = postMessage.mock.calls.find(call => call[0]?.type === 'impact')?.[0]?.impact;
    const impactItemId = impact.items.find((item: { target?: unknown }) => item.target)?.id as string;
    handleMessage?.({ type: 'askImpact', impactItemId });
    await vi.waitFor(() => expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      contextPatch: expect.objectContaining({
        atlasmindLens: expect.objectContaining({
          target: expect.objectContaining({ kind: 'schema', detail: expect.stringContaining('high') }),
        }),
      }),
    })));

    handleMessage?.({ type: 'askRelation', relationId: 'relation:users-account' });
    await vi.waitFor(() => expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      contextPatch: expect.objectContaining({
        atlasmindLens: expect.objectContaining({
          target: expect.objectContaining({ kind: 'relation', detail: expect.stringContaining('foreign-key') }),
        }),
      }),
    })));
  });
});

function fieldLabel(contractValue: ReturnType<typeof contract>): string {
  return contractValue.fields[0]?.path ?? 'email';
}
