// Desktop remote-control server. Accepts paired WebSocket connections from the
// AtlasMind web build and binds each authenticated client to a real ChatPanel via
// a synthetic webview host. Desktop-only (Node + `ws`); never imported by the web
// build. See docs/remote-control.md for the architecture and security model.
import * as vscode from 'vscode';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ChatPanel } from '../views/chatPanel.js';
import type { AtlasMindContext } from '../extension.js';
import { RemoteWebviewHost } from './remoteBridge.js';
import {
  REMOTE_PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
  errorFrame,
  ackFrame,
  chatFrame,
  isRemoteAuthPayload,
  isChatChannelPayload,
  isRemoteRpcRequest,
  type RemoteEnvelope,
} from './protocol.js';

const PAIRING_TOKEN_SECRET_KEY = 'atlasmind.remote.pairingToken';
const WORKSPACE_APPROVED_KEY = 'atlasmind.remote.workspaceApproved';
const AUTH_TIMEOUT_MS = 10_000;

interface RemoteSession {
  socket: WebSocket;
  host: RemoteWebviewHost;
  panel: ChatPanel;
  authenticated: boolean;
}

export interface RemoteServerStatus {
  running: boolean;
  url?: string;
  clientCount: number;
}

/** Optional read-only RPC handler for the cost/runs channels (wired in Phase 4). */
export type RemoteRpcHandler = (
  channel: 'cost' | 'runs',
  request: { method: string; params?: Record<string, unknown> },
) => Promise<unknown>;

export class RemoteControlServer {
  private server: WebSocketServer | undefined;
  private readonly sessions = new Set<RemoteSession>();
  private boundPort: number | undefined;
  private rpcHandler: RemoteRpcHandler | undefined;
  private readonly statusEmitter = new vscode.EventEmitter<RemoteServerStatus>();
  readonly onStatusChange = this.statusEmitter.event;

