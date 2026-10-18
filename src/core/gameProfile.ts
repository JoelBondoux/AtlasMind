/**
 * GameProfile — what a game project has *declared* about itself.
 *
 * Everything else AtlasMind knows about a game is read from files or Git and
 * carries a confidence: the engine from its decisive file, assets from a
 * bounded walk, divergence from a merge base. This document is the other half
 * — the facts only a team can state: the platforms it ships to, the build
 * configurations it cares about, the budgets a frame must fit, where content
 * lives, who owns each discipline, and which stores it targets. It lives at
 * `<ssot>/domain/game.json` with a regenerated `game.md` mirror, the
 * `websiteWorkspaceManager` pattern, and is schema kind `game`, registered at
 * v1 before anything wrote it.
 *
 * Seven rules, the first of which is the boundary.
 *
 * 1. **Forbidden content refuses the whole document, never a field of it.**
 *    `GAME_PROFILE_FORBIDDEN_RULES` is a declared table — absolute paths,
 *    secret-shaped keys, SDK or engine-binary paths, and anything
 *    `redactSecrets` would change — walked over *every* key and string value,
 *    unknown fields included. A match is refused, not redacted: this file is
 *    committed, and a silently scrubbed document reports success while the
 *    secret stays wherever it was pasted from. A finding names the rule and
 *    the JSON path, never the value. Consoles are where this matters most
 *    (spec §7.6): AtlasMind must not hold an SDK path or assert a console
 *    fact, so a console target is a user-authored label and nothing else.
 * 2. **An invalid value is a finding, not a repair.** A known field that fails
 *    validation is left out of the typed view and reported with its rule and
 *    path; nothing is trimmed, clamped, re-cased or coerced into something the
 *    team did not write. A list over its bound is invalid whole — truncating
 *    it would report a declaration nobody made. `save` refuses input carrying
 *    an invalid value, so the only way one leaves the file is a person
 *    deciding to save without it; reading never writes.
 * 3. **Unknown fields survive a round trip, byte for byte.** A newer build's
 *    field on an entry or at the top level is kept where it was, not folded
 *    into an `extra` bag, so `sanitizeGameProfile` adds no field the input did
 *    not have (`version` aside) and is idempotent — both asserted by property
 *    test. A valid entry is passed through exactly as written.
 * 4. **Absent is not empty.** An absent list means *not declared*; `[]` means
 *    *declared none*. The mirror says which, and no budget is ever rendered as
 *    `0 ms` — an undeclared metric is a dash.
 * 5. **Unresolved is reported, never dropped.** `validateGameProfile` checks
 *    content roots against the declared composition (with none declared, only
 *    the implicit home `.` resolves) and budgets against the declared
 *    targets. A root naming a component the composition does not hold may be
 *    ahead of the composition rather than wrong, so it stays declared and
 *    the finding says why it does not resolve — the `validateWorkflowConfig`
 *    rule for an unresolvable owner.
 * 6. **The engine is a declaration, normalised by the one normaliser.**
 *    `normalizeGameEngineDeclaration` decides; a value it would change (an
 *    `unknown` engine carrying a version) is invalid rather than quietly
 *    stripped, and a declared version is never inferred.
 * 7. **Seeding never overwrites; an explicit save may — explicitly.** A seed
 *    writes only when neither file exists, so an existing, corrupt or newer
 *    profile is kept. `save` refuses a file written by a newer AtlasMind
 *    unless the caller passes `replaceNewer`, which is the only way that
 *    overwrite happens. A manager bound to an ambiguous SSOT home reads
 *    nothing and throws `SsotHomeRefusalError` on every write.
 *
 * Pure apart from `GameProfileManager`, which is `fs`-only. Nothing here runs,
 * detects or probes anything.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { scanMemoryEntry } from '../memory/memoryScanner.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import { normalizeGameEngineDeclaration, type GameEngineDeclaration } from './gameEngineIdentity.js';
import {
  buildGameProjectComposition,
  normalizeComponentLocation,
  type GameCompositionPresetId,
  type ProjectComposition,
} from './projectComposition.js';
import { interpretVersionedDocument } from './schemaMigration.js';
import { SsotHomeRefusalError } from './workspaceScope.js';

// ── Locations ────────────────────────────────────────────────────

/** The profile under the default SSOT folder. */
export const GAME_PROFILE_SSOT_PATH = 'project_memory/domain/game.json';
/** Its regenerated human-readable mirror. */
export const GAME_PROFILE_SUMMARY_SSOT_PATH = 'project_memory/domain/game.md';

const DEFAULT_SSOT_REL_PATH = 'project_memory';
const PROFILE_SEGMENTS = ['domain', 'game.json'] as const;
const SUMMARY_SEGMENTS = ['domain', 'game.md'] as const;

// ── Closed vocabularies ──────────────────────────────────────────

/**
 * Platforms a game may target. `console` is deliberately one value with a
 * user-authored label rather than a list of named consoles: AtlasMind asserts
 * no console fact (spec §7.6), and naming them here would be one.
 */
