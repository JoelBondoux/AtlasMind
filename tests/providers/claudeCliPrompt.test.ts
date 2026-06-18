import { describe, expect, it } from 'vitest';
import { buildClaudeCliPrompt } from '../../src/providers/claude-cli.ts';
import type { ChatMessage } from '../../src/providers/adapter.ts';

const msg = (role: ChatMessage['role'], content: string): ChatMessage => ({ role, content });

describe('buildClaudeCliPrompt — brain-role context budget', () => {
  it('gives a single large latest turn (planning/synthesis) far more than the old 4k cap', () => {
    const goalAndMemory = `Goal: build feature\n\n${'M'.repeat(20_000)}`;
    const { prompt } = buildClaudeCliPrompt([
      msg('system', 'Planning instructions and skill catalog.'),
      msg('user', goalAndMemory),
    ]);

    // The latest message now carries up to ~16k chars, well beyond the previous 4k.
    expect((prompt.match(/M/g) ?? []).length).toBeGreaterThan(12_000);
    // Still bounded for the OS command-line limit (Windows ~32,767).
    expect(prompt.length).toBeLessThan(28_000);
  });

  it('truncates history small while keeping total within the command-line budget', () => {
    const { prompt } = buildClaudeCliPrompt([
      msg('user', 'H'.repeat(10_000)),
      msg('assistant', 'A'.repeat(10_000)),
      msg('user', 'L'.repeat(20_000)),
    ]);

    // History messages are each capped near 2.5k.
    expect((prompt.match(/H/g) ?? []).length).toBeLessThanOrEqual(2_600);
    expect((prompt.match(/A/g) ?? []).length).toBeLessThanOrEqual(2_600);
    // The latest turn still gets a large share, and the total stays bounded.
    expect((prompt.match(/L/g) ?? []).length).toBeGreaterThan(8_000);
    expect(prompt.length).toBeLessThan(28_000);
  });

  it('reduces the latest budget when history is large so the total never overflows', () => {
    // Four full history messages plus a huge latest turn.
    const history = Array.from({ length: 4 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', 'X'.repeat(10_000)));
    const { prompt } = buildClaudeCliPrompt([...history, msg('user', 'Z'.repeat(30_000))]);
    expect(prompt.length).toBeLessThan(28_000);
  });
});
