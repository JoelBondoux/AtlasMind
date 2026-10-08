/**
 * Resolve which workspace roots a caller explicitly asked to inspect.
 *
 * The default is intentionally the first VS Code workspace folder, preserving
 * existing behaviour until a surface opts into home/component/all resolution.
 * `locateSsotHome` (below) answers the one question that deliberately departs
 * from that default: which folder holds project memory.
 * Pure, `vscode`-free, and unit-tested.
 */

import path from 'node:path';
import type { ProjectComponent, ProjectComposition, ProjectComponentVcs } from './projectComposition.js';
import { normalizeComponentLocation } from './projectComposition.js';

export interface WorkspaceFolderReference {
  name: string;
  fsPath: string;
  /** Optional portable token supplied by the host when basename/name are insufficient. */
  declaredLocation?: string;
  /** False means the host tried to inspect the folder and could not. */
  readable?: boolean;
}

export type WorkspaceScopeTarget =
  | { kind: 'default' }
  | { kind: 'home' }
  | { kind: 'component'; componentId: string }
  | { kind: 'all' };

export interface WorkspaceScopeRoot {
  name: string;
  fsPath: string;
  componentId?: string;
  componentLabel?: string;
  vcs?: ProjectComponentVcs;
}

export interface UnknownWorkspaceComponent {
  componentId: string;
  componentLabel: string;
  vcs: ProjectComponentVcs;
  reason: 'not-open' | 'unreadable' | 'ambiguous';
}

export interface WorkspaceScope {
  target: WorkspaceScopeTarget;
  label: string;
  roots: WorkspaceScopeRoot[];
  unknown: UnknownWorkspaceComponent[];
  complete: boolean;
}

/**
 * The default-resolution rule, stated once: the first folder VS Code reports.
 *
 * Generic so the adapter in `src/utils/workspaceRoots.ts` can hand back the
 * host's own folder object rather than a copy matched up again by path, and so
 * that the `[0]` every default caller depends on lives here and nowhere else.
 * `docs/project-composition.md` §8 requires this to stay exactly the first
 * folder until a surface opts in to home/component resolution; changing it here
 * would change every default caller at once, which is the point of having one.
 */
export function defaultWorkspaceFolderOf<T>(folders: readonly T[]): T | undefined {
  return folders[0];
}

/** Options for resolving a declared composition against the open folders. */
export interface WorkspaceScopeOptions {
  /**
   * The folder the composition was read from — the one holding `workflow.json`,
   * which is the SSOT home. A component at `.` means *this* folder.
   *
   * Absent, `.` falls back to the first folder, which is right only while the
   * composition was itself read from the first folder. Every caller that reads
   * the composition from the located home passes the home here, or a home that
   * is not folder 0 is a composition that cannot find itself.
   */
  anchorFsPath?: string;
}

function componentFolderMatches(
  component: ProjectComponent,
  folders: readonly WorkspaceFolderReference[],
  options: WorkspaceScopeOptions,
): WorkspaceFolderReference[] {
  if (component.location === '.') {
    if (options.anchorFsPath !== undefined) {
      const anchor = folders.find(folder => folder.fsPath === options.anchorFsPath);
      return anchor ? [anchor] : [];
    }
    const first = defaultWorkspaceFolderOf(folders);
    return first ? [first] : [];
  }
  return folders.filter(folder => {
    const tokens = [
      normalizeComponentLocation(folder.name),
      normalizeComponentLocation(path.basename(folder.fsPath)),
      normalizeComponentLocation(folder.declaredLocation),
    ].filter((token): token is string => token !== undefined);
    return tokens.includes(component.location);
  });
}

function resolveComponent(
  component: ProjectComponent,
  folders: readonly WorkspaceFolderReference[],
  options: WorkspaceScopeOptions,
): { root?: WorkspaceScopeRoot; unknown?: UnknownWorkspaceComponent } {
  const matches = componentFolderMatches(component, folders, options);
  if (matches.length === 0) {
    return { unknown: {
      componentId: component.id,
      componentLabel: component.label,
      vcs: component.vcs,
      reason: 'not-open',
    } };
  }
  if (matches.length > 1) {
    return { unknown: {
      componentId: component.id,
      componentLabel: component.label,
      vcs: component.vcs,
      reason: 'ambiguous',
    } };
  }
  const folder = matches[0]!;
  if (folder.readable === false) {
    return { unknown: {
      componentId: component.id,
      componentLabel: component.label,
      vcs: component.vcs,
      reason: 'unreadable',
    } };
  }
  return {
    root: {
      name: folder.name,
      fsPath: folder.fsPath,
      componentId: component.id,
      componentLabel: component.label,
      vcs: component.vcs,
    },
  };
}

/**
 * Resolve an explicit scope. Omitting `target` is exactly today's `[0]` rule;
 * composition is not consulted on that branch, and neither is the anchor.
 */
