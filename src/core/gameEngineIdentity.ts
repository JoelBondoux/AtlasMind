/**
 * File-evidence-only game-engine identity.
 *
 * A wrong engine is worse than `unknown`: downstream engine surfaces contain
 * version-specific commands and file-format assumptions. This module therefore
 * recognises only decisive, root-relative project files, reads a version only
 * from the engine's own declaration, and keeps conflicts or incomplete input
 * explicit. It does not read the filesystem and has no side effects.
 */

export const GAME_ENGINES = ['unreal', 'unity', 'godot', 'custom', 'unknown'] as const;

export type GameEngine = typeof GAME_ENGINES[number];

/** Primary documentation was re-checked on these dates. */
export const UNREAL_SURFACE_VERIFIED_AT = '2026-09-03';
export const UNITY_SURFACE_VERIFIED_AT = '2026-09-03';
export const GODOT_SURFACE_VERIFIED_AT = '2026-09-03';

/**
 * Identity-file ranges verified against the sources named below.
 *
 * These are intentionally narrower than the parsers. AtlasMind may faithfully
 * report a newer version string while still withholding every surface that has
 * not been checked against that version.
 */
export const UNREAL_IDENTITY_VERIFIED_RANGE = '5.2–5.8';
export const UNITY_IDENTITY_VERIFIED_RANGES = ['2019.3', '6000.0', '6000.2'] as const;
export const GODOT_IDENTITY_VERIFIED_RANGE = '3.x and 4.0–4.6';

export const GAME_ENGINE_IDENTITY_SOURCES = Object.freeze({
  unreal: 'https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Projects/FProjectDescriptor',
  unity: 'https://docs.unity.com/en-us/build-automation/basic-build-configuration/overview',
  godot: 'https://github.com/godotengine/godot/blob/master/core/config/project_settings.cpp',
});

export const GAME_ENGINE_IDENTITY_MAX_FILES = 64;
export const GAME_ENGINE_IDENTITY_MAX_PATH_CHARS = 512;
export const GAME_ENGINE_IDENTITY_MAX_FILE_CHARS = 256 * 1024;

export interface GameEngineFileEvidence {
  /** Workspace-root-relative path, using either slash convention. */
  readonly path: string;
  /** Text already read by the bounded caller. Absence means unreadable. */
  readonly content?: string;
  /** True when the caller could not supply the whole file. */
  readonly truncated?: boolean;
}

export type GameEngineVersionPrecision = 'source-exact' | 'major-family' | 'unknown';

export interface GameEngineSurfaceVerification {
  readonly status: 'verified' | 'not-verified' | 'version-unknown';
  readonly verifiedAt: string;
  readonly verifiedRange: string;
  readonly detail: string;
}

export interface GameEngineIdentity {
  readonly engine: GameEngine;
  /** The exact text declared by the decisive project file, never inferred. */
  readonly version?: string;
  readonly versionPrecision: GameEngineVersionPrecision;
  readonly projectFile?: string;
  readonly reasons: readonly string[];
  /** False only when AtlasMind could not identify one engine family. */
  readonly confident: boolean;
  readonly surfaceVerification?: GameEngineSurfaceVerification;
}

export interface GameEngineDeclaration {
  readonly engine: GameEngine;
  readonly version?: string;
}

export interface EffectiveGameEngineIdentity {
  readonly identity: GameEngineIdentity;
  readonly source: 'declared' | 'detected';
}

interface NormalizedEvidence {
  readonly path: string;
  readonly comparisonPath: string;
  readonly content?: string;
  readonly complete: boolean;
}

interface NormalizationResult {
  readonly evidence?: readonly NormalizedEvidence[];
  readonly reason?: string;
}

const UNITY_VERSION_PATTERN = /^\d{4}\.\d+\.\d+[abfp]\d+(?:c\d+)?$/;
const NUMERIC_ENGINE_VERSION_PATTERN = /^\d{1,4}(?:\.\d{1,4}){0,2}$/;
const SAFE_DECLARED_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,63}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

function unknownIdentity(reason: string): GameEngineIdentity {
  return {
    engine: 'unknown',
    versionPrecision: 'unknown',
    reasons: [reason],
    confident: false,
  };
}

