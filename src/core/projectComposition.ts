/**
 * A project made of independently scoped components.
 *
 * Games force this model into the open, but do not own it: a Shopify theme and
 * app, an engine fork and gameplay repository, and a service plus infrastructure
 * all need the same answer. The composition is declared team-owned data.
 * Detection may offer a proposal, but a proposal is never selected as effective
 * state until a person writes it into workflow.json.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import {
  ARCHETYPE_TRAITS,
  PROJECT_ARCHETYPES,
  type ArchetypeIdentity,
  type ArchetypeTrait,
  type ProjectArchetype,
} from './projectArchetype.js';

export const PROJECT_COMPONENT_ROLES = [
  'application',
  'engine',
  'shared-library',
  'service',
  'tools',
  'content',
  'infrastructure',
] as const;

export type ProjectComponentRole = typeof PROJECT_COMPONENT_ROLES[number];

export const PROJECT_COMPONENT_VCS = ['git', 'perforce', 'external', 'none', 'unknown'] as const;
export type ProjectComponentVcs = typeof PROJECT_COMPONENT_VCS[number];

export const PROJECT_TOPOLOGIES = ['single-repo', 'multi-repo', 'multi-root', 'hybrid'] as const;
export type ProjectTopology = typeof PROJECT_TOPOLOGIES[number];

export interface ComponentUpstream {
  remote: string;
  ref: string;
  extra?: Record<string, unknown>;
}

export interface ProjectComponentArchetype extends ArchetypeIdentity {
  extra?: Record<string, unknown>;
}

export interface ProjectComponent {
  id: string;
  label: string;
  /** Portable workspace-folder name or normalized workspace-relative location. */
  location: string;
  role: ProjectComponentRole;
  archetype: ProjectComponentArchetype;
  vcs: ProjectComponentVcs;
  home: boolean;
  upstream?: ComponentUpstream;
  extra?: Record<string, unknown>;
}

/** Stored inside the versioned workflow document; it has no competing version field. */
export interface ProjectComposition {
  components: ProjectComponent[];
  extra?: Record<string, unknown>;
}

export const SHOPIFY_COMPOSITION_COMPONENTS = ['theme', 'app', 'extension'] as const;
export type ShopifyCompositionComponent = typeof SHOPIFY_COMPOSITION_COMPONENTS[number];

/**
 * Turn the Shopify shapes a person selected during bootstrap into the generic
 * project-composition model.
 *
 * This deliberately contains no game-specific vocabulary. The application-like
 * component with the broadest runtime boundary becomes home (app, then theme,
 * then extension), and therefore owns `.`. Sibling locations stay portable and
 * deterministic. Empty input means no declaration rather than an invented
 * workspace component.
 */
export function buildShopifyProjectComposition(
  selected: unknown,
): ProjectComposition | undefined {
  if (!Array.isArray(selected)) {
    return undefined;
  }
  const chosen = new Set<ShopifyCompositionComponent>(selected.filter(
    (component): component is ShopifyCompositionComponent =>
      (SHOPIFY_COMPOSITION_COMPONENTS as readonly unknown[]).includes(component),
  ));
  const ordered = SHOPIFY_COMPOSITION_COMPONENTS.filter(component => chosen.has(component));
  if (ordered.length === 0) {
    return undefined;
  }

  const home = chosen.has('app') ? 'app' : chosen.has('theme') ? 'theme' : 'extension';
  const location = (component: ShopifyCompositionComponent): string => {
    if (component === home) {
      return '.';
    }
    return component === 'extension' ? 'extensions' : component;
  };

  const components: Record<ShopifyCompositionComponent, Omit<ProjectComponent, 'home' | 'location'>> = {
    theme: {
      id: 'shopify-theme',
      label: 'Shopify theme',
      role: 'application',
      archetype: { archetype: 'website', traits: ['has-ui', 'platform-hosted'] },
      vcs: 'git',
    },
    app: {
      id: 'shopify-app',
      label: 'Shopify app',
      role: 'service',
      archetype: {
        archetype: 'web-app',
        traits: ['has-ui', 'has-server', 'platform-hosted', 'handles-personal-data'],
      },
      vcs: 'git',
    },
    extension: {
      id: 'shopify-extension',
      label: 'Shopify extension',
      role: 'shared-library',
      archetype: { archetype: 'library', traits: ['platform-hosted'] },
      vcs: 'git',
    },
  };

  return {
    components: ordered.map(component => ({
      ...components[component],
      location: location(component),
      home: component === home,
    })),
  };
}

