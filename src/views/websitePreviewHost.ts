/**
 * Where the preview server's lifetime actually lives.
 *
 * The server is module state rather than a field on a panel, because two panels
 * can want it — the Studio's "Open preview" and a Generate that finishes and
 * wants to show its result — and a second server on a second port would leave
 * one of them showing a stale site with no clue why. One server, started on
 * demand, stopped when the preview window closes or the Studio does.
 *
 * Both gates are checked here rather than at the call sites. The panel asks; this
 * decides. That way "is generation allowed?" and "is a preview port allowed?"
 * each have exactly one answer, and adding a third caller cannot introduce a
 * fourth interpretation.
 */

import * as vscode from 'vscode';
import * as http from 'node:http';
import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AtlasMindContext } from '../extension.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { WEBSITE_PREVIEW_ROOT, type WebsiteGenerationPlan } from '../core/websiteGeneration.js';
import { WebsitePreviewServer } from '../core/websitePreviewServer.js';
import { describeGenerationRun, runWebsiteGeneration } from '../core/websiteGenerationRunner.js';
import { WebsitePreviewPanel } from './websitePreviewPanel.js';

let server: WebsitePreviewServer | undefined;

/** Deny by default. Opening a local port is a decision separate from using the Studio. */
function isPreviewEnabled(): boolean {
  return vscode.workspace.getConfiguration('atlasmind').get<boolean>('website.preview.enabled', false);
}

function isGenerationEnabled(): boolean {
  return vscode.workspace.getConfiguration('atlasmind').get<boolean>('website.generation.enabled', false);
}

function configuredPort(): number {
  const value = vscode.workspace.getConfiguration('atlasmind').get<number>('website.preview.port', 0);
  // Anything outside the unprivileged range falls back to ephemeral rather than
  // being clamped to a neighbouring port somebody did not choose.
  return Number.isInteger(value) && value >= 1024 && value <= 65_535 ? value : 0;
}

function previewRootFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...WEBSITE_PREVIEW_ROOT.split('/'));
}

function requireWorkspaceRoot(): string | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showErrorMessage('Open a workspace folder before using the website preview.');
    return undefined;
  }
  return root;
}

/** Start the server if it is not already running, and show the preview beside the Studio. */
export async function openWebsitePreview(context: vscode.ExtensionContext): Promise<void> {
  if (!isPreviewEnabled()) {
    const choice = await vscode.window.showWarningMessage(
      'The website preview is off.',
      {
        modal: true,
        detail: 'Turning it on starts a small web server bound to 127.0.0.1 that serves only '
          + `${WEBSITE_PREVIEW_ROOT}/. It is reachable from this machine only, and stops when you close the preview.`,
      },
      'Turn on and open',
    );
    if (choice !== 'Turn on and open') {
      return;
    }
    await vscode.workspace.getConfiguration('atlasmind')
      .update('website.preview.enabled', true, vscode.ConfigurationTarget.Workspace);
  }

  const workspaceRoot = requireWorkspaceRoot();
  if (!workspaceRoot) {
    return;
  }
  const root = previewRootFor(workspaceRoot);
  // Created up front so the server has something to serve; an empty folder gives
  // "not generated yet" rather than a failure to start.
  await mkdir(root, { recursive: true });

  try {
    if (!server?.running) {
      server = new WebsitePreviewServer({ rootDirectory: root, port: configuredPort(), http });
      await server.start();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Could not start the website preview server: ${detail}`);
    server = undefined;
    return;
  }

  const url = server.url;
  const port = server.port;
  if (!url || port === undefined) {
    void vscode.window.showErrorMessage('The website preview server started but reported no address.');
    return;
  }

  WebsitePreviewPanel.createOrShow(context, url, port, () => {
    void stopWebsitePreview();
  });
}

/** Stop the server. Safe to call when nothing is running — the Studio calls it on dispose. */
export async function stopWebsitePreview(): Promise<void> {
  const running = server;
  server = undefined;
  await running?.stop();
}

/** True when a preview is currently being served. */
export function isPreviewRunning(): boolean {
  return server?.running === true;
}

interface GenerateRequest {
  plan: WebsiteGenerationPlan;
}

/**
 * Run an already-confirmed plan.
 *
 * The plan arrives from the Studio, which built it with `planWebsiteGeneration`
 * and showed it in a modal. It is re-checked here anyway — the gate, the shape,
 * and every path — because a command is callable from the palette and from any
 * other extension, and "the caller already confirmed" is not something this side
 * can verify.
 */
export async function generateWebsiteFromPlan(
  atlas: AtlasMindContext,
  request: unknown,
): Promise<void> {
  if (!isGenerationEnabled()) {
    void vscode.window.showErrorMessage(
      'Website generation is off. Turn on atlasmind.website.generation.enabled to use it.',
    );
    return;
  }

  const plan = extractPlan(request);
  if (!plan) {
    void vscode.window.showErrorMessage(
      'Website generation was called without a plan. Use the Generate button in Website Studio.',
    );
    return;
  }

  const workspaceRoot = requireWorkspaceRoot();
  if (!workspaceRoot) {
    return;
  }
  const root = previewRootFor(workspaceRoot);

  const orchestrator = atlas.orchestrator as Orchestrator;
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating ${plan.targetLabel}…`,
      cancellable: false,
    },
    async () => runWebsiteGeneration({
      plan,
      previewRoot: root,
      complete: (systemPrompt, userPrompt) => orchestrator.completeWebsiteGeneration(systemPrompt, userPrompt),
      write: async (absolutePath, contents) => {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, contents, 'utf8');
      },
    }),
  );

  const summary = describeGenerationRun(result);
  if (result.status === 'failed' || result.written.length === 0) {
    void vscode.window.showErrorMessage(summary);
    return;
  }

  // Omissions are shown with the success, not instead of it. A partial result
  // reported as a whole one is the failure mode the plan's `omitted` list exists
  // to prevent.
  const message = result.omitted.length > 0 ? `${summary} ${result.omitted.join(' ')}` : summary;
  void vscode.window.showInformationMessage(message);

  await openWebsitePreview(atlas.extensionContext);
  WebsitePreviewPanel.currentPanel?.refresh();
}

/**
 * Pull a plan out of an unknown command argument.
 *
 * Structural, not a cast. The command is public, so the argument is untrusted
 * input like any other boundary — and a malformed plan reaching the writer would
 * be the one path where an unchecked path string could get near a file.
 */
function extractPlan(request: unknown): WebsiteGenerationPlan | undefined {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return undefined;
  }
  const candidate = (request as Partial<GenerateRequest>).plan;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }
  const plan = candidate as Partial<WebsiteGenerationPlan>;
  if (typeof plan.prompt !== 'string' || plan.prompt.length === 0) {
    return undefined;
  }
  if (!Array.isArray(plan.files) || plan.files.length === 0) {
    return undefined;
  }
  const filesUsable = plan.files.every(file =>
    typeof file === 'object' && file !== null && typeof (file as { relativePath?: unknown }).relativePath === 'string');
  if (!filesUsable) {
    return undefined;
  }
  return {
    stage: plan.stage ?? 'wireframe',
    targetLabel: typeof plan.targetLabel === 'string' ? plan.targetLabel : 'the website',
    files: plan.files,
    prompt: plan.prompt,
    omitted: Array.isArray(plan.omitted) ? plan.omitted.filter((item): item is string => typeof item === 'string') : [],
  };
}