function normalizeEvidence(value: unknown): NormalizationResult {
  if (!Array.isArray(value)) {
    return { reason: 'Engine evidence was unavailable.' };
  }
  if (value.length > GAME_ENGINE_IDENTITY_MAX_FILES) {
    return {
      reason: `Engine evidence exceeded the ${GAME_ENGINE_IDENTITY_MAX_FILES}-file bound.`,
    };
  }

  const byPath = new Map<string, NormalizedEvidence>();
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return { reason: 'Engine evidence contained an invalid file record.' };
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.path !== 'string') {
      return { reason: 'Engine evidence contained a file without a valid path.' };
    }
    const path = normalizeEvidencePath(record.path);
    if (path === undefined) {
      return { reason: 'Engine evidence contained an unsafe or invalid path.' };
    }
    if (record.content !== undefined && typeof record.content !== 'string') {
      return { reason: `Engine evidence for \`${path}\` contained non-text content.` };
    }
    if (record.truncated !== undefined && typeof record.truncated !== 'boolean') {
      return { reason: `Engine evidence for \`${path}\` had an invalid truncation flag.` };
    }

    const complete = record.truncated !== true
      && (record.content === undefined || record.content.length <= GAME_ENGINE_IDENTITY_MAX_FILE_CHARS);
    const normalized: NormalizedEvidence = {
      path,
      comparisonPath: path.toLowerCase(),
      content: typeof record.content === 'string' && record.content.length <= GAME_ENGINE_IDENTITY_MAX_FILE_CHARS
        ? record.content
        : undefined,
      complete,
    };
    const prior = byPath.get(normalized.comparisonPath);
    if (prior !== undefined
      && (prior.content !== normalized.content || prior.complete !== normalized.complete)) {
      return { reason: `Engine evidence contained conflicting records for \`${path}\`.` };
    }
    byPath.set(normalized.comparisonPath, prior ?? normalized);
  }
  return { evidence: [...byPath.values()] };
}

function normalizeEvidencePath(value: string): string | undefined {
  if (!value || value.length > GAME_ENGINE_IDENTITY_MAX_PATH_CHARS || CONTROL_CHAR_PATTERN.test(value)) {
    return undefined;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return undefined;
  }
  return normalized;
}

function isRootUnrealProject(file: NormalizedEvidence): boolean {
  return !file.comparisonPath.includes('/')
    && file.comparisonPath.length > '.uproject'.length
    && file.comparisonPath.endsWith('.uproject');
}

function isUnityProjectVersion(file: NormalizedEvidence): boolean {
  return file.comparisonPath === 'projectsettings/projectversion.txt';
}

function isRootGodotProject(file: NormalizedEvidence): boolean {
  return file.comparisonPath === 'project.godot';
}

function verificationFor(engine: GameEngine, version: string | undefined): GameEngineSurfaceVerification | undefined {
  if (engine === 'custom' || engine === 'unknown') {
    return undefined;
  }

  const verifiedAt = engine === 'unreal'
    ? UNREAL_SURFACE_VERIFIED_AT
    : engine === 'unity'
      ? UNITY_SURFACE_VERIFIED_AT
      : GODOT_SURFACE_VERIFIED_AT;
  const verifiedRange = engine === 'unreal'
    ? UNREAL_IDENTITY_VERIFIED_RANGE
    : engine === 'unity'
      ? UNITY_IDENTITY_VERIFIED_RANGES.join(' and ')
      : GODOT_IDENTITY_VERIFIED_RANGE;

  if (version === undefined) {
    return {
      status: 'version-unknown',
      verifiedAt,
      verifiedRange,
      detail: 'The engine version is unknown; version-dependent surfaces must remain unavailable.',
    };
  }

  const verified = engine === 'unreal'
    ? isVerifiedUnrealVersion(version)
    : engine === 'unity'
      ? isVerifiedUnityVersion(version)
      : isVerifiedGodotVersion(version);
  return verified
    ? {
        status: 'verified',
        verifiedAt,
        verifiedRange,
        detail: `Identity-file behavior was verified for ${engine} ${version}.`,
      }
    : {
        status: 'not-verified',
        verifiedAt,
        verifiedRange,
        detail: `Not verified against this version (${version}); version-dependent surfaces must remain unavailable.`,
      };
}

function numericParts(version: string): readonly number[] | undefined {
  if (!NUMERIC_ENGINE_VERSION_PATTERN.test(version)) {
    return undefined;
  }
  return version.split('.').map(part => Number.parseInt(part, 10));
}

function isVerifiedUnrealVersion(version: string): boolean {
  const parts = numericParts(version);
  return parts !== undefined && parts[0] === 5 && (parts[1] ?? -1) >= 2 && (parts[1] ?? 99) <= 8;
}

function isVerifiedUnityVersion(version: string): boolean {
  return UNITY_IDENTITY_VERIFIED_RANGES.some(prefix => version.startsWith(`${prefix}.`));
}

