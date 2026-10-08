import * as vscode from 'vscode';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { interceptDryRun } from '../core/dryRunHost.js';
import type { DryRunHostEffect } from '../core/dryRun.js';
import {
  createWorkspaceCommandProbe,
  resolveWorkspaceCommand,
  type WorkspaceCommandResolution,
} from '../core/windowsShimBypass.js';
import {
  assessStaticSurfaceReferences,
  buildStaticSurfaceDocument,
  describeDevServerConfirmation,
  describeUiSurfaceRender,
  devServerAddress,
  findDevServerUrl,
  STATIC_SURFACE_MAX_BYTES,
  type DevServerPlan,
  type UiSurfaceRenderMode,
} from '../core/uiSurfaceRender.js';

/**
 * Shows a discovered surface as itself, beside UI Studio.
 *
 * Two ways, chosen by `uiSurfaceRender`'s rule table and never by this file.
 * A static page renders in a companion webview with scripts disabled, a policy
 * allowing nothing from anywhere but the page's own folder, and resource roots
 * limited to that folder — refreshed when anything in the folder changes. A
 * component renders through the project's own dev server, started only after a
 * modal that shows the exact argv, run without a shell, held by a dry run, and
 * stopped when the Studio closes; the page opens in VS Code's built-in browser
 * at the address the server itself printed.
 *
 * Every render reports one sentence — `describeUiSurfaceRender` — to the
 * Studio's card, so what is on screen is always named: a real file at a path as
 * of a time, a dev server at an address, or not renderable and why.
 */

export interface UiSurfaceRenderUpdate {
  surfaceId: string;
  mode: UiSurfaceRenderMode;
  statement: string;
}

export interface StaticSurfaceTarget {
  surfaceId: string;
  /** Workspace-relative, forward-slashed, as the scan listed it. */
  path: string;
  label: string;
}

const REFRESH_DEBOUNCE_MS = 250;
/** How long the dev server has to print a local address before the wait gives up. */
const DEV_SERVER_ADDRESS_TIMEOUT_MS = 90_000;
const DEV_SERVER_OUTPUT_SCAN_BYTES = 64 * 1024;

/** The process handle the dev-server path needs; a subset of `ChildProcess` a test can fake. */
export interface DevServerChild {
  pid?: number | undefined;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface DevServerStartDeps {
  /** Shows the confirmation; resolves true only on an explicit yes. */
  confirm(title: string, detail: string): Promise<boolean>;
  /** The dry-run guard. A returned record means the start must not happen. */
  intercept(effect: DryRunHostEffect): unknown;
  resolve(command: string, args: readonly string[]): WorkspaceCommandResolution;
  spawn(command: string, args: readonly string[], cwd: string): DevServerChild;
}

export type DevServerStartOutcome =
  | { status: 'started'; child: DevServerChild; argv: string[] }
  | { status: 'declined' }
  | { status: 'dry-run' }
  | { status: 'unresolved'; reason: string };

/**
 * Resolve, confirm, check the dry run, and only then spawn.
 *
 * The order is the policy. Resolution comes first so the dialog shows the argv
 * that will actually run — on Windows that is `node …/npm-cli.js run dev`, not
 * `npm run dev` — and a command that cannot be run without a shell is refused
 * before anybody is asked about it. Nothing is spawned without a yes.
 */
export async function confirmAndStartDevServer(
  plan: Extract<DevServerPlan, { status: 'ready' }>,
  workspaceRoot: string,
  deps: DevServerStartDeps,
): Promise<DevServerStartOutcome> {
  const resolution = deps.resolve(plan.command, plan.args);
  if (resolution.status === 'unresolved') {
    return { status: 'unresolved', reason: resolution.reason };
  }
  const argv = [resolution.command, ...resolution.args];
  const confirmed = await deps.confirm(
    `Start the project's dev server (${plan.packageManager} run ${plan.scriptName})?`,
    describeDevServerConfirmation(plan, argv, workspaceRoot),
  );
  if (!confirmed) {
    return { status: 'declined' };
  }
  if (deps.intercept({
    surface: 'ui-studio-dev-server',
    kind: 'process',
    summary: `start the dev server (${plan.packageManager} run ${plan.scriptName})`,
    details: { command: plan.command, args: plan.args },
    wouldHaveAsked: true,
  })) {
    return { status: 'dry-run' };
  }
  return { status: 'started', child: deps.spawn(resolution.command, resolution.args, workspaceRoot), argv };
}

interface RunningDevServer {
  child: DevServerChild;
  scriptName: string;
  origin?: string;
  /** Opened once the server prints its address. */
  pending?: { surfaceId: string; path: string; plan: Extract<DevServerPlan, { status: 'ready' }> };
}

export class UiSurfaceRenderHost {
  private renderPanel: vscode.WebviewPanel | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private current: StaticSurfaceTarget | undefined;
  private devServer: RunningDevServer | undefined;
  private output: vscode.OutputChannel | undefined;

