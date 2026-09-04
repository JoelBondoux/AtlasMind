/**
 * Game-engine interpretation of the generic upstream-divergence reading.
 *
 * Git collection stays in `upstreamDivergence.ts`. This pure adapter adds only
 * the meaning of an engine component and a narrowly version-pinned reading of
 * the bounded paths already present in that report. It never runs Git, reads a
 * workspace, or turns displayed path samples into exact per-area counts.
 */

import type { GameEngine, GameEngineIdentity } from './gameEngineIdentity.js';
import type { ProjectComponent } from './projectComposition.js';
import type {
  AvailableUpstreamDivergenceReport,
  UpstreamDivergenceReport,
  UpstreamDivergenceTrend,
} from './upstreamDivergence.js';

export const GAME_ENGINE_DIVERGENCE_SURFACE_VERIFIED_AT = '2026-09-03';

export const GAME_ENGINE_DIVERGENCE_LAYOUTS = Object.freeze({
  unreal: {
    verifiedRange: '5.8',
    source: 'https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-directory-structure?lang=en-US',
    areas: [
      ['runtime', 'Runtime', 'Engine/Source/Runtime/'],
      ['editor', 'Editor', 'Engine/Source/Editor/'],
      ['developer', 'Developer', 'Engine/Source/Developer/'],
      ['programs', 'Programs', 'Engine/Source/Programs/'],
      ['plugins', 'Plugins', 'Engine/Plugins/'],
      ['build', 'Build', 'Engine/Build/'],
      ['configuration', 'Configuration', 'Engine/Config/'],
      ['engine-content', 'Engine content', 'Engine/Content/'],
      ['shaders', 'Shaders', 'Engine/Shaders/'],
    ],
  },
  unity: {
    verifiedRange: '6000.2.0b4',
    source: 'https://github.com/Unity-Technologies/UnityCsReference',
    areas: [
      ['runtime', 'Runtime', 'Runtime/'],
      ['editor', 'Editor', 'Editor/'],
      ['modules', 'Modules', 'Modules/'],
      ['csharp-projects', 'C# projects', 'Projects/CSharp/'],
      ['tools', 'Tools', 'Tools/'],
      ['external', 'External dependencies', 'External/'],
    ],
  },
  godot: {
    verifiedRange: '4.6',
    source: 'https://github.com/godotengine/godot/tree/4.6-stable',
    areas: [
      ['core', 'Core', 'core/'],
      ['scene', 'Scene', 'scene/'],
      ['servers', 'Servers', 'servers/'],
      ['editor', 'Editor', 'editor/'],
      ['platform', 'Platform', 'platform/'],
      ['drivers', 'Drivers', 'drivers/'],
      ['modules', 'Modules', 'modules/'],
      ['third-party', 'Third-party', 'thirdparty/'],
      ['startup', 'Startup', 'main/'],
    ],
  },
} as const);

type InterpretedGameEngine = keyof typeof GAME_ENGINE_DIVERGENCE_LAYOUTS;
type LayoutAreaTuple = readonly [id: string, label: string, prefix: string];

export type GameEngineMergeBurdenShape =
  | 'synchronized'
  | 'local-fork'
  | 'upstream-intake'
  | 'concurrent-change';

export type GameEngineLayoutVerificationStatus =
  | 'verified'
  | 'not-verified'
  | 'version-unknown'
  | 'engine-unknown'
  | 'custom-layout';

export interface GameEngineLayoutVerification {
  readonly status: GameEngineLayoutVerificationStatus;
  readonly verifiedAt?: string;
  readonly verifiedRange?: string;
  readonly source?: string;
  readonly detail: string;
}

export interface GameEngineDivergenceArea {
  readonly id: string;
  readonly label: string;
  /** Counts only the bounded display list, never the complete repository. */
  readonly displayedDivergedPathCount: number;
  /** Counts only the bounded conflict-candidate display list. */
  readonly displayedConflictPronePathCount: number;
  readonly divergedPaths: readonly string[];
  readonly conflictPronePaths: readonly string[];
}

interface GameEngineDivergenceBase {
  readonly componentId: string;
  readonly componentLabel: string;
  readonly engine: GameEngine;
  readonly engineVersion?: string;
}

export interface AvailableGameEngineDivergence extends GameEngineDivergenceBase {
  readonly status: 'available';
  readonly upstream: Readonly<{ remote: string; ref: string }>;
  readonly observedAt: string;
  readonly commitsAhead: number;
  readonly commitsBehind: number;
  readonly filesDiverged: number;
  readonly conflictPronePathCount: number;
  readonly trend: UpstreamDivergenceTrend;
  readonly mergeBurden: Readonly<{
    shape: GameEngineMergeBurdenShape;
    summary: string;
    trendSummary: string;
  }>;
  readonly layoutVerification: GameEngineLayoutVerification;
  /** `bounded` means the generic report truncated at least one display list. */
  readonly areaEvidence: 'complete' | 'bounded' | 'not-interpreted';
  readonly observedAreas: readonly GameEngineDivergenceArea[];
  readonly unclassifiedDisplayedDivergedPathCount: number;
  readonly unclassifiedDisplayedConflictPronePathCount: number;
}