function isVerifiedGodotVersion(version: string): boolean {
  const parts = numericParts(version);
  return parts !== undefined
    && (parts[0] === 3 || (parts[0] === 4 && parts.length >= 2 && (parts[1] ?? 99) <= 6));
}

function identity(
  engine: Exclude<GameEngine, 'custom' | 'unknown'>,
  projectFile: string,
  version: string | undefined,
  versionPrecision: GameEngineVersionPrecision,
  reasons: readonly string[],
): GameEngineIdentity {
  const verification = verificationFor(engine, version);
  return {
    engine,
    ...(version === undefined ? {} : { version }),
    versionPrecision,
    projectFile,
    reasons: verification?.status === 'not-verified'
      ? [...reasons, verification.detail]
      : reasons,
    confident: true,
    surfaceVerification: verification,
  };
}

function detectUnreal(files: readonly NormalizedEvidence[]): GameEngineIdentity {
  const projects = files.filter(isRootUnrealProject);
  if (projects.length !== 1) {
    return identity(
      'unreal',
      projects.map(project => project.path).sort()[0],
      undefined,
      'unknown',
      [`Found ${projects.length} root Unreal project files; one is required to select a version.`],
    );
  }
  const project = projects[0];
  const corroborated = files.some(file => file.comparisonPath === 'config/defaultengine.ini');
  const corroborationReason = corroborated
    ? 'Found the corroborating `Config/DefaultEngine.ini`.'
    : 'No corroborating `Config/DefaultEngine.ini` was supplied; the project file remains decisive.';
  if (!project.complete || project.content === undefined) {
    return identity(
      'unreal',
      project.path,
      undefined,
      'unknown',
      [`Found \`${project.path}\`, but its complete contents were unavailable.`, corroborationReason],
    );
  }

  try {
    const parsed = JSON.parse(project.content.replace(/^\uFEFF/, '')) as unknown;
    const association = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).EngineAssociation
      : undefined;
    const version = typeof association === 'string' && NUMERIC_ENGINE_VERSION_PATTERN.test(association.trim())
      ? association.trim()
      : undefined;
    return identity(
      'unreal',
      project.path,
      version,
      version === undefined ? 'unknown' : 'source-exact',
      [version === undefined
        ? `Found \`${project.path}\`, but \`EngineAssociation\` did not declare a numeric engine version.`
        : `Read Unreal ${version} from \`${project.path}\` \`EngineAssociation\`.`, corroborationReason],
    );
  } catch {
    return identity(
      'unreal',
      project.path,
      undefined,
      'unknown',
      [`Found \`${project.path}\`, but it was not valid JSON.`, corroborationReason],
    );
  }
}

function detectUnity(file: NormalizedEvidence): GameEngineIdentity {
  if (!file.complete || file.content === undefined) {
    return identity(
      'unity',
      file.path,
      undefined,
      'unknown',
      [`Found \`${file.path}\`, but its complete contents were unavailable.`],
    );
  }
  const versions = [...file.content.matchAll(/^\s*m_EditorVersion\s*:\s*(\S+)\s*$/gm)]
    .map(match => match[1])
    .filter(version => UNITY_VERSION_PATTERN.test(version));
  const uniqueVersions = [...new Set(versions)];
  const version = uniqueVersions.length === 1 ? uniqueVersions[0] : undefined;
  return identity(
    'unity',
    file.path,
    version,
    version === undefined ? 'unknown' : 'source-exact',
    [version === undefined
      ? `Found \`${file.path}\`, but it did not contain one valid \`m_EditorVersion\`.`
      : `Read Unity ${version} from \`${file.path}\` \`m_EditorVersion\`.`],
  );
}

function activeSettingValues(content: string, key: string): string[] {
  const values: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      continue;
    }
    const match = new RegExp(`^${key.replace('/', '\\/')}\\s*=\\s*(.*)$`).exec(trimmed);
    if (match !== null) {
      values.push(match[1].trim());
    }
  }
  return values;
}