  constructor(
    private readonly workspaceRoot: string,
    private readonly report: (update: UiSurfaceRenderUpdate) => void,
  ) {}

  // ── Static ──────────────────────────────────────────────────────

  /**
   * Render a static page as itself. The path is the scan's, and is checked
   * again here — after symlinks are resolved — to sit inside the workspace.
   */
  renderStatic(target: StaticSurfaceTarget): void {
    this.current = target;
    const root = this.realWorkspaceRoot();
    const absolute = path.resolve(root, ...target.path.split('/'));
    let real: string;
    try {
      real = nodeFs.realpathSync(absolute);
    } catch {
      this.showStaticMessage(target, describeUiSurfaceRender({ kind: 'missing', path: target.path }));
      return;
    }
    if (!isInside(root, real)) {
      this.showStaticMessage(target, describeUiSurfaceRender({ kind: 'not-renderable', path: target.path, reason: 'it resolves outside the workspace.' }));
      return;
    }
    let stat: nodeFs.Stats;
    let html: string;
    try {
      stat = nodeFs.statSync(real);
      if (stat.size > STATIC_SURFACE_MAX_BYTES) {
        this.showStaticMessage(target, describeUiSurfaceRender({
          kind: 'not-renderable', path: target.path,
          reason: `it is ${Math.round(stat.size / 1024)} KB, over the ${STATIC_SURFACE_MAX_BYTES / 1024 / 1024} MB a render will read.`,
        }));
        return;
      }
      html = nodeFs.readFileSync(real, 'utf8');
    } catch {
      this.showStaticMessage(target, describeUiSurfaceRender({ kind: 'missing', path: target.path }));
      return;
    }
    const folder = vscode.Uri.file(path.dirname(real));
    const panel = this.ensurePanel(target, folder);
    const statement = describeUiSurfaceRender({
      kind: 'static-file',
      path: target.path,
      modifiedAt: stat.mtime.toISOString(),
      report: assessStaticSurfaceReferences(html),
    });
    panel.webview.html = buildStaticSurfaceDocument({
      html,
      baseHref: panel.webview.asWebviewUri(folder).toString(),
      cspSource: panel.webview.cspSource,
    });
    this.watch(folder);
    this.report({ surfaceId: target.surfaceId, mode: 'static-file', statement });
  }

  private ensurePanel(target: StaticSurfaceTarget, folder: vscode.Uri): vscode.WebviewPanel {
    // Scripts off at the webview, not only in the policy: two locks.
    const options: vscode.WebviewOptions = { enableScripts: false, enableForms: false, localResourceRoots: [folder] };
    const title = `${target.label} — real file`;
    if (this.renderPanel) {
      this.renderPanel.webview.options = options;
      this.renderPanel.title = title;
      this.renderPanel.reveal(vscode.ViewColumn.Beside, true);
      return this.renderPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'atlasmind.uiSurfaceRender',
      title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      options,
    );
    panel.onDidDispose(() => {
      this.renderPanel = undefined;
      this.current = undefined;
      this.disposeWatcher();
    });
    this.renderPanel = panel;
    return panel;
  }

