import { describe, expect, it } from 'vitest';
import { classifyToolInvocation } from '../../src/core/toolPolicy.ts';

describe('classifyToolInvocation terminal safety', () => {
  it('classifies node inline execution as terminal-write', () => {
    const policy = classifyToolInvocation('terminal-run', {
      command: 'node',
      args: ['-e', 'console.log(1)'],
    });

    expect(policy.category).toBe('terminal-write');
    expect(policy.risk).toBe('high');
  });

  it('classifies node version checks as terminal-read', () => {
    const policy = classifyToolInvocation('terminal-run', {
      command: 'node',
      args: ['--version'],
    });

    expect(policy.category).toBe('terminal-read');
  });

  it('keeps npm run test classified as terminal-read', () => {
    const policy = classifyToolInvocation('terminal-run', {
      command: 'npm',
      args: ['run', 'test'],
    });

    expect(policy.category).toBe('terminal-read');
  });
});