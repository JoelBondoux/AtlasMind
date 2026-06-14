// Synthetic webview host that bridges a real ChatPanel to a remote WebSocket
// client. Desktop-only (uses `vscode` and is imported by the remote-control
// server, never by the web build).
//
// ChatPanel only depends on the structural `ChatPanelHost` interface, so binding
// it to this host lets the full, unmodified chat implementation drive a remote
// browser surface: outbound `webview.postMessage` calls are forwarded over the
// socket, and inbound frames are injected through the host's receive emitter
// (after validation in the server). See docs/remote-control.md.
import * as vscode from 'vscode';
import type { ChatPanelHost } from '../views/chatPanel.js';

export class RemoteWebviewHost implements ChatPanelHost {
  readonly webview: ChatPanelHost['webview'];
  private readonly receiveEmitter = new vscode.EventEmitter<unknown>();
  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposeEmitter.event;
  private disposed = false;

  /**
   * @param sendOutbound Forwards an outbound chat message to the remote client.
   *   The server wraps it in a protocol envelope.
   */
  constructor(sendOutbound: (message: unknown) => void) {
    const receiveEmitter = this.receiveEmitter;
    this.webview = {
      // The local HTML is irrelevant remotely — the web client renders its own
      // copy of the chat front-end. We accept and ignore assignments.
      html: '',
      postMessage: (message: unknown): Thenable<boolean> => {
        if (this.disposed) {
          return Promise.resolve(false);
        }
        try {
          sendOutbound(message);
          return Promise.resolve(true);
        } catch {
          return Promise.resolve(false);
        }
      },
      onDidReceiveMessage: (listener, thisArgs, disposables) =>
        receiveEmitter.event(listener as (e: unknown) => unknown, thisArgs, disposables),
      // Local webview URIs cannot resolve in a remote browser; pass through so
      // attachment-preview generation does not throw. Attachment thumbnails are a
      // known v1 remote limitation.
      asWebviewUri: (uri: vscode.Uri) => uri,
      cspSource: '',
    };
  }

  /** Inject a validated inbound chat message from the remote client. */
  deliverInbound(message: unknown): void {
    if (!this.disposed) {
      this.receiveEmitter.fire(message);
    }
  }

  /** Tear down the bridge; fires onDidDispose so the bound ChatPanel disposes. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeEmitter.fire();
    this.disposeEmitter.dispose();
    this.receiveEmitter.dispose();
  }
}
