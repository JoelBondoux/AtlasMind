import { describe, expect, it } from 'vitest';
import {
  formatUiPreviewSelectionEvent,
  formatUiPreviewRevisionEvent,
  injectUiPreviewRuntime,
  parseUiPreviewSelection,
  resolveUiPreviewProtocolResource,
  UI_PREVIEW_MAX_CLIENTS,
  UI_PREVIEW_MAX_SELECTION_BODY,
  UI_PREVIEW_RUNTIME_SCRIPT,
  UiPreviewRevisionHub,
  type UiPreviewRevisionClient,
} from '../../src/core/uiPreviewRuntime.ts';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

class Client implements UiPreviewRevisionClient {
  readonly chunks: string[] = [];
  ended = false;
  failWrites = false;

  write(chunk: string): void {
    if (this.failWrites) {
      throw new Error('closed');
    }
    this.chunks.push(chunk);
  }

  end(): void {
    this.ended = true;
  }
}

describe('UI preview runtime', () => {
  it('injects only a numeric revision and the fixed relative runtime path', () => {
    const html = '<!doctype html><html lang="en"><body><p>Draft</p></body></html>';
    const injected = injectUiPreviewRuntime(html, 42);

    expect(injected).toContain('<html data-atlas-preview-revision="42" lang="en">');
    expect(injected).toContain('<script src="../_atlas/runtime.js"></script>');
    expect(injected.indexOf('<script')).toBeGreaterThan(injected.indexOf('<p>Draft</p>'));
  });

  it('falls back to revision zero and leaves non-documents untouched', () => {
    expect(injectUiPreviewRuntime('<html><body>x</body></html>', Number.NaN))
      .toContain('data-atlas-preview-revision="0"');
    expect(injectUiPreviewRuntime('<p>fragment</p>', 2)).toBe('<p>fragment</p>');
  });

  it('keeps the frozen browser capability to revisions and bounded selection identities', () => {
    expect(UI_PREVIEW_RUNTIME_SCRIPT).toContain('new EventSource');
    expect(UI_PREVIEW_RUNTIME_SCRIPT).toContain('location.reload()');
    expect(UI_PREVIEW_RUNTIME_SCRIPT).toContain('fetch(selectionUrl');
    expect(UI_PREVIEW_RUNTIME_SCRIPT).toContain('JSON.stringify({ revision, screenId, nodeId })');
    expect(UI_PREVIEW_RUNTIME_SCRIPT).not.toContain('postMessage');
    expect(UI_PREVIEW_RUNTIME_SCRIPT).not.toContain('WebSocket');
    expect(UI_PREVIEW_RUNTIME_SCRIPT).not.toContain('localStorage');
    expect(UI_PREVIEW_RUNTIME_SCRIPT).not.toContain('innerHTML');
  });

  it('resolves only the three exact token-scoped endpoints', () => {
    expect(resolveUiPreviewProtocolResource(`/${TOKEN}/_atlas/runtime.js`, TOKEN)).toBe('runtime');
    expect(resolveUiPreviewProtocolResource(`/${TOKEN}/_atlas/events?reconnect=1`, TOKEN)).toBe('events');
    expect(resolveUiPreviewProtocolResource(`/${TOKEN}/_atlas/selection`, TOKEN)).toBe('selection');
    for (const url of [
      `/${TOKEN}/_atlas/runtime.js/extra`,
      `/${TOKEN}/_atlas/selection/extra`,
      `/${TOKEN}/_atlas/other`,
      '/wrong/_atlas/events',
      '/_atlas/events',
    ]) {
      expect(resolveUiPreviewProtocolResource(url, TOKEN)).toBeUndefined();
    }
    expect(resolveUiPreviewProtocolResource(`/${TOKEN}/_atlas/events`, '')).toBeUndefined();
  });

  it('accepts only a current revision and exact bounded selection identity', () => {
    const valid = JSON.stringify({ revision: 4, screenId: 'home', nodeId: 'hero-1' });
    expect(parseUiPreviewSelection(valid, 4)).toEqual({ revision: 4, screenId: 'home', nodeId: 'hero-1' });
    expect(parseUiPreviewSelection(valid, 5)).toBeUndefined();
    expect(parseUiPreviewSelection(JSON.stringify({ revision: 4, screenId: 'home', nodeId: 'hero-1', command: 'run' }), 4)).toBeUndefined();
    expect(parseUiPreviewSelection(JSON.stringify({ revision: 4, screenId: '../home', nodeId: 'hero-1' }), 4)).toBeUndefined();
    expect(parseUiPreviewSelection(JSON.stringify({ revision: 4, screenId: 'home', nodeId: 'x'.repeat(121) }), 4)).toBeUndefined();
    expect(parseUiPreviewSelection('{', 4)).toBeUndefined();
    expect(parseUiPreviewSelection('x'.repeat(UI_PREVIEW_MAX_SELECTION_BODY + 1), 4)).toBeUndefined();
  });

  it('sends the current revision on every reconnect and only publishes newer revisions', () => {
    const hub = new UiPreviewRevisionHub(3);
    const first = new Client();
    expect(hub.connect(first)).toBe(true);
    expect(first.chunks).toEqual([formatUiPreviewRevisionEvent(3)]);

    expect(hub.publish(3)).toBe(false);
    expect(hub.publish(2)).toBe(false);
    expect(hub.publish(Number.NaN)).toBe(false);
    expect(hub.publish(4)).toBe(true);
    expect(first.chunks.at(-1)).toBe(formatUiPreviewRevisionEvent(4));

    hub.disconnect(first);
    const reconnected = new Client();
    expect(hub.connect(reconnected)).toBe(true);
    expect(reconnected.chunks).toEqual([formatUiPreviewRevisionEvent(4)]);
  });

  it('fans a selection out without changing the revision', () => {
    const hub = new UiPreviewRevisionHub(9);
    const client = new Client();
    hub.connect(client);

    expect(hub.publishSelection('settings', 'save-button')).toBe(true);
    expect(client.chunks.at(-1)).toBe(formatUiPreviewSelectionEvent({
      revision: 9,
      screenId: 'settings',
      nodeId: 'save-button',
    }));
    expect(hub.currentRevision).toBe(9);
    expect(hub.publishSelection('../settings', 'save-button')).toBe(false);
  });

  it('caps listeners, removes broken clients, and closes every remaining response', () => {
    const hub = new UiPreviewRevisionHub();
    const clients = Array.from({ length: UI_PREVIEW_MAX_CLIENTS }, () => new Client());
    for (const client of clients) {
      expect(hub.connect(client)).toBe(true);
    }
    expect(hub.clientCount).toBe(UI_PREVIEW_MAX_CLIENTS);
    expect(hub.connect(new Client())).toBe(false);

    clients[0]!.failWrites = true;
    expect(hub.publish(1)).toBe(true);
    expect(clients[0]!.ended).toBe(true);
    expect(hub.clientCount).toBe(UI_PREVIEW_MAX_CLIENTS - 1);

    hub.close();
    expect(hub.clientCount).toBe(0);
    expect(clients.slice(1).every(client => client.ended)).toBe(true);
  });
});
