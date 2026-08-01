import { describe, expect, it } from 'vitest';

import {
  buildLensContextPatch,
  buildLensDraftPrompt,
  createSourceLensTarget,
  normalizeLensTarget,
} from '../../src/core/lensTarget';

describe('AtlasMind Lens visual targets', () => {
  it('creates a source-backed symbol target without copying source text', () => {
    const target = createSourceLensTarget({
      kind: 'symbol',
      label: 'submitOrder',
      detail: 'Function',
      workspacePath: 'src/orders/submitOrder.ts',
      symbolKind: 'Function',
      range: {
        startLine: 12,
        startColumn: 3,
        endLine: 44,
        endColumn: 2,
      },
    });

    expect(target).toEqual(expect.objectContaining({
      version: 1,
      kind: 'symbol',
      label: 'submitOrder',
      workspacePath: 'src/orders/submitOrder.ts',
      evidence: {
        kind: 'source',
        source: 'VS Code language service',
        confidence: 1,
      },
    }));
    expect(JSON.stringify(target)).not.toContain('function submitOrder');
  });

  it('rejects paths and ranges that cannot identify a workspace source safely', () => {
    expect(normalizeLensTarget({
      version: 1,
      id: 'bad-absolute',
      kind: 'file',
      label: 'secrets',
      workspacePath: '/etc/passwd',
      evidence: { kind: 'source', source: 'test' },
    })).toBeUndefined();

    expect(normalizeLensTarget({
      version: 1,
      id: 'bad-traversal',
      kind: 'symbol',
      label: 'escape',
      workspacePath: '../outside.ts',
      range: { startLine: 0, startColumn: 1, endLine: 1, endColumn: 1 },
      evidence: { kind: 'source', source: 'test' },
    })).toBeUndefined();
  });

  it('sanitizes externally supplied labels and clamps confidence', () => {
    const normalized = normalizeLensTarget({
      version: 1,
      id: 'symbol\u0000id',
      kind: 'symbol',
      label: 'load\u0007User',
      detail: 'A'.repeat(800),
      workspacePath: 'src\\users.ts',
      symbolKind: 'Function',
      range: { startLine: 4, startColumn: 2, endLine: 9, endColumn: 1 },
      evidence: { kind: 'source', source: 'Language\u0000server', confidence: 3 },
    });

    expect(normalized).toEqual(expect.objectContaining({
      id: 'symbol id',
      label: 'load User',
      workspacePath: 'src/users.ts',
      evidence: { kind: 'source', source: 'Language server', confidence: 1 },
    }));
    expect(normalized?.detail).toHaveLength(400);
  });

  it('preserves legitimate whitespace in workspace file names', () => {
    const normalized = normalizeLensTarget({
      version: 1,
      id: 'spaced-file',
      kind: 'file',
      label: 'order  summary.ts',
      workspacePath: 'src/order  summary.ts',
      evidence: { kind: 'source', source: 'test' },
    });

    expect(normalized?.workspacePath).toBe('src/order  summary.ts');

    const created = createSourceLensTarget({
      kind: 'file',
      label: 'order  summary.ts',
      workspacePath: 'src/order  summary.ts',
    });
    expect(created.id).toContain('src/order  summary.ts');
  });

  it('opens a question draft with a one-shot, evidence-labelled context patch', () => {
    const target = createSourceLensTarget({
      kind: 'symbol',
      label: 'routePanelPrompt',
      workspacePath: 'src/views/chatSlashRouting.ts',
      symbolKind: 'Function',
      range: { startLine: 80, startColumn: 1, endLine: 130, endColumn: 2 },
    });

    expect(buildLensDraftPrompt(target)).toContain('Question about `routePanelPrompt`');
    expect(buildLensDraftPrompt(target)).toContain('src/views/chatSlashRouting.ts:80-130');
    expect(buildLensContextPatch(target)).toEqual({
      atlasmindLens: {
        target,
        instruction: expect.stringContaining('inspect live workspace evidence'),
      },
    });
  });
});
