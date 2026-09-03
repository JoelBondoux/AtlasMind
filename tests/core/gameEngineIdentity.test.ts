import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GAME_ENGINES,
  GAME_ENGINE_IDENTITY_MAX_FILE_CHARS,
  GAME_ENGINE_IDENTITY_MAX_FILES,
  detectGameEngineIdentity,
  normalizeGameEngineDeclaration,
  selectEffectiveGameEngineIdentity,
} from '../../src/core/gameEngineIdentity.js';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'tests/fixtures/game-engines');
const fixture = (...segments: string[]): string =>
  readFileSync(path.join(FIXTURE_ROOT, ...segments), 'utf8');

describe('gameEngineIdentity', () => {
  it('keeps the engine vocabulary closed and honest', () => {
    expect(GAME_ENGINES).toEqual(['unreal', 'unity', 'godot', 'custom', 'unknown']);
  });

  it('reads the exact Unreal association from the root project file', () => {
    const result = detectGameEngineIdentity([
      { path: 'FixtureGame.uproject', content: fixture('unreal', 'FixtureGame.uproject') },
      { path: 'Config/DefaultEngine.ini', content: fixture('unreal', 'Config', 'DefaultEngine.ini') },
    ]);

    expect(result).toMatchObject({
      engine: 'unreal',
      version: '5.6',
      versionPrecision: 'source-exact',
      projectFile: 'FixtureGame.uproject',
      confident: true,
      surfaceVerification: { status: 'verified' },
    });
  });

  it('does not treat DefaultEngine.ini as decisive by itself', () => {
    expect(detectGameEngineIdentity([
      { path: 'Config/DefaultEngine.ini', content: '[/Script/EngineSettings.GameMapsSettings]' },
    ])).toMatchObject({ engine: 'unknown', confident: false });
  });

  it('keeps Unreal GUID and custom associations as an unknown version', () => {
    const result = detectGameEngineIdentity([{
      path: 'Fork.uproject',
      content: JSON.stringify({ FileVersion: 3, EngineAssociation: '{12345678-ABCD}' }),
    }]);

    expect(result).toMatchObject({
      engine: 'unreal',
      versionPrecision: 'unknown',
      confident: true,
      surfaceVerification: { status: 'version-unknown' },
    });
    expect(result).not.toHaveProperty('version');
  });

  it('reads Unity m_EditorVersion as the authoritative exact value', () => {
    expect(detectGameEngineIdentity([{
      path: 'ProjectSettings/ProjectVersion.txt',
      content: fixture('unity', 'ProjectSettings', 'ProjectVersion.txt'),
    }])).toMatchObject({
      engine: 'unity',
      version: '6000.0.34f1',
      versionPrecision: 'source-exact',
      confident: true,
      surfaceVerification: { status: 'verified' },
    });
  });

  it('names Unity but withholds a malformed or truncated version', () => {
    for (const evidence of [
      { path: 'ProjectSettings/ProjectVersion.txt', content: 'm_EditorVersion: latest' },
      { path: 'ProjectSettings/ProjectVersion.txt', content: 'm_EditorVersion: 6000.0.34f1', truncated: true },
      {
        path: 'ProjectSettings/ProjectVersion.txt',
        content: `m_EditorVersion: 6000.0.34f1${' '.repeat(GAME_ENGINE_IDENTITY_MAX_FILE_CHARS)}`,
      },
    ]) {
      const result = detectGameEngineIdentity([evidence]);
      expect(result).toMatchObject({
        engine: 'unity',
        versionPrecision: 'unknown',
        confident: true,
        surfaceVerification: { status: 'version-unknown' },
      });
      expect(result).not.toHaveProperty('version');
    }
  });

  it('reads Godot 4 from config/features and Godot 3 from its declared older format', () => {
    expect(detectGameEngineIdentity([{
      path: 'project.godot',
      content: fixture('godot-4', 'project.godot'),
    }])).toMatchObject({
      engine: 'godot',
      version: '4.3',
      versionPrecision: 'source-exact',
      surfaceVerification: { status: 'verified' },
    });
    expect(detectGameEngineIdentity([{
      path: 'project.godot',
      content: fixture('godot-3', 'project.godot'),
    }])).toMatchObject({
      engine: 'godot',
      version: '3',
      versionPrecision: 'major-family',
      surfaceVerification: { status: 'verified' },
    });
  });

  it('withholds Godot version when new-format evidence omits features', () => {
    const result = detectGameEngineIdentity([{
      path: 'project.godot',
      content: 'config_version=5\n[application]\nconfig/name="Broken"\n',
    }]);
    expect(result).toMatchObject({
      engine: 'godot',
      versionPrecision: 'unknown',
      surfaceVerification: { status: 'version-unknown' },
    });
    expect(result).not.toHaveProperty('version');
  });

  it('does not turn malformed or duplicate Godot format declarations into Godot 3', () => {
    for (const content of [
      'config_version=five\n',
      'config_version=4\nconfig_version=4\n',
    ]) {
      const result = detectGameEngineIdentity([{ path: 'project.godot', content }]);
      expect(result).toMatchObject({
        engine: 'godot',
        versionPrecision: 'unknown',
        surfaceVerification: { status: 'version-unknown' },
      });
      expect(result).not.toHaveProperty('version');
    }
  });

  it('returns unconfident unknown for no marker, nested markers, or conflicting families', () => {
    const cases = [
      [],
      [{ path: 'examples/Example.uproject', content: '{}' }],
      [
        { path: 'Game.uproject', content: '{"EngineAssociation":"5.6"}' },
        { path: 'project.godot', content: 'config_version=4' },
      ],
    ];
    for (const evidence of cases) {
      expect(detectGameEngineIdentity(evidence)).toMatchObject({
        engine: 'unknown',
        versionPrecision: 'unknown',
        confident: false,
      });
    }
  });

  it('identifies Unreal but withholds a version when multiple root projects compete', () => {
    const result = detectGameEngineIdentity([
      { path: 'One.uproject', content: '{"EngineAssociation":"5.6"}' },
      { path: 'Two.uproject', content: '{"EngineAssociation":"5.6"}' },
    ]);
    expect(result).toMatchObject({
      engine: 'unreal',
      versionPrecision: 'unknown',
      confident: true,
      surfaceVerification: { status: 'version-unknown' },
    });
    expect(result).not.toHaveProperty('version');
  });

  it('refuses invalid, conflicting, and over-bound evidence inventories', () => {
    const tooMany = Array.from({ length: GAME_ENGINE_IDENTITY_MAX_FILES + 1 }, (_, index) => ({
      path: `file-${index}.txt`,
      content: '',
    }));
    const cases: unknown[] = [
      undefined,
      [{ path: '../Game.uproject', content: '{}' }],
      [
        { path: 'Game.uproject', content: '{"EngineAssociation":"5.6"}' },
        { path: 'game.uproject', content: '{"EngineAssociation":"5.7"}' },
      ],
      tooMany,
    ];
    for (const evidence of cases) {
      expect(detectGameEngineIdentity(evidence)).toMatchObject({ engine: 'unknown', confident: false });
    }
  });

  it('preserves a newer version but marks its surfaces unverified', () => {
    const result = detectGameEngineIdentity([{
      path: 'Future.uproject',
      content: '{"EngineAssociation":"99.0"}',
    }]);
    expect(result).toMatchObject({
      engine: 'unreal',
      version: '99.0',
      confident: true,
      surfaceVerification: { status: 'not-verified' },
    });
    expect(result.reasons.join(' ')).toContain('Not verified against this version');
  });

  it('recognises the current versions re-verified for fork-layout interpretation', () => {
    expect(detectGameEngineIdentity([{
      path: 'Current.uproject',
      content: '{"EngineAssociation":"5.8"}',
    }])).toMatchObject({
      engine: 'unreal',
      version: '5.8',
      surfaceVerification: { status: 'verified' },
    });
    expect(detectGameEngineIdentity([{
      path: 'ProjectSettings/ProjectVersion.txt',
      content: 'm_EditorVersion: 6000.2.0b4\n',
    }])).toMatchObject({
      engine: 'unity',
      version: '6000.2.0b4',
      surfaceVerification: { status: 'verified' },
    });
  });

  it('lets a valid declaration override a conflicting detection', () => {
    const detected = detectGameEngineIdentity([{
      path: 'project.godot',
      content: fixture('godot-4', 'project.godot'),
    }]);
    const effective = selectEffectiveGameEngineIdentity(
      { engine: 'unreal', version: '5.6' },
      detected,
    );

    expect(effective).toMatchObject({
      source: 'declared',
      identity: { engine: 'unreal', version: '5.6', confident: true },
    });
    expect(effective.identity.reasons.join(' ')).toContain('declaration wins');
  });

  it('allows custom and unknown declarations without inventing a version', () => {
    const detected = detectGameEngineIdentity([]);
    expect(selectEffectiveGameEngineIdentity({ engine: 'custom', version: 'studio-2' }, detected))
      .toMatchObject({
        source: 'declared',
        identity: { engine: 'custom', version: 'studio-2', confident: true },
      });
    const unknown = selectEffectiveGameEngineIdentity({ engine: 'unknown', version: 'ignored' }, detected);
    expect(unknown).toMatchObject({
      source: 'declared',
      identity: { engine: 'unknown', confident: false },
    });
    expect(unknown.identity).not.toHaveProperty('version');
  });

  it('ignores invalid declarations instead of weakening detection', () => {
    const detected = detectGameEngineIdentity([{
      path: 'project.godot',
      content: fixture('godot-4', 'project.godot'),
    }]);
    expect(normalizeGameEngineDeclaration({ engine: 'unity', version: 'bad\nvalue' })).toBeUndefined();
    expect(selectEffectiveGameEngineIdentity({ engine: 'unity', version: 'bad\nvalue' }, detected))
      .toEqual({ identity: detected, source: 'detected' });
  });
});
