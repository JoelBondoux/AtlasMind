import { describe, expect, it } from 'vitest';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';

describe('TaskProfiler', () => {
  it('infers mixed modality when prompts mention both screenshots and code issues', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'Inspect this screenshot and debug the stack trace in the TypeScript app.',
      phase: 'execution',
      requiresTools: false,
    });

    expect(profile.modality).toBe('mixed');
    expect(profile.requiredCapabilities).toContain('vision');
    expect(profile.preferredCapabilities).toContain('code');
  });

  it('adds function calling when tools are required', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'Read the repository and patch the failing test.',
      phase: 'execution',
      requiresTools: true,
    });

    expect(profile.requiresTools).toBe(true);
    expect(profile.requiredCapabilities).toContain('function_calling');
  });

  it('treats planning as high reasoning work', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'Design a migration plan for the model routing layer.',
      phase: 'planning',
      requiresTools: false,
    });

    expect(profile.reasoning).toBe('high');
    expect(profile.preferredCapabilities).toContain('reasoning');
  });
});