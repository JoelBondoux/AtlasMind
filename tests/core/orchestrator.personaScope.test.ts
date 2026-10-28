/**
 * A Buzz persona turn, end to end through a real orchestrator: selection only
 * among the members, the preferred member when none matches, a refusal when no
 * member can run, the host-delivery instruction on the worker, and a handoff
 * that cannot leave the persona.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.ts';
import { AgentRegistry } from '../../src/core/agentRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { MemoryManager } from '../../src/memory/memoryManager.ts';
import { CostTracker } from '../../src/core/costTracker.ts';
import { ProviderRegistry } from '../../src/providers/index.ts';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';
import { PERSONA_HOST_DELIVERY_NOTE } from '../../src/core/personaScope.ts';
import type { CompletionRequest, CompletionResponse, ProviderAdapter } from '../../src/providers/adapter.ts';
import type { AgentDefinition, PersonaScope, SkillExecutionContext, TaskRequest } from '../../src/types.ts';

function skillContext(): SkillExecutionContext {
  return new Proxy({ workspaceRootPath: '/workspace' } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : vi.fn().mockResolvedValue('')),
  }) as unknown as SkillExecutionContext;
}

const AGENTS: AgentDefinition[] = [
  { id: 'default', name: 'Default', role: 'general assistant', description: 'Fallback.', systemPrompt: 'You are the default.', skills: [] },
  { id: 'backend-engineer', name: 'Backend', role: 'backend engineer', description: 'APIs and databases.', systemPrompt: 'You are backend.', skills: [], primaryRoutingNeeds: ['backend'] },
  { id: 'frontend-engineer', name: 'Frontend', role: 'frontend engineer', description: 'Browser UI.', systemPrompt: 'You are frontend.', skills: [], primaryRoutingNeeds: ['frontend'] },
  {
    id: 'database-wizard',
    name: 'Database Wizard',
    role: 'database migration schema specialist',
    description: 'Database migration schema postgres specialist for database migration schema work.',
    systemPrompt: 'You are the wizard.',
    skills: [],
    primaryRoutingNeeds: ['backend'],
  },
];

function harness() {
  const agents = new AgentRegistry();
  for (const agent of AGENTS) {
    agents.register(agent);
  }
  const router = new ModelRouter();
  const registry = new ProviderRegistry();
  const requests: CompletionRequest[] = [];
  const adapter: ProviderAdapter = {
    providerId: 'test',
    complete: vi.fn(async (request: CompletionRequest): Promise<CompletionResponse> => {
      requests.push(request);
      return { content: 'Answer.', model: request.model, inputTokens: 10, outputTokens: 5, finishReason: 'stop' };
    }),
    listModels: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
  router.registerProvider({
    id: 'test',
    displayName: 'test',
    apiKeySettingKey: '',
    enabled: true,
    pricingModel: 'pay-per-token',
    models: [{
      id: 'test/model', provider: 'test', name: 'model', contextWindow: 200_000,
      inputPricePer1k: 0.001, outputPricePer1k: 0.002, capabilities: ['chat', 'code', 'reasoning'], enabled: true,
    }],
  });
  registry.register(adapter);
  const orchestrator = new Orchestrator(
    agents,
    new SkillsRegistry(),
    router,
    new MemoryManager(),
    new CostTracker(),
    registry,
    skillContext(),
    new TaskProfiler(),
    undefined,
    { emit: vi.fn() } as any,
    { toolApprovalGate: async () => ({ approved: true }) },
    { maxToolIterations: 2, maxToolCallsPerTurn: 2, toolExecutionTimeoutMs: 10_000, providerTimeoutMs: 30_000 },
  );
  const request = (userMessage: string): TaskRequest => ({
    id: `task-${Math.random().toString(36).slice(2)}`,
    userMessage,
    context: {},
    constraints: { budget: 'balanced', speed: 'balanced' },
    timestamp: new Date().toISOString(),
  });
  return { orchestrator, agents, requests, adapter, request };
}

const ENGINEER: PersonaScope = {
  personaId: 'am-engineer',
  allowedAgentIds: ['frontend-engineer', 'backend-engineer'],
  preferredAgentId: 'frontend-engineer',
  skillCeiling: { mode: 'member' },
};

const DATABASE_QUESTION = 'Write the database migration schema change for the postgres backend.';

describe('processTaskInScope', () => {
  it('selects only among the persona\'s members, even when an outsider would win', async () => {
    const unscoped = harness();
    const open = await unscoped.orchestrator.processTask(unscoped.request(DATABASE_QUESTION));
    expect(open.agentId).toBe('database-wizard');

    const scoped = harness();
    const result = await scoped.orchestrator.processTaskInScope(scoped.request(DATABASE_QUESTION), ENGINEER);
    expect(result.agentId).toBe('backend-engineer');
  });

  it('gives a request no member matches to the preferred member, never to an outsider', async () => {
    const { orchestrator, request } = harness();
    const result = await orchestrator.processTaskInScope(request('Hello there.'), ENGINEER);
    expect(result.agentId).toBe('frontend-engineer');
  });

  it('degrades to another member, and says so, when the preferred member is disabled', async () => {
    const { orchestrator, agents, request } = harness();
    agents.disable('frontend-engineer');
    const progress: string[] = [];
    const result = await orchestrator.processTaskInScope(request('Hello there.'), ENGINEER, undefined, message => progress.push(message));
    expect(result.agentId).toBe('backend-engineer');
    expect(progress.join('\n')).toMatch(/frontend-engineer is unavailable/);
  });

  it('refuses the turn, calling no model, when no member can run', async () => {
    const { orchestrator, adapter, request } = harness();
    const result = await orchestrator.processTaskInScope(request(DATABASE_QUESTION), {
      ...ENGINEER,
      allowedAgentIds: ['ghost'],
      preferredAgentId: 'ghost',
    });
    expect(result.response).toMatch(/has no enabled member/);
    expect(result.modelUsed).toBe('none');
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it('refuses a malformed scope rather than running unscoped', async () => {
    const { orchestrator, adapter, request } = harness();
    const result = await orchestrator.processTaskInScope(request('Hello.'), { ...ENGINEER, preferredAgentId: 'not-a-member' });
    expect(result.response).toMatch(/malformed/);
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it('tells the selected worker the host delivers the Buzz reply', async () => {
    const { orchestrator, requests, request } = harness();
    await orchestrator.processTaskInScope(request('Hello there.'), { ...ENGINEER, hostDelivery: 'buzz-acp' });
    const system = requests.at(-1)!.messages.find(message => message.role === 'system')!;
    expect(String(system.content)).toContain(PERSONA_HOST_DELIVERY_NOTE);
  });

  it('leaves ordinary processTask untouched by any persona', async () => {
    const { orchestrator, requests, request } = harness();
    await orchestrator.processTask(request('Hello there.'));
    const system = requests.at(-1)!.messages.find(message => message.role === 'system')!;
    expect(String(system.content)).not.toContain(PERSONA_HOST_DELIVERY_NOTE);
  });
});

describe('the handoff cannot leave the persona (wiring)', () => {
  const source = readFileSync(path.join(process.cwd(), 'src', 'core', 'orchestrator.ts'), 'utf8');
  const delegate = source.slice(source.indexOf('private async runDelegatedAgent('), source.indexOf('updateConfig(patch'));

  it('checks membership before the general handoff policy', () => {
    expect(delegate.indexOf('personaHandoffRefusal(')).toBeGreaterThan(-1);
    expect(delegate.indexOf('personaHandoffRefusal(')).toBeLessThan(delegate.indexOf('evaluateHandoff({'));
  });

  it('carries the persona into the delegate, so its own handoffs and skills stay inside', () => {
    expect(delegate).toContain('context: caller.personaScope ? { __personaScope: caller.personaScope } : {}');
  });

  it('hands work to a subscription agent\'s own tools only under the member ceiling', () => {
    // An allowlist cannot be intersected with tools the agent brings itself.
    expect(source).toContain("&& (!personaScope || personaScope.skillCeiling.mode === 'member')");
  });

  it('narrows every worker\'s skills by the persona ceiling and withholds Buzz sends', () => {
    expect(source).toContain('skillAllowedByPersonaCeiling(skill.id, personaScope.skillCeiling)');
    expect(source).toContain('!isWithheldForHostDelivery(skill.id, personaScope)');
    expect(source).toContain('personaScope ? personaCapabilityEnvelope(personaScope) : undefined');
  });
});