export function resolveWorkspaceScope(
  folders: readonly WorkspaceFolderReference[],
  composition?: ProjectComposition,
  target: WorkspaceScopeTarget = { kind: 'default' },
  options: WorkspaceScopeOptions = {},
): WorkspaceScope {
  if (target.kind === 'default') {
    const first = defaultWorkspaceFolderOf(folders);
    return {
      target,
      label: first?.name ?? 'No workspace',
      roots: first ? [{ name: first.name, fsPath: first.fsPath }] : [],
      unknown: [],
      complete: first !== undefined,
    };
  }

  if (!composition) {
    return { target, label: 'Composition not declared', roots: [], unknown: [], complete: false };
  }

  let selected: ProjectComponent[];
  if (target.kind === 'all') {
    selected = composition.components;
  } else if (target.kind === 'home') {
    selected = composition.components.filter(component => component.home);
  } else {
    selected = composition.components.filter(component => component.id === target.componentId);
  }

  if (selected.length === 0) {
    return { target, label: 'Component not declared', roots: [], unknown: [], complete: false };
  }

  const resolved = selected.map(component => resolveComponent(component, folders, options));
  const roots = resolved.flatMap(item => item.root ? [item.root] : []);
  const unknown = resolved.flatMap(item => item.unknown ? [item.unknown] : []);
  const baseLabel = target.kind === 'all' ? 'All declared components' : selected[0]!.label;
  const label = unknown.length > 0
    ? `${baseLabel} (${roots.length} of ${selected.length} visible)`
    : baseLabel;
  return { target, label, roots, unknown, complete: unknown.length === 0 };
}

// ── Where project memory lives ──────────────────────────────────

/**
 * What the host found when it looked inside one folder.
 *
 * Gathered by the adapter (`src/utils/workspaceRoots.ts`) and handed in, so
 * the decision below reads no filesystem and is the same on every machine.
 */
export interface SsotHomeProbe {
  /**
   * Whether the configured project-memory folder exists here. `undefined`
   * means nobody could look, which is reported and never read as `false`.
   */
  ssotPresent: boolean | undefined;
  /**
   * The composition declared by a readable, valid `workflow.json` in this
   * folder. Absent when there is no such file or it is unusable — a document
   * written by a newer AtlasMind included, since this build cannot read what
   * it declares.
   */
  composition?: ProjectComposition;
}

export type SsotHomeRuleId =
  | 'no-folder'
  | 'single-root'
  | 'declared-home'
  | 'ambiguous'
  | 'sole-ssot'
  | 'no-ssot-first-folder';

/** What the probes found, before any rule is applied. */
export interface SsotHomeEvidence {
  folders: readonly WorkspaceFolderReference[];
  /** Folders whose own `workflow.json` places the home component in themselves. */
  declared: readonly WorkspaceFolderReference[];
  /** Folders holding the configured project-memory folder. */
  withSsot: readonly WorkspaceFolderReference[];
}

export interface SsotHomeRule {
  id: SsotHomeRuleId;
  /** The rule as a sentence, published wherever the result is shown. */
  statement: string;
  /** Whether this rule decides. Evaluated in table order; the first that applies wins. */
  applies: (evidence: SsotHomeEvidence) => boolean;
}

/**
 * How the home component's folder is located — `docs/project-composition.md`
 * §2.6: one SSOT, in the home. First match wins, and the order is the policy:
 *
 * - **One folder is never probed.** A single-root workspace is the home by
 *   definition, which is what keeps it byte-for-byte unchanged.
 * - **A declaration outranks a directory.** Two folders can each hold a
 *   `project_memory/` for innocent reasons (a copied template, a vendored
 *   repository); a committed composition naming its own folder as home is
 *   somebody's decision, and it is the documented way to settle an
 *   ambiguity, so it has to win one.
 * - **Ambiguity is a result, never a coin toss.** Two declarations, or no
 *   declaration and two memory folders, leave the home *unknown*. A silent
 *   pick would write the project's decisions into whichever repository
 *   happened to be listed first, where the team reading the other never sees
 *   them.
 * - **Nothing found is the first folder**, because that is where bootstrap
 *   writes project memory, and a home that moved after the first write would
 *   orphan it.
 */
export const SSOT_HOME_RULES: readonly SsotHomeRule[] = [
  {
    id: 'no-folder',
    statement: 'No folder is open, so there is no home to locate.',
    applies: evidence => evidence.folders.length === 0,
  },
  {
    id: 'single-root',
    statement: 'One folder is open, so it is the home. Nothing is probed.',
    applies: evidence => evidence.folders.length === 1,
  },
  {
    id: 'declared-home',
    statement: 'Exactly one folder holds a valid workflow.json whose composition places the home component in that folder.',
    applies: evidence => evidence.declared.length === 1,
  },
  {
    id: 'ambiguous',
    statement: 'More than one folder declares itself the home, or none does and more than one holds project memory. '
      + 'The home is unknown: AtlasMind names the candidates and refuses project-memory writes rather than picking one.',
    applies: evidence => evidence.declared.length > 1
      || (evidence.declared.length === 0 && evidence.withSsot.length > 1),
  },
  {
    id: 'sole-ssot',
    statement: 'No folder declares the home, and exactly one holds the configured project-memory folder.',
    applies: evidence => evidence.withSsot.length === 1,
  },
  {
    id: 'no-ssot-first-folder',
    statement: 'No folder declares the home or holds project memory yet, so the home is the first folder — where bootstrap writes it.',
    applies: () => true,
  },
];

