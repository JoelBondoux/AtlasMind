import { describe, expect, it } from 'vitest';
import { specialistGuidanceSkill } from '../../src/skills/specialistGuidance.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

const context = {} as SkillExecutionContext;

describe('specialist-guidance skill', () => {
  it.each([
    ['technical-seo', 'rendered HTML'],
    ['structured-data', 'Never invent ratings'],
    ['content-discoverability', 'named primary sources'],
    ['platform-listing', 'field limits'],
    ['accessibility', 'keyboard-only input'],
    ['responsive-layout', 'content failure'],
    ['interaction-design', 'recovery states'],
    ['ui-implementation', 'existing primitives'],
  ])('returns focused guidance for %s', async (topic, expectedText) => {
    const result = await specialistGuidanceSkill.execute({ topic }, context);

    expect(result).toContain(`Specialist guidance — ${topic}`);
    expect(result).toContain(expectedText);
    expect(result).toContain('not evidence that any current platform rule or standard has been verified');
  });

  it('rejects an unsupported topic', async () => {
    const result = await specialistGuidanceSkill.execute({ topic: 'keyword-stuffing' }, context);

    expect(result).toContain('Error');
    expect(result).toContain('technical-seo');
  });

  it('rejects a missing topic', async () => {
    const result = await specialistGuidanceSkill.execute({}, context);

    expect(result).toContain('Error');
  });
});