  constructor(
    private readonly atlas: AtlasMindContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Inject the read-only cost/runs RPC handler. */
  setRpcHandler(handler: RemoteRpcHandler): void {
    this.rpcHandler = handler;
  }

  private emitStatus(): void {
    this.statusEmitter.fire(this.getStatus());
  }

  isRunning(): boolean {
    return this.server !== undefined;
  }

  getStatus(): RemoteServerStatus {
    return {
      running: this.isRunning(),
      url: this.boundPort ? `ws://localhost:${this.boundPort}` : undefined,
      clientCount: [...this.sessions].filter(s => s.authenticated).length,
    };
  }

  // ── Security gates (modeled on ToolWebhookDispatcher) ─────────────────────

  private async hasWorkspaceApproval(): Promise<boolean> {
    return this.atlas.extensionContext.workspaceState.get<boolean>(WORKSPACE_APPROVED_KEY, false);
  }

  private async ensureWorkspaceApproval(interactive: boolean): Promise<boolean> {
    if (await this.hasWorkspaceApproval()) {
      return true;
    }
    if (!interactive) {
      return false;
    }
    const choice = await vscode.window.showWarningMessage(
      'Enabling remote control lets a paired web client drive this AtlasMind instance — including running tools and tasks. The server listens only on localhost and requires a pairing token. Approve remote control for this workspace?',
      { modal: true },
      'Approve remote control',
    );
    if (choice !== 'Approve remote control') {
      return false;
    }
    await this.atlas.extensionContext.workspaceState.update(WORKSPACE_APPROVED_KEY, true);
    return true;
  }

  private async getOrCreateToken(): Promise<string> {
    const existing = await this.atlas.extensionContext.secrets.get(PAIRING_TOKEN_SECRET_KEY);
    if (existing && existing.trim().length > 0) {
      return existing.trim();
    }
    const token = randomBytes(32).toString('base64url');
    await this.atlas.extensionContext.secrets.store(PAIRING_TOKEN_SECRET_KEY, token);
    return token;
  }

  async getPairingToken(): Promise<string | undefined> {
    const token = await this.atlas.extensionContext.secrets.get(PAIRING_TOKEN_SECRET_KEY);
    return token && token.trim().length > 0 ? token.trim() : undefined;
  }

  /** Rotate the token and drop all sessions. */
  async revoke(): Promise<void> {
    await this.atlas.extensionContext.secrets.delete(PAIRING_TOKEN_SECRET_KEY);
    this.dropAllSessions('access revoked');
    this.output.appendLine('[remote] Pairing token revoked; all sessions dropped.');
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Start listening. Returns the pairing details or undefined if blocked. */
  async enable(interactive: boolean): Promise<{ url: string; token: string } | undefined> {
    if (this.isRunning()) {
      const token = await this.getPairingToken();
      return token && this.boundPort ? { url: `ws://localhost:${this.boundPort}`, token } : undefined;
    }
    if (!(await this.ensureWorkspaceApproval(interactive))) {
      this.output.appendLine('[remote] Enable aborted: workspace not approved for remote control.');
      return undefined;
    }

    const token = await this.getOrCreateToken();
    const configuredPort = vscode.workspace.getConfiguration('atlasmind').get<number>('remote.port', 0);

    return await new Promise<{ url: string; token: string } | undefined>((resolve) => {
      const server = new WebSocketServer({ host: '127.0.0.1', port: configuredPort ?? 0 });
      server.on('listening', () => {
        const address = server.address();
        this.boundPort = typeof address === 'object' && address ? address.port : configuredPort;
        this.server = server;
        this.output.appendLine(`[remote] Listening on ws://localhost:${this.boundPort}`);
        this.emitStatus();
        resolve({ url: `ws://localhost:${this.boundPort}`, token });
      });
      server.on('connection', socket => this.onConnection(socket, token));
      server.on('error', err => {
        this.output.appendLine(`[remote] Server error: ${err instanceof Error ? err.message : String(err)}`);
        resolve(undefined);
      });
    });
  }

  disable(): void {
    this.dropAllSessions('server stopped');
    this.server?.close();
    this.server = undefined;
    this.boundPort = undefined;
    this.output.appendLine('[remote] Server stopped.');
    this.emitStatus();
  }

  dispose(): void {
    this.disable();
    this.statusEmitter.dispose();
  }

  private dropAllSessions(reason: string): void {
    for (const session of [...this.sessions]) {
      this.closeSession(session, reason);
    }
  }

  private closeSession(session: RemoteSession, reason: string): void {
    if (!this.sessions.has(session)) {
      return;
    }
    this.sessions.delete(session);
    // Disposing the host fires onDidDispose, which disposes the ChatPanel and
    // aborts any in-flight execution — pending tool approvals default to denied.
    session.host.dispose();
    try {
      session.socket.close();
    } catch {
      /* already closing */
    }
    this.output.appendLine(`[remote] Session closed (${reason}). Active clients: ${this.getStatus().clientCount}`);
    this.emitStatus();
  }

  // ── Connection handling ─────────────────────────────────────────────────────

  private onConnection(socket: WebSocket, token: string): void {
    const host = new RemoteWebviewHost(message => {
      this.safeSend(socket, chatFrame(message));
    });
    const session: RemoteSession = { socket, host, panel: undefined as unknown as ChatPanel, authenticated: false };
    this.sessions.add(session);

    const authTimer = setTimeout(() => {
      if (!session.authenticated) {
        this.output.appendLine('[remote] Auth timeout; dropping unauthenticated connection.');
        this.closeSession(session, 'auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    socket.on('message', (data: RawData) => {
      void this.onMessage(session, token, data, authTimer);
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      this.closeSession(session, 'client disconnected');
    });
    socket.on('error', () => {
      clearTimeout(authTimer);
      this.closeSession(session, 'socket error');
    });
  }

  private async onMessage(
    session: RemoteSession,
    token: string,
    data: RawData,
    authTimer: NodeJS.Timeout,
  ): Promise<void> {
    const envelope = decodeFrame(data.toString());
    if (!envelope || envelope.v !== REMOTE_PROTOCOL_VERSION) {
      this.safeSend(session.socket, errorFrame({ code: 'invalid-frame', message: 'Malformed or unsupported frame.' }, envelope?.id));
      return;
    }

    // First frame must authenticate.
    if (!session.authenticated) {
      if (envelope.kind !== 'auth' || !isRemoteAuthPayload(envelope.payload) || !this.tokenMatches(envelope.payload.token, token)) {
        this.output.appendLine('[remote] Rejected connection: authentication failed.');
        this.safeSend(session.socket, errorFrame({ code: 'unauthenticated', message: 'Invalid pairing token.' }, envelope.id));
        this.closeSession(session, 'authentication failed');
        return;
      }
      clearTimeout(authTimer);
      session.authenticated = true;
      session.panel = new ChatPanel(session.host, this.atlas.extensionContext.extensionUri, this.atlas);
      this.output.appendLine(`[remote] Client authenticated${envelope.payload.clientName ? ` (${envelope.payload.clientName})` : ''}. Active clients: ${this.getStatus().clientCount}`);
      this.safeSend(session.socket, ackFrame('chat', envelope.id ?? 'auth', { ok: true, v: REMOTE_PROTOCOL_VERSION }));
      this.emitStatus();
      return;
    }

    // Authenticated traffic.
    if (envelope.channel === 'chat' && envelope.kind === 'msg') {
      if (!isChatChannelPayload(envelope.payload)) {
        this.safeSend(session.socket, errorFrame({ code: 'invalid-frame', message: 'Invalid chat message.' }, envelope.id));
        return;
      }
      session.host.deliverInbound(envelope.payload);
      return;
    }

    if ((envelope.channel === 'cost' || envelope.channel === 'runs') && envelope.kind === 'rpc') {
      await this.handleRpc(session, envelope);
      return;
    }

    this.safeSend(session.socket, errorFrame({ code: 'unsupported', message: `Unsupported frame on channel ${envelope.channel}.` }, envelope.id));
  }

  private async handleRpc(session: RemoteSession, envelope: RemoteEnvelope): Promise<void> {
    const channel = envelope.channel as 'cost' | 'runs';
    if (!isRemoteRpcRequest(envelope.payload)) {
      this.safeSend(session.socket, errorFrame({ code: 'invalid-frame', message: 'Invalid RPC request.' }, envelope.id));
      return;
    }
    if (!this.rpcHandler) {
      this.safeSend(session.socket, errorFrame({ code: 'unsupported', message: 'Read-only RPC not available.' }, envelope.id));
      return;
    }
    try {
      const result = await this.rpcHandler(channel, envelope.payload);
      this.safeSend(session.socket, ackFrame(channel, envelope.id ?? channel, result));
    } catch (err) {
      this.output.appendLine(`[remote] RPC error: ${err instanceof Error ? err.message : String(err)}`);
      this.safeSend(session.socket, errorFrame({ code: 'internal', message: 'RPC failed.' }, envelope.id));
    }
  }

  private tokenMatches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  private safeSend(socket: WebSocket, envelope: RemoteEnvelope): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      socket.send(encodeFrame(envelope));
    } catch (err) {
      this.output.appendLine(`[remote] Send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
