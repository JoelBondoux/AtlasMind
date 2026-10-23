import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildSeedGameProfile,
  findForbiddenGameProfileContent,
  GAME_DISCIPLINES,
  GAME_PLATFORMS,
  GAME_PROFILE_FORBIDDEN_RULES,
  GAME_PROFILE_LIMITS,
  GAME_PROFILE_SSOT_PATH,
  GAME_PROFILE_SUMMARY_SSOT_PATH,
  GAME_STORES,
  GameProfileManager,
  renderGameProfileMarkdown,
  sanitizeGameProfile,
  serializeGameProfile,
  validateGameProfile,
  type GameProfile,
} from '../../src/core/gameProfile.ts';
import { buildGameProjectComposition, GAME_COMPOSITION_PRESET_IDS } from '../../src/core/projectComposition.ts';
import { SsotHomeRefusalError } from '../../src/core/workspaceScope.ts';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-game-profile-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function freshRoot(): string {
  counter += 1;
  const dir = path.join(scratch, `root-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProfileFile(root: string, content: string, rel = GAME_PROFILE_SSOT_PATH): string {
  const file = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  return file;
}

const AT = new Date('2026-10-08T12:00:00.000Z');

/** A profile declaring every field, written the way a team would write it. */
function fullProfile(): GameProfile {
  return {
    version: 1,
    engine: { engine: 'unreal', version: '5.8' },
    platformTargets: [
      { platform: 'windows' },
      { platform: 'linux', label: 'Steam Deck' },
      { platform: 'console', label: 'Living-room console' },
    ],
    buildConfigurations: [{ id: 'Development' }, { id: 'Shipping', label: 'Store build' }],
    performanceBudgets: [
      { platform: 'windows', frameTimeMs: 16.6, memoryMb: 8192 },
      { platform: 'console', label: 'Living-room console', loadTimeS: 20 },
    ],
    contentRoots: [{ location: 'Content' }, { componentId: 'content', location: 'Art/Source' }],
    disciplineOwnership: [
      { discipline: 'technical-art', owners: ['@mira'] },
      { discipline: 'audio', owners: ['sam', '@lee'] },
    ],
    storeTargets: [{ store: 'steam' }, { store: 'itch', label: 'Demo' }],
  };
}

describe('sanitizeGameProfile — a valid profile passes through exactly', () => {
  it('keeps every declared field as written, with no findings', () => {
    const reading = sanitizeGameProfile(fullProfile());
    expect(reading.status).toBe('ok');
    expect(reading.findings).toEqual([]);
    expect(reading.profile).toEqual(fullProfile());
  });

  it('adds only `version` to input that lacks one, and nothing for an absent field', () => {
    const reading = sanitizeGameProfile({ storeTargets: [] });
    expect(reading.profile).toEqual({ version: 1, storeTargets: [] });
    expect(reading.profile).not.toHaveProperty('platformTargets');
  });

  it('is not an object → invalid, with no profile', () => {
    for (const input of [null, 'game', 3, ['a']]) {
      const reading = sanitizeGameProfile(input);
      expect(reading.status).toBe('invalid');
      expect(reading.profile).toBeUndefined();
    }
  });
});

describe('an invalid value is a finding, never a repair', () => {
  it.each([
    ['a negative budget', { performanceBudgets: [{ platform: 'windows', frameTimeMs: -1 }] }, 'budget-value', 'performanceBudgets[0].frameTimeMs'],
    ['a zero budget', { performanceBudgets: [{ platform: 'windows', memoryMb: 0 }] }, 'budget-value', 'performanceBudgets[0].memoryMb'],
    ['a budget written as text', { performanceBudgets: [{ platform: 'windows', frameTimeMs: '16.6' }] }, 'budget-value', 'performanceBudgets[0].frameTimeMs'],
    ['an infinite budget', { performanceBudgets: [{ platform: 'windows', loadTimeS: Number.POSITIVE_INFINITY }] }, 'budget-value', 'performanceBudgets[0].loadTimeS'],
    ['a budget with no metric', { performanceBudgets: [{ platform: 'windows' }] }, 'budget-empty', 'performanceBudgets[0]'],
    ['an unknown platform', { platformTargets: [{ platform: 'switch' }] }, 'platform', 'platformTargets[0]'],
    ['a console with no label', { platformTargets: [{ platform: 'console' }] }, 'console-label', 'platformTargets[0]'],
    ['a label with surrounding space', { platformTargets: [{ platform: 'web', label: ' Browser ' }] }, 'label', 'platformTargets[0].label'],
    ['a build configuration id with a space', { buildConfigurations: [{ id: 'Dev Build' }] }, 'build-configuration-id', 'buildConfigurations[0].id'],
    ['a content root the normaliser would rewrite', { contentRoots: [{ location: './Content' }] }, 'content-root-location', 'contentRoots[0].location'],
    ['a content root with backslashes', { contentRoots: [{ location: 'Art\\Source' }] }, 'content-root-location', 'contentRoots[0].location'],
    ['a content root that climbs out', { contentRoots: [{ location: '../shared' }] }, 'content-root-location', 'contentRoots[0].location'],
    ['an unknown discipline', { disciplineOwnership: [{ discipline: 'vibes', owners: ['@a'] }] }, 'discipline', 'disciplineOwnership[0].discipline'],
    ['a discipline owned by nobody', { disciplineOwnership: [{ discipline: 'art', owners: [] }] }, 'owners', 'disciplineOwnership[0].owners'],
    ['an owner given as an address', { disciplineOwnership: [{ discipline: 'art', owners: ['mira@example.com'] }] }, 'owner-handle', 'disciplineOwnership[0].owners'],
    ['an unknown store', { storeTargets: [{ store: 'console-store' }] }, 'store', 'storeTargets[0].store'],
    ['an unknown engine', { engine: { engine: 'cryengine' } }, 'engine', 'engine'],
    ['an `unknown` engine carrying a version', { engine: { engine: 'unknown', version: '5.8' } }, 'engine', 'engine'],
    ['a list that is not a list', { platformTargets: 'windows' }, 'platformTargets-shape', 'platformTargets'],
  ])('%s', (_name, input, rule, at) => {
    const reading = sanitizeGameProfile(input);
    expect(reading.status).toBe('ok');
    expect(reading.findings).toEqual([expect.objectContaining({ kind: 'invalid', rule, path: at })]);
    // Left out, not corrected: no entry for the invalid value survives in any form.
    const [field] = Object.keys(input);
    const kept = reading.profile?.[field!];
    expect(Array.isArray(kept) ? kept : kept === undefined ? [] : [kept]).toEqual([]);
  });

  it('keeps the valid entries beside an invalid one', () => {
    const reading = sanitizeGameProfile({ platformTargets: [{ platform: 'windows' }, { platform: 'switch' }, { platform: 'web' }] });
    expect(reading.profile?.platformTargets).toEqual([{ platform: 'windows' }, { platform: 'web' }]);
    expect(reading.findings).toHaveLength(1);
  });

  it('refuses a duplicate rather than merging it, keeping the first', () => {
    const reading = sanitizeGameProfile({
      platformTargets: [
        { platform: 'console', label: 'Box' },
        { platform: 'console', label: 'box' },
        { platform: 'console', label: 'Other box' },
      ],
    });
    expect(reading.profile?.platformTargets).toEqual([
      { platform: 'console', label: 'Box' },
      { platform: 'console', label: 'Other box' },
    ]);
    expect(reading.findings.map(finding => finding.rule)).toEqual(['platformTargets-duplicate']);
  });

  it('leaves a list over its bound out whole, rather than truncating it', () => {
    const many = Array.from({ length: GAME_PROFILE_LIMITS.buildConfigurations + 1 }, (_, index) => ({ id: `Config${index}` }));
    const reading = sanitizeGameProfile({ buildConfigurations: many });
    expect(reading.profile).not.toHaveProperty('buildConfigurations');
    expect(reading.findings.map(finding => finding.rule)).toEqual(['buildConfigurations-bound']);
  });

  it('refuses a document over its bounds as invalid', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let depth = 0; depth < GAME_PROFILE_LIMITS.documentDepth + 2; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor['nested'] = next;
      cursor = next;
    }
    expect(sanitizeGameProfile(deep).status).toBe('invalid');
    expect(sanitizeGameProfile({ note: 'x'.repeat(GAME_PROFILE_LIMITS.stringChars + 1) }).status).toBe('invalid');
  });
});

describe('GAME_PROFILE_FORBIDDEN_RULES — refused, never redacted', () => {
  const cases: ReadonlyArray<[string, Record<string, unknown>, string, string]> = [
    ['a Windows absolute path', { contentRootsNote: 'C:\\Projects\\Game\\Content' }, 'absolute-path', 'contentRootsNote'],
    ['a POSIX absolute path in a label', { platformTargets: [{ platform: 'linux', label: '/opt/game' }] }, 'absolute-path', 'platformTargets[0].label'],
    ['a home-relative path', { future: { location: '~/game' } }, 'absolute-path', 'future.location'],
    ['an environment-variable path', { future: '%ProgramFiles%\\Game' }, 'absolute-path', 'future'],
    ['an API key field', { storeTargets: [{ store: 'steam', steamApiKey: 'abc' }] }, 'secret-shaped-key', 'storeTargets[0].steamApiKey'],
    ['a signing keystore field', { signing: { keystorePassword: 'x' } }, 'secret-shaped-key', 'signing.keystorePassword'],
    ['a store token field', { itchToken: 'abc' }, 'secret-shaped-key', 'itchToken'],
    ['a console SDK path field', { platformTargets: [{ platform: 'console', label: 'Box', sdkPath: 'tools/sdk' }] }, 'sdk-or-engine-binary-path', 'platformTargets[0].sdkPath'],
    ['an engine path field', { enginePath: 'engine' }, 'sdk-or-engine-binary-path', 'enginePath'],
    ['an engine binary by name', { future: 'Engine/Binaries/Win64/UnrealEditor-Cmd' }, 'sdk-or-engine-binary-path', 'future'],
    ['an executable', { future: 'tools/build.exe' }, 'sdk-or-engine-binary-path', 'future'],
    ['RunUAT', { buildConfigurations: [{ id: 'Shipping', label: 'RunUAT BuildCookRun' }] }, 'sdk-or-engine-binary-path', 'buildConfigurations[0].label'],
    ['a GitHub token in a label', { storeTargets: [{ store: 'itch', label: `ghp_${'a'.repeat(36)}` }] }, 'would-be-redacted', 'storeTargets[0].label'],
    ['a provider key in an unknown field', { notes: `sk-ant-api03-${'b'.repeat(30)}` }, 'would-be-redacted', 'notes'],
  ];

  it.each(cases)('%s refuses the whole document', (_name, input, rule, at) => {
    const reading = sanitizeGameProfile({ ...fullProfile(), ...input });
    expect(reading.status).toBe('refused');
    expect(reading.profile).toBeUndefined();
    expect(reading.findings).toContainEqual(expect.objectContaining({ kind: 'forbidden', rule, path: at }));
  });

  it('exercises every declared rule', () => {
    expect(new Set(cases.map(([, , rule]) => rule))).toEqual(new Set(GAME_PROFILE_FORBIDDEN_RULES.map(rule => rule.id)));
  });

  it('never echoes the refused value in a finding', () => {
    const secret = `ghp_${'z'.repeat(36)}`;
    const findings = findForbiddenGameProfileContent({ storeTargets: [{ store: 'steam', label: secret }], 'C:\\absolute': 1 });
    expect(findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it('allows a secret reference, and a label that merely mentions an SDK', () => {
    const reading = sanitizeGameProfile({
      ...fullProfile(),
      storeTargets: [{ store: 'steam', steamSecretRef: 'atlasmind.steam.partner' }],
      platformTargets: [{ platform: 'console', label: 'Console SDK build' }],
    });
    expect(reading.status).toBe('ok');
    expect(reading.findings).toEqual([]);
  });

  it('keeps a hostile __proto__ key an ordinary field', () => {
    const reading = sanitizeGameProfile(JSON.parse('{"__proto__": {"polluted": true}, "storeTargets": []}'));
    expect(reading.status).toBe('ok');
    expect(Object.getPrototypeOf(reading.profile)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('validateGameProfile — unresolved is reported, never dropped', () => {
  it('resolves content roots against the declared composition', () => {
    const profile = sanitizeGameProfile({
      contentRoots: [{ location: 'Content' }, { componentId: 'content', location: '.' }, { componentId: 'audio-depot', location: 'Wwise' }],
    }).profile!;
    const findings = validateGameProfile(profile, { composition: buildGameProjectComposition('hybrid-git-perforce') });
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'unresolved', rule: 'content-root-component-undeclared', path: 'contentRoots[2].componentId' }),
    ]);
    expect(profile.contentRoots).toHaveLength(3);
  });

  it('with no composition, only the implicit home resolves', () => {
    const profile = sanitizeGameProfile({ contentRoots: [{ location: 'Assets' }, { componentId: 'content', location: '.' }] }).profile!;
    expect(validateGameProfile(profile)).toEqual([
      expect.objectContaining({ kind: 'unresolved', rule: 'content-root-no-composition', path: 'contentRoots[1].componentId' }),
    ]);
  });

  it('reports a budget for a target the profile does not declare', () => {
    const profile = sanitizeGameProfile({
      platformTargets: [{ platform: 'windows' }],
      performanceBudgets: [{ platform: 'windows', frameTimeMs: 16 }, { platform: 'android', memoryMb: 3000 }],
    }).profile!;
    expect(validateGameProfile(profile).map(finding => finding.path)).toEqual(['performanceBudgets[1]']);
    expect(profile.performanceBudgets).toHaveLength(2);
  });
});

describe('properties', () => {
  const label = fc.string({ maxLength: 12 });
  const entryWithUnknowns = <T extends Record<string, fc.Arbitrary<unknown>>>(shape: T) =>
    fc.record({ ...shape, futureField: fc.jsonValue({ maxDepth: 2 }) }, { requiredKeys: [] });
  const list = (entry: fc.Arbitrary<unknown>) => fc.oneof(fc.array(entry, { maxLength: 6 }), fc.jsonValue({ maxDepth: 2 }));
  const profileLike = fc.record({
    version: fc.oneof(fc.constant(1), fc.jsonValue({ maxDepth: 1 })),
    engine: fc.oneof(
      fc.record({ engine: fc.constantFrom('unreal', 'unity', 'godot', 'custom', 'unknown', 'other'), version: fc.constantFrom('5.8', '4.6', ' bad ') }, { requiredKeys: ['engine'] }),
      fc.jsonValue({ maxDepth: 1 }),
    ),
    platformTargets: list(entryWithUnknowns({ platform: fc.oneof(fc.constantFrom(...GAME_PLATFORMS), fc.string()), label })),
    buildConfigurations: list(entryWithUnknowns({ id: fc.oneof(fc.constantFrom('Development', 'Shipping', 'dev'), fc.string()), label })),
    performanceBudgets: list(entryWithUnknowns({
      platform: fc.constantFrom(...GAME_PLATFORMS),
      label,
      frameTimeMs: fc.oneof(fc.double(), fc.integer()),
      memoryMb: fc.oneof(fc.double(), fc.string()),
    })),
    contentRoots: list(entryWithUnknowns({ componentId: fc.constantFrom('content', 'Bad Id', 'engine'), location: fc.constantFrom('Content', './x', 'a/b', '', '..') })),
    disciplineOwnership: list(entryWithUnknowns({
      discipline: fc.oneof(fc.constantFrom(...GAME_DISCIPLINES), fc.string()),
      owners: fc.array(fc.oneof(fc.constantFrom('@a', 'b', 'c@d.e'), fc.string()), { maxLength: 10 }),
    })),
    storeTargets: list(entryWithUnknowns({ store: fc.oneof(fc.constantFrom(...GAME_STORES), fc.string()), label })),
    updatedAt: fc.oneof(fc.constant('2026-10-08T00:00:00.000Z'), fc.string()),
    somethingNewer: fc.jsonValue({ maxDepth: 2 }),
  }, { requiredKeys: [] });

  it('is idempotent', () => {
    fc.assert(fc.property(profileLike, input => {
      const first = sanitizeGameProfile(input);
      if (!first.profile) {
        return;
      }
      const second = sanitizeGameProfile(first.profile);
      expect(second.status).toBe('ok');
      expect(second.profile).toEqual(first.profile);
      expect(second.findings).toEqual([]);
    }), { numRuns: 300 });
  });

  it('never adds a field the input did not have (version aside)', () => {
    fc.assert(fc.property(profileLike, input => {
      const { profile } = sanitizeGameProfile(input);
      if (!profile) {
        return;
      }
      const source = input as Record<string, unknown>;
      for (const key of Object.keys(profile)) {
        if (key !== 'version') {
          expect(Object.prototype.hasOwnProperty.call(source, key)).toBe(true);
        }
      }
      for (const field of ['platformTargets', 'buildConfigurations', 'performanceBudgets', 'contentRoots', 'disciplineOwnership', 'storeTargets'] as const) {
        for (const entry of profile[field] ?? []) {
          expect(source[field] as unknown[]).toContainEqual(entry);
        }
      }
      if (profile.engine) {
        expect(profile.engine).toEqual(source['engine']);
      }
    }), { numRuns: 300 });
  });
});

describe('the mirror', () => {
  it('says not declared, declared none, and a dash for an undeclared metric — never a zero', () => {
    const markdown = renderGameProfileMarkdown({
      version: 1,
      storeTargets: [],
      performanceBudgets: [{ platform: 'windows', frameTimeMs: 16.6 }],
    });
    expect(markdown).toContain('## Platform targets\n\n_Not declared._');
    expect(markdown).toContain('## Store targets\n\n_Declared: none._');
    expect(markdown).toContain('| windows | 16.6 ms | — | — |');
    expect(markdown).not.toMatch(/\b0 (?:ms|MB|s)\b/u);
  });

  it('escapes backslashes before pipes, so a label cannot un-escape a cell boundary', () => {
    const markdown = renderGameProfileMarkdown({
      version: 1,
      platformTargets: [{ platform: 'console', label: 'Dev\\|Kit' }],
      performanceBudgets: [{ platform: 'console', label: 'Dev\\|Kit', frameTimeMs: 33 }],
    });
    expect(markdown).toContain('| console — Dev\\\\\\|Kit | 33 ms |');
  });

  it('names fields this build does not recognise, by key only', () => {
    const markdown = renderGameProfileMarkdown({ version: 1, cookProfile: { tier: 'high' } });
    expect(markdown).toContain('`cookProfile`');
    expect(markdown).not.toContain('high');
  });
});

describe('buildSeedGameProfile', () => {
  it.each(GAME_COMPOSITION_PRESET_IDS)('%s seeds a valid profile with an unknown engine that resolves against its own composition', preset => {
    const seed = buildSeedGameProfile(preset);
    expect(seed.engine).toEqual({ engine: 'unknown' });
    const reading = sanitizeGameProfile(seed);
    expect(reading).toEqual({ status: 'ok', profile: seed, findings: [] });
    expect(validateGameProfile(seed, { composition: buildGameProjectComposition(preset) })).toEqual([]);
  });

  it('declares content roots only for the preset content components, and guesses none otherwise', () => {
    expect(buildSeedGameProfile('hybrid-git-perforce').contentRoots).toEqual([{ componentId: 'content', location: '.' }]);
    expect(buildSeedGameProfile('single-repo-indie')).not.toHaveProperty('contentRoots');
  });
});

describe('GameProfileManager', () => {
  it('round-trips a profile, unknown fields included, byte for byte', async () => {
    const root = freshRoot();
    const input = {
      ...fullProfile(),
      platformTargets: [{ platform: 'windows' as const, cookProfile: 'high' }],
      somethingNewer: { nested: [1, 2, 3] },
    };
    const manager = new GameProfileManager(root);
    const saved = await manager.save(input, { now: AT });
    expect(saved.updatedAt).toBe(AT.toISOString());

    const read = manager.read();
    expect(read.status).toBe('loaded');
    expect(read.findings).toEqual([]);
    expect(read.profile).toEqual(saved);
    expect(read.profile?.['somethingNewer']).toEqual({ nested: [1, 2, 3] });
    expect(read.profile?.platformTargets?.[0]?.['cookProfile']).toBe('high');

    await manager.save(read.profile, { now: AT });
    expect(readFileSync(path.join(root, ...GAME_PROFILE_SSOT_PATH.split('/')), 'utf8')).toBe(serializeGameProfile(saved));
    expect(readFileSync(path.join(root, ...GAME_PROFILE_SUMMARY_SSOT_PATH.split('/')), 'utf8')).toBe(renderGameProfileMarkdown(saved));
  });

  it('refuses a file from a newer AtlasMind: read says so, save refuses, seed keeps it', async () => {
    const root = freshRoot();
    const newer = `${JSON.stringify({ version: 2, engine: { engine: 'unreal' }, mystery: true })}\n`;
    const file = writeProfileFile(root, newer);
    const manager = new GameProfileManager(root);

    expect(manager.read()).toMatchObject({ status: 'newer' });
    expect(manager.read().profile).toBeUndefined();
    await expect(manager.save(buildSeedGameProfile('single-repo-indie'))).rejects.toThrow(/newer version of AtlasMind/u);
    await expect(manager.seed(buildSeedGameProfile('single-repo-indie'))).resolves.toBe('kept-existing');
    expect(readFileSync(file, 'utf8')).toBe(newer);
  });

  it('lets an explicit save replace a newer file only when told to', async () => {
    const root = freshRoot();
    writeProfileFile(root, JSON.stringify({ version: 9 }));
    const manager = new GameProfileManager(root);
    await manager.save(buildSeedGameProfile('single-repo-indie'), { now: AT, replaceNewer: true });
    expect(manager.read().status).toBe('loaded');
  });

  it('seeds only where nothing exists — a corrupt file or a lone mirror is kept', async () => {
    const corruptRoot = freshRoot();
    const corrupt = writeProfileFile(corruptRoot, '{ not json');
    expect(new GameProfileManager(corruptRoot).read().status).toBe('unreadable');
    await expect(new GameProfileManager(corruptRoot).seed(buildSeedGameProfile('single-repo-indie'))).resolves.toBe('kept-existing');
    expect(readFileSync(corrupt, 'utf8')).toBe('{ not json');

    const mirrorRoot = freshRoot();
    writeProfileFile(mirrorRoot, '# hand-written', GAME_PROFILE_SUMMARY_SSOT_PATH);
    await expect(new GameProfileManager(mirrorRoot).seed(buildSeedGameProfile('single-repo-indie'))).resolves.toBe('kept-existing');
    expect(existsSync(path.join(mirrorRoot, ...GAME_PROFILE_SSOT_PATH.split('/')))).toBe(false);

    const emptyRoot = freshRoot();
    await expect(new GameProfileManager(emptyRoot).seed(buildSeedGameProfile('hybrid-git-perforce'), { now: AT })).resolves.toBe('seeded');
    expect(new GameProfileManager(emptyRoot).read()).toMatchObject({ status: 'loaded', findings: [] });
  });

  it('refuses invalid or forbidden input whole and writes nothing', async () => {
    const root = freshRoot();
    const manager = new GameProfileManager(root);
    await expect(manager.save({ performanceBudgets: [{ platform: 'windows', frameTimeMs: -16 }] })).rejects.toThrow(/budget-value/u);
    await expect(manager.save({ platformTargets: [{ platform: 'console', label: 'Box', sdkRoot: 'sdk' }] })).rejects.toThrow(/sdk-or-engine-binary-path/u);
    expect(manager.exists()).toBe(false);
  });

  it('reads a file holding forbidden content as refused, with no profile', () => {
    const root = freshRoot();
    writeProfileFile(root, JSON.stringify({ version: 1, steamApiKey: 'abc' }));
    const read = new GameProfileManager(root).read();
    expect(read.status).toBe('refused');
    expect(read.profile).toBeUndefined();
    expect(read.findings).toContainEqual(expect.objectContaining({ rule: 'secret-shaped-key', path: 'steamApiKey' }));
  });

  it('follows a configured SSOT folder, and falls back from one that escapes', async () => {
    const root = freshRoot();
    await new GameProfileManager(root, undefined, 'memory/ssot').save(buildSeedGameProfile('single-repo-indie'), { now: AT });
    expect(existsSync(path.join(root, 'memory', 'ssot', 'domain', 'game.json'))).toBe(true);
    expect(existsSync(path.join(root, 'project_memory'))).toBe(false);

    const escaping = freshRoot();
    await new GameProfileManager(escaping, undefined, '../elsewhere').save(buildSeedGameProfile('single-repo-indie'), { now: AT });
    expect(existsSync(path.join(escaping, ...GAME_PROFILE_SSOT_PATH.split('/')))).toBe(true);
  });

  it('bound to an ambiguous home, reads nothing and refuses every write', async () => {
    const root = freshRoot();
    writeProfileFile(root, serializeGameProfile(buildSeedGameProfile('single-repo-indie')));
    const sentence = 'Project memory has no single home.';
    const manager = new GameProfileManager(undefined, sentence);
    expect(manager.read()).toEqual({ status: 'no-home', findings: [], notice: sentence });
    await expect(manager.save(buildSeedGameProfile('single-repo-indie'))).rejects.toBeInstanceOf(SsotHomeRefusalError);
    await expect(manager.seed(buildSeedGameProfile('single-repo-indie'))).rejects.toThrow(sentence);
  });

  it('with no folder open, reads absent and refuses to save', async () => {
    const manager = new GameProfileManager(undefined);
    expect(manager.read().status).toBe('absent');
    await expect(manager.save(buildSeedGameProfile('single-repo-indie'))).rejects.toThrow(/Open a workspace folder/u);
  });
});


describe('declared fork-debt thresholds', () => {
  it('accepts explicit zero, preserves unknown entry fields, and mirrors declared metrics', () => {
    const source = { version: 1, forkDebtThresholds: [{ componentId: 'engine', metric: 'commitsBehind', maximum: 0, note: 'Deliberately current' }] };
    const result = sanitizeGameProfile(source);
    expect(result.profile?.forkDebtThresholds).toEqual(source.forkDebtThresholds);
    expect(renderGameProfileMarkdown(result.profile!)).toContain('commitsBehind');
    expect(renderGameProfileMarkdown(result.profile!)).toContain('Fork debt thresholds');
  });
  it.each([-1, 0.5, '10', Infinity])('refuses invalid threshold %s without inventing a default', maximum => {
    const result = sanitizeGameProfile({ version: 1, forkDebtThresholds: [{ componentId: 'engine', metric: 'commitsBehind', maximum }] });
    expect(result.findings.some(f => f.kind === 'invalid')).toBe(true);
  });
  it('reports a non-engine or undeclared target without dropping the policy', () => {
    const profile: GameProfile = { version: 1, forkDebtThresholds: [{ componentId: 'gameplay', metric: 'commitsBehind', maximum: 10 }] };
    expect(validateGameProfile(profile, { composition: buildGameProjectComposition('single-repo-indie') }).some(f => f.kind === 'unresolved')).toBe(true);
  });
});
