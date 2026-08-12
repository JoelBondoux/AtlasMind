/**
 * Frozen runtime and identity-only live channel for UI Studio's full preview.
 *
 * The browser receives revision and selection identities. It can reload a stale
 * deterministic document and select an element from that exact revision, but
 * it cannot send graph data, source text, paths, commands, or mutations back to
 * the extension host. The runtime is injected only into `_wireframe/` Studio
 * drafts; generated/exported output remains independent.
 */

import { UI_DESIGN_GRAPH_MAX_REVISION } from './uiDesignGraph.js';

export const UI_PREVIEW_RUNTIME_PATH = '_atlas/runtime.js';
export const UI_PREVIEW_EVENTS_PATH = '_atlas/events';
export const UI_PREVIEW_SELECTION_PATH = '_atlas/selection';
export const UI_PREVIEW_MAX_CLIENTS = 8;
export const UI_PREVIEW_MAX_SELECTION_BODY = 512;

/** Relative from every `_wireframe/*.html` draft written today. */
const UI_PREVIEW_RUNTIME_RELATIVE_PATH = `../${UI_PREVIEW_RUNTIME_PATH}`;

/**
 * Byte-stable, dependency-free browser runtime. No workspace value is
 * interpolated into it; the current revision is a numeric HTML attribute.
 */
export const UI_PREVIEW_RUNTIME_SCRIPT = String.raw`(() => {
  'use strict';
  const root = document.documentElement;
  let revision = Number(root.dataset.atlasPreviewRevision || '0');
  if (!Number.isSafeInteger(revision) || revision < 0) revision = 0;
  const script = document.currentScript;
  if (!script || !script.src || typeof EventSource !== 'function') return;
  const events = new EventSource(new URL('events', script.src));
  const selectionUrl = new URL('selection', script.src);
  let reloading = false;
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(value);
  const select = (screenId, nodeId) => {
    if (!validId(screenId) || !validId(nodeId)) return;
    for (const node of document.querySelectorAll('[data-atlas-node-id]')) {
      const selected = node.dataset.atlasScreenId === screenId && node.dataset.atlasNodeId === nodeId;
      node.toggleAttribute('data-atlas-preview-selected', selected);
    }
  };
  events.addEventListener('revision', event => {
    if (reloading || typeof event.data !== 'string' || event.data.length > 80) return;
    try {
      const payload = JSON.parse(event.data);
      const next = payload && payload.revision;
      if (!Number.isSafeInteger(next) || next <= revision || next > 2147483647) return;
      revision = next;
      reloading = true;
      location.reload();
    } catch {
      // A malformed event is ignored. The channel carries no instructions.
    }
  });
  events.addEventListener('selection', event => {
    if (typeof event.data !== 'string' || event.data.length > 320) return;
    try {
      const payload = JSON.parse(event.data);
      if (!payload || Object.keys(payload).some(key => !['revision', 'screenId', 'nodeId'].includes(key))
          || payload.revision !== revision || !validId(payload.screenId) || !validId(payload.nodeId)) return;
      select(payload.screenId, payload.nodeId);
    } catch {
      // Selection is presentation only; malformed state is ignored.
    }
  });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-atlas-screen-id][data-atlas-node-id]')
      : null;
    if (!target) return;
    const screenId = target.dataset.atlasScreenId;
    const nodeId = target.dataset.atlasNodeId;
    if (!validId(screenId) || !validId(nodeId)) return;
    select(screenId, nodeId);
    void fetch(selectionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, screenId, nodeId }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    }).catch(() => undefined);
  });
})();`;

/** Add the frozen runtime to one deterministic Studio draft. */
export function injectUiPreviewRuntime(html: string, revision: number): string {
  const safeRevision = sanitizeRevision(revision);
  if (!/<html(?:\s|>)/i.test(html) || !/<\/body>/i.test(html)) {
    return html;
  }
  const withRevision = html.replace(
    /<html(\s|>)/i,
    `<html data-atlas-preview-revision="${safeRevision}"$1`,
  );
  return withRevision.replace(
    /<\/body>/i,
    `<script src="${UI_PREVIEW_RUNTIME_RELATIVE_PATH}"></script>\n</body>`,
  );
}

export type UiPreviewProtocolResource = 'runtime' | 'events' | 'selection';

