import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import {
  assessWebsiteHostingEnvironments,
  importClientWebsiteIntake,
  sanitizeWebsiteWorkspace,
  WEBSITE_PLATFORM_CATALOG,
  WEBSITE_WORKSPACE_SSOT_PATH,
  WEBSITE_WORKSPACE_SUMMARY_SSOT_PATH,
  WebsiteWorkspaceManager,
} from '../core/websiteWorkspaceManager.js';
import {
  applyDesignGraphToPages,
  designGraphFromPages,
  resolveUiNodeLayout,
  resolveUiScreenLayout,
  UI_DESIGN_GRAPH_MAX_REVISION,
} from '../core/uiDesignGraph.js';
import {
  applyUiEditCommand,
  createUiEditSession,
  parseUiEditCommand,
  type UiEditSession,
} from '../core/uiEditCommands.js';
import type {
  UiDesignGraph,
  WebsiteAutomationStatus,
  WebsiteHostingEnvironment,
  WebsitePagePlan,
  WebsitePlatformStatus,
  WebsiteWorkspaceConfig,
  WebsiteWorkStatus,
  WireframeBreakpoint,
} from '../types.js';
import {
  buildSitemapTree,
  layoutSitemap,
  normalizeSlug,
  type SitemapLayout,
} from '../core/websiteSitemap.js';
import { buildLinkGraph } from '../core/websiteLinkGraph.js';
import { readDeliveryConfig } from '../core/deliveryManager.js';
import { WebsiteContentManager } from '../core/websiteContentManager.js';
import { parsePageContent, renderPageContent, type WebsitePageContent } from '../core/websiteContent.js';
import { compareWebsiteToDelivery } from '../core/websiteDeliverySync.js';
import { WIREFRAME_BREAKPOINTS, WIREFRAME_KIND_CATALOG } from '../core/websiteWireframe.js';
import {
  buildScopedDesignPrompt,
  type DesignPromptScope,
} from '../core/websiteDesignPrompt.js';
import {
  MAX_GENERATED_FILES,
  planWebsiteGeneration,
  WEBSITE_PREVIEW_ROOT,
  type WebsiteGenerationPlan,
  type WebsiteGenerationStage,
} from '../core/websiteGeneration.js';
import {
  buildCommandFor,
  describeStackCompatibility,
  devCommandFor,
  isWebsiteFrameworkId,
  renderCommandLine,
  WEBSITE_FRAMEWORK_CATALOG,
  websiteFrameworkSpec,
} from '../core/websiteFrameworks.js';
import { ATLAS_DISCUSS_ACTION_CSS, ATLAS_ICON_DATA_URI, escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import { WEBSITE_STUDIO_CSS } from './websiteStudioStyles.js';
import { onWebsitePreviewSelection, selectWebsitePreviewTarget } from './websitePreviewHost.js';

export type WebsiteStudioPage =
  | 'brief'
  | 'sitemap'
  | 'content'
  | 'wireframes'
  | 'ui-system'
  | 'preview'
  | 'stack'
  | 'automations';

const WEBSITE_STUDIO_PAGES = new Set<WebsiteStudioPage>([
  'brief',
  'sitemap',
  'content',
  'wireframes',
  'ui-system',
  'preview',
  'stack',
  'automations',
]);

/**
 * `platforms` was this page's id before it grew the framework half.
 *
 * Kept as an alias rather than removed: the id is a public deep-link target
 * (`atlasmind.openWebsiteStudio` takes one, and the Project Dashboard and
 * Ideation board both link in), and a renamed id would silently drop those
 * callers onto the Brief page with no indication why.
 */
const RENAMED_PAGES: Readonly<Record<string, WebsiteStudioPage>> = {
  platforms: 'stack',
};

export function isWebsiteStudioPage(value: unknown): value is WebsiteStudioPage {
  return typeof value === 'string' && WEBSITE_STUDIO_PAGES.has(value as WebsiteStudioPage);
}

/** Resolve a page id, following the rename alias. Unknown ids fall back to the brief. */
export function resolveWebsiteStudioPage(value: unknown): WebsiteStudioPage {
  if (isWebsiteStudioPage(value)) {
    return value;
  }
  return (typeof value === 'string' && RENAMED_PAGES[value]) || 'brief';
}

/** The scope a typed instruction applies to. Mirrors `DesignPromptScope`. */
const PROMPT_SCOPES = new Set(['site', 'page', 'element']);

/** Stages Generate can be pressed from. Mirrors `WebsiteGenerationStage`. */
const GENERATION_STAGES = new Set(['brief', 'sitemap', 'wireframe', 'element']);

const MAX_INSTRUCTION_LENGTH = 4_000;

export type WebsiteStudioMessage =
  | { type: 'ready' }
  | { type: 'saveConfig'; payload: unknown }
  | { type: 'savePageContent'; payload: { pageId: string; title: string; metaDescription: string; status: 'draft' | 'review' | 'approved'; body: string; expectedBody: string } }
  | { type: 'seedPageContent'; payload: { pageId: string } }
  | { type: 'importIntake'; payload: string }
  | { type: 'openSsot'; payload: 'json' | 'markdown' }
  | { type: 'openCommand'; payload: 'atlasmind.openProjectDashboard' | 'atlasmind.openProjectIdeation' | 'atlasmind.openChatPanel' }
  | { type: 'promptForTarget'; payload: { scope: DesignPromptScope; pageId?: string; elementId?: string; instruction: string } }
  | { type: 'generate'; payload: { stage: WebsiteGenerationStage; pageId?: string; elementId?: string } }
  | { type: 'openPreview' }
  | { type: 'openResponsivePreview' }
  | { type: 'refreshPreview' }
  | { type: 'stopPreview' }
  | { type: 'selectPreviewTarget'; payload: { pageId: string; nodeId: string } }
  | { type: 'editDesignGraph'; payload: unknown }
  | { type: 'selectFramework'; payload: { frameworkId: string } }
  | { type: 'planStackSetup' }
  | { type: 'compareDelivery' };

/**
 * Validate everything arriving from the webview.
 *
 * The two new message types are the ones that matter: `promptForTarget` reaches
 * a model and `generate` writes files. Both carry only *data* — a scope, some
 * ids, and the user's own sentence. Neither can name a command, a path, or a
 * file, so no webview message can widen what the panel is willing to do.
 */
export function isWebsiteStudioMessage(input: unknown): input is WebsiteStudioMessage {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const message = input as Record<string, unknown>;
  switch (message['type']) {
    case 'ready':
    case 'openPreview':
    case 'openResponsivePreview':
    case 'refreshPreview':
    case 'stopPreview':
    case 'planStackSetup':
    case 'compareDelivery':
      return true;
    case 'selectPreviewTarget': {
      const payload = asPayload(message['payload']);
      return payload !== undefined
        && Object.keys(payload).length === 2
        && isBoundedIdentifier(payload['pageId'])
        && isBoundedIdentifier(payload['nodeId']);
    }
    case 'editDesignGraph':
      return parseUiEditCommand(message['payload']) !== undefined;
    case 'selectFramework': {
      const payload = asPayload(message['payload']);
      // Checked against the catalog here, not merely for being a string: this
      // id chooses which constant command the setup planner will run.
      return payload !== undefined && isWebsiteFrameworkId(payload['frameworkId']);
    }
    case 'saveConfig':
      return typeof message['payload'] === 'object'
        && message['payload'] !== null
        && !Array.isArray(message['payload']);
    case 'savePageContent': {
      const payload = asPayload(message['payload']);
      return payload !== undefined
        && typeof payload['pageId'] === 'string'
        && payload['pageId'].length > 0
        && payload['pageId'].length <= 64
        && typeof payload['title'] === 'string'
        && payload['title'].length <= 500
        && typeof payload['metaDescription'] === 'string'
        && payload['metaDescription'].length <= 500
        && (payload['status'] === 'draft' || payload['status'] === 'review' || payload['status'] === 'approved')
        && typeof payload['body'] === 'string'
        && payload['body'].length <= 200_000
        && typeof payload['expectedBody'] === 'string'
        && payload['expectedBody'].length <= 200_000;
    }
    case 'seedPageContent': {
      const payload = asPayload(message['payload']);
      return payload !== undefined
        && typeof payload['pageId'] === 'string'
        && payload['pageId'].length > 0
        && payload['pageId'].length <= 64;
    }
    case 'importIntake':
      return typeof message['payload'] === 'string' && message['payload'].length <= 128_000;
    case 'openSsot':
      return message['payload'] === 'json' || message['payload'] === 'markdown';
    case 'openCommand':
      return message['payload'] === 'atlasmind.openProjectDashboard'
        || message['payload'] === 'atlasmind.openProjectIdeation'
        || message['payload'] === 'atlasmind.openChatPanel';
    case 'promptForTarget': {
      const payload = asPayload(message['payload']);
      return payload !== undefined
        && typeof payload['scope'] === 'string'
        && PROMPT_SCOPES.has(payload['scope'])
        && typeof payload['instruction'] === 'string'
        && payload['instruction'].trim().length > 0
        && payload['instruction'].length <= MAX_INSTRUCTION_LENGTH
        && isOptionalId(payload['pageId'])
        && isOptionalId(payload['elementId']);
    }
    case 'generate': {
      const payload = asPayload(message['payload']);
      return payload !== undefined
        && typeof payload['stage'] === 'string'
        && GENERATION_STAGES.has(payload['stage'])
        && isOptionalId(payload['pageId'])
        && isOptionalId(payload['elementId']);
    }
    default:
      return false;
  }
}

function asPayload(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Ids are matched against the workspace before use, so this only has to reject
 * the shapes that could cause trouble on the way there — anything non-string, or
 * long enough to be a payload rather than an identifier.
 */
function isOptionalId(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 64);
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(value);
}

export class WebsiteStudioPanel {
  public static currentPanel: WebsiteStudioPanel | undefined;
  public static readonly viewType = 'atlasmind.websiteStudio';

  public static createOrShow(
    context: vscode.ExtensionContext,
    targetPage: WebsiteStudioPage = 'brief',
  ): void {
    const safeTargetPage = resolveWebsiteStudioPage(targetPage);
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (WebsiteStudioPanel.currentPanel) {
      WebsiteStudioPanel.currentPanel.panel.reveal(column);
      WebsiteStudioPanel.currentPanel.render(safeTargetPage);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      WebsiteStudioPanel.viewType,
      'AtlasMind UI Studio',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    );
    WebsiteStudioPanel.currentPanel = new WebsiteStudioPanel(panel, safeTargetPage, context);
  }

  private readonly manager: WebsiteWorkspaceManager;
  private readonly contentManager: WebsiteContentManager;
  private config: WebsiteWorkspaceConfig;
  private editSession: UiEditSession;
  private activePage: WebsiteStudioPage;
  /** Set when the file on disk was written by a newer AtlasMind. Saving is refused. */
  private readOnly = false;
  /** Result of the last Delivery comparison. Absent means *not compared*, which the page says. */
  private deliveryDriftSummary: string | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    targetPage: WebsiteStudioPage,
    private readonly context: vscode.ExtensionContext,
  ) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.manager = new WebsiteWorkspaceManager(workspaceRoot);
    this.contentManager = new WebsiteContentManager(
      workspaceRoot,
      vscode.workspace.getConfiguration('atlasmind').get<string>('website.content.directory'),
    );
    const read = this.manager.read();
    this.config = read.config;
    this.editSession = createUiEditSession(this.config.designGraph);
    this.readOnly = read.preserveExisting;
    this.activePage = targetPage;
    this.render(targetPage);

    const previewSelectionSubscription = onWebsitePreviewSelection(selection => {
      if (WebsiteStudioPanel.currentPanel !== this) {
        return;
      }
      void this.panel.webview.postMessage({
        type: 'previewSelection',
        pageId: selection.pageId,
        nodeId: selection.nodeId,
      });
    });

    if (read.notice) {
      // Surfaced rather than logged. A migrated file and a refused one are both
      // things the user needs to know before they start editing.
      void this.panel.webview.postMessage({
        type: 'notice',
        tone: read.preserveExisting ? 'error' : 'success',
        message: read.notice,
      });
    }

    this.panel.onDidDispose(() => {
      previewSelectionSubscription.dispose();
      WebsiteStudioPanel.currentPanel = undefined;
      // The preview server is owned by the preview panel, but a Studio that is
      // gone should not leave one running on its behalf.
      void vscode.commands.executeCommand('atlasmind.stopWebsitePreview');
    });
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    });
  }

  private render(targetPage: WebsiteStudioPage = this.activePage): void {
    this.activePage = targetPage;
    this.panel.webview.html = getWebsiteStudioHtml(
      this.panel.webview,
      this.config,
      targetPage,
      {
        readOnly: this.readOnly,
        canGenerate: isGenerationEnabled(),
        canSetUpStack: isStackSetupEnabled(),
        pageContent: [...this.contentManager.read(this.config.pages).values()],
        contentDirectory: this.contentManager.contentDirectory,
        ...(this.deliveryDriftSummary ? { deliveryDriftSummary: this.deliveryDriftSummary } : {}),
        scriptContent: this.readScript(),
      },
    );
  }

  /**
   * Read the canvas script off disk, matching `projectDashboardPanel`.
   *
   * Inlining avoids the webview resource bootstrap being unavailable in some
   * hosts; the `scriptUri` fallback in `getWebsiteStudioHtml` covers the case
   * where the read fails.
   */
  private readScript(): string | undefined {
    try {
      return readFileSync(
        vscode.Uri.joinPath(this.context.extensionUri, 'media', 'websiteStudio.js').fsPath,
        'utf8',
      );
    } catch {
      return undefined;
    }
  }

  private async postDesignGraphState(
    type: 'designGraphUpdated' | 'designEditRefused',
    reason?: string,
  ): Promise<void> {
    await this.panel.webview.postMessage({
      type,
      revision: this.editSession.graph.revision,
      ...(reason ? { reason } : {}),
      pages: this.config.pages.map(page => ({ id: page.id, wireframe: page.wireframe ?? null })),
      responsiveScreens: buildWebsiteStudioResponsiveScreens(this.editSession.graph),
    });
  }

  private async handleMessage(input: unknown): Promise<void> {
    if (!isWebsiteStudioMessage(input)) {
      void this.panel.webview.postMessage({ type: 'notice', tone: 'error', message: 'UI Studio ignored an invalid message.' });
      return;
    }

    try {
      switch (input.type) {
        case 'ready':
          return;
        case 'saveConfig': {
          const payload = sanitizeWebsiteWorkspace(input.payload);
          const rawPayload = input.payload as Record<string, unknown>;
          const expectedDesignRevision = rawPayload['designRevision'];
          const usesEditSession = Number.isSafeInteger(expectedDesignRevision);
          const suppliedGraph = typeof input.payload === 'object'
            && input.payload !== null
            && !Array.isArray(input.payload)
            && 'designGraph' in input.payload;
          if (usesEditSession && expectedDesignRevision !== this.editSession.graph.revision) {
            throw new Error('The canvas changed while this save was being prepared. Reload UI Studio and review the latest design.');
          }
          if (!usesEditSession && !suppliedGraph && this.config.designGraph.revision >= UI_DESIGN_GRAPH_MAX_REVISION) {
            throw new Error('The UI design revision limit has been reached. Save was refused so an older browser event cannot become current again.');
          }
          // Current Studio builds name the revision of the host-owned edit
          // session. The fallback preserves pre-v0.277 webviews that still
          // submit one compatibility-wireframe batch after an extension reload.
          const compatiblePayload = usesEditSession
            ? { ...payload, designGraph: this.editSession.graph }
            : suppliedGraph ? payload
            : {
                ...payload,
                designGraph: designGraphFromPages(
                  payload.pages,
                  this.config.designGraph.revision + 1,
                ),
              };
          this.config = await this.manager.save(compatiblePayload);
          this.editSession = {
            ...this.editSession,
            graph: this.config.designGraph,
          };
          await this.refreshPreviewIfRunning();
          // Re-render on the page the user is already on. Saving used to update
          // `this.config` and post a success notice without re-rendering, so
          // everything derived server-side — counts, status chips, derived
          // indicators — stayed on screen showing the values from before the
          // save. `importIntake` directly below always did re-render; this did
          // not, and the inconsistency is what made the staleness hard to spot.
          this.render(this.activePage);
          await this.panel.webview.postMessage({
            type: 'notice',
            tone: 'success',
            message: `UI plan saved to ${WEBSITE_WORKSPACE_SSOT_PATH}.`,
          });
          return;
        }
        case 'editDesignGraph': {
          if (this.readOnly) {
            throw new Error('This UI plan was written by a newer AtlasMind and cannot be edited here.');
          }
          const command = parseUiEditCommand(input.payload);
          if (!command) {
            throw new Error('UI Studio ignored an invalid design edit.');
          }
          const result = applyUiEditCommand(this.editSession, command);
          if (!result.ok) {
            await this.postDesignGraphState('designEditRefused', result.reason);
            return;
          }
          this.editSession = result.session;
          this.config = {
            ...this.config,
            designGraph: result.session.graph,
            pages: applyDesignGraphToPages(this.config.pages, result.session.graph),
          };
          await this.postDesignGraphState('designGraphUpdated');
          return;
        }
        case 'savePageContent': {
          const page = this.config.pages.find(candidate => candidate.id === input.payload.pageId);
          if (!page) {
            throw new Error('The selected screen is no longer part of this UI plan. Reload the Studio.');
          }
          const existing = this.contentManager.read([page]).get(page.id);
          const proposed: WebsitePageContent = {
            pageId: page.id,
            filePath: existing?.filePath ?? '',
            title: input.payload.title,
            metaDescription: input.payload.metaDescription,
            status: input.payload.status,
            body: input.payload.body,
            placeholders: [],
            missing: false,
            extraFrontMatter: existing?.extraFrontMatter ?? {},
          };
          // Normalize through the same parser used for disk content so control
          // characters, field bounds, placeholder discovery, and front-matter
          // semantics cannot differ between the webview and the next read.
          const normalized = parsePageContent(
            page,
            renderPageContent(proposed),
            this.contentManager.contentDirectory,
          );
          const result = await this.contentManager.save(page, normalized, input.payload.expectedBody);
          if (!result.ok) {
            throw new Error(result.reason);
          }
          await this.refreshPreviewIfRunning();
          this.render('content');
          await this.panel.webview.postMessage({ type: 'notice', tone: 'success', message: 'Screen content saved to its Markdown source file.' });
          return;
        }
        case 'seedPageContent': {
          const page = this.config.pages.find(candidate => candidate.id === input.payload.pageId);
          if (!page) {
            throw new Error('The selected screen is no longer part of this UI plan. Reload the Studio.');
          }
          const result = await this.contentManager.seed(page);
          if (result === 'no-workspace') {
            throw new Error('Open a workspace folder before creating content.');
          }
          await this.refreshPreviewIfRunning();
          this.render('content');
          await this.panel.webview.postMessage({
            type: 'notice',
            tone: result === 'written' ? 'success' : 'error',
            message: result === 'written' ? 'Created a placeholder-only content file.' : 'The content file already exists and was left unchanged.',
          });
          return;
        }
        case 'importIntake':
          this.config = importClientWebsiteIntake(this.config, input.payload);
          this.config = await this.manager.save(this.config);
          this.editSession = createUiEditSession(this.config.designGraph);
          this.render('brief');
          void vscode.window.showInformationMessage('Client intake imported and normalized into UI Studio.');
          return;
        case 'openSsot': {
          const relativePath = input.payload === 'json'
            ? WEBSITE_WORKSPACE_SSOT_PATH
            : WEBSITE_WORKSPACE_SUMMARY_SSOT_PATH;
          const workspace = vscode.workspace.workspaceFolders?.[0];
          if (!workspace) {
            throw new Error('Open a workspace folder first.');
          }
          if (!this.manager.exists()) {
            this.config = await this.manager.save(this.config);
            this.editSession = createUiEditSession(this.config.designGraph);
          }
          await vscode.window.showTextDocument(vscode.Uri.joinPath(workspace.uri, ...relativePath.split('/')));
          return;
        }
        case 'openCommand':
          if (input.payload === 'atlasmind.openChatPanel') {
            await vscode.commands.executeCommand(input.payload, {
              draftPrompt: 'Help me turn the current UI Studio brief, screen map, content design, wireframes, UI system, implementation guide, and any website delivery choices into the next safe implementation milestone. Ground the plan in project_memory/domain/website.json and the configured content directory, preserve platform and credential safety boundaries, and propose the smallest reviewable build step for the selected interface profile.',
            });
          } else {
            await vscode.commands.executeCommand(input.payload);
          }
          return;
        case 'promptForTarget':
          await this.handlePromptForTarget(input.payload);
          return;
        case 'generate':
          await this.handleGenerate(input.payload);
          return;
        case 'openPreview':
          await vscode.commands.executeCommand('atlasmind.openWebsitePreview');
          return;
        case 'openResponsivePreview': {
          const { openResponsiveWebsitePreview } = await import('./websitePreviewHost.js');
          await openResponsiveWebsitePreview(this.context);
          return;
        }
        case 'refreshPreview':
          await vscode.commands.executeCommand('atlasmind.previewWebsiteWireframe');
          return;
        case 'stopPreview':
          await vscode.commands.executeCommand('atlasmind.stopWebsitePreview');
          return;
        case 'selectPreviewTarget':
          selectWebsitePreviewTarget(input.payload.pageId, input.payload.nodeId);
          return;
        case 'selectFramework':
          await this.handleSelectFramework(input.payload.frameworkId);
          return;
        case 'planStackSetup':
          await vscode.commands.executeCommand('atlasmind.setUpWebsiteStack', { config: this.config });
          return;
        case 'compareDelivery':
          await this.handleCompareDelivery();
          return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void this.panel.webview.postMessage({ type: 'notice', tone: 'error', message: detail });
      void vscode.window.showErrorMessage(`UI Studio: ${detail}`);
    }
  }

  /**
   * Hand a selection-scoped instruction to the chat.
   *
   * The prompt is composed by `buildScopedDesignPrompt`, which owns the fencing,
   * and then handed over through the same `openChatPanel` bridge every other
   * panel uses. Nothing is written here — this is a question, and the prompt
   * itself says the answer is a proposal.
   */
  private async handlePromptForTarget(
    payload: { scope: DesignPromptScope; pageId?: string; elementId?: string; instruction: string },
  ): Promise<void> {
    const composed = buildScopedDesignPrompt({
      scope: payload.scope,
      config: this.config,
      ...(payload.pageId ? { pageId: payload.pageId } : {}),
      ...(payload.elementId ? { elementId: payload.elementId } : {}),
      instruction: payload.instruction,
    });

    if (!composed) {
      // Almost always a stale selection: the element was deleted, or the page
      // was removed in another window. Saying so beats sending a prompt about
      // nothing and getting a confident answer back.
      await this.panel.webview.postMessage({
        type: 'notice',
        tone: 'error',
        message: 'That selection is no longer on the canvas. Select it again and retry.',
      });
      return;
    }

    await vscode.commands.executeCommand('atlasmind.openChatPanel', {
      draftPrompt: composed.prompt,
      sendMode: 'new-session',
    });
    await this.panel.webview.postMessage({
      type: 'notice',
      tone: 'success',
      message: `Asked Atlas about ${composed.targetLabel}.`,
    });
  }

  /**
   * Plan a generation, confirm it, and hand it to the generate command.
   *
   * The confirmation is the point of the whole design: it names every file that
   * will be written and the folder they go to, and it can do that because
   * `planWebsiteGeneration` is deterministic. A plan a model had composed would
   * differ on every press and the dialog would be unreadable.
   */
  private async handleGenerate(
    payload: { stage: WebsiteGenerationStage; pageId?: string; elementId?: string },
  ): Promise<void> {
    if (!isGenerationEnabled()) {
      await this.panel.webview.postMessage({
        type: 'notice',
        tone: 'error',
        message: 'Website generation is off. Turn on atlasmind.website.generation.enabled to use Generate.',
      });
      return;
    }

    // Real copy is read here and handed in, so `websiteGeneration` stays pure.
    // A page with no content file is not an error: the prompt tells the model to
    // mark every piece of copy on it as a placeholder, which is the honest
    // outcome rather than a degraded one.
    const settings = vscode.workspace.getConfiguration('atlasmind');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const content = workspaceRoot
      ? new WebsiteContentManager(workspaceRoot, settings.get<string>('website.content.directory'))
        .read(this.config.pages)
      : undefined;

    const planned = planWebsiteGeneration({
      config: this.config,
      stage: payload.stage,
      ...(payload.pageId ? { pageId: payload.pageId } : {}),
      ...(payload.elementId ? { elementId: payload.elementId } : {}),
      maxFiles: generationFileLimit(),
      ...(content ? { content } : {}),
      ...(settings.get<boolean>('website.review.includeOverlayInBuild', false) ? { reviewMode: true } : {}),
    });

    if (!planned.ok) {
      await this.panel.webview.postMessage({ type: 'notice', tone: 'error', message: planned.reason });
      return;
    }

    const confirmed = await confirmGeneration(planned.plan);
    if (!confirmed) {
      await this.panel.webview.postMessage({ type: 'notice', tone: '', message: 'Generation cancelled. Nothing was written.' });
      return;
    }

    // Execution lives in the command so the same path serves the palette, and
    // so the panel is not the thing running a model and writing files.
    await vscode.commands.executeCommand('atlasmind.generateWebsite', {
      plan: planned.plan,
      config: this.config,
    });
  }

  private async handleSelectFramework(frameworkId: string): Promise<void> {
    if (this.readOnly) {
      await this.panel.webview.postMessage({
        type: 'notice',
        tone: 'error',
        message: 'This project\'s website.json was written by a newer AtlasMind, so it is read-only.',
      });
      return;
    }
    this.config = await persistFrameworkChoice(this.manager, this.config, frameworkId);
    this.editSession = createUiEditSession(this.config.designGraph);
    this.render('stack');
    const spec = websiteFrameworkSpec(frameworkId as Parameters<typeof websiteFrameworkSpec>[0]);
    await this.panel.webview.postMessage({
      type: 'notice',
      tone: 'success',
      message: `${spec.label} recorded. Nothing has been installed — use "Set up this stack" when you are ready.`,
    });
  }

  /**
   * Compare with the Delivery pipeline.
   *
   * Comparing only. Website Studio and Delivery each hold their own copy of the
   * three stages, and this is the surface that makes the disagreement visible;
   * changing Delivery is a separate, confirmed action from its own page.
   */
  private async handleCompareDelivery(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const delivery = workspaceRoot ? readDeliveryConfig(workspaceRoot) : undefined;
    const report = compareWebsiteToDelivery(this.config.hostingEnvironments, delivery, this.config.platforms);

    this.deliveryDriftSummary = delivery
      ? report.summary
      : 'No Delivery pipeline is configured for this project yet, so there is nothing to compare against.';
    this.render('stack');

    await this.panel.webview.postMessage({
      type: 'notice',
      tone: report.inStep ? 'success' : '',
      message: this.deliveryDriftSummary,
    });
  }

  private async refreshPreviewIfRunning(): Promise<void> {
    const { refreshRunningWebsitePreview } = await import('./websitePreviewHost.js');
    await refreshRunningWebsitePreview();
  }
}

