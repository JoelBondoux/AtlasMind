import type { SkillDefinition } from '../types.js';

const SKILL_CODE_BLOCK = /```(?:javascript|js)?\s*([\s\S]*?)```/i;

export function toSuggestedSkillId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  const normalized = slug.length > 0 ? slug : 'generated-skill';
  return /^[a-z]/.test(normalized) ? normalized : `skill-${normalized}`;
}

export function extractGeneratedSkillCode(response: string): string {
  const fenced = response.match(SKILL_CODE_BLOCK)?.[1];
  return (fenced ?? response).trim();
}

export function buildSkillDraftPrompt(input: { skillId: string; goal: string }): string {
  return [
    'Generate a CommonJS AtlasMind custom skill module.',
    `Skill id: ${input.skillId}`,
    `Goal: ${input.goal}`,
    '',
    'Return only JavaScript source code.',
    'Required constraints:',
    '- Export the skill as module.exports.skill or exports.skill.',
    '- Use only AtlasMind SkillExecutionContext methods for file and memory access.',
    '- Do not use eval, Function, child_process, shell execution, process.env, direct fs imports, or direct network fetches.',
    '- Prefer simple deterministic code with explicit parameter validation.',
    '- The parameters field must be valid JSON Schema.',
    '- The execute function must return a string.',
  ].join('\n');
}

/**
 * Richer synthesis prompt used when the orchestrator auto-generates a skill
 * mid-loop to satisfy a tool call the model requested but no skill exists for.
 */
export function buildAutoSynthesisPrompt(input: {
  toolName: string;
  toolArguments: Record<string, unknown>;
  agentRole: string;
  recentUserMessage: string;
}): string {
  const argsPreview = JSON.stringify(input.toolArguments, null, 2);
  return [
    'Generate a CommonJS AtlasMind custom skill module.',
    `Skill id: ${input.toolName}`,
    `Agent role: ${input.agentRole}`,
    `User request: ${input.recentUserMessage}`,
    `The model called this tool with arguments:\n${argsPreview}`,
    '',
    'Implement the skill so it fulfils the intent implied by the tool name and arguments.',
    'Return only JavaScript source code.',
    'Required constraints:',
    '- Export the skill as module.exports.skill or exports.skill.',
    '- The skill object must have: id (string), name (string), description (string), parameters (JSON Schema object), execute (async function).',
    '- Use only AtlasMind SkillExecutionContext methods: readFile, writeFile, findFiles, searchInFiles, runCommand, queryMemory, upsertMemory, deleteMemory, getGitStatus, getGitDiff, getGitLog, gitBranch, applyGitPatch, listDirectory, getDiagnostics, fetchUrl.',
    '- Do not use eval, Function constructor, child_process, shell execution, process.env, direct require("fs"), or direct network fetches outside fetchUrl.',
    '- Prefer simple deterministic code with explicit parameter validation.',
    '- The parameters field must be valid JSON Schema.',
    '- The execute function must return a Promise<string>.',
  ].join('\n');
}

export interface LoadedSkill {
  skill: SkillDefinition;
}

export interface SkillLoadError {
  error: string;
}

/**
 * Evaluate CommonJS skill source in-process and return the exported SkillDefinition.
 * Used by auto-synthesis to avoid a filesystem round-trip during the agentic loop.
 */
export function loadSkillFromSource(source: string): LoadedSkill | SkillLoadError {
  let mod: { exports: Record<string, unknown> };
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function('module', 'exports', 'require', source);
    const fakeModule = { exports: {} as Record<string, unknown> };
    // Provide a restricted require that blocks dangerous imports.
    const safeRequire = (id: string): never => {
      throw new Error(`Skill synthesis: require("${id}") is not permitted in auto-generated skills.`);
    };
    factory(fakeModule, fakeModule.exports, safeRequire);
    mod = fakeModule;
  } catch (err) {
    return { error: `Skill source evaluation failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const exported = (mod.exports['skill'] ?? mod.exports['default']) as SkillDefinition | undefined;
  if (
    !exported ||
    typeof exported !== 'object' ||
    typeof exported.id !== 'string' ||
    typeof exported.name !== 'string' ||
    typeof exported.execute !== 'function'
  ) {
    return { error: 'Skill source does not export a valid SkillDefinition (requires id, name, execute).' };
  }

  return { skill: exported };
}