export const GAME_PLATFORMS = ['windows', 'macos', 'linux', 'ios', 'android', 'web', 'console'] as const;
export type GamePlatform = typeof GAME_PLATFORMS[number];

/** PC storefronts a game may target. Console stores are console facts and are absent by the same rule. */
export const GAME_STORES = ['steam', 'gog', 'epic', 'itch'] as const;
export type GameStore = typeof GAME_STORES[number];

/** Disciplines a team may assign owners to. Closed so two spellings of one discipline cannot coexist. */
export const GAME_DISCIPLINES = [
  'gameplay-engineering',
  'engine-engineering',
  'technical-art',
  'art',
  'animation',
  'audio',
  'game-design',
  'level-design',
  'narrative',
  'ui-ux',
  'qa',
  'production',
  'build-release',
  'localization',
] as const;
export type GameDiscipline = typeof GAME_DISCIPLINES[number];

// ── Bounds ───────────────────────────────────────────────────────

export const GAME_PROFILE_LIMITS = Object.freeze({
  platformTargets: 24,
  buildConfigurations: 24,
  performanceBudgets: 48,
  contentRoots: 64,
  disciplineOwnership: GAME_DISCIPLINES.length,
  storeTargets: GAME_STORES.length,
  ownersPerDiscipline: 8,
  labelChars: 80,
  /** Every key and value in the document, unknown fields included. */
  documentNodes: 4_000,
  documentDepth: 12,
  stringChars: 4_096,
});

// ── Shapes ───────────────────────────────────────────────────────

/** A target the game ships to. `label` is required for `console` and is all a console target holds. */
export interface GamePlatformTarget {
  platform: GamePlatform;
  label?: string;
  [unknownField: string]: unknown;
}

export interface GameBuildConfiguration {
  /** e.g. `Development`, `Shipping`, `Debug`. */
  id: string;
  label?: string;
  [unknownField: string]: unknown;
}

/** Budgets for one declared target. An undeclared metric is absent, never zero. */
export interface GamePerformanceBudget {
  platform: GamePlatform;
  /** Names the console target when `platform` is `console`. */
  label?: string;
  frameTimeMs?: number;
  memoryMb?: number;
  loadTimeS?: number;
  [unknownField: string]: unknown;
}

/** Where content lives: a location relative to a component; no `componentId` means the home. */
export interface GameContentRoot {
  componentId?: string;
  location: string;
  [unknownField: string]: unknown;
}

export interface GameDisciplineOwnership {
  discipline: GameDiscipline;
  /** Bounded handles (`@name` or a roster id) — never an address. */
  owners: string[];
  [unknownField: string]: unknown;
}

export interface GameStoreTarget {
  store: GameStore;
  label?: string;
  [unknownField: string]: unknown;
}

export interface GameProfile {
  version: 1;
  engine?: GameEngineDeclaration & { [unknownField: string]: unknown };
  platformTargets?: GamePlatformTarget[];
  buildConfigurations?: GameBuildConfiguration[];
  performanceBudgets?: GamePerformanceBudget[];
  contentRoots?: GameContentRoot[];
  disciplineOwnership?: GameDisciplineOwnership[];
  storeTargets?: GameStoreTarget[];
  updatedAt?: string;
  [unknownField: string]: unknown;
}

export type GameProfileFindingKind = 'invalid' | 'unresolved' | 'forbidden';

/** One thing wrong with a profile. Names a rule and a JSON path — never the offending value. */
export interface GameProfileFinding {
  kind: GameProfileFindingKind;
  rule: string;
  path: string;
  detail: string;
}

/** The outcome of reading untrusted input as a profile. */
export interface GameProfileReading {
  /**
   * `ok`: a profile, possibly with invalid entries left out and reported.
   * `refused`: forbidden content anywhere — no profile at all.
   * `invalid`: not a JSON object, or over the document bounds.
   */
  status: 'ok' | 'refused' | 'invalid';
  profile?: GameProfile;
  findings: GameProfileFinding[];
}

// ── Forbidden content ────────────────────────────────────────────

export interface GameProfileForbiddenRule {
  id: 'absolute-path' | 'secret-shaped-key' | 'sdk-or-engine-binary-path' | 'would-be-redacted';
  /** Why it refuses, in the words the finding carries. */
  reason: string;
  /** Applied to every object key, when present. */
  matchesKey?: (key: string) => boolean;
  /** Applied to every string value, when present. */
  matchesValue?: (value: string) => boolean;
}

/**
 * Credential markers, matched against a key with case and separators removed.
 * Deliberately broad: a false positive costs a rename, a false negative a
 * signing key in git history. `auth` is absent because it matches `author`.
 */
const SECRET_KEY_MARKERS = [
  'password', 'passwd', 'passphrase', 'secret', 'token', 'apikey', 'accesskey', 'privatekey',
  'signingkey', 'keystore', 'credential', 'bearer', 'connectionstring', 'certificate',
] as const;