export const GAME_COMPOSITION_PRESET_IDS = [
  'single-repo-indie',
  'multi-repo-studio',
  'hybrid-git-perforce',
  'engine-fork-studio',
] as const;
export type GameCompositionPresetId = typeof GAME_COMPOSITION_PRESET_IDS[number];

export function isGameCompositionPresetId(value: unknown): value is GameCompositionPresetId {
  return (GAME_COMPOSITION_PRESET_IDS as readonly unknown[]).includes(value);
}

export interface GameCompositionPresetDefinition {
  id: GameCompositionPresetId;
  label: string;
  description: string;
}

export const GAME_COMPOSITION_PRESETS: readonly GameCompositionPresetDefinition[] = [
  {
    id: 'single-repo-indie',
    label: 'Single-repo indie',
    description: 'One Git gameplay component owns the workspace and project memory.',
  },
  {
    id: 'multi-repo-studio',
    label: 'Multi-repo studio',
    description: 'Gameplay, backend, and team tools are independently scoped Git components.',
  },
  {
    id: 'hybrid-git-perforce',
    label: 'Hybrid Git + Perforce studio',
    description: 'Git gameplay and backend components share the project with Perforce content.',
  },
  {
    id: 'engine-fork-studio',
    label: 'Engine-fork studio',
    description: 'Gameplay, a separately versioned engine fork, and team tools have distinct boundaries.',
  },
];

/**
 * Seed one common game layout as ordinary project composition.
 *
 * The preset id is intentionally absent from the result: presets seed component
 * data and never govern it. In particular, the engine-fork shape does not invent
 * an upstream remote/ref. Those coordinates belong to the team and can be added
 * to the seeded engine component when known.
 */
export function buildGameProjectComposition(
  preset: GameCompositionPresetId,
): ProjectComposition {
  const gameplay = (): ProjectComponent => ({
    id: 'gameplay',
    label: 'Gameplay',
    location: '.',
    role: 'application',
    archetype: { archetype: 'game', traits: ['has-ui', 'ships-binaries'] },
    vcs: 'git',
    home: true,
  });
  const backend = (): ProjectComponent => ({
    id: 'backend',
    label: 'Backend',
    location: 'backend',
    role: 'service',
    archetype: { archetype: 'api', traits: ['has-server'] },
    vcs: 'git',
    home: false,
  });
  const tools = (): ProjectComponent => ({
    id: 'tools',
    label: 'Team tools',
    location: 'tools',
    role: 'tools',
    archetype: { archetype: 'cli', traits: [] },
    vcs: 'git',
    home: false,
  });

  switch (preset) {
    case 'single-repo-indie':
      return { components: [gameplay()] };
    case 'multi-repo-studio':
      return { components: [gameplay(), backend(), tools()] };
    case 'hybrid-git-perforce':
      return {
        components: [
          gameplay(),
          backend(),
          {
            id: 'content',
            label: 'Content',
            location: 'content',
            role: 'content',
            archetype: { archetype: 'generic', traits: [] },
            vcs: 'perforce',
            home: false,
          },
        ],
      };
    case 'engine-fork-studio':
      return {
        components: [
          gameplay(),
          {
            id: 'engine',
            label: 'Engine fork',
            location: 'engine',
            role: 'engine',
            archetype: { archetype: 'library', traits: ['has-native-build'] },
            vcs: 'git',
            home: false,
          },
          tools(),
        ],
      };
  }
}

export interface ProjectCompositionProblem {
  componentId?: string;
  kind: 'unresolved-location' | 'unreadable-location' | 'unknown-vcs';
  detail: string;
}

export interface ProjectCompositionValidationContext {
  /** Workspace folder names or declared relative locations visible to this caller. */
  workspaceLocations?: readonly string[];
  /** Locations that exist but could not be read. */
  unreadableLocations?: readonly string[];
}

export interface ProjectTopologyEvidence {
  workspaceFolderCount?: number;
  gitRootCount?: number;
}

