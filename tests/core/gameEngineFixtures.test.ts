import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'tests/fixtures/game-engines');

const readFixture = (...segments: string[]): string =>
  readFileSync(path.join(FIXTURE_ROOT, ...segments), 'utf8');

describe('game-engine Phase 0 fixtures', () => {
  it('pins a minimal Unreal project and its corroborating engine configuration', () => {
    const project = JSON.parse(readFixture('unreal', 'FixtureGame.uproject')) as {
      FileVersion: number;
      EngineAssociation: string;
      Modules: Array<{ Name: string; Type: string }>;
    };

    expect(project).toMatchObject({
      FileVersion: 3,
      EngineAssociation: '5.6',
      Modules: [{ Name: 'FixtureGame', Type: 'Runtime' }],
    });
    expect(readFixture('unreal', 'Config', 'DefaultEngine.ini'))
      .toContain('GameDefaultMap=/Game/Maps/FixtureMap');
  });

  it('pins Unity to the exact editor version declared by ProjectVersion.txt', () => {
    expect(readFixture('unity', 'ProjectSettings', 'ProjectVersion.txt').trim())
      .toBe('m_EditorVersion: 6000.0.34f1');
  });

  it('keeps Godot 3 absence distinct from Godot 4 declared features', () => {
    const godot3 = readFixture('godot-3', 'project.godot');
    const godot4 = readFixture('godot-4', 'project.godot');

    expect(godot3).toContain('config_version=4');
    expect(godot3).not.toContain('config/features');
    expect(godot4).toContain('config_version=5');
    expect(godot4).toContain('config/features=PackedStringArray("4.3", "GL Compatibility")');
  });

  it('pins a multi-root hybrid composition without persisting derived topology', () => {
    const workspace = JSON.parse(readFixture('composite', 'studio.code-workspace')) as {
      folders: Array<{ name: string; path: string }>;
    };
    const workflow = JSON.parse(readFixture(
      'composite', 'home', 'project_memory', 'operations', 'workflow.json',
    )) as {
      version: number;
      composition: {
        components: Array<{
          id: string;
          location: string;
          role: string;
          vcs: string;
          home?: boolean;
        }>;
      };
      topology?: unknown;
    };

    expect(workspace.folders).toEqual([
      { name: 'Gameplay', path: 'home' },
      { name: 'Backend', path: 'backend' },
      { name: 'Content', path: 'content' },
    ]);
    expect(workflow.version).toBe(1);
    expect(workflow.composition.components.filter(component => component.home)).toEqual([
      expect.objectContaining({ id: 'gameplay', location: 'home', vcs: 'git' }),
    ]);
    expect(workflow.composition.components).toContainEqual(
      expect.objectContaining({ id: 'content', role: 'content', vcs: 'perforce' }),
    );
    expect(workflow).not.toHaveProperty('topology');
    expect(workflow.composition).not.toHaveProperty('topology');
  });

  it('uses inert Perforce coordinates and stores no prohibited game-profile material', () => {
    expect(readFixture('composite', 'content', '.p4config')).toBe([
      'P4PORT=perforce.example.invalid:1666',
      'P4CLIENT=atlasmind_fixture_workspace',
      'P4USER=fixture-user',
      '',
    ].join('\n'));

    const fixtureCorpus = [
      readFixture('composite', 'home', 'project_memory', 'operations', 'workflow.json'),
      readFixture('unreal', 'FixtureGame.uproject'),
      readFixture('unreal', 'Config', 'DefaultEngine.ini'),
      readFixture('unity', 'ProjectSettings', 'ProjectVersion.txt'),
      readFixture('godot-3', 'project.godot'),
      readFixture('godot-4', 'project.godot'),
    ].join('\n');

    expect(fixtureCorpus).not.toMatch(/password|api[_-]?token|signing[_-]?key|console[_-]?sdk|engine[_-]?binary/i);
  });
});
