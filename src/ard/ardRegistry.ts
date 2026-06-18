/**
 * ArdRegistry – persists the user's "Agent Finders" (ARD discovery endpoints)
 * and caches the most recent discovery results for the sidebar tree.
 *
 * Modeled on {@link McpServerRegistry}: configurations live in VS Code
 * `globalState`, a refresh callback notifies UI surfaces, and the shipped
 * default finders are seeded once. Crucially the defaults seed DISABLED — no
 * outbound discovery traffic occurs until the user opts a finder in.
 */

import type * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { DEFAULT_ARD_FINDERS } from '../constants.js';
import type { ArdDiscoveredResource, ArdDiscoveryEndpoint } from '../types.js';

const STORAGE_KEY = 'atlasmind.ardEndpoints';
const SEEDED_KEY = 'atlasmind.ardEndpointsSeeded';
/** Cap on cached discovered resources kept in memory for the tree view. */
const MAX_CACHED_RESULTS = 50;

export class ArdRegistry {
  private endpoints = new Map<string, ArdDiscoveryEndpoint>();
  /** Most recent discovery results, newest first, for the tree view. */
  private recentResults: ArdDiscoveredResource[] = [];

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly onRefresh: () => void,
  ) {}

  // ── Load / persist ────────────────────────────────────────────

  /** Load persisted finders, seeding the shipped defaults (disabled) on first run. */
  loadFromStorage(): void {
    const raw = this.globalState.get<ArdDiscoveryEndpoint[]>(STORAGE_KEY, []);
    for (const endpoint of raw.filter(isValidEndpoint)) {
      this.endpoints.set(endpoint.id, endpoint);
    }

    const seeded = this.globalState.get<boolean>(SEEDED_KEY, false);
    if (!seeded) {
      for (const finder of DEFAULT_ARD_FINDERS) {
        if (!this.findByUrl(finder.url)) {
          const id = randomUUID();
          this.endpoints.set(id, { ...finder, id, enabled: false });
        }
      }
      void this.globalState.update(SEEDED_KEY, true);
      void this.persist();
    }
  }

  private async persist(): Promise<void> {
    await this.globalState.update(STORAGE_KEY, [...this.endpoints.values()]);
  }

  // ── CRUD ──────────────────────────────────────────────────────

  list(): ArdDiscoveryEndpoint[] {
    return [...this.endpoints.values()];
  }

  listEnabled(): ArdDiscoveryEndpoint[] {
    return this.list().filter(endpoint => endpoint.enabled);
  }

  get(id: string): ArdDiscoveryEndpoint | undefined {
    return this.endpoints.get(id);
  }

  /** Add a finder. Returns the existing id when a finder with the same URL already exists. */
  add(endpoint: Omit<ArdDiscoveryEndpoint, 'id'>): string {
    const existing = this.findByUrl(endpoint.url);
    if (existing) {
      return existing.id;
    }
    const id = randomUUID();
    this.endpoints.set(id, { ...endpoint, id });
    void this.persist();
    this.onRefresh();
    return id;
  }

  update(id: string, updates: Partial<Omit<ArdDiscoveryEndpoint, 'id'>>): void {
    const existing = this.endpoints.get(id);
    if (!existing) {
      return;
    }
    this.endpoints.set(id, { ...existing, ...updates, id });
    void this.persist();
    this.onRefresh();
  }

  setEnabled(id: string, enabled: boolean): void {
    this.update(id, { enabled });
  }

  remove(id: string): void {
    if (this.endpoints.delete(id)) {
      void this.persist();
      this.onRefresh();
    }
  }

  // ── Recent-results cache (tree view) ──────────────────────────

  /** Replace the cached results shown in the discovery tree with the latest search. */
  setRecentResults(results: ArdDiscoveredResource[]): void {
    this.recentResults = results.slice(0, MAX_CACHED_RESULTS);
    this.onRefresh();
  }

  getRecentResults(): ArdDiscoveredResource[] {
    return [...this.recentResults];
  }

  clearRecentResults(): void {
    if (this.recentResults.length > 0) {
      this.recentResults = [];
      this.onRefresh();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private findByUrl(url: string): ArdDiscoveryEndpoint | undefined {
    const target = normalizeUrl(url);
    for (const endpoint of this.endpoints.values()) {
      if (normalizeUrl(endpoint.url) === target) {
        return endpoint;
      }
    }
    return undefined;
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, '').toLowerCase();
}

function isValidEndpoint(value: unknown): value is ArdDiscoveryEndpoint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' && candidate['id'].length > 0 &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['url'] === 'string' &&
    (candidate['kind'] === 'registry' || candidate['kind'] === 'manifest') &&
    typeof candidate['enabled'] === 'boolean'
  );
}
