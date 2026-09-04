import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GAME_ENGINE_DIVERGENCE_LAYOUTS,
  interpretGameEngineDivergence,
} from '../../src/core/gameEngineDivergence.js';
import type { GameEngineIdentity } from '../../src/core/gameEngineIdentity.js';
import type { ProjectComponent } from '../../src/core/projectComposition.js';
import type {
  AvailableUpstreamDivergenceReport,
  UpstreamDivergenceReport,
} from '../../src/core/upstreamDivergence.js';

const OBSERVED_AT = '2026-09-03T12:00:00.000Z';

function component(overrides: Partial<ProjectComponent> = {}): ProjectComponent {
  return {
    id: 'engine',
    label: 'Engine fork',
    location: 'engine',
    role: 'engine',
    archetype: { archetype: 'library', traits: ['has-native-build'] },
    vcs: 'git',
    home: false,
    upstream: { remote: 'upstream', ref: 'release' },
    ...overrides,
  };
}

function identity(overrides: Partial<GameEngineIdentity> = {}): GameEngineIdentity {
  return {
    engine: 'unreal',
    version: '5.8',
    versionPrecision: 'source-exact',
    reasons: ['fixture'],
    confident: true,
    ...overrides,
  };
}

function available(
  overrides: Partial<AvailableUpstreamDivergenceReport> = {},
): AvailableUpstreamDivergenceReport {
  return {
    status: 'available',
    componentId: 'engine',
    componentLabel: 'Engine fork',
    upstream: { remote: 'upstream', ref: 'release' },
    observedAt: OBSERVED_AT,
    mergeBase: 'a'.repeat(40),
    commitsAhead: 3,
    commitsBehind: 5,
    filesDiverged: 4,
    divergedPaths: [
      'Engine/Plugins/Studio/Feature.cpp',
      'Engine/Shaders/Private/Pass.usf',
      'Engine/Source/Runtime/Core/Private/Core.cpp',
      'README.md',
    ],
    conflictPronePathCount: 2,
    conflictPronePaths: [
      'Engine/Shaders/Private/Pass.usf',
      'Engine/Source/Runtime/Core/Private/Core.cpp',
    ],
    pathsTruncated: false,
    trend: {
      status: 'growing',
      since: '2026-09-02T12:00:00.000Z',
      deltas: { commitsAhead: 1, commitsBehind: 2, filesDiverged: 2, conflictPronePathCount: 1 },
    },
    ...overrides,
  };
}

function interpret(
  divergence: UpstreamDivergenceReport = available(),
  componentOverrides: Partial<ProjectComponent> = {},
  identityOverrides: Partial<GameEngineIdentity> = {},
) {
  return interpretGameEngineDivergence({
    component: component(componentOverrides),
    engineIdentity: identity(identityOverrides),
    divergence,
  });
}

