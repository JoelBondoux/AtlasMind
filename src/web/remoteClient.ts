// WebSocket client for the AtlasMind web build. Runs in the web extension host
// (Web Worker) and relays the chat protocol to/from a paired desktop instance.
// Uses the browser-global `WebSocket` — no Node, no `ws`. See docs/remote-control.md.
import * as vscode from 'vscode';
import {
  REMOTE_PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
  chatFrame,
  type RemoteChannel,
  type RemoteRpcMethod,
} from '../remote/protocol.js';

export type RemoteClientState = 'disconnected' | 'connecting' | 'connected';

const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RPC_TIMEOUT_MS = 15_000;

export class RemoteClient {
  private socket: WebSocket | undefined;
  private state: RemoteClientState = 'disconnected';
  private url: string | undefined;
  private token: string | undefined;
  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private rpcSeq = 0;
  private readonly pendingRpc = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  private readonly stateEmitter = new vscode.EventEmitter<RemoteClientState>();
  readonly onStateChange = this.stateEmitter.event;
  /** Outbound chat messages received from the desktop, destined for the webview. */
  private readonly chatEmitter = new vscode.EventEmitter<unknown>();
  readonly onChatMessage = this.chatEmitter.event;

  constructor(private readonly clientName: string) {}

  getState(): RemoteClientState {
    return this.state;
  }

  getUrl(): string | undefined {
    return this.url;
  }

  connect(url: string, token: string): void {
    this.url = url;
    this.token = token;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnect();
    this.failAllRpc(new Error('Disconnected'));
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = undefined;
    this.setState('disconnected');
  }

  /** Forward a chat message from the webview to the desktop. */
  sendChat(message: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.state === 'connected') {
      this.socket.send(encodeFrame(chatFrame(message)));
    }
  }

  /** Issue a read-only RPC on the cost/runs channel and await the ack. */
  requestRpc(channel: Exclude<RemoteChannel, 'chat'>, method: RemoteRpcMethod, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.state !== 'connected') {
      return Promise.reject(new Error('Not connected'));
    }
    const id = `rpc-${++this.rpcSeq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error('RPC timed out'));
      }, RPC_TIMEOUT_MS);
      this.pendingRpc.set(id, { resolve, reject, timer });
      this.socket!.send(encodeFrame({ v: REMOTE_PROTOCOL_VERSION, kind: 'rpc', channel, id, payload: { method, params } }));
    });
  }

  dispose(): void {
    this.disconnect();
    this.stateEmitter.dispose();
    this.chatEmitter.dispose();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private openSocket(): void {
    if (!this.url || !this.token) {
      return;
    }
    this.setState('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.setState('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      socket.send(encodeFrame({
        v: REMOTE_PROTOCOL_VERSION,
        kind: 'auth',
        channel: 'chat',
        payload: { token: this.token, clientName: this.clientName },
      }));
    };
    socket.onmessage = (event: MessageEvent) => {
      this.onFrame(typeof event.data === 'string' ? event.data : '');
    };
    socket.onclose = () => {
      this.failAllRpc(new Error('Connection closed'));
      this.setState('disconnected');
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // A close event follows; reconnection is handled there.
    };
  }

  private onFrame(data: string): void {
    const env = decodeFrame(data);
    if (!env) {
      return;
    }

    if (env.kind === 'error') {
      const message = typeof env.payload === 'object' && env.payload !== null
        ? String((env.payload as { message?: unknown }).message ?? 'Remote error')
        : 'Remote error';
      const code = typeof env.payload === 'object' && env.payload !== null
        ? (env.payload as { code?: unknown }).code
        : undefined;
      if (code === 'unauthenticated') {
        // Bad token — stop retrying and surface clearly.
        this.shouldReconnect = false;
        this.clearReconnect();
        void vscode.window.showErrorMessage(`AtlasMind remote: ${message} Re-pair with a fresh token.`);
      }
      if (env.id && this.pendingRpc.has(env.id)) {
        this.rejectRpc(env.id, new Error(message));
      }
      return;
    }

    if (env.kind === 'ack') {
      if (this.state === 'connecting') {
        // Auth acknowledged.
        this.reconnectAttempts = 0;
        this.setState('connected');
      }
      if (env.id && this.pendingRpc.has(env.id)) {
        this.resolveRpc(env.id, env.payload);
      }
      return;
    }

    if (env.kind === 'msg' && env.channel === 'chat') {
      this.chatEmitter.fire(env.payload);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    this.reconnectAttempts += 1;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS * this.reconnectAttempts);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setState(state: RemoteClientState): void {
    if (this.state !== state) {
      this.state = state;
      this.stateEmitter.fire(state);
    }
  }

  private resolveRpc(id: string, value: unknown): void {
    const entry = this.pendingRpc.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      this.pendingRpc.delete(id);
      entry.resolve(value);
    }
  }

  private rejectRpc(id: string, error: Error): void {
    const entry = this.pendingRpc.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      this.pendingRpc.delete(id);
      entry.reject(error);
    }
  }

  private failAllRpc(error: Error): void {
    for (const [id] of [...this.pendingRpc]) {
      this.rejectRpc(id, error);
    }
  }
}
