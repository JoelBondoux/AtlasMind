import * as vscode from 'vscode';
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
  WebsitePlatformStatus,
  WebsiteWorkspaceConfig,
  WebsiteWorkStatus,
} from '../types.js';
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

export function isWebsiteStudioPage(value: unknown): value is WebsiteStudioPage {
  return typeof value === 'string' && WEBSITE_STUDIO_PAGES.has(value as WebsiteStudioPage);
}

export type WebsiteStudioMessage =
  | { type: 'ready' }
  | { type: 'saveConfig'; payload: unknown }
  | { type: 'importIntake'; payload: string }
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
    WebsiteStudioPanel.currentPanel = new WebsiteStudioPanel(panel, safeTargetPage);
  }

  private readonly manager: WebsiteWorkspaceManager;
  private config: WebsiteWorkspaceConfig;
  private activePage: WebsiteStudioPage;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    targetPage: WebsiteStudioPage,
  ) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.manager = new WebsiteWorkspaceManager(workspaceRoot);
    this.config = this.manager.load();
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
    this.panel.webview.html = getWebsiteStudioHtml(this.panel.webview, this.config, targetPage);
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
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void this.panel.webview.postMessage({ type: 'notice', tone: 'error', message: detail });
      void vscode.window.showErrorMessage(`Website Studio: ${detail}`);
    }
  }
}

export function getWebsiteStudioHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
  config: WebsiteWorkspaceConfig,
  activePage: WebsiteStudioPage = 'brief',
): string {
  const approvedPages = config.pages.filter(page =>
    page.wireframeStatus === 'approved' && page.designStatus === 'approved').length;
  const readyAutomations = config.automations.filter(automation => automation.status === 'verified').length;
  const primaryPlatform = config.platforms.find(platform => platform.primary);
  const hostingReadiness = assessWebsiteHostingEnvironments(config);
  const readyHostingEnvironments = hostingReadiness.filter(readiness => readiness.status === 'ready').length;

  return getWebviewHtmlShell({
    title: 'AtlasMind Website Studio',
    cspSource: webview.cspSource,
    bodyContent: `
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
          ${navButton('platforms', '5', 'Platforms', activePage)}
          ${navButton('automations', '6', 'n8n automations', activePage)}
          <div class="nav-footer">
            <button type="button" class="secondary full" data-open-ssot="json">Open website.json</button>
            <button type="button" class="secondary full" data-open-ssot="markdown">Open website.md</button>
          </div>
        </nav>

        <main>
          ${renderBriefPage(config, activePage)}
          ${renderSitemapPage(config, activePage)}
          ${renderWireframesPage(config, activePage)}
          ${renderUiSystemPage(config, activePage)}
          ${renderPlatformsPage(config, activePage)}
          ${renderAutomationsPage(config, activePage)}
        </main>
      </div>

      <footer class="save-bar">
        <div>
          <strong>Reviewable SSOT</strong>
          <span>Changes are sanitized and mirrored to JSON + Markdown. Credentials and n8n webhook values are never stored here.</span>
        </div>
        <button type="button" id="saveWebsiteStudio">Save Website Studio</button>
      </footer>
    `,
    extraCss: WEBSITE_STUDIO_CSS,
    scriptContent: WEBSITE_STUDIO_SCRIPT,
  });
}

function renderBriefPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  const intake = config.intake;
  return `
    <section class="studio-page${activePage === 'brief' ? ' active' : ''}" data-page="brief">
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
        <textarea id="clientIntakeJson" rows="9" placeholder='{"companyName":"Northstar","objectives":["Generate qualified leads"],"targetAudience":["Operations leaders"]}'></textarea>
        <button type="button" id="importClientIntake">Import and normalize</button>
      </article>
    </section>
  `;
}