const SDK_KEY_PATTERN = /(?:sdk|ndk|jdk)|(?:engine|editor|binary|binaries|executable|exe|uat|toolchain|compiler)(?:path|dir|directory|root|location|bin|home)$|^executable$/u;
const BINARY_VALUE_PATTERN = /\.(?:exe|app|dmg|bat|cmd|ps1|sh|command|x86_64|appimage)$/iu;
const ENGINE_BINARY_NAME_PATTERN = /(?:^|[\\/\s])(?:UnrealEditor(?:-Cmd)?|UE4Editor(?:-Cmd)?|RunUAT|UnrealBuildTool|UnityHub|Unity\.(?:exe|app)|Godot_v\d[^\\/\s]*)(?:$|[\\/\s.])/iu;
const SDK_SEGMENT_PATTERN = /(?:^|[\\/])(?:Epic Games|Unity[\\/]Hub|Android[\\/]Sdk|Engine[\\/]Binaries)(?:[\\/]|$)/iu;
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|file:|%[A-Za-z_][A-Za-z0-9_]*%[\\/]|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?[\\/])/u;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

/**
 * The declared refusal table, evaluated in order over every key and string
 * value in the document. The first rule to match a node names the finding.
 */
export const GAME_PROFILE_FORBIDDEN_RULES: readonly GameProfileForbiddenRule[] = Object.freeze([
  {
    id: 'absolute-path',
    reason: 'An absolute path binds committed team data to one machine and can name an SDK or a binary. Use a path relative to a component.',
    matchesValue: (value: string) => ABSOLUTE_PATH_PATTERN.test(value),
  },
  {
    id: 'secret-shaped-key',
    reason: 'A field named like a credential would hold one. The profile may hold a secret reference (a key ending in `secretRef`), never a secret.',
    matchesKey: (key: string) => {
      const normalized = normalizeKey(key);
      return !normalized.endsWith('secretref') && SECRET_KEY_MARKERS.some(marker => normalized.includes(marker));
    },
  },
  {
    id: 'sdk-or-engine-binary-path',
    reason: 'An SDK or engine-binary location comes from user settings or source constants, never from a project file (spec §7.1, §7.6).',
    // A key is judged by its name and a value by its shape: the key pattern
    // applied to values would refuse a label that merely mentions an SDK.
    matchesKey: (key: string) => SDK_KEY_PATTERN.test(normalizeKey(key)),
    matchesValue: (value: string) => BINARY_VALUE_PATTERN.test(value)
      || ENGINE_BINARY_NAME_PATTERN.test(value)
      || SDK_SEGMENT_PATTERN.test(value),
  },
  {
    id: 'would-be-redacted',
    reason: 'The secret redactor would change this text, so it is shaped like a credential. It is refused rather than redacted.',
    matchesKey: (key: string) => redactSecrets(key).text !== key,
    matchesValue: (value: string) => redactSecrets(value).text !== value,
  },
]);

interface WalkState {
  nodes: number;
  bounded: boolean;
  findings: GameProfileFinding[];
}

function pathOf(parent: string, key: string | number): string {
  if (typeof key === 'number') {
    return `${parent}[${key}]`;
  }
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? (parent ? `${parent}.${key}` : key) : `${parent}[${JSON.stringify(key)}]`;
}

function forbiddenFor(text: string, as: 'key' | 'value'): GameProfileForbiddenRule | undefined {
  return GAME_PROFILE_FORBIDDEN_RULES.find(rule => (as === 'key' ? rule.matchesKey : rule.matchesValue)?.(text) === true);
}

function walk(value: unknown, at: string, depth: number, state: WalkState): void {
  state.nodes += 1;
  if (state.nodes > GAME_PROFILE_LIMITS.documentNodes || depth > GAME_PROFILE_LIMITS.documentDepth) {
    state.bounded = true;
    return;
  }
  if (typeof value === 'string') {
    if (value.length > GAME_PROFILE_LIMITS.stringChars) {
      state.bounded = true;
      return;
    }
    const rule = forbiddenFor(value, 'value');
    if (rule) {
      state.findings.push({ kind: 'forbidden', rule: rule.id, path: at || '(document)', detail: rule.reason });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (!state.bounded) {
        walk(item, pathOf(at, index), depth + 1, state);
      }
    });
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (state.bounded) {
        return;
      }
      const childPath = pathOf(at, key);
      const rule = key.length > GAME_PROFILE_LIMITS.stringChars ? undefined : forbiddenFor(key, 'key');
      if (rule) {
        state.findings.push({ kind: 'forbidden', rule: rule.id, path: childPath, detail: rule.reason });
      }
      walk(child, childPath, depth + 1, state);
    }
  }
}

/**
 * Every forbidden node in an untrusted document. Empty means none; the
 * findings name rule and path only.
 */
