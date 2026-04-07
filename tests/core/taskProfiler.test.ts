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

  it('escalates important thread-based follow-ups beyond low reasoning', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'This is important. Based on the chat thread so far, recommend the safest next step.',
      context: {
        sessionContext: 'User: We discussed deployment trade-offs and failure risks.\n\nAssistant: We compared local and hosted model options.',
      },
      phase: 'execution',
      requiresTools: false,
    });

    expect(profile.reasoning).toBe('high');
    expect(profile.preferredCapabilities).toContain('reasoning');
  });

  it('treats chat sidebar UI regressions as code work instead of plain text', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'The chat sidebar is too tall and hides the Sessions dropdown when scrolled down.',
      phase: 'execution',
      requiresTools: true,
    });

    expect(profile.modality).toBe('code');
    expect(profile.reasoning).toBe('medium');
    expect(profile.preferredCapabilities).toContain('code');
  });

  it('treats interface color changes as code work rather than vision-only work', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'Can you change the colour of the interface to yellow?',
      phase: 'execution',
      requiresTools: true,
    });

    expect(profile.modality).toBe('code');
    expect(profile.requiredCapabilities).not.toContain('vision');
    expect(profile.requiredCapabilities).toContain('function_calling');
    expect(profile.preferredCapabilities).toContain('code');
  });

  it('treats attached images as vision work even without explicit screenshot wording', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'Tell me what is wrong here.',
      context: {
        imageAttachments: [
          {
            source: 'clipboard/screenshot.png',
            mimeType: 'image/png',
            dataBase64: 'ZmFrZQ==',
          },
        ],
      },
      phase: 'execution',
      requiresTools: false,
    });

    expect(profile.modality).toBe('vision');
    expect(profile.requiredCapabilities).toContain('vision');
  });
});