import * as vscode from 'vscode';
import {
  buildInterfaceStudioSelectionContext,
  projectWebsiteWorkspaceToInterfaceStudio,
  serializeInterfaceStudioSelectionContext,
} from '../core/interfaceStudioModel.js';
import type { InterfaceStudioSurface } from '../core/interfaceStudioModel.js';
import {
  assessWebsiteHostingEnvironments,
  importClientWebsiteIntake,
  sanitizeWebsiteWorkspace,
  WEBSITE_PLATFORM_CATALOG,
  WEBSITE_WORKSPACE_SSOT_PATH,
  WEBSITE_WORKSPACE_SUMMARY_SSOT_PATH,
  WebsiteWorkspaceManager,
} from '../core/websiteWorkspaceManager.js';
import type {
  WebsiteAutomationStatus,
  WebsiteHostingEnvironment,
  WebsitePlatformStatus,
  WebsiteWorkspaceConfig,
  WebsiteWorkStatus,
} from '../types.js';
import { PANEL_NAV_JS } from './panelNav.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

export type WebsiteStudioPage =
  | 'brief'
  | 'sitemap'
  | 'wireframes'
  | 'ui-system'
  | 'platforms'
  | 'automations';

const WEBSITE_STUDIO_PAGES = new Set<WebsiteStudioPage>([
  'brief',
  'sitemap',
  'wireframes',
  'ui-system',
  'platforms',
  'automations',
]);

const WEBSITE_STUDIO_DRAFT_KEY = 'atlasmind.interfaceStudio.pendingDraft';
const MAX_WEBSITE_STUDIO_CONFIG_MESSAGE_LENGTH = 1_000_000;

interface WebsiteStudioDraftRecord {
  revision: number;
  updatedAt: string;
  config: WebsiteWorkspaceConfig;
}

function isBoundedWebsiteStudioConfig(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    return JSON.stringify(value).length <= MAX_WEBSITE_STUDIO_CONFIG_MESSAGE_LENGTH;
  } catch {
    return false;
  }
}

export function isWebsiteStudioPage(value: unknown): value is WebsiteStudioPage {
  return typeof value === 'string' && WEBSITE_STUDIO_PAGES.has(value as WebsiteStudioPage);
}

export type WebsiteStudioMessage =
  | { type: 'ready' }
  | { type: 'saveConfig'; payload: unknown | { config: unknown; revision: number } }
  | { type: 'importIntake'; payload: string | { raw: string; config: unknown; revision?: number } }
  | { type: 'setActivePage'; payload: WebsiteStudioPage }
  | { type: 'storeDraft'; payload: { config: unknown; revision: number } }
  | { type: 'clearDraft'; payload: { revision: number } }
  | {
      type: 'openContextualChat';
      payload: {
        prompt: string;
        selectedSurfaceId: string;
        selectedNodeId?: string;
        selectedNodeIndex?: number;
        previewProfile: 'desktop' | 'tablet' | 'mobile';
        config: unknown;
      };
    }
  | { type: 'openSsot'; payload: 'json' | 'markdown' }
  | { type: 'openCommand'; payload: 'atlasmind.openProjectDashboard' | 'atlasmind.openProjectIdeation' | 'atlasmind.openChatPanel' };

export function isWebsiteStudioMessage(input: unknown): input is WebsiteStudioMessage {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const message = input as Record<string, unknown>;
  switch (message['type']) {
    case 'ready':
      return true;
    case 'saveConfig':
      if (typeof message['payload'] !== 'object'
        || message['payload'] === null
        || Array.isArray(message['payload'])) {
        return false;
      }
      if ('revision' in message['payload'] || 'config' in message['payload']) {
        const payload = message['payload'] as Record<string, unknown>;
        return Number.isSafeInteger(payload['revision'])
          && (payload['revision'] as number) >= 0
          && isBoundedWebsiteStudioConfig(payload['config']);
      }
      return isBoundedWebsiteStudioConfig(message['payload']);
    case 'importIntake': {
      const payload = message['payload'];
      if (typeof payload === 'string') {
        return payload.length <= 128_000;
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return false;
      }
      const candidate = payload as Record<string, unknown>;
      return typeof candidate['raw'] === 'string'
        && candidate['raw'].length <= 128_000
        && isBoundedWebsiteStudioConfig(candidate['config'])
        && (candidate['revision'] === undefined
          || (Number.isSafeInteger(candidate['revision']) && (candidate['revision'] as number) >= 0));
    }
    case 'setActivePage':
      return isWebsiteStudioPage(message['payload']);
    case 'storeDraft': {
      const payload = message['payload'];
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return false;
      }
      const candidate = payload as Record<string, unknown>;
      return Number.isSafeInteger(candidate['revision'])
        && (candidate['revision'] as number) >= 0
        && isBoundedWebsiteStudioConfig(candidate['config']);
    }
    case 'clearDraft': {
      const payload = message['payload'];
      return typeof payload === 'object'
        && payload !== null
        && !Array.isArray(payload)
        && Number.isSafeInteger((payload as Record<string, unknown>)['revision'])
        && ((payload as Record<string, unknown>)['revision'] as number) >= 0;
    }
    case 'openContextualChat': {
      const payload = message['payload'];
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return false;
      }
      const candidate = payload as Record<string, unknown>;
      return typeof candidate['prompt'] === 'string'
        && candidate['prompt'].trim().length > 0
        && candidate['prompt'].length <= 8_000
        && typeof candidate['selectedSurfaceId'] === 'string'
        && candidate['selectedSurfaceId'].length <= 160
        && (candidate['selectedNodeId'] === undefined
          || (typeof candidate['selectedNodeId'] === 'string' && candidate['selectedNodeId'].length <= 240))
        && (candidate['selectedNodeIndex'] === undefined
          || (Number.isSafeInteger(candidate['selectedNodeIndex'])
            && (candidate['selectedNodeIndex'] as number) >= 0
            && (candidate['selectedNodeIndex'] as number) < 500))
        && (candidate['previewProfile'] === 'desktop'
          || candidate['previewProfile'] === 'tablet'
          || candidate['previewProfile'] === 'mobile')
        && isBoundedWebsiteStudioConfig(candidate['config']);
    }
    case 'openSsot':
      return message['payload'] === 'json' || message['payload'] === 'markdown';
    case 'openCommand':
      return message['payload'] === 'atlasmind.openProjectDashboard'
        || message['payload'] === 'atlasmind.openProjectIdeation'
        || message['payload'] === 'atlasmind.openChatPanel';
    default:
      return false;
  }
}

export class WebsiteStudioPanel {
  public static currentPanel: WebsiteStudioPanel | undefined;
  public static readonly viewType = 'atlasmind.websiteStudio';

  public static createOrShow(
    context: vscode.ExtensionContext,
    targetPage: WebsiteStudioPage = 'brief',
  ): void {
    const safeTargetPage = isWebsiteStudioPage(targetPage) ? targetPage : 'brief';
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (WebsiteStudioPanel.currentPanel) {
      WebsiteStudioPanel.currentPanel.panel.reveal(column);
      WebsiteStudioPanel.currentPanel.activePage = safeTargetPage;
      void WebsiteStudioPanel.currentPanel.panel.webview.postMessage({
        type: 'navigateSettings',
        page: safeTargetPage,
      });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      WebsiteStudioPanel.viewType,
      'AtlasMind Interface Studio',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    );
    WebsiteStudioPanel.currentPanel = new WebsiteStudioPanel(context, panel, safeTargetPage);
  }

  private readonly manager: WebsiteWorkspaceManager;
  private config: WebsiteWorkspaceConfig;
  private activePage: WebsiteStudioPage;
  private saveQueue: Promise<void> = Promise.resolve();
  private draftStateQueue: Promise<void> = Promise.resolve();
  private recoveredDraftRevision = 0;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    targetPage: WebsiteStudioPage,
  ) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.manager = new WebsiteWorkspaceManager(workspaceRoot);
    const savedConfig = this.manager.load();
    const pendingDraft = this.context.workspaceState.get<WebsiteStudioDraftRecord>(WEBSITE_STUDIO_DRAFT_KEY);
    if (pendingDraft
      && Number.isSafeInteger(pendingDraft.revision)
      && pendingDraft.revision >= 0
      && isBoundedWebsiteStudioConfig(pendingDraft.config)
      && (!this.manager.exists()
        || Date.parse(pendingDraft.updatedAt) > Date.parse(savedConfig.updatedAt))) {
      this.config = sanitizeWebsiteWorkspace(pendingDraft.config);
      this.recoveredDraftRevision = pendingDraft.revision;
      this.panel.title = '● AtlasMind Interface Studio';
    } else {
      this.config = savedConfig;
      if (pendingDraft) {
        this.draftStateQueue = Promise.resolve(
          this.context.workspaceState.update(WEBSITE_STUDIO_DRAFT_KEY, undefined),
        )
          .then(() => undefined, () => undefined);
      }
    }
    this.activePage = targetPage;
    this.render(targetPage);

    this.panel.onDidDispose(() => {
      WebsiteStudioPanel.currentPanel = undefined;
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
      this.recoveredDraftRevision,
    );
  }

  private async handleMessage(input: unknown): Promise<void> {
    if (!isWebsiteStudioMessage(input)) {
      void this.panel.webview.postMessage({ type: 'notice', tone: 'error', message: 'Interface Studio ignored an invalid message.' });
      return;
    }

    try {
      switch (input.type) {
        case 'ready':
          return;
        case 'saveConfig': {
          const payload = input.payload;
          const wrapped = typeof payload === 'object'
            && payload !== null
            && !Array.isArray(payload)
            && 'revision' in payload
            && 'config' in payload
            ? payload as { config: unknown; revision: number }
            : undefined;
          const revision = wrapped?.revision ?? 0;
          const draft = wrapped?.config ?? payload;
          const save = this.saveQueue.then(() => this.manager.save(draft));
          // Keep subsequent saves ordered even when this one fails. Each caller
          // still awaits its own job so it receives the corresponding error or
          // acknowledgement instead of inheriting a permanently rejected queue.
          this.saveQueue = save.then(() => undefined, () => undefined);
          this.config = await save;
          await this.reconcilePendingDraftAfterSave(revision);
          await this.panel.webview.postMessage({
            type: 'configSaved',
            revision,
            updatedAt: this.config.updatedAt,
            config: this.config,
            message: `Interface project saved to ${WEBSITE_WORKSPACE_SSOT_PATH}.`,
          });
          return;
        }
        case 'importIntake': {
          const raw = typeof input.payload === 'string' ? input.payload : input.payload.raw;
          const revision = typeof input.payload === 'string' ? 0 : input.payload.revision ?? 0;
          const importJob = this.saveQueue.then(async () => {
            const current = typeof input.payload === 'string'
              ? this.config
              : sanitizeWebsiteWorkspace(input.payload.config);
            return this.manager.save(importClientWebsiteIntake(current, raw));
          });
          this.saveQueue = importJob.then(() => undefined, () => undefined);
          this.config = await importJob;
          await this.reconcilePendingDraftAfterSave(revision);
          await this.panel.webview.postMessage({
            type: 'configImported',
            revision,
            updatedAt: this.config.updatedAt,
            config: this.config,
            message: 'Client intake imported and normalized into Interface Studio.',
          });
          void vscode.window.showInformationMessage('Client intake imported and normalized into Interface Studio.');
          return;
        }
        case 'setActivePage':
          this.activePage = input.payload;
          return;
        case 'storeDraft': {
          const record: WebsiteStudioDraftRecord = {
            revision: input.payload.revision,
            updatedAt: new Date().toISOString(),
            config: sanitizeWebsiteWorkspace(input.payload.config),
          };
          const update = this.draftStateQueue.then(async () => {
            await this.context.workspaceState.update(WEBSITE_STUDIO_DRAFT_KEY, record);
            this.panel.title = '● AtlasMind Interface Studio';
          });
          this.draftStateQueue = update.then(() => undefined, () => undefined);
          await update;
          return;
        }
        case 'clearDraft': {
          const clear = this.draftStateQueue.then(async () => {
            const pending = this.context.workspaceState.get<WebsiteStudioDraftRecord>(WEBSITE_STUDIO_DRAFT_KEY);
            if (pending?.revision === input.payload.revision) {
              await this.context.workspaceState.update(WEBSITE_STUDIO_DRAFT_KEY, undefined);
              this.panel.title = 'AtlasMind Interface Studio';
              this.recoveredDraftRevision = 0;
            }
          });
          this.draftStateQueue = clear.then(() => undefined, () => undefined);
          await clear;
          return;
        }
        case 'openContextualChat': {
          const current = sanitizeWebsiteWorkspace(input.payload.config);
          const surface = current.pages.find(page => page.id === input.payload.selectedSurfaceId);
          const interfaceProject = projectWebsiteWorkspaceToInterfaceStudio(current);
          const websiteAdapter = interfaceProject.targetAdapters[0];
          const adapterSurface = websiteAdapter?.metadata.surfaces.find(candidate =>
            candidate.pageId === input.payload.selectedSurfaceId);
          const selectedSurface = adapterSurface
            ? interfaceProject.flows[0]?.surfaces.find(candidate => candidate.id === adapterSurface.surfaceId)
            : undefined;
          const selectedNodeIndex = input.payload.selectedNodeIndex;
          const selectedNode = selectedNodeIndex !== undefined && Number.isInteger(selectedNodeIndex)
            ? selectedSurface?.nodes[selectedNodeIndex]
            : undefined;
          const selectedNodeIdMatches = input.payload.selectedNodeId === undefined
            ? selectedNodeIndex === undefined
            : selectedNode !== undefined
              && (selectedNode.id === input.payload.selectedNodeId
                || input.payload.selectedNodeId.startsWith(`draft-node-${input.payload.selectedSurfaceId}-`));
          const selectionContext = buildInterfaceStudioSelectionContext(interfaceProject, {
            flowId: interfaceProject.flows[0]?.id,
            surfaceId: selectedSurface?.id,
            nodeId: selectedNodeIdMatches ? selectedNode?.id : undefined,
          });
          const projectedPreviewProfile = interfaceProject.previewProfiles.find(profile =>
            profile.formFactor === (input.payload.previewProfile === 'desktop'
              ? 'expanded'
              : input.payload.previewProfile === 'tablet'
                ? 'medium'
                : 'compact'));
          const context = {
            model: selectionContext
              ? JSON.parse(serializeInterfaceStudioSelectionContext(selectionContext)) as unknown
              : undefined,
            previewProfile: {
              editor: input.payload.previewProfile,
              model: projectedPreviewProfile,
            },
            sourceSurface: surface,
            projectBrief: {
              name: current.intake.projectName,
              summary: current.intake.summary,
              audiences: current.intake.audiences,
              goals: current.intake.goals,
              constraints: current.intake.constraints,
            },
          };
          await vscode.commands.executeCommand('atlasmind.openChatPanel', {
            draftPrompt: [
              'Work with me on the selected Interface Studio design. Treat the attached surface and selection context as the current unsaved selection, not the last saved website.json.',
              '',
              `Request: ${input.payload.prompt.trim()}`,
              '',
              'Current selection and visual language:',
              '```json',
              JSON.stringify(context, null, 2),
              '```',
              '',
              'Propose the smallest reviewable visual change. Describe affected surfaces/nodes and keep renderer-specific implementation details behind the appropriate adapter.',
            ].join('\n'),
          });
          await this.panel.webview.postMessage({
            type: 'chatHandedOff',
            message: 'Atlas opened with the current unsaved surface and selection context attached.',
          });
          return;
        }
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
              draftPrompt: 'Help me turn the current Interface Studio brief, surfaces, visual language, platform choice, and n8n automation map into the next safe implementation milestone. Ground the plan in project_memory/domain/website.json, preserve the platform and credential safety boundaries, and propose the smallest reviewable build step.',
            });
          } else {
            await vscode.commands.executeCommand(input.payload);
          }
          return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void this.panel.webview.postMessage({ type: 'notice', tone: 'error', message: detail });
      void vscode.window.showErrorMessage(`Interface Studio: ${detail}`);
    }
  }

  /**
   * Make recovery independent of the webview surviving long enough to process
   * an acknowledgement. A matching/older record is now on disk and can go;
   * a higher revision represents edits made while this save was running, so it
   * is retained and timestamped after the canonical write for the next open.
   */
  private async reconcilePendingDraftAfterSave(savedRevision: number): Promise<void> {
    const reconcile = this.draftStateQueue.then(async () => {
      const pending = this.context.workspaceState.get<WebsiteStudioDraftRecord>(WEBSITE_STUDIO_DRAFT_KEY);
      if (!pending || pending.revision <= savedRevision) {
        if (pending) {
          await this.context.workspaceState.update(WEBSITE_STUDIO_DRAFT_KEY, undefined);
        }
        this.panel.title = 'AtlasMind Interface Studio';
        this.recoveredDraftRevision = 0;
        return;
      }
      await this.context.workspaceState.update(WEBSITE_STUDIO_DRAFT_KEY, {
        ...pending,
        updatedAt: new Date().toISOString(),
      } satisfies WebsiteStudioDraftRecord);
      this.panel.title = '● AtlasMind Interface Studio';
    });
    this.draftStateQueue = reconcile.then(() => undefined, () => undefined);
    await reconcile;
  }
}