function detectGodot(file: NormalizedEvidence): GameEngineIdentity {
  if (!file.complete || file.content === undefined) {
    return identity(
      'godot',
      file.path,
      undefined,
      'unknown',
      [`Found \`${file.path}\`, but its complete contents were unavailable.`],
    );
  }

  const featureValues = activeSettingValues(file.content, 'config/features');
  if (featureValues.length > 1) {
    return identity(
      'godot',
      file.path,
      undefined,
      'unknown',
      [`Found \`${file.path}\`, but it declared \`config/features\` more than once.`],
    );
  }
  if (featureValues.length === 1) {
    const match = /^(?:PackedStringArray|PoolStringArray)\s*\(\s*"(\d{1,4}(?:\.\d{1,4}){0,2})"/.exec(featureValues[0]);
    const version = match?.[1];
    return identity(
      'godot',
      file.path,
      version,
      version === undefined ? 'unknown' : 'source-exact',
      [version === undefined
        ? `Found \`${file.path}\`, but its \`config/features\` version was unreadable.`
        : `Read Godot ${version} from \`${file.path}\` \`config/features\`.`],
    );
  }

  const configVersions = activeSettingValues(file.content, 'config_version');
  if (configVersions.length > 1 || (configVersions.length === 1 && !/^\d+$/.test(configVersions[0]))) {
    return identity(
      'godot',
      file.path,
      undefined,
      'unknown',
      [`Found \`${file.path}\`, but its \`config_version\` declaration was ambiguous or unreadable.`],
    );
  }
  if (configVersions.length === 1 && Number.parseInt(configVersions[0], 10) >= 5) {
    return identity(
      'godot',
      file.path,
      undefined,
      'unknown',
      [`Found \`${file.path}\` with a newer project format but no readable \`config/features\`.`],
    );
  }
  return identity(
    'godot',
    file.path,
    '3',
    'major-family',
    [`Found \`${file.path}\` without \`config/features\`; the declared format identifies the Godot 3 family.`],
  );
}

/**
 * Detect one engine family from a bounded, root-relative file inventory.
 *
 * `DefaultEngine.ini` may corroborate a `.uproject`, but cannot identify Unreal
 * by itself. `custom` is declaration-only: no filename can safely infer it.
 */
export function detectGameEngineIdentity(value: unknown): GameEngineIdentity {
  const normalized = normalizeEvidence(value);
  if (normalized.evidence === undefined) {
    return unknownIdentity(normalized.reason ?? 'Engine evidence was unavailable.');
  }
  const files = normalized.evidence;
  const unrealProjects = files.filter(isRootUnrealProject);
  const unityProject = files.find(isUnityProjectVersion);
  const godotProject = files.find(isRootGodotProject);
  const families = [
    unrealProjects.length > 0 ? 'unreal' : undefined,
    unityProject !== undefined ? 'unity' : undefined,
    godotProject !== undefined ? 'godot' : undefined,
  ].filter((engine): engine is 'unreal' | 'unity' | 'godot' => engine !== undefined);

  if (families.length === 0) {
    return unknownIdentity('No decisive game-engine project file was found.');
  }
  if (families.length > 1) {
    return unknownIdentity(`Conflicting decisive files identified ${families.join(', ')}.`);
  }
  if (families[0] === 'unreal') {
    return detectUnreal(files);
  }
  if (families[0] === 'unity' && unityProject !== undefined) {
    return detectUnity(unityProject);
  }
  return detectGodot(godotProject as NormalizedEvidence);
}

/** Coerce an untrusted project declaration without inventing defaults. */
export function normalizeGameEngineDeclaration(value: unknown): GameEngineDeclaration | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.engine !== 'string'
    || !(GAME_ENGINES as readonly string[]).includes(record.engine)) {
    return undefined;
  }
  const engine = record.engine as GameEngine;
  if (record.version !== undefined
    && (typeof record.version !== 'string'
      || !SAFE_DECLARED_VERSION_PATTERN.test(record.version)
      || CONTROL_CHAR_PATTERN.test(record.version))) {
    return undefined;
  }
  const version = engine === 'unknown' || record.version === undefined
    ? undefined
    : record.version;
  return { engine, ...(version === undefined ? {} : { version }) };
}

/**
 * Apply the same authority rule as project archetypes and compositions:
 * declaration decides; detection only suggests.
 */
export function selectEffectiveGameEngineIdentity(
  declared: unknown,
  detected: GameEngineIdentity,
): EffectiveGameEngineIdentity {
  const normalized = normalizeGameEngineDeclaration(declared);
  if (normalized === undefined) {
    return { identity: detected, source: 'detected' };
  }
  const verification = verificationFor(normalized.engine, normalized.version);
  const reason = normalized.version === undefined
    ? `Project composition declares ${normalized.engine}; the declaration wins.`
    : `Project composition declares ${normalized.engine} ${normalized.version}; the declaration wins.`;
  return {
    source: 'declared',
    identity: {
      engine: normalized.engine,
      ...(normalized.version === undefined ? {} : { version: normalized.version }),
      versionPrecision: normalized.version === undefined ? 'unknown' : 'source-exact',
      reasons: verification?.status === 'not-verified' ? [reason, verification.detail] : [reason],
      confident: normalized.engine !== 'unknown',
      ...(verification === undefined ? {} : { surfaceVerification: verification }),
    },
  };
}
