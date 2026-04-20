import { describe, it, expect } from 'vitest';
import { extractIndividualTests } from './settingsPanel';

describe('extractIndividualTests', () => {
  it('should include a status field in the returned test cases', () => {
    const fileText = `
      describe('My test suite', () => {
        it('should do something', () => {
          // test implementation
        });
      });
    `;
    const relativePath = 'tests/my-test.spec.ts';
    const category = 'unit';
    const tests = extractIndividualTests(fileText, relativePath, category);
    expect(tests[0]).toHaveProperty('status');
    expect(tests[0].status).toBe('unknown');
  });
});
