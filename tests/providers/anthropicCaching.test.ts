import { describe, expect, it } from 'vitest';
import { applyAnthropicPromptCaching } from '../../src/providers/anthropic.ts';

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
});
