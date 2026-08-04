import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { LENS_CONFIG_FILE, normalizeLensConfigFile } from './lensConfigResolution.js';
import { LENS_CONTRACT_MAPPING_FILE, normalizeLensContractMappingFile } from './lensContract.js';
import { LENS_DATA_TRUST_FILE, normalizeLensDataTrustPolicyFile } from './lensDataTrust.js';
import { LENS_STATE_FILE, normalizeLensStateMachineFile } from './lensStateMachine.js';

export type LensDeclarationKind = 'state' | 'config' | 'mappings' | 'trust';
export type LensDeclarationFileStatus = 'missing' | 'empty' | 'ready' | 'invalid' | 'unreadable' | 'unavailable';

export interface LensDeclarationStatus {
  kind: LensDeclarationKind;
  label: string;
  workspacePath: string;
  status: LensDeclarationFileStatus;
  declarationCount: number;
  /**
   * Whether a lens *refuses to open* without this file.
   *
   * The load-bearing distinction in this module. Two of these files are gates —
   * State Lifecycle and Configuration Resolution have nothing to read without
   * them — and two are refinements that make an already-working lens sharper.
   * Counting a refinement as an outstanding requirement is how a fully
   * configured project gets told forever that it is half done.
   */
  required: boolean;
  /** One line on what the file declares, so every surface says the same thing. */
  purpose: string;
}

export interface LensDeclarationsSnapshot {
  /** All four files, required and optional alike. Filter on `required`. */
  files: LensDeclarationStatus[];
  /**
   * Ready and total counts for the **required** files only.
   *
   * Deliberately not "all files ready". These two feed a stat card that turns
   * green on equality, and a project that has declared its state machines and
   * its configuration precedence is finished — being marked amber because it
   * never wrote an optional mappings override would make the card meaningless.
   */
  readyCount: number;
  totalCount: number;
  /** The same counts for the optional refinements, reported separately. */
  optionalReadyCount: number;
  optionalTotalCount: number;
}

interface LensDeclarationDescriptor {
  kind: LensDeclarationKind;
  label: string;
  workspacePath: string;
  required: boolean;
  purpose: string;
}

/**
 * The declaration table.
 *
 * `purpose` lives here rather than in each surface's copy, because the QuickPick,
 * the setup walkthrough, the dashboard card, and the drafting prompt all have to
 * describe the same file, and four hand-written descriptions of one file drift
 * until they contradict each other in front of somebody trying to write it.
 */
const DECLARATIONS: readonly LensDeclarationDescriptor[] = [
  {
    kind: 'state',
    label: 'State Lifecycle',
    workspacePath: LENS_STATE_FILE,
    required: true,
    purpose: 'The states a thing in your project moves through, and what moves it. One entry per lifecycle you care about — an order, a job, a session.',
  },
  {
    kind: 'config',
    label: 'Configuration Resolution',
    workspacePath: LENS_CONFIG_FILE,
    required: true,
    purpose: 'Where each setting can come from and which source wins. One entry per setting whose value is worth tracing back.',
  },
  {
    kind: 'mappings',
    label: 'Field Wiring overrides',
    workspacePath: LENS_CONTRACT_MAPPING_FILE,
    required: false,
    purpose: 'Corrections to how Field Wiring pairs fields across two contracts, plus the pairs you have deliberately decided not to wire.',
  },
  {
    kind: 'trust',
    label: 'Data Trust policy',
    workspacePath: LENS_DATA_TRUST_FILE,
    required: false,
    purpose: 'How sensitive each contract field is and what controls it. AtlasMind never guesses this from field names or sample values.',
  },
];

/**
 * Inspect the declaration files the Lens views read.
 *
 * Deliberately read-only and synchronous so Settings, the Project Dashboard, and
 * the Lenses dashboard can show the same status without seeding repository files
 * merely because somebody opened a panel.
 */
export function inspectLensDeclarations(workspaceRoot?: string): LensDeclarationsSnapshot {
  const files = DECLARATIONS.map(declaration => inspectDeclaration(workspaceRoot, declaration));
  const required = files.filter(file => file.required);
  const optional = files.filter(file => !file.required);
  return {
    files,
    readyCount: required.filter(file => file.status === 'ready').length,
    totalCount: required.length,
    optionalReadyCount: optional.filter(file => file.status === 'ready').length,
    optionalTotalCount: optional.length,
  };
}

/** Every declaration kind, in the order a project would sensibly write them. */
export function lensDeclarationDescriptors(): readonly LensDeclarationDescriptor[] {
  return DECLARATIONS;
}

export function findLensDeclarationDescriptor(kind: LensDeclarationKind): LensDeclarationDescriptor {
  // Total by construction: `kind` is a closed union and every member is in the
  // table. The fallback exists so a future kind added to the union without a row
  // fails a test rather than throwing in front of a user mid-setup.
  return DECLARATIONS.find(declaration => declaration.kind === kind) ?? DECLARATIONS[0];
}

/** A valid, semantics-free starter. AtlasMind never invents project topology or values. */
export function buildLensDeclarationStarter(kind: LensDeclarationKind): string {
  return `${JSON.stringify(emptyDeclarationDocument(kind), null, 2)}\n`;
}

/** The empty document for a kind, as data — shared by the starter and the drafter's merge. */
export function emptyDeclarationDocument(kind: LensDeclarationKind): Record<string, unknown> {
  switch (kind) {
    case 'state': return { version: 1, machines: [] };
    case 'config': return { version: 1, settings: [] };
    case 'mappings': return { version: 1, mappings: [], suppressions: [] };
    case 'trust': return { version: 1, fields: [] };
  }
}

export function isLensDeclarationKind(value: unknown): value is LensDeclarationKind {
  return value === 'state' || value === 'config' || value === 'mappings' || value === 'trust';
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
  declaration: LensDeclarationDescriptor,
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

  // `undefined` from a normalizer means the whole document is refused, which is
  // a different fact from "it parsed and declares nothing" — so the count is
  // only meaningful once the document normalized.
  const count = countDeclarations(declaration.kind, parsed);
  return {
    ...declaration,
    status: count === undefined ? 'invalid' : count > 0 ? 'ready' : 'empty',
    declarationCount: count ?? 0,
  };
}

/** How many declarations a normalized document holds, or `undefined` if it was refused. */
function countDeclarations(kind: LensDeclarationKind, parsed: unknown): number | undefined {
  switch (kind) {
    case 'state':
      return normalizeLensStateMachineFile(parsed)?.machines.length;
    case 'config':
      return normalizeLensConfigFile(parsed)?.settings.length;
    case 'mappings': {
      const normalized = normalizeLensContractMappingFile(parsed);
      if (!normalized) {
        return undefined;
      }
      // A file that only suppresses pairs is a real, deliberate declaration —
      // counting mappings alone would report it as an untouched starter.
      return normalized.mappings.length + normalized.suppressions.length;
    }
    case 'trust':
      return normalizeLensDataTrustPolicyFile(parsed)?.fields.length;
  }
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT';
}