export function findForbiddenGameProfileContent(input: unknown): GameProfileFinding[] {
  const state: WalkState = { nodes: 0, bounded: false, findings: [] };
  walk(input, '', 0, state);
  return state.findings;
}

// ── Validation helpers ───────────────────────────────────────────

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
const BUILD_CONFIGURATION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u;
const COMPONENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const OWNER_HANDLE = /^@?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Text exactly as a person would write it — validated, never cleaned. */
function isDeclaredText(value: unknown, max: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && value.trim() === value
    && !CONTROL_CHARS.test(value);
}

function isMember<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function invalid(rule: string, at: string, detail: string): GameProfileFinding {
  return { kind: 'invalid', rule, path: at, detail };
}

/** A target's identity: the platform, or `console:<label>` for a console. */
function targetKey(platform: GamePlatform, label: string | undefined): string {
  return platform === 'console' ? `console:${(label ?? '').toLowerCase()}` : platform;
}

interface ListSpec {
  field: string;
  max: number;
  /** Returns the problem with one entry, or `undefined` when it is valid. */
  check: (entry: Record<string, unknown>, at: string) => GameProfileFinding | undefined;
  /** The identity used to refuse a duplicate. */
  identity: (entry: Record<string, unknown>) => string;
  noun: string;
}

function readList(
  raw: unknown,
  spec: ListSpec,
  findings: GameProfileFinding[],
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(raw)) {
    findings.push(invalid(`${spec.field}-shape`, spec.field, `${spec.noun} must be a list; the field was left out.`));
    return undefined;
  }
  if (raw.length > spec.max) {
    findings.push(invalid(
      `${spec.field}-bound`,
      spec.field,
      `At most ${spec.max} ${spec.noun} may be declared, and ${raw.length} were. Nothing was truncated; the field was left out.`,
    ));
    return undefined;
  }
  const kept: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const at = pathOf(spec.field, index);
    if (!isRecord(entry)) {
      findings.push(invalid(`${spec.field}-entry`, at, `Each of the ${spec.noun} must be an object.`));
      return;
    }
    const problem = spec.check(entry, at);
    if (problem) {
      findings.push(problem);
      return;
    }
    const identity = spec.identity(entry);
    if (seen.has(identity)) {
      findings.push(invalid(`${spec.field}-duplicate`, at, `A duplicate of an earlier entry in ${spec.noun}; the first was kept.`));
      return;
    }
    seen.add(identity);
    // Passed through exactly as written: validation selects, it never rewrites.
    kept.push({ ...entry });
  });
  return kept;
}

