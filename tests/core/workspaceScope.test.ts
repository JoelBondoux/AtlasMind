import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sanitizeProjectComposition, type ProjectComposition } from '../../src/core/projectComposition.ts';
import path from 'node:path';
import {
  SSOT_HOME_MAX_PROBED_FOLDERS,
  SSOT_HOME_RULES,
  defaultWorkspaceFolderOf,
  describeSsotHomeRefusal,
  locateSsotHome,
  resolveWorkspaceScope,
  type SsotHomeProbe,
  type WorkspaceFolderReference,
} from '../../src/core/workspaceScope.ts';

/**
 * A workspace path in the host's own separator.
 *
 * These were written as literal Windows paths, which meant `path.basename`
 * split them on Windows and returned the whole string everywhere else — so the
 * suite passed on one developer's machine and failed on both CI runners that
 * were not Windows.
 */
const at = (...segments: string[]): string => path.join('C:', 'studio', ...segments);
/** A second tree, for the case where two folders share a basename. */
const elsewhere = (...segments: string[]): string => path.join('D:', 'other', ...segments);

const composition = (): ProjectComposition => sanitizeProjectComposition({
  components: [
    { id: 'gameplay', label: 'Gameplay', location: 'home', role: 'application', archetype: { archetype: 'game', traits: [] }, vcs: 'git', home: true },
    { id: 'backend', label: 'Backend', location: 'backend', role: 'service', archetype: { archetype: 'api', traits: ['has-server'] }, vcs: 'git' },
    { id: 'content', label: 'Content', location: 'content', role: 'content', archetype: { archetype: 'generic', traits: [] }, vcs: 'perforce' },
  ],
})!;

const folders = (): WorkspaceFolderReference[] => [
  { name: 'Gameplay', fsPath: at('home') },
  { name: 'Backend', fsPath: at('backend') },
  { name: 'Content', fsPath: at('content') },
];

describe('resolveWorkspaceScope', () => {
  it('defaults byte-for-byte to the first workspace folder without consulting composition', () => {
    const scope = resolveWorkspaceScope(folders().slice().reverse(), composition());
    expect(scope).toEqual({
      target: { kind: 'default' },
      label: 'Content',
      roots: [{ name: 'Content', fsPath: at('content') }],
      unknown: [],
      complete: true,
    });
  });

  it('resolves the declared home only when a caller opts in', () => {
    const scope = resolveWorkspaceScope(folders(), composition(), { kind: 'home' });
    expect(scope.roots).toEqual([
      expect.objectContaining({ componentId: 'gameplay', fsPath: at('home'), vcs: 'git' }),
    ]);
    expect(scope.complete).toBe(true);
  });

  it('resolves one explicitly named component', () => {
    const scope = resolveWorkspaceScope(folders(), composition(), { kind: 'component', componentId: 'content' });
    expect(scope.label).toBe('Content');
    expect(scope.roots[0]).toMatchObject({ componentId: 'content', vcs: 'perforce' });
  });

  it('labels partial all-component coverage and keeps the missing component unknown', () => {
    const scope = resolveWorkspaceScope(folders().slice(0, 2), composition(), { kind: 'all' });
    expect(scope.roots).toHaveLength(2);
    expect(scope.unknown).toEqual([
      { componentId: 'content', componentLabel: 'Content', vcs: 'perforce', reason: 'not-open' },
    ]);
    expect(scope.label).toBe('All declared components (2 of 3 visible)');
    expect(scope.complete).toBe(false);
  });

  it('does not convert an unreadable or ambiguous component into a root', () => {
    const unreadable = folders();
    unreadable[2]!.readable = false;
    expect(resolveWorkspaceScope(unreadable, composition(), { kind: 'component', componentId: 'content' }).unknown)
      .toEqual([expect.objectContaining({ reason: 'unreadable' })]);

    const ambiguous = [...folders(), { name: 'Content copy', fsPath: elsewhere('content') }];
    expect(resolveWorkspaceScope(ambiguous, composition(), { kind: 'component', componentId: 'content' }).unknown)
      .toEqual([expect.objectContaining({ reason: 'ambiguous' })]);
  });

  it('returns no scope when no workspace exists or composition was not declared', () => {
    expect(resolveWorkspaceScope([]).complete).toBe(false);
    expect(resolveWorkspaceScope(folders(), undefined, { kind: 'all' })).toMatchObject({
      label: 'Composition not declared', roots: [], complete: false,
    });
  });
});

