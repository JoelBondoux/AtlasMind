import { describe, expect, it } from 'vitest';
import { MemoryManager } from '../../src/memory/memoryManager.ts';
import type { MemoryEntry } from '../../src/types.ts';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    path: 'decisions/example.md',
    title: 'Architecture Decision',
    tags: ['architecture'],
    lastModified: '2026-04-03T00:00:00.000Z',
    snippet: 'We selected a scalable service architecture with clear module boundaries.',
    ...overrides,
  };
}

describe('MemoryManager', () => {
  it('indexes embeddings on upsert and returns semantically relevant entries', async () => {
    const manager = new MemoryManager();
    manager.upsert(makeEntry({
      path: 'architecture/service.md',
      title: 'Service Architecture',
      tags: ['system-design'],
      snippet: 'Design the backend service architecture for resilience and scale.',
    }));
    manager.upsert(makeEntry({
      path: 'ideas/marketing.md',
      title: 'Launch Copy',
      tags: ['marketing'],
      snippet: 'Draft positioning copy and landing page messaging.',
    }));

    const results = await manager.queryRelevant('scalable backend architecture', 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('architecture/service.md');
    expect(results[0]?.embedding?.length).toBeGreaterThan(0);
  });

  it('prefers tag and path overlap even with short snippets', async () => {
    const manager = new MemoryManager();
    manager.upsert(makeEntry({
      path: 'decisions/auth.md',
      title: 'Auth choice',
      tags: ['security', 'auth'],
      snippet: 'Use OIDC.',
    }));

    const results = await manager.queryRelevant('auth security', 1);
    expect(results[0]?.path).toBe('decisions/auth.md');
  });
});