export interface EffectiveProjectComposition {
  effective: ProjectComposition | undefined;
  source: 'declared' | 'fallback' | 'none';
  /** A detector's output remains separate until a human declares it. */
  proposal?: ProjectComposition;
}

const COMPONENT_KEYS = new Set([
  'id', 'label', 'location', 'role', 'archetype', 'vcs', 'home', 'upstream', 'extra',
]);
const COMPOSITION_KEYS = new Set(['components', 'extra']);
const UPSTREAM_KEYS = new Set(['remote', 'ref', 'extra']);
const ARCHETYPE_KEYS = new Set(['archetype', 'traits', 'extra']);
const MAX_COMPONENTS = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unknownFields(raw: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  const keep = (key: string, value: unknown): void => {
    Object.defineProperty(extra, key, { value, enumerable: true, configurable: true, writable: true });
  };
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) {
      keep(key, value);
    }
  }
  if (isRecord(raw['extra'])) {
    for (const [key, value] of Object.entries(raw['extra'])) {
      keep(key, value);
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function cleanDisplayText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, maxLength);
  return cleaned || undefined;
}

/**
 * Normalize a portable composition location.
 *
 * Absolute paths would bind committed team data to one machine; traversal would
 * let a later resolver escape its declared folder. Both are refused rather than
 * cleaned into a different location.
 */
export function normalizeComponentLocation(value: unknown): string | undefined {
  const cleaned = cleanDisplayText(value, 240)?.replace(/\\/gu, '/');
  if (!cleaned || cleaned.startsWith('/') || /^[a-z]:/iu.test(cleaned) || cleaned.startsWith('//')) {
    return undefined;
  }
  if (/[<>:"|?*]/u.test(cleaned)) {
    return undefined;
  }
  const segments = cleaned.split('/').filter(segment => segment !== '' && segment !== '.');
  if (segments.some(segment => segment === '..')) {
    return undefined;
  }
  if (segments.length === 0) {
    return '.';
  }
  return segments.join('/');
}

function sanitizeArchetype(value: unknown): ProjectComponentArchetype | undefined {
  if (!isRecord(value) || !(PROJECT_ARCHETYPES as readonly unknown[]).includes(value['archetype'])) {
    return undefined;
  }
  if (!Array.isArray(value['traits']) || value['traits'].length > ARCHETYPE_TRAITS.length) {
    return undefined;
  }
  const traits = value['traits'] as unknown[];
  if (traits.some(trait => !(ARCHETYPE_TRAITS as readonly unknown[]).includes(trait))) {
    return undefined;
  }
  const extra = unknownFields(value, ARCHETYPE_KEYS);
  return {
    archetype: value['archetype'] as ProjectArchetype,
    traits: [...new Set(traits as ArchetypeTrait[])],
    ...(extra ? { extra } : {}),
  };
}

function sanitizeUpstream(value: unknown): ComponentUpstream | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const remote = cleanDisplayText(value['remote'], 80);
  const ref = cleanDisplayText(value['ref'], 240);
  if (!remote || !/^[a-z0-9][a-z0-9._-]{0,79}$/iu.test(remote) || !ref || !isSafeGitRef(ref)) {
    return undefined;
  }
  const extra = unknownFields(value, UPSTREAM_KEYS);
  return { remote, ref, ...(extra ? { extra } : {}) };
}

function isSafeGitRef(ref: string): boolean {
  if (/[\u0000-\u0020\u007f~^:?*\[\\]/u.test(ref)) {
    return false;
  }
  if (ref.startsWith('/') || ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock')) {
    return false;
  }
  if (ref.includes('..') || ref.includes('//') || ref.includes('@{')) {
    return false;
  }
  return ref.split('/').every(segment => segment !== '' && !segment.startsWith('.'));
}

function sanitizeComponent(value: unknown): ProjectComponent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = typeof value['id'] === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value['id'])
    ? value['id']
    : undefined;
  const label = cleanDisplayText(value['label'], 80);
  const location = normalizeComponentLocation(value['location']);
  const role = (PROJECT_COMPONENT_ROLES as readonly unknown[]).includes(value['role'])
    ? value['role'] as ProjectComponentRole
    : undefined;
  const archetype = sanitizeArchetype(value['archetype']);
  const vcs = (PROJECT_COMPONENT_VCS as readonly unknown[]).includes(value['vcs'])
    ? value['vcs'] as ProjectComponentVcs
    : undefined;
  if (!id || !label || !location || !role || !archetype || !vcs) {
    return undefined;
  }
  if (value['home'] !== undefined && typeof value['home'] !== 'boolean') {
    return undefined;
  }
  const upstream = value['upstream'] === undefined ? undefined : sanitizeUpstream(value['upstream']);
  if (value['upstream'] !== undefined && !upstream) {
    return undefined;
  }
  const extra = unknownFields(value, COMPONENT_KEYS);
  return {
    id,
    label,
    location,
    role,
    archetype,
    vcs,
    home: value['home'] === true,
    ...(upstream ? { upstream } : {}),
    ...(extra ? { extra } : {}),
  };
}

