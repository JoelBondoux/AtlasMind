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

  it('persists workspace learning and SSOT feedback for frustrated prompts, and changes no settings', async () => {
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

    // No settings are written. This assertion was the inverse — it required
    // `chatSessionTurnLimit: 8` and `chatSessionContextChars: 4000` — and that
    // write went to ConfigurationTarget.Workspace, i.e. `.vscode/settings.json`,
    // a file most repositories commit, with nothing in the turn naming either
    // key. The detector also fired on ordinary polite requests, so it happened on
    // turns where nothing had gone wrong. The signal still shapes how the turn is
    // answered; it no longer edits the operator's configuration to do it.
    expect(vscodeMock.configurationUpdates).toEqual([]);

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

  it.each([
    'can you do this for me when you have a moment',
    'could you do that for me please',
    'just do it the simple way, no need to over-engineer',
    'just do that in a single pass',
  ])('treats %j as an ordinary request, not frustration', async prompt => {
    // Measured false positives. Each fired the whole adaptation — a rewritten
    // system prompt, a learned preference written to the personality profile, an
    // operator-feedback note in git-tracked memory, and a settings write — on a
    // turn where nothing had gone wrong. "Just do it *the simple way*" says how;
    // it is an instruction, not a complaint.
    const atlas = makeAtlas();
    const adaptation = await applyOperatorFrustrationAdaptation(prompt, atlas as unknown as AtlasMindContext, {});

    expect(adaptation).toBeUndefined();
    expect(vscodeMock.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    "you're not listening to me",
    "that's the third time you've ignored my question",
    'I asked you to fix it, not explain it',
    "forget it, I'll do it myself",
    'why do you keep offering instead of doing',
    'stop asking and just do it',
  ])('recognises %j as friction', async prompt => {
    // How people actually complain. Five of these eight shapes went unrecognised,
    // and an undetected signal means the next turn repeats whatever caused the
    // friction — the adaptation only runs on a detected one.
    const atlas = makeAtlas();
    const adaptation = await applyOperatorFrustrationAdaptation(prompt, atlas as unknown as AtlasMindContext, {});

    expect(adaptation?.contextPatch.userFrustrationSignal).toContain('Operator frustration signal');
  });

  it('restores settings an earlier build wrote without asking, once', async () => {
    // Anyone who hit the old path has 8/4000 sitting in their committed
    // `.vscode/settings.json`. Putting the originals back is owed, and it happens
    // on the next turn either way — a frustrated one or an ordinary one.
    const atlas = makeAtlas();
    workspaceStateStore.set('atlasmind.frustrationSettingsSnapshot', {
      originalTurnLimit: 4,
      originalContextChars: 2000,
      lastFrustrationAt: new Date().toISOString(),
    });
    vscodeMock.configurationState.set('chatSessionTurnLimit', 8);
    vscodeMock.configurationState.set('chatSessionContextChars', 4000);

    await applyOperatorFrustrationAdaptation('Please update the chat panel styles.', atlas as unknown as AtlasMindContext, {});

    expect(vscodeMock.configurationUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'chatSessionTurnLimit', value: 4 }),
      expect.objectContaining({ key: 'chatSessionContextChars', value: 2000 }),
    ]));
    expect(workspaceStateStore.has('atlasmind.frustrationSettingsSnapshot')).toBe(false);
  });

  it('leaves a value the operator has since chosen alone', async () => {
    // Conservative in the same way the old cooling logic was: only put a value
    // back if it still equals what was written.
    const atlas = makeAtlas();
    workspaceStateStore.set('atlasmind.frustrationSettingsSnapshot', {
      originalTurnLimit: 4,
      originalContextChars: 2000,
      lastFrustrationAt: new Date().toISOString(),
    });
    vscodeMock.configurationState.set('chatSessionTurnLimit', 12);
    vscodeMock.configurationState.set('chatSessionContextChars', 4000);

    await applyOperatorFrustrationAdaptation('Please update the chat panel styles.', atlas as unknown as AtlasMindContext, {});

    expect(vscodeMock.configurationUpdates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'chatSessionTurnLimit' }),
    ]));
  });
});
