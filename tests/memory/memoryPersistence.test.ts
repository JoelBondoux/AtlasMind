import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCreateDirectory = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockWriteFile = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockReadDirectory = vi.fn<() => Promise<[string, number][]>>().mockResolvedValue([]);

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      createDirectory: (...args: unknown[]) => mockCreateDirectory(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
      readFile: vi.fn().mockResolvedValue(new Uint8Array()),
      stat: vi.fn().mockResolvedValue({ mtime: Date.now() }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
  Uri: {
    joinPath: (base: { path: string }, ...segments: string[]) => ({
      path: [base.path, ...segments].join('/'),
      fsPath: [base.path, ...segments].join('/'),
      toString: () => [base.path, ...segments].join('/'),
    }),
    file: (path: string) => ({ path, fsPath: path, toString: () => path }),
  },
  FileType: { File: 1, Directory: 2 },
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));

import { MemoryManager } from '../../src/memory/memoryManager.ts';
import type { MemoryEntry } from '../../src/types.ts';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    path: 'decisions/test.md',
    title: 'Test Decision',
    tags: ['test'],
    lastModified: new Date().toISOString(),
    snippet: 'This is a test decision entry.',
    ...overrides,
  };
}

const FAKE_ROOT = { path: '/workspace/project_memory', fsPath: '/workspace/project_memory', toString: () => '/workspace/project_memory' };

describe('MemoryManager persistence', () => {
  beforeEach(() => {
    mockCreateDirectory.mockClear();
    mockWriteFile.mockClear();
  });

  it('persistEntry creates parent directory before writing', async () => {
    const manager = new MemoryManager();
    await (manager as any).rootUri; // ensure rootUri is set via loadFromDisk path
    // Set rootUri directly via loadFromDisk simulation
    mockReadDirectory.mockResolvedValueOnce([]);
    await manager.loadFromDisk(FAKE_ROOT as any);

    await manager.persistEntry(makeEntry());

    expect(mockCreateDirectory).toHaveBeenCalledOnce();
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('upsert triggers async persistEntry (write called eventually)', async () => {
    mockReadDirectory.mockResolvedValueOnce([]);
    const manager = new MemoryManager();
    await manager.loadFromDisk(FAKE_ROOT as any);

    manager.upsert(makeEntry());
    // Allow microtasks to flush
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('persistEntry writes correct markdown content', async () => {
    mockReadDirectory.mockResolvedValueOnce([]);
    const manager = new MemoryManager();
    await manager.loadFromDisk(FAKE_ROOT as any);

    const entry = makeEntry({ title: 'My Decision', tags: ['arch'], snippet: 'Use TypeScript.' });
    await manager.persistEntry(entry, 'Use TypeScript.\n\nReason: type safety.');

    const [, writtenBytes] = mockWriteFile.mock.calls[0] as [unknown, Uint8Array];
    const content = Buffer.from(writtenBytes).toString('utf-8');
    expect(content).toContain('Use TypeScript.');
    expect(content).toContain('type safety');
  });

  it('persistEntry does nothing when rootUri is not set', async () => {
    const manager = new MemoryManager();
    // Don't call loadFromDisk — rootUri stays undefined
    await manager.persistEntry(makeEntry());
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