const LIST_SPECS: Readonly<Record<string, ListSpec>> = {
  platformTargets: {
    field: 'platformTargets',
    noun: 'platform targets',
    max: GAME_PROFILE_LIMITS.platformTargets,
    identity: entry => targetKey(entry['platform'] as GamePlatform, entry['label'] as string | undefined),
    check: (entry, at) => {
      if (!isMember(GAME_PLATFORMS, entry['platform'])) {
        return invalid('platform', at, `The platform must be one of ${GAME_PLATFORMS.join(', ')}.`);
      }
      if (entry['label'] !== undefined && !isDeclaredText(entry['label'], GAME_PROFILE_LIMITS.labelChars)) {
        return invalid('label', `${at}.label`, `A label is 1–${GAME_PROFILE_LIMITS.labelChars} characters with no surrounding space or control characters.`);
      }
      if (entry['platform'] === 'console' && entry['label'] === undefined) {
        return invalid('console-label', at, 'A console target is a label you write — AtlasMind names no console — so it needs one.');
      }
      return undefined;
    },
  },
  buildConfigurations: {
    field: 'buildConfigurations',
    noun: 'build configurations',
    max: GAME_PROFILE_LIMITS.buildConfigurations,
    identity: entry => String(entry['id']).toLowerCase(),
    check: (entry, at) => {
      if (typeof entry['id'] !== 'string' || !BUILD_CONFIGURATION_ID.test(entry['id'])) {
        return invalid('build-configuration-id', `${at}.id`, 'A build configuration id starts with a letter and uses letters, digits, `_` or `-` (at most 48).');
      }
      if (entry['label'] !== undefined && !isDeclaredText(entry['label'], GAME_PROFILE_LIMITS.labelChars)) {
        return invalid('label', `${at}.label`, `A label is 1–${GAME_PROFILE_LIMITS.labelChars} characters with no surrounding space or control characters.`);
      }
      return undefined;
    },
  },
  performanceBudgets: {
    field: 'performanceBudgets',
    noun: 'performance budgets',
    max: GAME_PROFILE_LIMITS.performanceBudgets,
    identity: entry => targetKey(entry['platform'] as GamePlatform, entry['label'] as string | undefined),
    check: (entry, at) => {
      if (!isMember(GAME_PLATFORMS, entry['platform'])) {
        return invalid('platform', at, `The platform must be one of ${GAME_PLATFORMS.join(', ')}.`);
      }
      if (entry['label'] !== undefined && !isDeclaredText(entry['label'], GAME_PROFILE_LIMITS.labelChars)) {
        return invalid('label', `${at}.label`, `A label is 1–${GAME_PROFILE_LIMITS.labelChars} characters with no surrounding space or control characters.`);
      }
      if (entry['platform'] === 'console' && entry['label'] === undefined) {
        return invalid('console-label', at, 'A console budget names the console target it belongs to by its label.');
      }
      const metrics = ['frameTimeMs', 'memoryMb', 'loadTimeS'] as const;
      for (const metric of metrics) {
        if (entry[metric] !== undefined && !isPositiveFinite(entry[metric])) {
          return invalid('budget-value', `${at}.${metric}`, 'A budget is a finite number greater than zero. It was not rounded, clamped or converted.');
        }
      }
      if (metrics.every(metric => entry[metric] === undefined)) {
        return invalid('budget-empty', at, 'A budget declares at least one of frameTimeMs, memoryMb or loadTimeS.');
      }
      return undefined;
    },
  },
  contentRoots: {
    field: 'contentRoots',
    noun: 'content roots',
    max: GAME_PROFILE_LIMITS.contentRoots,
    identity: entry => `${String(entry['componentId'] ?? '')}::${String(entry['location'])}`,
    check: (entry, at) => {
      if (entry['componentId'] !== undefined && (typeof entry['componentId'] !== 'string' || !COMPONENT_ID.test(entry['componentId']))) {
        return invalid('content-root-component', `${at}.componentId`, 'A component id is lower-case letters, digits and `-`, as the composition declares it.');
      }
      // Validated, never cleaned: a location the normaliser would rewrite is
      // reported rather than silently stored as something else.
      if (typeof entry['location'] !== 'string' || normalizeComponentLocation(entry['location']) !== entry['location']) {
        return invalid('content-root-location', `${at}.location`, 'A content root is a normalised path relative to its component: forward slashes, no `..`, no leading `./`, never absolute.');
      }
      return undefined;
    },
  },
  disciplineOwnership: {
    field: 'disciplineOwnership',
    noun: 'discipline owners',
    max: GAME_PROFILE_LIMITS.disciplineOwnership,
    identity: entry => String(entry['discipline']),
    check: (entry, at) => {
      if (!isMember(GAME_DISCIPLINES, entry['discipline'])) {
        return invalid('discipline', `${at}.discipline`, `The discipline must be one of ${GAME_DISCIPLINES.join(', ')}.`);
      }
      const owners = entry['owners'];
      if (!Array.isArray(owners) || owners.length === 0 || owners.length > GAME_PROFILE_LIMITS.ownersPerDiscipline) {
        return invalid('owners', `${at}.owners`, `A discipline names 1–${GAME_PROFILE_LIMITS.ownersPerDiscipline} owners. An unowned discipline is left undeclared, not declared with nobody.`);
      }
      if (owners.some(owner => typeof owner !== 'string' || !OWNER_HANDLE.test(owner))) {
        return invalid('owner-handle', `${at}.owners`, 'An owner is a handle (`@name` or a roster id), not an address.');
      }
      if (new Set(owners.map(owner => String(owner).toLowerCase())).size !== owners.length) {
        return invalid('owner-duplicate', `${at}.owners`, 'An owner is named twice.');
      }
      return undefined;
    },
  },
  storeTargets: {
    field: 'storeTargets',
    noun: 'store targets',
    max: GAME_PROFILE_LIMITS.storeTargets,
    identity: entry => String(entry['store']),
    check: (entry, at) => {
      if (!isMember(GAME_STORES, entry['store'])) {
        return invalid('store', `${at}.store`, `The store must be one of ${GAME_STORES.join(', ')}.`);
      }
      if (entry['label'] !== undefined && !isDeclaredText(entry['label'], GAME_PROFILE_LIMITS.labelChars)) {
        return invalid('label', `${at}.label`, `A label is 1–${GAME_PROFILE_LIMITS.labelChars} characters with no surrounding space or control characters.`);
      }
      return undefined;
    },
  },
};

// ── Sanitize and validate ────────────────────────────────────────

/**
 * Read untrusted input as a profile. Selects, never rewrites: a valid value is
 * passed through exactly, an invalid one is left out and reported, an unknown
 * field is kept where it was, and forbidden content anywhere refuses the whole
 * document. Idempotent; adds no field but `version`.
 */
