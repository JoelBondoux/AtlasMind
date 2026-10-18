import { describe, expect, it, vi } from 'vitest';
import { createCliRuntimeHooks, parseCliArgs } from '../../src/cli/main.ts';
import { Orchestrator } from '../../src/core/orchestrator.ts';
import { AgentRegistry } from '../../src/core/agentRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { MemoryManager } from '../../src/memory/memoryManager.ts';
import { CostTracker } from '../../src/core/costTracker.ts';
import { ProviderRegistry } from '../../src/providers/index.ts';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';
import type { SkillDefinition, SkillExecutionContext } from '../../src/types.ts';
import type { CompletionResponse, ProviderAdapter } from '../../src/providers/adapter.ts';

/**
 * `--dry-run` for `chat` and `project` is the editor's dry run, reached through
 * the one setting the CLI answers. The flag already meant "print the build
 * command" for `build`; it now means the same thing everywhere — describe, do
 * not run.
 */

describe('--dry-run', () => {
  it('parses for chat as it does for build', () => {
    expect(parseCliArgs(['chat', 'update the notes', '--dry-run']).options.dryRun).toBe(true);
    expect(parseCliArgs(['chat', 'update the notes']).options.dryRun).toBe(false);
  });

  it('answers the dry-run setting and leaves every other default alone', () => {
    const hooks = createCliRuntimeHooks({ dryRun: true });
    expect(hooks.readSetting?.('dryRun.enabled', false)).toBe(true);
    expect(hooks.readSetting?.('toolApprovalMode', 'ask-on-write')).toBe('ask-on-write');
    expect(hooks.readSetting?.('acp.toolsEnabled', false)).toBe(false);
  });

  it('adds nothing without the flag', () => {
    const hooks = createCliRuntimeHooks({ allowWrites: true });
    expect(hooks.readSetting).toBeUndefined();
    expect(hooks.onDryRunRecord).toBeUndefined();
  });

  it('simulates a write even with --allow-writes, and reports it on stderr', async () => {
    const lines: string[] = [];
    const hooks = createCliRuntimeHooks({ allowWrites: true, dryRun: true }, line => lines.push(line));
    const write: SkillDefinition = {
      id: 'file-write',
      name: 'file-write',
      description: 'Write a file.',
      builtIn: true,
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
      execute: vi.fn().mockResolvedValue('Wrote notes.md'),
    };
    const responses: CompletionResponse[] = [
      {
        content: '',
        model: 'local/echo-1',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'file-write', arguments: { path: 'notes.md', content: 'x' } }],
      },
      { content: 'Done.', model: 'local/echo-1', inputTokens: 1, outputTokens: 1, finishReason: 'stop' },
    ];
    let call = 0;
    const provider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn(() => Promise.resolve(responses[call++] ?? responses.at(-1)!)),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const router = new ModelRouter();
    router.registerProvider({
      id: 'local', displayName: 'Local', apiKeySettingKey: '', pricingModel: 'free', enabled: true,
      models: [{
        id: 'local/echo-1', provider: 'local', name: 'Local Echo', contextWindow: 64_000,
        inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'], enabled: true,
      }],
    });
    const providers = new ProviderRegistry();
    providers.register(provider);
    const registry = new SkillsRegistry();
    registry.register(write);
    const writeFile = vi.fn();
    const orchestrator = new Orchestrator(
      new AgentRegistry(), registry, router, new MemoryManager(), new CostTracker(), providers,
      { workspaceRootPath: '/workspace', writeFile } as unknown as SkillExecutionContext,
      new TaskProfiler(), undefined, undefined, hooks,
    );

    const result = await orchestrator.processTaskWithAgent({
      id: 'cli-dry',
      userMessage: 'Update notes.md.',
      context: { interface: 'cli' },
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    }, { id: 'default', name: 'Default', role: 'engineer', description: 'd', systemPrompt: 's', skills: ['file-write'] });

    expect(write.execute).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[dry run\] .* file-write — modify workspace files using file-write/);
    expect(result.response).toContain('**Dry run — nothing was executed.**');
  });
});
