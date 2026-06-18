import { describe, expect, it } from 'vitest';
import { applyAnthropicPromptCaching, splitStableSystemPrefix } from '../../src/providers/anthropic.ts';

const tools = [
  { name: 'read_file', description: 'Read a file', input_schema: { type: 'object' } },
  { name: 'write_file', description: 'Write a file', input_schema: { type: 'object' } },
];

describe('applyAnthropicPromptCaching', () => {
  it('marks the system prompt and the last tool as cacheable when enabled', () => {
    const result = applyAnthropicPromptCaching('You are AtlasMind.', tools, true);

    // System becomes a content-block array with an ephemeral cache breakpoint.
    expect(Array.isArray(result.system)).toBe(true);
    const sysBlocks = result.system as Array<{ type: string; text: string; cache_control?: { type: string } }>;
    expect(sysBlocks[0].text).toBe('You are AtlasMind.');
    expect(sysBlocks[0].cache_control).toEqual({ type: 'ephemeral' });

    // Only the LAST tool carries the breakpoint (caches all preceding tools too).
    expect(result.tools?.[0].cache_control).toBeUndefined();
    expect(result.tools?.[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('leaves system and tools untouched when caching is disabled', () => {
    const result = applyAnthropicPromptCaching('You are AtlasMind.', tools, false);

    expect(result.system).toBe('You are AtlasMind.');
    expect(result.tools?.[1].cache_control).toBeUndefined();
  });

  it('does not wrap an empty system prompt', () => {
    const result = applyAnthropicPromptCaching('   ', tools, true);
    expect(result.system).toBe('   ');
  });

  it('is a no-op for tools when there are none', () => {
    const result = applyAnthropicPromptCaching('You are AtlasMind.', undefined, true);
    expect(result.tools).toBeUndefined();
    expect(Array.isArray(result.system)).toBe(true);
  });

  it('caches only the stable head and leaves the volatile memory tail uncached', () => {
    const system = 'You are AtlasMind.\nSkills: read_file\n\nRelevant project memory:\n- recent change X';
    const result = applyAnthropicPromptCaching(system, tools, true);

    const blocks = result.system as Array<{ text: string; cache_control?: { type: string } }>;
    expect(blocks).toHaveLength(2);
    // Stable head is cached.
    expect(blocks[0].text).toContain('You are AtlasMind.');
    expect(blocks[0].text).not.toContain('Relevant project memory');
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    // Volatile tail (memory) is present but NOT cached.
    expect(blocks[1].text).toContain('Relevant project memory:');
    expect(blocks[1].cache_control).toBeUndefined();
  });
});

describe('splitStableSystemPrefix', () => {
  it('splits at the first volatile marker', () => {
    const { stable, volatile } = splitStableSystemPrefix('STABLE HEAD\n\nLive evidence from source-backed files:\nfoo');
    expect(stable).toBe('STABLE HEAD');
    expect(volatile).toContain('Live evidence from source-backed files:');
  });

  it('treats the whole prompt as stable when no volatile marker is present', () => {
    const { stable, volatile } = splitStableSystemPrefix('Just identity and policy.');
    expect(stable).toBe('Just identity and policy.');
    expect(volatile).toBe('');
  });

  it('uses the earliest marker when several are present', () => {
    const sys = 'HEAD\n\nRelevant project memory:\nm\n\nLive evidence from source-backed files:\ne';
    const { stable } = splitStableSystemPrefix(sys);
    expect(stable).toBe('HEAD');
  });
});