export interface UnavailableGameEngineDivergence extends GameEngineDivergenceBase {
  readonly status: 'not-applicable' | 'not-declared' | 'not-visible' | 'unreadable';
  readonly reason: string;
}

export type GameEngineDivergence =
  | AvailableGameEngineDivergence
  | UnavailableGameEngineDivergence;

export interface InterpretGameEngineDivergenceInput {
  readonly component: Pick<ProjectComponent, 'id' | 'label' | 'role' | 'upstream'>;
  readonly engineIdentity: GameEngineIdentity;
  readonly divergence: UpstreamDivergenceReport;
}

interface ClassifiedPaths {
  readonly areas: readonly GameEngineDivergenceArea[];
  readonly unclassifiedDiverged: number;
  readonly unclassifiedConflictProne: number;
}

/**
 * Add engine meaning to one already-collected Git report.
 *
 * A component id or upstream mismatch refuses the interpretation: this usually
 * means the component declaration changed while an older report was in flight.
 */
export function interpretGameEngineDivergence(
  input: InterpretGameEngineDivergenceInput,
): GameEngineDivergence {
  const base: GameEngineDivergenceBase = {
    componentId: input.component.id,
    componentLabel: input.component.label,
    engine: input.engineIdentity.engine,
    ...(input.engineIdentity.version === undefined ? {} : { engineVersion: input.engineIdentity.version }),
  };

  if (input.component.role !== 'engine') {
    return {
      ...base,
      status: 'not-applicable',
      reason: `Component \`${input.component.id}\` is ${input.component.role}, not an engine component.`,
    };
  }
  if (!matchesComponent(input.component, input.divergence)) {
    return {
      ...base,
      status: 'unreadable',
      reason: 'The upstream-divergence evidence does not match the current engine component declaration.',
    };
  }
  if (input.divergence.status !== 'available') {
    return {
      ...base,
      status: input.divergence.status,
      reason: input.divergence.reason,
    };
  }

  const report = input.divergence;
  const layoutVerification = verifyLayout(input.engineIdentity);
  const classified = layoutVerification.status === 'verified'
    ? classifyPaths(report, GAME_ENGINE_DIVERGENCE_LAYOUTS[input.engineIdentity.engine as InterpretedGameEngine].areas)
    : { areas: [], unclassifiedDiverged: report.divergedPaths.length, unclassifiedConflictProne: report.conflictPronePaths.length };
  const shape = deriveMergeBurdenShape(report);

  return {
    ...base,
    status: 'available',
    upstream: { ...report.upstream },
    observedAt: report.observedAt,
    commitsAhead: report.commitsAhead,
    commitsBehind: report.commitsBehind,
    filesDiverged: report.filesDiverged,
    conflictPronePathCount: report.conflictPronePathCount,
    trend: copyTrend(report.trend),
    mergeBurden: {
      shape,
      summary: summarizeBurden(shape, report),
      trendSummary: summarizeTrend(report.trend),
    },
    layoutVerification,
    areaEvidence: layoutVerification.status !== 'verified'
      ? 'not-interpreted'
      : report.pathsTruncated ? 'bounded' : 'complete',
    observedAreas: classified.areas,
    unclassifiedDisplayedDivergedPathCount: classified.unclassifiedDiverged,
    unclassifiedDisplayedConflictPronePathCount: classified.unclassifiedConflictProne,
  };
}

function matchesComponent(
  component: Pick<ProjectComponent, 'id' | 'upstream'>,
  report: UpstreamDivergenceReport,
): boolean {
  if (component.id !== report.componentId) {
    return false;
  }
  if (report.upstream === undefined) {
    return component.upstream === undefined;
  }
  return component.upstream?.remote === report.upstream.remote
    && component.upstream.ref === report.upstream.ref;
}

function verifyLayout(identity: GameEngineIdentity): GameEngineLayoutVerification {
  if (identity.engine === 'unknown' || !identity.confident) {
    return {
      status: 'engine-unknown',
      detail: 'The engine family is not confirmed, so paths retain their generic Git meaning.',
    };
  }
  if (identity.engine === 'custom') {
    return {
      status: 'custom-layout',
      detail: 'Custom engines have no AtlasMind-declared source layout; paths retain their generic Git meaning.',
    };
  }

  const layout = GAME_ENGINE_DIVERGENCE_LAYOUTS[identity.engine];
  const common = {
    verifiedAt: GAME_ENGINE_DIVERGENCE_SURFACE_VERIFIED_AT,
    verifiedRange: layout.verifiedRange,
    source: layout.source,
  };
  if (identity.version === undefined) {
    return {
      ...common,
      status: 'version-unknown',
      detail: `The ${identity.engine} version is unknown; the ${layout.verifiedRange} layout is not applied.`,
    };
  }
  if (!layoutVersionMatches(identity.engine, identity.version)) {
    return {
      ...common,
      status: 'not-verified',
      detail: `The ${identity.engine} layout is not verified against version ${identity.version}; paths retain their generic Git meaning.`,
    };
  }
  return {
    ...common,
    status: 'verified',
    detail: `Path areas are verified against the declared ${identity.engine} ${identity.version} layout.`,
  };
}

