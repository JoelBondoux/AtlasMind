import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import {
  assessWebsiteHostingEnvironments,
  importClientWebsiteIntake,
  WEBSITE_PLATFORM_CATALOG,
  WEBSITE_WORKSPACE_SSOT_PATH,
  WEBSITE_WORKSPACE_SUMMARY_SSOT_PATH,
  WebsiteWorkspaceManager,
} from '../core/websiteWorkspaceManager.js';
import type {
  WebsiteAutomationStatus,
  WebsiteHostingEnvironment,
  WebsitePagePlan,
  WebsitePlatformStatus,
  WebsiteWorkspaceConfig,
  WebsiteWorkStatus,
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
import { compareWebsiteToDelivery } from '../core/websiteDeliverySync.js';
import { WIREFRAME_KIND_CATALOG } from '../core/websiteWireframe.js';
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
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import { WEBSITE_STUDIO_CSS } from './websiteStudioStyles.js';

export type WebsiteStudioPage =
  | 'brief'
  | 'sitemap'
  | 'wireframes'
  | 'ui-system'
  | 'stack'
  | 'automations';

const WEBSITE_STUDIO_PAGES = new Set<WebsiteStudioPage>([
  'brief',
  'sitemap',
  'wireframes',
  'ui-system',
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
  | { type: 'importIntake'; payload: string }
  | { type: 'openSsot'; payload: 'json' | 'markdown' }
  | { type: 'openCommand'; payload: 'atlasmind.openProjectDashboard' | 'atlasmind.openProjectIdeation' | 'atlasmind.openChatPanel' }
  | { type: 'promptForTarget'; payload: { scope: DesignPromptScope; pageId?: string; elementId?: string; instruction: string } }
  | { type: 'generate'; payload: { stage: WebsiteGenerationStage; pageId?: string; elementId?: string } }
  | { type: 'openPreview' }
  | { type: 'stopPreview' }
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
    case 'stopPreview':
    case 'planStackSetup':
    case 'compareDelivery':
      return true;
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
      'AtlasMind Website Studio',
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
  private config: WebsiteWorkspaceConfig;
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
    const read = this.manager.read();
    this.config = read.config;
    this.readOnly = read.preserveExisting;
    this.activePage = targetPage;
    this.render(targetPage);

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

  private async handleMessage(input: unknown): Promise<void> {
    if (!isWebsiteStudioMessage(input)) {
      void this.panel.webview.postMessage({ type: 'notice', tone: 'error', message: 'Website Studio ignored an invalid message.' });
      return;
    }

    try {
      switch (input.type) {
        case 'ready':
          return;
        case 'saveConfig':
          this.config = await this.manager.save(input.payload);
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
            message: `Website plan saved to ${WEBSITE_WORKSPACE_SSOT_PATH}.`,
          });
          return;
        case 'importIntake':
          this.config = importClientWebsiteIntake(this.config, input.payload);
          this.config = await this.manager.save(this.config);
          this.render('brief');
          void vscode.window.showInformationMessage('Client website intake imported and normalized into Website Studio.');
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
          }
          await vscode.window.showTextDocument(vscode.Uri.joinPath(workspace.uri, ...relativePath.split('/')));
          return;
        }
        case 'openCommand':
          if (input.payload === 'atlasmind.openChatPanel') {
            await vscode.commands.executeCommand(input.payload, {
              draftPrompt: 'Help me turn the current Website Studio brief, sitemap, wireframes, UI system, platform choice, and n8n automation map into the next safe implementation milestone. Ground the plan in project_memory/domain/website.json, preserve the platform and credential safety boundaries, and propose the smallest reviewable build step.',
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
        case 'stopPreview':
          await vscode.commands.executeCommand('atlasmind.stopWebsitePreview');
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
      void vscode.window.showErrorMessage(`Website Studio: ${detail}`);
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
  /** The canvas script, read from `media/websiteStudio.js`. */
  scriptContent?: string;
  /** Fallback when the script could not be read inline. */
  scriptUri?: string;
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

  // The canvas needs the geometry model client-side, and the pages need to be
  // readable by the script without re-parsing the DOM. Passed as an escaped
  // data attribute rather than a <script> block so nothing executable is
  // introduced and the CSP stays as it is.
  const canvasState = JSON.stringify({
    pages: config.pages,
    kinds: WIREFRAME_KIND_CATALOG,
    canGenerate: options.canGenerate === true,
    readOnly: options.readOnly === true,
  });

  return getWebviewHtmlShell({
    dashboardSkin: true,
    title: 'AtlasMind Website Studio',
    cspSource: webview.cspSource,
    bodyContent: `
      <div id="websiteStudioState" hidden data-state="${escapeHtml(canvasState)}"></div>
      <header class="studio-hero">
        <div>
          <p class="eyebrow">AtlasMind · Website delivery workspace</p>
          <h1>Website Studio</h1>
          <p class="hero-copy">Move a client website from intake and sitemap through wireframes, visual design, a guarded Develop → Staging → Production pipeline, platform readiness, and automation mapping.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="secondary" data-command="atlasmind.openProjectIdeation">Ideation board</button>
          <button type="button" class="secondary" data-command="atlasmind.openProjectDashboard">Project dashboard</button>
          <button type="button" data-command="atlasmind.openChatPanel">Plan next milestone with Atlas</button>
        </div>
      </header>
      ${options.readOnly ? `
      <div class="callout warning" role="alert">
        <strong>Read-only.</strong>
        This project's <code>${escapeHtml(WEBSITE_WORKSPACE_SSOT_PATH)}</code> was written by a newer version of AtlasMind.
        You can read it, but saving is disabled — writing now would overwrite settings this build cannot understand.
      </div>` : ''}

      <div class="metric-strip" aria-label="Website readiness summary">
        ${metricCard('Pages', String(config.pages.length), 'in the sitemap')}
        ${metricCard('Design ready', `${approvedPages}/${config.pages.length}`, 'wireframe + UI approved')}
        ${metricCard('Hosting ready', `${readyHostingEnvironments}/3`, 'Develop · Staging · Production')}
        ${metricCard('Primary platform', primaryPlatform?.label ?? 'Not chosen', primaryPlatform?.status ?? 'decision needed')}
        ${metricCard('n8n verified', `${readyAutomations}/${config.automations.length}`, 'mapped workflows')}
      </div>

      <div id="studioNotice" class="notice" role="status" aria-live="polite"></div>

      <div class="studio-layout">
        <nav class="studio-nav" aria-label="Website Studio dashboards">
          ${navButton('brief', '1', 'Client brief', activePage)}
          ${navButton('sitemap', '2', 'Sitemap', activePage)}
          ${/* The nav renders literal numbered steps, so it promises a linear
                workflow — but 3 and 4 were inverted against their own content.
                Each wireframe card tracks a per-page "UI design" stage, and
                that cannot be done consistently until the shared typography,
                colour and component decisions exist. The system now precedes
                the pages that apply it. */ ''}
          ${navButton('ui-system', '3', 'UI system', activePage)}
          ${navButton('wireframes', '4', 'Wireframes & UI', activePage)}
          ${navButton('stack', '5', 'Stack & hosting', activePage)}
          ${navButton('automations', '6', 'n8n automations', activePage)}
          <div class="nav-footer">
            <button type="button" class="secondary full" data-open-ssot="json">Open website.json</button>
            <button type="button" class="secondary full" data-open-ssot="markdown">Open website.md</button>
          </div>
        </nav>

        <main>
          ${renderBriefPage(config, activePage, options)}
          ${renderSitemapPage(config, activePage, options)}
          ${renderWireframesPage(config, activePage, options)}
          ${renderUiSystemPage(config, activePage)}
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
        <button type="button" class="secondary" id="openPreview">Open preview</button>
        <button type="button" id="saveWebsiteStudio"${options.readOnly ? ' disabled' : ''}>Save Website Studio</button>
      </footer>
    `,
    extraCss: WEBSITE_STUDIO_CSS,
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
  return `
    <section class="studio-page${activePage === 'brief' ? ' active' : ''}" data-page="brief">
      ${pageIntro('Client brief', 'Normalize the raw client request before design or platform decisions start. Blank fields remain explicit gaps.')}
      <article class="panel-card prompt-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Describe it in words</p>
            <h2>Whole-site design prompt</h2>
            <p>One sentence about how the site should look and feel. Every page prompt is read against this.</p>
          </div>
          ${generateButton('brief', 'Generate a concept', options)}
        </div>
        <textarea id="siteDesignPrompt" rows="3" placeholder="Calm, editorial, lots of white space. Photography-led, no stock illustration.">${escapeHtml(config.designPrompt)}</textarea>
        <div class="inspector-actions">
          <button type="button" id="askAboutSite">Ask Atlas about the whole site</button>
        </div>
      </article>
      <div class="two-column">
        <article class="panel-card">
          <h2>Client and outcome</h2>
          ${field('Client / organisation', 'intake-clientName', intake.clientName)}
          ${field('Project / website name', 'intake-projectName', intake.projectName)}
          ${textarea('Summary', 'intake-summary', intake.summary, 'What the site is, who it serves, and the change it should create.')}
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
  const tree = buildSitemapTree(config.pages);
  const layout = layoutSitemap(tree);
  const graph = buildLinkGraph(config.pages);
  const titles = new Map(config.pages.map(page => [page.id, page.title]));
  const findings = [...tree.findings.map(finding => finding.message), ...graph.findings.map(finding => finding.message)];

  return `
    <section class="studio-page${activePage === 'sitemap' ? ' active' : ''}" data-page="sitemap">
      ${pageIntro('Sitemap dashboard', 'The hierarchy draws itself from the slugs as pages are added. Give a page a design prompt and it can be generated without ever being drawn.')}

      <article class="panel-card">
        <div class="card-heading">
          <div>
            <h2>Hierarchy map</h2>
            <p>Built from each page's slug. Set a parent explicitly to override it. Click a page to open it on the canvas.</p>
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
          <div><h2>Page inventory</h2><p>${config.pages.length} planned page${config.pages.length === 1 ? '' : 's'}</p></div>
          <button type="button" id="addWebsitePage"${options.readOnly ? ' disabled' : ''}>Add page</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Page</th><th>Slug</th><th>Purpose</th><th>Template</th><th>Links to</th><th></th></tr></thead>
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

function renderWireframesPage(
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage,
  options: WebsiteStudioHtmlOptions,
): string {
  const first = config.pages[0];
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
        <p id="canvasSummary" class="canvas-summary" role="status" aria-live="polite"></p>
        ${generateButton('wireframe', 'Generate this page', options)}
      </div>

      <div class="canvas-layout">
        <aside class="canvas-palette" aria-label="Wireframe blocks">
          <p class="eyebrow">Blocks</p>
          ${WIREFRAME_KIND_CATALOG.map(spec => `
            <button type="button" class="palette-button${spec.kind === 'section' ? ' armed' : ''}"
              data-kind="${escapeHtml(spec.kind)}" title="${escapeHtml(spec.description)}">
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
              <button type="button" id="askAboutPage">Ask Atlas about this page</button>
            </div>
          </div>
        </aside>
      </div>`}

      <div id="wireframeCards" class="wireframe-grid">
        ${config.pages.map(renderWireframeCard).join('')}
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
  return `
    <section class="studio-page${activePage === 'stack' ? ' active' : ''}" data-page="stack">
      ${pageIntro('Stack, hosting and setup', 'Pick what the site is built with and where it ships, then let AtlasMind scaffold it. Framework and platform are one decision — the pairing determines the build command, the output directory and the deploy config.')}
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
        Use a reference such as <code>SecretStorage:website.staging.password</code> or <code>env:WEBSITE_STAGING_PASSWORD</code>. Website Studio rejects raw password values and never writes them to project memory.
      </div>
      <div class="callout warning">
        <strong>No one-click production deploys here.</strong>
        Website Studio records the platform and non-secret references. Use the Project Dashboard delivery pipeline for preflight, approval, backup, publish, and verification.
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
function renderWireframeCard(page: WebsitePagePlan): string {
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
        ${selectField('SEO', 'page-seoStatus', WORK_STATUS_OPTIONS, page.seoStatus)}
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
): string {
  const idAttribute = id ? ` id="${escapeHtml(id)}"` : '';
  const classAttribute = className ? ` class="${escapeHtml(className)}"` : '';
  return `<label class="field"><span>${escapeHtml(label)}</span><textarea${idAttribute}${classAttribute} rows="4" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea></label>`;
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