export function getWebsiteStudioHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage = 'brief',
  recoveredDraftRevision = 0,
): string {
  const interfaceProject = projectWebsiteWorkspaceToInterfaceStudio(config);
  const primaryFlow = interfaceProject.flows[0];
  const firstSurface = config.pages[0];
  const firstNodeLabel = firstSurface?.sections[0] ?? 'Surface';
  const projectName = config.intake.projectName || config.intake.clientName || 'Untitled interface';

  return getWebviewHtmlShell({
    title: 'AtlasMind Interface Studio',
    cspSource: webview.cspSource,
    bodyContent: `
      <header class="studio-toolbar" aria-label="Interface Studio toolbar">
        <div class="project-identity">
          <span class="atlas-mark" aria-hidden="true">A</span>
          <div>
            <p class="eyebrow">Interface Studio</p>
            <strong data-project-name>${escapeHtml(projectName)}</strong>
          </div>
        </div>
        <div class="mode-tabs" role="tablist" aria-label="Studio mode">
          ${studioModeButton('plan', 'Plan')}
          ${studioModeButton('design', 'Design', true)}
          ${studioModeButton('build', 'Build')}
          ${studioModeButton('preview', 'Preview')}
        </div>
        <div class="toolbar-actions">
          <div class="preview-profiles" role="group" aria-label="Preview profile">
            ${previewProfileButton('desktop', 'Desktop', true)}
            ${previewProfileButton('tablet', 'Tablet')}
            ${previewProfileButton('mobile', 'Mobile')}
          </div>
          <span id="saveState" class="save-state" data-save-state="${recoveredDraftRevision > 0 ? 'dirty' : 'saved'}" data-initial-revision="${recoveredDraftRevision}" role="status">${recoveredDraftRevision > 0 ? 'Recovered unsaved draft' : 'Saved'}</span>
          <button type="button" class="primary-action" id="saveWebsiteStudio">Save</button>
        </div>
      </header>

      <div id="studioNotice" class="notice" role="status" aria-live="polite"></div>

      <div class="interface-shell" data-interface-project-id="${escapeHtml(interfaceProject.id)}" data-interface-flow-id="${escapeHtml(primaryFlow?.id ?? '')}">
        <nav class="tool-rail" aria-label="Builder tools">
          ${toolRailButton('surfaces', 'S', 'Surfaces', true)}
          ${toolRailButton('layers', 'L', 'Layers')}
          ${toolRailButton('components', 'C', 'Components')}
          ${toolRailButton('assets', 'A', 'Assets')}
          ${toolRailButton('visual-language', 'V', 'Visual language')}
          ${toolRailButton('history', 'H', 'History')}
          <span class="rail-spacer"></span>
          <button type="button" class="rail-button" data-open-settings="${escapeHtml(activePage)}" aria-label="Project setup" title="Project setup"><span aria-hidden="true">⚙</span></button>
        </nav>

        <aside class="builder-left-panel" aria-label="Surface and layer panel">
          <section class="left-panel-view active" data-left-panel="surfaces" aria-label="Surfaces">
            <div class="panel-heading">
              <div><p class="eyebrow">Project</p><h2>Surfaces</h2></div>
              <button type="button" class="icon-button" id="addSurface" aria-label="Add surface" title="Add surface">+</button>
            </div>
            <div id="surfaceList" class="surface-list" role="tree" aria-label="Project surfaces">
              ${renderSurfaceList(config)}
            </div>
            <button type="button" class="panel-link" data-open-settings="sitemap">Routes and surface details</button>
          </section>

          <section class="left-panel-view" data-left-panel="layers" aria-label="Layers">
            <div class="panel-heading"><div><p class="eyebrow">Structure</p><h2>Layers</h2></div></div>
            <div id="layerGroups">${renderLayerGroups(config, interfaceProject)}</div>
          </section>

          <section class="left-panel-view" data-left-panel="components" aria-label="Components">
            <div class="panel-heading"><div><p class="eyebrow">Library</p><h2>Components</h2></div></div>
            <div class="library-list" id="componentLibrary">
              ${config.designSystem.componentNotes.length > 0
                ? config.designSystem.componentNotes.map(note => `<button type="button" class="library-item" data-open-settings="ui-system" title="Edit component guidance"><span class="component-glyph" aria-hidden="true">◇</span>${escapeHtml(note)}</button>`).join('')
                : '<div class="compact-empty"><strong>No component recipes yet</strong><span>Describe reusable navigation, cards, forms, and actions in Visual language.</span></div>'}
            </div>
            <button type="button" class="panel-link" data-open-settings="ui-system">Manage component guidance</button>
          </section>

          <section class="left-panel-view" data-left-panel="assets" aria-label="Assets">
            <div class="panel-heading"><div><p class="eyebrow">Sources</p><h2>Assets</h2></div></div>
            <div class="compact-empty"><strong>No assets attached</strong><span>References and media will remain target-neutral until a renderer consumes them.</span></div>
          </section>

          <section class="left-panel-view" data-left-panel="visual-language" aria-label="Visual language">
            <div class="panel-heading"><div><p class="eyebrow">System</p><h2>Visual language</h2></div></div>
            <div class="token-list">
              ${visualToken('Primary action', config.designSystem.primaryColor, 'design-primaryColor')}
              ${visualToken('Strong surface', config.designSystem.secondaryColor, 'design-secondaryColor')}
              ${visualToken('Accent', config.designSystem.accentColor, 'design-accentColor')}
              ${visualTextToken('Heading', config.designSystem.headingFont, 'headingFont')}
              ${visualTextToken('Body', config.designSystem.bodyFont, 'bodyFont')}
              ${visualTextToken('Corners', config.designSystem.cornerStyle, 'cornerStyle')}
            </div>
            <div class="language-note"><strong data-accessibility-intent>${escapeHtml(config.designSystem.accessibilityTarget)}</strong><span>Applies across renderer adapters.</span></div>
            <button type="button" class="panel-link" data-open-settings="ui-system">Edit foundations and guidance</button>
          </section>

          <section class="left-panel-view" data-left-panel="history" aria-label="History">
            <div class="panel-heading"><div><p class="eyebrow">Review</p><h2>History</h2></div></div>
            <ol class="history-list" id="historyList">
              <li><span class="history-dot"></span><div><strong>Current saved version</strong><small>${escapeHtml(config.updatedAt)}</small></div></li>
            </ol>
          </section>
        </aside>

        <main id="studioCanvas" class="canvas-region" role="tabpanel" aria-label="Interface canvas">
          <div class="canvas-toolbar">
            <div class="canvas-breadcrumb" id="canvasBreadcrumb"><span>Flow</span><strong>${escapeHtml(firstSurface?.title ?? 'No surface')}</strong></div>
            <div class="canvas-controls">
              <button type="button" class="canvas-control" id="fitCanvas">Fit</button>
              <span id="zoomLabel">100%</span>
              <button type="button" class="canvas-control" data-zoom="out" aria-label="Zoom out">−</button>
              <button type="button" class="canvas-control" data-zoom="in" aria-label="Zoom in">+</button>
            </div>
          </div>
          <section class="mode-canvas plan-canvas" data-mode-canvas="plan" aria-label="Plan board">
            ${renderPlanCanvas(config)}
          </section>
          <section class="mode-canvas builder-canvas active" data-mode-canvas="builder" data-preview-profile="desktop" aria-label="Design canvas">
            <div class="canvas-stage" id="canvasStage" style="--studio-primary:${escapeHtml(config.designSystem.primaryColor)};--studio-strong:${escapeHtml(config.designSystem.secondaryColor)};--studio-accent:${escapeHtml(config.designSystem.accentColor)};">
              ${renderCanvasFrames(config, interfaceProject)}
            </div>
          </section>
        </main>

        <aside class="builder-right-panel" aria-label="Inspector and Atlas chat">
          <section class="inspector-pane" aria-label="Selection inspector">
            <div class="pane-heading">
              <div><p class="eyebrow">Inspect</p><h2 id="inspectorTitle">${escapeHtml(firstSurface?.title ?? 'No selection')}</h2></div>
              <span class="selection-kind" id="selectionKind">Surface</span>
            </div>
            <div class="selection-path" id="selectionPath">${escapeHtml(projectName)} / ${escapeHtml(firstSurface?.title ?? 'No surface')}</div>
            <div id="surfaceInspector" class="inspector-form">
              <label class="field"><span>Name</span><input id="inspectorSurfaceTitle" maxlength="160" value="${escapeHtml(firstSurface?.title ?? '')}" /></label>
              <label class="field"><span>Route / reference</span><input id="inspectorSurfaceSlug" maxlength="240" value="${escapeHtml(firstSurface?.slug ?? '')}" /></label>
              <label class="field"><span>Purpose</span><textarea id="inspectorSurfacePurpose" maxlength="2000" rows="3">${escapeHtml(firstSurface?.purpose ?? '')}</textarea></label>
              <div class="inspector-row"><span>Target adapter</span><strong>Web · semantic</strong></div>
            </div>
            <div id="nodeInspector" class="inspector-form" hidden>
              <label class="field"><span>Node label</span><input id="inspectorNodeName" maxlength="500" value="${escapeHtml(firstNodeLabel)}" /></label>
              <div class="inspector-row"><span>Layout intent</span><strong>Semantic region</strong></div>
              <div class="inspector-row"><span>Renderer sizing</span><strong>Adapter managed</strong></div>
              <p class="inspector-hint">The current v1 source stores the label and design notes. Cross-renderer layout constraints will become editable only when they have a persisted schema.</p>
            </div>
          </section>

          <section class="assistant-pane" aria-label="Atlas conversational development">
            <div class="pane-heading">
              <div><p class="eyebrow">Atlas</p><h2>Build together</h2></div>
              <span class="assistant-status">Context on</span>
            </div>
            <div class="chat-context" data-chat-context>
              <span class="context-chip" data-chat-selection>${escapeHtml(firstSurface?.title ?? 'No surface')}</span>
              <span class="context-chip" data-chat-profile>Desktop</span>
              <span class="context-chip subtle" data-chat-draft>${recoveredDraftRevision > 0 ? 'Recovered unsaved draft' : 'Saved draft'}</span>
            </div>
            <div class="chat-thread" id="chatThread" aria-live="polite">
              <div class="atlas-message">Select a surface or node, then ask for a change. I’ll carry its current unsaved surface context, visual language, and preview profile into Atlas.</div>
            </div>
            <div class="proposal-card" id="proposalCard" hidden>
              <p class="eyebrow">Proposed change</p>
              <strong id="proposalSummary">Review the affected selection before applying.</strong>
              <div class="proposal-actions">
                <button type="button" data-proposal-action="apply" disabled title="Available when Atlas returns a structured patch to Interface Studio">Apply</button>
                <button type="button" class="secondary" data-proposal-action="reject">Reject</button>
              </div>
            </div>
            <div class="chat-composer">
              <label class="sr-only" for="atlasChatPrompt">Ask Atlas about the current selection</label>
              <textarea id="atlasChatPrompt" maxlength="8000" rows="3" placeholder="Make this hero feel more confident and reduce the visual noise…"></textarea>
              <div class="composer-footer"><small>Current surface + unsaved selection attached</small><button type="button" id="requestAtlasProposal">Ask Atlas</button></div>
            </div>
          </section>
        </aside>
      </div>

      <section id="projectSettingsDrawer" class="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="projectSettingsTitle" hidden>
        <button type="button" class="drawer-backdrop" data-close-settings aria-label="Close project settings"></button>
        <div class="drawer-panel">
          <header class="drawer-header">
            <div><p class="eyebrow">Project setup</p><h2 id="projectSettingsTitle">Brief, surfaces, and delivery</h2></div>
            <button type="button" class="icon-button" data-close-settings aria-label="Close project settings">×</button>
          </header>
          <nav class="settings-tabs" role="tablist" aria-label="Project settings sections">
            ${navButton('brief', '1', 'Brief', activePage)}
            ${navButton('sitemap', '2', 'Surfaces', activePage)}
            ${navButton('ui-system', '3', 'Visual language', activePage)}
            ${navButton('wireframes', '4', 'Review states', activePage)}
            ${navButton('platforms', '5', 'Delivery', activePage)}
            ${navButton('automations', '6', 'Automations', activePage)}
          </nav>
          <div class="settings-content">
            ${renderBriefPage(config, activePage)}
            ${renderSitemapPage(config, activePage)}
            ${renderWireframesPage(config, activePage)}
            ${renderUiSystemPage(config, activePage)}
            ${renderPlatformsPage(config, activePage)}
            ${renderAutomationsPage(config, activePage)}
          </div>
          <footer class="drawer-footer">
            <div class="drawer-links">
              <button type="button" class="secondary" data-open-ssot="json">Open website.json</button>
              <button type="button" class="secondary" data-open-ssot="markdown">Open website.md</button>
              <button type="button" class="secondary" data-command="atlasmind.openProjectDashboard">Delivery dashboard</button>
            </div>
            <span>Renderer-specific hosting and automation stay secondary to visual composition.</span>
          </footer>
        </div>
      </section>
    `,
    extraCss: WEBSITE_STUDIO_CSS,
    scriptContent: WEBSITE_STUDIO_SCRIPT,
  });
}

function renderBriefPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  const intake = config.intake;
  return `
    <section id="settings-brief" role="tabpanel" class="studio-page${activePage === 'brief' ? ' active' : ''}" data-page="brief">
      ${pageIntro('Client brief', 'Normalize the raw client request before design or platform decisions start. Blank fields remain explicit gaps.')}
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
        <textarea id="clientIntakeJson" maxlength="128000" rows="9" placeholder='{"companyName":"Northstar","objectives":["Generate qualified leads"],"targetAudience":["Operations leaders"]}'></textarea>
        <button type="button" id="importClientIntake">Import and normalize</button>
      </article>
    </section>
  `;
}

function renderSitemapPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  return `
    <section id="settings-sitemap" role="tabpanel" class="studio-page${activePage === 'sitemap' ? ' active' : ''}" data-page="sitemap">
      ${pageIntro('Sitemap dashboard', 'Define the information architecture before detailed layout work. Every page has an explicit purpose and reusable template.')}
      <article class="panel-card">
        <div class="card-heading">
          <div><h2>Page inventory</h2><p>${config.pages.length} planned page${config.pages.length === 1 ? '' : 's'}</p></div>
          <button type="button" id="addWebsitePage">Add page</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Page</th><th>Slug</th><th>Purpose</th><th>Template</th><th></th></tr></thead>
            <tbody id="sitemapRows">
              ${config.pages.map(renderSitemapRow).join('')}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderWireframesPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  return `
    <section id="settings-wireframes" role="tabpanel" class="studio-page${activePage === 'wireframes' ? ' active' : ''}" data-page="wireframes">
      ${pageIntro('Wireframes & client design', 'Progress each page from low-fidelity structure to reviewed visual design, content, and SEO readiness.')}
      <div id="wireframeCards" class="wireframe-grid">
        ${config.pages.map(renderWireframeCard).join('')}
      </div>
    </section>
  `;
}

function renderUiSystemPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  const design = config.designSystem;
  return `
    <section id="settings-ui-system" role="tabpanel" class="studio-page${activePage === 'ui-system' ? ' active' : ''}" data-page="ui-system">
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

function renderPlatformsPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  const readiness = new Map(assessWebsiteHostingEnvironments(config).map(item => [item.id, item]));
  return `
    <section id="settings-platforms" role="tabpanel" class="studio-page${activePage === 'platforms' ? ' active' : ''}" data-page="platforms">
      ${pageIntro('Hosting & platform dashboard', 'Configure the fixed Develop → Staging → Production path, then compare code-first hosting, managed CMS, visual builders, and commerce platforms. Publishing remains guarded by Delivery.')}
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
        Use a reference such as <code>SecretStorage:website.staging.password</code> or <code>env:WEBSITE_STAGING_PASSWORD</code>. Interface Studio rejects raw password values and never writes them to project memory.
      </div>
      <div class="callout warning">
        <strong>No one-click production deploys here.</strong>
        Interface Studio records the platform and non-secret references. Use the Project Dashboard delivery pipeline for preflight, approval, backup, publish, and verification.
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
    <section id="settings-automations" role="tabpanel" class="studio-page${activePage === 'automations' ? ' active' : ''}" data-page="automations">
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

function renderSitemapRow(page: WebsiteWorkspaceConfig['pages'][number]): string {
  return `
    <tr data-page-id="${escapeHtml(page.id)}">
      <td><input class="page-title" aria-label="Page title" value="${escapeHtml(page.title)}" /></td>
      <td><input class="page-slug" aria-label="Page slug" value="${escapeHtml(page.slug)}" /></td>
      <td><textarea class="page-purpose" aria-label="Page purpose" rows="2">${escapeHtml(page.purpose)}</textarea></td>
      <td><input class="page-template" aria-label="Page template" value="${escapeHtml(page.template)}" /></td>
      <td><button type="button" class="danger subtle remove-page" data-remove-id="${escapeHtml(page.id)}">Remove</button></td>
    </tr>
  `;
}

function renderWireframeCard(page: WebsiteWorkspaceConfig['pages'][number]): string {
  const sections = page.sections.length > 0 ? page.sections : ['Section not mapped'];
  return `
    <article class="wireframe-card" data-page-id="${escapeHtml(page.id)}">
      <div class="wireframe-topline">
        <div><p class="eyebrow">${escapeHtml(page.slug)}</p><h2>${escapeHtml(page.title)}</h2></div>
        <span class="status-pill">${escapeHtml(page.designStatus)}</span>
      </div>
      <div class="wireframe-sheet" aria-label="${escapeHtml(page.title)} low-fidelity section outline">
        ${sections.slice(0, 8).map((section, index) => `
          <div class="wireframe-block block-${(index % 3) + 1}"><span>${escapeHtml(section)}</span></div>
        `).join('')}
      </div>
      ${listTextarea('Page sections', '', page.sections, 'One section per line', 'page-sections')}
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
  return `<button type="button" role="tab" aria-controls="settings-${id}" aria-selected="${id === active ? 'true' : 'false'}" class="nav-button${id === active ? ' active' : ''}" data-page-target="${id}"><span>${step}</span>${escapeHtml(label)}</button>`;
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
  return `<label class="field"><span>${escapeHtml(label)}</span><input${idAttribute}${classAttribute} maxlength="4000" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" /></label>`;
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
  return `<label class="field"><span>${escapeHtml(label)}</span><textarea${idAttribute}${classAttribute} maxlength="8000" rows="4" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea></label>`;
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

function studioModeButton(id: 'plan' | 'design' | 'build' | 'preview', label: string, active = false): string {
  return `<button type="button" role="tab" data-studio-mode="${id}" aria-controls="studioCanvas" aria-selected="${active ? 'true' : 'false'}" class="mode-tab${active ? ' active' : ''}">${escapeHtml(label)}</button>`;
}

function previewProfileButton(id: 'desktop' | 'tablet' | 'mobile', label: string, active = false): string {
  return `<button type="button" data-preview-profile="${id}" aria-pressed="${active ? 'true' : 'false'}" class="profile-button${active ? ' active' : ''}" title="${escapeHtml(label)} preview"><span aria-hidden="true">${id === 'desktop' ? '▱' : id === 'tablet' ? '▯' : '▯'}</span><span class="profile-label">${escapeHtml(label)}</span></button>`;
}

function toolRailButton(id: string, glyph: string, label: string, active = false): string {
  return `<button type="button" class="rail-button${active ? ' active' : ''}" data-tool-panel="${escapeHtml(id)}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span aria-hidden="true">${escapeHtml(glyph)}</span></button>`;
}

function visualToken(label: string, value: string, sourceId: string): string {
  return `<button type="button" class="token-row" data-open-settings="ui-system" data-token-source="${escapeHtml(sourceId)}" data-token-value="${escapeHtml(value)}" title="Edit visual language"><span class="token-swatch" style="background:${escapeHtml(value)}"></span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(value)}</small></span></button>`;
}

function visualTextToken(label: string, value: string, sourceId: string): string {
  return `<button type="button" class="token-row" data-open-settings="ui-system" data-visual-text-token="${escapeHtml(sourceId)}" title="Edit visual language"><span class="token-type" aria-hidden="true">Aa</span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(value)}</small></span></button>`;
}

function renderSurfaceList(config: WebsiteWorkspaceConfig): string {
  return config.pages.map((page, index) => `
    <button type="button" role="treeitem" class="surface-item${index === 0 ? ' active' : ''}" data-select-surface="${escapeHtml(page.id)}" data-selection-id="${escapeHtml(page.id)}" aria-selected="${index === 0 ? 'true' : 'false'}">
      <span class="surface-icon" aria-hidden="true">${page.slug === '/' ? '⌂' : '□'}</span>
      <span><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.slug)}</small></span>
      <span class="surface-status ${escapeHtml(page.designStatus)}" title="Design status: ${escapeHtml(page.designStatus)}"></span>
    </button>
  `).join('');
}

function renderLayerGroups(
  config: WebsiteWorkspaceConfig,
  project: ReturnType<typeof projectWebsiteWorkspaceToInterfaceStudio>,
): string {
  return config.pages.map((page, pageIndex) => `
    <div class="layer-group${pageIndex === 0 ? ' active' : ''}" data-layer-surface="${escapeHtml(page.id)}">
      <button type="button" class="layer-surface" data-select-surface="${escapeHtml(page.id)}" data-selection-id="${escapeHtml(page.id)}">
        <span aria-hidden="true">▾</span><strong>${escapeHtml(page.title)}</strong>
      </button>
      <div class="layer-children" role="tree" aria-label="${escapeHtml(page.title)} layers">
        ${page.sections.map((section, index) => {
          const nodeId = project.flows[0]?.surfaces[pageIndex]?.nodes[index]?.id
            ?? `draft-node:${page.id}:${index}`;
          return `<button type="button" role="treeitem" class="layer-node" data-select-node="${escapeHtml(nodeId)}" data-node-label="${escapeHtml(section)}" data-node-index="${index}" data-surface-id="${escapeHtml(page.id)}" data-selection-id="${escapeHtml(nodeId)}" aria-selected="false"><span aria-hidden="true">${index === 0 ? '◇' : '□'}</span>${escapeHtml(section)}</button>`;
        }).join('') || '<span class="layer-empty">No nodes yet</span>'}
      </div>
    </div>
  `).join('');
}

function renderPlanCanvas(config: WebsiteWorkspaceConfig): string {
  return `
    <div class="plan-summary">
      <p class="eyebrow">Shared project context</p>
      <h2 data-project-name>${escapeHtml(config.intake.projectName || config.intake.clientName || 'Interface plan')}</h2>
      <p data-project-summary>${escapeHtml(config.intake.summary || 'Capture the audience, outcome, and constraints, then shape the surfaces that deliver them.')}</p>
      <button type="button" class="secondary" data-open-settings="brief">Edit project brief</button>
    </div>
    <div class="flow-map" aria-label="Primary flow">
      ${config.pages.map((page, index) => `
        ${index > 0 ? '<span class="flow-connector" aria-hidden="true">→</span>' : ''}
        <button type="button" class="flow-card" data-select-surface="${escapeHtml(page.id)}" data-selection-id="${escapeHtml(page.id)}">
          <span class="flow-index">${index + 1}</span>
          <strong>${escapeHtml(page.title)}</strong>
          <small>${escapeHtml(page.purpose || page.slug)}</small>
        </button>
      `).join('')}
    </div>
  `;
}

function renderCanvasFrames(
  config: WebsiteWorkspaceConfig,
  project: ReturnType<typeof projectWebsiteWorkspaceToInterfaceStudio>,
): string {
  return config.pages.map((page, index) =>
    renderCanvasFrame(page, index === 0, project.flows[0]?.surfaces[index])).join('');
}

function renderCanvasFrame(
  page: WebsiteWorkspaceConfig['pages'][number],
  active: boolean,
  projectedSurface: InterfaceStudioSurface | undefined,
): string {
  return `
    <article class="interface-frame${active ? ' active' : ''}" data-surface-frame="${escapeHtml(page.id)}" data-selection-id="${escapeHtml(page.id)}">
      <header class="frame-chrome">
        <div><span class="frame-dot"></span><span class="frame-dot"></span><span class="frame-dot"></span></div>
        <span>${escapeHtml(page.slug)}</span>
        <button type="button" class="frame-select" data-select-surface="${escapeHtml(page.id)}" aria-label="Select ${escapeHtml(page.title)} surface">${escapeHtml(page.title)}</button>
      </header>
      <div class="surface-artboard" data-select-surface="${escapeHtml(page.id)}">
        <nav class="preview-navigation" aria-label="Preview navigation">
          <strong>${escapeHtml(page.title)}</strong>
          <span>Overview</span><span>Work</span><span>About</span>
          <i></i><b>Get started</b>
        </nav>
        ${page.sections.map((section, index) =>
          renderCanvasNode(
            page,
            section,
            index,
            projectedSurface?.nodes[index]?.id ?? `draft-node:${page.id}:${index}`,
          )).join('') || `
          <button type="button" class="empty-surface" data-open-settings="wireframes">Add the first node to ${escapeHtml(page.title)}</button>
        `}
        <footer class="preview-footer"><strong>${escapeHtml(page.title)}</strong><span>Visual language applied across targets</span></footer>
      </div>
    </article>
  `;
}

function renderCanvasNode(
  page: WebsiteWorkspaceConfig['pages'][number],
  section: string,
  index: number,
  nodeId: string,
): string {
  const type = index === 0 ? 'hero' : index % 3 === 1 ? 'split' : index % 3 === 2 ? 'cards' : 'statement';
  const description = index === 0
    ? page.purpose
    : `A semantic ${section.toLocaleLowerCase()} region that can be translated by the selected renderer adapter.`;
  return `
    <button type="button" class="surface-node node-${type}" data-select-node="${escapeHtml(nodeId)}" data-node-label="${escapeHtml(section)}" data-node-index="${index}" data-surface-id="${escapeHtml(page.id)}" data-selection-id="${escapeHtml(nodeId)}" aria-selected="false">
      <span class="node-label">${escapeHtml(section)}</span>
      <span class="node-content">
        <small>${index === 0 ? 'Designed for the outcome' : 'Reusable interface region'}</small>
        <strong>${escapeHtml(section)}</strong>
        <span>${escapeHtml(description)}</span>
        ${type === 'hero' ? '<i class="preview-actions"><b>Primary action</b><em>Learn more</em></i>' : ''}
        ${type === 'cards' ? '<i class="preview-card-row"><em></em><em></em><em></em></i>' : ''}
        ${type === 'split' ? '<i class="preview-media"></i>' : ''}
      </span>
    </button>
  `;
}

