import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The adapter must change where the folder question is asked and never the
 * answer: `docs/project-composition.md` §8 requires default resolution to stay
 * exactly `workspaceFolders[0]`. These tests hold it to that on the vscode mock.
 */

interface FakeFolder {
  name: string;
  index: number;
  uri: { scheme: string; fsPath: string };
}

const host = vi.hoisted(() => ({ workspaceFolders: undefined as FakeFolder[] | undefined }));

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return host.workspaceFolders;
    },
  },
}));

const {
  defaultWorkspaceFolder,
  defaultWorkspaceRootPath,
  openWorkspaceFolders,
  resolveScope,
  workspaceFolderReferences,
} = await import('../../src/utils/workspaceRoots.ts');
const { sanitizeProjectComposition } = await import('../../src/core/projectComposition.ts');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-workspace-roots-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function folder(name: string, fsPath: string, scheme = 'file', index = 0): FakeFolder {
  return { name, index, uri: { scheme, fsPath } };
}

beforeEach(() => {
  host.workspaceFolders = undefined;
});

describe('workspaceRoots — no folder open', () => {
  it('answers undefined and an empty list rather than throwing', async () => {
    expect(openWorkspaceFolders()).toEqual([]);
    expect(defaultWorkspaceFolder()).toBeUndefined();
    expect(defaultWorkspaceRootPath()).toBeUndefined();
    expect(await workspaceFolderReferences()).toEqual([]);
    const scope = await resolveScope();
    expect(scope).toMatchObject({ label: 'No workspace', roots: [], complete: false });
  });
});

describe('workspaceRoots — the default is exactly the first folder', () => {
  it('returns the host\'s own folder object, not a copy', () => {
    const first = folder('app', path.join(scratch, 'app'));
    host.workspaceFolders = [first, folder('lib', path.join(scratch, 'lib'), 'file', 1)];
    expect(defaultWorkspaceFolder()).toBe(first);
    expect(defaultWorkspaceRootPath()).toBe(first.uri.fsPath);
  });

  it('caches nothing: a folder added or removed while running is seen on the next call', () => {
    host.workspaceFolders = [folder('one', path.join(scratch, 'one'))];
    expect(defaultWorkspaceRootPath()).toBe(path.join(scratch, 'one'));
    host.workspaceFolders = [folder('two', path.join(scratch, 'two'))];
    expect(defaultWorkspaceRootPath()).toBe(path.join(scratch, 'two'));
    host.workspaceFolders = undefined;
    expect(defaultWorkspaceRootPath()).toBeUndefined();
  });

  it('holds for any folder list: default root is folders[0], and every name and path survives in order', async () => {
    const folderArb = fc.record({
      name: fc.string({ maxLength: 12 }),
      segment: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
      scheme: fc.constantFrom('file', 'vscode-remote', 'vscode-vfs', 'memfs'),
    });
    await fc.assert(fc.asyncProperty(fc.array(folderArb, { maxLength: 6 }), async specs => {
      const folders = specs.map((spec, index) => folder(spec.name, path.join(scratch, 'missing', spec.segment), spec.scheme, index));
      host.workspaceFolders = folders;

      expect(defaultWorkspaceFolder()).toBe(folders[0]);
      expect(defaultWorkspaceRootPath()).toBe(folders[0]?.uri.fsPath);
      expect(openWorkspaceFolders()).toBe(folders);

      const references = await workspaceFolderReferences();
      expect(references.map(reference => reference.name)).toEqual(folders.map(entry => entry.name));
      expect(references.map(reference => reference.fsPath)).toEqual(folders.map(entry => entry.uri.fsPath));

      // The label a surface shows is unchanged by routing through the adapter.
      const scope = await resolveScope();
      expect(scope.label).toBe(folders[0]?.name ?? 'No workspace');
      expect(scope.roots).toEqual(folders[0] ? [{ name: folders[0].name, fsPath: folders[0].uri.fsPath }] : []);
      expect(scope.target).toEqual({ kind: 'default' });
    }), { numRuns: 60 });
  });
});

describe('workspaceRoots — readability is probed, never assumed', () => {
  it('marks a reachable local folder readable and a vanished one not', async () => {
    host.workspaceFolders = [
      folder('here', scratch, 'file', 0),
      folder('gone', path.join(scratch, 'does-not-exist'), 'file', 1),
    ];
    expect(await workspaceFolderReferences()).toEqual([
      { name: 'here', fsPath: scratch, readable: true },
      { name: 'gone', fsPath: path.join(scratch, 'does-not-exist'), readable: false },
    ]);
  });

  it('does not probe a virtual folder: its fsPath is not a path on this machine', async () => {
    // The scratch directory exists, so a probe would succeed — which is exactly
    // the wrong answer for a folder served by a virtual file system.
    host.workspaceFolders = [folder('virtual', scratch, 'vscode-vfs', 0)];
    expect((await workspaceFolderReferences())[0]?.readable).toBe(false);
  });

  it('resolves a declared composition against the probed folders, reporting what it cannot see', async () => {
    host.workspaceFolders = [folder('app', scratch, 'file', 0)];
    const composition = sanitizeProjectComposition({
      components: [
        { id: 'app', label: 'App', location: 'app', role: 'application', archetype: { archetype: 'web-app', traits: [] }, vcs: 'git', home: true },
        { id: 'api', label: 'API', location: 'api', role: 'service', archetype: { archetype: 'api', traits: [] }, vcs: 'git' },
      ],
    })!;
    const scope = await resolveScope(composition, { kind: 'all' });
    expect(scope.roots.map(root => root.componentId)).toEqual(['app']);
    expect(scope.unknown).toEqual([expect.objectContaining({ componentId: 'api', reason: 'not-open' })]);
    expect(scope.complete).toBe(false);
  });
});
