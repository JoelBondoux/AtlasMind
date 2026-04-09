import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceStateStore = new Map<string, unknown>();

const vscodeMock = vi.hoisted(() => {
  const configurationState = new Map<string, unknown>();
  const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];
  const writeFile = vi.fn(async () => undefined);
  const createDirectory = vi.fn(async () => undefined);

  return {
    configurationState,
    configurationUpdates,
    writeFile,
    createDirectory,
    workspaceFolders: [{ uri: { fsPath: '/workspace', path: '/workspace' } }],
  };
});

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return vscodeMock.workspaceFolders;
    },
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => vscodeMock.configurationState.has(key)
        ? vscodeMock.configurationState.get(key)
        : fallback,
      update: async (key: string, value: unknown, target?: unknown) => {
        vscodeMock.configurationUpdates.push({ key, value, target });
        vscodeMock.configurationState.set(key, value);
      },
    }),
    fs: {
      createDirectory: vscodeMock.createDirectory,
      writeFile: vscodeMock.writeFile,
    },
  },
  ConfigurationTarget: { Workspace: 2 },
  Uri: {
    joinPath: (...segments: Array<{ fsPath?: string; path?: string } | string>) => {
      const values = segments.map(segment => typeof segment === 'string' ? segment : (segment.path ?? segment.fsPath ?? ''));
      const joined = values
        .filter(Boolean)
        .map((value, index) => index === 0 ? value.replace(/\/+$/, '') : value.replace(/^\/+|\/+$/g, ''))
        .join('/');
      return { fsPath: joined, path: joined };
    },
  },
}));

import { applyOperatorFrustrationAdaptation } from '../../src/chat/participant.ts';
import type { AtlasMindContext } from '../../src/extension.ts';

interface AtlasAdaptationDouble {
  extensionContext: {
    workspaceState: {
      get: (key: string, fallback?: unknown) => unknown;
      update: ReturnType<typeof vi.fn>;
    };
  };
  memoryManager: {
    loadFromDisk: ReturnType<typeof vi.fn>;
  };
  memoryRefresh: {
    fire: ReturnType<typeof vi.fn>;
  };
}

function makeAtlas() {
  return {
    extensionContext: {
      workspaceState: {
        get: (key: string, fallback?: unknown) => workspaceStateStore.has(key) ? workspaceStateStore.get(key) : fallback,
        update: vi.fn(async (key: string, value: unknown) => {
          if (value === undefined) {
            workspaceStateStore.delete(key);
            return;
          }
          workspaceStateStore.set(key, value);
        }),
      },
    },
    memoryManager: {
      loadFromDisk: vi.fn(async () => undefined),
    },
    memoryRefresh: {
      fire: vi.fn(),
    },
  } satisfies AtlasAdaptationDouble;
}

describe('operator frustration adaptation', () => {
  beforeEach(() => {
    workspaceStateStore.clear();
    vscodeMock.configurationState.clear();
    vscodeMock.configurationUpdates.length = 0;
    vscodeMock.writeFile.mockClear();
    vscodeMock.createDirectory.mockClear();
    vscodeMock.configurationState.set('ssotPath', 'project_memory');
    vscodeMock.configurationState.set('chatSessionTurnLimit', 4);
    vscodeMock.configurationState.set('chatSessionContextChars', 2000);
  });

  it('persists workspace learning, settings tuning, and SSOT feedback for frustrated prompts', async () => {
    const atlas = makeAtlas();

    const adaptation = await applyOperatorFrustrationAdaptation(
      'You are not doing what I ask. Can you do that for me?',
      atlas as unknown as AtlasMindContext,
      { sessionContext: 'We already identified the broken chat panel and the next safe step is to patch it.' },
    );

    expect(adaptation?.contextPatch.userFrustrationSignal).toContain('Operator frustration signal');
    expect(adaptation?.policySnapshot).toEqual(expect.objectContaining({
      source: 'runtime',
      label: 'Operator friction signal',
    }));

    const storedProfile = workspaceStateStore.get('atlasmind.personalityProfile') as { answers?: Record<string, unknown> } | undefined;
    expect(storedProfile?.answers?.defaultActionBias).toEqual(expect.stringContaining('prefer the most concrete safe tool-backed action'));
    expect(storedProfile?.answers?.rememberLongTerm).toEqual(expect.stringContaining('bias toward concrete action'));

    expect(vscodeMock.configurationUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'chatSessionTurnLimit', value: 8 }),
      expect.objectContaining({ key: 'chatSessionContextChars', value: 4000 }),
    ]));

    expect(vscodeMock.createDirectory).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/project_memory/operations' }));
    expect(vscodeMock.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/project_memory/operations/operator-feedback.md' }),
      expect.any(Uint8Array),
    );

    const writeCalls = vscodeMock.writeFile.mock.calls as unknown as Array<[unknown, unknown]>;
    const written = (writeCalls[0]?.[1] as Uint8Array | undefined) ?? new Uint8Array();
    expect(Buffer.from(written).toString('utf8')).toContain('Operator Feedback');
    expect(Buffer.from(written).toString('utf8')).toContain('Learned response rule');

    expect(atlas.memoryManager.loadFromDisk).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/project_memory' }));
    expect(atlas.memoryRefresh.fire).toHaveBeenCalled();
  });

  it('does not persist anything when no frustration cue is present', async () => {
    const atlas = makeAtlas();

    const adaptation = await applyOperatorFrustrationAdaptation(
      'Please update the chat panel styles.',
      atlas as unknown as AtlasMindContext,
      { sessionContext: 'Working in the chat panel code.' },
    );

    expect(adaptation).toBeUndefined();
    expect(workspaceStateStore.size).toBe(0);
    expect(vscodeMock.configurationUpdates).toHaveLength(0);
    expect(vscodeMock.writeFile).not.toHaveBeenCalled();
    expect(atlas.memoryManager.loadFromDisk).not.toHaveBeenCalled();
    expect(atlas.memoryRefresh.fire).not.toHaveBeenCalled();
  });
});
