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

  it('treats terse actionable follow-ups with session context as code-oriented work', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'Can you handle that for me?',
      context: {
        sessionContext: 'Earlier in the chat we identified stale Dependabot branches in the repo and agreed the next step was to merge the newer dependency update branch.',
      },
      phase: 'execution',
      requiresTools: true,
    });

    expect(profile.modality).toBe('code');
    expect(profile.reasoning).toBe('high');
    expect(profile.requiredCapabilities).toContain('function_calling');
    expect(profile.preferredCapabilities).toContain('code');
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

  it('does not escalate simple git commit to high reasoning when session context contains architecture discussion', () => {
    // Regression: HIGH_REASONING_HINTS were previously tested against combinedText
    // (user message + session context), so a simple "commit" after discussing
    // architecture would be mis-classified as high-reasoning.
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'commit my changes',
      context: {
        sessionContext: 'User: Walk me through the architecture trade-offs for the new model router.\n\nAssistant: The key design patterns and security considerations are ...',
      },
      phase: 'execution',
      requiresTools: false,
    });

    expect(profile.reasoning).not.toBe('high');
    expect(profile.preferredCapabilities).not.toContain('reasoning');
  });

  it('keeps simple git push at low reasoning without session context', () => {
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'git push',
      phase: 'execution',
      requiresTools: false,
    });

    expect(profile.reasoning).toBe('low');
  });

  it('inherits high reasoning for terse follow-up questions in a complex session', () => {
    // Implicit thematic continuation: a short question like "what about the write path?"
    // has no explicit complexity markers of its own, but it is a follow-up to a
    // distributed-systems architecture discussion and should route to a capable model.
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'what about the write path?',
      context: {
        sessionContext: 'User: Walk me through the distributed consensus strategy and trade-offs for the write-ahead log.\n\nAssistant: The key architecture considerations here involve replication, consensus, and performance bottlenecks ...',
      },
      phase: 'execution',
      requiresTools: false,
    });

    expect(profile.reasoning).toBe('high');
    expect(profile.preferredCapabilities).toContain('reasoning');
  });

  it('does not inherit high reasoning for a maintenance task even when session was complex', () => {
    // MAINTENANCE_TASK_HINTS guard: "commit" must stay low-reasoning even when
    // the session context mentions architecture, distributed systems, etc.
    const profiler = new TaskProfiler();

    const profile = profiler.profileTask({
      userMessage: 'commit my changes',
      context: {
        sessionContext: 'User: Walk me through the distributed consensus strategy and trade-offs.\n\nAssistant: The key architecture considerations involve replication and consensus ...',
      },
      phase: 'execution',
      requiresTools: false,
    });

    expect(profile.reasoning).not.toBe('high');
    expect(profile.preferredCapabilities).not.toContain('reasoning');
  });
});