/**
 * Record the framework choice.
 *
 * Saved immediately rather than held until the next Save: the choice drives what
 * the setup planner would do, and a plan built from an unsaved selection would
 * describe a stack the file does not record.
 */
async function persistFrameworkChoice(
  manager: WebsiteWorkspaceManager,
  config: WebsiteWorkspaceConfig,
  frameworkId: string,
): Promise<WebsiteWorkspaceConfig> {
  const primaryPlatform = config.platforms.find(platform => platform.primary);
  return manager.save({
    ...config,
    stack: {
      frameworkId,
      platformId: config.stack?.platformId ?? primaryPlatform?.id ?? 'cloudflare-pages',
      packageManager: config.stack?.packageManager
        ?? vscode.workspace.getConfiguration('atlasmind').get<string>('website.setup.packageManager', 'npm'),
      decidedAt: new Date().toISOString(),
    },
  });
}

/**
 * The modal.
 *
 * `{modal:true}` because this writes files. It lists every path rather than a
 * count — "write 7 files" is not something anybody can meaningfully agree to —
 * and it repeats what the stage could not account for, so the omissions are read
 * before the work rather than discovered after it.
 */
async function confirmGeneration(plan: WebsiteGenerationPlan): Promise<boolean> {
  const fileList = plan.files.map(file => `  ${WEBSITE_PREVIEW_ROOT}/${file.relativePath} — ${file.purpose}`).join('\n');
  const omissions = plan.omitted.length > 0
    ? `\n\nWorth knowing:\n${plan.omitted.map(item => `  • ${item}`).join('\n')}`
    : '';
  const answer = await vscode.window.showWarningMessage(
    `Generate ${plan.targetLabel}?`,
    {
      modal: true,
      detail: `Atlas will write ${plan.files.length} file${plan.files.length === 1 ? '' : 's'} into ${WEBSITE_PREVIEW_ROOT}/.\n\n`
        + `${fileList}\n\nExisting files at these paths are replaced. Nothing outside ${WEBSITE_PREVIEW_ROOT}/ is touched.${omissions}`,
    },
    'Generate',
  );
  return answer === 'Generate';
}