const WEBSITE_STUDIO_CSS = `
  :root {
    --studio-accent: var(--vscode-button-background, #2563eb);
    --studio-border: var(--vscode-widget-border, rgba(127,127,127,.28));
    --studio-muted: var(--vscode-descriptionForeground, #8b949e);
    --studio-card: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-foreground) 12%);
  }
  body { padding: 0 22px 92px; }
  .studio-hero { display:flex; justify-content:space-between; gap:24px; align-items:flex-end; padding:28px 0 20px; border-bottom:1px solid var(--studio-border); }
  .studio-hero h1 { margin:2px 0 6px; font-size:2rem; letter-spacing:-.03em; }
  .hero-copy { max-width:760px; color:var(--studio-muted); margin:0; }
  .hero-actions, .card-heading, .platform-topline { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .eyebrow { margin:0; color:var(--studio-muted); text-transform:uppercase; letter-spacing:.11em; font-size:.72rem; font-weight:700; }
  button { min-height:34px; border-radius:7px; font-weight:600; }
  button.secondary { background:transparent; color:var(--vscode-foreground); border:1px solid var(--studio-border); }
  button.secondary:hover { background:var(--vscode-list-hoverBackground); }
  button.full { width:100%; }
  button.danger { color:var(--vscode-errorForeground, #f85149); }
  button.subtle { background:transparent; border:1px solid var(--studio-border); }
  .metric-strip { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; padding:16px 0; }
  .metric-card, .panel-card, .platform-card, .automation-card, .wireframe-card { border:1px solid var(--studio-border); background:var(--studio-card); border-radius:12px; }
  .metric-card { padding:14px; display:grid; gap:3px; }
  .metric-card span, .metric-card small { color:var(--studio-muted); }
  .metric-card strong { font-size:1.12rem; }
  .notice { display:none; margin:0 0 14px; padding:10px 13px; border:1px solid var(--studio-border); border-radius:8px; }
  .notice.visible { display:block; }
  .notice.success { border-color:var(--vscode-testing-iconPassed, #3fb950); }
  .notice.error { border-color:var(--vscode-errorForeground, #f85149); }
  .studio-layout { display:grid; grid-template-columns:210px minmax(0,1fr); gap:24px; align-items:start; }
  .studio-nav { position:sticky; top:12px; display:grid; gap:7px; }
  .nav-button { display:flex; align-items:center; gap:10px; text-align:left; background:transparent; color:var(--vscode-foreground); border:1px solid transparent; }
  .nav-button span { width:24px; height:24px; display:grid; place-items:center; border-radius:50%; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); }
  .nav-button:hover { background:var(--vscode-list-hoverBackground); }
  .nav-button.active { border-color:var(--studio-accent); background:color-mix(in srgb, var(--studio-accent) 12%, transparent); }
  .nav-footer { margin-top:12px; padding-top:12px; border-top:1px solid var(--studio-border); display:grid; gap:7px; }
  .studio-page { display:none; }
  .studio-page.active { display:block; }
  .page-intro { padding:18px 20px; margin-bottom:14px; border-left:4px solid var(--studio-accent); background:color-mix(in srgb, var(--studio-accent) 7%, transparent); border-radius:0 10px 10px 0; }
  .page-intro h2 { margin:4px 0; font-size:1.35rem; }
  .page-intro p:last-child { margin:0; color:var(--studio-muted); max-width:860px; }
  .two-column { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
  .panel-card, .platform-card, .automation-card, .wireframe-card { padding:18px; }
  .panel-card h2, .platform-card h2, .automation-card h2, .wireframe-card h2 { margin:0 0 12px; }
  .field { display:grid; gap:5px; margin:0 0 12px; }
  .field > span { font-weight:600; font-size:.84rem; }
  input, textarea, select { width:100%; border:1px solid var(--vscode-input-border, var(--studio-border)); background:var(--vscode-input-background); color:var(--vscode-input-foreground); border-radius:6px; padding:8px 9px; font:inherit; }
  textarea { resize:vertical; }
  input:focus, textarea:focus, select:focus, button:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
  .field-pair, .status-grid, .color-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .status-grid, .color-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .color-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .color-field > div { display:flex; gap:6px; }
  .color-field input[type=color] { width:42px; padding:2px; flex:0 0 42px; }
  .import-card { margin-top:14px; display:grid; grid-template-columns:minmax(220px,.75fr) minmax(320px,1.25fr) auto; gap:16px; align-items:end; }
  .table-wrap { overflow:auto; }
  table { min-width:860px; }
  th { color:var(--studio-muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.05em; }
  td { vertical-align:top; }
  .wireframe-grid, .platform-grid, .automation-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
  .hosting-heading { display:flex; justify-content:space-between; gap:16px; align-items:end; margin:18px 0 12px; }
  .hosting-heading h2 { margin:3px 0; }
  .hosting-heading p:last-child { margin:0; color:var(--studio-muted); max-width:820px; }
  .platform-heading { margin-top:24px; padding-top:20px; border-top:1px solid var(--studio-border); }
  .environment-flow { display:grid; grid-template-columns:minmax(0,1fr) 34px minmax(0,1fr) 34px minmax(0,1fr); gap:8px; align-items:stretch; margin-bottom:14px; }
  .environment-card { min-width:0; padding:17px; border:1px solid var(--studio-border); border-top:4px solid var(--studio-accent); background:var(--studio-card); border-radius:12px; }
  .environment-staging { border-top-color:var(--vscode-inputValidation-warningBorder, #cca700); }
  .environment-production { border-top-color:var(--vscode-testing-iconPassed, #3fb950); }
  .environment-arrow { display:grid; place-items:center; color:var(--studio-muted); font-size:1.45rem; }
  .environment-topline { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
  .environment-topline h3 { margin:4px 0 0; font-size:1.2rem; }
  .environment-purpose { min-height:52px; color:var(--studio-muted); }
  .locked-field { display:grid; gap:5px; margin:0 0 12px; }
  .locked-field span { font-weight:600; font-size:.84rem; }
  .locked-field strong { min-height:18px; padding:8px 9px; border:1px dashed var(--studio-border); border-radius:6px; color:var(--studio-muted); text-transform:capitalize; }
  .readiness-pill, .guard-badge { border:1px solid var(--studio-border); border-radius:999px; padding:4px 8px; font-size:.74rem; font-weight:700; white-space:nowrap; }
  .readiness-pill.ready { border-color:var(--vscode-testing-iconPassed, #3fb950); color:var(--vscode-testing-iconPassed, #3fb950); }
  .readiness-pill.needs-setup { border-color:var(--vscode-inputValidation-warningBorder, #cca700); color:var(--vscode-inputValidation-warningForeground, #cca700); }
  .readiness-pill.blocked { border-color:var(--vscode-errorForeground, #f85149); color:var(--vscode-errorForeground, #f85149); }
  .guard-badge { display:inline-block; margin:0 0 10px; border-color:var(--vscode-testing-iconPassed, #3fb950); }
  .readiness-issues { margin:4px 0 0; padding-left:20px; color:var(--studio-muted); }
  .readiness-issues li { margin:4px 0; }
  .readiness-clear { margin:4px 0 0; color:var(--vscode-testing-iconPassed, #3fb950); font-size:.84rem; }
  .wireframe-topline { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .status-pill { border:1px solid var(--studio-border); border-radius:999px; padding:3px 8px; color:var(--studio-muted); font-size:.78rem; }
  .wireframe-sheet { min-height:210px; background:var(--vscode-editor-background); border:1px dashed var(--studio-border); border-radius:8px; padding:12px; margin:10px 0 14px; display:grid; gap:8px; grid-template-columns:repeat(6,1fr); }
  .wireframe-block { min-height:36px; border:1px solid var(--studio-border); background:color-mix(in srgb, var(--vscode-foreground) 5%, transparent); display:grid; place-items:center; padding:6px; color:var(--studio-muted); font-size:.75rem; text-align:center; }
  .block-1 { grid-column:1/-1; }
  .block-2 { grid-column:span 3; }
  .block-3 { grid-column:span 2; }
  .primary-choice { display:flex; gap:7px; align-items:center; font-weight:650; }
  .primary-choice input { width:auto; }
  .callout { border:1px solid var(--studio-border); border-left:4px solid var(--vscode-testing-iconPassed, #3fb950); padding:12px 14px; border-radius:0 8px 8px 0; margin:0 0 14px; color:var(--studio-muted); }
  .callout strong { color:var(--vscode-foreground); }
  .callout.warning { border-left-color:var(--vscode-inputValidation-warningBorder, #cca700); }
  code { background:var(--vscode-textCodeBlock-background); padding:2px 5px; border-radius:4px; }
  .token-preview { display:flex; align-items:center; gap:8px; margin-top:8px; }
  .token-preview span { width:28px; height:28px; border-radius:50%; border:1px solid var(--studio-border); }
  .empty-state { grid-column:1/-1; min-height:180px; display:grid; place-content:center; text-align:center; gap:5px; border:1px dashed var(--studio-border); border-radius:12px; color:var(--studio-muted); }
  .save-bar { position:fixed; bottom:0; left:0; right:0; z-index:10; display:flex; justify-content:space-between; align-items:center; gap:20px; padding:12px 22px; background:color-mix(in srgb, var(--vscode-editor-background) 94%, transparent); backdrop-filter:blur(12px); border-top:1px solid var(--studio-border); }
  .save-bar div { display:grid; }
  .save-bar span { color:var(--studio-muted); font-size:.82rem; }
  @media (max-width:1050px) {
    .metric-strip { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .studio-layout { grid-template-columns:1fr; }
    .studio-nav { position:static; display:flex; overflow:auto; padding-bottom:5px; }
    .nav-button { white-space:nowrap; }
    .nav-footer { display:none; }
    .import-card { grid-template-columns:1fr; }
    .environment-flow { grid-template-columns:1fr; }
    .environment-arrow { transform:rotate(90deg); min-height:28px; }
  }
  @media (max-width:760px) {
    body { padding-left:14px; padding-right:14px; }
    .studio-hero, .save-bar { align-items:flex-start; flex-direction:column; }
    .metric-strip, .two-column, .wireframe-grid, .platform-grid, .automation-grid { grid-template-columns:1fr; }
    .status-grid, .color-grid, .field-pair { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .metric-strip { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .save-bar button { width:100%; }
  }

  /* Interface Studio shell. The project and delivery forms above remain
     available in the secondary settings drawer; these rules establish the
     familiar builder grammar around the same lossless v1 workspace data. */
  * { box-sizing:border-box; }
  html, body { min-height:100%; }
  body { padding:0; overflow:hidden; background:var(--vscode-editor-background); }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .studio-toolbar { height:58px; display:grid; grid-template-columns:minmax(190px,1fr) auto minmax(280px,1fr); align-items:center; gap:18px; padding:0 14px; border-bottom:1px solid var(--studio-border); background:color-mix(in srgb,var(--vscode-editor-background) 96%,var(--vscode-foreground) 4%); }
  .project-identity { display:flex; align-items:center; gap:10px; min-width:0; }
  .project-identity > div { min-width:0; display:grid; }
  .project-identity strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.88rem; }
  .atlas-mark { width:30px; height:30px; display:grid; place-items:center; flex:0 0 30px; border-radius:8px; background:linear-gradient(145deg,var(--studio-accent),var(--vscode-charts-purple,#a371f7)); color:var(--vscode-button-foreground,#fff); font-weight:800; }
  .mode-tabs { display:flex; align-items:center; gap:2px; padding:3px; border:1px solid var(--studio-border); border-radius:8px; background:color-mix(in srgb,var(--vscode-editor-background) 78%,var(--vscode-foreground) 5%); }
  .mode-tab { min-height:28px; padding:3px 12px; border:0; background:transparent; color:var(--studio-muted); border-radius:6px; font-size:.78rem; }
  .mode-tab:hover { color:var(--vscode-foreground); background:var(--vscode-list-hoverBackground); }
  .mode-tab.active { color:var(--vscode-foreground); background:var(--vscode-editor-background); box-shadow:0 1px 4px rgba(0,0,0,.16); }
  .toolbar-actions { display:flex; justify-content:flex-end; align-items:center; gap:10px; min-width:0; }
  .preview-profiles { display:flex; padding:2px; border:1px solid var(--studio-border); border-radius:7px; }
  .profile-button { min-height:26px; display:flex; align-items:center; gap:5px; padding:2px 7px; border:0; border-radius:5px; color:var(--studio-muted); background:transparent; font-size:.72rem; }
  .profile-button.active { color:var(--vscode-foreground); background:var(--vscode-list-activeSelectionBackground); }
  .save-state { color:var(--studio-muted); font-size:.76rem; white-space:nowrap; }
  .save-state[data-save-state="dirty"] { color:var(--vscode-inputValidation-warningForeground,#cca700); }
  .save-state[data-save-state="saving"] { color:var(--vscode-progressBar-background,#0e70c0); }
  .save-state[data-save-state="saved"]::before { content:'✓ '; color:var(--vscode-testing-iconPassed,#3fb950); }
  .primary-action { padding-inline:15px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); }

  .notice { position:fixed; z-index:50; top:68px; left:50%; transform:translateX(-50%); max-width:min(620px,calc(100vw - 32px)); margin:0; background:var(--vscode-notifications-background,var(--vscode-editor-background)); box-shadow:0 8px 28px rgba(0,0,0,.24); }
  .interface-shell { height:calc(100vh - 58px); display:grid; grid-template-columns:48px minmax(210px,250px) minmax(360px,1fr) minmax(290px,340px); min-width:0; }
  .tool-rail { min-width:0; padding:7px 5px; display:flex; flex-direction:column; gap:4px; border-right:1px solid var(--studio-border); background:color-mix(in srgb,var(--vscode-sideBar-background,var(--vscode-editor-background)) 94%,var(--vscode-foreground) 6%); }
  .rail-button { width:38px; min-height:38px; padding:0; display:grid; place-items:center; border:0; border-radius:7px; background:transparent; color:var(--studio-muted); font-size:.78rem; }
  .rail-button:hover { color:var(--vscode-foreground); background:var(--vscode-list-hoverBackground); }
  .rail-button.active { color:var(--vscode-foreground); background:var(--vscode-list-activeSelectionBackground); box-shadow:inset 2px 0 var(--studio-accent); }
  .rail-button span { width:25px; height:25px; display:grid; place-items:center; border:1px solid currentColor; border-radius:6px; font-weight:800; }
  .rail-spacer { flex:1; }

  .builder-left-panel, .builder-right-panel { min-width:0; overflow:hidden; background:var(--vscode-sideBar-background,var(--vscode-editor-background)); }
  .builder-left-panel { border-right:1px solid var(--studio-border); }
  .left-panel-view { height:100%; display:none; flex-direction:column; overflow:auto; }
  .left-panel-view.active { display:flex; }
  .panel-heading, .pane-heading { min-height:58px; padding:12px 13px; display:flex; align-items:center; justify-content:space-between; gap:10px; border-bottom:1px solid var(--studio-border); }
  .panel-heading h2, .pane-heading h2 { margin:2px 0 0; font-size:.98rem; }
  .icon-button { min-width:30px; min-height:30px; padding:0; border:1px solid var(--studio-border); border-radius:7px; background:transparent; color:var(--vscode-foreground); font-size:1.1rem; }
  .surface-list { display:grid; gap:2px; padding:8px; }
  .surface-item { width:100%; min-height:48px; display:grid; grid-template-columns:26px minmax(0,1fr) 8px; align-items:center; gap:8px; padding:6px 8px; border:1px solid transparent; border-radius:7px; text-align:left; color:var(--vscode-foreground); background:transparent; }
  .surface-item:hover { background:var(--vscode-list-hoverBackground); }
  .surface-item.active { border-color:color-mix(in srgb,var(--studio-accent) 62%,transparent); background:color-mix(in srgb,var(--studio-accent) 13%,transparent); }
  .surface-item > span:nth-child(2) { min-width:0; display:grid; }
  .surface-item strong, .surface-item small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .surface-item small { color:var(--studio-muted); font-weight:400; }
  .surface-icon { width:24px; height:24px; display:grid; place-items:center; border:1px solid var(--studio-border); border-radius:5px; }
  .surface-status { width:7px; height:7px; border-radius:50%; background:var(--studio-muted); }
  .surface-status.approved { background:var(--vscode-testing-iconPassed,#3fb950); }
  .surface-status.review { background:var(--vscode-inputValidation-warningForeground,#cca700); }
  .surface-status.blocked { background:var(--vscode-errorForeground,#f85149); }
  .panel-link { margin:auto 8px 9px; min-height:32px; border:1px solid var(--studio-border); background:transparent; color:var(--vscode-foreground); }
  .layer-group { display:none; padding:8px; }
  .layer-group.active { display:block; }
  .layer-surface, .layer-node { width:100%; min-height:32px; display:flex; align-items:center; gap:7px; padding:4px 7px; border:0; border-radius:5px; background:transparent; color:var(--vscode-foreground); text-align:left; }
  .layer-node { padding-left:24px; color:var(--studio-muted); font-weight:500; }
  .layer-surface:hover, .layer-node:hover, .layer-node.active { background:var(--vscode-list-hoverBackground); color:var(--vscode-foreground); }
  .layer-empty { display:block; padding:8px 24px; color:var(--studio-muted); font-size:.8rem; }
  .library-list, .token-list { display:grid; gap:4px; padding:8px; }
  .library-item, .token-row { width:100%; min-height:42px; display:flex; align-items:center; gap:9px; padding:7px 8px; border:1px solid transparent; border-radius:7px; background:transparent; color:var(--vscode-foreground); text-align:left; }
  .library-item:hover, .token-row:hover { background:var(--vscode-list-hoverBackground); }
  .component-glyph, .token-type, .token-swatch { width:28px; height:28px; flex:0 0 28px; display:grid; place-items:center; border:1px solid var(--studio-border); border-radius:6px; }
  .token-row > span:last-child { min-width:0; display:grid; }
  .token-row small { color:var(--studio-muted); overflow:hidden; text-overflow:ellipsis; }
  .compact-empty { margin:12px; padding:18px 14px; display:grid; gap:5px; text-align:center; border:1px dashed var(--studio-border); border-radius:9px; color:var(--studio-muted); }
  .compact-empty strong { color:var(--vscode-foreground); }
  .language-note { margin:4px 10px; padding:10px; display:grid; border-radius:7px; background:color-mix(in srgb,var(--studio-accent) 8%,transparent); }
  .language-note span { color:var(--studio-muted); font-size:.76rem; }
  .history-list { list-style:none; margin:0; padding:12px; }
  .history-list li { display:flex; gap:9px; }
  .history-list li > div { display:grid; }
  .history-list small { color:var(--studio-muted); }
  .history-dot { width:9px; height:9px; margin-top:4px; border-radius:50%; background:var(--vscode-testing-iconPassed,#3fb950); box-shadow:0 0 0 4px color-mix(in srgb,var(--vscode-testing-iconPassed,#3fb950) 16%,transparent); }

  .canvas-region { min-width:0; display:grid; grid-template-rows:42px minmax(0,1fr); overflow:hidden; background:color-mix(in srgb,var(--vscode-editor-background) 90%,#7b8492 10%); }
  .canvas-toolbar { z-index:2; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:5px 12px; border-bottom:1px solid var(--studio-border); background:color-mix(in srgb,var(--vscode-editor-background) 96%,transparent); }
  .canvas-breadcrumb { display:flex; gap:7px; align-items:center; min-width:0; font-size:.76rem; }
  .canvas-breadcrumb span { color:var(--studio-muted); }
  .canvas-breadcrumb strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .canvas-controls { display:flex; align-items:center; gap:5px; color:var(--studio-muted); font-size:.72rem; }
  .canvas-control { min-height:25px; padding:2px 7px; border:1px solid var(--studio-border); border-radius:5px; background:transparent; color:var(--vscode-foreground); }
  .mode-canvas { display:none; min-width:0; min-height:0; overflow:auto; }
  .mode-canvas.active { display:block; }
  .builder-canvas { padding:34px 24px 110px; }
  .canvas-stage { min-width:0; min-height:100%; display:flex; justify-content:center; align-items:flex-start; --canvas-zoom:1; }
  .interface-frame { display:none; width:min(960px,calc(100% - 18px)); min-width:280px; overflow:hidden; border:1px solid color-mix(in srgb,var(--studio-border) 70%,#111 30%); border-radius:9px; background:var(--vscode-editor-background); box-shadow:0 14px 42px rgba(0,0,0,.24); transform:scale(var(--canvas-zoom)); transform-origin:top center; transition:width .2s ease,transform .15s ease; }
  .interface-frame.active { display:block; }
  .builder-canvas[data-preview-profile="tablet"] .interface-frame { width:min(720px,calc(100% - 18px)); }
  .builder-canvas[data-preview-profile="mobile"] .interface-frame { width:min(390px,calc(100% - 18px)); }
  .frame-chrome { height:32px; display:grid; grid-template-columns:80px 1fr auto; align-items:center; gap:8px; padding:0 9px; border-bottom:1px solid var(--studio-border); background:color-mix(in srgb,var(--vscode-editor-background) 90%,var(--vscode-foreground) 10%); color:var(--studio-muted); font-size:.68rem; }
  .frame-chrome > div { display:flex; gap:4px; }
  .frame-dot { width:7px; height:7px; border-radius:50%; background:var(--studio-muted); opacity:.55; }
  .frame-chrome > span { overflow:hidden; text-overflow:ellipsis; text-align:center; }
  .frame-select { min-height:22px; padding:1px 6px; border:0; background:transparent; color:var(--studio-muted); font-size:.68rem; }
  .surface-artboard { color:color-mix(in srgb,var(--vscode-foreground) 90%,#0f172a 10%); background:color-mix(in srgb,var(--vscode-editor-background) 96%,#fff 4%); }
  .preview-navigation { height:60px; display:flex; align-items:center; gap:18px; padding:0 clamp(18px,4vw,52px); border-bottom:1px solid color-mix(in srgb,var(--studio-border) 55%,transparent); font-size:clamp(.58rem,.9vw,.76rem); }
  .preview-navigation strong { font-size:clamp(.75rem,1.2vw,1rem); color:var(--studio-strong); }
  .preview-navigation i { flex:1; }
  .preview-navigation b { padding:7px 11px; border-radius:6px; background:var(--studio-primary); color:var(--vscode-button-foreground); font-weight:650; }
  .surface-node { position:relative; width:100%; min-height:130px; display:block; padding:clamp(26px,6vw,72px) clamp(20px,7vw,84px); border:0; border-radius:0; text-align:left; color:inherit; background:transparent; outline:1px solid transparent; outline-offset:-2px; }
  .surface-node:hover { outline-color:color-mix(in srgb,var(--studio-accent) 48%,transparent); }
  .surface-node.selected { outline:2px solid var(--studio-accent); outline-offset:-3px; }
  .node-label { position:absolute; z-index:2; top:5px; left:6px; display:none; padding:2px 5px; border-radius:3px; background:var(--studio-accent); color:var(--vscode-button-foreground); font-size:.55rem; }
  body[data-studio-mode="build"] .node-label, .surface-node.selected .node-label { display:block; }
  .node-content { position:relative; z-index:1; max-width:650px; display:grid; gap:10px; pointer-events:none; }
  .node-content > small { color:var(--studio-accent); text-transform:uppercase; letter-spacing:.11em; font-weight:750; font-size:clamp(.5rem,.8vw,.68rem); }
  .node-content > strong { max-width:620px; color:var(--studio-strong); font-size:clamp(1.25rem,3.2vw,2.8rem); line-height:1.04; letter-spacing:-.035em; }
  .node-content > span { max-width:570px; color:color-mix(in srgb,currentColor 72%,transparent); font-size:clamp(.65rem,1.25vw,.98rem); line-height:1.5; }
  .node-hero { min-height:330px; display:flex; align-items:center; background:linear-gradient(135deg,color-mix(in srgb,var(--studio-primary) 7%,transparent),transparent 62%); }
  .preview-actions { display:flex; gap:8px; margin-top:6px; font-style:normal; }
  .preview-actions b, .preview-actions em { padding:8px 12px; border-radius:6px; font-size:clamp(.55rem,.9vw,.75rem); font-style:normal; }
  .preview-actions b { background:var(--studio-primary); color:var(--vscode-button-foreground); }
  .preview-actions em { border:1px solid color-mix(in srgb,var(--studio-strong) 26%,transparent); }
  .node-split { min-height:260px; background:color-mix(in srgb,var(--studio-strong) 4%,transparent); }
  .node-split .node-content { width:48%; }
  .preview-media { position:absolute; left:115%; top:0; width:82%; height:150%; border-radius:9px; background:linear-gradient(145deg,color-mix(in srgb,var(--studio-accent) 24%,transparent),color-mix(in srgb,var(--studio-primary) 14%,transparent)); }
  .node-cards { text-align:center; }
  .node-cards .node-content { margin:auto; align-items:center; }
  .preview-card-row { width:min(520px,72vw); display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:12px; }
  .preview-card-row em { height:76px; border:1px solid color-mix(in srgb,var(--studio-border) 70%,transparent); border-radius:8px; background:color-mix(in srgb,var(--vscode-editor-background) 88%,var(--studio-primary) 12%); }
  .node-statement { text-align:center; background:var(--studio-strong); color:var(--vscode-button-foreground); }
  .node-statement .node-content { margin:auto; align-items:center; }
  .node-statement .node-content > strong, .node-statement .node-content > span { color:var(--vscode-button-foreground); }
  .preview-footer { min-height:86px; padding:20px clamp(18px,4vw,52px); display:flex; justify-content:space-between; align-items:center; gap:12px; border-top:1px solid color-mix(in srgb,var(--studio-border) 55%,transparent); color:var(--studio-muted); font-size:.65rem; }
  .empty-surface { width:calc(100% - 40px); min-height:150px; margin:20px; border:1px dashed var(--studio-border); background:transparent; color:var(--studio-muted); }
  .builder-canvas[data-preview-profile="mobile"] .preview-navigation > span, .builder-canvas[data-preview-profile="mobile"] .preview-navigation > i { display:none; }
  .builder-canvas[data-preview-profile="mobile"] .preview-navigation { padding-inline:18px; }
  .builder-canvas[data-preview-profile="mobile"] .preview-navigation b { margin-left:auto; }
  .builder-canvas[data-preview-profile="mobile"] .surface-node { padding:32px 22px; }
  .builder-canvas[data-preview-profile="mobile"] .node-split .node-content { width:100%; }
  .builder-canvas[data-preview-profile="mobile"] .preview-media { position:static; display:block; width:100%; height:120px; margin-top:12px; }
  .builder-canvas[data-preview-profile="mobile"] .preview-card-row { grid-template-columns:1fr; width:100%; }
  body[data-studio-mode="preview"] .surface-node { cursor:default; outline:0; }
  body[data-studio-mode="preview"] .node-label { display:none; }

  .plan-canvas { padding:34px; }
  body[data-studio-mode="plan"] .plan-canvas { display:block; }
  body[data-studio-mode="plan"] .builder-canvas { display:none; }
  .plan-summary { max-width:740px; margin:0 auto 32px; padding:24px; border:1px solid var(--studio-border); border-radius:12px; background:var(--studio-card); }
  .plan-summary h2 { margin:5px 0 8px; }
  .plan-summary p:not(.eyebrow) { color:var(--studio-muted); line-height:1.5; }
  .flow-map { display:flex; align-items:stretch; justify-content:center; flex-wrap:wrap; gap:9px; }
  .flow-card { width:170px; min-height:120px; display:grid; align-content:start; gap:7px; padding:13px; border:1px solid var(--studio-border); border-radius:9px; background:var(--studio-card); color:var(--vscode-foreground); text-align:left; }
  .flow-card small { color:var(--studio-muted); font-weight:400; line-height:1.35; }
  .flow-index { width:24px; height:24px; display:grid; place-items:center; border-radius:50%; background:color-mix(in srgb,var(--studio-accent) 18%,transparent); color:var(--studio-accent); }
  .flow-connector { align-self:center; color:var(--studio-muted); }

  .builder-right-panel { display:grid; grid-template-rows:minmax(260px,44%) minmax(300px,56%); border-left:1px solid var(--studio-border); }
  .inspector-pane, .assistant-pane { min-height:0; display:flex; flex-direction:column; overflow:hidden; }
  .inspector-pane { border-bottom:1px solid var(--studio-border); }
  .selection-kind, .assistant-status { padding:3px 7px; border:1px solid var(--studio-border); border-radius:999px; color:var(--studio-muted); font-size:.66rem; white-space:nowrap; }
  .assistant-status { border-color:color-mix(in srgb,var(--vscode-testing-iconPassed,#3fb950) 55%,transparent); color:var(--vscode-testing-iconPassed,#3fb950); }
  .selection-path { padding:8px 13px; border-bottom:1px solid var(--studio-border); color:var(--studio-muted); font-size:.68rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .inspector-form { padding:12px; overflow:auto; }
  .inspector-form .field { margin-bottom:10px; }
  .inspector-form input, .inspector-form textarea { padding:7px 8px; }
  .inspector-row { display:flex; justify-content:space-between; gap:10px; padding:9px 0; border-top:1px solid var(--studio-border); font-size:.73rem; }
  .inspector-row span { color:var(--studio-muted); }
  .segmented-field { display:grid; gap:6px; margin-bottom:11px; }
  .segmented-field > span { font-size:.76rem; font-weight:650; }
  .segmented-field > div { display:grid; grid-template-columns:repeat(3,1fr); }
  .segmented-field button { min-height:28px; border:1px solid var(--studio-border); border-radius:0; background:transparent; color:var(--studio-muted); font-size:.68rem; }
  .segmented-field button:first-child { border-radius:5px 0 0 5px; }
  .segmented-field button:last-child { border-radius:0 5px 5px 0; }
  .segmented-field button.active { color:var(--vscode-foreground); background:var(--vscode-list-activeSelectionBackground); }
  .inspector-hint { color:var(--studio-muted); font-size:.7rem; line-height:1.45; }
  .chat-context { display:flex; gap:5px; padding:8px 10px; overflow:auto; border-bottom:1px solid var(--studio-border); }
  .context-chip { flex:0 0 auto; padding:3px 7px; border-radius:999px; background:color-mix(in srgb,var(--studio-accent) 14%,transparent); color:var(--vscode-foreground); font-size:.66rem; }
  .context-chip.subtle { background:color-mix(in srgb,var(--vscode-foreground) 7%,transparent); color:var(--studio-muted); }
  .chat-thread { flex:1; min-height:54px; padding:10px; overflow:auto; }
  .atlas-message, .user-message { max-width:92%; padding:8px 10px; border-radius:9px; font-size:.73rem; line-height:1.42; }
  .atlas-message { background:color-mix(in srgb,var(--studio-accent) 10%,transparent); }
  .user-message { margin-left:auto; background:var(--vscode-list-activeSelectionBackground); }
  .proposal-card { margin:0 10px 8px; padding:10px; border:1px solid color-mix(in srgb,var(--studio-accent) 50%,var(--studio-border)); border-radius:8px; background:color-mix(in srgb,var(--studio-accent) 7%,transparent); }
  .proposal-card strong { display:block; margin:4px 0 9px; font-size:.74rem; }
  .proposal-actions { display:flex; gap:6px; }
  .proposal-actions button { min-height:28px; font-size:.68rem; }
  .chat-composer { margin:0 9px 9px; padding:7px; border:1px solid var(--studio-border); border-radius:9px; background:var(--vscode-input-background); }
  .chat-composer:focus-within { border-color:var(--vscode-focusBorder); }
  .chat-composer textarea { min-height:54px; padding:2px; border:0; background:transparent; resize:none; }
  .chat-composer textarea:focus { outline:0; }
  .composer-footer { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .composer-footer small { color:var(--studio-muted); font-size:.61rem; }
  .composer-footer button { min-height:27px; font-size:.68rem; }

  .settings-drawer { position:fixed; z-index:40; inset:58px 0 0; display:flex; justify-content:flex-end; }
  .settings-drawer[hidden] { display:none; }
  .drawer-backdrop { position:absolute; inset:0; width:100%; height:100%; border:0; border-radius:0; background:rgba(0,0,0,.48); }
  .drawer-panel { position:relative; width:min(1160px,94vw); height:100%; display:grid; grid-template-rows:auto auto minmax(0,1fr) auto; background:var(--vscode-editor-background); box-shadow:-18px 0 46px rgba(0,0,0,.28); }
  .drawer-header { min-height:64px; display:flex; justify-content:space-between; align-items:center; gap:16px; padding:10px 18px; border-bottom:1px solid var(--studio-border); }
  .drawer-header h2 { margin:3px 0 0; font-size:1.12rem; }
  .settings-tabs { display:flex; gap:3px; padding:7px 13px; overflow:auto; border-bottom:1px solid var(--studio-border); }
  .settings-tabs .nav-button { flex:0 0 auto; min-height:32px; padding:4px 9px; border-radius:6px; }
  .settings-tabs .nav-button span { width:20px; height:20px; font-size:.67rem; }
  .settings-content { min-height:0; overflow:auto; padding:0 18px 32px; }
  .settings-content .studio-page { padding-top:16px; }
  .drawer-footer { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:9px 14px; border-top:1px solid var(--studio-border); background:color-mix(in srgb,var(--vscode-editor-background) 95%,transparent); }
  .drawer-footer > span { color:var(--studio-muted); font-size:.72rem; text-align:right; }
  .drawer-links { display:flex; gap:6px; flex-wrap:wrap; }

  @media (max-width:1180px) {
    .studio-toolbar { grid-template-columns:minmax(150px,1fr) auto minmax(190px,1fr); gap:9px; }
    .profile-label, .save-state { display:none; }
    .interface-shell { grid-template-columns:44px 210px minmax(340px,1fr) 290px; }
  }
  @media (max-width:920px) {
    body { overflow:auto; }
    .studio-toolbar { position:sticky; top:0; z-index:20; height:auto; min-height:58px; grid-template-columns:1fr auto; }
    .mode-tabs { order:3; grid-column:1/-1; justify-self:center; margin-bottom:6px; }
    .interface-shell { height:auto; min-height:calc(100vh - 96px); grid-template-columns:44px 190px minmax(340px,1fr); }
    .builder-right-panel { grid-column:2/-1; min-height:520px; grid-template-columns:1fr 1fr; grid-template-rows:1fr; border-top:1px solid var(--studio-border); border-left:0; }
    .inspector-pane { border-right:1px solid var(--studio-border); border-bottom:0; }
    .tool-rail { grid-row:1/3; }
  }
  @media (max-width:680px) {
    .project-identity .eyebrow, .preview-profiles { display:none; }
    .toolbar-actions { gap:5px; }
    .interface-shell { grid-template-columns:42px minmax(0,1fr); }
    .builder-left-panel { grid-column:2; max-height:280px; border-bottom:1px solid var(--studio-border); }
    .canvas-region { grid-column:2; min-height:620px; }
    .builder-right-panel { grid-column:2; display:grid; grid-template-columns:1fr; min-height:760px; }
    .tool-rail { grid-row:1/4; }
    .drawer-panel { width:100vw; }
    .drawer-footer { align-items:flex-start; flex-direction:column; }
    .drawer-footer > span { text-align:left; }
  }
`;