function renderSitemapPage(config: WebsiteWorkspaceConfig, activePage: WebsiteStudioPage): string {
  return `
    <section class="studio-page${activePage === 'sitemap' ? ' active' : ''}" data-page="sitemap">
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
    <section class="studio-page${activePage === 'wireframes' ? ' active' : ''}" data-page="wireframes">
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
            <span style="background:${escapeHtml(design.primaryColor)}"></span>
            <span style="background:${escapeHtml(design.secondaryColor)}"></span>
            <span style="background:${escapeHtml(design.accentColor)}"></span>
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
    <section class="studio-page${activePage === 'platforms' ? ' active' : ''}" data-page="platforms">
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
`;

const WEBSITE_STUDIO_SCRIPT = `
  const vscode = acquireVsCodeApi();
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const value = (selector, root = document) => qs(selector, root)?.value?.trim() ?? '';
  const lines = input => input.split(/\\r?\\n/).map(item => item.trim()).filter(Boolean);
  const makeId = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

  function showPage(pageId) {
    qsa('.studio-page').forEach(page => page.classList.toggle('active', page.dataset.page === pageId));
    qsa('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.pageTarget === pageId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  function sitemapRow(id) {
    return '<tr data-page-id="' + id + '">' +
      '<td><input class="page-title" aria-label="Page title" value="New page" /></td>' +
      '<td><input class="page-slug" aria-label="Page slug" value="/new-page" /></td>' +
      '<td><textarea class="page-purpose" aria-label="Page purpose" rows="2"></textarea></td>' +
      '<td><input class="page-template" aria-label="Page template" value="Standard page" /></td>' +
      '<td><button type="button" class="danger subtle remove-page" data-remove-id="' + id + '">Remove</button></td></tr>';
  }

  function wireframeCard(id) {
    return '<article class="wireframe-card" data-page-id="' + id + '">' +
      '<div class="wireframe-topline"><div><p class="eyebrow">/new-page</p><h2>New page</h2></div><span class="status-pill">not-started</span></div>' +
      '<div class="wireframe-sheet"><div class="wireframe-block block-1"><span>Section not mapped</span></div></div>' +
      '<label class="field"><span>Page sections</span><textarea class="page-sections" rows="4" placeholder="One section per line"></textarea></label>' +
      '<label class="field"><span>Wireframe notes</span><textarea class="page-wireframeNotes" rows="4"></textarea></label>' +
      '<label class="field"><span>Visual design notes</span><textarea class="page-designNotes" rows="4"></textarea></label>' +
      '<div class="status-grid">' +
      ['page-wireframeStatus','page-designStatus','page-contentStatus','page-seoStatus'].map((className, index) =>
        '<label class="field"><span>' + ['Wireframe','UI design','Content','SEO'][index] + '</span><select class="' + className + '">' + statusOptions() + '</select></label>').join('') +
      '</div></article>';
  }

  function automationCard(id) {
    return '<article class="automation-card" data-automation-id="' + id + '">' +
      '<div class="card-heading"><p class="eyebrow">n8n workflow</p><button type="button" class="danger subtle remove-automation" data-remove-automation="' + id + '">Remove</button></div>' +
      '<label class="field"><span>Workflow name</span><input class="automation-name" value="New automation" /></label>' +
      '<label class="field"><span>Event / trigger</span><input class="automation-event" /></label>' +
      '<label class="field"><span>Expected outcome</span><textarea class="automation-outcome" rows="4"></textarea></label>' +
      '<label class="field"><span>Status</span><select class="automation-status"><option value="idea">Idea</option><option value="mapped">Mapped</option><option value="configured">Configured</option><option value="verified">Verified</option><option value="paused">Paused</option></select></label>' +
      '<div class="field-pair"><label class="field"><span>n8n workflow ID</span><input class="automation-workflowId" /></label><label class="field"><span>n8n instance URL</span><input class="automation-instanceUrl" placeholder="https://n8n.example.com/" /></label></div>' +
      '<label class="field"><span>Credential reference</span><input class="automation-credentialReference" placeholder="env:N8N_WORKFLOW_URL" /></label>' +
      '<label class="field"><span>Data and privacy notes</span><textarea class="automation-dataNotes" rows="4"></textarea></label></article>';
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
    vscode.postMessage({ type: 'saveConfig', payload: collectConfig() });
    notice('Saving Website Studio…');
  });
  qs('#importClientIntake')?.addEventListener('click', () => {
    const payload = qs('#clientIntakeJson')?.value ?? '';
    vscode.postMessage({ type: 'importIntake', payload });
    notice('Importing and normalizing client intake…');
  });
  qs('#addWebsitePage')?.addEventListener('click', () => {
    const id = makeId('page');
    qs('#sitemapRows')?.insertAdjacentHTML('beforeend', sitemapRow(id));
    qs('#wireframeCards')?.insertAdjacentHTML('beforeend', wireframeCard(id));
    notice('New page added. Save Website Studio to persist it.');
  });
  qs('#addWebsiteAutomation')?.addEventListener('click', () => {
    qs('#automationEmpty')?.remove();
    const id = makeId('automation');
    qs('#automationCards')?.insertAdjacentHTML('beforeend', automationCard(id));
    notice('New n8n workflow added. Add references only, then save.');
  });

  document.addEventListener('click', event => {
    const removePage = event.target.closest('[data-remove-id]');
    if (removePage) {
      if (removePage.dataset.confirm !== 'true') {
        removePage.dataset.confirm = 'true';
        removePage.textContent = 'Confirm remove';
        return;
      }
      const id = removePage.dataset.removeId;
      qsa('[data-page-id]').filter(element => element.dataset.pageId === id).forEach(element => element.remove());
      notice('Page removed from the draft. Save Website Studio to persist.');
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
      notice('Automation removed from the draft. Save Website Studio to persist.');
    }
  });

  qsa('[data-color-for]').forEach(picker => picker.addEventListener('input', () => {
    const target = document.getElementById(picker.dataset.colorFor);
    if (target) target.value = picker.value;
  }));

  window.addEventListener('message', event => {
    if (event.data?.type === 'notice') notice(event.data.message, event.data.tone);
  });
  vscode.postMessage({ type: 'ready' });
`;
