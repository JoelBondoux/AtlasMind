// Browser (web extension host) entry point for AtlasMind.
//
// This build runs inside a Web Worker on vscode.dev / github.dev / code-server.
// It has NO Node.js runtime — it is a thin client that remote-controls a full
// desktop AtlasMind instance over a localhost WebSocket. See docs/remote-control.md.
//
// Keep this file (and everything it imports) free of Node built-ins. Only
// `vscode`, WebWorker globals (WebSocket, etc.), the Node-free `src/remote/*`
// protocol, and shared webview markup may be used.
import * as vscode from 'vscode';
import { RemoteClient, type RemoteClientState } from './remoteClient.js';
import { ChatClientPanel } from './chatClientPanel.js';
import { DashboardPanel } from './dashboardPanel.js';

const CLIENT_TOKEN_SECRET_KEY = 'atlasmind.remote.clientToken';
const LAST_URL_STATE_KEY = 'atlasmind.remote.lastUrl';

let statusBar: vscode.StatusBarItem | undefined;

function describeState(state: RemoteClientState, url?: string): { text: string; tooltip: string } {
  switch (state) {
    case 'connected':
      return { text: '$(broadcast) AtlasMind: Connected', tooltip: `Connected to desktop AtlasMind at ${url ?? ''}` };
    case 'connecting':
      return { text: '$(loading~spin) AtlasMind: Connecting…', tooltip: `Connecting to ${url ?? ''}` };
    default:
      return { text: '$(plug) AtlasMind: Disconnected', tooltip: 'Connect to a desktop AtlasMind instance' };
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const client = new RemoteClient('AtlasMind Web');
  const chatPanel = new ChatClientPanel(context.extensionUri, client);
  const dashboardPanel = new DashboardPanel(client);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'atlasmind.remote.connect';
  const refreshStatus = (state: RemoteClientState): void => {
    if (!statusBar) {
      return;
    }
    const { text, tooltip } = describeState(state, client.getUrl());
    statusBar.text = text;
    statusBar.tooltip = tooltip;
    statusBar.show();
  };
  refreshStatus('disconnected');

  context.subscriptions.push(
    statusBar,
    client,
    chatPanel,
    dashboardPanel,
    vscode.commands.registerCommand('atlasmind.remote.showDashboard', async () => {
      if (client.getState() !== 'connected') {
        void vscode.window.showWarningMessage('Connect to a desktop AtlasMind instance first.');
        return;
      }
      await dashboardPanel.reveal();
    }),
    client.onStateChange(state => {
      refreshStatus(state);
      if (state === 'connected') {
        chatPanel.reveal();
      }
    }),
    vscode.commands.registerCommand('atlasmind.remote.connect', async () => {
      const lastUrl = context.globalState.get<string>(LAST_URL_STATE_KEY, 'ws://localhost:');
      const url = await vscode.window.showInputBox({
        title: 'Connect to desktop AtlasMind',
        prompt: 'WebSocket URL shown by "AtlasMind: Enable Remote Control" on your desktop',
        value: lastUrl,
        ignoreFocusOut: true,
        validateInput: value => (value.startsWith('ws://') || value.startsWith('wss://') ? undefined : 'URL must start with ws:// or wss://'),
      });
      if (!url) {
        return;
      }
      const existingToken = await context.secrets.get(CLIENT_TOKEN_SECRET_KEY);
      const token = await vscode.window.showInputBox({
        title: 'Pairing token',
        prompt: 'Paste the pairing token from the desktop (leave blank to reuse the saved token)',
        password: true,
        ignoreFocusOut: true,
        value: '',
      });
      const effectiveToken = (token && token.trim().length > 0) ? token.trim() : existingToken;
      if (!effectiveToken) {
        void vscode.window.showWarningMessage('A pairing token is required to connect.');
        return;
      }
      await context.secrets.store(CLIENT_TOKEN_SECRET_KEY, effectiveToken);
      await context.globalState.update(LAST_URL_STATE_KEY, url);
      client.connect(url, effectiveToken);
    }),
    vscode.commands.registerCommand('atlasmind.remote.disconnect', () => {
      client.disconnect();
      void vscode.window.showInformationMessage('Disconnected from desktop AtlasMind.');
    }),
  );
}

export function deactivate(): void {
  statusBar?.dispose();
  statusBar = undefined;
}