describe('defaultWorkspaceFolderOf', () => {
  it('is exactly the first element, for any list, and is the rule the default scope uses', () => {
    const folderArb = fc.record({ name: fc.string({ maxLength: 10 }), fsPath: fc.string({ maxLength: 20 }) });
    fc.assert(fc.property(fc.array(folderArb, { maxLength: 6 }), list => {
      expect(defaultWorkspaceFolderOf(list)).toBe(list[0]);
      const scope = resolveWorkspaceScope(list);
      expect(scope.label).toBe(list[0]?.name ?? 'No workspace');
      expect(scope.roots).toEqual(list[0] ? [{ name: list[0].name, fsPath: list[0].fsPath }] : []);
    }));
  });

  it('anchors a "." component to the first folder when no anchor is given — the pre-A2 behaviour, still the default', () => {
    const single = sanitizeProjectComposition({
      components: [
        { id: 'root', label: 'Root', location: '.', role: 'application', archetype: { archetype: 'generic', traits: [] }, vcs: 'git', home: true },
      ],
    })!;
    expect(resolveWorkspaceScope(folders(), single, { kind: 'home' }).roots.map(root => root.name)).toEqual(['Gameplay']);
    expect(resolveWorkspaceScope([], single, { kind: 'home' }).unknown).toEqual([expect.objectContaining({ reason: 'not-open' })]);
  });
});

/** A one-component composition whose home sits at `.` — the folder it was read from. */
const homeHere = (): ProjectComposition => sanitizeProjectComposition({
  components: [
    { id: 'root', label: 'Root', location: '.', role: 'application', archetype: { archetype: 'generic', traits: [] }, vcs: 'git', home: true },
  ],
})!;

/** A composition read from one folder that places its home in another, named `elsewhere`. */
const homeElsewhere = (): ProjectComposition => sanitizeProjectComposition({
  components: [
    { id: 'tools', label: 'Tools', location: '.', role: 'tools', archetype: { archetype: 'cli', traits: [] }, vcs: 'git' },
    { id: 'game', label: 'Game', location: 'elsewhere', role: 'application', archetype: { archetype: 'game', traits: [] }, vcs: 'git', home: true },
  ],
})!;

const three = (): WorkspaceFolderReference[] => [
  { name: 'Tools', fsPath: at('tools') },
  { name: 'Game', fsPath: at('game') },
  { name: 'Assets', fsPath: at('assets') },
];

/** Probes keyed by folder name; a folder not listed holds nothing. */
const probesFrom = (byName: Record<string, SsotHomeProbe>) => (folder: WorkspaceFolderReference): SsotHomeProbe =>
  byName[folder.name] ?? { ssotPresent: false };

describe('a "." component resolves against its anchor, not against folder 0', () => {
  it('places "." in the anchor folder — the bug A2 fixes: a home that is not folder 0 could not find itself', () => {
    const scope = resolveWorkspaceScope(three(), homeHere(), { kind: 'home' }, { anchorFsPath: at('game') });
    expect(scope.roots).toEqual([expect.objectContaining({ name: 'Game', fsPath: at('game'), componentId: 'root' })]);
    expect(scope.complete).toBe(true);
  });

  it('reports "." as not open when the anchor is not among the folders, rather than falling back to the first', () => {
    const scope = resolveWorkspaceScope(three(), homeHere(), { kind: 'home' }, { anchorFsPath: at('gone') });
    expect(scope.roots).toEqual([]);
    expect(scope.unknown).toEqual([expect.objectContaining({ componentId: 'root', reason: 'not-open' })]);
  });

  it('is byte-identical to the unanchored answer whenever the anchor is folder 0', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 3 }), count => {
      const list = three().slice(0, count);
      expect(resolveWorkspaceScope(list, homeHere(), { kind: 'all' }, { anchorFsPath: list[0]!.fsPath }))
        .toEqual(resolveWorkspaceScope(list, homeHere(), { kind: 'all' }));
    }));
  });

  it('never consults the anchor on the default branch', () => {
    expect(resolveWorkspaceScope(three(), homeHere(), { kind: 'default' }, { anchorFsPath: at('game') }).roots)
      .toEqual([{ name: 'Tools', fsPath: at('tools') }]);
  });
});

