import * as vscode from 'vscode';

import {
  LENS_CONTRACT_MAPPING_FILE,
  normalizeLensContractMappingFile,
} from '../core/lensContract.js';
import { resolveLensContractRelations } from '../core/lensContractRelations.js';
import {
  extractJsonContractSources,
  extractSqlContractSources,
  extractTypeScriptContractSources,
} from '../core/lensContractSources.js';
import type {
  LensContract,
  LensContractMappingFile,
  LensContractRelation,
  LensWorkspaceIdentity,
} from '../types.js';
import { LensContractReviewPanel } from './lensContractReviewPanel.js';

const MAX_SOURCE_FILES = 200;
const MAX_DISCOVERED_CONTRACTS = 200;
const SOURCE_GLOB = '**/*.{json,sql,ts,tsx}';
const SOURCE_EXCLUDE = '**/{node_modules,.git,out,dist,build,coverage,vendor,.next}/**';

interface ContractPick extends vscode.QuickPickItem {
  contract: LensContract;
}

interface DiscoveryResult {
  contracts: LensContract[];
  relations: LensContractRelation[];
  notices: string[];
}

/** User-triggered, model-free discovery and review of two adjacent contract declarations. */
export async function reviewWorkspaceContractWiring(): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showInformationMessage('Open a workspace before reviewing AtlasMind Lens contract wiring.');
    return;
  }
  const discovery = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'AtlasMind Lens: discovering contract declarations',
      cancellable: true,
    },
    async (progress, token) => discoverContracts(progress, token),
  );
  if (discovery.contracts.length < 2) {
    void vscode.window.showInformationMessage(
      'AtlasMind Lens found fewer than two supported OpenAPI, JSON Schema, or SQL contract declarations.',
    );
    return;
  }

  const upstreamPick = await vscode.window.showQuickPick(toPicks(discovery.contracts), {
    title: 'AtlasMind Lens — choose the upstream contract',
    placeHolder: 'Choose the declaration before the wiring boundary',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!upstreamPick) {
    return;
  }
  const upstreamWorkspace = upstreamPick.contract.target?.workspace;
  const downstreamContracts = discovery.contracts.filter(contract =>
    contract.id !== upstreamPick.contract.id &&
    sameWorkspace(contract.target?.workspace, upstreamWorkspace),
  );
  const downstreamPick = await vscode.window.showQuickPick(toPicks(downstreamContracts), {
    title: 'AtlasMind Lens — choose the downstream contract',
    placeHolder: 'Choose the declaration after the wiring boundary',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!downstreamPick) {
    return;
  }

  const mappingFile = await loadMappingFile(upstreamPick.contract);
  if (!mappingFile) {
    return;
  }
  LensContractReviewPanel.createOrShow({
    upstream: upstreamPick.contract,
    downstream: downstreamPick.contract,
    mappingFile,
    relations: discovery.relations,
    sourceNotices: discovery.notices,
  });
}

async function discoverContracts(
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken,
): Promise<DiscoveryResult> {
  const uris = await vscode.workspace.findFiles(SOURCE_GLOB, SOURCE_EXCLUDE, MAX_SOURCE_FILES);
  const contracts: LensContract[] = [];
  const relations: LensContractRelation[] = [];
  const notices: string[] = [];
  for (let index = 0; index < uris.length && contracts.length < MAX_DISCOVERED_CONTRACTS; index += 1) {
    if (token.isCancellationRequested) {
      notices.push('Contract discovery was cancelled; the partial declaration set is shown.');
      break;
    }
    const uri = uris[index]!;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const workspacePath = normalizeRelativePath(vscode.workspace.asRelativePath(uri, false));
    if (!folder || !workspacePath || !isCandidateSource(workspacePath)) {
      continue;
    }
    progress.report({ message: workspacePath, increment: uris.length > 0 ? 100 / uris.length : undefined });
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const input = {
        workspace: { name: folder.name, index: folder.index },
        workspacePath,
        text: document.getText(),
      };
      const lowerPath = workspacePath.toLowerCase();
      const extraction = lowerPath.endsWith('.sql')
        ? extractSqlContractSources(input)
        : lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')
          ? extractTypeScriptContractSources(input)
          : extractJsonContractSources(input);
      contracts.push(...extraction.contracts.slice(0, MAX_DISCOVERED_CONTRACTS - contracts.length));
      if (extraction.relations) {
        relations.push(...extraction.relations.slice(0, Math.max(0, 500 - relations.length)));
      }
      if (extraction.contracts.length > 0) {
        notices.push(...extraction.notices.map(notice => `${workspacePath}: ${notice}`));
      }
    } catch {
      notices.push(`${workspacePath}: the declaration could not be read.`);
    }
  }
  if (uris.length >= MAX_SOURCE_FILES) {
    notices.push(`Discovery inspected at most ${MAX_SOURCE_FILES} candidate files.`);
  }
  const resolvedRelations = resolveLensContractRelations(relations, contracts) ?? [];
  const unresolvedCount = resolvedRelations.filter(relation => !relation.from.fieldId || !relation.to.fieldId).length;
  if (unresolvedCount > 0) {
    notices.push(`${unresolvedCount} declared relationship endpoint(s) remain unresolved in the bounded declaration set.`);
  }
  return { contracts, relations: resolvedRelations, notices: notices.slice(0, 50) };
}

