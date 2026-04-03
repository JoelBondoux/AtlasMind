import type { SkillDefinition } from '../types.js';
import { fileReadSkill } from './fileRead.js';
import { fileWriteSkill } from './fileWrite.js';
import { fileSearchSkill } from './fileSearch.js';
import { memoryQuerySkill } from './memoryQuery.js';
import { memoryWriteSkill } from './memoryWrite.js';
import { gitApplyPatchSkill } from './gitApplyPatch.js';

export { fileReadSkill, fileWriteSkill, fileSearchSkill, memoryQuerySkill, memoryWriteSkill, gitApplyPatchSkill };

/**
 * Returns the full set of built-in skills to register on extension activation.
 */
export function createBuiltinSkills(): SkillDefinition[] {
  return [
    fileReadSkill,
    fileWriteSkill,
    fileSearchSkill,
    memoryQuerySkill,
    memoryWriteSkill,
    gitApplyPatchSkill,
  ];
}