describe('SSOT_HOME_RULES — the declared table', () => {
  it('is in the order that is the policy, each rule with a sentence', () => {
    expect(SSOT_HOME_RULES.map(rule => rule.id)).toEqual([
      'no-folder', 'single-root', 'declared-home', 'ambiguous', 'sole-ssot', 'no-ssot-first-folder',
    ]);
    for (const rule of SSOT_HOME_RULES) {
      expect(rule.statement.length).toBeGreaterThan(20);
    }
  });

  it('is exhaustive: the last rule applies to anything that reaches it', () => {
    const last = SSOT_HOME_RULES[SSOT_HOME_RULES.length - 1]!;
    expect(last.applies({ folders: three(), declared: [], withSsot: [] })).toBe(true);
  });

  it('reaches every rule, and each result carries the sentence of the rule that decided it', () => {
    const cases = {
      'no-folder': locateSsotHome([], () => undefined),
      'single-root': locateSsotHome(three().slice(0, 1), () => undefined),
      'declared-home': locateSsotHome(three(), probesFrom({
        Game: { ssotPresent: true, composition: homeHere() },
        Assets: { ssotPresent: true },
      })),
      ambiguous: locateSsotHome(three(), probesFrom({ Game: { ssotPresent: true }, Assets: { ssotPresent: true } })),
      'sole-ssot': locateSsotHome(three(), probesFrom({ Assets: { ssotPresent: true } })),
      'no-ssot-first-folder': locateSsotHome(three(), probesFrom({})),
    } as const;
    for (const [id, result] of Object.entries(cases)) {
      expect(result.rule).toBe(id);
      expect(result.statement).toBe(SSOT_HOME_RULES.find(rule => rule.id === id)!.statement);
    }
    expect(cases['declared-home'].home?.name).toBe('Game');
    expect(cases['sole-ssot'].home?.name).toBe('Assets');
    expect(cases['no-ssot-first-folder'].home?.name).toBe('Tools');
    expect(cases.ambiguous.home).toBeUndefined();
    expect(cases['no-folder'].home).toBeUndefined();
  });
});

describe('locateSsotHome', () => {
  it('lets one declaration settle what two memory folders would leave ambiguous', () => {
    const result = locateSsotHome(three(), probesFrom({
      Tools: { ssotPresent: true },
      Game: { ssotPresent: true, composition: homeHere() },
    }));
    expect(result).toMatchObject({ rule: 'declared-home', home: { name: 'Game' } });
  });

  it('refuses to choose between two declarations, naming both', () => {
    const result = locateSsotHome(three(), probesFrom({
      Tools: { ssotPresent: true, composition: homeHere() },
      Game: { ssotPresent: true, composition: homeHere() },
    }));
    expect(result.rule).toBe('ambiguous');
    expect(result.ambiguity).toBe('declared-home');
    expect(result.candidates.map(folder => folder.name)).toEqual(['Tools', 'Game']);
    expect(result.home).toBeUndefined();
  });

  it('does not count a composition that places its home in a different folder as a declaration of this one', () => {
    // Tools holds a workflow.json naming "elsewhere" as home; it is not the home
    // by its own account, so only the memory folders decide.
    const result = locateSsotHome(three(), probesFrom({
      Tools: { ssotPresent: true, composition: homeElsewhere() },
    }));
    expect(result).toMatchObject({ rule: 'sole-ssot', home: { name: 'Tools' } });
  });

  it('never probes a single folder, an unreadable one, or anything past the cap', () => {
    const seen: string[] = [];
    const probe = (folder: WorkspaceFolderReference): SsotHomeProbe => {
      seen.push(folder.name);
      return { ssotPresent: false };
    };
    locateSsotHome([{ name: 'Only', fsPath: at('only') }], probe);
    expect(seen).toEqual([]);

    const withVirtual = [...three(), { name: 'Virtual', fsPath: at('virtual'), readable: false }];
    const result = locateSsotHome(withVirtual, probe);
    expect(seen).toEqual(['Tools', 'Game', 'Assets']);
    expect(result.unprobed.map(folder => folder.name)).toEqual(['Virtual']);

    seen.length = 0;
    const many = Array.from({ length: SSOT_HOME_MAX_PROBED_FOLDERS + 3 }, (_, index) => ({ name: `f${index}`, fsPath: at(`f${index}`) }));
    const capped = locateSsotHome(many, probe);
    expect(seen).toHaveLength(SSOT_HOME_MAX_PROBED_FOLDERS);
    expect(capped.unprobed).toHaveLength(3);
  });

  it('reports a folder nobody could look inside rather than reading it as empty', () => {
    const result = locateSsotHome(three(), probesFrom({ Game: { ssotPresent: undefined } }));
    expect(result.rule).toBe('no-ssot-first-folder');
    expect(result.unprobed.map(folder => folder.name)).toEqual(['Game']);
  });
});