/** A cap on folders probed, so a workspace of hundreds of roots cannot make every lookup slow. */
export const SSOT_HOME_MAX_PROBED_FOLDERS = 32;

export interface SsotHomeLocation {
  rule: SsotHomeRuleId;
  /** The rule's own sentence, so no surface restates it more reassuringly. */
  statement: string;
  /** The home. Absent exactly when the rule is `no-folder` or `ambiguous`. */
  home?: WorkspaceFolderReference;
  /**
   * The folders the deciding rule weighed. For `ambiguous`, the competitors —
   * the folders a person has to choose between.
   */
  candidates: WorkspaceFolderReference[];
  /** For `ambiguous`, what the competitors were competing on. */
  ambiguity?: 'declared-home' | 'ssot-folder';
  /** Folders that could not be looked inside, or were past the probe cap. Stated, never assumed empty. */
  unprobed: WorkspaceFolderReference[];
}

/** Whether `folder`'s own composition places the home component in `folder`. */
function declaresHomeIn(
  folder: WorkspaceFolderReference,
  composition: ProjectComposition,
  folders: readonly WorkspaceFolderReference[],
): boolean {
  const scope = resolveWorkspaceScope(folders, composition, { kind: 'home' }, { anchorFsPath: folder.fsPath });
  return scope.roots.length === 1 && scope.roots[0]!.fsPath === folder.fsPath;
}

/**
 * Locate the SSOT home among the open folders.
 *
 * Pure: `probe` is the only window onto the filesystem. It is never called
 * for a single folder, never for a folder already known to be unreadable,
 * at most once per folder, and never past `SSOT_HOME_MAX_PROBED_FOLDERS`.
 */
export function locateSsotHome(
  folders: readonly WorkspaceFolderReference[],
  probe: (folder: WorkspaceFolderReference) => SsotHomeProbe | undefined,
): SsotHomeLocation {
  const declared: WorkspaceFolderReference[] = [];
  const withSsot: WorkspaceFolderReference[] = [];
  const unprobed: WorkspaceFolderReference[] = [];

  if (folders.length > 1) {
    folders.forEach((folder, index) => {
      const reading = index < SSOT_HOME_MAX_PROBED_FOLDERS && folder.readable !== false ? probe(folder) : undefined;
      if (!reading || reading.ssotPresent === undefined) {
        unprobed.push(folder);
      } else if (reading.ssotPresent) {
        withSsot.push(folder);
      }
      if (reading?.composition && declaresHomeIn(folder, reading.composition, folders)) {
        declared.push(folder);
      }
    });
  }

  const evidence: SsotHomeEvidence = { folders, declared, withSsot };
  const rule = SSOT_HOME_RULES.find(candidate => candidate.applies(evidence))!;
  const base = { rule: rule.id, statement: rule.statement, unprobed };
  switch (rule.id) {
    case 'no-folder':
      return { ...base, candidates: [] };
    case 'single-root':
      return { ...base, home: folders[0]!, candidates: [folders[0]!] };
    case 'declared-home':
      return { ...base, home: declared[0]!, candidates: [...declared] };
    case 'ambiguous':
      return declared.length > 1
        ? { ...base, candidates: [...declared], ambiguity: 'declared-home' }
        : { ...base, candidates: [...withSsot], ambiguity: 'ssot-folder' };
    case 'sole-ssot':
      return { ...base, home: withSsot[0]!, candidates: [...withSsot] };
    case 'no-ssot-first-folder':
      return { ...base, home: defaultWorkspaceFolderOf(folders)!, candidates: [] };
  }
}

/**
 * Why project memory may not be read or written, when it may not — one
 * sentence for every surface, naming the candidates and the way out.
 *
 * Only `ambiguous` refuses. `no-folder` has nothing to refuse; every caller
 * already says "open a folder" in its own words.
 */
export function describeSsotHomeRefusal(
  location: SsotHomeLocation,
  ssotPath = 'project_memory',
): string | undefined {
  if (location.rule !== 'ambiguous') {
    return undefined;
  }
  const names = location.candidates.map(folder => `"${folder.name}"`);
  const listed = names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const competing = location.ambiguity === 'declared-home'
    ? `${listed} each declare themselves the home in their own workflow.json`
    : `${listed} each hold a ${ssotPath}/ folder and none declares itself the home`;
  const fix = location.ambiguity === 'declared-home'
    ? 'Keep the home declaration in one folder\'s workflow.json and remove it from the others.'
    : `Declare the home: in the folder that should own project memory, add a composition to ${ssotPath}/operations/workflow.json whose home component has location ".".`;
  return `Project memory has no single home: ${competing}. `
    + `AtlasMind will not load or write project memory until that is settled, rather than pick one. ${fix}`;
}
