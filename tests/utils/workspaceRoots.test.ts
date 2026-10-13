import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const host = vi.hoisted(() => ({
  workspaceFolders: undefined as FakeFolder[] | undefined,
  settings: {} as Record<string, unknown>,
  configurationReads: 0,
}));

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return host.workspaceFolders;
    },
    getConfiguration: () => {
      host.configurationReads += 1;
      return { get: (key: string, fallback?: unknown) => host.settings[key] ?? fallback };
    },
  },
}));

const {
  defaultWorkspaceFolder,
  defaultWorkspaceRootPath,
  openWorkspaceFolders,
  resolveScope,
  ssotHomeRoot,
  workspaceFolderReferences,
} = await import('../../src/utils/workspaceRoots.ts');
const { sanitizeProjectComposition } = await import('../../src/core/projectComposition.ts');
const { seedWorkflowConfig } = await import('../../src/core/workflowConfig.ts');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-workspace-roots-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function folder(name: string, fsPath: string, scheme = 'file', index = 0): FakeFolder {
  return { name, index, uri: { scheme, fsPath } };
}

beforeEach(() => {
  host.workspaceFolders = undefined;
  host.settings = {};
  host.configurationReads = 0;
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

describe('workspaceRoots — ssotHomeRoot locates project memory on disk', () => {
  let counter = 0;

  /** A fresh folder under the scratch directory, optionally holding a memory folder and a workflow.json. */
  function makeFolder(options: { ssot?: string; declaresHomeHere?: boolean } = {}): string {
    counter += 1;
    const dir = path.join(scratch, `home-${counter}`);
    mkdirSync(dir, { recursive: true });
    if (options.ssot) {
      mkdirSync(path.join(dir, ...options.ssot.split('/')), { recursive: true });
    }
    if (options.declaresHomeHere) {
      mkdirSync(path.join(dir, 'project_memory', 'operations'), { recursive: true });
      writeFileSync(path.join(dir, 'project_memory', 'operations', 'workflow.json'), JSON.stringify({
        ...seedWorkflowConfig({ profile: 'solo' }),
        composition: {
          components: [
            { id: 'root', label: 'Root', location: '.', role: 'application', archetype: { archetype: 'generic', traits: [] }, vcs: 'git', home: true },
          ],
        },
      }));
    }
    return dir;
  }

  it('answers a single folder with that folder without reading the disk or the settings', () => {
    const only = folder('only', path.join(scratch, 'never-created'));
    host.workspaceFolders = [only];
    const home = ssotHomeRoot();
    expect(home.folder).toBe(only);
    expect(home.fsPath).toBe(only.uri.fsPath);
    expect(home.location.rule).toBe('single-root');
    expect(home.refusal).toBeUndefined();
    expect(host.configurationReads).toBe(0);
  });

  it('is the default folder for any single-folder workspace, on any scheme, existing or not', () => {
    fc.assert(fc.property(
      fc.string({ maxLength: 12 }),
      fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
      fc.constantFrom('file', 'vscode-remote', 'vscode-vfs', 'memfs'),
      (name, segment, scheme) => {
        host.workspaceFolders = [folder(name, path.join(scratch, 'maybe', segment), scheme)];
        const home = ssotHomeRoot();
        expect(home.folder).toBe(defaultWorkspaceFolder());
        expect(home.fsPath).toBe(defaultWorkspaceRootPath());
        expect(home.refusal).toBeUndefined();
      },
    ), { numRuns: 60 });
    expect(host.configurationReads).toBe(0);
  });

  it('answers no folder with no home and no refusal', () => {
    expect(ssotHomeRoot()).toMatchObject({ location: { rule: 'no-folder' } });
    expect(ssotHomeRoot().folder).toBeUndefined();
    expect(ssotHomeRoot().refusal).toBeUndefined();
  });

  it('is unchanged in a multi-root workspace whose first folder holds the memory', () => {
    const first = folder('first', makeFolder({ ssot: 'project_memory' }), 'file', 0);
    host.workspaceFolders = [first, folder('second', makeFolder(), 'file', 1)];
    expect(ssotHomeRoot().folder).toBe(first);
    expect(ssotHomeRoot().folder).toBe(defaultWorkspaceFolder());
  });

  it('finds the memory in a later folder, honouring the configured ssotPath', () => {
    host.settings = { ssotPath: 'docs/memory' };
    const second = folder('second', makeFolder({ ssot: 'docs/memory' }), 'file', 1);
    host.workspaceFolders = [folder('first', makeFolder({ ssot: 'project_memory' }), 'file', 0), second];
    const home = ssotHomeRoot();
    expect(home.location.rule).toBe('sole-ssot');
    expect(home.folder).toBe(second);
  });

  it('lets a workflow.json declaring its own folder the home settle two memory folders', () => {
    const declared = folder('declared', makeFolder({ ssot: 'project_memory', declaresHomeHere: true }), 'file', 1);
    host.workspaceFolders = [folder('first', makeFolder({ ssot: 'project_memory' }), 'file', 0), declared];
    const home = ssotHomeRoot();
    expect(home.location.rule).toBe('declared-home');
    expect(home.folder).toBe(declared);
  });

  it('refuses rather than picks when two folders hold memory and neither declares, naming both', () => {
    host.workspaceFolders = [
      folder('alpha', makeFolder({ ssot: 'project_memory' }), 'file', 0),
      folder('beta', makeFolder({ ssot: 'project_memory' }), 'file', 1),
    ];
    const home = ssotHomeRoot();
    expect(home.location.rule).toBe('ambiguous');
    expect(home.folder).toBeUndefined();
    expect(home.fsPath).toBeUndefined();
    expect(home.refusal).toContain('"alpha" and "beta"');
  });

  it('never probes a virtual folder, and falls back to the default path for an unsafe setting', () => {
    host.settings = { ssotPath: '../outside' };
    const local = folder('local', makeFolder({ ssot: 'project_memory' }), 'file', 1);
    host.workspaceFolders = [folder('virtual', makeFolder({ ssot: 'project_memory' }), 'vscode-vfs', 0), local];
    const home = ssotHomeRoot();
    expect(home.location.rule).toBe('sole-ssot');
    expect(home.folder).toBe(local);
    expect(home.location.unprobed.map(reference => reference.name)).toEqual(['virtual']);
  });
});
