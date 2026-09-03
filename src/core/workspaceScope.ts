/**
 * Resolve which workspace roots a caller explicitly asked to inspect.
 *
 * The default is intentionally the first VS Code workspace folder, preserving
 * existing behaviour until a surface opts into home/component/all resolution.
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
  reason: 'not-open' | 'unreadable' | 'ambiguous';
}

export interface WorkspaceScope {
  target: WorkspaceScopeTarget;
  label: string;
  roots: WorkspaceScopeRoot[];
  unknown: UnknownWorkspaceComponent[];
  complete: boolean;
}

function componentFolderMatches(
  component: ProjectComponent,
  folders: readonly WorkspaceFolderReference[],
): WorkspaceFolderReference[] {
  if (component.location === '.') {
    return folders.slice(0, 1);
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
): { root?: WorkspaceScopeRoot; unknown?: UnknownWorkspaceComponent } {
  const matches = componentFolderMatches(component, folders);
  if (matches.length === 0) {
    return { unknown: { componentId: component.id, componentLabel: component.label, reason: 'not-open' } };
  }
  if (matches.length > 1) {
    return { unknown: { componentId: component.id, componentLabel: component.label, reason: 'ambiguous' } };
  }
  const folder = matches[0]!;
  if (folder.readable === false) {
    return { unknown: { componentId: component.id, componentLabel: component.label, reason: 'unreadable' } };
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
 * composition is not consulted on that branch.
 */
export function resolveWorkspaceScope(
  folders: readonly WorkspaceFolderReference[],
  composition?: ProjectComposition,
  target: WorkspaceScopeTarget = { kind: 'default' },
): WorkspaceScope {
  if (target.kind === 'default') {
    const first = folders[0];
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

  const resolved = selected.map(component => resolveComponent(component, folders));
  const roots = resolved.flatMap(item => item.root ? [item.root] : []);
  const unknown = resolved.flatMap(item => item.unknown ? [item.unknown] : []);
  const baseLabel = target.kind === 'all' ? 'All declared components' : selected[0]!.label;
  const label = unknown.length > 0
    ? `${baseLabel} (${roots.length} of ${selected.length} visible)`
    : baseLabel;
  return { target, label, roots, unknown, complete: unknown.length === 0 };
}
