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
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AtlasMindContext } from '../extension.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { WEBSITE_PREVIEW_ROOT, pagePath, type WebsiteGenerationPlan } from '../core/websiteGeneration.js';
import { WebsiteWorkspaceManager } from '../core/websiteWorkspaceManager.js';
import { WebsiteContentManager, WebsiteReviewManager } from '../core/websiteContentManager.js';
import {
  REVIEW_OVERLAY_FILENAME,
  REVIEW_OVERLAY_SCRIPT,
  buildReviewOverlay,
  injectReviewOverlay,
  sanitizeEndpoint,
} from '../core/websiteReviewBundle.js';
import {
  previewPathFor,
  renderWireframeIndex,
  renderWireframePreview,
  WIREFRAME_INDEX_PATH,
} from '../core/websiteWireframePreview.js';
import { WebsitePreviewServer } from '../core/websitePreviewServer.js';
import { injectUiPreviewRuntime, type UiPreviewSelectionEvent } from '../core/uiPreviewRuntime.js';
import { UI_DESIGN_GRAPH_MAX_REVISION } from '../core/uiDesignGraph.js';
import { describeGenerationRun, runWebsiteGeneration } from '../core/websiteGenerationRunner.js';
import { WebsitePreviewPanel } from './websitePreviewPanel.js';

let server: WebsitePreviewServer | undefined;
let lifecycleRegistered = false;
let previewRenderRevision = 0;
const selectionListeners = new Set<(selection: WebsitePreviewSelection) => void>();

export interface WebsitePreviewSelection {
  pageId: string;
  nodeId: string;
}

/** Subscribe a Studio surface to current, host-resolved preview selections. */
export function onWebsitePreviewSelection(
  listener: (selection: WebsitePreviewSelection) => void,
): vscode.Disposable {
  selectionListeners.add(listener);
  return { dispose: () => selectionListeners.delete(listener) };
}

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

interface RunningPreview {
  entryPath: string;
  port: number;
  url: string;
}

