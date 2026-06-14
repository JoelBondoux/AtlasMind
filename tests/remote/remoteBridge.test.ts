import { describe, it, expect, vi } from 'vitest';

// The shared vscode mock stubs EventEmitter as a no-op; the bridge relies on real
// emitter semantics, so provide a working implementation locally.
vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(e: T) => unknown> = [];
    event = (listener: (e: T) => unknown) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire(data: T): void {
      for (const l of [...this.listeners]) {
        l(data);
      }
    }
    dispose(): void {
      this.listeners = [];
    }
  }
  return { EventEmitter };
});

import { RemoteWebviewHost } from '../../src/remote/remoteBridge.ts';

describe('RemoteWebviewHost', () => {
  it('forwards outbound webview messages to the sender', async () => {
    const sent: unknown[] = [];
    const host = new RemoteWebviewHost(msg => sent.push(msg));
    const ok = await host.webview.postMessage({ type: 'state', payload: { ok: true } });
    expect(ok).toBe(true);
    expect(sent).toEqual([{ type: 'state', payload: { ok: true } }]);
  });

  it('delivers inbound messages to onDidReceiveMessage listeners', () => {
    const host = new RemoteWebviewHost(() => undefined);
    const received: unknown[] = [];
    host.webview.onDidReceiveMessage(msg => received.push(msg));
    host.deliverInbound({ type: 'stopPrompt' });
    expect(received).toEqual([{ type: 'stopPrompt' }]);
  });

  it('fires onDidDispose and stops forwarding after dispose', async () => {
    const sent: unknown[] = [];
    const host = new RemoteWebviewHost(msg => sent.push(msg));
    const onDispose = vi.fn();
    host.onDidDispose(onDispose);

    host.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);

    const ok = await host.webview.postMessage({ type: 'late' });
    expect(ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it('does not deliver inbound messages after dispose', () => {
    const host = new RemoteWebviewHost(() => undefined);
    const received: unknown[] = [];
    host.webview.onDidReceiveMessage(msg => received.push(msg));
    host.dispose();
    host.deliverInbound({ type: 'stopPrompt' });
    expect(received).toEqual([]);
  });

  it('passes webview URIs through unchanged (remote previews degrade gracefully)', () => {
    const host = new RemoteWebviewHost(() => undefined);
    const uri = { scheme: 'file', path: '/x' } as unknown as import('vscode').Uri;
    expect(host.webview.asWebviewUri(uri)).toBe(uri);
  });
});
