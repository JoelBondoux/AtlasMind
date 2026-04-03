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