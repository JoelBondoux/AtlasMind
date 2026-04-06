import type { SkillDefinition } from '../types.js';
import { fileReadSkill } from './fileRead.js';
import { fileWriteSkill } from './fileWrite.js';
import { fileSearchSkill } from './fileSearch.js';
import { textSearchSkill } from './textSearch.js';
import { directoryListSkill } from './directoryList.js';
import { terminalRunSkill } from './terminalRun.js';
import { fileEditSkill } from './fileEdit.js';
import { memoryQuerySkill } from './memoryQuery.js';
import { memoryWriteSkill } from './memoryWrite.js';
import { memoryDeleteSkill } from './memoryDelete.js';
import { gitApplyPatchSkill } from './gitApplyPatch.js';
import { gitStatusSkill } from './gitStatus.js';
import { gitDiffSkill } from './gitDiff.js';
import { gitCommitSkill } from './gitCommit.js';
import { rollbackCheckpointSkill } from './rollbackCheckpoint.js';
import { diagnosticsSkill } from './diagnostics.js';
import { codeSymbolsSkill } from './codeSymbols.js';
import { renameSymbolSkill } from './renameSymbol.js';
import { webFetchSkill } from './webFetch.js';
import { testRunSkill } from './testRun.js';
import { fileDeleteSkill, fileMoveSkill } from './fileManage.js';
import { gitLogSkill, gitBranchSkill } from './gitBranch.js';
import { diffPreviewSkill } from './diffPreview.js';
import { codeActionSkill } from './codeAction.js';
import { exaSearchSkill } from './exaSearch.js';
import { debugSessionSkill } from './debugSession.js';
import { workspaceObservabilitySkill } from './workspaceObservability.js';
import { terminalReadSkill } from './terminalRead.js';
import { vscodeExtensionsSkill } from './vscodeExtensions.js';

export {
  fileReadSkill,
  fileWriteSkill,
  fileSearchSkill,
  textSearchSkill,
  directoryListSkill,
  terminalRunSkill,
  fileEditSkill,
  memoryQuerySkill,
  memoryWriteSkill,
  memoryDeleteSkill,
  gitApplyPatchSkill,
  gitStatusSkill,
  gitDiffSkill,
  gitCommitSkill,
  rollbackCheckpointSkill,
  diagnosticsSkill,
  codeSymbolsSkill,
  renameSymbolSkill,
  webFetchSkill,
  testRunSkill,
  fileDeleteSkill,
  fileMoveSkill,
  gitLogSkill,
  gitBranchSkill,
  diffPreviewSkill,
  codeActionSkill,
  exaSearchSkill,
  debugSessionSkill,
  workspaceObservabilitySkill,
  terminalReadSkill,
  vscodeExtensionsSkill,
};

/**
 * Returns the full set of built-in skills to register on extension activation.
 */
export function createBuiltinSkills(): SkillDefinition[] {
  return [
    withPanelPath(fileReadSkill, 'Workspace Files'),
    withPanelPath(fileWriteSkill, 'Workspace Files'),
    withPanelPath(fileSearchSkill, 'Workspace Files'),
    withPanelPath(textSearchSkill, 'Search & Fetch'),
    withPanelPath(directoryListSkill, 'Workspace Files'),
    withPanelPath(terminalRunSkill, 'Execution & Testing'),
    withPanelPath(fileEditSkill, 'Workspace Files'),
    withPanelPath(memoryQuerySkill, 'Memory'),
    withPanelPath(memoryWriteSkill, 'Memory'),
    withPanelPath(memoryDeleteSkill, 'Memory'),
    withPanelPath(gitApplyPatchSkill, 'Git & Review'),
    withPanelPath(gitStatusSkill, 'Git & Review'),
    withPanelPath(gitDiffSkill, 'Git & Review'),
    withPanelPath(gitCommitSkill, 'Git & Review'),
    withPanelPath(rollbackCheckpointSkill, 'Git & Review'),
    withPanelPath(diagnosticsSkill, 'Code Intelligence'),
    withPanelPath(codeSymbolsSkill, 'Code Intelligence'),
    withPanelPath(renameSymbolSkill, 'Code Intelligence'),
    withPanelPath(webFetchSkill, 'Search & Fetch'),
    withPanelPath(testRunSkill, 'Execution & Testing'),
    withPanelPath(fileDeleteSkill, 'Workspace Files'),
    withPanelPath(fileMoveSkill, 'Workspace Files'),
    withPanelPath(gitLogSkill, 'Git & Review'),
    withPanelPath(gitBranchSkill, 'Git & Review'),
    withPanelPath(diffPreviewSkill, 'Git & Review'),
    withPanelPath(codeActionSkill, 'Code Intelligence'),
    withPanelPath(exaSearchSkill, 'Search & Fetch'),
    withPanelPath(debugSessionSkill, 'Execution & Testing'),
    withPanelPath(workspaceObservabilitySkill, 'Execution & Testing'),
    withPanelPath(terminalReadSkill, 'Execution & Testing'),
    withPanelPath(vscodeExtensionsSkill, 'VS Code'),
  ];
}

function withPanelPath(skill: SkillDefinition, ...panelPath: string[]): SkillDefinition {
  return {
    ...skill,
    panelPath,
  };
}
