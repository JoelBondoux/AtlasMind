import { describe, expect, it } from 'vitest';
import { buildSkillDraftPrompt, extractGeneratedSkillCode, toSuggestedSkillId } from '../../src/core/skillDrafting.ts';

describe('skillDrafting helpers', () => {
  it('creates a stable skill identifier from natural language text', () => {
    expect(toSuggestedSkillId('Search the workspace for TODO comments')).toBe('search-the-workspace-for-todo-comments');
    expect(toSuggestedSkillId('123 images')).toBe('skill-123-images');
  });

  it('extracts code from fenced model output', () => {
    const code = extractGeneratedSkillCode('```javascript\nexports.skill = { id: "demo" };\n```');
    expect(code).toContain('exports.skill');
    expect(code.startsWith('exports.skill')).toBe(true);
  });

  it('builds a prompt containing the required safety constraints', () => {
    const prompt = buildSkillDraftPrompt({
      skillId: 'todo-summarizer',
      goal: 'Scan the workspace for TODO comments and summarize them.',
    });

    expect(prompt).toContain('todo-summarizer');
    expect(prompt).toContain('Return only JavaScript source code.');
    expect(prompt).toContain('Do not use eval');
  });
});