function layoutVersionMatches(engine: InterpretedGameEngine, version: string): boolean {
  if (engine === 'unreal') {
    return version === '5.8';
  }
  if (engine === 'unity') {
    return version === '6000.2.0b4';
  }
  return version === '4.6' || version.startsWith('4.6.');
}

function classifyPaths(
  report: AvailableUpstreamDivergenceReport,
  rules: readonly LayoutAreaTuple[],
): ClassifiedPaths {
  const byId = new Map<string, {
    label: string;
    diverged: string[];
    conflictProne: string[];
  }>();
  for (const [id, label] of rules) {
    byId.set(id, { label, diverged: [], conflictProne: [] });
  }

  let unclassifiedDiverged = 0;
  for (const path of report.divergedPaths) {
    const rule = matchingRule(path, rules);
    if (rule === undefined) {
      unclassifiedDiverged += 1;
    } else {
      byId.get(rule[0])?.diverged.push(path);
    }
  }
  let unclassifiedConflictProne = 0;
  for (const path of report.conflictPronePaths) {
    const rule = matchingRule(path, rules);
    if (rule === undefined) {
      unclassifiedConflictProne += 1;
    } else {
      byId.get(rule[0])?.conflictProne.push(path);
    }
  }

  const areas: GameEngineDivergenceArea[] = [];
  for (const [id] of rules) {
    const area = byId.get(id);
    if (area !== undefined && (area.diverged.length > 0 || area.conflictProne.length > 0)) {
      areas.push({
        id,
        label: area.label,
        displayedDivergedPathCount: area.diverged.length,
        displayedConflictPronePathCount: area.conflictProne.length,
        divergedPaths: [...area.diverged],
        conflictPronePaths: [...area.conflictProne],
      });
    }
  }
  return { areas, unclassifiedDiverged, unclassifiedConflictProne };
}

function matchingRule(path: string, rules: readonly LayoutAreaTuple[]): LayoutAreaTuple | undefined {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return rules.find(([, , prefix]) => normalized.startsWith(prefix.toLowerCase()));
}

function deriveMergeBurdenShape(report: AvailableUpstreamDivergenceReport): GameEngineMergeBurdenShape {
  if (report.conflictPronePathCount > 0 || (report.commitsAhead > 0 && report.commitsBehind > 0)) {
    return 'concurrent-change';
  }
  if (report.commitsBehind > 0) {
    return 'upstream-intake';
  }
  if (report.commitsAhead > 0 || report.filesDiverged > 0) {
    return 'local-fork';
  }
  return 'synchronized';
}

function summarizeBurden(
  shape: GameEngineMergeBurdenShape,
  report: AvailableUpstreamDivergenceReport,
): string {
  const facts = `${report.commitsBehind} behind, ${report.commitsAhead} ahead, ${report.filesDiverged} diverged files, and ${report.conflictPronePathCount} conflict-prone path candidates`;
  if (shape === 'synchronized') {
    return `The engine component is synchronized with its declared upstream (${facts}).`;
  }
  if (shape === 'upstream-intake') {
    return `The engine fork has upstream work to absorb but no local commit lead in this reading (${facts}).`;
  }
  if (shape === 'local-fork') {
    return `The engine fork carries local divergence without being behind its declared upstream (${facts}).`;
  }
  return `The engine fork and its upstream both carry change, or share conflict-prone path candidates (${facts}).`;
}

function summarizeTrend(trend: UpstreamDivergenceTrend): string {
  if (trend.status === 'first-look') {
    return 'This is the first comparable engine-fork reading; no merge-burden direction is claimed yet.';
  }
  if (trend.status === 'unchanged') {
    return `Engine-fork merge burden is unchanged since ${trend.since}.`;
  }
  if (trend.status === 'growing') {
    return `Engine-fork merge burden is growing since ${trend.since}.`;
  }
  if (trend.status === 'shrinking') {
    return `Engine-fork merge burden is shrinking since ${trend.since}.`;
  }
  return `Engine-fork merge burden moved in mixed directions since ${trend.since}.`;
}

function copyTrend(trend: UpstreamDivergenceTrend): UpstreamDivergenceTrend {
  return {
    ...trend,
    ...(trend.deltas === undefined ? {} : { deltas: { ...trend.deltas } }),
  };
}