export interface UiPreviewSelectionEvent {
  revision: number;
  screenId: string;
  nodeId: string;
}

/** Resolve only the three exact token-scoped protocol paths. */
export function resolveUiPreviewProtocolResource(
  requestUrl: string,
  token: string,
): UiPreviewProtocolResource | undefined {
  if (!token) {
    return undefined;
  }
  try {
    const pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
    if (pathname === `/${token}/${UI_PREVIEW_RUNTIME_PATH}`) {
      return 'runtime';
    }
    if (pathname === `/${token}/${UI_PREVIEW_EVENTS_PATH}`) {
      return 'events';
    }
    if (pathname === `/${token}/${UI_PREVIEW_SELECTION_PATH}`) {
      return 'selection';
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface UiPreviewRevisionClient {
  write(chunk: string): unknown;
  end(): void;
}

/**
 * Small transport-agnostic hub so reconnect, ordering, caps, and cleanup are
 * testable without opening a port.
 */
export class UiPreviewRevisionHub {
  private revision: number;
  private readonly clients = new Set<UiPreviewRevisionClient>();

  constructor(initialRevision = 0) {
    this.revision = sanitizeRevision(initialRevision);
  }

  get currentRevision(): number {
    return this.revision;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get canConnect(): boolean {
    return this.clients.size < UI_PREVIEW_MAX_CLIENTS;
  }

  connect(client: UiPreviewRevisionClient): boolean {
    if (!this.canConnect || this.clients.has(client)) {
      return false;
    }
    this.clients.add(client);
    if (!this.write(client, formatUiPreviewRevisionEvent(this.revision))) {
      return false;
    }
    return true;
  }

  disconnect(client: UiPreviewRevisionClient): void {
    this.clients.delete(client);
  }

  /** Publish only a strictly newer, bounded revision. */
  publish(nextRevision: number): boolean {
    if (!validRevision(nextRevision) || nextRevision <= this.revision) {
      return false;
    }
    this.revision = nextRevision;
    const event = formatUiPreviewRevisionEvent(nextRevision);
    for (const client of [...this.clients]) {
      this.write(client, event);
    }
    return true;
  }

  publishSelection(screenId: string, nodeId: string): boolean {
    const event = sanitizeSelection({ revision: this.revision, screenId, nodeId }, this.revision);
    if (!event) {
      return false;
    }
    const encoded = formatUiPreviewSelectionEvent(event);
    for (const client of [...this.clients]) {
      this.write(client, encoded);
    }
    return true;
  }

  close(): void {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // Closing one broken response must not strand the others.
      }
    }
    this.clients.clear();
  }

  private write(client: UiPreviewRevisionClient, event: string): boolean {
    try {
      client.write(event);
      return true;
    } catch {
      this.clients.delete(client);
      try { client.end(); } catch { /* already broken */ }
      return false;
    }
  }
}

export function formatUiPreviewRevisionEvent(revision: number): string {
  const safeRevision = sanitizeRevision(revision);
  return `id: ${safeRevision}\nevent: revision\ndata: {"revision":${safeRevision}}\n\n`;
}

export function parseUiPreviewSelection(
  body: string,
  currentRevision: number,
): UiPreviewSelectionEvent | undefined {
  if (typeof body !== 'string' || body.length === 0 || body.length > UI_PREVIEW_MAX_SELECTION_BODY) {
    return undefined;
  }
  try {
    return sanitizeSelection(JSON.parse(body), currentRevision);
  } catch {
    return undefined;
  }
}

export function formatUiPreviewSelectionEvent(event: UiPreviewSelectionEvent): string {
  return `event: selection\ndata: ${JSON.stringify(event)}\n\n`;
}

function sanitizeSelection(input: unknown, currentRevision: number): UiPreviewSelectionEvent | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => !['revision', 'screenId', 'nodeId'].includes(key))
      || record['revision'] !== currentRevision
      || !validIdentifier(record['screenId'])
      || !validIdentifier(record['nodeId'])) {
    return undefined;
  }
  return {
    revision: currentRevision,
    screenId: record['screenId'],
    nodeId: record['nodeId'],
  };
}

function sanitizeRevision(value: number): number {
  return validRevision(value) ? value : 0;
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= UI_DESIGN_GRAPH_MAX_REVISION;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(value);
}