/** Deny by default: generating files and opening a port are separate decisions from using the Studio. */
export function isGenerationEnabled(): boolean {
  return vscode.workspace.getConfiguration('atlasmind').get<boolean>('website.generation.enabled', false);
}

/** Separate again from generation: scaffolding runs commands, which generation never does. */
export function isStackSetupEnabled(): boolean {
  return vscode.workspace.getConfiguration('atlasmind').get<boolean>('website.setup.enabled', false);
}

function generationFileLimit(): number {
  const configured = vscode.workspace
    .getConfiguration('atlasmind')
    .get<number>('website.generation.maxFiles', 40);
  return Math.min(MAX_GENERATED_FILES, Math.max(1, Math.floor(configured)));
}

export interface WebsiteStudioHtmlOptions {
  /** The file on disk was written by a newer AtlasMind; editing is disabled. */
  readOnly?: boolean;
  /** `atlasmind.website.generation.enabled`. Controls whether Generate is offered at all. */
  canGenerate?: boolean;
  /** `atlasmind.website.setup.enabled`. Controls whether stack setup is offered. */
  canSetUpStack?: boolean;
  /**
   * Last drift comparison against the Delivery pipeline, if one has been run.
   * Absent means *not compared*, which the page states rather than showing a
   * reassuring blank — the two models can disagree and nobody has looked.
   */
  deliveryDriftSummary?: string;
  /** Screen copy read from the configured Markdown content directory. */
  pageContent?: readonly WebsitePageContent[];
  contentDirectory?: string;
  /** The canvas script, read from `media/websiteStudio.js`. */
  scriptContent?: string;
  /** Fallback when the script could not be read inline. */
  scriptUri?: string;
}

export interface WebsiteStudioResponsiveNodeState {
  id: string;
  locked: boolean;
  views: Record<WireframeBreakpoint, ReturnType<typeof resolveUiNodeLayout>>;
  overrides: Record<WireframeBreakpoint, { rect: boolean; hidden: boolean; layout: boolean }>;
}

export interface WebsiteStudioResponsiveScreenState {
  id: string;
  pageId: string;
  baseBreakpoint: WireframeBreakpoint;
  nodes: WebsiteStudioResponsiveNodeState[];
}