async function loadMappingFile(contract: LensContract): Promise<LensContractMappingFile | undefined> {
  const identity = contract.target?.workspace;
  const folder = identity
    ? vscode.workspace.workspaceFolders?.find(candidate => sameWorkspace(
      { name: candidate.name, index: candidate.index },
      identity,
    ))
    : undefined;
  if (!folder) {
    void vscode.window.showWarningMessage('AtlasMind Lens could not resolve the contract workspace root.');
    return undefined;
  }
  const uri = vscode.Uri.joinPath(folder.uri, ...LENS_CONTRACT_MAPPING_FILE.split('/'));
  let raw: unknown = { version: 1, mappings: [], suppressions: [] };
  try {
    raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as unknown;
  } catch (error) {
    if (!isFileNotFound(error)) {
      void vscode.window.showWarningMessage(
        `AtlasMind Lens refused ${LENS_CONTRACT_MAPPING_FILE} because it is malformed or unreadable.`,
      );
      return undefined;
    }
  }
  const mappingFile = normalizeLensContractMappingFile(raw);
  if (!mappingFile) {
    void vscode.window.showWarningMessage(
      `AtlasMind Lens refused invalid entries in ${LENS_CONTRACT_MAPPING_FILE}.`,
    );
  }
  return mappingFile;
}

function toPicks(contracts: LensContract[]): ContractPick[] {
  return contracts.map(contract => ({
    label: `$(symbol-structure) ${contract.label}`,
    description: `${contract.layer} · ${contract.sourceKind}`,
    detail: `${contract.target?.workspace.name ?? 'workspace'} :: ${contract.target?.workspacePath ?? 'unknown source'} · ${contract.coverage} coverage`,
    contract,
  }));
}

function isCandidateSource(workspacePath: string): boolean {
  const lower = workspacePath.toLowerCase();
  if (lower === LENS_CONTRACT_MAPPING_FILE || lower.endsWith('.sql')) {
    return lower !== LENS_CONTRACT_MAPPING_FILE;
  }
  const fileName = lower.split('/').at(-1) ?? lower;
  if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) {
    return !fileName.endsWith('.d.ts') &&
      /(?:dto|model|schema|types?|entity|contract|interface|request|response)/.test(fileName);
  }
  return /(?:openapi|swagger|schema|contract)/.test(fileName);
}

function sameWorkspace(
  left: LensWorkspaceIdentity | undefined,
  right: LensWorkspaceIdentity | undefined,
): boolean {
  return Boolean(left && right && left.name === right.name && left.index === right.index);
}

function isFileNotFound(value: unknown): boolean {
  return isRecord(value) && (value.code === 'FileNotFound' || value.name === 'EntryNotFound (FileSystemError)');
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..')
    ? undefined
    : segments.join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