/**
 * Read a declared composition without silently repairing it.
 *
 * One malformed component invalidates the composition instead of disappearing
 * from it: dropping a component would make every downstream count look complete
 * over a boundary the team never declared.
 */
export function sanitizeProjectComposition(value: unknown): ProjectComposition | undefined {
  if (!isRecord(value) || !Array.isArray(value['components'])) {
    return undefined;
  }
  const rawComponents = value['components'];
  if (rawComponents.length === 0 || rawComponents.length > MAX_COMPONENTS) {
    return undefined;
  }
  const components = rawComponents.map(sanitizeComponent);
  if (components.some(component => component === undefined)) {
    return undefined;
  }
  const complete = components as ProjectComponent[];
  if (new Set(complete.map(component => component.id)).size !== complete.length) {
    return undefined;
  }
  if (complete.filter(component => component.home).length !== 1) {
    return undefined;
  }
  const extra = unknownFields(value, COMPOSITION_KEYS);
  return { components: complete, ...(extra ? { extra } : {}) };
}

/** Validate external visibility without changing the declaration. */
export function validateProjectComposition(
  composition: ProjectComposition,
  context: ProjectCompositionValidationContext = {},
): ProjectCompositionProblem[] {
  const visible = context.workspaceLocations?.map(normalizeComponentLocation).filter(Boolean) as string[] | undefined;
  const unreadable = new Set(
    (context.unreadableLocations ?? []).map(normalizeComponentLocation).filter(Boolean) as string[],
  );
  const problems: ProjectCompositionProblem[] = [];
  for (const component of composition.components) {
    if (visible && !visible.includes(component.location)) {
      problems.push({
        componentId: component.id,
        kind: 'unresolved-location',
        detail: `Component ${component.label} names ${component.location}, which is not visible in this workspace. It remains declared.`,
      });
    } else if (unreadable.has(component.location)) {
      problems.push({
        componentId: component.id,
        kind: 'unreadable-location',
        detail: `Component ${component.label} could not be read. Its state is unknown, not empty.`,
      });
    }
    if (component.vcs === 'unknown') {
      problems.push({
        componentId: component.id,
        kind: 'unknown-vcs',
        detail: `Component ${component.label} has unknown version control; no clean-state claim can be made.`,
      });
    }
  }
  return problems;
}

/** Derive topology only from declared components plus evidence the caller actually gathered. */
export function deriveProjectTopologies(
  composition: ProjectComposition,
  evidence: ProjectTopologyEvidence = {},
): ProjectTopology[] {
  const topologies: ProjectTopology[] = [];
  if (composition.components.length === 1) {
    topologies.push('single-repo');
  }
  if (composition.components.length > 1 && Number.isInteger(evidence.gitRootCount) && evidence.gitRootCount! > 1) {
    topologies.push('multi-repo');
  }
  if (Number.isInteger(evidence.workspaceFolderCount) && evidence.workspaceFolderCount! > 1) {
    topologies.push('multi-root');
  }
  if (composition.components.some(component => component.vcs !== 'git')) {
    topologies.push('hybrid');
  }
  return topologies;
}

/** Keep a detector's proposal visible without ever making it effective by inference. */
export function selectEffectiveProjectComposition(
  declared: ProjectComposition | undefined,
  fallback: ProjectComposition | undefined,
  proposal?: ProjectComposition,
): EffectiveProjectComposition {
  return {
    effective: declared ?? fallback,
    source: declared ? 'declared' : fallback ? 'fallback' : 'none',
    ...(proposal ? { proposal } : {}),
  };
}
