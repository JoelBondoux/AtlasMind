/**
 * A Buzz persona's models, from the ACP agents its manifest names: discovered
 * once, registered the way the editor registers them, and kept as seeded when
 * discovery cannot finish.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { seedDefaultProviders } from '../../src/runtime/core.ts';
import { discoverManifestModels, once } from '../../src/cli/manifestModelAccess.ts';
import type { DiscoveredModel, ProviderAdapter } from '../../src/providers/adapter.ts';

function routerWithAcp(): ModelRouter {
  const router = new ModelRouter();
  seedDefaultProviders(router);
  return router;
}

function fakeAcp(hints: DiscoveredModel[] | (() => Promise<DiscoveredModel[]>), healthy = true): ProviderAdapter {
  return {
    providerId: 'acp',
    complete: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(healthy),
    discoverModels: vi.fn(typeof hints === 'function' ? hints : async () => hints),
  };
}

const acpModels = (router: ModelRouter) => router.listProviders().find(provider => provider.id === 'acp')!.models;

describe('discoverManifestModels', () => {
  it('replaces the seeded catalogue with what the agents reported, enabled', async () => {
    const router = routerWithAcp();
    const result = await discoverManifestModels(router, fakeAcp([
      { id: 'acp/claude', name: 'Claude', capabilities: ['chat', 'code', 'reasoning'], inputPricePer1k: 0, outputPricePer1k: 0 },
      { id: 'acp/codex#high', name: 'Codex (high)', reasoningDepth: 3, inputPricePer1k: 0, outputPricePer1k: 0 },
      { id: 'codex', inputPricePer1k: 0, outputPricePer1k: 0 },
    ]));
    expect(result).toEqual({ registered: 3, healthy: true });
    expect(acpModels(router).map(model => model.id)).toEqual(['acp/claude', 'acp/codex#high', 'acp/codex']);
    expect(acpModels(router).find(model => model.id === 'acp/codex#high')!.reasoningDepth).toBe(3);
    expect(router.listProviders().find(provider => provider.id === 'acp')!.enabled).toBe(true);
  });

  it('keeps the seeded catalogue, and says why, when no agent answers in time', async () => {
    const router = routerWithAcp();
    const seeded = acpModels(router).map(model => model.id);
    const result = await discoverManifestModels(router, fakeAcp(() => new Promise(() => {})), 20);
    expect(result).toMatchObject({ healthy: false, kept: expect.stringMatching(/longer than/) });
    expect(acpModels(router).map(model => model.id)).toEqual(seeded);
  });

  it('keeps the seeded catalogue when discovery throws or finds nothing signed in', async () => {
    const router = routerWithAcp();
    const seeded = acpModels(router).map(model => model.id);
    expect(await discoverManifestModels(router, fakeAcp(async () => { throw new Error('agent crashed'); })))
      .toMatchObject({ kept: 'agent crashed' });
    expect(await discoverManifestModels(router, fakeAcp([], false)))
      .toMatchObject({ healthy: false, kept: expect.stringMatching(/no signed-in agent/) });
    expect(acpModels(router).map(model => model.id)).toEqual(seeded);
  });
});

describe('once', () => {
  it('runs the task on first call only and shares its promise', async () => {
    const task = vi.fn().mockResolvedValue('done');
    const ready = once(task);
    expect(task).not.toHaveBeenCalled();
    await Promise.all([ready(), ready(), ready()]);
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('the persona process wiring', () => {
  const source = readFileSync(path.join(process.cwd(), 'src', 'cli', 'manifestModelAccess.ts'), 'utf8');
  const agent = readFileSync(path.join(process.cwd(), 'src', 'cli', 'acpAgent.ts'), 'utf8');

  it('starts the manifest\'s agents as completion sources only', () => {
    // No permission policy reads as a denial; no delegated execution switch.
    const adapter = source.slice(source.indexOf('export function createManifestAcpAdapter'), source.indexOf('export interface ManifestModelDiscovery'));
    expect(adapter).not.toContain('permissionPolicy');
    expect(adapter).not.toContain('delegatedExecutionEnabled');
    expect(adapter).not.toContain('getMcpServers');
  });

  it('verifies the manifest before building providers, and discovers models on the first prompt', () => {
    expect(agent.indexOf('loadBuzzPersonaManifestFile(')).toBeLessThan(agent.indexOf('createCliProviderAdapters()'));
    const prompt = agent.slice(agent.indexOf(".onRequest('session/prompt'"), agent.indexOf(".onNotification('session/cancel'"));
    expect(prompt.indexOf('await modelsReady()')).toBeLessThan(prompt.indexOf('implementation.prompt('));
  });
});