const WEBSITE_STUDIO_SCRIPT = `
  ${PANEL_NAV_JS}
  const vscode = acquireVsCodeApi();
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const value = (selector, root = document) => qs(selector, root)?.value?.trim() ?? '';
  const lines = input => input.split(/\\r?\\n/).map(item => item.trim()).filter(Boolean);
  const makeId = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const persistedState = vscode.getState() ?? {};
  const firstSurfaceId = qs('[data-select-surface]')?.dataset.selectSurface ?? '';
  const studioState = {
    mode: ['plan','design','build','preview'].includes(persistedState.mode) ? persistedState.mode : 'design',
    previewProfile: ['desktop','tablet','mobile'].includes(persistedState.previewProfile) ? persistedState.previewProfile : 'desktop',
    toolPanel: ['surfaces','layers','components','assets','visual-language','history'].includes(persistedState.toolPanel) ? persistedState.toolPanel : 'surfaces',
    selectedSurfaceId: persistedState.selectedSurfaceId || firstSurfaceId,
    selectedNodeId: persistedState.selectedNodeId || '',
    zoom: typeof persistedState.zoom === 'number' ? Math.min(1.4, Math.max(.55, persistedState.zoom)) : 1,
  };
  let draftRevision = Number(qs('#saveState')?.dataset.initialRevision || 0);
  let draftPersistTimer;
  let settingsOpener;

  function persistState() {
    vscode.setState({ ...studioState });
  }

  function setSaveState(state) {
    const element = qs('#saveState');
    if (!element) return;
    element.dataset.saveState = state;
    element.textContent = state === 'dirty' ? 'Unsaved changes' : state === 'saving' ? 'Saving…' : 'Saved';
    const draftChip = qs('[data-chat-draft]');
    if (draftChip) draftChip.textContent = state === 'dirty' ? 'Unsaved draft' : state === 'saving' ? 'Saving draft' : 'Saved draft';
  }

  function markDirty() {
    draftRevision += 1;
    setSaveState('dirty');
    if (draftPersistTimer) clearTimeout(draftPersistTimer);
    draftPersistTimer = setTimeout(persistDraftNow, 250);
  }

  function persistDraftNow() {
    if (draftPersistTimer) clearTimeout(draftPersistTimer);
    draftPersistTimer = undefined;
    vscode.postMessage({
      type: 'storeDraft',
      payload: { config: collectConfig(), revision: draftRevision },
    });
  }

  function setMode(mode) {
    if (!['plan','design','build','preview'].includes(mode)) return;
    studioState.mode = mode;
    document.body.dataset.studioMode = mode;
    qsa('[data-studio-mode]').forEach(button => {
      const active = button.dataset.studioMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    qs('[data-mode-canvas="plan"]')?.classList.toggle('active', mode === 'plan');
    qs('[data-mode-canvas="builder"]')?.classList.toggle('active', mode !== 'plan');
    persistState();
  }

  function setPreviewProfile(profile) {
    if (!['desktop','tablet','mobile'].includes(profile)) return;
    studioState.previewProfile = profile;
    const canvas = qs('[data-mode-canvas="builder"]');
    if (canvas) canvas.dataset.previewProfile = profile;
    qsa('.profile-button[data-preview-profile]').forEach(button => {
      const active = button.dataset.previewProfile === profile;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const chip = qs('[data-chat-profile]');
    if (chip) chip.textContent = profile.charAt(0).toUpperCase() + profile.slice(1);
    persistState();
  }

  function setToolPanel(panel) {
    studioState.toolPanel = panel;
    qsa('[data-tool-panel]').forEach(button => {
      const active = button.dataset.toolPanel === panel;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    qsa('[data-left-panel]').forEach(view => view.classList.toggle('active', view.dataset.leftPanel === panel));
    persistState();
  }

  function findSurfaceRow(surfaceId) {
    return qsa('#sitemapRows tr[data-page-id]').find(row => row.dataset.pageId === surfaceId);
  }

  function findSurfaceCard(surfaceId) {
    return qsa('#wireframeCards [data-page-id]').find(card => card.dataset.pageId === surfaceId);
  }

  function surfaceDraft(surfaceId) {
    const row = findSurfaceRow(surfaceId);
    const card = findSurfaceCard(surfaceId);
    if (!row) return undefined;
    return {
      id: surfaceId,
      title: value('.page-title', row) || 'Untitled surface',
      slug: value('.page-slug', row) || '/surface',
      purpose: value('.page-purpose', row),
      sections: card ? lines(value('.page-sections', card)) : [],
    };
  }

  function selectionLabel() {
    const surface = surfaceDraft(studioState.selectedSurfaceId);
    if (!surface) return 'No surface';
    if (!studioState.selectedNodeId) return surface.title;
    const selected = qsa('[data-select-node]').find(node =>
      node.dataset.selectNode === studioState.selectedNodeId
      && node.dataset.surfaceId === studioState.selectedSurfaceId);
    const index = Number(selected?.dataset.nodeIndex);
    return surface.sections[index] || surface.title;
  }

  function syncSelectionContext() {
    const surface = surfaceDraft(studioState.selectedSurfaceId);
    const label = selectionLabel();
    document.body.dataset.selectionId = studioState.selectedNodeId || studioState.selectedSurfaceId;
    const title = qs('#inspectorTitle');
    if (title) title.textContent = label;
    const kind = qs('#selectionKind');
    if (kind) kind.textContent = studioState.selectedNodeId ? 'Node' : 'Surface';
    const path = qs('#selectionPath');
    if (path) path.textContent = (surface?.title || 'No surface') + (studioState.selectedNodeId ? ' / ' + label : '');
    const breadcrumb = qs('#canvasBreadcrumb strong');
    if (breadcrumb) breadcrumb.textContent = surface?.title || 'No surface';
    const chatSelection = qs('[data-chat-selection]');
    if (chatSelection) chatSelection.textContent = label;

    const surfaceInspector = qs('#surfaceInspector');
    const nodeInspector = qs('#nodeInspector');
    if (surfaceInspector) surfaceInspector.hidden = Boolean(studioState.selectedNodeId);
    if (nodeInspector) nodeInspector.hidden = !studioState.selectedNodeId;
    if (!studioState.selectedNodeId && surface) {
      const titleInput = qs('#inspectorSurfaceTitle');
      const slugInput = qs('#inspectorSurfaceSlug');
      const purposeInput = qs('#inspectorSurfacePurpose');
      if (titleInput) titleInput.value = surface.title;
      if (slugInput) slugInput.value = surface.slug;
      if (purposeInput) purposeInput.value = surface.purpose;
    } else if (studioState.selectedNodeId) {
      const nodeInput = qs('#inspectorNodeName');
      if (nodeInput) nodeInput.value = label;
    }
  }

  function selectSurface(surfaceId, preserveNode = false) {
    if (!surfaceId || !findSurfaceRow(surfaceId)) return;
    studioState.selectedSurfaceId = surfaceId;
    if (!preserveNode) studioState.selectedNodeId = '';
    qsa('[data-surface-frame]').forEach(frame => frame.classList.toggle('active', frame.dataset.surfaceFrame === surfaceId));
    qsa('[data-layer-surface]').forEach(group => group.classList.toggle('active', group.dataset.layerSurface === surfaceId));
    qsa('.surface-item[data-select-surface]').forEach(button => {
      const active = button.dataset.selectSurface === surfaceId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (!preserveNode) {
      qsa('[data-select-node]').forEach(node => {
        node.classList.remove('active','selected');
        node.setAttribute('aria-selected', 'false');
      });
    }
    syncSelectionContext();
    persistState();
  }

  function selectNode(nodeId, surfaceId) {
    if (!nodeId || !surfaceId) return;
    studioState.selectedNodeId = nodeId;
    selectSurface(surfaceId, true);
    qsa('[data-select-node]').forEach(node => {
      const active = node.dataset.selectNode === nodeId;
      node.classList.toggle('active', active);
      node.classList.toggle('selected', active);
      node.setAttribute('aria-selected', String(active));
    });
    syncSelectionContext();
    persistState();
  }

  function setZoom(next) {
    studioState.zoom = Math.min(1.4, Math.max(.55, next));
    const stage = qs('#canvasStage');
    if (stage) stage.style.setProperty('--canvas-zoom', String(studioState.zoom));
    const label = qs('#zoomLabel');
    if (label) label.textContent = Math.round(studioState.zoom * 100) + '%';
    persistState();
  }

  function openSettings(pageId = 'brief') {
    const drawer = qs('#projectSettingsDrawer');
    if (!drawer) return;
    const wasHidden = drawer.hidden;
    if (wasHidden) {
      settingsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      drawer.hidden = false;
      const shell = qs('.interface-shell');
      const toolbar = qs('.studio-toolbar');
      if (shell) shell.inert = true;
      if (toolbar) toolbar.inert = true;
    }
    showPage(pageId);
    if (wasHidden) qs('.drawer-header [data-close-settings]', drawer)?.focus();
  }

  function closeSettings() {
    const drawer = qs('#projectSettingsDrawer');
    if (drawer) drawer.hidden = true;
    const shell = qs('.interface-shell');
    const toolbar = qs('.studio-toolbar');
    if (shell) shell.inert = false;
    if (toolbar) toolbar.inert = false;
    settingsOpener?.focus();
    settingsOpener = undefined;
  }

  function elementsForSurface(surfaceId) {
    return qsa('[data-select-surface]').filter(element => element.dataset.selectSurface === surfaceId);
  }

  function updateSurfacePresentation(surfaceId) {
    const surface = surfaceDraft(surfaceId);
    if (!surface) return;
    elementsForSurface(surfaceId).forEach(element => {
      if (element.classList.contains('surface-item')) {
        const title = qs('strong', element);
        const slug = qs('small', element);
        if (title) title.textContent = surface.title;
        if (slug) slug.textContent = surface.slug;
      }
      if (element.classList.contains('layer-surface')) {
        const title = qs('strong', element);
        if (title) title.textContent = surface.title;
      }
      if (element.classList.contains('flow-card')) {
        const title = qs('strong', element);
        const detail = qs('small', element);
        if (title) title.textContent = surface.title;
        if (detail) detail.textContent = surface.purpose || surface.slug;
      }
      if (element.classList.contains('frame-select')) element.textContent = surface.title;
    });
    const frame = qsa('[data-surface-frame]').find(element => element.dataset.surfaceFrame === surfaceId);
    if (frame) {
      const route = qs('.frame-chrome > span', frame);
      const navigationTitle = qs('.preview-navigation strong', frame);
      const footerTitle = qs('.preview-footer strong', frame);
      const heroDescription = qs('.surface-node[data-node-index="0"] .node-content > span', frame);
      if (route) route.textContent = surface.slug;
      if (navigationTitle) navigationTitle.textContent = surface.title;
      if (footerTitle) footerTitle.textContent = surface.title;
      if (heroDescription) heroDescription.textContent = surface.purpose;
    }
    syncSelectionContext();
  }

  function updateNodePresentation(nodeId, surfaceId, index, label) {
    const replacementId = nodeId.startsWith('interface-node-')
      ? makeId('draft-node-' + surfaceId)
      : nodeId;
    qsa('[data-select-node]').filter(element => element.dataset.selectNode === nodeId).forEach(element => {
      element.dataset.selectNode = replacementId;
      element.dataset.selectionId = replacementId;
      element.dataset.nodeLabel = label;
      if (element.classList.contains('layer-node')) {
        const glyph = qs('span', element)?.outerHTML ?? '<span aria-hidden="true">□</span>';
        element.innerHTML = glyph;
        element.append(document.createTextNode(label));
      }
      if (element.classList.contains('surface-node')) {
        const nodeLabel = qs('.node-label', element);
        const heading = qs('.node-content > strong', element);
        if (nodeLabel) nodeLabel.textContent = label;
        if (heading) heading.textContent = label;
      }
    });
    const card = findSurfaceCard(surfaceId);
    const sections = card ? lines(value('.page-sections', card)) : [];
    sections[index] = label;
    const source = card ? qs('.page-sections', card) : undefined;
    if (source) source.value = sections.filter(Boolean).join('\\n');
    studioState.selectedNodeId = replacementId;
    syncSelectionContext();
    persistState();
  }

  function escapeMarkup(input) {
    return String(input ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function clientNode(surface, section, index, nodeId) {
    const type = index === 0 ? 'hero' : index % 3 === 1 ? 'split' : index % 3 === 2 ? 'cards' : 'statement';
    return '<button type="button" class="surface-node node-' + type + '" data-select-node="' + escapeMarkup(nodeId) + '" data-node-label="' + escapeMarkup(section) + '" data-node-index="' + index + '" data-surface-id="' + escapeMarkup(surface.id) + '" data-selection-id="' + escapeMarkup(nodeId) + '" aria-selected="false">' +
      '<span class="node-label">' + escapeMarkup(section) + '</span><span class="node-content"><small>Reusable interface region</small><strong>' + escapeMarkup(section) + '</strong><span>A semantic region translated by the selected renderer adapter.</span></span></button>';
  }

  function appendSurfaceToBuilder(surface) {
    const safeId = escapeMarkup(surface.id);
    const nodeRecords = surface.sections.map((section, index) => ({
      section,
      index,
      id: makeId('draft-node-' + surface.id),
    }));
    qs('#surfaceList')?.insertAdjacentHTML('beforeend', '<button type="button" role="treeitem" class="surface-item" data-select-surface="' + safeId + '" data-selection-id="' + safeId + '" aria-selected="false"><span class="surface-icon" aria-hidden="true">□</span><span><strong>' + escapeMarkup(surface.title) + '</strong><small>' + escapeMarkup(surface.slug) + '</small></span><span class="surface-status not-started"></span></button>');
    qs('#layerGroups')?.insertAdjacentHTML('beforeend', '<div class="layer-group" data-layer-surface="' + safeId + '"><button type="button" class="layer-surface" data-select-surface="' + safeId + '" data-selection-id="' + safeId + '"><span aria-hidden="true">▾</span><strong>' + escapeMarkup(surface.title) + '</strong></button><div class="layer-children" role="tree" aria-label="' + escapeMarkup(surface.title) + ' layers">' + nodeRecords.map(node => '<button type="button" role="treeitem" class="layer-node" data-select-node="' + escapeMarkup(node.id) + '" data-node-label="' + escapeMarkup(node.section) + '" data-node-index="' + node.index + '" data-surface-id="' + safeId + '" data-selection-id="' + escapeMarkup(node.id) + '" aria-selected="false"><span aria-hidden="true">□</span>' + escapeMarkup(node.section) + '</button>').join('') + '</div></div>');
    qs('#canvasStage')?.insertAdjacentHTML('beforeend', '<article class="interface-frame" data-surface-frame="' + safeId + '" data-selection-id="' + safeId + '"><header class="frame-chrome"><div><span class="frame-dot"></span><span class="frame-dot"></span><span class="frame-dot"></span></div><span>' + escapeMarkup(surface.slug) + '</span><button type="button" class="frame-select" data-select-surface="' + safeId + '">' + escapeMarkup(surface.title) + '</button></header><div class="surface-artboard" data-select-surface="' + safeId + '"><nav class="preview-navigation"><strong>' + escapeMarkup(surface.title) + '</strong><span>Overview</span><span>Work</span><span>About</span><i></i><b>Get started</b></nav>' + nodeRecords.map(node => clientNode(surface, node.section, node.index, node.id)).join('') + '<footer class="preview-footer"><strong>' + escapeMarkup(surface.title) + '</strong><span>Visual language applied across targets</span></footer></div></article>');
    const flowMap = qs('.flow-map');
    if (flowMap) {
      if (qsa('.flow-card', flowMap).length > 0) flowMap.insertAdjacentHTML('beforeend', '<span class="flow-connector" aria-hidden="true">→</span>');
      flowMap.insertAdjacentHTML('beforeend', '<button type="button" class="flow-card" data-select-surface="' + safeId + '" data-selection-id="' + safeId + '"><span class="flow-index">' + (qsa('.flow-card', flowMap).length + 1) + '</span><strong>' + escapeMarkup(surface.title) + '</strong><small>' + escapeMarkup(surface.purpose || surface.slug) + '</small></button>');
    }
  }

  function removeSurfaceFromBuilder(surfaceId) {
    const removedItem = qsa('.surface-item[data-select-surface]').find(element =>
      element.dataset.selectSurface === surfaceId);
    const fallbackId = removedItem?.nextElementSibling?.dataset.selectSurface
      || removedItem?.previousElementSibling?.dataset.selectSurface
      || '';
    const removedSelection = studioState.selectedSurfaceId === surfaceId;
    qsa('[data-surface-frame]').filter(element => element.dataset.surfaceFrame === surfaceId).forEach(element => element.remove());
    qsa('[data-layer-surface]').filter(element => element.dataset.layerSurface === surfaceId).forEach(element => element.remove());
    qsa('.surface-item[data-select-surface]').filter(element => element.dataset.selectSurface === surfaceId).forEach(element => element.remove());
    qsa('.flow-card[data-select-surface]').filter(element => element.dataset.selectSurface === surfaceId).forEach(element => {
      const previous = element.previousElementSibling;
      const next = element.nextElementSibling;
      if (previous?.classList.contains('flow-connector')) previous.remove();
      else if (next?.classList.contains('flow-connector')) next.remove();
      element.remove();
    });
    qsa('.flow-card .flow-index').forEach((indexLabel, index) => {
      indexLabel.textContent = String(index + 1);
    });
    if (removedSelection && fallbackId) {
      selectSurface(fallbackId);
      qsa('.surface-item[data-select-surface]').find(element =>
        element.dataset.selectSurface === fallbackId)?.focus();
    } else {
      syncSelectionContext();
      qs('#addWebsitePage')?.focus();
    }
  }

  function rebuildSurfaceNodes(surfaceId) {
    const surface = surfaceDraft(surfaceId);
    if (!surface) return;
    const group = qsa('[data-layer-surface]').find(element => element.dataset.layerSurface === surfaceId);
    const children = group ? qs('.layer-children', group) : undefined;
    const reusableIds = new Map();
    if (children) {
      qsa('.layer-node[data-select-node]', children).forEach(node => {
        const label = node.dataset.nodeLabel || '';
        const ids = reusableIds.get(label) || [];
        ids.push(node.dataset.selectNode);
        reusableIds.set(label, ids);
      });
    }
    const nodeRecords = surface.sections.map((section, index) => {
      const ids = reusableIds.get(section) || [];
      const id = ids.shift() || makeId('draft-node-' + surface.id);
      reusableIds.set(section, ids);
      return { section, index, id };
    });
    if (children) {
      children.innerHTML = nodeRecords.map(node =>
        '<button type="button" role="treeitem" class="layer-node" data-select-node="' + escapeMarkup(node.id) + '" data-node-label="' + escapeMarkup(node.section) + '" data-node-index="' + node.index + '" data-surface-id="' + escapeMarkup(surface.id) + '" data-selection-id="' + escapeMarkup(node.id) + '" aria-selected="false"><span aria-hidden="true">□</span>' + escapeMarkup(node.section) + '</button>').join('') || '<span class="layer-empty">No nodes yet</span>';
    }
    const frame = qsa('[data-surface-frame]').find(element => element.dataset.surfaceFrame === surfaceId);
    const artboard = frame ? qs('.surface-artboard', frame) : undefined;
    const footer = artboard ? qs('.preview-footer', artboard) : undefined;
    if (artboard && footer) {
      qsa('.surface-node', artboard).forEach(node => node.remove());
      footer.insertAdjacentHTML('beforebegin', nodeRecords.map(node =>
        clientNode(surface, node.section, node.index, node.id)).join(''));
    }
    const selected = qsa('[data-select-node]').find(node =>
      node.dataset.selectNode === studioState.selectedNodeId
      && node.dataset.surfaceId === surfaceId);
    if (selected) selectNode(studioState.selectedNodeId, surfaceId);
    else if (studioState.selectedSurfaceId === surfaceId) selectSurface(surfaceId);
  }

  function showPage(pageId) {
    settingsNav.activate(pageId);
  }

  function notice(message, tone = '') {
    const element = qs('#studioNotice');
    element.textContent = message;
    element.className = 'notice visible ' + tone;
  }

  function statusOptions(selected = 'not-started') {
    return [['not-started','Not started'],['draft','Draft'],['review','In review'],['approved','Approved'],['blocked','Blocked']]
      .map(([id,label]) => '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + label + '</option>').join('');
  }

  function sitemapRow(pageOrId) {
    const page = typeof pageOrId === 'string'
      ? { id: pageOrId, title: 'New page', slug: '/new-page', purpose: '', template: 'Standard page' }
      : pageOrId;
    const id = escapeMarkup(page.id);
    return '<tr data-page-id="' + id + '">' +
      '<td><input class="page-title" maxlength="160" aria-label="Page title" value="' + escapeMarkup(page.title) + '" /></td>' +
      '<td><input class="page-slug" maxlength="240" aria-label="Page slug" value="' + escapeMarkup(page.slug) + '" /></td>' +
      '<td><textarea class="page-purpose" maxlength="2000" aria-label="Page purpose" rows="2">' + escapeMarkup(page.purpose) + '</textarea></td>' +
      '<td><input class="page-template" maxlength="160" aria-label="Page template" value="' + escapeMarkup(page.template) + '" /></td>' +
      '<td><button type="button" class="danger subtle remove-page" data-remove-id="' + id + '">Remove</button></td></tr>';
  }

  function wireframeCard(pageOrId) {
    const page = typeof pageOrId === 'string'
      ? { id: pageOrId, title: 'New page', slug: '/new-page', sections: [], wireframeNotes: '', designNotes: '', wireframeStatus: 'not-started', designStatus: 'not-started', contentStatus: 'not-started', seoStatus: 'not-started' }
      : pageOrId;
    const id = escapeMarkup(page.id);
    const sections = Array.isArray(page.sections) ? page.sections : [];
    const outline = (sections.length > 0 ? sections : ['Section not mapped']).slice(0, 8).map((section, index) =>
      '<div class="wireframe-block block-' + ((index % 3) + 1) + '"><span>' + escapeMarkup(section) + '</span></div>').join('');
    return '<article class="wireframe-card" data-page-id="' + id + '">' +
      '<div class="wireframe-topline"><div><p class="eyebrow">' + escapeMarkup(page.slug) + '</p><h2>' + escapeMarkup(page.title) + '</h2></div><span class="status-pill">' + escapeMarkup(page.designStatus) + '</span></div>' +
      '<div class="wireframe-sheet">' + outline + '</div>' +
      '<label class="field"><span>Page sections</span><textarea class="page-sections" maxlength="8000" rows="4" placeholder="One section per line">' + escapeMarkup(sections.join('\\n')) + '</textarea></label>' +
      '<label class="field"><span>Wireframe notes</span><textarea class="page-wireframeNotes" maxlength="8000" rows="4">' + escapeMarkup(page.wireframeNotes) + '</textarea></label>' +
      '<label class="field"><span>Visual design notes</span><textarea class="page-designNotes" maxlength="8000" rows="4">' + escapeMarkup(page.designNotes) + '</textarea></label>' +
      '<div class="status-grid">' +
      ['page-wireframeStatus','page-designStatus','page-contentStatus','page-seoStatus'].map((className, index) =>
        '<label class="field"><span>' + ['Wireframe','UI design','Content','SEO'][index] + '</span><select class="' + className + '">' + statusOptions([page.wireframeStatus,page.designStatus,page.contentStatus,page.seoStatus][index]) + '</select></label>').join('') +
      '</div></article>';
  }

  function automationCard(automationOrId) {
    const automation = typeof automationOrId === 'string'
      ? { id: automationOrId, name: 'New automation', event: '', outcome: '', status: 'idea', n8nWorkflowId: '', instanceUrl: '', credentialReference: '', dataNotes: '' }
      : automationOrId;
    const id = escapeMarkup(automation.id);
    const automationStatuses = [['idea','Idea'],['mapped','Mapped'],['configured','Configured'],['verified','Verified'],['paused','Paused']];
    return '<article class="automation-card" data-automation-id="' + id + '">' +
      '<div class="card-heading"><p class="eyebrow">n8n workflow</p><button type="button" class="danger subtle remove-automation" data-remove-automation="' + id + '">Remove</button></div>' +
      '<label class="field"><span>Workflow name</span><input maxlength="160" class="automation-name" value="' + escapeMarkup(automation.name) + '" /></label>' +
      '<label class="field"><span>Event / trigger</span><input maxlength="500" class="automation-event" value="' + escapeMarkup(automation.event) + '" /></label>' +
      '<label class="field"><span>Expected outcome</span><textarea maxlength="1000" class="automation-outcome" rows="4">' + escapeMarkup(automation.outcome) + '</textarea></label>' +
      '<label class="field"><span>Status</span><select class="automation-status">' + automationStatuses.map(([status, label]) => '<option value="' + status + '"' + (status === automation.status ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
      '<div class="field-pair"><label class="field"><span>n8n workflow ID</span><input maxlength="200" class="automation-workflowId" value="' + escapeMarkup(automation.n8nWorkflowId || '') + '" /></label><label class="field"><span>n8n instance URL</span><input maxlength="4000" class="automation-instanceUrl" value="' + escapeMarkup(automation.instanceUrl || '') + '" placeholder="https://n8n.example.com/" /></label></div>' +
      '<label class="field"><span>Credential reference</span><input maxlength="240" class="automation-credentialReference" value="' + escapeMarkup(automation.credentialReference || '') + '" placeholder="env:N8N_WORKFLOW_URL" /></label>' +
      '<label class="field"><span>Data and privacy notes</span><textarea maxlength="2000" class="automation-dataNotes" rows="4">' + escapeMarkup(automation.dataNotes) + '</textarea></label></article>';
  }

  function collectConfig() {
    const pageBasics = new Map(qsa('#sitemapRows tr[data-page-id]').map(row => [row.dataset.pageId, {
      id: row.dataset.pageId,
      title: value('.page-title', row),
      slug: value('.page-slug', row),
      purpose: value('.page-purpose', row),
      template: value('.page-template', row),
    }]));
    const pages = qsa('#wireframeCards [data-page-id]').map(card => ({
      ...(pageBasics.get(card.dataset.pageId) ?? { id: card.dataset.pageId, title: 'Page', slug: '/page', purpose: '', template: 'Standard page' }),
      sections: lines(value('.page-sections', card)),
      wireframeNotes: value('.page-wireframeNotes', card),
      designNotes: value('.page-designNotes', card),
      wireframeStatus: value('.page-wireframeStatus', card),
      designStatus: value('.page-designStatus', card),
      contentStatus: value('.page-contentStatus', card),
      seoStatus: value('.page-seoStatus', card),
    }));
    const platforms = qsa('[data-platform-id]').map(card => ({
      id: card.dataset.platformId,
      label: qs('h2', card)?.textContent ?? card.dataset.platformId,
      primary: qs('input[name="primaryPlatform"]', card)?.checked === true,
      status: value('.platform-status', card),
      siteUrl: value('.platform-siteUrl', card),
      projectReference: value('.platform-projectReference', card),
      environmentReference: value('.platform-environmentReference', card),
      notes: value('.platform-notes', card),
    }));
    const hostingEnvironments = qsa('[data-environment-id]').map(card => ({
      id: card.dataset.environmentId,
      hostingMode: value('.environment-hostingMode', card) || card.dataset.hostingMode,
      url: value('.environment-url', card),
      branchReference: value('.environment-branchReference', card),
      credentialReference: value('.environment-credentialReference', card),
      subdomainLabel: value('.environment-subdomainLabel', card),
      notes: value('.environment-notes', card),
    }));
    const automations = qsa('[data-automation-id]').map(card => ({
      id: card.dataset.automationId,
      name: value('.automation-name', card),
      event: value('.automation-event', card),
      outcome: value('.automation-outcome', card),
      status: value('.automation-status', card),
      n8nWorkflowId: value('.automation-workflowId', card),
      instanceUrl: value('.automation-instanceUrl', card),
      credentialReference: value('.automation-credentialReference', card),
      dataNotes: value('.automation-dataNotes', card),
    }));
    return {
      version: 1,
      intake: {
        clientName: value('#intake-clientName'),
        projectName: value('#intake-projectName'),
        summary: value('#intake-summary'),
        goals: lines(value('#intake-goals')),
        audiences: lines(value('#intake-audiences')),
        requiredFeatures: lines(value('#intake-requiredFeatures')),
        contentSources: lines(value('#intake-contentSources')),
        brandNotes: value('#intake-brandNotes'),
        constraints: lines(value('#intake-constraints')),
        successMetrics: lines(value('#intake-successMetrics')),
        targetLaunch: value('#intake-targetLaunch'),
        budget: value('#intake-budget'),
        stakeholders: lines(value('#intake-stakeholders')),
      },
      pages,
      designSystem: {
        brandDirection: value('#design-brandDirection'),
        tone: value('#design-tone'),
        primaryColor: value('#design-primaryColor'),
        secondaryColor: value('#design-secondaryColor'),
        accentColor: value('#design-accentColor'),
        headingFont: value('#design-headingFont'),
        bodyFont: value('#design-bodyFont'),
        spacingScale: value('#design-spacingScale'),
        cornerStyle: value('#design-cornerStyle'),
        accessibilityTarget: value('#design-accessibilityTarget'),
        componentNotes: lines(value('#design-componentNotes')),
      },
      platforms,
      hostingEnvironments,
      automations,
    };
  }

  function assignValue(selector, nextValue, root = document) {
    const element = qs(selector, root);
    if (element && 'value' in element) element.value = nextValue ?? '';
  }

  function applyNormalizedConfig(config) {
    if (!config || typeof config !== 'object') return;
    const intake = config.intake ?? {};
    const intakeFields = {
      clientName: '#intake-clientName', projectName: '#intake-projectName', summary: '#intake-summary',
      goals: '#intake-goals', audiences: '#intake-audiences', requiredFeatures: '#intake-requiredFeatures',
      contentSources: '#intake-contentSources', brandNotes: '#intake-brandNotes', constraints: '#intake-constraints',
      successMetrics: '#intake-successMetrics', targetLaunch: '#intake-targetLaunch', budget: '#intake-budget',
      stakeholders: '#intake-stakeholders',
    };
    Object.entries(intakeFields).forEach(([key, selector]) => {
      const next = Array.isArray(intake[key]) ? intake[key].join('\\n') : intake[key];
      assignValue(selector, next);
    });
    const projectName = intake.projectName || intake.clientName || 'Untitled interface';
    qsa('[data-project-name]').forEach(element => { element.textContent = projectName; });
    const projectSummary = qs('[data-project-summary]');
    if (projectSummary) projectSummary.textContent = intake.summary || 'Capture the audience, outcome, and constraints, then shape the surfaces that deliver them.';

    const pages = Array.isArray(config.pages) ? config.pages : [];
    const canonicalPageIds = new Set(pages.map(page => page.id));
    qsa('#sitemapRows tr[data-page-id]').forEach(row => {
      if (canonicalPageIds.has(row.dataset.pageId)) return;
      removeSurfaceFromBuilder(row.dataset.pageId);
      qsa('[data-page-id]').filter(element => element.dataset.pageId === row.dataset.pageId).forEach(element => element.remove());
    });
    pages.forEach(page => {
      if (findSurfaceRow(page.id) && findSurfaceCard(page.id)) return;
      qs('#sitemapRows')?.insertAdjacentHTML('beforeend', sitemapRow(page));
      qs('#wireframeCards')?.insertAdjacentHTML('beforeend', wireframeCard(page));
      appendSurfaceToBuilder(page);
    });

    pages.forEach(page => {
      const row = findSurfaceRow(page.id);
      const card = findSurfaceCard(page.id);
      if (!row || !card) return;
      assignValue('.page-title', page.title, row);
      assignValue('.page-slug', page.slug, row);
      assignValue('.page-purpose', page.purpose, row);
      assignValue('.page-template', page.template, row);
      assignValue('.page-sections', Array.isArray(page.sections) ? page.sections.join('\\n') : '', card);
      assignValue('.page-wireframeNotes', page.wireframeNotes, card);
      assignValue('.page-designNotes', page.designNotes, card);
      assignValue('.page-wireframeStatus', page.wireframeStatus, card);
      assignValue('.page-designStatus', page.designStatus, card);
      assignValue('.page-contentStatus', page.contentStatus, card);
      assignValue('.page-seoStatus', page.seoStatus, card);
      const cardRoute = qs('.wireframe-topline .eyebrow', card);
      const cardTitle = qs('.wireframe-topline h2', card);
      const cardStatus = qs('.wireframe-topline .status-pill', card);
      const outline = qs('.wireframe-sheet', card);
      if (cardRoute) cardRoute.textContent = page.slug;
      if (cardTitle) cardTitle.textContent = page.title;
      if (cardStatus) cardStatus.textContent = page.designStatus;
      if (outline) {
        const sections = Array.isArray(page.sections) && page.sections.length > 0 ? page.sections : ['Section not mapped'];
        outline.innerHTML = sections.slice(0, 8).map((section, index) => '<div class="wireframe-block block-' + ((index % 3) + 1) + '"><span>' + escapeMarkup(section) + '</span></div>').join('');
      }
      updateSurfacePresentation(page.id);
      rebuildSurfaceNodes(page.id);
    });

    const design = config.designSystem ?? {};
    const designFields = {
      brandDirection: '#design-brandDirection', tone: '#design-tone', primaryColor: '#design-primaryColor',
      secondaryColor: '#design-secondaryColor', accentColor: '#design-accentColor', headingFont: '#design-headingFont',
      bodyFont: '#design-bodyFont', spacingScale: '#design-spacingScale', cornerStyle: '#design-cornerStyle',
      accessibilityTarget: '#design-accessibilityTarget', componentNotes: '#design-componentNotes',
    };
    Object.entries(designFields).forEach(([key, selector]) => {
      const next = Array.isArray(design[key]) ? design[key].join('\\n') : design[key];
      assignValue(selector, next);
    });
    const componentLibrary = qs('#componentLibrary');
    if (componentLibrary) {
      const guidance = Array.isArray(design.componentNotes) ? design.componentNotes : [];
      componentLibrary.innerHTML = guidance.length > 0
        ? guidance.map(note => '<button type="button" class="library-item" data-open-settings="ui-system" title="Edit component guidance"><span class="component-glyph" aria-hidden="true">◇</span>' + escapeMarkup(note) + '</button>').join('')
        : '<div class="compact-empty"><strong>No component recipes yet</strong><span>Describe reusable navigation, cards, forms, and actions in Visual language.</span></div>';
    }
    ['headingFont','bodyFont','cornerStyle'].forEach(key => {
      const tokenValue = qs('[data-visual-text-token="' + key + '"] small');
      if (tokenValue) tokenValue.textContent = design[key] || '';
    });
    const accessibilityIntent = qs('[data-accessibility-intent]');
    if (accessibilityIntent) accessibilityIntent.textContent = design.accessibilityTarget || '';
    ['primaryColor','secondaryColor','accentColor'].forEach(key => {
      const id = key === 'primaryColor' ? 'design-primaryColor' : key === 'secondaryColor' ? 'design-secondaryColor' : 'design-accentColor';
      const picker = qs('[data-color-for="' + id + '"]');
      if (picker && design[key]) picker.value = design[key];
      if (design[key]) paintSwatch(id, design[key]);
    });

    (Array.isArray(config.platforms) ? config.platforms : []).forEach(platform => {
      const card = qsa('[data-platform-id]').find(element => element.dataset.platformId === platform.id);
      if (!card) return;
      const primary = qs('input[name="primaryPlatform"]', card);
      if (primary) primary.checked = platform.primary === true;
      assignValue('.platform-status', platform.status, card);
      assignValue('.platform-siteUrl', platform.siteUrl, card);
      assignValue('.platform-projectReference', platform.projectReference, card);
      assignValue('.platform-environmentReference', platform.environmentReference, card);
      assignValue('.platform-notes', platform.notes, card);
    });
    (Array.isArray(config.hostingEnvironments) ? config.hostingEnvironments : []).forEach(environment => {
      const card = qsa('[data-environment-id]').find(element => element.dataset.environmentId === environment.id);
      if (!card) return;
      card.dataset.hostingMode = environment.hostingMode;
      assignValue('.environment-hostingMode', environment.hostingMode, card);
      assignValue('.environment-url', environment.url, card);
      assignValue('.environment-branchReference', environment.branchReference, card);
      assignValue('.environment-credentialReference', environment.credentialReference, card);
      assignValue('.environment-subdomainLabel', environment.subdomainLabel, card);
      assignValue('.environment-notes', environment.notes, card);
    });
    const automations = Array.isArray(config.automations) ? config.automations : [];
    const canonicalAutomationIds = new Set(automations.map(automation => automation.id));
    qsa('[data-automation-id]').forEach(card => {
      if (!canonicalAutomationIds.has(card.dataset.automationId)) card.remove();
    });
    automations.forEach(automation => {
      if (qsa('[data-automation-id]').some(card => card.dataset.automationId === automation.id)) return;
      qs('#automationEmpty')?.remove();
      qs('#automationCards')?.insertAdjacentHTML('beforeend', automationCard(automation));
    });
    automations.forEach(automation => {
      const card = qsa('[data-automation-id]').find(element => element.dataset.automationId === automation.id);
      if (!card) return;
      assignValue('.automation-name', automation.name, card);
      assignValue('.automation-event', automation.event, card);
      assignValue('.automation-outcome', automation.outcome, card);
      assignValue('.automation-status', automation.status, card);
      assignValue('.automation-workflowId', automation.n8nWorkflowId, card);
      assignValue('.automation-instanceUrl', automation.instanceUrl, card);
      assignValue('.automation-credentialReference', automation.credentialReference, card);
      assignValue('.automation-dataNotes', automation.dataNotes, card);
    });
    syncSelectionContext();
  }

  const settingsNav = createPanelNav({
    tablist: '.settings-tabs',
    buttonSelector: '[data-page-target]',
    pageSelector: '.studio-page',
    pageIdPrefix: 'settings-',
    onActivate: pageId => {
      const content = qs('.settings-content');
      if (content) content.scrollTop = 0;
      vscode.postMessage({ type: 'setActivePage', payload: pageId });
    },
  });

  setMode(studioState.mode);
  setPreviewProfile(studioState.previewProfile);
  setToolPanel(studioState.toolPanel);
  setZoom(studioState.zoom);
  const restoredNodeId = studioState.selectedNodeId;
  selectSurface(
    findSurfaceRow(studioState.selectedSurfaceId) ? studioState.selectedSurfaceId : firstSurfaceId,
    Boolean(restoredNodeId),
  );
  if (restoredNodeId) {
    const selectedNode = qsa('[data-select-node]').find(node => node.dataset.selectNode === restoredNodeId);
    if (selectedNode) selectNode(restoredNodeId, selectedNode.dataset.surfaceId);
    else selectSurface(studioState.selectedSurfaceId);
  }

  qsa('[data-studio-mode]').forEach(button => {
    button.addEventListener('click', () => setMode(button.dataset.studioMode));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = qsa('[data-studio-mode]');
      const current = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next]?.focus();
      setMode(tabs[next]?.dataset.studioMode);
    });
  });
  qsa('[data-preview-profile]').forEach(button => button.addEventListener('click', () => setPreviewProfile(button.dataset.previewProfile)));
  qsa('[data-tool-panel]').forEach(button => button.addEventListener('click', () => setToolPanel(button.dataset.toolPanel)));
  qsa('[data-zoom]').forEach(button => button.addEventListener('click', () => setZoom(studioState.zoom + (button.dataset.zoom === 'in' ? .1 : -.1))));
  qs('#fitCanvas')?.addEventListener('click', () => setZoom(1));

  qsa('[data-page-target]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.pageTarget)));
  qsa('[data-command]').forEach(button => button.addEventListener('click', () => vscode.postMessage({ type: 'openCommand', payload: button.dataset.command })));
  qsa('[data-open-ssot]').forEach(button => button.addEventListener('click', () => vscode.postMessage({ type: 'openSsot', payload: button.dataset.openSsot })));
  qsa('.environment-hostingMode').forEach(select => select.addEventListener('change', () => {
    const card = select.closest('[data-environment-id]');
    if (!card) return;
    card.dataset.hostingMode = select.value;
    const access = qs('.environment-accessPolicy strong', card);
    if (access) access.textContent = select.value === 'hosted' ? 'password-protected' : 'local-only';
    notice(select.value === 'hosted'
      ? 'Hosted Develop requires HTTPS and a password credential reference.'
      : 'Develop restored to loopback-only local hosting. Save to persist.');
  }));

  qs('#saveWebsiteStudio')?.addEventListener('click', () => {
    persistDraftNow();
    setSaveState('saving');
    vscode.postMessage({
      type: 'saveConfig',
      payload: { config: collectConfig(), revision: draftRevision },
    });
    notice('Saving Interface Studio…');
  });
  qs('#importClientIntake')?.addEventListener('click', () => {
    const raw = qs('#clientIntakeJson')?.value ?? '';
    vscode.postMessage({ type: 'importIntake', payload: { raw, config: collectConfig(), revision: draftRevision } });
    notice('Importing and normalizing client intake…');
  });
  function addSurfaceDraft() {
    const id = makeId('page');
    qs('#sitemapRows')?.insertAdjacentHTML('beforeend', sitemapRow(id));
    qs('#wireframeCards')?.insertAdjacentHTML('beforeend', wireframeCard(id));
    const surface = surfaceDraft(id);
    if (surface) appendSurfaceToBuilder(surface);
    selectSurface(id);
    markDirty();
    notice('New surface added to the draft. Save to persist it.');
  }
  qs('#addWebsitePage')?.addEventListener('click', addSurfaceDraft);
  qs('#addSurface')?.addEventListener('click', addSurfaceDraft);
  qs('#addWebsiteAutomation')?.addEventListener('click', () => {
    qs('#automationEmpty')?.remove();
    const id = makeId('automation');
    qs('#automationCards')?.insertAdjacentHTML('beforeend', automationCard(id));
    markDirty();
    notice('New n8n workflow added. Add references only, then save.');
  });

  qs('#inspectorSurfaceTitle')?.addEventListener('input', event => {
    const row = findSurfaceRow(studioState.selectedSurfaceId);
    const source = row ? qs('.page-title', row) : undefined;
    if (source) source.value = event.target.value;
    updateSurfacePresentation(studioState.selectedSurfaceId);
    markDirty();
  });
  qs('#inspectorSurfaceSlug')?.addEventListener('input', event => {
    const row = findSurfaceRow(studioState.selectedSurfaceId);
    const source = row ? qs('.page-slug', row) : undefined;
    if (source) source.value = event.target.value;
    updateSurfacePresentation(studioState.selectedSurfaceId);
    markDirty();
  });
  qs('#inspectorSurfacePurpose')?.addEventListener('input', event => {
    const row = findSurfaceRow(studioState.selectedSurfaceId);
    const source = row ? qs('.page-purpose', row) : undefined;
    if (source) source.value = event.target.value;
    updateSurfacePresentation(studioState.selectedSurfaceId);
    markDirty();
  });
  qs('#inspectorNodeName')?.addEventListener('input', event => {
    if (!studioState.selectedNodeId) return;
    const selected = qsa('[data-select-node]').find(node =>
      node.dataset.selectNode === studioState.selectedNodeId
      && node.dataset.surfaceId === studioState.selectedSurfaceId);
    const index = Number(selected?.dataset.nodeIndex);
    if (!Number.isInteger(index) || index < 0) return;
    updateNodePresentation(studioState.selectedNodeId, studioState.selectedSurfaceId, index, event.target.value);
    markDirty();
  });

  qs('#requestAtlasProposal')?.addEventListener('click', () => {
    const prompt = qs('#atlasChatPrompt')?.value?.trim() ?? '';
    if (!prompt) {
      notice('Describe the change you want Atlas to propose.', 'error');
      return;
    }
    if (prompt.length > 8_000) {
      notice('Keep the Atlas request to 8,000 characters or fewer.', 'error');
      return;
    }
    const userMessage = document.createElement('div');
    userMessage.className = 'user-message';
    userMessage.textContent = prompt;
    qs('#chatThread')?.append(userMessage);
    const proposal = qs('#proposalCard');
    const summary = qs('#proposalSummary');
    const selectedNodeElement = qsa('[data-select-node]').find(node =>
      node.dataset.selectNode === studioState.selectedNodeId
      && node.dataset.surfaceId === studioState.selectedSurfaceId);
    const selectedNodeIndex = Number(selectedNodeElement?.dataset.nodeIndex);
    if (proposal) proposal.hidden = false;
    if (summary) summary.textContent = 'Atlas is preparing a reviewable proposal for ' + selectionLabel() + '.';
    const requestButton = qs('#requestAtlasProposal');
    if (requestButton) requestButton.disabled = true;
    vscode.postMessage({
      type: 'openContextualChat',
      payload: {
        prompt,
        selectedSurfaceId: studioState.selectedSurfaceId,
        selectedNodeId: studioState.selectedNodeId || undefined,
        ...(Number.isInteger(selectedNodeIndex) && selectedNodeIndex >= 0 ? { selectedNodeIndex } : {}),
        previewProfile: studioState.previewProfile,
        config: collectConfig(),
      },
    });
  });

  qsa('[data-proposal-action]').forEach(button => button.addEventListener('click', () => {
    const proposal = qs('#proposalCard');
    if (button.dataset.proposalAction === 'reject') {
      if (proposal) proposal.hidden = true;
      notice('Proposal dismissed. Your draft was not changed.');
      return;
    }
    notice('Apply becomes available when Atlas returns a structured patch to Interface Studio. The current handoff never mutates the draft automatically.');
  }));

  document.addEventListener('click', event => {
    const closeSettingsButton = event.target.closest('[data-close-settings]');
    if (closeSettingsButton) {
      closeSettings();
      return;
    }
    const openSettingsButton = event.target.closest('[data-open-settings]');
    if (openSettingsButton) {
      openSettings(openSettingsButton.dataset.openSettings || 'brief');
      return;
    }
    const selectedNode = event.target.closest('[data-select-node]');
    if (selectedNode) {
      selectNode(selectedNode.dataset.selectNode, selectedNode.dataset.surfaceId);
      return;
    }
    const selectedSurface = event.target.closest('[data-select-surface]');
    if (selectedSurface) {
      selectSurface(selectedSurface.dataset.selectSurface);
      return;
    }
    const removePage = event.target.closest('[data-remove-id]');
    if (removePage) {
      if (qsa('#sitemapRows tr[data-page-id]').length <= 1) {
        notice('Interface Studio keeps at least one surface. Add a replacement before removing this one.', 'error');
        return;
      }
      if (removePage.dataset.confirm !== 'true') {
        removePage.dataset.confirm = 'true';
        removePage.textContent = 'Confirm remove';
        return;
      }
      const id = removePage.dataset.removeId;
      qsa('[data-page-id]').filter(element => element.dataset.pageId === id).forEach(element => element.remove());
      removeSurfaceFromBuilder(id);
      markDirty();
      notice('Surface removed from the draft. Save to persist.');
      return;
    }
    const removeAutomation = event.target.closest('[data-remove-automation]');
    if (removeAutomation) {
      if (removeAutomation.dataset.confirm !== 'true') {
        removeAutomation.dataset.confirm = 'true';
        removeAutomation.textContent = 'Confirm remove';
        return;
      }
      removeAutomation.closest('[data-automation-id]')?.remove();
      markDirty();
      notice('Automation removed from the draft. Save Interface Studio to persist.');
    }
  });

  document.addEventListener('input', event => {
    if (event.target.closest('.settings-content') && event.target.id !== 'clientIntakeJson') {
      const surfaceRow = event.target.closest('#sitemapRows tr[data-page-id]');
      const surfaceCard = event.target.closest('#wireframeCards [data-page-id]');
      if (surfaceRow && event.target.matches('.page-title,.page-slug,.page-purpose')) {
        updateSurfacePresentation(surfaceRow.dataset.pageId);
      }
      if (surfaceCard && event.target.matches('.page-sections')) {
        rebuildSurfaceNodes(surfaceCard.dataset.pageId);
      }
      markDirty();
    }
  });
  document.addEventListener('change', event => {
    if (event.target.closest('.settings-content')) markDirty();
  });
  document.addEventListener('keydown', event => {
    const drawer = qs('#projectSettingsDrawer');
    if (event.key === 'Escape' && !drawer?.hidden) {
      closeSettings();
      return;
    }
    if (event.key === 'Tab' && drawer && !drawer.hidden) {
      const focusable = qsa('button:not([disabled]):not(.drawer-backdrop),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])', drawer)
        .filter(element => !element.closest('[hidden]') && element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
      event.preventDefault();
      qs('#saveWebsiteStudio')?.click();
    }
  });

  // Colour editing used to be one-way and partial: moving the picker wrote into
  // its paired hex field, typing a hex did not move the picker back, and the
  // swatches above were server-rendered so neither updated them until a save
  // and re-render.
  function paintSwatch(id, value) {
    const swatch = document.querySelector('[data-token-swatch="' + id + '"]');
    if (swatch) swatch.style.background = value;
    const languageToken = document.querySelector('[data-token-source="' + id + '"]');
    if (languageToken) {
      languageToken.dataset.tokenValue = value;
      const tokenSwatch = qs('.token-swatch', languageToken);
      const tokenValue = qs('small', languageToken);
      if (tokenSwatch) tokenSwatch.style.background = value;
      if (tokenValue) tokenValue.textContent = value;
    }
    const variable = id === 'design-primaryColor'
      ? '--studio-primary'
      : id === 'design-secondaryColor'
        ? '--studio-strong'
        : id === 'design-accentColor'
          ? '--studio-accent'
          : undefined;
    if (variable) qs('#canvasStage')?.style.setProperty(variable, value);
  }

  qsa('[data-color-for]').forEach(picker => {
    const id = picker.dataset.colorFor;
    const target = document.getElementById(id);
    picker.addEventListener('input', () => {
      if (target) target.value = picker.value;
      paintSwatch(id, picker.value);
    });
    if (target) {
      target.addEventListener('input', () => {
        const value = target.value.trim();
        // Only a complete hex can drive the native picker; anything else is
        // still mid-typing, so the swatch waits rather than flickering.
        if (/^#[0-9a-fA-F]{6}$/.test(value)) {
          picker.value = value;
          paintSwatch(id, value);
        }
      });
    }
  });

  window.addEventListener('message', event => {
    if (event.data?.type === 'notice') {
      notice(event.data.message, event.data.tone);
      if (event.data.tone === 'error' && qs('#saveState')?.dataset.saveState === 'saving') setSaveState('dirty');
      if (event.data.tone === 'error') {
        const requestButton = qs('#requestAtlasProposal');
        if (requestButton) requestButton.disabled = false;
      }
    }
    if (event.data?.type === 'configSaved' || event.data?.type === 'configImported') {
      const isCurrentRevision = event.data.revision === draftRevision;
      if (isCurrentRevision) {
        applyNormalizedConfig(event.data.config);
        setSaveState('saved');
        vscode.postMessage({ type: 'clearDraft', payload: { revision: draftRevision } });
        notice(event.data.message, 'success');
      } else {
        setSaveState('dirty');
        notice('An earlier draft was saved, but newer changes are still unsaved.');
      }
      const item = document.createElement('li');
      const dot = document.createElement('span');
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      const timestamp = document.createElement('small');
      dot.className = 'history-dot';
      title.textContent = event.data.type === 'configImported' ? 'Imported client intake' : 'Saved Interface Studio draft';
      timestamp.textContent = event.data.updatedAt || 'Just now';
      copy.append(title, timestamp);
      item.append(dot, copy);
      qs('#historyList')?.prepend(item);
    }
    if (event.data?.type === 'navigateSettings') openSettings(event.data.page);
    if (event.data?.type === 'chatHandedOff') {
      notice(event.data.message, 'success');
      const response = document.createElement('div');
      response.className = 'atlas-message';
      response.textContent = 'The current unsaved surface, selected node, preview profile, and visual language are attached in Atlas.';
      qs('#chatThread')?.append(response);
      const summary = qs('#proposalSummary');
      if (summary) summary.textContent = 'Continue in Atlas, then review the affected nodes before applying any proposal.';
      const composer = qs('#atlasChatPrompt');
      const requestButton = qs('#requestAtlasProposal');
      if (composer) composer.value = '';
      if (requestButton) requestButton.disabled = false;
    }
  });
  window.addEventListener('beforeunload', () => {
    if (qs('#saveState')?.dataset.saveState !== 'saved') persistDraftNow();
  });
  vscode.postMessage({ type: 'ready' });
`;
