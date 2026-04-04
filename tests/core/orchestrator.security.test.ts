import { describe, expect, it, vi } from 'vitest';
import { validateToolArguments } from '../../src/core/orchestrator.ts';
import type { SkillDefinition } from '../../src/types.ts';

function makeSkill(parameters: Record<string, unknown>): SkillDefinition {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'test',
    parameters,
    execute: vi.fn().mockResolvedValue('ok'),
  };
}

describe('validateToolArguments', () => {
  it('passes when all required parameters are present', () => {
    const skill = makeSkill({
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    });
    expect(validateToolArguments(skill, { path: '/foo.ts' })).toBeUndefined();
  });

  it('rejects when a required parameter is missing', () => {
    const skill = makeSkill({
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
    });
    const err = validateToolArguments(skill, { path: '/foo.ts' });
    expect(err).toContain('missing required parameter "content"');
  });

  it('rejects when a required parameter is null', () => {
    const skill = makeSkill({
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    });
    const err = validateToolArguments(skill, { path: null });
    expect(err).toContain('missing required parameter "path"');
  });

  it('rejects when a string parameter is a number', () => {
    const skill = makeSkill({
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    });
    const err = validateToolArguments(skill, { path: 123 });
    expect(err).toContain('must be type "string" but got "number"');
  });

  it('rejects when a boolean parameter is a string', () => {
    const skill = makeSkill({
      type: 'object',
      properties: { checkOnly: { type: 'boolean' } },
    });
    const err = validateToolArguments(skill, { checkOnly: 'true' });
    expect(err).toContain('must be type "boolean" but got "string"');
  });

  it('rejects non-integer value for integer type', () => {
    const skill = makeSkill({
      type: 'object',
      properties: { limit: { type: 'integer' } },
    });
    const err = validateToolArguments(skill, { limit: 3.14 });
    expect(err).toContain('must be an integer');
  });

  it('accepts integer value for integer type', () => {
    const skill = makeSkill({
      type: 'object',
      properties: { limit: { type: 'integer' } },
    });
    expect(validateToolArguments(skill, { limit: 5 })).toBeUndefined();
  });

  it('skips validation when skill has no schema', () => {
    const skill = makeSkill({});
    expect(validateToolArguments(skill, { anything: 'goes' })).toBeUndefined();
  });

  it('ignores extra arguments not in the schema', () => {
    const skill = makeSkill({
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    });
    expect(validateToolArguments(skill, { path: '/foo.ts', extra: 42 })).toBeUndefined();
  });
});