export function sanitizeGameProfile(input: unknown): GameProfileReading {
  if (!isRecord(input)) {
    return {
      status: 'invalid',
      findings: [invalid('document-shape', '(document)', 'A game profile is a JSON object.')],
    };
  }
  const state: WalkState = { nodes: 0, bounded: false, findings: [] };
  walk(input, '', 0, state);
  if (state.bounded) {
    return {
      status: 'invalid',
      findings: [invalid(
        'document-bounds',
        '(document)',
        `A game profile holds at most ${GAME_PROFILE_LIMITS.documentNodes} values, nests at most ${GAME_PROFILE_LIMITS.documentDepth} deep, and no string over ${GAME_PROFILE_LIMITS.stringChars} characters.`,
      )],
    };
  }
  if (state.findings.length > 0) {
    return { status: 'refused', findings: state.findings };
  }

  const findings: GameProfileFinding[] = [];
  const kept: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === 'version') {
      continue;
    }
    if (key === 'engine') {
      const normalized = normalizeGameEngineDeclaration(value);
      const rawVersion = isRecord(value) ? value['version'] : undefined;
      if (!normalized || normalized.version !== rawVersion) {
        findings.push(invalid(
          'engine',
          'engine',
          'The engine is one of unreal, unity, godot, custom or unknown, with an optional exact version — and `unknown` has none. It was left out rather than corrected.',
        ));
        continue;
      }
      kept.push([key, { ...(value as Record<string, unknown>) }]);
      continue;
    }
    if (key === 'updatedAt') {
      if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
        kept.push([key, value]);
      } else {
        findings.push(invalid('updated-at', 'updatedAt', 'updatedAt is an ISO date-time; it was left out.'));
      }
      continue;
    }
    const spec = LIST_SPECS[key];
    if (spec) {
      const list = readList(value, spec, findings);
      if (list) {
        kept.push([key, list]);
      }
      continue;
    }
    // A field this build does not recognise: kept, untouched, where it was.
    kept.push([key, value]);
  }
  // `Object.fromEntries` defines properties rather than assigning them, so a
  // `__proto__` key from a hostile file stays an ordinary field.
  const profile = { version: 1 as const, ...Object.fromEntries(kept) } as GameProfile;
  return { status: 'ok', profile, findings };
}

export interface GameProfileValidationContext {
  /** The declared composition, when there is one. */
  composition?: ProjectComposition;
}

/**
 * Does everything the profile names exist? Separate from sanitizing — one asks
 * "is this usable", this asks "does it resolve" — and nothing it reports is
 * dropped from the profile.
 */
export function validateGameProfile(
  profile: GameProfile,
  context: GameProfileValidationContext = {},
): GameProfileFinding[] {
  const findings: GameProfileFinding[] = [];
  const components = context.composition?.components;
  profile.contentRoots?.forEach((root, index) => {
    const at = `contentRoots[${index}]`;
    if (root.componentId === undefined) {
      return; // The home component: declared, or the implicit home `.`.
    }
    if (!components) {
      findings.push({
        kind: 'unresolved',
        rule: 'content-root-no-composition',
        path: `${at}.componentId`,
        detail: `No composition is declared, so only the implicit home \`.\` resolves. The root naming \`${root.componentId}\` stays declared.`,
      });
      return;
    }
    if (!components.some(component => component.id === root.componentId)) {
      findings.push({
        kind: 'unresolved',
        rule: 'content-root-component-undeclared',
        path: `${at}.componentId`,
        detail: `The composition declares no component \`${root.componentId}\`. The root stays declared until one does, or it is removed.`,
      });
    }
  });
  const targets = new Set((profile.platformTargets ?? []).map(target => targetKey(target.platform, target.label)));
  profile.performanceBudgets?.forEach((budget, index) => {
    if (!targets.has(targetKey(budget.platform, budget.label))) {
      findings.push({
        kind: 'unresolved',
        rule: 'budget-target-undeclared',
        path: `performanceBudgets[${index}]`,
        detail: 'This budget is for a target the profile does not declare. It stays declared; add the target or remove the budget.',
      });
    }
  });
  return findings;
}

// ── Seeding ──────────────────────────────────────────────────────

/**
 * The profile bootstrap writes when a game architecture preset is chosen: the
 * engine `unknown` (nothing was detected or asked), and a content root for
 * each component the preset declares as `content`. A preset with no content
 * component leaves content roots undeclared rather than guessing an engine's
 * folder layout.
 */
export function buildSeedGameProfile(preset: GameCompositionPresetId): GameProfile {
  const contentComponents = buildGameProjectComposition(preset).components
    .filter(component => component.role === 'content');
  return {
    version: 1,
    engine: { engine: 'unknown' },
    ...(contentComponents.length > 0
      ? { contentRoots: contentComponents.map(component => ({ componentId: component.id, location: '.' })) }
      : {}),
  };
}