describe('gameEngineDivergence', () => {
  it('applies only to a declared engine component', () => {
    const result = interpret(available(), { role: 'shared-library' });

    expect(result).toMatchObject({ status: 'not-applicable', componentId: 'engine' });
    expect(result).not.toHaveProperty('commitsBehind');
  });

  it('refuses divergence evidence from another component', () => {
    expect(interpret(available({ componentId: 'gameplay' }))).toMatchObject({
      status: 'unreadable',
      reason: expect.stringContaining('does not match'),
    });
  });

  it('refuses stale evidence after the declared upstream changes', () => {
    expect(interpret(available(), { upstream: { remote: 'epic', ref: 'main' } })).toMatchObject({
      status: 'unreadable',
    });
  });

  it('preserves unavailable states rather than inventing zero distance', () => {
    const result = interpret({
      status: 'not-declared',
      componentId: 'engine',
      componentLabel: 'Engine fork',
      reason: 'No upstream remote and ref are declared for this component.',
    }, { upstream: undefined });

    expect(result).toMatchObject({ status: 'not-declared' });
    expect(result).not.toHaveProperty('filesDiverged');
  });

  it('preserves the four exact Git metrics and the generic trend', () => {
    const source = available();
    const result = interpret(source);

    expect(result).toMatchObject({
      status: 'available',
      commitsAhead: 3,
      commitsBehind: 5,
      filesDiverged: 4,
      conflictPronePathCount: 2,
      trend: source.trend,
      mergeBurden: { shape: 'concurrent-change' },
    });
  });

  it.each([
    [{ commitsAhead: 0, commitsBehind: 0, filesDiverged: 0, conflictPronePathCount: 0 }, 'synchronized'],
    [{ commitsAhead: 2, commitsBehind: 0, filesDiverged: 2, conflictPronePathCount: 0 }, 'local-fork'],
    [{ commitsAhead: 0, commitsBehind: 4, filesDiverged: 3, conflictPronePathCount: 0 }, 'upstream-intake'],
    [{ commitsAhead: 2, commitsBehind: 4, filesDiverged: 3, conflictPronePathCount: 0 }, 'concurrent-change'],
    [{ commitsAhead: 0, commitsBehind: 0, filesDiverged: 1, conflictPronePathCount: 1 }, 'concurrent-change'],
  ] as const)('derives a descriptive burden shape without a severity threshold: %s', (metrics, shape) => {
    expect(interpret(available({
      ...metrics,
      divergedPaths: [],
      conflictPronePaths: [],
    }))).toMatchObject({ status: 'available', mergeBurden: { shape } });
  });

  it('classifies only displayed Unreal paths using a version-pinned layout', () => {
    const result = interpret();

    expect(result).toMatchObject({
      status: 'available',
      layoutVerification: {
        status: 'verified',
        verifiedRange: GAME_ENGINE_DIVERGENCE_LAYOUTS.unreal.verifiedRange,
      },
      areaEvidence: 'complete',
      observedAreas: [
        {
          id: 'runtime',
          displayedDivergedPathCount: 1,
          displayedConflictPronePathCount: 1,
        },
        {
          id: 'plugins',
          displayedDivergedPathCount: 1,
          displayedConflictPronePathCount: 0,
        },
        {
          id: 'shaders',
          displayedDivergedPathCount: 1,
          displayedConflictPronePathCount: 1,
        },
      ],
      unclassifiedDisplayedDivergedPathCount: 1,
      unclassifiedDisplayedConflictPronePathCount: 0,
    });
  });

  it('labels area evidence bounded while retaining exact repository totals', () => {
    const result = interpret(available({
      filesDiverged: 400,
      conflictPronePathCount: 300,
      pathsTruncated: true,
    }));

    expect(result).toMatchObject({
      status: 'available',
      filesDiverged: 400,
      conflictPronePathCount: 300,
      areaEvidence: 'bounded',
    });
  });

  it('uses the exact verified Unity layout and withholds nearby unverified versions', () => {
    const report = available({
      divergedPaths: ['Runtime/Scripting/Runtime.cs', 'Modules/Audio/Public/Audio.bindings.cs'],
      conflictPronePaths: ['Runtime/Scripting/Runtime.cs'],
      filesDiverged: 2,
      conflictPronePathCount: 1,
    });
    const verified = interpret(report, {}, { engine: 'unity', version: '6000.2.0b4' });
    const unverified = interpret(report, {}, { engine: 'unity', version: '6000.2.0f1' });

    expect(verified).toMatchObject({
      status: 'available',
      layoutVerification: { status: 'verified' },
      observedAreas: [{ id: 'runtime' }, { id: 'modules' }],
    });
    expect(unverified).toMatchObject({
      status: 'available',
      layoutVerification: { status: 'not-verified' },
      areaEvidence: 'not-interpreted',
      observedAreas: [],
      unclassifiedDisplayedDivergedPathCount: 2,
    });
  });

  it('classifies the verified Godot source layout', () => {
    const result = interpret(available({
      divergedPaths: ['core/object/object.cpp', 'servers/rendering/renderer.cpp', 'thirdparty/README.md'],
      conflictPronePaths: ['servers/rendering/renderer.cpp'],
      filesDiverged: 3,
      conflictPronePathCount: 1,
    }), {}, { engine: 'godot', version: '4.6' });

    expect(result).toMatchObject({
      status: 'available',
      layoutVerification: { status: 'verified' },
      observedAreas: [{ id: 'core' }, { id: 'servers' }, { id: 'third-party' }],
    });
  });

  it.each([
    [{ engine: 'custom', version: 'studio-7', confident: true }, 'custom-layout'],
    [{ engine: 'unknown', version: undefined, confident: false }, 'engine-unknown'],
    [{ engine: 'unreal', version: undefined, confident: true }, 'version-unknown'],
  ] as const)('keeps exact generic facts when path meaning is unavailable: %s', (engineState, status) => {
    const result = interpret(available(), {}, engineState);

    expect(result).toMatchObject({
      status: 'available',
      commitsBehind: 5,
      layoutVerification: { status },
      areaEvidence: 'not-interpreted',
      observedAreas: [],
    });
  });

  it('copies nested evidence and never mutates the generic report', () => {
    const source = available();
    const before = JSON.stringify(source);
    const result = interpret(source);

    expect(JSON.stringify(source)).toBe(before);
    if (result.status === 'available') {
      expect(result.upstream).not.toBe(source.upstream);
      expect(result.trend).not.toBe(source.trend);
      expect(result.trend.deltas).not.toBe(source.trend.deltas);
    }
  });

  it('keeps the interpretation layer pure and free of collection dependencies', () => {
    const source = readFileSync(path.resolve(__dirname, '../../src/core/gameEngineDivergence.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"](?:node:fs|node:child_process|vscode)['"]/);
    expect(source).not.toMatch(/execFile|spawn|fetch\s*\(/);
  });
});