describe('locateSsotHome — properties', () => {
  type Spec = { ssotPresent: boolean | undefined; declares: 'none' | 'here' | 'elsewhere' };
  const folderListArb = fc.integer({ min: 0, max: 6 }).map(count =>
    Array.from({ length: count }, (_, index): WorkspaceFolderReference => ({ name: `F${index}`, fsPath: at(`f${index}`) })));
  const specArb: fc.Arbitrary<Spec> = fc.record({
    ssotPresent: fc.constantFrom<boolean | undefined>(true, false, undefined),
    declares: fc.constantFrom<Spec['declares']>('none', 'here', 'elsewhere'),
  });
  const scenarioArb = folderListArb.chain(list => fc.tuple(
    fc.constant(list),
    fc.array(specArb, { minLength: list.length, maxLength: list.length }),
  ));
  const probeFor = (list: readonly WorkspaceFolderReference[], specs: readonly Spec[]) =>
    (folder: WorkspaceFolderReference): SsotHomeProbe => {
      const spec = specs[list.indexOf(folder)]!;
      const composition = spec.declares === 'here' ? homeHere() : spec.declares === 'elsewhere' ? homeElsewhere() : undefined;
      return { ssotPresent: spec.ssotPresent, ...(composition ? { composition } : {}) };
    };

  it('is deterministic, and never returns a home that does not satisfy the rule that named it', () => {
    fc.assert(fc.property(scenarioArb, ([list, specs]) => {
      const probe = probeFor(list, specs);
      const result = locateSsotHome(list, probe);
      expect(locateSsotHome(list, probe)).toEqual(result);

      if (result.home) {
        expect(list).toContain(result.home);
      }
      const spec = (folder: WorkspaceFolderReference): Spec => specs[list.indexOf(folder)]!;
      switch (result.rule) {
        case 'no-folder':
          expect(list).toHaveLength(0);
          expect(result.home).toBeUndefined();
          break;
        case 'single-root':
          expect(list).toHaveLength(1);
          expect(result.home).toBe(list[0]);
          break;
        case 'declared-home':
          expect(spec(result.home!).declares).toBe('here');
          expect(list.filter(folder => spec(folder).declares === 'here')).toHaveLength(1);
          break;
        case 'sole-ssot':
          expect(spec(result.home!).ssotPresent).toBe(true);
          expect(list.filter(folder => spec(folder).ssotPresent === true)).toHaveLength(1);
          expect(list.some(folder => spec(folder).declares === 'here')).toBe(false);
          break;
        case 'no-ssot-first-folder':
          expect(result.home).toBe(list[0]);
          expect(list.some(folder => spec(folder).ssotPresent === true || spec(folder).declares === 'here')).toBe(false);
          break;
        case 'ambiguous':
          expect(result.home).toBeUndefined();
          expect(result.candidates.length).toBeGreaterThan(1);
          expect(describeSsotHomeRefusal(result)).toBeDefined();
          break;
      }
    }), { numRuns: 300 });
  });

  it('answers a single folder with that folder, whatever is or is not inside it', () => {
    fc.assert(fc.property(specArb, spec => {
      const only = [{ name: 'Only', fsPath: at('only') }];
      const result = locateSsotHome(only, probeFor(only, [spec]));
      expect(result.rule).toBe('single-root');
      expect(result.home).toBe(only[0]);
      expect(describeSsotHomeRefusal(result)).toBeUndefined();
    }));
  });

  it('changes nothing where folder 0 is the home: it holds the memory and nothing competes', () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 6 }), fc.boolean(), (count, declared) => {
      const list = Array.from({ length: count }, (_, index) => ({ name: `F${index}`, fsPath: at(`f${index}`) }));
      const result = locateSsotHome(list, folder => folder === list[0]
        ? { ssotPresent: true, ...(declared ? { composition: homeHere() } : {}) }
        : { ssotPresent: false });
      expect(result.home).toBe(defaultWorkspaceFolderOf(list));
    }));
  });
});

describe('describeSsotHomeRefusal', () => {
  it('names every candidate and the way out, and says nothing for a located home', () => {
    const ssot = locateSsotHome(three(), probesFrom({
      Tools: { ssotPresent: true }, Game: { ssotPresent: true }, Assets: { ssotPresent: true },
    }));
    const text = describeSsotHomeRefusal(ssot, 'docs/memory')!;
    expect(text).toContain('"Tools", "Game" and "Assets"');
    expect(text).toContain('docs/memory/operations/workflow.json');
    expect(text).toMatch(/will not load or write project memory/);

    const declared = locateSsotHome(three(), probesFrom({
      Tools: { ssotPresent: true, composition: homeHere() }, Game: { ssotPresent: true, composition: homeHere() },
    }));
    expect(describeSsotHomeRefusal(declared)).toMatch(/"Tools" and "Game" each declare themselves the home/);

    expect(describeSsotHomeRefusal(locateSsotHome(three(), probesFrom({ Game: { ssotPresent: true } })))).toBeUndefined();
  });
});
