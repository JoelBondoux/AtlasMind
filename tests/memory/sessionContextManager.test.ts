import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { removeTempDir } from '../helpers/tempDir.ts';
import { SessionContextManager } from '../../src/memory/sessionContextManager.ts';

// The shared vscode mock's fs returns an empty buffer, which would make every
// parse trivially succeed on empty input. Read the real file instead, so these
// exercise the parser against bytes actually on disk.
const readReal = vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri: vscode.Uri) => {
  try {
    return new Uint8Array(readFileSync(uri.fsPath));
  } catch {
    throw new Error('ENOENT');
  }
});
const deleteReal = vi.spyOn(vscode.workspace.fs, 'delete').mockImplementation(async (uri: vscode.Uri) => {
  rmSync(uri.fsPath, { recursive: true, force: true });
});

afterEach(() => {
  readReal.mockClear();
  deleteReal.mockClear();
});

/**
 * `context.md` is parsed with regexes that used `\z` as an end-of-string anchor.
 * JavaScript has no `\z` — it matches a literal "z" — so with a lazy quantifier in
 * front of it each section was cut at the first "z" after its heading, or failed
 * to match at all when no "z" followed. Open Threads and the current state were
 * routinely truncated or lost, and every prompt built from the bundle inherited it.
 *
 * Nothing exercised this path, which is why it survived. These read a real file
 * through the public API rather than reaching for the private methods.
 */
describe('SessionContextManager parses context.md sections', () => {
  const withContextMd = async (
    body: string,
    run: (bundle: Awaited<ReturnType<SessionContextManager['loadContext']>>) => void | Promise<void>,
  ): Promise<void> => {
    const root = mkdtempSync(nodePath.join(tmpdir(), 'atlasmind-session-context-'));
    try {
      const sessionDir = nodePath.join(root, 'sessions', 'session-1');
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(nodePath.join(sessionDir, 'context.md'), body, 'utf8');

      const manager = new SessionContextManager({ complete: vi.fn() } as never);
      manager.setSsotRoot(vscode.Uri.file(root));
      await run(await manager.loadContext('session-1'));
    } finally {
      removeTempDir(root);
    }
  };

  it('reads a section whose body contains the letter z', async () => {
    // The exact failure: `\z` matched the "z" in "analyze", cutting the section there.
    await withContextMd(
      [
        '## Summary',
        'We are working on the parser.',
        '',
        '## Concluded',
        'Decided to analyze the payload before writing it.',
        '',
        '## Open Threads',
        'Still need to size the buffer.',
        '',
      ].join('\n'),
      bundle => {
        expect(bundle).not.toBeNull();
        expect(bundle!.decisions).toContain('analyze the payload before writing it');
        expect(bundle!.openThreads).toContain('size the buffer');
      },
    );
  });

  it('reads a trailing section that contains no z at all', async () => {
    // With `\z` the lookahead could never be satisfied here, so the whole match
    // failed and the section came back empty.
    await withContextMd(
      ['## Summary', 'All good.', '', '## Open Threads', 'Confirm the API contract.', ''].join('\n'),
      bundle => {
        expect(bundle!.openThreads).toContain('Confirm the API contract');
      },
    );
  });

  it('stops a section at the next heading rather than swallowing the rest', async () => {
    await withContextMd(
      [
        '## Concluded',
        'Shipped the migration.',
        '',
        '## Open Threads',
        'Chase the flaky test.',
        '',
      ].join('\n'),
      bundle => {
        expect(bundle!.decisions).toContain('Shipped the migration');
        expect(bundle!.decisions).not.toContain('Chase the flaky test');
      },
    );
  });

  it('keeps the summary free of the sections it extracts', async () => {
    await withContextMd(
      [
        '## Summary',
        'Building the billing page.',
        '',
        '## Concluded',
        'Analyzed the schema.',
        '',
        '## Open Threads',
        'Size the queue.',
        '',
      ].join('\n'),
      bundle => {
        expect(bundle!.summary).toContain('Building the billing page');
        expect(bundle!.summary).not.toContain('Analyzed the schema');
        expect(bundle!.summary).not.toContain('Size the queue');
      },
    );
  });

  it('returns empty strings for sections that are genuinely absent', async () => {
    await withContextMd(['## Summary', 'Nothing concluded yet.', ''].join('\n'), bundle => {
      expect(bundle!.decisions).toBe('');
      expect(bundle!.openThreads).toBe('');
    });
  });
});

describe('SessionContextManager transcript revision boundary', () => {
  const entries = [
    { id: 'u1', role: 'user' as const, content: 'Fix the stale context.', timestamp: '2026-08-22T10:00:00.000Z' },
    { id: 'a1', role: 'assistant' as const, content: 'I found the race.', timestamp: '2026-08-22T10:00:01.000Z' },
  ];

  it('loads a bundle only for the transcript revision it summarizes', async () => {
    const root = mkdtempSync(nodePath.join(tmpdir(), 'atlasmind-session-revision-'));
    try {
      const manager = new SessionContextManager(vi.fn().mockResolvedValue([
        '## Goal',
        'Prevent stale context.',
        '',
        '## Current State',
        'The race is diagnosed.',
      ].join('\n')));
      manager.setSsotRoot(vscode.Uri.file(root));

      await manager.bootstrapFromTranscript('session-1', entries, 7);

      await expect(manager.loadContext('session-1', 6)).resolves.toBeNull();
      await expect(manager.loadContext('session-1', 7)).resolves.toMatchObject({
        sourceRevision: 7,
        freshness: 'current',
        summary: expect.stringContaining('Prevent stale context'),
      });
    } finally {
      removeTempDir(root);
    }
  });

  it('cannot recreate invalidated context when an older maintenance pass finishes late', async () => {
    const root = mkdtempSync(nodePath.join(tmpdir(), 'atlasmind-session-invalidation-'));
    let releaseCompletion!: (value: string) => void;
    const completion = new Promise<string>(resolve => {
      releaseCompletion = resolve;
    });
    const completer = vi.fn().mockReturnValue(completion);
    try {
      const manager = new SessionContextManager(completer);
      manager.setSsotRoot(vscode.Uri.file(root));

      manager.maintainContext('session-1', entries, 3);
      await vi.waitFor(() => expect(completer).toHaveBeenCalledOnce());

      const invalidated = manager.invalidateSession('session-1');
      releaseCompletion('## Goal\nThis output is stale.');
      await invalidated;

      const sessionDir = nodePath.join(root, 'sessions', 'session-1');
      expect(existsSync(sessionDir)).toBe(false);
      await expect(manager.loadContext('session-1', 4)).resolves.toBeNull();
    } finally {
      releaseCompletion?.('');
      removeTempDir(root);
    }
  });
});