/** Host-resolved responsive state; the webview never reimplements inheritance. */
export function buildWebsiteStudioResponsiveScreens(
  graph: UiDesignGraph,
): WebsiteStudioResponsiveScreenState[] {
  return graph.screens.map(screen => {
    const resolved = Object.fromEntries(WIREFRAME_BREAKPOINTS.map(breakpoint => [
      breakpoint,
      new Map(resolveUiScreenLayout(screen, breakpoint).map(node => [node.id, node])),
    ])) as Record<WireframeBreakpoint, Map<string, ReturnType<typeof resolveUiScreenLayout>[number]>>;
    return ({
    id: screen.id,
    pageId: screen.pageId,
    baseBreakpoint: screen.baseBreakpoint,
    nodes: screen.nodes.map(node => ({
      id: node.id,
      locked: node.locked,
      views: Object.fromEntries(WIREFRAME_BREAKPOINTS.map(breakpoint => [
        breakpoint,
        resolved[breakpoint].get(node.id) ?? resolveUiNodeLayout(screen, node, breakpoint),
      ])) as WebsiteStudioResponsiveNodeState['views'],
      overrides: Object.fromEntries(WIREFRAME_BREAKPOINTS.map(breakpoint => [
        breakpoint,
        {
          rect: node.viewportOverrides[breakpoint]?.rect !== undefined,
          hidden: node.viewportOverrides[breakpoint]?.hidden !== undefined,
          layout: node.viewportOverrides[breakpoint]?.mode !== undefined
            || node.viewportOverrides[breakpoint]?.widthMode !== undefined
            || node.viewportOverrides[breakpoint]?.heightMode !== undefined
            || node.viewportOverrides[breakpoint]?.direction !== undefined
            || node.viewportOverrides[breakpoint]?.gap !== undefined
            || node.viewportOverrides[breakpoint]?.padding !== undefined
            || node.viewportOverrides[breakpoint]?.columns !== undefined
            || node.viewportOverrides[breakpoint]?.align !== undefined
            || node.viewportOverrides[breakpoint]?.distribute !== undefined
            || node.viewportOverrides[breakpoint]?.minWidth !== undefined
            || node.viewportOverrides[breakpoint]?.maxWidth !== undefined
            || node.viewportOverrides[breakpoint]?.minHeight !== undefined
            || node.viewportOverrides[breakpoint]?.maxHeight !== undefined
            || node.viewportOverrides[breakpoint]?.wrap !== undefined
            || node.viewportOverrides[breakpoint]?.order !== undefined,
        },
      ])) as WebsiteStudioResponsiveNodeState['overrides'],
    })),
    });
  });
}

export function getWebsiteStudioHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage = 'brief',
  options: WebsiteStudioHtmlOptions = {},
): string {
  const approvedPages = config.pages.filter(page =>
    page.wireframeStatus === 'approved' && page.designStatus === 'approved').length;
  const readyAutomations = config.automations.filter(automation => automation.status === 'verified').length;
  const primaryPlatform = config.platforms.find(platform => platform.primary);
  const hostingReadiness = assessWebsiteHostingEnvironments(config);
  const readyHostingEnvironments = hostingReadiness.filter(readiness => readiness.status === 'ready').length;
  const isWebsite = config.surfaceKind === 'website';
  const screenNoun = isWebsite ? 'page' : 'screen';
  const contentReady = (options.pageContent ?? []).filter(content => !content.missing && content.body.trim().length > 0).length;

  // The canvas needs the geometry model client-side, and the pages need to be
  // readable by the script without re-parsing the DOM. Passed as an escaped
  // data attribute rather than a <script> block so nothing executable is
  // introduced and the CSP stays as it is.
  const canvasState = JSON.stringify({
    surfaceKind: config.surfaceKind,
    designRevision: config.designGraph.revision,
    pages: config.pages,
    responsiveScreens: buildWebsiteStudioResponsiveScreens(config.designGraph),
    kinds: WIREFRAME_KIND_CATALOG,
    canGenerate: options.canGenerate === true,
    readOnly: options.readOnly === true,
    atlasIcon: ATLAS_ICON_DATA_URI,
  });

  return getWebviewHtmlShell({
    dashboardSkin: true,
    title: 'AtlasMind UI Studio',
    cspSource: webview.cspSource,
    bodyContent: `
      <div id="websiteStudioState" hidden data-state="${escapeHtml(canvasState)}"></div>
      <header class="studio-hero">
        <div>
          <p class="eyebrow">AtlasMind · Interface design workspace</p>
          <h1>UI Studio</h1>
          <p class="hero-copy">Design the structure, content, visual system, and implementation handoff for websites, apps, extensions, desktop tools, and other interfaces. Website projects keep their guarded delivery workflow.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="secondary" data-command="atlasmind.openProjectIdeation">Ideation board</button>
          <button type="button" class="secondary" data-command="atlasmind.openProjectDashboard">Project dashboard</button>
          <button type="button" class="atlas-discuss-action icon-only" data-command="atlasmind.openChatPanel" title="Ask AtlasMind to plan the next safe UI milestone" aria-label="Ask AtlasMind to plan the next UI milestone"><img src="${ATLAS_ICON_DATA_URI}" alt="" aria-hidden="true" /><span class="atlas-discuss-label">Ask AtlasMind to plan the next UI milestone</span></button>
        </div>
      </header>
      ${options.readOnly ? `
      <div class="callout warning" role="alert">
        <strong>Read-only.</strong>
        This project's <code>${escapeHtml(WEBSITE_WORKSPACE_SSOT_PATH)}</code> was written by a newer version of AtlasMind.
        You can read it, but saving is disabled — writing now would overwrite settings this build cannot understand.
      </div>` : ''}

      <div class="metric-strip" aria-label="UI readiness summary">
        ${metricCard(isWebsite ? 'Pages' : 'Screens', String(config.pages.length), isWebsite ? 'in the sitemap' : 'in the interface map')}
        ${metricCard('Design ready', `${approvedPages}/${config.pages.length}`, 'wireframe + UI approved')}
        ${metricCard('Content ready', `${contentReady}/${config.pages.length}`, `Markdown ${screenNoun} files`)}
        ${isWebsite
          ? `${metricCard('Hosting ready', `${readyHostingEnvironments}/3`, 'Develop · Staging · Production')}
             ${metricCard('Primary platform', primaryPlatform?.label ?? 'Not chosen', primaryPlatform?.status ?? 'decision needed')}
             ${metricCard('n8n verified', `${readyAutomations}/${config.automations.length}`, 'mapped workflows')}`
          : metricCard('Profile', surfaceKindLabel(config.surfaceKind), 'implementation-independent')}
      </div>

      <div id="studioNotice" class="notice" role="status" aria-live="polite"></div>

      <div class="studio-layout">
        <nav class="studio-nav" aria-label="UI Studio dashboards">
          ${navButton('brief', '1', 'Project brief', activePage)}
          ${navButton('sitemap', '2', isWebsite ? 'Sitemap' : 'Screens & flows', activePage)}
          ${/* The nav renders literal numbered steps, so it promises a linear
                workflow. Content design now sits before the visual system, and
                the shared UI system still precedes the pages that apply it.
                Each wireframe card tracks a per-page "UI design" stage, and
                that cannot be done consistently until the shared typography,
                colour and component decisions exist. */ ''}
          ${navButton('content', '3', 'Content design', activePage)}
          ${navButton('ui-system', '4', 'UI system', activePage)}
          ${navButton('wireframes', '5', 'Wireframes & UI', activePage)}
          ${navButton('preview', '6', 'Full preview', activePage)}
          ${navButton('stack', '7', isWebsite ? 'Implementation & hosting' : 'Implementation', activePage)}
          ${isWebsite ? navButton('automations', '8', 'n8n automations', activePage) : ''}
          <div class="nav-footer">
            <button type="button" class="secondary full" data-open-ssot="json">Open website.json</button>
            <button type="button" class="secondary full" data-open-ssot="markdown">Open website.md</button>
          </div>
        </nav>

        <main>
          ${renderBriefPage(config, activePage, options)}
          ${renderSitemapPage(config, activePage, options)}
          ${renderContentPage(config, activePage, options)}
          ${renderWireframesPage(config, activePage, options)}
          ${renderUiSystemPage(config, activePage)}
          ${renderPreviewPage(config, activePage, options)}
          ${renderStackPage(config, activePage, options)}
          ${renderAutomationsPage(config, activePage)}
        </main>
      </div>

      <footer class="save-bar">
        <div>
          <strong>Reviewable SSOT</strong>
          <span>Changes are sanitized and mirrored to JSON + Markdown. Credentials and n8n webhook values are never stored here.</span>
        </div>
        <span id="unsavedBadge" class="unsaved-badge" hidden>Unsaved changes</span>
        <button type="button" class="secondary" id="openPreview">Open full preview</button>
        <button type="button" id="saveWebsiteStudio"${options.readOnly ? ' disabled' : ''}>Save UI Studio</button>
      </footer>
    `,
    extraCss: `${WEBSITE_STUDIO_CSS}${ATLAS_DISCUSS_ACTION_CSS}`,
    ...(options.scriptContent
      ? { scriptContent: options.scriptContent }
      : options.scriptUri
        ? { scriptUri: options.scriptUri }
        : {}),
  });
}