/** The file as written: two-space JSON with a trailing newline. */
export function serializeGameProfile(profile: GameProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

// ── Mirror ───────────────────────────────────────────────────────

const KNOWN_FIELDS = new Set([
  'version', 'engine', 'platformTargets', 'buildConfigurations', 'performanceBudgets',
  'contentRoots', 'disciplineOwnership', 'storeTargets', 'updatedAt',
]);

/** A table cell: backslashes first, so an escaped pipe in the input cannot un-escape ours. */
function cell(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|');
}

function metric(value: number | undefined, unit: string): string {
  return value === undefined ? '—' : `${value} ${unit}`;
}

function listSection<T>(
  lines: string[],
  title: string,
  list: readonly T[] | undefined,
  render: (items: readonly T[]) => string[],
): void {
  lines.push(`## ${title}`, '');
  if (list === undefined) {
    lines.push('_Not declared._', '');
  } else if (list.length === 0) {
    lines.push('_Declared: none._', '');
  } else {
    lines.push(...render(list), '');
  }
}

/** The regenerated mirror. Absent and empty read differently; no metric is ever a zero it was not given. */
export function renderGameProfileMarkdown(profile: GameProfile, findings: readonly GameProfileFinding[] = []): string {
  const lines: string[] = [
    '# Game Profile',
    '',
    `> Generated from \`domain/game.json\`. Edit the JSON (or a future Game Studio), not this file — it is regenerated on every save.`,
    '',
    '## Engine',
    '',
  ];
  if (!profile.engine) {
    lines.push('_Not declared._', '');
  } else {
    lines.push(
      `- Engine: \`${profile.engine.engine}\``,
      `- Version: ${profile.engine.version ? `\`${profile.engine.version}\`` : '_not declared_'}`,
      '',
    );
  }
  listSection(lines, 'Platform targets', profile.platformTargets, items => items.map(target =>
    `- \`${target.platform}\`${target.label ? ` — ${target.label}` : ''}`));
  listSection(lines, 'Build configurations', profile.buildConfigurations, items => items.map(config =>
    `- \`${config.id}\`${config.label ? ` — ${config.label}` : ''}`));
  listSection(lines, 'Performance budgets', profile.performanceBudgets, items => [
    '| Target | Frame time | Memory | Load time |',
    '|---|---|---|---|',
    ...items.map(budget => `| ${cell(budget.label ? `${budget.platform} — ${budget.label}` : budget.platform)} | ${metric(budget.frameTimeMs, 'ms')} | ${metric(budget.memoryMb, 'MB')} | ${metric(budget.loadTimeS, 's')} |`),
  ]);
  listSection(lines, 'Content roots', profile.contentRoots, items => items.map(root =>
    `- \`${root.location}\` in ${root.componentId ? `component \`${root.componentId}\`` : 'the home component'}`));
  listSection(lines, 'Discipline ownership', profile.disciplineOwnership, items => items.map(entry =>
    `- \`${entry.discipline}\`: ${entry.owners.map(owner => `\`${owner}\``).join(', ')}`));
  listSection(lines, 'Store targets', profile.storeTargets, items => items.map(store =>
    `- \`${store.store}\`${store.label ? ` — ${store.label}` : ''}`));

  const unknown = Object.keys(profile).filter(key => !KNOWN_FIELDS.has(key));
  if (unknown.length > 0) {
    lines.push('## Fields this build does not recognise', '', `Kept as written: ${unknown.map(key => `\`${key}\``).join(', ')}.`, '');
  }
  if (findings.length > 0) {
    lines.push('## Findings', '');
    for (const finding of findings) {
      lines.push(`- **${finding.kind}** \`${finding.rule}\` at \`${finding.path}\` — ${finding.detail}`);
    }
    lines.push('');
  }
  lines.push(`_Last updated: ${profile.updatedAt ?? 'unknown'}._`, '');
  return lines.join('\n');
}

// ── Service ──────────────────────────────────────────────────────

/** What reading the file found. */
export interface GameProfileRead {
  /**
   * `absent`: no file. `loaded`: a profile (maybe with findings). `unreadable`:
   * not JSON, not an object, or over its bounds. `refused`: forbidden content.
   * `newer`: written by a newer AtlasMind. `no-home`: the SSOT home is
   * ambiguous, so nothing was read.
   */
  status: 'absent' | 'loaded' | 'unreadable' | 'refused' | 'newer' | 'no-home';
  profile?: GameProfile;
  findings: GameProfileFinding[];
  notice?: string;
}

export interface GameProfileSaveOptions {
  /** The clock; injected so a save is reproducible in tests. */
  now?: Date;
  /** The one way to overwrite a file a newer AtlasMind wrote — named, never implied. */
  replaceNewer?: boolean;
}

/**
 * Validate a workspace-relative SSOT folder — never clean it. A value that is
 * absolute or climbs out falls back to the default, as every reader of the
 * setting does.
 */
function ssotSegments(ssotRelPath: string): string[] {
  const trimmed = ssotRelPath.trim();
  const segments = trimmed.split(/[\\/]+/u).filter(Boolean);
  if (!trimmed || /^[a-zA-Z]:/u.test(trimmed) || /^[\\/]/u.test(trimmed)
    || segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    return [DEFAULT_SSOT_REL_PATH];
  }
  return segments;
}

/** Holds the game profile for the extension host. */
export class GameProfileManager {
  private readonly ssotRelPath: string;