  /** A message in place of a render, with no file content at all. */
  private showStaticMessage(target: StaticSurfaceTarget, statement: string): void {
    if (this.renderPanel) {
      this.renderPanel.webview.options = { enableScripts: false, enableForms: false, localResourceRoots: [] };
      this.renderPanel.webview.html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><p>${escapeText(statement)}</p>`;
    }
    this.report({ surfaceId: target.surfaceId, mode: 'not-renderable', statement });
  }

  /** Refresh on any change in the surface's folder — its stylesheet is as much the page as its markup. */
  private watch(folder: vscode.Uri): void {
    this.disposeWatcher();
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
    const refresh = () => {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
      }
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        if (this.current && this.renderPanel) {
          this.renderStatic(this.current);
        }
      }, REFRESH_DEBOUNCE_MS);
    };
    watcher.onDidChange(refresh);
    watcher.onDidCreate(refresh);
    watcher.onDidDelete(refresh);
    this.watcher = watcher;
  }

  private disposeWatcher(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private realWorkspaceRoot(): string {
    try {
      return nodeFs.realpathSync(this.workspaceRoot);
    } catch {
      return path.resolve(this.workspaceRoot);
    }
  }

  // ── Dev server ──────────────────────────────────────────────────

  get devServerRunning(): boolean {
    return this.devServer !== undefined;
  }

  /**
   * Show a component through the project's dev server.
   *
   * A server this panel already started is reused — the confirmation was for
   * starting a process, and opening another route on it starts nothing. A new
   * one is started only through `confirmAndStartDevServer`.
   */
  async renderViaDevServer(surfaceId: string, surfacePath: string, plan: Extract<DevServerPlan, { status: 'ready' }>): Promise<void> {
    if (this.devServer) {
      this.devServer.pending = { surfaceId, path: surfacePath, plan };
      if (this.devServer.origin) {
        await this.openDevServerPage();
      } else {
        this.report({ surfaceId, mode: 'dev-server', statement: 'The dev server is starting; the page opens when it prints its local address.' });
      }
      return;
    }
    const outcome = await confirmAndStartDevServer(plan, this.workspaceRoot, {
      confirm: async (title, detail) => (await vscode.window.showWarningMessage(title, { modal: true, detail }, 'Start it')) === 'Start it',
      intercept: effect => interceptDryRun(effect),
      resolve: (command, args) => resolveWorkspaceCommand(command, args, createWorkspaceCommandProbe()),
      spawn: (command, args, cwd) => spawn(command, [...args], {
        cwd,
        shell: false,
        windowsHide: true,
        // Its own process group on POSIX, so Stop can end the server npm started too.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    });
    if (outcome.status === 'unresolved') {
      throw new Error(outcome.reason);
    }
    if (outcome.status !== 'started') {
      return;
    }
    const running: RunningDevServer = { child: outcome.child, scriptName: plan.scriptName, pending: { surfaceId, path: surfacePath, plan } };
    this.devServer = running;
    const output = this.outputChannel();
    output.appendLine(`$ ${outcome.argv.join(' ')}`);
    let seen = '';
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timer = undefined;
      if (this.devServer === running && !running.origin) {
        this.report({
          surfaceId,
          mode: 'dev-server',
          statement: `The dev server has not printed a local address after ${DEV_SERVER_ADDRESS_TIMEOUT_MS / 1000} s, so nothing was opened. Its output is in the "AtlasMind UI Studio: dev server" channel.`,
        });
      }
    }, DEV_SERVER_ADDRESS_TIMEOUT_MS);
    const read = (chunk: Buffer | string) => {
      const text = chunk.toString();
      output.append(text);
      if (running.origin) {
        return;
      }
      seen = `${seen}${text}`.slice(-DEV_SERVER_OUTPUT_SCAN_BYTES);
      const origin = findDevServerUrl(seen);
      if (origin) {
        running.origin = origin;
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        void this.openDevServerPage();
      }
    };
    outcome.child.stdout?.on('data', read);
    outcome.child.stderr?.on('data', read);
    outcome.child.once('error', error => {
      output.appendLine(`Could not start: ${error.message}`);
    });
    outcome.child.once('exit', code => {
      if (timer) {
        clearTimeout(timer);
      }
      output.appendLine(`The dev server exited (${code ?? 'signal'}).`);
      if (this.devServer === running) {
        this.devServer = undefined;
        this.report({ surfaceId, mode: 'dev-server', statement: `The dev server exited (${code ?? 'signal'}), so nothing is being served. Its output is in the "AtlasMind UI Studio: dev server" channel.` });
      }
    });
    this.report({ surfaceId, mode: 'dev-server', statement: `Started ${outcome.argv.join(' ')}. Waiting for it to print its local address…` });
  }

  private async openDevServerPage(): Promise<void> {
    const running = this.devServer;
    const pending = running?.pending;
    if (!running?.origin || !pending) {
      return;
    }
    const address = devServerAddress(running.origin, pending.plan.route);
    await vscode.commands.executeCommand('simpleBrowser.api.open', address, {
      title: `${pending.path.split('/').pop() ?? pending.path} — dev server`,
      viewColumn: vscode.ViewColumn.Beside,
    });
    this.report({
      surfaceId: pending.surfaceId,
      mode: 'dev-server',
      statement: describeUiSurfaceRender({ kind: 'dev-server', path: pending.path, address, scriptName: running.scriptName, route: pending.plan.route }),
    });
  }

  /** End the server this panel started — the whole tree, since npm runs the real server as its child. */
  stopDevServer(): boolean {
    const running = this.devServer;
    if (!running) {
      return false;
    }
    this.devServer = undefined;
    const pid = running.child.pid;
    try {
      if (process.platform === 'win32' && pid !== undefined) {
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, error => {
          if (error) {
            try { running.child.kill(); } catch { /* already gone */ }
          }
        });
      } else if (pid !== undefined) {
        process.kill(-pid, 'SIGTERM');
      } else {
        running.child.kill();
      }
    } catch {
      try { running.child.kill(); } catch { /* already gone */ }
    }
    this.outputChannel().appendLine('Stopped the dev server.');
    return true;
  }

  private outputChannel(): vscode.OutputChannel {
    this.output ??= vscode.window.createOutputChannel('AtlasMind UI Studio: dev server');
    return this.output;
  }

  dispose(): void {
    this.stopDevServer();
    this.disposeWatcher();
    this.renderPanel?.dispose();
    this.renderPanel = undefined;
    this.output?.dispose();
    this.output = undefined;
  }
}

function isInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