function renderBriefPage(
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage,
  options: WebsiteStudioHtmlOptions,
): string {
  const intake = config.intake;
  const isWebsite = config.surfaceKind === 'website';
  return `
    <section class="studio-page${activePage === 'brief' ? ' active' : ''}" data-page="brief">
      ${pageIntro('Project brief', 'Normalize the product or client request before design or implementation decisions start. Blank fields remain explicit gaps.')}
      <article class="panel-card profile-card">
        <div>
          <p class="eyebrow">Interface profile</p>
          <h2>What are you designing?</h2>
          <p>The profile changes the Studio's language and reveals website-only delivery tools. It never dictates the implementation technology.</p>
        </div>
        <label class="field">
          <span>Surface type</span>
          <select id="surfaceKind">
            ${UI_SURFACE_OPTIONS.map(([value, label]) => `<option value="${value}"${config.surfaceKind === value ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      </article>
      <article class="panel-card prompt-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Describe it in words</p>
            <h2>Whole-${isWebsite ? 'site' : 'interface'} design prompt</h2>
            <p>One sentence about how the ${isWebsite ? 'site' : 'interface'} should look and feel. Every ${isWebsite ? 'page' : 'screen'} prompt is read against this.</p>
          </div>
          ${generateButton('brief', 'Generate a concept', options)}
        </div>
        <textarea id="siteDesignPrompt" rows="3" placeholder="Calm, editorial, lots of white space. Photography-led, no stock illustration.">${escapeHtml(config.designPrompt)}</textarea>
        <div class="inspector-actions">
          <button type="button" id="askAboutSite" class="atlas-discuss-action icon-only" title="Ask AtlasMind to review the whole-site design prompt" aria-label="Ask AtlasMind about the whole site"><img src="${ATLAS_ICON_DATA_URI}" alt="" aria-hidden="true" /><span class="atlas-discuss-label">Ask AtlasMind about the whole site</span></button>
        </div>
      </article>
      <div class="two-column">
        <article class="panel-card">
          <h2>Client and outcome</h2>
          ${field('Client / organisation', 'intake-clientName', intake.clientName)}
          ${field(isWebsite ? 'Project / website name' : 'Project / product name', 'intake-projectName', intake.projectName)}
          ${textarea('Summary', 'intake-summary', intake.summary, `What the ${isWebsite ? 'site' : 'interface'} is, who it serves, and the change it should create.`)}
          ${listTextarea('Goals', 'intake-goals', intake.goals, 'One goal per line')}
          ${listTextarea('Primary audiences', 'intake-audiences', intake.audiences, 'One audience or persona per line')}
          ${listTextarea('Success metrics', 'intake-successMetrics', intake.successMetrics, 'One measurable signal per line')}
        </article>
        <article class="panel-card">
          <h2>Scope and delivery constraints</h2>
          ${listTextarea('Required features', 'intake-requiredFeatures', intake.requiredFeatures, 'Forms, booking, search, commerce…')}
          ${listTextarea('Content and asset sources', 'intake-contentSources', intake.contentSources, 'Existing site, shared drive, photo library…')}
          ${textarea('Brand notes', 'intake-brandNotes', intake.brandNotes, 'Existing identity, mood, references, and non-negotiables.')}
          ${listTextarea('Constraints', 'intake-constraints', intake.constraints, 'Legal, technical, accessibility, timing…')}
          ${listTextarea('Stakeholders and approvers', 'intake-stakeholders', intake.stakeholders, 'One person or role per line')}
          <div class="field-pair">
            ${field('Target launch', 'intake-targetLaunch', intake.targetLaunch ?? '')}
            ${field('Budget', 'intake-budget', intake.budget ?? '')}
          </div>
        </article>
      </div>
      <article class="panel-card import-card">
        <div>
          <p class="eyebrow">Bring an existing brief</p>
          <h2>Import client intake JSON</h2>
          <p>Paste JSON from a form, CRM export, or n8n normalization step. Common aliases such as <code>companyName</code>, <code>objectives</code>, <code>targetAudience</code>, and <code>kpis</code> are mapped automatically.</p>
        </div>
        <textarea id="clientIntakeJson" rows="9" placeholder='{"companyName":"Northstar","objectives":["Generate qualified leads"],"targetAudience":["Operations leaders"]}'></textarea>
        <button type="button" id="importClientIntake">Import and normalize</button>
      </article>
    </section>
  `;
}

function renderSitemapPage(
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage,
  options: WebsiteStudioHtmlOptions,
): string {
  const isWebsite = config.surfaceKind === 'website';
  const itemLabel = isWebsite ? 'page' : 'screen';
  const tree = buildSitemapTree(config.pages);
  const layout = layoutSitemap(tree);
  const graph = buildLinkGraph(config.pages);
  const titles = new Map(config.pages.map(page => [page.id, page.title]));
  const findings = [...tree.findings.map(finding => finding.message), ...graph.findings.map(finding => finding.message)];

  return `
    <section class="studio-page${activePage === 'sitemap' ? ' active' : ''}" data-page="sitemap">
      ${pageIntro(isWebsite ? 'Sitemap dashboard' : 'Screens and flows', isWebsite
        ? 'The hierarchy draws itself from the slugs as pages are added. Give a page a design prompt and it can be generated without ever being drawn.'
        : 'Use routes or stable view identifiers to map the interface. Parent relationships show hierarchy; declared links describe navigation and task flow without assuming a web implementation.')}

      <article class="panel-card">
        <div class="card-heading">
          <div>
            <h2>Hierarchy map</h2>
            <p>${isWebsite ? "Built from each page's slug." : 'Built from each screen route or view id.'} Set a parent explicitly to override it. Click a ${itemLabel} to open it on the canvas.</p>
          </div>
          ${generateButton('sitemap', 'Generate all pages', options)}
        </div>
        ${renderSitemapSvg(layout)}
        <p class="map-legend">
          <span class="legend-swatch solid"></span> parent set explicitly
          <span class="legend-swatch dashed"></span> derived from the slug
          <span class="legend-swatch orphan"></span> no parent found
        </p>
      </article>

      ${findings.length > 0 ? `
      <article class="panel-card findings-card">
        <h2>Navigation findings</h2>
        <ul>${findings.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul>
      </article>` : ''}

      <article class="panel-card">
        <div class="card-heading">
          <div><h2>${isWebsite ? 'Page' : 'Screen'} inventory</h2><p>${config.pages.length} planned ${itemLabel}${config.pages.length === 1 ? '' : 's'}</p></div>
          <button type="button" id="addWebsitePage"${options.readOnly ? ' disabled' : ''}>Add ${itemLabel}</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>${isWebsite ? 'Page' : 'Screen'}</th><th>${isWebsite ? 'Slug' : 'Route / view id'}</th><th>Purpose</th><th>Template</th><th>Links to</th><th></th></tr></thead>
            <tbody id="sitemapRows">
              ${config.pages.map(page => renderSitemapRow(page, graph, titles)).join('')}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

/**
 * The hierarchy as an SVG.
 *
 * Coordinates come from `layoutSitemap`, so the same pages always draw the same
 * map. Every node is a real `<a>`-like button element rather than an SVG shape
 * with a click handler, so the map is reachable by keyboard and readable by a
 * screen reader — an image of a site structure that only a mouse can use would
 * be a step backwards from the table it replaces.
 */
function renderSitemapSvg(layout: SitemapLayout): string {
  if (layout.nodes.length === 0) {
    return '<p class="map-empty">No pages yet. Add one below and the map will draw itself.</p>';
  }

  const positions = new Map(layout.nodes.map(node => [node.pageId, node]));
  const edges = layout.edges.map(edge => {
    const from = positions.get(edge.fromPageId);
    const to = positions.get(edge.toPageId);
    if (!from || !to) {
      return '';
    }
    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height;
    const x2 = to.x + to.width / 2;
    const y2 = to.y;
    const midY = (y1 + y2) / 2;
    // An elbow rather than a straight line: with several children the straight
    // lines cross each other and the shape stops being readable.
    const path = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    return `<path d="${path}" class="map-edge${edge.source === 'slug' ? ' derived' : ''}" />`;
  }).join('');

  const nodes = layout.nodes.map(node => `
    <foreignObject x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}">
      <button type="button" xmlns="http://www.w3.org/1999/xhtml"
        class="map-node${node.parentSource === 'orphaned' ? ' orphan' : ''}"
        data-sitemap-page="${escapeHtml(node.pageId)}"
        aria-label="${escapeHtml(`${node.title}, ${node.slug}, level ${node.depth + 1}`)}">
        <span class="map-node-title">${escapeHtml(node.title)}</span>
        <span class="map-node-slug">${escapeHtml(node.slug)}</span>
      </button>
    </foreignObject>`).join('');

  return `
    <div class="map-scroll">
      <svg viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"
        role="group" aria-label="Site hierarchy">
        <g>${edges}</g>
        ${nodes}
      </svg>
    </div>`;
}

function renderContentPage(
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage,
  options: WebsiteStudioHtmlOptions,
): string {
  const byPageId = new Map((options.pageContent ?? []).map(content => [content.pageId, content]));
  const screenNoun = config.surfaceKind === 'website' ? 'page' : 'screen';
  const content = config.contentDesign;
  return `
    <section class="studio-page${activePage === 'content' ? ' active' : ''}" data-page="content">
      ${pageIntro('Content design', `Design the words as part of the interface: voice, terminology, accessibility, states, and the actual copy for each ${screenNoun}. Markdown files remain the source of truth.`)}

      <div class="two-column">
        <article class="panel-card">
          <h2>Voice and comprehension</h2>
          ${textarea('Product voice', 'content-voice', content.voice, 'Direct, calm, specific; explain consequences before asking for commitment.')}
          ${listTextarea('Content principles', 'content-principles', content.principles, 'One rule per line')}
          ${field('Reading level / comprehension target', 'content-readingLevel', content.readingLevel, 'Plain English; specialist terms explained')}
          ${listTextarea('Locales and language variants', 'content-locales', content.locales, 'en-GB\nfr-FR')}
          ${textarea('Content accessibility notes', 'content-accessibilityNotes', content.accessibilityNotes, 'Labels, alternatives, error recovery, cognitive load, screen-reader phrasing…')}
        </article>
        <article class="panel-card">
          <h2>Terminology</h2>
          <p>Keep product language consistent across design, code, documentation, and support.</p>
          ${listTextarea('Preferred terms', 'content-preferredTerms', content.preferredTerms, 'Use “workspace”, not “tenant”')}
          ${listTextarea('Avoided terms', 'content-avoidedTerms', content.avoidedTerms, 'Jargon, ambiguous labels, exclusionary language…')}
          <div class="callout">
            <strong>States are content too.</strong>
            Use each ${screenNoun}'s Markdown file to specify headings, labels, instructions, empty states, validation, errors, success messages, and recovery actions alongside the main copy.
          </div>
        </article>
      </div>

      <article class="panel-card">
        <div class="card-heading">
          <div>
            <h2>${config.surfaceKind === 'website' ? 'Page' : 'Screen'} content files</h2>
            <p>Stored under <code>${escapeHtml(options.contentDirectory ?? 'content')}</code>. A save is refused if the file changed on disk after this view loaded.</p>
          </div>
        </div>
        <div class="content-screen-grid">
          ${config.pages.map(page => renderPageContentEditor(page, byPageId.get(page.id), options.readOnly === true, config.surfaceKind === 'website')).join('')}
        </div>
      </article>
    </section>
  `;
}

function renderPageContentEditor(
  page: WebsitePagePlan,
  content: WebsitePageContent | undefined,
  readOnly: boolean,
  isWebsite: boolean,
): string {
  if (!content || content.missing) {
    return `
      <article class="content-screen-card" data-content-page-id="${escapeHtml(page.id)}">
        <div class="card-heading">
          <div><h3>${escapeHtml(page.title)}</h3><p>${escapeHtml(content?.filePath ?? page.slug)}</p></div>
          <span class="status-chip status-not-started">Missing</span>
        </div>
        <p>No content file exists yet. Create a placeholder-only outline from the current wireframe; the Studio will not invent plausible copy.</p>
        <button type="button" class="seed-page-content"${readOnly ? ' disabled' : ''}>Create content outline</button>
      </article>`;
  }

  return `
    <article class="content-screen-card" data-content-page-id="${escapeHtml(page.id)}">
      <div class="card-heading">
        <div><h3>${escapeHtml(page.title)}</h3><p><code>${escapeHtml(content.filePath)}</code></p></div>
        <span class="status-chip status-${escapeHtml(content.status)}">${escapeHtml(content.status)}</span>
      </div>
      <div class="field-pair">
        ${field('Content title', '', content.title, '', 'content-title')}
        ${selectField('Status', 'content-status', [['draft', 'Draft'], ['review', 'In review'], ['approved', 'Approved']], content.status)}
      </div>
      ${textarea(isWebsite ? 'Meta description' : 'Summary / metadata', '', content.metaDescription, isWebsite ? 'Search-result description' : 'Optional implementation-facing summary', 'content-metaDescription')}
      ${textarea('Interface copy (Markdown)', '', content.body, 'Headings, labels, help, empty/loading/error/success states, and recovery actions.', 'content-body', 16)}
      <textarea class="content-expectedBody" hidden>${escapeHtml(content.body)}</textarea>
      <div class="content-editor-footer">
        <span>${content.placeholders.length} unresolved placeholder${content.placeholders.length === 1 ? '' : 's'}</span>
        <button type="button" class="save-page-content"${readOnly ? ' disabled' : ''}>Save content file</button>
      </div>
    </article>`;
}

function renderWireframesPage(
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage,
  options: WebsiteStudioHtmlOptions,
): string {
  const first = config.pages[0];
  const firstScreen = first
    ? config.designGraph.screens.find(screen => screen.pageId === first.id)
    : undefined;
  const firstBreakpoint = firstScreen?.baseBreakpoint ?? first?.wireframe?.breakpoint ?? 'desktop';
  return `
    <section class="studio-page${activePage === 'wireframes' ? ' active' : ''}" data-page="wireframes">
      ${pageIntro('Wireframe canvas', 'Draw the page. Pick a block, drag on the grid, drop one inside another to nest it. Select anything and describe it in your own words.')}

      ${config.pages.length === 0 ? '<article class="panel-card"><p>Add a page on the Sitemap tab first.</p></article>' : `
      <div class="canvas-toolbar">
        <label class="field inline">
          <span>Page</span>
          <select id="wireframePageSelect">
            ${config.pages.map(page => `<option value="${escapeHtml(page.id)}">${escapeHtml(page.title)}</option>`).join('')}
          </select>
        </label>
        <div class="breakpoint-picker" role="group" aria-label="Canvas breakpoint">
          ${WIREFRAME_BREAKPOINTS.map(breakpoint => `
            <button type="button" class="breakpoint-button${breakpoint === firstBreakpoint ? ' active' : ''}"
              data-breakpoint="${breakpoint}" aria-pressed="${breakpoint === firstBreakpoint ? 'true' : 'false'}">
              ${breakpoint[0]!.toUpperCase()}${breakpoint.slice(1)}
            </button>`).join('')}
        </div>
        <p id="breakpointContext" class="breakpoint-context"></p>
        <p id="canvasSummary" class="canvas-summary" role="status" aria-live="polite"></p>
        ${generateButton('wireframe', 'Generate this page', options)}
      </div>

      <div class="canvas-layout">
        <aside class="canvas-palette" aria-label="Wireframe blocks">
          <p class="eyebrow">Blocks</p>
          ${WIREFRAME_KIND_CATALOG.map(spec => `
            <button type="button" class="palette-button${spec.kind === 'section' ? ' armed' : ''}"
              data-kind="${escapeHtml(spec.kind)}" data-description="${escapeHtml(spec.description)}"
              title="${escapeHtml(spec.description)}">
              ${escapeHtml(spec.label)}
            </button>`).join('')}
        </aside>

        <div class="canvas-frame">
          <div id="wireframeCanvas" class="wf-canvas" tabindex="0"
            role="application"
            aria-label="Wireframe canvas. Drag to draw a block. Arrow keys move the selected block.">
          </div>
        </div>

        <aside class="canvas-inspector">
          <div id="wireframeInspector"></div>
          <div class="page-prompt-block">
            <p class="eyebrow">Whole page</p>
            <h3 id="wireframePageTitle">${escapeHtml(first?.title ?? '')}</h3>
            <label class="field">
              <span>Page design prompt</span>
              <textarea id="pageDesignPrompt" rows="4"
                placeholder="A services page that leads with outcomes, three service cards, then a short enquiry form."></textarea>
            </label>
            <div class="inspector-actions">
              <button type="button" id="askAboutPage" class="atlas-discuss-action icon-only" title="Ask AtlasMind to review this page's wireframe and design prompt" aria-label="Ask AtlasMind about this page"><img src="${ATLAS_ICON_DATA_URI}" alt="" aria-hidden="true" /><span class="atlas-discuss-label">Ask AtlasMind about this page</span></button>
            </div>
          </div>
        </aside>
      </div>`}

      <div id="wireframeCards" class="wireframe-grid">
        ${config.pages.map(page => renderWireframeCard(page, config.surfaceKind === 'website')).join('')}
      </div>
    </section>
  `;
}

/**
 * A Generate button, or an explanation of why there is not one.
 *
 * The setting is off by default, and a button that silently does nothing is
 * worse than an absent one — so when generation is disabled the affordance is
 * replaced by the reason, naming the setting to change.
 */
function generateButton(
  stage: WebsiteGenerationStage,
  label: string,
  options: WebsiteStudioHtmlOptions,
): string {
  if (!options.canGenerate) {
    return `<span class="generate-off" title="atlasmind.website.generation.enabled">Generation is off</span>`;
  }
  return `<button type="button" class="generate-button" data-generate-stage="${escapeHtml(stage)}">${escapeHtml(label)}</button>`;
}

function renderUiSystemPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  const design = config.designSystem;
  return `
    <section class="studio-page${activePage === 'ui-system' ? ' active' : ''}" data-page="ui-system">
      ${pageIntro('UI system dashboard', 'Capture the shared design decisions every page then applies — typography, colour, spacing and components — so the per-page UI design stage has a consistent, accessible client design.')}
      <div class="two-column">
        <article class="panel-card">
          <h2>Direction and typography</h2>
          ${textarea('Brand direction', 'design-brandDirection', design.brandDirection, 'Visual principles, references, and what to avoid.')}
          ${textarea('Tone', 'design-tone', design.tone, 'How the interface should feel and speak.')}
          ${field('Heading font', 'design-headingFont', design.headingFont)}
          ${field('Body font', 'design-bodyFont', design.bodyFont)}
          ${field('Accessibility target', 'design-accessibilityTarget', design.accessibilityTarget)}
        </article>
        <article class="panel-card">
          <h2>Tokens and components</h2>
          <div class="color-grid">
            ${colorField('Primary', 'design-primaryColor', design.primaryColor)}
            ${colorField('Secondary', 'design-secondaryColor', design.secondaryColor)}
            ${colorField('Accent', 'design-accentColor', design.accentColor)}
          </div>
          ${field('Spacing scale', 'design-spacingScale', design.spacingScale)}
          ${field('Corner style', 'design-cornerStyle', design.cornerStyle)}
          ${listTextarea('Component notes', 'design-componentNotes', design.componentNotes, 'Navigation, buttons, cards, forms…')}
          <div class="token-preview">
            <span data-token-swatch="design-primaryColor" style="background:${escapeHtml(design.primaryColor)}"></span>
            <span data-token-swatch="design-secondaryColor" style="background:${escapeHtml(design.secondaryColor)}"></span>
            <span data-token-swatch="design-accentColor" style="background:${escapeHtml(design.accentColor)}"></span>
            <strong>Shared UI decisions</strong>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderPreviewPage(
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage,
  options: WebsiteStudioHtmlOptions,
): string {
  const contents = new Map((options.pageContent ?? []).map(content => [content.pageId, content]));
  const drawn = config.pages.filter(page => (page.wireframe?.elements.length ?? 0) > 0).length;
  const contentReady = config.pages.filter(page => {
    const content = contents.get(page.id);
    return content !== undefined && !content.missing && content.body.trim().length > 0;
  }).length;
  const screenNoun = config.surfaceKind === 'website' ? 'page' : 'screen';

  return `
    <section class="studio-page${activePage === 'preview' ? ' active' : ''}" data-page="preview">
      ${pageIntro('Full preview', 'Use the built-in browser as the main review canvas. The preview is rebuilt directly from the saved wireframes, visual tokens, and exact Markdown copy, so design decisions can be judged together without a model call.')}

      <article class="panel-card preview-launch-card">
        <div>
          <p class="eyebrow">Canonical review surface</p>
          <h2>Open the complete design in VS Code</h2>
          <p>The full preview opens in VS Code's built-in browser at normal browser scale. Its index keeps every ${screenNoun} one click away and links separately to any model-generated visual guide.</p>
          <p class="preview-freshness"><strong>Saved inputs:</strong> ${drawn}/${config.pages.length} drawn · ${contentReady}/${config.pages.length} with content · UI system applied globally</p>
        </div>
        <div class="preview-primary-actions">
          <button type="button" id="refreshFullPreview">Rebuild and open full preview</button>
          <button type="button" class="secondary" id="openFullPreview">Open full preview</button>
        </div>
      </article>

      <div class="two-column">
        <article class="panel-card">
          <p class="eyebrow">Responsive inspection</p>
          <h2>Device-width lab</h2>
          <p>Open the guarded companion view when you need fixed desktop, tablet, and mobile widths. It uses the same preview URL as the built-in browser, so there is only one version of the design to review.</p>
          <button type="button" class="secondary" id="openResponsivePreview">Open responsive lab</button>
        </article>
        <article class="panel-card">
          <p class="eyebrow">What the preview proves</p>
          <h2>Structure + content + style</h2>
          <ul class="preview-proof-list">
            <li>Canvas geometry and hierarchy from each wireframe</li>
            <li>Primary, secondary, and accent colours plus heading/body typography</li>
            <li>Exact Markdown copy with unresolved placeholders made conspicuous</li>
            <li>A full content proof below each visual canvas so clipped copy cannot hide</li>
          </ul>
        </article>
      </div>

      <article class="panel-card">
        <div class="card-heading">
          <div><h2>Preview coverage</h2><p>Missing work stays visible; the preview never fills gaps with plausible copy.</p></div>
          <button type="button" class="secondary" id="stopPreview">Stop preview server</button>
        </div>
        <div class="preview-coverage-grid">
          ${config.pages.length === 0 ? '<p>No screens yet. Add one in Screens & flows.</p>' : config.pages.map(page => {
            const content = contents.get(page.id);
            const elements = page.wireframe?.elements.length ?? 0;
            const copy = !content || content.missing
              ? 'content missing'
              : content.placeholders.length > 0
                ? `${content.placeholders.length} content gap${content.placeholders.length === 1 ? '' : 's'}`
                : `${content.status} content`;
            return `<div class="preview-coverage-item"><strong>${escapeHtml(page.title)}</strong><span>${elements === 0 ? 'not drawn' : `${elements} element${elements === 1 ? '' : 's'}`} · ${escapeHtml(copy)}</span></div>`;
          }).join('')}
        </div>
      </article>
    </section>
  `;
}

/**
 * Framework choice, with the compatibility verdict against the chosen platform.
 *
 * Incompatible pairings stay in the list and carry their reason. Hiding them
 * would leave somebody looking for Hugo and wondering where it went; saying
 * "Shopify serves Liquid templates from its own theme system" answers the
 * question they actually had.
 */
function renderFrameworkCard(
  config: WebsiteWorkspaceConfig,
  options: WebsiteStudioHtmlOptions,
): string {
  const primaryPlatform = config.platforms.find(platform => platform.primary);
  const platformId = config.stack?.platformId ?? primaryPlatform?.id ?? 'cloudflare-pages';
  const chosenFramework = config.stack?.frameworkId;

  const cards = WEBSITE_FRAMEWORK_CATALOG.map(spec => {
    const verdict = describeStackCompatibility(spec.id, platformId);
    const selected = spec.id === chosenFramework;
    return `
      <button type="button"
        class="framework-card${selected ? ' selected' : ''} compat-${escapeHtml(verdict.compatibility)}"
        data-framework="${escapeHtml(spec.id)}"
        aria-pressed="${selected ? 'true' : 'false'}"
        ${options.readOnly ? 'disabled' : ''}>
        <span class="framework-name">${escapeHtml(spec.label)}</span>
        <span class="framework-badge">${escapeHtml(verdict.compatibility)}</span>
        <span class="framework-desc">${escapeHtml(spec.description)}</span>
        <span class="framework-reason">${escapeHtml(verdict.reason)}</span>
        <span class="framework-meta">
          ${spec.scaffold ? 'Scaffolds automatically' : 'No automatic setup'} ·
          builds to <code>${escapeHtml(spec.outputDir)}</code>
        </span>
      </button>`;
  }).join('');

  const setupAvailable = options.canSetUpStack === true;

  return `
    <article class="panel-card">
      <div class="card-heading">
        <div>
          <p class="eyebrow">Built with</p>
          <h2>Framework</h2>
          <p>Graded against ${escapeHtml(primaryPlatform?.label ?? 'the selected platform')}. Choosing one does nothing on its own — setup is a separate, confirmed step.</p>
        </div>
        ${setupAvailable
          ? `<button type="button" id="planStackSetup"${chosenFramework ? '' : ' disabled'}>Set up this stack</button>`
          : `<span class="generate-off" title="atlasmind.website.setup.enabled">Automatic setup is off</span>`}
      </div>
      <div class="framework-grid">${cards}</div>
      ${chosenFramework ? renderStackSummary(config) : ''}
    </article>
    <article class="panel-card">
      <div class="card-heading">
        <div>
          <p class="eyebrow">Cross-check</p>
          <h2>Delivery pipeline</h2>
          <p>These three environments are Website Studio's own. The Delivery page has its own stages with the backup, approval and rollback policy that promotions actually use.</p>
        </div>
        <button type="button" id="syncToDelivery"${options.readOnly ? ' disabled' : ''}>Compare with Delivery</button>
      </div>
      <div id="deliveryDrift" class="drift-readout" role="status" aria-live="polite">
        ${options.deliveryDriftSummary
          ? `<p>${escapeHtml(options.deliveryDriftSummary)}</p>`
          : '<p class="drift-unknown">Not compared yet. Website Studio and Delivery each hold their own copy of these stages, so they can drift apart between syncs.</p>'}
      </div>
    </article>
  `;
}

/** What the chosen stack implies, so the consequences are visible before setup runs. */
function renderStackSummary(config: WebsiteWorkspaceConfig): string {
  if (!config.stack) {
    return '';
  }
  const spec = websiteFrameworkSpec(config.stack.frameworkId as Parameters<typeof websiteFrameworkSpec>[0]);
  const manager = (config.stack.packageManager || 'npm') as Parameters<typeof buildCommandFor>[1];
  const dev = devCommandFor(spec, manager);
  const build = buildCommandFor(spec, manager);
  return `
    <div class="stack-summary">
      <p class="eyebrow">What this means</p>
      <dl>
        <dt>Dev server</dt><dd>${dev ? `<code>${escapeHtml(renderCommandLine(dev.command, dev.args))}</code>` : 'No dev server — the files are served as they are.'}</dd>
        <dt>Build</dt><dd>${build ? `<code>${escapeHtml(renderCommandLine(build.command, build.args))}</code>` : 'No build step.'}</dd>
        <dt>Output</dt><dd><code>${escapeHtml(spec.outputDir)}</code></dd>
      </dl>
    </div>`;
}

function renderStackPage(
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage,
  options: WebsiteStudioHtmlOptions,
): string {
  const readiness = new Map(assessWebsiteHostingEnvironments(config).map(item => [item.id, item]));
  const guide = renderImplementationGuide(config);
  if (config.surfaceKind !== 'website') {
    return `
      <section class="studio-page${activePage === 'stack' ? ' active' : ''}" data-page="stack">
        ${pageIntro('Implementation handoff', 'Keep the visual guide connected to the real project without assuming HTML. Record the technologies and source locations an agent or developer should inspect before continuing the interface.')}
        ${guide}
        <div class="callout">
          <strong>Design intent, not code generation.</strong>
          UI Studio records what to build and where the existing implementation lives. The normal project tools still review and edit SwiftUI, React Native, XAML, VS Code webviews, game-engine UI, or any other target through their own guarded workflow.
        </div>
      </section>`;
  }
  return `
    <section class="studio-page${activePage === 'stack' ? ' active' : ''}" data-page="stack">
      ${pageIntro('Stack, hosting and setup', 'Pick what the site is built with and where it ships, then let AtlasMind scaffold it. Framework and platform are one decision — the pairing determines the build command, the output directory and the deploy config.')}
      ${guide}
      ${renderFrameworkCard(config, options)}
      <div class="hosting-heading">
        <div>
          <p class="eyebrow">Environment pipeline</p>
          <h2>Three deliberate hosting stages</h2>
          <p>Develop stays local by default. Staging is a password-protected client-review subdomain. Production is public and protected from unguarded promotion.</p>
        </div>
      </div>
      <div class="environment-flow">
        ${config.hostingEnvironments.map((environment, index) => `
          ${index > 0 ? '<div class="environment-arrow" aria-hidden="true">→</div>' : ''}
          ${renderHostingEnvironmentCard(environment, readiness.get(environment.id))}
        `).join('')}
      </div>
      <div class="callout">
        <strong>Password references only.</strong>
        Use a reference such as <code>SecretStorage:website.staging.password</code> or <code>env:WEBSITE_STAGING_PASSWORD</code>. UI Studio rejects raw password values and never writes them to project memory.
      </div>
      <div class="callout warning">
        <strong>No one-click production deploys here.</strong>
        UI Studio records the platform and non-secret references. Use the Project Dashboard delivery pipeline for preflight, approval, backup, publish, and verification.
      </div>
      <div class="hosting-heading platform-heading">
        <div>
          <p class="eyebrow">Publishing technology</p>
          <h2>Platform targets</h2>
          <p>Select the primary delivery platform and keep account, project, and environment references credential-free.</p>
        </div>
      </div>
      <div class="platform-grid">
        ${config.platforms.map(platform => {
          const catalog = WEBSITE_PLATFORM_CATALOG.find(item => item.id === platform.id);
          return `
            <article class="platform-card" data-platform-id="${escapeHtml(platform.id)}">
              <div class="platform-topline">
                <div>
                  <p class="eyebrow">${escapeHtml(catalog?.mode ?? 'custom')}</p>
                  <h2>${escapeHtml(platform.label)}</h2>
                </div>
                <label class="primary-choice"><input type="radio" name="primaryPlatform" value="${escapeHtml(platform.id)}"${platform.primary ? ' checked' : ''} /> Primary</label>
              </div>
              <p>${escapeHtml(catalog?.description ?? '')}</p>
              ${selectField('Readiness', 'platform-status', PLATFORM_STATUS_OPTIONS, platform.status)}
              ${field('Public site URL', '', platform.siteUrl ?? '', 'https://example.com', 'platform-siteUrl')}
              ${field('Project / site reference', '', platform.projectReference ?? '', 'Account/project label — never a credential', 'platform-projectReference')}
              ${field('Environment reference', '', platform.environmentReference ?? '', 'e.g. production, branch name, hosting project', 'platform-environmentReference')}
              ${textarea('Notes', '', platform.notes, 'Migration, content editing, plugin, DNS, or ownership notes.', 'platform-notes')}
            </article>
          `;
        }).join('')}
      </div>
      <button type="button" class="secondary" data-command="atlasmind.openProjectDashboard">Open guarded Delivery dashboard</button>
    </section>
  `;
}

function renderImplementationGuide(config: WebsiteWorkspaceConfig): string {
  const guide = config.implementation;
  return `
    <article class="panel-card implementation-guide">
      <div class="card-heading">
        <div>
          <p class="eyebrow">Design → project</p>
          <h2>Implementation guide</h2>
          <p>These are bounded workspace-relative hints for collaborators and agents, never commands and never proof that a path exists.</p>
        </div>
      </div>
      <div class="two-column">
        <div>
          ${listTextarea('Target technologies', 'implementation-targetTechnologies', guide.targetTechnologies, 'React Native\nSwiftUI\nVS Code webview')}
          ${listTextarea('UI source roots', 'implementation-sourceRoots', guide.sourceRoots, 'src/ui\napp/screens')}
        </div>
        <div>
          ${listTextarea('Component locations', 'implementation-componentLocations', guide.componentLocations, 'src/components\nDesignSystem/Components')}
          ${listTextarea('Handoff notes', 'implementation-notes', guide.notes, 'One constraint, mapping, or continuation note per line')}
        </div>
      </div>
    </article>`;
}

function renderHostingEnvironmentCard(
  environment: WebsiteHostingEnvironment,
  readiness: ReturnType<typeof assessWebsiteHostingEnvironments>[number] | undefined,
): string {
  const readinessStatus = readiness?.status ?? 'blocked';
  const readinessLabel = readinessStatus === 'needs-setup' ? 'Needs setup' : readinessStatus === 'ready' ? 'Ready' : 'Blocked';
  const urlPlaceholder = environment.id === 'develop'
    ? 'http://localhost:3000/'
    : environment.id === 'staging'
      ? `https://${environment.subdomainLabel ?? 'staging'}.example.com/`
      : 'https://www.example.com/';
  const modeControl = environment.id === 'develop'
    ? selectField('Hosting mode', 'environment-hostingMode', DEVELOP_HOSTING_MODE_OPTIONS, environment.hostingMode)
    : `<div class="locked-field"><span>Hosting mode</span><strong>Hosted</strong></div>`;
  const credentialControl = environment.id !== 'production'
    ? field(
        environment.id === 'develop' ? 'Password reference (hosted fallback)' : 'Password reference',
        '',
        environment.credentialReference ?? '',
        environment.id === 'develop'
          ? 'SecretStorage:website.develop.password'
          : 'SecretStorage:website.staging.password',
        'environment-credentialReference',
      )
    : '';
  const subdomainControl = environment.id === 'staging'
    ? field('Review subdomain label', '', environment.subdomainLabel ?? 'staging', 'staging', 'environment-subdomainLabel')
    : '';

  return `
    <article class="environment-card environment-${escapeHtml(environment.id)}" data-environment-id="${escapeHtml(environment.id)}" data-hosting-mode="${escapeHtml(environment.hostingMode)}">
      <div class="environment-topline">
        <div>
          <p class="eyebrow">0${environment.id === 'develop' ? '1' : environment.id === 'staging' ? '2' : '3'} · ${escapeHtml(environment.accessPolicy)}</p>
          <h3>${escapeHtml(environment.name)}</h3>
        </div>
        <span class="readiness-pill ${escapeHtml(readinessStatus)}">${escapeHtml(readinessLabel)}</span>
      </div>
      <p class="environment-purpose">${escapeHtml(environment.purpose)}</p>
      ${modeControl}
      <div class="locked-field environment-accessPolicy"><span>Access policy</span><strong>${escapeHtml(environment.accessPolicy)}</strong></div>
      ${field('Environment URL', '', environment.url ?? '', urlPlaceholder, 'environment-url')}
      ${subdomainControl}
      ${field('Branch / project reference', '', environment.branchReference ?? '', environment.id, 'environment-branchReference')}
      ${credentialControl}
      ${textarea('Environment notes', '', environment.notes, 'DNS, review, QA, ownership, or promotion notes.', 'environment-notes')}
      ${environment.promotionProtected ? '<div class="guard-badge">Production promotion protected</div>' : ''}
      ${readiness?.issues.length
        ? `<ul class="readiness-issues">${readiness.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`
        : '<p class="readiness-clear">Environment policy is ready.</p>'}
    </article>
  `;
}

function renderAutomationsPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  return `
    <section class="studio-page${activePage === 'automations' ? ' active' : ''}" data-page="automations">
      ${pageIntro('n8n automation dashboard', 'Map forms, content, CRM, notifications, analytics, and publishing workflows without copying credential or webhook values into project memory.')}
      <div class="callout">
        <strong>Reference secrets; never paste them.</strong>
        Use labels such as <code>env:N8N_CONTACT_WEBHOOK_URL</code> or <code>SecretStorage:n8n.contact</code>. URLs containing credentials, queries, or fragments are rejected.
      </div>
      <div class="card-heading">
        <div><h2>Workflow map</h2><p>Triggering is intentionally separate from planning and verification.</p></div>
        <button type="button" id="addWebsiteAutomation">Add automation</button>
      </div>
      <div id="automationCards" class="automation-grid">
        ${config.automations.length > 0
          ? config.automations.map(renderAutomationCard).join('')
          : '<div class="empty-state" id="automationEmpty"><strong>No workflows mapped yet.</strong><span>Start with a contact form, lead routing, content approval, or launch-monitoring workflow.</span></div>'}
      </div>
    </section>
  `;
}

function renderSitemapRow(
  page: WebsitePagePlan,
  graph: ReturnType<typeof buildLinkGraph>,
  titles: ReadonlyMap<string, string>,
): string {
  const summary = graph.byPageId.get(page.id);
  const destinations = (summary?.outbound ?? []).map(resolved => {
    if (resolved.dangling) {
      // Kept, and marked. A link whose target was deleted is the evidence that
      // a nav is broken; hiding it would hide the finding.
      return '<span class="link-chip broken" title="This page no longer exists">missing page</span>';
    }
    const label = resolved.targetPageId
      ? titles.get(resolved.targetPageId) ?? resolved.targetPageId
      : resolved.externalUrl ?? '';
    return `<span class="link-chip${resolved.externalUrl ? ' external' : ''}">${escapeHtml(label)}</span>`;
  }).join('');

  const inbound = summary?.inboundPageIds.length ?? 0;

  return `
    <tr data-page-id="${escapeHtml(page.id)}">
      <td>
        <input class="page-title" aria-label="Page title" value="${escapeHtml(page.title)}" />
        <input type="hidden" class="page-order" value="${page.order}" />
        <small class="inbound-count">${inbound === 0 ? 'nothing links here' : `${inbound} inbound`}</small>
      </td>
      <td><input class="page-slug" aria-label="Page slug" value="${escapeHtml(page.slug)}" /></td>
      <td><textarea class="page-purpose" aria-label="Page purpose" rows="2">${escapeHtml(page.purpose)}</textarea></td>
      <td><input class="page-template" aria-label="Page template" value="${escapeHtml(page.template)}" /></td>
      <td class="links-cell">${destinations || '—'}</td>
      <td><button type="button" class="danger subtle remove-page" data-remove-id="${escapeHtml(page.id)}">Remove</button></td>
    </tr>
  `;
}

/**
 * The per-page review card that sits below the canvas.
 *
 * The old fake wireframe — the first eight `sections` strings on a three-class
 * CSS grid — is gone rather than kept alongside the canvas. Two pictures of the
 * same page that disagree is worse than one, and the derived structure list
 * below states what the canvas holds without pretending to draw it.
 */
function renderWireframeCard(page: WebsitePagePlan, isWebsite = true): string {
  const elements = page.wireframe?.elements ?? [];
  const structure = elements.length > 0
    ? `<ul class="structure-list">${elements
        .filter(element => !element.parentId)
        .map(element => `<li>${escapeHtml(element.label)} <small>${escapeHtml(element.kind)}</small></li>`)
        .join('')}</ul>`
    : '<p class="structure-empty">Not drawn yet. Select this page above and drag on the canvas.</p>';

  return `
    <article class="wireframe-card" data-page-id="${escapeHtml(page.id)}" data-wireframe-card="${escapeHtml(page.id)}">
      <div class="wireframe-topline">
        <div><p class="eyebrow">${escapeHtml(normalizeSlug(page.slug))}</p><h2>${escapeHtml(page.title)}</h2></div>
        <span class="status-pill">${escapeHtml(page.designStatus)}</span>
      </div>
      <p class="element-count">${elements.length} element${elements.length === 1 ? '' : 's'} drawn</p>
      ${structure}
      ${textarea('Wireframe notes', '', page.wireframeNotes, 'Hierarchy, responsive behavior, interactions, and review feedback.', 'page-wireframeNotes')}
      ${textarea('Visual design notes', '', page.designNotes, 'Client feedback, imagery, component variants, and high-fidelity decisions.', 'page-designNotes')}
      <div class="status-grid">
        ${selectField('Wireframe', 'page-wireframeStatus', WORK_STATUS_OPTIONS, page.wireframeStatus)}
        ${selectField('UI design', 'page-designStatus', WORK_STATUS_OPTIONS, page.designStatus)}
        ${selectField('Content', 'page-contentStatus', WORK_STATUS_OPTIONS, page.contentStatus)}
        ${isWebsite ? selectField('SEO', 'page-seoStatus', WORK_STATUS_OPTIONS, page.seoStatus) : ''}
      </div>
    </article>
  `;
}

function renderAutomationCard(automation: WebsiteWorkspaceConfig['automations'][number]): string {
  return `
    <article class="automation-card" data-automation-id="${escapeHtml(automation.id)}">
      <div class="card-heading">
        <p class="eyebrow">n8n workflow</p>
        <button type="button" class="danger subtle remove-automation" data-remove-automation="${escapeHtml(automation.id)}">Remove</button>
      </div>
      ${field('Workflow name', '', automation.name, 'Contact form routing', 'automation-name')}
      ${field('Event / trigger', '', automation.event, 'Validated contact form submission', 'automation-event')}
      ${textarea('Expected outcome', '', automation.outcome, 'Create or update CRM lead and notify the account owner.', 'automation-outcome')}
      ${selectField('Status', 'automation-status', AUTOMATION_STATUS_OPTIONS, automation.status)}
      <div class="field-pair">
        ${field('n8n workflow ID', '', automation.n8nWorkflowId ?? '', 'Opaque workflow ID', 'automation-workflowId')}
        ${field('n8n instance URL', '', automation.instanceUrl ?? '', 'https://n8n.example.com/', 'automation-instanceUrl')}
      </div>
      ${field('Credential reference', '', automation.credentialReference ?? '', 'env:N8N_CONTACT_WEBHOOK_URL', 'automation-credentialReference')}
      ${textarea('Data and privacy notes', '', automation.dataNotes, 'Fields transferred, retention, consent, minimization, and error handling.', 'automation-dataNotes')}
    </article>
  `;
}

const WORK_STATUS_OPTIONS: ReadonlyArray<[WebsiteWorkStatus, string]> = [
  ['not-started', 'Not started'],
  ['draft', 'Draft'],
  ['review', 'In review'],
  ['approved', 'Approved'],
  ['blocked', 'Blocked'],
];

const UI_SURFACE_OPTIONS: ReadonlyArray<[WebsiteWorkspaceConfig['surfaceKind'], string]> = [
  ['website', 'Website'],
  ['web-app', 'Web application'],
  ['mobile-app', 'Mobile application'],
  ['desktop-app', 'Desktop application'],
  ['editor-extension', 'Editor extension'],
  ['embedded-ui', 'Embedded / device UI'],
  ['other', 'Other interface'],
];

function surfaceKindLabel(kind: WebsiteWorkspaceConfig['surfaceKind']): string {
  return UI_SURFACE_OPTIONS.find(([value]) => value === kind)?.[1] ?? 'Other interface';
}

const PLATFORM_STATUS_OPTIONS: ReadonlyArray<[WebsitePlatformStatus, string]> = [
  ['not-planned', 'Not planned'],
  ['planned', 'Planned'],
  ['configured', 'Configured'],
  ['live', 'Live'],
  ['blocked', 'Blocked'],
];

const AUTOMATION_STATUS_OPTIONS: ReadonlyArray<[WebsiteAutomationStatus, string]> = [
  ['idea', 'Idea'],
  ['mapped', 'Mapped'],
  ['configured', 'Configured'],
  ['verified', 'Verified'],
  ['paused', 'Paused'],
];

const DEVELOP_HOSTING_MODE_OPTIONS = [
  ['local', 'Local (default)'],
  ['hosted', 'Hosted fallback (password protected)'],
] as const;

function pageIntro(title: string, description: string): string {
  return `<div class="page-intro"><p class="eyebrow">Dedicated dashboard</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>`;
}

function navButton(id: WebsiteStudioPage, step: string, label: string, active: WebsiteStudioPage): string {
  return `<button type="button" class="nav-button${id === active ? ' active' : ''}" data-page-target="${id}"><span>${step}</span>${escapeHtml(label)}</button>`;
}

function metricCard(label: string, value: string, detail: string): string {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function field(
  label: string,
  id: string,
  value: string,
  placeholder = '',
  className = '',
): string {
  const idAttribute = id ? ` id="${escapeHtml(id)}"` : '';
  const classAttribute = className ? ` class="${escapeHtml(className)}"` : '';
  return `<label class="field"><span>${escapeHtml(label)}</span><input${idAttribute}${classAttribute} value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" /></label>`;
}

function textarea(
  label: string,
  id: string,
  value: string,
  placeholder = '',
  className = '',
  rows = 4,
): string {
  const idAttribute = id ? ` id="${escapeHtml(id)}"` : '';
  const classAttribute = className ? ` class="${escapeHtml(className)}"` : '';
  return `<label class="field"><span>${escapeHtml(label)}</span><textarea${idAttribute}${classAttribute} rows="${rows}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea></label>`;
}

function listTextarea(
  label: string,
  id: string,
  values: string[],
  placeholder = '',
  className = '',
): string {
  return textarea(label, id, values.join('\n'), placeholder, className);
}

function colorField(label: string, id: string, value: string): string {
  return `<label class="field color-field"><span>${escapeHtml(label)}</span><div><input type="color" data-color-for="${escapeHtml(id)}" value="${escapeHtml(value)}" /><input id="${escapeHtml(id)}" value="${escapeHtml(value)}" /></div></label>`;
}

function selectField<T extends string>(
  label: string,
  className: string,
  options: ReadonlyArray<readonly [T, string]>,
  value: T,
): string {
  return `<label class="field"><span>${escapeHtml(label)}</span><select class="${escapeHtml(className)}">${options.map(([option, optionLabel]) =>
    `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('')}</select></label>`;
}
