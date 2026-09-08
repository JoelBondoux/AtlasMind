import { Script, createContext, runInContext } from 'node:vm';

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
    '- Do not generate functionality that facilitates illegal activity, legal evasion, fraud, harassment, abuse, or rights violations.',
    '- Do not generate functionality intended to harm, discredit, disparage, or lie about any person.',
    '- These safety constraints are non-overrideable.',
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
    '- Do not generate functionality that facilitates illegal activity, legal evasion, fraud, harassment, abuse, or rights violations.',
    '- Do not generate functionality intended to harm, discredit, disparage, or lie about any person.',
    '- These safety constraints are non-overrideable.',
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

/** Bounds a generated module's *top level*, which runs the moment it is evaluated. */
const SKILL_EVALUATION_TIMEOUT_MS = 2_000;

/**
 * Everything the generated module can see, defined **inside** the context.
 *
 * Written as source rather than assigned onto the context object, and that is
 * the whole trick: a host function placed on a context is reachable as
 * `require.constructor.constructor`, which is the Function constructor of the
 * *host* realm and hands back `process`. Objects minted inside the context have
 * the context's own prototype chain, so the same expression yields nothing.
 * Measured both ways before choosing.
 */
const CONTEXT_PRELUDE = [
  'var module = { exports: {} };',
  'var exports = module.exports;',
  'var require = function (id) {',
  '  throw new Error("require(\\"" + id + "\\") is not permitted in a generated skill.");',
  '};',
].join('\n');

/**
 * Evaluate CommonJS skill source and return the exported SkillDefinition.
 *
 * **This is containment, not a sandbox, and the difference is not pedantry.**
 * Evaluation happens in a fresh `node:vm` context with no ambient globals, which
 * closes every route measured against the previous implementation. What it does
 * not close is the skill's own execution surface: `execute(args, ctx)` receives
 * a real `SkillExecutionContext`, and any host object handed across the boundary
 * carries its own realm's `Function` on its prototype chain —
 * `ctx.readFile.constructor.constructor('return process')()` reaches the host.
 * That is inherent to giving a skill callbacks at all, so it is stated here,
 * pinned by a test, and answered by the approval gate rather than by pretending
 * the boundary is stronger than it is.
 *
 * What changed, measured rather than argued. The previous implementation was
 * `new Function('module','exports','require', source)`, whose body runs in the
 * extension host's own global scope with a `require` parameter that throws.
 * Eight routes to `node:fs` were tried against it; **seven reached**, including
 * `import('node:fs')` (dynamic import is syntax, not the shadowed identifier)
 * and `process.mainModule.require('node:fs')`. Against this implementation all
 * eight are refused at evaluation — `import()` throws *"A dynamic import
 * callback was not specified"* because none is supplied, and `process` is
 * simply not a name in the context.
 *
 * The `timeout` bounds the module's top level, which runs on evaluation. A
 * generated skill therefore cannot hang the extension host merely by being
 * loaded — which mattered because evaluation used to happen before anybody had
 * approved anything.
 */
export function loadSkillFromSource(source: string): LoadedSkill | SkillLoadError {
  let mod: { exports: Record<string, unknown> };
  try {
    const context = createContext({});
    runInContext(CONTEXT_PRELUDE, context);
    new Script(source).runInContext(context, { timeout: SKILL_EVALUATION_TIMEOUT_MS });
    mod = { exports: runInContext('module.exports', context) as Record<string, unknown> };
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
