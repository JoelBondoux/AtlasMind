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
  ];
}
