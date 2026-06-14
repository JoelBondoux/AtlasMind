// Web-build chat surface. Renders the shared chat markup in a webview and bridges
// its postMessage protocol to the RemoteClient, which relays to the desktop. The
// webview front-end (media/chatPanel.js) is identical to the desktop build and is
// unaware it is being driven remotely. See docs/remote-control.md.
import * as vscode from 'vscode';
import { buildChatWebviewHtml } from '../views/chatWebviewMarkup.js';
import type { RemoteClient } from './remoteClient.js';

export class ChatClientPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly bridgeDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: RemoteClient,
  ) {}

  reveal(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'atlasmind.remoteChat',
      'AtlasMind (Remote)',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      },
    );
    this.panel = panel;

    const scriptUri = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chatPanel.js'))
      .toString();
    panel.webview.html = buildChatWebviewHtml({ scriptUri, cspSource: panel.webview.cspSource });

    // Webview → desktop.
    this.bridgeDisposables.push(
      panel.webview.onDidReceiveMessage(message => this.client.sendChat(message)),
    );
    // Desktop → webview.
    this.bridgeDisposables.push(
      this.client.onChatMessage(message => {
        void panel.webview.postMessage(message);
      }),
    );

    panel.onDidDispose(() => {
      this.disposeBridge();
      this.panel = undefined;
    });
  }

  private disposeBridge(): void {
    for (const disposable of this.bridgeDisposables.splice(0)) {
      disposable.dispose();
    }
  }

  dispose(): void {
    this.disposeBridge();
    this.panel?.dispose();
    this.panel = undefined;
  }
}