/** Start the server if it is not already running and return its canonical draft URL. */
async function ensureWebsitePreview(context: vscode.ExtensionContext): Promise<RunningPreview | undefined> {
  if (!isPreviewEnabled()) {
    const choice = await vscode.window.showWarningMessage(
      'The UI preview is off.',
      {
        modal: true,
        detail: 'Turning it on starts a small web server bound to 127.0.0.1 that serves only '
          + `${WEBSITE_PREVIEW_ROOT}/. It is reachable from this machine only and stops with UI Studio or the Stop Preview command.`,
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
  await mkdir(root, { recursive: true });

  // Render the wireframes before starting. Without this, opening the preview
  // before anything has been generated served the 404 — a white page with one
  // line of grey text, which is exactly what it looked like. These are
  // deterministic, cost nothing, and mean the preview always shows the drawing.
  const rendered = await writeWireframePreviews(workspaceRoot, root);

  try {
    if (!server?.running) {
      server = new WebsitePreviewServer({
        rootDirectory: root,
        port: configuredPort(),
        http,
        // Tied to the same setting that puts the overlay into the pages, so
        // the policy widens exactly when there is something that needs it.
        allowOverlayScript: vscode.workspace.getConfiguration('atlasmind')
          .get<boolean>('website.review.includeOverlayInBuild', false),
        allowLiveRuntime: true,
        initialRevision: rendered.revision ?? previewRenderRevision,
        onSelection: event => dispatchPreviewSelection(workspaceRoot, event),
      });
      await server.start();
    }
    if (rendered.revision !== undefined) {
      server.publishRevision(rendered.revision);
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
    void vscode.window.showErrorMessage('The UI preview server started but reported no address.');
    return;
  }

  if (!lifecycleRegistered) {
    lifecycleRegistered = true;
    context.subscriptions.push({ dispose: () => { void stopWebsitePreview(); } });
  }
  return { entryPath: rendered.entryPath, port, url };
}

/** Open the canonical full-canvas preview in VS Code's built-in Simple Browser. */
export async function openWebsitePreview(context: vscode.ExtensionContext): Promise<void> {
  const preview = await ensureWebsitePreview(context);
  if (!preview) {
    return;
  }
  await vscode.commands.executeCommand(
    'simpleBrowser.api.open',
    `${preview.url}${preview.entryPath}`,
    { title: 'UI Studio Preview', viewColumn: vscode.ViewColumn.Beside },
  );
}

/** Open the guarded iframe with explicit desktop/tablet/mobile widths. */
export async function openResponsiveWebsitePreview(context: vscode.ExtensionContext): Promise<void> {
  const preview = await ensureWebsitePreview(context);
  if (!preview) {
    return;
  }
  WebsitePreviewPanel.createOrShow(context, `${preview.url}${preview.entryPath}`, preview.port, () => {
    void stopWebsitePreview();
  });
}

/**
 * Render every page's wireframe into the preview root, and say which page the
 * preview should open on.
 *
 * The renders live under `_wireframe/`, deliberately *not* at the address a
 * generated page occupies. Sharing an address would mean either the create-only
 * rule blocking a later Generate, or a Generate silently replacing the wireframe
 * — and in both cases somebody ends up looking at the wrong thing while
 * believing they are looking at the other. Side by side, both stay available.
 *
 * Unlike generated files these *are* overwritten each time: they are derived
 * from the canvas, cost nothing to rebuild, and a stale one would show a drawing
 * that no longer exists.
 *
 * Returns the deterministic design-preview index. Generated output stays linked
 * from that index, but it never replaces the content/style/structure feedback loop.
 */
interface RenderedWireframePreview {
  entryPath: string;
  revision?: number;
}

async function writeWireframePreviews(
  workspaceRoot: string,
  root: string,
): Promise<RenderedWireframePreview> {
  let config;
  try {
    config = new WebsiteWorkspaceManager(workspaceRoot).load();
  } catch {
    // No workspace file yet. Nothing to draw, and the server will answer
    // honestly rather than this failing the whole open.
    return { entryPath: '' };
  }

  const renderRevision = Math.min(
    UI_DESIGN_GRAPH_MAX_REVISION,
    Math.max(config.designGraph.revision, previewRenderRevision + 1),
  );
  try {
    await mkdir(path.join(root, '_wireframe'), { recursive: true });
    const contentDirectory = vscode.workspace.getConfiguration('atlasmind')
      .get<string>('website.content.directory', 'content');
    const contents = new WebsiteContentManager(workspaceRoot, contentDirectory).read(config.pages);

    await writeFile(
      path.join(root, WIREFRAME_INDEX_PATH),
      injectUiPreviewRuntime(
        renderWireframeIndex(
          config.pages,
          config.designSystem,
          config.intake.projectName,
          {
            contents,
            generatedAvailable: existsSync(path.join(root, 'index.html')),
            tokens: config.designGraph.tokens,
          },
        ),
        renderRevision,
      ),
      'utf8',
    );

    for (const page of config.pages) {
      const responsiveScreen = config.designGraph.screens.find(screen => screen.pageId === page.id);
      await writeFile(
        path.join(root, previewPathFor(page)),
        injectUiPreviewRuntime(
          renderWireframePreview({
            page,
            designSystem: config.designSystem,
            siblings: config.pages,
            content: contents.get(page.id),
            tokens: config.designGraph.tokens,
            components: config.designGraph.components,
            contentCollections: config.designGraph.contentCollections,
            ...(responsiveScreen ? { responsiveScreen } : {}),
            ...(config.intake.projectName ? { siteName: config.intake.projectName } : {}),
          }),
          renderRevision,
        ),
        'utf8',
      );
    }
  } catch {
    // A failed render must not stop the preview opening — the generated site may
    // still be there and is the more important thing to show. If it is not, the
    // root answers "not generated yet", which is at least true.
    return { entryPath: '' };
  }

  previewRenderRevision = renderRevision;
  return { entryPath: WIREFRAME_INDEX_PATH, revision: renderRevision };
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

/** Rebuild the deterministic draft after a Studio save without opening a port. */
export async function refreshRunningWebsitePreview(): Promise<void> {
  if (!server?.running) {
    return;
  }
  const workspaceRoot = requireWorkspaceRoot();
  if (!workspaceRoot) {
    return;
  }
  const root = previewRootFor(workspaceRoot);
  const rendered = await writeWireframePreviews(workspaceRoot, root);
  if (rendered.revision !== undefined) {
    server.publishRevision(rendered.revision);
    WebsitePreviewPanel.currentPanel?.refresh();
  }
}

/** Publish a Studio selection only after resolving it against the saved graph. */
export function selectWebsitePreviewTarget(pageId: string, nodeId: string): boolean {
  if (!server?.running) {
    return false;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return false;
  }
  const selection = resolveSavedPreviewSelection(workspaceRoot, pageId, nodeId);
  return selection ? server.publishSelection(selection.pageId, selection.nodeId) : false;
}

function dispatchPreviewSelection(workspaceRoot: string, event: UiPreviewSelectionEvent): boolean {
  const selection = resolveSavedPreviewSelection(workspaceRoot, event.screenId, event.nodeId);
  if (!selection) {
    return false;
  }
  for (const listener of selectionListeners) {
    try {
      listener(selection);
    } catch {
      // One disposed/broken Studio surface must not block another listener or
      // turn an ephemeral click into a failed HTTP response.
    }
  }
  return true;
}

function resolveSavedPreviewSelection(
  workspaceRoot: string,
  pageId: string,
  nodeId: string,
): WebsitePreviewSelection | undefined {
  try {
    const config = new WebsiteWorkspaceManager(workspaceRoot).load();
    const screen = config.designGraph.screens.find(candidate => candidate.pageId === pageId);
    if (!screen || !screen.nodes.some(node => node.id === nodeId)) {
      return undefined;
    }
    return { pageId: screen.pageId, nodeId };
  } catch {
    return undefined;
  }
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

  // The overlay is added *after* generation rather than asked for in the prompt.
  // The model contributes only the inert `data-atlas-element` attributes; the
  // script, the styling and the policy come from constants here, which is what
  // lets the script be frozen and reviewable.
  await injectReviewOverlayIfEnabled(workspaceRoot, root, result.written);

  // Omissions are shown with the success, not instead of it. A partial result
  // reported as a whole one is the failure mode the plan's `omitted` list exists
  // to prevent.
  const message = result.omitted.length > 0 ? `${summary} ${result.omitted.join(' ')}` : summary;
  void vscode.window.showInformationMessage(message);

  await openWebsitePreview(atlas.extensionContext);
  WebsitePreviewPanel.currentPanel?.refresh();
}

/**
 * Add the client review overlay to the pages that were just generated.
 *
 * Reads the declared webhook once, here. With none configured the overlay is
 * export-only — the client downloads a file — and the generated page's policy
 * forbids it making any request at all. **No endpoint is ever invented**, so an
 * unset setting means export, never a fallback destination.
 */
async function injectReviewOverlayIfEnabled(
  workspaceRoot: string,
  root: string,
  writtenPaths: readonly string[],
): Promise<void> {
  const settings = vscode.workspace.getConfiguration('atlasmind');
  if (!settings.get<boolean>('website.review.includeOverlayInBuild', false)) {
    return;
  }

  const endpoint = sanitizeEndpoint(settings.get<string>('website.review.webhookUrl', ''));
  const config = new WebsiteWorkspaceManager(workspaceRoot).load();
  const reviewRound = new WebsiteReviewManager(workspaceRoot).load().currentRound;

  // The script is written once, as its own file, so the page's `script-src
  // 'self'` needs no `unsafe-inline`.
  await writeFile(path.join(root, REVIEW_OVERLAY_FILENAME), REVIEW_OVERLAY_SCRIPT, 'utf8');

  for (const relative of writtenPaths) {
    if (!relative.toLowerCase().endsWith('.html')) {
      continue;
    }
    const page = config.pages.find(candidate => pagePath(candidate) === relative);
    if (!page) {
      continue;
    }
    const absolute = path.join(root, relative);
    try {
      const html = await readFile(absolute, 'utf8');
      const overlay = buildReviewOverlay({
        page,
        round: reviewRound,
        ...(endpoint ? { endpoint } : {}),
      });
      await writeFile(absolute, injectReviewOverlay(html, overlay), 'utf8');
    } catch {
      // A page we cannot re-read keeps its generated form. Losing the overlay on
      // one page is better than losing the page.
    }
  }
}

/**
 * Re-render the wireframes on demand, for the Studio's "Preview wireframe"
 * action.
 *
 * Separate from opening the preview because the canvas changes far more often
 * than the generated site does: after moving three boxes you want to see the
 * drawing, not run a model.
 */
export async function refreshWireframePreview(context: vscode.ExtensionContext): Promise<void> {
  const preview = await ensureWebsitePreview(context);
  if (!preview) {
    return;
  }
  WebsitePreviewPanel.currentPanel?.refresh();
  await vscode.commands.executeCommand(
    'simpleBrowser.api.open',
    `${preview.url}${WIREFRAME_INDEX_PATH}`,
    { title: 'UI Studio Preview', viewColumn: vscode.ViewColumn.Beside },
  );
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
