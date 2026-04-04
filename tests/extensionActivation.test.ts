import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { runActivationStep } from '../src/extension.ts';

describe('runActivationStep', () => {
  it('returns true when the activation step succeeds', () => {
    const outputChannel = { appendLine: vi.fn() } as never;
    const step = vi.fn();

    const result = runActivationStep('registerCommands', outputChannel, step);

    expect(result).toBe(true);
    expect(step).toHaveBeenCalledTimes(1);
    expect(outputChannel.appendLine).not.toHaveBeenCalled();
  });

  it('logs and returns false when the activation step throws', () => {
    const outputChannel = { appendLine: vi.fn() } as never;

    const result = runActivationStep('registerChatParticipant', outputChannel, () => {
      throw new Error('boom');
    });

    expect(result).toBe(false);
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('[activate] registerChatParticipant failed:'),
    );
  });

  it('does not import the agent manager panel during activation bootstrap', () => {
    const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("./views/agentManagerPanel.js");
  });
});