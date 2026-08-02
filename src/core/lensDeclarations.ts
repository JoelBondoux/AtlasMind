import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { LENS_CONFIG_FILE, normalizeLensConfigFile } from './lensConfigResolution.js';
import { LENS_STATE_FILE, normalizeLensStateMachineFile } from './lensStateMachine.js';

export type LensDeclarationKind = 'state' | 'config';
export type LensDeclarationFileStatus = 'missing' | 'empty' | 'ready' | 'invalid' | 'unreadable' | 'unavailable';

export interface LensDeclarationStatus {
  kind: LensDeclarationKind;
  label: string;
  workspacePath: string;
  status: LensDeclarationFileStatus;
  declarationCount: number;
}

export interface LensDeclarationsSnapshot {
  files: LensDeclarationStatus[];
  readyCount: number;
  totalCount: number;
}

const DECLARATIONS: ReadonlyArray<{
  kind: LensDeclarationKind;
  label: string;
  workspacePath: string;
}> = [
  { kind: 'state', label: 'State Lifecycle', workspacePath: LENS_STATE_FILE },
  { kind: 'config', label: 'Configuration Resolution', workspacePath: LENS_CONFIG_FILE },
];

/**
 * Inspect the two declaration files that are required by standalone Lens views.
 *
 * This is deliberately read-only and synchronous so Settings and Project
 * Dashboard can show the same status without seeding repository files merely
 * because somebody opened a panel.
 */
export function inspectLensDeclarations(workspaceRoot?: string): LensDeclarationsSnapshot {
  const files = DECLARATIONS.map(declaration => inspectDeclaration(workspaceRoot, declaration));
  return {
    files,
    readyCount: files.filter(file => file.status === 'ready').length,
    totalCount: files.length,
  };
}

/** A valid, semantics-free starter. AtlasMind never invents project topology or values. */
export function buildLensDeclarationStarter(kind: LensDeclarationKind): string {
  const value = kind === 'state'
    ? { version: 1, machines: [] }
    : { version: 1, settings: [] };
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function isLensDeclarationKind(value: unknown): value is LensDeclarationKind {
  return value === 'state' || value === 'config';
}

export function lensDeclarationStatusLabel(status: LensDeclarationFileStatus): string {
  switch (status) {
    case 'ready': return 'Ready';
    case 'empty': return 'Starter needs declarations';
    case 'missing': return 'Missing';
    case 'invalid': return 'Invalid';
    case 'unreadable': return 'Unreadable';
    case 'unavailable': return 'No workspace';
  }
}

function inspectDeclaration(
  workspaceRoot: string | undefined,
  declaration: (typeof DECLARATIONS)[number],
): LensDeclarationStatus {
  if (!workspaceRoot) {
    return { ...declaration, status: 'unavailable', declarationCount: 0 };
  }

  let raw: string;
  try {
    raw = readFileSync(path.join(workspaceRoot, declaration.workspacePath), 'utf8');
  } catch (error) {
    return {
      ...declaration,
      status: isFileNotFound(error) ? 'missing' : 'unreadable',
      declarationCount: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ...declaration, status: 'invalid', declarationCount: 0 };
  }

  if (declaration.kind === 'state') {
    const normalized = normalizeLensStateMachineFile(parsed);
    const declarationCount = normalized?.machines.length ?? 0;
    return {
      ...declaration,
      status: !normalized ? 'invalid' : declarationCount > 0 ? 'ready' : 'empty',
      declarationCount,
    };
  }

  const normalized = normalizeLensConfigFile(parsed);
  const declarationCount = normalized?.settings.length ?? 0;
  return {
    ...declaration,
    status: !normalized ? 'invalid' : declarationCount > 0 ? 'ready' : 'empty',
    declarationCount,
  };
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT';
}
