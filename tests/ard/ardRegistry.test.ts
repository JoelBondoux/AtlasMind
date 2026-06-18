import { describe, expect, it, vi } from 'vitest';
import { ArdRegistry } from '../../src/ard/ardRegistry.ts';
import type { ArdDiscoveredResource } from '../../src/types.ts';

function makeMemento() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, def?: T): T => (store.has(key) ? (store.get(key) as T) : (def as T)),
    update: async (key: string, value: unknown) => { store.set(key, value); },
    keys: () => [...store.keys()],
    _store: store,
  };
}

describe('ArdRegistry', () => {
  it('seeds the default finders DISABLED on first load', () => {
    const memento = makeMemento();
    const registry = new ArdRegistry(memento as never, () => {});
    registry.loadFromStorage();

    const finders = registry.list();
    expect(finders.length).toBeGreaterThanOrEqual(2);
    expect(finders.every(f => f.enabled === false)).toBe(true);
    expect(finders.every(f => f.builtIn === true)).toBe(true);
    expect(registry.listEnabled()).toHaveLength(0);
  });

  it('does not re-seed defaults after they are removed (seeded flag)', () => {
    const memento = makeMemento();
    const first = new ArdRegistry(memento as never, () => {});
    first.loadFromStorage();
    const id = first.list()[0]!.id;
    first.remove(id);

    const second = new ArdRegistry(memento as never, () => {});
    second.loadFromStorage();
    expect(second.list().some(f => f.id === id)).toBe(false);
  });

  it('fires onRefresh and persists on add / enable / remove', () => {
    const memento = makeMemento();
    const onRefresh = vi.fn();
    const registry = new ArdRegistry(memento as never, onRefresh);
    registry.loadFromStorage();
    onRefresh.mockClear();

    const id = registry.add({ name: 'Custom', url: 'https://custom.example.com/search', kind: 'registry', enabled: false });
    expect(onRefresh).toHaveBeenCalled();
    registry.setEnabled(id, true);
    expect(registry.get(id)?.enabled).toBe(true);
    expect(registry.listEnabled().some(f => f.id === id)).toBe(true);

    registry.remove(id);
    expect(registry.get(id)).toBeUndefined();
  });

  it('de-duplicates finders by URL', () => {
    const memento = makeMemento();
    const registry = new ArdRegistry(memento as never, () => {});
    registry.loadFromStorage();
    const a = registry.add({ name: 'A', url: 'https://dup.example.com/search', kind: 'registry', enabled: false });
    const b = registry.add({ name: 'B', url: 'https://dup.example.com/search/', kind: 'registry', enabled: false });
    expect(a).toBe(b);
  });

  it('caps and exposes recent results for the tree view', () => {
    const memento = makeMemento();
    const registry = new ArdRegistry(memento as never, () => {});
    registry.loadFromStorage();
    const results: ArdDiscoveredResource[] = Array.from({ length: 80 }, (_, i) => ({
      identifier: `urn:ai:x:r:${i}`, displayName: `R${i}`, type: 'application/mcp-server+json', sourceName: 'Test',
    }));
    registry.setRecentResults(results);
    expect(registry.getRecentResults().length).toBe(50);
    registry.clearRecentResults();
    expect(registry.getRecentResults()).toHaveLength(0);
  });
});
