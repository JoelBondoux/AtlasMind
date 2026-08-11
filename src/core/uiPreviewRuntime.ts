/**
 * Frozen runtime and revision-only live channel for UI Studio's full preview.
 *
 * The browser receives one integer: the newest graph revision. It can reload a
 * stale deterministic document, but it cannot send graph data, source text,
 * paths, commands, or mutations back to the extension host. The runtime is
 * injected only into `_wireframe/` Studio drafts; generated/exported output
 * remains independent.
 */

import { UI_DESIGN_GRAPH_MAX_REVISION } from './uiDesignGraph.js';

export const UI_PREVIEW_RUNTIME_PATH = '_atlas/runtime.js';
export const UI_PREVIEW_EVENTS_PATH = '_atlas/events';
export const UI_PREVIEW_MAX_CLIENTS = 8;

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
  let reloading = false;
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

export type UiPreviewProtocolResource = 'runtime' | 'events';

/** Resolve only the two exact token-scoped protocol paths. */
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

function sanitizeRevision(value: number): number {
  return validRevision(value) ? value : 0;
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= UI_DESIGN_GRAPH_MAX_REVISION;
}