  /**
   * @param workspaceRoot The SSOT home — from `ssotHomeRoot()`, never assumed
   *   to be the first folder.
   * @param refusal Why project memory may not be read or written here, when
   *   the home is ambiguous. A refused manager reads nothing and throws on
   *   every write.
   * @param ssotRelPath The validated `atlasmind.ssotPath`, so the profile sits
   *   beside the rest of project memory wherever it was configured.
   */
  constructor(
    private readonly workspaceRoot: string | undefined,
    private readonly refusal?: string,
    ssotRelPath: string = DEFAULT_SSOT_REL_PATH,
  ) {
    this.ssotRelPath = ssotSegments(ssotRelPath).join('/');
  }

  private filePath(segments: readonly string[]): string | undefined {
    return this.workspaceRoot
      ? path.join(this.workspaceRoot, ...this.ssotRelPath.split('/'), ...segments)
      : undefined;
  }

  /** True when either file exists — the condition under which a seed writes nothing. */
  exists(): boolean {
    const json = this.filePath(PROFILE_SEGMENTS);
    const markdown = this.filePath(SUMMARY_SEGMENTS);
    return Boolean((json && existsSync(json)) || (markdown && existsSync(markdown)));
  }

  read(): GameProfileRead {
    if (this.refusal) {
      return { status: 'no-home', findings: [], notice: this.refusal };
    }
    const json = this.filePath(PROFILE_SEGMENTS);
    if (!json || !existsSync(json)) {
      return { status: 'absent', findings: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(json, 'utf8')) as unknown;
    } catch {
      return {
        status: 'unreadable',
        findings: [invalid('document-json', '(document)', 'domain/game.json is not valid JSON. It was left as it is.')],
      };
    }
    const outcome = interpretVersionedDocument<Record<string, unknown>>('game', parsed, isRecord);
    if (outcome.preserveExisting) {
      return { status: 'newer', findings: [], ...(outcome.notice ? { notice: outcome.notice } : {}) };
    }
    const reading = sanitizeGameProfile(outcome.config ?? parsed);
    if (reading.status !== 'ok' || !reading.profile) {
      return { status: reading.status === 'refused' ? 'refused' : 'unreadable', findings: reading.findings };
    }
    return {
      status: 'loaded',
      profile: reading.profile,
      findings: reading.findings,
      ...(outcome.notice ? { notice: outcome.notice } : {}),
    };
  }

  /**
   * Write the profile somebody asked to save. Refuses invalid or forbidden
   * input whole, and a newer file unless `replaceNewer` says otherwise.
   */
  async save(input: unknown, options: GameProfileSaveOptions = {}): Promise<GameProfile> {
    if (this.refusal) {
      throw new SsotHomeRefusalError(this.refusal);
    }
    const json = this.filePath(PROFILE_SEGMENTS);
    const markdownPath = this.filePath(SUMMARY_SEGMENTS);
    if (!json || !markdownPath) {
      throw new Error('Open a workspace folder before saving the game profile.');
    }
    if (this.read().status === 'newer' && !options.replaceNewer) {
      throw new Error(
        'This project\'s game.json was written by a newer version of AtlasMind. '
        + 'Update AtlasMind to edit it — saving now would overwrite fields this build cannot read.',
      );
    }
    const reading = sanitizeGameProfile(input);
    const blocking = reading.findings.filter(finding => finding.kind !== 'unresolved');
    if (reading.status !== 'ok' || !reading.profile || blocking.length > 0) {
      throw new Error(
        `The game profile was not saved: ${blocking.map(finding => `${finding.rule} at ${finding.path}`).join('; ')}.`,
      );
    }
    const profile: GameProfile = { ...reading.profile, updatedAt: (options.now ?? new Date()).toISOString() };
    const serialized = serializeGameProfile(profile);
    const markdown = renderGameProfileMarkdown(profile);
    const blockedScan = [
      scanMemoryEntry(GAME_PROFILE_SSOT_PATH, serialized),
      scanMemoryEntry(GAME_PROFILE_SUMMARY_SSOT_PATH, markdown),
    ].find(result => result.status === 'blocked');
    if (blockedScan) {
      const issue = blockedScan.issues.find(candidate => candidate.severity === 'error');
      throw new Error(`The game profile was blocked as unsafe project memory${issue ? `: ${issue.message}` : '.'}`);
    }
    await mkdir(path.dirname(json), { recursive: true });
    await writeFile(json, serialized, 'utf8');
    await writeFile(markdownPath, markdown, 'utf8');
    return profile;
  }

  /**
   * Write a seed only where nothing exists. An existing profile — valid,
   * corrupt, refused or newer — is kept, and so is a mirror without its JSON.
   */
  async seed(profile: GameProfile, options: Pick<GameProfileSaveOptions, 'now'> = {}): Promise<'seeded' | 'kept-existing'> {
    if (this.refusal) {
      throw new SsotHomeRefusalError(this.refusal);
    }
    if (this.exists()) {
      return 'kept-existing';
    }
    await this.save(profile, options);
    return 'seeded';
  }
}
