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
import { gitApplyPatchSkill } from './gitApplyPatch.js';
import { gitStatusSkill } from './gitStatus.js';
import { gitDiffSkill } from './gitDiff.js';
import { gitCommitSkill } from './gitCommit.js';
import { rollbackCheckpointSkill } from './rollbackCheckpoint.js';

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
  gitApplyPatchSkill,
  gitStatusSkill,
  gitDiffSkill,
  gitCommitSkill,
  rollbackCheckpointSkill,
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
    gitApplyPatchSkill,
    gitStatusSkill,
    gitDiffSkill,
    gitCommitSkill,
    rollbackCheckpointSkill,
  ];
}
