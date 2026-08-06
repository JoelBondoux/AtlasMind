import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { ProviderId, SubscriptionQuota } from '../types.js';
import {
  BEDROCK_ACCESS_KEY_SECRET,
  BEDROCK_MODEL_IDS_SETTING,
  BEDROCK_REGION_SETTING,
  BEDROCK_SECRET_KEY_SECRET,
  BEDROCK_SESSION_TOKEN_SECRET,
  getConfiguredBedrockModelIds,
  getConfiguredBedrockRegion,
  getConfiguredLocalEndpoints,
  ACP_SETUP_URL,
  ACP_PROVIDER_BRIDGES,
  ACP_PROVIDER_ID,
  parseAcpAgentSettings,
  isAcpConsoleModeChosen,
  resetAcpProbeCache,
} from '../providers/index.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import { PANEL_NAV_JS } from './panelNav.js';
import {
  COPILOT_MULTIPLIER_DOCS_URL,
  MULTIPLIER_CACHE_STALE_MS,
  isSyncStale,
  type MultiplierSyncResult,
} from '../providers/copilotMultiplierSync.js';
import { formatCost } from '../core/currencyFormatter.js';

const AZURE_OPENAI_ENDPOINT_SETTING = 'azureOpenAiEndpoint';
const AZURE_OPENAI_DEPLOYMENTS_SETTING = 'azureOpenAiDeployments';
const COPILOT_MULTIPLIER_SYNC_STORAGE_KEY = 'atlasmind.copilotMultiplierSync';
/** User-facing labels only — ACP does not disclose a subscription tier or balance. */
const ACP_SUBSCRIPTION_PLAN_STORAGE_KEY = 'atlasmind.acpSubscriptionPlans';
const SUBSCRIPTION_QUOTA_STORAGE_KEY = 'atlasmind.subscriptionQuota';
const MAX_ACP_PLAN_LABEL_LENGTH = 160;

export const PROVIDER_IDS: readonly ProviderId[] = [
  // First-party model providers
  'acp',
  'anthropic',
  'openai',
  'google',
  'azure',
  'mistral',
  'deepseek',
  'zai',
  'bedrock',
  'xai',
  'cohere',
  'perplexity',
  'huggingface',
  'nvidia',
  // Aggregators & fast-inference
  'openrouter',
  'groq',
  'together',
  'fireworks',
  // Regional cloud providers
  'qwen',
  'moonshot',
  'yi',
  'minimax',
  // Local & subscription
  'local',
  'copilot',
];

type ModelProviderMessage =
  | { type: 'saveApiKey'; payload: ProviderId }
  | { type: 'configureSubscription'; payload: ProviderId }
  /** "Use my Claude/ChatGPT subscription" on a pay-per-token provider's card. */
  | { type: 'useSubscriptionForProvider'; payload: ProviderId }
  | { type: 'refreshModels' }
  | { type: 'openSpecialistIntegrations' }
  /** A settings page named in provider copy. The webview sends the page id,
   *  never a command — the host decides what a page id means. */
  | { type: 'openSettingsPage'; payload: string }
  | { type: 'openSettings' };

/**
 * Model Provider management webview – add/edit API keys, enable/disable providers.
 */
export class ModelProviderPanel {
  public static currentPanel: ModelProviderPanel | undefined;
  private static readonly viewType = 'atlasmind.modelProviders';
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ModelProviderPanel.currentPanel) {
      ModelProviderPanel.currentPanel.panel.reveal(column);
      void ModelProviderPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ModelProviderPanel.viewType,
      'Model Providers',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ModelProviderPanel.currentPanel = new ModelProviderPanel(panel, context, atlas);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly atlas: AtlasMindContext,
  ) {
    this.panel = panel;
    void this.refresh();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      message => {
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    // Refresh when provider config changes (e.g. local endpoints saved from Settings panel).
    this.atlas.modelsRefresh.event(() => { void this.refresh(); }, null, this.disposables);
  }

  private dispose(): void {
    ModelProviderPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  public async refresh(): Promise<void> {
    this.panel.webview.html = await this.getHtml();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isModelProviderMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'saveApiKey': {
        await configureProvider(this.context, this.atlas, message.payload);
        if (message.payload === 'local') {
          return;
        }
        await this.refresh();
        return;
      }
      case 'configureSubscription': {
        await configureSubscription(this.context, this.atlas, message.payload);
        await this.refresh();
        return;
      }
      case 'useSubscriptionForProvider': {
        await useSubscriptionForProvider(this.atlas, message.payload);
        await this.refresh();
        return;
      }
      case 'refreshModels':
        {
          // "Refresh" is explicit user intent, unlike the many render-time
          // callers that should share the five-minute ACP answer.
          resetAcpProbeCache();
          const summary = await this.atlas.refreshProviderModels();
          await this.atlas.refreshProviderHealth();
          vscode.window.showInformationMessage(
            `Refreshed ${summary.providersUpdated} provider(s). ` +
            `${summary.modelsAvailable} models are now available to routing.`,
          );
        }
        await this.refresh();
        return;
      case 'openSpecialistIntegrations':
        await vscode.commands.executeCommand('atlasmind.openSpecialistIntegrations');
        return;
      case 'openSettingsPage': {
        // Looked up, never constructed. Building a command id from a webview
        // string would let the webview choose the command that runs.
        if (!isSettingsPageId(message.payload)) {
          return;
        }
        await vscode.commands.executeCommand(SETTINGS_PAGE_COMMANDS[message.payload]);
        return;
      }

      case 'openSettings':
        await vscode.commands.executeCommand('atlasmind.openSettings', { page: 'models', query: 'providers' });
        return;
    }
  }

  private async getHtml(): Promise<string> {
    const providerCards = await Promise.all(PROVIDER_IDS.map(async providerId => {
      const status = await this.getProviderStatus(providerId);
      const configured = await isProviderConfigured(this.context, providerId);
      const actionLabel = getProviderActionLabel(providerId);
      return renderProviderCard({
        providerId,
        displayName: status.displayName,
        badge: status.badge,
        failureBadge: status.failureBadge,
        configured,
        actionLabel,
        detailsHtml: providerId === 'local'
          ? getLocalEndpointDetailsHtml()
          : isSubscriptionProvider(providerId)
            ? getSubscriptionDetailsHtml(providerId, this.context, this.atlas)
            : undefined,
      });
    }));

    const multiplierSyncBanner = renderMultiplierSyncBanner(
      this.context.globalState?.get<MultiplierSyncResult>(COPILOT_MULTIPLIER_SYNC_STORAGE_KEY),
    );

    const configuredCount = providerCards.filter(card => card.configured).length;
    const failedProviderCount = providerCards.filter(card => card.hasFailures).length;
    const catalogCards = providerCards.map(card => card.html).join('');
    const routedCards = providerCards.filter(card => card.page === 'routed').map(card => card.html).join('');
    const platformCards = providerCards.filter(card => card.page === 'platform').map(card => card.html).join('');

    return getWebviewHtmlShell({
      dashboardSkin: true,
      title: 'Model Providers',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <div class="panel-hero">
        <div>
          <p class="eyebrow">Routed backends</p>
          <h1>Model Providers</h1>
          <p class="hero-copy">Configure routed providers without digging through a dense table. Credentials stay in VS Code SecretStorage, while workspace-level endpoint settings stay in AtlasMind configuration.</p>
        </div>
        <div class="hero-badges" aria-label="Provider summary">
          <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="catalog" data-status-filter="configured" title="Show configured providers across the full provider catalog.">${configuredCount} configured</button>
          <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="catalog" data-status-filter="pending" title="Show providers that still need setup.">${PROVIDER_IDS.length - configuredCount} awaiting setup</button>
          <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="catalog" data-status-filter="failed" title="Show providers with routed model failures.">${failedProviderCount} with model failures</button>
          <span class="hero-badge" data-tooltip="Provider secrets live in VS Code SecretStorage. AtlasMind keeps endpoint URLs, deployment names, and other workspace-scoped metadata in normal settings." tabindex="0">SecretStorage-backed</span>
        </div>
      </div>

      <div class="search-shell">
        <label class="search-label" for="providerSearch">Search providers</label>
        <input id="providerSearch" type="search" placeholder="Search by provider, cloud, or workflow" />
        <p id="providerSearchStatus" class="search-status" aria-live="polite">Browse by category or search for a provider.</p>
      </div>

      <div class="panel-layout">
        <nav class="panel-nav" aria-label="Model provider sections" role="tablist" aria-orientation="vertical">
          <button type="button" class="nav-link active" data-page-target="overview" data-search="overview refresh metadata specialists settings local azure bedrock copilot">Overview</button>
          <button type="button" class="nav-link" data-page-target="catalog" data-search="catalog all providers configured pending failed setup routing platform local cloud">All Providers</button>
          <button type="button" class="nav-link" data-page-target="routed" data-search="routed api anthropic openai google mistral deepseek zai xai cohere perplexity huggingface nvidia openrouter groq together fireworks qwen moonshot yi minimax">Routed APIs</button>
          <button type="button" class="nav-link" data-page-target="platform" data-search="platform local azure bedrock copilot cloud endpoint deployments aws region">Platform &amp; Local</button>
        </nav>

        <main class="panel-main">
          <section id="page-overview" class="panel-page active">
            <div class="page-header">
              <p class="page-kicker">Overview</p>
              <h2>Provider workspace</h2>
              <p>Refresh catalog metadata, jump to specialist integrations, or open the AtlasMind settings page that holds workspace-scoped endpoint fields.</p>
            </div>

            ${multiplierSyncBanner}

            <div class="action-grid">
              <button id="refresh-models" class="action-card action-primary">
                <span class="action-title">Refresh Model Metadata</span>
                <span class="action-copy">Re-query configured providers and update the routed model catalog.</span>
              </button>
              <button id="open-settings" class="action-card">
                <span class="action-title">Open Model Settings</span>
                <span class="action-copy">Jump to the AtlasMind Settings models page for endpoint-level workspace options.</span>
              </button>
              <button id="open-specialists" class="action-card">
                <span class="action-title">Specialist Integrations</span>
                <span class="action-copy">Keep search, voice, image, and video vendors on dedicated non-routing surfaces.</span>
              </button>
            </div>

            <div class="summary-grid">
              <article class="summary-card">
                <p class="card-kicker">Status</p>
                <h3>${configuredCount}</h3>
                <p>Providers currently configured for AtlasMind.</p>
              </article>
              <article class="summary-card">
                <p class="card-kicker">Routed APIs</p>
                <h3>${providerCards.filter(card => card.page === 'routed').length}</h3>
                <p>Direct hosted model APIs exposed through the router.</p>
              </article>
              <article class="summary-card">
                <p class="card-kicker">Platform &amp; Local</p>
                <h3>${providerCards.filter(card => card.page === 'platform').length}</h3>
                <p>Copilot, local endpoints, Azure OpenAI, and Amazon Bedrock.</p>
              </article>
            </div>
          </section>

          <section id="page-catalog" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">All Providers</p>
              <h2>Full provider catalog</h2>
              <p>Review every routed and platform-backed provider in one place, then filter by setup status or failures from the summary chips above.</p>
            </div>
            <div class="card-grid catalog-grid">
              ${catalogCards}
            </div>
          </section>

          <section id="page-routed" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">Routed APIs</p>
              <h2>Hosted provider keys</h2>
              <p>These providers mainly need stored API credentials. AtlasMind uses the resulting models in routed orchestration decisions.</p>
            </div>
            <div class="card-grid">
              ${routedCards}
            </div>
          </section>

          <section id="page-platform" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">Platform &amp; Local</p>
              <h2>Session-backed and endpoint-backed providers</h2>
              <p>These integrations combine SecretStorage with workspace configuration for endpoints, deployment lists, or cloud regions.</p>
            </div>
            <div class="card-grid">
              ${platformCards}
            </div>
          </section>
        </main>
      </div>
      `,
      extraCss:
      `
        /* Palette, page frame and hero come from the shared dashboard theme. */
        .panel-hero {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          padding: 20px 22px;
          margin-bottom: 18px;
          border: 1px solid var(--atlas-border);
          border-radius: 18px;
          background: radial-gradient(circle at top right, color-mix(in srgb, var(--atlas-accent) 14%, transparent), transparent 40%), linear-gradient(160deg, var(--atlas-surface), var(--vscode-editor-background));
        }
        .eyebrow, .page-kicker, .card-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.74rem; color: var(--atlas-muted); }
        .panel-hero h1, .page-header h2, .provider-card h3 { margin: 0; }
        .hero-copy, .page-header p:last-child, .provider-copy, .search-status { color: var(--atlas-muted); }
        .hero-badges { display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; justify-content: flex-end; }
        .hero-badge { position: relative; border: 1px solid var(--atlas-border); border-radius: 999px; padding: 6px 12px; background: color-mix(in srgb, var(--atlas-accent) 16%, transparent); }
        .hero-badge-button { color: inherit; font: inherit; cursor: pointer; }
        .hero-badge-button:hover, .hero-badge-button:focus-visible { outline: 2px solid var(--atlas-accent); outline-offset: 2px; }
        /* Clickable badges sit beside inert ones with identical shape, border and
           fill; only hover distinguished them. The caret is an at-rest cue that a
           badge filters something. */
        .hero-badge-button::after { content: " \\25BE"; opacity: 0.55; font-size: 0.85em; }
        .hero-badge-button:hover::after, .hero-badge-button:focus-visible::after { opacity: 1; }
        .hero-badge[data-tooltip]::after {
          content: attr(data-tooltip);
          position: absolute;
          right: 0;
          top: calc(100% + 10px);
          width: min(320px, 70vw);
          padding: 10px 12px;
          border: 1px solid var(--atlas-border);
          border-radius: 12px;
          background: var(--atlas-surface-strong);
          color: var(--vscode-foreground);
          line-height: 1.45;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          z-index: 10;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        }
        .hero-badge[data-tooltip]:hover::after, .hero-badge[data-tooltip]:focus-visible::after { opacity: 1; visibility: visible; }
        .search-shell { display: grid; gap: 6px; margin: 0 0 18px; }
        .search-label { font-weight: 600; }
        .search-shell input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--atlas-border)); padding: 10px 12px; border-radius: 12px; }
        .panel-layout { display: grid; grid-template-columns: minmax(220px, 240px) minmax(0, 1fr); gap: 18px; align-items: start; }
        .panel-nav { position: sticky; top: 20px; display: grid; gap: 8px; padding: 16px; border: 1px solid var(--atlas-border); border-radius: 18px; background: linear-gradient(180deg, var(--atlas-surface-strong), var(--atlas-surface)); }
        .nav-link { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 12px; padding: 11px 12px; background: transparent; color: var(--vscode-foreground); font-weight: 600; }
        .nav-link.active { background: color-mix(in srgb, var(--atlas-accent) 22%, transparent); border-color: color-mix(in srgb, var(--atlas-accent) 48%, var(--atlas-border)); }
        .nav-link.hidden-by-search { display: none; }
        .nav-link:hover, .nav-link:focus-visible, .action-card:hover, .action-card:focus-visible, .provider-card button:focus-visible, #refresh-models:focus-visible, #open-specialists:focus-visible, #open-settings:focus-visible { outline: 2px solid var(--atlas-accent); outline-offset: 2px; }
        .panel-page { display: none; }
        .panel-page.active { display: block; }
        .action-grid, .summary-grid, .card-grid { display: grid; gap: 12px; }
        .action-grid, .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .action-card, .summary-card, .provider-card { border: 1px solid var(--atlas-border); border-radius: 16px; padding: 16px; background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background)); }
        .action-card { display: flex; flex-direction: column; gap: 6px; text-align: left; }
        .action-primary { border-color: color-mix(in srgb, var(--atlas-accent) 42%, var(--atlas-border)); }
        /* Was undefined anywhere, so it silently borrowed the shell's primary
           fill and a *secondary* action rendered as the loudest control on the
           card. Now an explicit outline treatment. */
        .action-secondary {
          background: transparent;
          border: 1px solid var(--atlas-border);
          border-radius: 8px;
          color: var(--atlas-muted);
          padding: 6px 12px;
        }
        .action-secondary:hover:not(:disabled),
        .action-secondary:focus-visible {
          border-color: color-mix(in srgb, var(--atlas-accent) 48%, var(--atlas-border));
          color: var(--vscode-foreground);
        }
        /* A route inside a sentence, so it has to read as part of the sentence.
           A button element for the message boundary, styled as the link it is:
           anything button-shaped mid-paragraph reads as a separate action. */
        .inline-settings-link {
          background: none;
          border: none;
          padding: 0;
          font: inherit;
          color: var(--vscode-textLink-foreground, var(--atlas-accent));
          text-decoration: underline;
          cursor: pointer;
        }
        .inline-settings-link:hover,
        .inline-settings-link:focus-visible {
          color: var(--vscode-textLink-activeForeground, var(--atlas-accent));
        }
        .action-title { font-weight: 700; }
        .action-copy, .summary-card p:last-child { color: var(--atlas-muted); }
        .summary-card h3 { margin: 0; font-size: 1.8rem; }
        .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .catalog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .provider-card { display: grid; gap: 10px; }
        .provider-card.hidden-by-search { display: none; }
        .provider-card.hidden-by-status { display: none; }
        .provider-topline { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; align-items: flex-start; }
        .provider-badges { display: flex; flex-wrap: wrap; gap: 8px; }
        .status-badge, .meta-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 0.88rem; border: 1px solid var(--atlas-border); }
        .status-badge.configured { background: color-mix(in srgb, var(--vscode-testing-iconPassed) 16%, transparent); }
        .status-badge.pending { background: color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 16%, transparent); }
        .status-badge.failed { background: color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 22%, transparent); border-color: color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 48%, var(--atlas-border)); }
        .provider-detail-list { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--atlas-border); border-radius: 12px; background: color-mix(in srgb, var(--atlas-surface) 72%, transparent); }
        .provider-detail-list ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
        .provider-detail-list li { display: grid; gap: 2px; }
        .provider-detail-list strong { font-size: 0.92rem; }
        .provider-detail-list span { color: var(--atlas-muted); word-break: break-word; }
        .provider-detail-label, .provider-detail-empty { margin: 0; color: var(--atlas-muted); }
        .provider-actions { display: flex; flex-wrap: wrap; gap: 10px; }
        .provider-actions button { padding: 6px 12px; }
        .sync-banner { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; line-height: 1.5; }
        .sync-banner--ok { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 12%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 40%, transparent); }
        .sync-banner--warn { background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground, #f0a500) 12%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #f0a500) 40%, transparent); }
        .sync-banner__icon { flex-shrink: 0; font-size: 1rem; }
        .sync-banner__text { flex: 1; }
        .sync-banner__link { color: var(--atlas-accent); }
        @media (max-width: 920px) {
          .panel-layout, .action-grid, .summary-grid, .card-grid { grid-template-columns: 1fr; }
          .panel-nav { position: static; }
          .panel-hero { flex-direction: column; }
        }
      `,
      scriptContent:
      `
        ${PANEL_NAV_JS}

        const vscode = acquireVsCodeApi();
        const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
        const pages = Array.from(document.querySelectorAll('.panel-page'));
        const searchInput = document.getElementById('providerSearch');
        const searchStatus = document.getElementById('providerSearchStatus');
        const providerCards = Array.from(document.querySelectorAll('.provider-card'));
        let activeStatusFilter = '';

        // Tab semantics, roving tabindex and arrow-key navigation come from the
        // shared controller. State persistence stays panel-specific.
        const panelNav = createPanelNav({
          tablist: '.panel-nav',
          onActivate: pageId => {
            const state = vscode.getState() ?? {};
            vscode.setState({ ...state, pageId, statusFilter: activeStatusFilter });
          },
        });

        function activatePage(pageId) {
          panelNav.activate(pageId);
        }

        function matchesStatusFilter(card) {
          if (!(card instanceof HTMLElement) || activeStatusFilter.length === 0) {
            return true;
          }
          if (activeStatusFilter === 'failed') {
            return card.dataset.failureStatus === 'failed';
          }
          return card.dataset.status === activeStatusFilter;
        }

        function updateSearch(query) {
          const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
          let visibleCards = 0;
          navButtons.forEach(button => {
            if (!(button instanceof HTMLButtonElement)) {
              return;
            }
            const haystack = ((button.textContent ?? '') + ' ' + (button.dataset.search ?? '')).toLowerCase();
            const matches = normalized.length === 0 || haystack.includes(normalized);
            button.classList.toggle('hidden-by-search', !matches);
          });
          providerCards.forEach(card => {
            if (!(card instanceof HTMLElement)) {
              return;
            }
            const haystack = (card.dataset.search ?? '').toLowerCase();
            const matchesSearch = normalized.length === 0 || haystack.includes(normalized);
            const matchesStatus = matchesStatusFilter(card);
            card.classList.toggle('hidden-by-search', !matchesSearch);
            card.classList.toggle('hidden-by-status', !matchesStatus);
            if (matchesSearch && matchesStatus) {
              visibleCards += 1;
            }
          });
          if (searchStatus instanceof HTMLElement) {
            const statusLabel = activeStatusFilter === 'failed'
              ? ' with model failures'
              : activeStatusFilter.length > 0
                ? ' matching that status'
                : '';
            if (normalized.length === 0 && activeStatusFilter.length === 0) {
              searchStatus.textContent = 'Browse by category or search for a provider.';
            } else if (visibleCards === 0) {
              searchStatus.textContent = 'No providers matched the current filter.';
            } else if (visibleCards === 1) {
              searchStatus.textContent = '1 provider matched' + statusLabel + '.';
            } else {
              searchStatus.textContent = visibleCards + ' providers matched' + statusLabel + '.';
            }
          }
          const activeVisible = navButtons.find(button => button instanceof HTMLButtonElement && button.classList.contains('active') && !button.classList.contains('hidden-by-search'));
          if (!activeVisible) {
            const firstVisible = navButtons.find(button => button instanceof HTMLButtonElement && !button.classList.contains('hidden-by-search'));
            if (firstVisible instanceof HTMLButtonElement) {
              activatePage(firstVisible.dataset.pageTarget ?? 'overview');
            }
          }
          const state = vscode.getState() ?? {};
          vscode.setState({ ...state, searchQuery: normalized, statusFilter: activeStatusFilter });
        }

        navButtons.forEach(button => {
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }
          button.addEventListener('click', () => activatePage(button.dataset.pageTarget ?? 'overview'));
        });

        document.querySelectorAll('[data-hero-page-target]').forEach(button => {
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }
          button.addEventListener('click', () => {
            activeStatusFilter = button.dataset.statusFilter ?? '';
            activatePage(button.dataset.heroPageTarget ?? 'catalog');
            updateSearch(searchInput instanceof HTMLInputElement ? searchInput.value : '');
          });
        });

        const savedState = vscode.getState();
        activeStatusFilter = typeof savedState?.statusFilter === 'string' ? savedState.statusFilter : '';
        activatePage(typeof savedState?.pageId === 'string' ? savedState.pageId : 'overview');
        if (searchInput instanceof HTMLInputElement) {
          const initialQuery = typeof savedState?.searchQuery === 'string' ? savedState.searchQuery : '';
          searchInput.value = initialQuery;
          updateSearch(initialQuery);
          searchInput.addEventListener('input', () => updateSearch(searchInput.value));
        }

        document.querySelectorAll('button[data-provider]').forEach(button => {
          button.addEventListener('click', () => {
            const provider = button.getAttribute('data-provider');
            if (!provider) {
              return;
            }
            vscode.postMessage({ type: 'saveApiKey', payload: provider });
          });
        });

        document.querySelectorAll('button[data-acp-bridge]').forEach(button => {
          button.addEventListener('click', () => {
            const provider = button.getAttribute('data-acp-bridge');
            if (!provider) { return; }
            vscode.postMessage({ type: 'useSubscriptionForProvider', payload: provider });
          });
        });

        document.querySelectorAll('button[data-subscription-provider]').forEach(button => {
          button.addEventListener('click', () => {
            const provider = button.getAttribute('data-subscription-provider');
            if (!provider) { return; }
            vscode.postMessage({ type: 'configureSubscription', payload: provider });
          });
        });

        document.querySelectorAll('button[data-open-settings-page]').forEach(button => {
          button.addEventListener('click', () => {
            const page = button.getAttribute('data-open-settings-page');
            if (!page) { return; }
            vscode.postMessage({ type: 'openSettingsPage', payload: page });
          });
        });

        const refreshButton = document.getElementById('refresh-models');
        if (refreshButton) {
          refreshButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshModels' });
          });
        }

        const specialistButton = document.getElementById('open-specialists');
        if (specialistButton) {
          specialistButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'openSpecialistIntegrations' });
          });
        }

        const settingsButton = document.getElementById('open-settings');
        if (settingsButton) {
          settingsButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'openSettings' });
          });
        }
      `,
    });
  }

  private async getProviderStatus(providerId: ProviderId): Promise<{ displayName: string; badge: string; failureBadge?: string }> {
    const configured = await isProviderConfigured(this.context, providerId);
    const failureCount = getProviderFailureCount(this.atlas, providerId);
    const failureBadge = failureCount > 0 ? `${failureCount} failed model${failureCount === 1 ? '' : 's'}` : undefined;
    if (providerId === 'acp') {
      // Three states, not two: no agent named is a different problem from an
      // agent that is named but missing or signed out.
      const { parseAcpAgentSettings } = await import('../providers/acp.js');
      const agents = parseAcpAgentSettings(vscode.workspace.getConfiguration('atlasmind').get<unknown>('acp.agents'));
      const badge = agents.length === 0
        ? 'No agent configured'
        : configured
          ? `Ready: ${agents.map(agent => agent.command).join(', ')}`
          : `Configured, not usable: ${agents[0]!.command}`;
      return { displayName: 'ACP Agents (subscription)', badge, failureBadge };
    }
    if (providerId === 'copilot') {
      return { displayName: 'GitHub Copilot', badge: 'uses VS Code sign-in', failureBadge };
    }
    if (providerId === 'local') {
      const endpointCount = getConfiguredLocalEndpoints({
        getEndpoints: () => vscode.workspace.getConfiguration('atlasmind').get<unknown>('localOpenAiEndpoints'),
        getLegacyBaseUrl: () => vscode.workspace.getConfiguration('atlasmind').get<string>('localOpenAiBaseUrl'),
      }).length;
      return {
        displayName: 'Local LLM',
        badge: configured ? `${endpointCount} endpoint${endpointCount === 1 ? '' : 's'} configured` : 'configure endpoints in settings',
        failureBadge,
      };
    }
    if (providerId === 'azure') {
      return { displayName: getProviderDisplayName(providerId), badge: configured ? 'configured' : 'configure endpoint + deployments', failureBadge };
    }
    if (providerId === 'bedrock') {
      return { displayName: getProviderDisplayName(providerId), badge: configured ? 'configured' : 'configure region + model IDs', failureBadge };
    }

    return {
      displayName: getProviderDisplayName(providerId),
      badge: configured ? 'configured' : 'not configured',
      failureBadge,
    };
  }
}

export function isModelProviderMessage(value: unknown): value is ModelProviderMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (message.type === 'refreshModels') {
    return true;
  }

  if (message.type === 'openSpecialistIntegrations') {
    return true;
  }

  if (message.type === 'openSettings') {
    return true;
  }

  if (message.type === 'openSettingsPage') {
    return isSettingsPageId(message.payload);
  }

  if (message.type === 'useSubscriptionForProvider') {
    return typeof message.payload === 'string' && PROVIDER_IDS.includes(message.payload as ProviderId);
  }

  if (message.type === 'saveApiKey' || message.type === 'configureSubscription') {
    return typeof message.payload === 'string' && PROVIDER_IDS.includes(message.payload as ProviderId);
  }

  return false;
}

function renderProviderCard(options: {
  providerId: ProviderId;
  displayName: string;
  badge: string;
  failureBadge?: string;
  configured: boolean;
  actionLabel: string;
  detailsHtml?: string;
}): { page: 'routed' | 'platform'; configured: boolean; hasFailures: boolean; html: string } {
  const page = isPlatformProvider(options.providerId) ? 'platform' : 'routed';
  const metaLabel = getProviderMetaLabel(options.providerId);
  const notes = getProviderNotes(options.providerId);
  const search = escapeHtml([
    options.displayName,
    options.providerId,
    metaLabel,
    notes,
    options.badge,
  ].join(' ').toLowerCase());
  const statusClass = options.configured ? 'configured' : 'pending';
  const hasFailures = typeof options.failureBadge === 'string' && options.failureBadge.length > 0;
  return {
    page,
    configured: options.configured,
    hasFailures,
    html: `
      <article class="provider-card" data-search="${search}" data-status="${statusClass}" data-failure-status="${hasFailures ? 'failed' : 'healthy'}">
        <div class="provider-topline">
          <div>
            <p class="card-kicker">${escapeHtml(metaLabel)}</p>
            <h3>${escapeHtml(options.displayName)}</h3>
          </div>
          <div class="provider-badges">
            <span class="status-badge ${statusClass}">${escapeHtml(options.badge)}</span>
            ${hasFailures ? `<span class="status-badge failed">${escapeHtml(options.failureBadge ?? '')}</span>` : ''}
            <span class="meta-badge">${escapeHtml(options.providerId)}</span>
          </div>
        </div>
        <p class="provider-copy">${renderProviderCopy(notes)}</p>
        ${options.detailsHtml ?? ''}
        <div class="provider-actions">
          <button type="button" data-provider="${options.providerId}">${escapeHtml(options.actionLabel)}</button>
          ${isSubscriptionProvider(options.providerId)
            // Named, because three subscription providers can be on screen at
            // once and every one of these buttons read "$ Configure plan". The
            // quick pick it opens has always titled itself with the provider —
            // so the button was the only step that did not say what it acted on.
            //
            // ACP is the exception, and naming it after the provider made it
            // *less* true rather than more: "Configure ACP Agents (subscription)
            // plan" names a protocol, and there is no such plan to configure.
            // The subscription belongs to an agent, so the button says a plan is
            // being picked and the flow's first step asks which.
            ? `<button type="button" class="action-secondary" data-subscription-provider="${options.providerId}" title="${escapeHtml(subscriptionButtonTooltip(options.providerId, options.displayName))}">${escapeHtml(subscriptionButtonLabel(options.providerId, options.displayName))}</button>`
            : ''}
          ${renderSubscriptionOffer(options.providerId)}
        </div>
      </article>`,
  };
}

/**
 * The "use the subscription you already pay for" offer, on the card of the
 * pay-per-token provider it replaces.
 *
 * Phrased in the user's terms rather than the protocol's: someone who has never
 * heard of ACP still understands "Use my Claude subscription". Clicking it is
 * the whole discovery path — if nothing is installed yet, the handler offers the
 * setup guide rather than failing at them.
 */
function renderSubscriptionOffer(providerId: ProviderId): string {
  const bridge = ACP_PROVIDER_BRIDGES.find((entry: { providerId: string }) => entry.providerId === providerId);
  if (!bridge) {
    return '';
  }
  const eligibility = bridge.eligibility ? ` ${bridge.eligibility}` : '';
  return `<button type="button" class="action-secondary" data-acp-bridge="${escapeHtml(bridge.providerId)}" `
    + `title="${escapeHtml(`Route these models through your ${bridge.subscriptionName} instead of paying per token, using the Agent Client Protocol.${eligibility}`)}">`
    + `${escapeHtml(bridge.offerLabel)}</button>`;
}

function getProviderFailureCount(atlas: AtlasMindContext, providerId: ProviderId): number {
  const router = atlas.modelRouter as unknown as { getProviderFailureCount?: (id: string) => number } | undefined;
  return typeof router?.getProviderFailureCount === 'function' ? router.getProviderFailureCount(providerId) : 0;
}

function isPlatformProvider(providerId: ProviderId): boolean {
  return providerId === 'copilot' || providerId === 'local' || providerId === 'azure' || providerId === 'bedrock';
}

/**
 * Provider copy, with a route to any settings page it names.
 *
 * The ACP card told you to "turn on \"Let subscription agents act\" under
 * Settings → Safety" and then left you to find it — an instruction with no way to
 * follow it. The text is still escaped first and the link substituted onto the
 * *escaped* string, so the copy remains untrusted-safe: nothing here can inject
 * markup, because the only thing inserted is this function's own element.
 *
 * A button rather than an anchor, and a page id rather than a command: the
 * webview says which page it wants and the host decides what that means, which
 * is the same boundary every other control in this panel observes.
 */
function renderProviderCopy(notes: string): string {
  const escaped = escapeHtml(notes);
  let out = escaped;
  for (const [label, page] of SETTINGS_PAGE_LINKS) {
    out = out.split(label).join(
      `<button type="button" class="inline-settings-link" data-open-settings-page="${page}">${label}</button>`,
    );
  }
  return out;
}

/**
 * Phrases in provider copy that name a settings page, and the page each means.
 *
 * A short explicit list rather than a pattern over "Settings → …": a phrase that
 * matched but had no page behind it would render a button that goes nowhere,
 * which is worse than the plain text it replaced.
 */
const SETTINGS_PAGE_COMMANDS: Readonly<Record<string, string>> = {
  safety: 'atlasmind.openSettingsSafety',
  models: 'atlasmind.openSettingsModels',
  chat: 'atlasmind.openSettingsChat',
  project: 'atlasmind.openSettingsProject',
};

function isSettingsPageId(value: unknown): value is keyof typeof SETTINGS_PAGE_COMMANDS {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(SETTINGS_PAGE_COMMANDS, value);
}

const SETTINGS_PAGE_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['Settings → Safety', 'safety'],
  ['Settings → Models', 'models'],
  ['Settings → Chat', 'chat'],
  ['Settings → Project', 'project'],
];

function isSubscriptionProvider(providerId: ProviderId): boolean {
  return providerId === 'copilot' || providerId === 'acp';
}

/** The button's words: the provider's name, unless the provider is not the plan. */
export function subscriptionButtonLabel(providerId: ProviderId, displayName: string): string {
  return providerId === ACP_PROVIDER_ID
    ? '$ Configure agent plan'
    : `$ Configure ${displayName} plan`;
}

function subscriptionButtonTooltip(providerId: ProviderId, displayName: string): string {
  return providerId === ACP_PROVIDER_ID
    ? 'Record the subscription or eligible license behind one of your configured ACP agents. The list is taken from your current ACP configuration, so eligible Gemini Code Assist and custom agents appear when configured.'
    : `Set your ${displayName} plan tier and monthly allowance.`;
}

function getProviderMetaLabel(providerId: ProviderId): string {
  switch (providerId) {
    case 'acp':
      return 'Use your existing subscription';
    case 'copilot':
      return 'Session-backed';
    case 'local':
      return 'Workspace endpoint';
    case 'azure':
    case 'bedrock':
      return 'Cloud platform';
    default:
      return 'Hosted API';
  }
}

function getProviderNotes(providerId: ProviderId): string {
  switch (providerId) {
    case 'acp':
      return 'Use the Claude Code or Codex agent already installed on your computer, with its existing subscription — no separate AtlasMind API key is needed. It can answer questions, explain code, and help you plan. To let it change files, run commands, or use connected tools, choose “Let subscription agents act” in Settings → Safety. AtlasMind shows each action for your approval. AtlasMind never installs or signs in to an agent for you.';
    case 'copilot':
      return 'Reuses your signed-in VS Code Copilot session instead of storing a separate AtlasMind API key.';
    case 'local':
      return 'Uses a local OpenAI-compatible endpoint such as Ollama, LM Studio, or Open WebUI with optional local authentication.';
    case 'azure':
      return 'Combines a workspace endpoint, deployment names, and an Azure API key to expose deployment-backed routed models.';
    case 'bedrock':
      return 'Stores AWS credentials and a workspace region plus model list for Bedrock-backed routing.';
    default:
      return 'Stores a provider API key in SecretStorage and exposes the returned models to AtlasMind routing.';
  }
}

function getLocalEndpointDetailsHtml(): string {
  const endpoints = getConfiguredLocalEndpoints({
    getEndpoints: () => vscode.workspace.getConfiguration('atlasmind').get<unknown>('localOpenAiEndpoints'),
    getLegacyBaseUrl: () => vscode.workspace.getConfiguration('atlasmind').get<string>('localOpenAiBaseUrl'),
  });
  if (endpoints.length === 0) {
    return '<p class="provider-detail-list provider-detail-empty">No local endpoints configured yet.</p>';
  }

  const rows = endpoints.map(endpoint => `
    <li>
      <strong>${escapeHtml(endpoint.label)}</strong>
      <span>${escapeHtml(endpoint.baseUrl)}</span>
    </li>`).join('');

  return `
    <div class="provider-detail-list">
      <p class="provider-detail-label">Configured endpoints</p>
      <ul>${rows}</ul>
    </div>`;
}

// ── Subscription plan tiers ───────────────────────────────────────────────────

interface SubscriptionTier {
  label: string;
  description: string;
  totalRequests: number;
  monthlyCostUsd: number;
}

// AI credits billing effective June 1, 2026 (1 credit = $0.01 USD).
// Code completions remain free and do not consume credits.
const COPILOT_TIERS: SubscriptionTier[] = [
  { label: 'Copilot Free',       description: 'Limited chat credits / month — free tier',                          totalRequests: 100,   monthlyCostUsd: 0 },
  { label: 'Copilot Student',    description: 'Free for verified students — unlimited completions',                 totalRequests: 1500,  monthlyCostUsd: 0 },
  { label: 'Copilot Pro',        description: '1,500 AI credits / month — $10/user/month',                         totalRequests: 1500,  monthlyCostUsd: 10 },
  { label: 'Copilot Pro+',       description: '7,000 AI credits / month — $39/user/month',                         totalRequests: 7000,  monthlyCostUsd: 39 },
  { label: 'Copilot Max',        description: '20,000 AI credits / month — $100/user/month',                       totalRequests: 20000, monthlyCostUsd: 100 },
  { label: 'Copilot Business',   description: 'Org-pooled AI credits — $19/seat/month (enter org total)',           totalRequests: 1900,  monthlyCostUsd: 19 },
  { label: 'Copilot Enterprise', description: 'Org-pooled AI credits — $39/seat/month (enter org total)',           totalRequests: 3900,  monthlyCostUsd: 39 },
];

function getSubscriptionTiers(providerId: ProviderId): SubscriptionTier[] {
  if (providerId === 'copilot') return COPILOT_TIERS;
  return [];
}

/**
 * ACP intentionally stores a label, not an allowance. The protocol can say
 * which agent and models are present; it cannot attest to the user's account
 * tier, remaining use, or how a vendor will charge the next prompt. Treating a
 * guessed message count as a balance made the router stop using subscriptions
 * that were still available.
 */
function getAcpSubscriptionPlanLabels(globalState: vscode.Memento): Readonly<Record<string, string>> {
  const raw = globalState.get<unknown>(ACP_SUBSCRIPTION_PLAN_STORAGE_KEY, {});
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^acp\/[a-z0-9-]{1,32}$/.test(key) || typeof value !== 'string') {
      continue;
    }
    const label = value.trim().slice(0, MAX_ACP_PLAN_LABEL_LENGTH);
    if (label) {
      labels[key] = label;
    }
  }
  return labels;
}

function getSubscriptionDetailsHtml(
  providerId: ProviderId,
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): string {
  if (providerId === ACP_PROVIDER_ID) {
    return getAcpSubscriptionDetailsHtml(context, atlas);
  }
  const quota = atlas.modelRouter?.getSubscriptionQuota?.(providerId);
  if (!quota) {
    return renderNoPlanHtml('Configure plan');
  }

  const pct = quota.totalRequests > 0
    ? Math.round((quota.remainingRequests / quota.totalRequests) * 100)
    : 0;
  const costPerUnit = quota.costPerRequestUnit !== undefined
    ? `${formatCost(quota.costPerRequestUnit, 4)}/unit`
    : 'not set';
  const resetInfo = quota.resetsAt
    ? `Resets ${new Date(quota.resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : '';

  return `
    <div class="provider-detail-list">
      <p class="provider-detail-label">Subscription plan</p>
      <ul>
        <li>
          <strong>AI credits</strong>
          <span>${escapeHtml(String(quota.remainingRequests))} / ${escapeHtml(String(quota.totalRequests))} remaining (${pct}%)${resetInfo ? ' · ' + escapeHtml(resetInfo) : ''}</span>
        </li>
        <li>
          <strong>Cost per credit</strong>
          <span>${escapeHtml(costPerUnit)}</span>
        </li>
      </ul>
    </div>`;
}

/**
 * One row per configured ACP agent, because one row could only ever be wrong.
 *
 * The card derives its rows from `atlasmind.acp.agents`, rather than from a
 * vendor table. This is why eligible Gemini Code Assist and a self-installed ACP agent appear as
 * soon as the user has configured them — no extension release needs to learn a
 * new vendor plan first.
 *
 * An agent with no plan set is listed as such rather than omitted: absent from
 * the list reads as "not configured for ACP at all", which is a different
 * problem with a different fix.
 */
function getAcpSubscriptionDetailsHtml(context: vscode.ExtensionContext, _atlas: AtlasMindContext): string {
  const agents = parseAcpAgentSettings(
    vscode.workspace.getConfiguration('atlasmind').get<unknown>('acp.agents'),
  );
  if (agents.length === 0) {
    return renderNoPlanHtml('Configure agent plan');
  }
  const planLabels = getAcpSubscriptionPlanLabels(context.globalState);
  const rows = agents.map(agent => ({
    label: agent.label ?? agent.id,
    modelId: `${ACP_PROVIDER_ID}/${agent.id}`,
    plan: planLabels[`${ACP_PROVIDER_ID}/${agent.id}`],
  }));
  if (rows.every(row => !row.plan)) {
    return renderNoPlanHtml('Configure agent plan');
  }

  const items = rows.map(row => {
    if (!row.plan) {
      // Listed, not omitted: absent from the list reads as "this agent is not
      // set up for ACP", which is a different problem with a different fix.
      return `
        <li>
          <strong>${escapeHtml(row.label)}</strong>
          <span>Plan not recorded</span>
        </li>`;
    }
    return `
      <li>
        <strong>${escapeHtml(row.label)}</strong>
        <span>${escapeHtml(row.plan)}</span>
      </li>`;
  }).join('');

  return `
    <div class="provider-detail-list">
      <p class="provider-detail-label">Subscription plans</p>
      <ul>${items}</ul>
      <p class="provider-detail-empty">ACP discovers your configured agents and their available models, but does not expose an account plan or a trustworthy remaining balance. AtlasMind records the plan name only; it never estimates or decrements subscription credits.</p>
    </div>`;
}

/** @param actionLabel the button this text tells the user to press, spelled as the button spells it. */
function renderNoPlanHtml(actionLabel: string): string {
  return `
    <div class="provider-detail-list">
      <p class="provider-detail-label">Subscription plan</p>
      <!-- Named the control rather than showing "$(credit-card)": codicon
           syntax is interpreted by tree items, the status bar and QuickPicks,
           but not in webview HTML, where it rendered as literal text. -->
      <p class="provider-detail-empty">No plan recorded — use <strong>${escapeHtml(actionLabel)}</strong> to name your subscription.</p>
    </div>`;
}

/** A quota-tracked subscription provider. ACP plans deliberately are not quotas. */
interface SubscriptionScope {
  /** Storage key: a provider id, or a model id when the provider fronts several plans. */
  key: string;
  /** What the dialogs call it. Names the *plan*, not the protocol. */
  label: string;
  tiers: SubscriptionTier[];
  read: () => SubscriptionQuota | undefined;
  write: (quota: SubscriptionQuota) => void;
}

/**
 * Resolve the scope, asking the user only when there is genuinely a choice.
 *
 * Returns undefined when the user cancels. This is only for providers that
 * publish a quantity AtlasMind can track (currently GitHub Copilot).
 */
async function resolveSubscriptionScope(
  atlas: AtlasMindContext,
  providerId: ProviderId,
): Promise<SubscriptionScope | undefined> {
  const providerLabel = atlas.modelRouter.listProviders().find(p => p.id === providerId)?.displayName ?? providerId;
  return {
    key: providerId,
    label: providerLabel,
    tiers: getSubscriptionTiers(providerId),
    read: () => atlas.modelRouter.getSubscriptionQuota(providerId),
    write: quota => atlas.modelRouter.updateSubscriptionQuota(providerId, quota),
  };
}

interface AcpSubscriptionPlanScope {
  /** The ACP model base id the configured agent owns. */
  key: string;
  /** A user-facing agent label, never a vendor guessed from its command. */
  label: string;
  existingPlan?: string;
}

/**
 * ACP has no subscription-plan discovery endpoint. Its safe dynamic source is
 * the configured agent list: it includes Gemini and user-installed agents as
 * soon as they are in `atlasmind.acp.agents`, without treating remote metadata
 * as executable configuration.
 */
async function resolveAcpSubscriptionPlanScope(
  context: vscode.ExtensionContext,
): Promise<AcpSubscriptionPlanScope | undefined> {
  const agents = parseAcpAgentSettings(
    vscode.workspace.getConfiguration('atlasmind').get<unknown>('acp.agents'),
  );
  if (agents.length === 0) {
    void vscode.window.showInformationMessage(
      'No ACP agent is configured yet. Add the agent you use first, then record the name of its subscription plan.',
    );
    return undefined;
  }

  const planLabels = getAcpSubscriptionPlanLabels(context.globalState);
  let agent = agents[0]!;
  if (agents.length > 1) {
    type AgentItem = vscode.QuickPickItem & { agentId: string };
    const picked = await vscode.window.showQuickPick<AgentItem>(
      agents.map(entry => {
        const key = `${ACP_PROVIDER_ID}/${entry.id}`;
        return {
          label: entry.label ?? entry.id,
          description: entry.command,
          detail: planLabels[key] ?? 'Plan not recorded',
          agentId: entry.id,
        };
      }),
      {
        title: 'ACP: Which agent subscription are you recording?',
        placeHolder: 'This list comes from your configured ACP agents, including eligible Gemini Code Assist and custom agents',
      },
    );
    if (!picked) {
      return undefined;
    }
    agent = agents.find(entry => entry.id === picked.agentId) ?? agent;
  }

  const key = `${ACP_PROVIDER_ID}/${agent.id}`;
  return {
    key,
    label: agent.label ?? agent.id,
    existingPlan: planLabels[key],
  };
}

/** Remove historical guessed ACP quota state; it is neither observable nor safe to route on. */
async function removeLegacyAcpQuotaState(context: vscode.ExtensionContext, atlas: AtlasMindContext): Promise<void> {
  atlas.modelRouter.clearSubscriptionQuota(ACP_PROVIDER_ID);
  for (const [modelId] of atlas.modelRouter.listModelSubscriptionQuotas()) {
    if (modelId.startsWith(`${ACP_PROVIDER_ID}/`)) {
      atlas.modelRouter.clearModelSubscriptionQuota(modelId);
    }
  }

  const stored = context.globalState.get<unknown>(SUBSCRIPTION_QUOTA_STORAGE_KEY, {});
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return;
  }
  const retained = Object.fromEntries(
    Object.entries(stored as Record<string, unknown>)
      .filter(([key]) => key !== ACP_PROVIDER_ID && !key.startsWith(`${ACP_PROVIDER_ID}/`)),
  );
  await context.globalState.update(SUBSCRIPTION_QUOTA_STORAGE_KEY, retained);
}

async function configureAcpSubscriptionPlan(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): Promise<void> {
  const scope = await resolveAcpSubscriptionPlanScope(context);
  if (!scope) {
    return;
  }

  const plan = await vscode.window.showInputBox({
    title: `${scope.label}: Subscription plan`,
    prompt: 'Enter the plan name shown by this service (for example, “ChatGPT Pro (5×)”). ACP does not expose a plan or remaining allowance to AtlasMind.',
    value: scope.existingPlan ?? '',
    validateInput: value => value.trim()
      ? undefined
      : 'Enter the plan name shown by your subscription service',
  });
  if (plan === undefined) {
    return;
  }

  const labels = getAcpSubscriptionPlanLabels(context.globalState);
  await context.globalState.update(ACP_SUBSCRIPTION_PLAN_STORAGE_KEY, {
    ...labels,
    [scope.key]: plan.trim().slice(0, MAX_ACP_PLAN_LABEL_LENGTH),
  });
  await removeLegacyAcpQuotaState(context, atlas);
  vscode.window.showInformationMessage(
    `${scope.label} subscription recorded as “${plan.trim()}”. AtlasMind uses the agent's own availability and does not track or decrement subscription credits.`,
  );
}

/**
 * Interactive flow for configuring a subscription plan's tier.
 * Exposed so the `atlasmind.models.configureSubscription` command can call it
 * directly without opening the webview panel first.
 */
export async function configureSubscription(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
  providerId: ProviderId,
): Promise<void> {
  if (providerId === ACP_PROVIDER_ID) {
    await configureAcpSubscriptionPlan(context, atlas);
    return;
  }
  const scope = await resolveSubscriptionScope(atlas, providerId);
  if (!scope) {
    return;
  }
  const tiers = scope.tiers;
  const providerLabel = scope.label;

  type TierItem = vscode.QuickPickItem & { tier?: SubscriptionTier; custom?: true };

  const items: TierItem[] = [
    ...tiers.map(tier => ({
      label: tier.label,
      description: tier.description,
      tier,
    })),
    { label: 'Custom…', description: 'Enter monthly cost and request total manually', custom: true },
  ];

  const existing = scope.read();
  if (existing) {
    const currentTier = tiers.find(t => t.totalRequests === existing.totalRequests);
    if (currentTier) {
      items.unshift({
        label: `$(check) Current: ${currentTier.label}`,
        description: `${existing.remainingRequests} / ${existing.totalRequests} requests remaining`,
        kind: vscode.QuickPickItemKind.Separator,
      } as TierItem);
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: `${providerLabel}: Configure subscription plan`,
    placeHolder: 'Select your plan tier',
  });
  if (!picked || picked.kind === vscode.QuickPickItemKind.Separator) {
    return;
  }

  let totalRequests: number;
  let monthlyCostUsd: number;

  if (picked.custom) {
    const costInput = await vscode.window.showInputBox({
      title: `${providerLabel}: Monthly subscription cost`,
      prompt: 'Enter your monthly plan cost in USD (e.g. 19)',
      value: existing ? String(Math.round((existing.costPerRequestUnit ?? 0) * (existing.totalRequests ?? 0))) : '',
      validateInput: v => (isNaN(parseFloat(v)) || parseFloat(v) < 0 ? 'Enter a non-negative number' : undefined),
    });
    if (!costInput) { return; }

    const requestsInput = await vscode.window.showInputBox({
      title: `${providerLabel}: Monthly AI credits included`,
      prompt: 'Total AI credits included in your plan — 1 credit = $0.01 (e.g. 1500 for Pro, 7000 for Pro+)',
      value: existing ? String(existing.totalRequests) : '',
      validateInput: v => (!Number.isInteger(Number(v)) || Number(v) <= 0 ? 'Enter a positive integer' : undefined),
    });
    if (!requestsInput) { return; }

    monthlyCostUsd = parseFloat(costInput);
    totalRequests = parseInt(requestsInput, 10);
  } else {
    totalRequests = picked.tier!.totalRequests;
    monthlyCostUsd = picked.tier!.monthlyCostUsd;
  }

  const costPerRequestUnit = monthlyCostUsd > 0 ? monthlyCostUsd / totalRequests : 0;

  // Ask for current remaining — default to full quota if changing plan, or
  // keep existing remaining if staying on same plan.
  const sameTotal = existing?.totalRequests === totalRequests;
  const remainingDefault = sameTotal && existing ? String(existing.remainingRequests) : String(totalRequests);
  const remainingInput = await vscode.window.showInputBox({
    title: `${providerLabel}: Current remaining requests`,
    prompt: `How many AI credits do you have left this period? (out of ${totalRequests})`,
    value: remainingDefault,
    validateInput: v => {
      const n = parseInt(v, 10);
      return (!Number.isInteger(n) || n < 0 || n > totalRequests)
        ? `Enter a number between 0 and ${totalRequests}`
        : undefined;
    },
  });
  if (!remainingInput) { return; }

  const remainingRequests = parseInt(remainingInput, 10);

  // Optional: billing period reset date
  const resetsAtInput = await vscode.window.showInputBox({
    title: `${providerLabel}: Billing period reset date (optional)`,
    prompt: 'When does your quota reset? Leave blank to skip. Format: YYYY-MM-DD',
    value: existing?.resetsAt ? existing.resetsAt.substring(0, 10) : '',
    validateInput: v => {
      if (!v) { return undefined; }
      return isNaN(Date.parse(v)) ? 'Enter a valid date (YYYY-MM-DD) or leave blank' : undefined;
    },
  });
  if (resetsAtInput === undefined) { return; } // ESC pressed

  const quota = {
    totalRequests,
    remainingRequests,
    costPerRequestUnit: costPerRequestUnit > 0 ? costPerRequestUnit : undefined,
    resetsAt: resetsAtInput ? new Date(resetsAtInput + 'T00:00:00').toISOString() : undefined,
  };

  scope.write(quota);

  // Persist immediately, under the same key the router stores it against — a
  // scoped plan written to the provider's key would be restored into a slot
  // nothing reads, and would silently vanish on the next restart.
  const stored = context.globalState.get<Record<string, unknown>>('atlasmind.subscriptionQuota', {});
  await context.globalState.update('atlasmind.subscriptionQuota', { ...stored, [scope.key]: quota });

  vscode.window.showInformationMessage(
    `${providerLabel} subscription configured: ${remainingRequests} / ${totalRequests} AI credits remaining` +
    (costPerRequestUnit > 0 ? ` · ${formatCost(costPerRequestUnit, 4)}/credit` : '') + '.',
  );
}

export async function configureProvider(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
  provider: ProviderId,
): Promise<void> {
  if (provider === 'acp') {
    await configureAcpProvider(atlas);
    return;
  }

  if (provider === 'copilot') {
    const summary = await atlas.refreshProviderModels(true);
    await atlas.refreshProviderHealth();
    atlas.modelsRefresh.fire();

    if (summary.providersUpdated > 0) {
      vscode.window.showInformationMessage('GitHub Copilot uses your signed-in VS Code session. Copilot model access is now enabled for AtlasMind.');
    } else {
      vscode.window.showWarningMessage('AtlasMind could not activate GitHub Copilot models in this session. Ensure GitHub Copilot Chat is installed, signed in, and permission has been granted.');
    }
    return;
  }

  if (provider === 'local') {
    await vscode.commands.executeCommand('atlasmind.openSettings', {
      page: 'models',
      query: 'local endpoints',
      section: 'localEndpointsCard',
    });
    vscode.window.showInformationMessage('Manage local endpoints from AtlasMind Settings > Models & Integrations.');
    return;
  }

  if (provider === 'azure') {
    await configureAzureOpenAiProvider(context, atlas);
    return;
  }

  if (provider === 'bedrock') {
    await configureBedrockProvider(context, atlas);
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: `Enter the API key for ${provider}`,
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'API key cannot be empty.' : undefined,
  });

  if (apiKey === undefined) {
    return;
  }

  await context.secrets.store(getProviderSecretKey(provider), apiKey.trim());

  const adapter = atlas.providerRegistry.get(provider);
  if (adapter) {
    try {
      const models = await adapter.listModels();
      if (models.length > 0) {
        vscode.window.showInformationMessage(
          `✅ ${provider} key verified — ${models.length} model(s) available.`,
        );
      } else {
        vscode.window.showWarningMessage(
          `Key stored for ${provider}, but no models were returned. Verify the key is correct.`,
        );
      }
    } catch {
      vscode.window.showWarningMessage(
        `Key stored for ${provider}, but validation failed. The key may be invalid or the provider may be down.`,
      );
    }
  } else {
    vscode.window.showInformationMessage(`Stored ${provider} credentials in VS Code SecretStorage.`);
  }

  await atlas.refreshProviderModels(true);
  await atlas.refreshProviderHealth();
  atlas.modelsRefresh.fire();
}

/**
 * "Use my Claude / ChatGPT subscription", clicked on a pay-per-token provider.
 *
 * This is the discovery path for ACP, for people who have never heard of it and
 * have no reason to: they know they pay for Claude, and they want AtlasMind to
 * use that instead of burning API credit. So the protocol is never the subject
 * — it is mentioned once, in passing, and only where it explains what to install.
 *
 * The three outcomes are all dead ends today unless they are handled: already
 * working (say so), installed but signed out (say which), or nothing installed
 * (this is the common one — offer the guide rather than reporting a failure at
 * someone who has not been told there was anything to install).
 */
export async function useSubscriptionForProvider(atlas: AtlasMindContext, providerId: ProviderId): Promise<void> {
  const { findAcpBridge, AcpAdapter, parseAcpAgentSettings } = await import('../providers/acp.js');
  const bridge = findAcpBridge(providerId);
  if (!bridge) {
    return;
  }

  if (bridge.eligibility) {
    const choice = await vscode.window.showInformationMessage(
      `${bridge.subscriptionName} eligibility`,
      { modal: true, detail: bridge.eligibility },
      'I have an eligible license',
    );
    if (choice !== 'I have an eligible license') {
      return;
    }
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const configured = parseAcpAgentSettings(configuration.get<unknown>('acp.agents'));
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const candidate = {
    id: bridge.agentId,
    command: bridge.command,
    ...(bridge.args.length > 0 ? { args: [...bridge.args] } : {}),
  };
  if (!await chooseAcpConsoleMode(false)) {
    return;
  }
  const probe = await new AcpAdapter({
    agents: [candidate],
    ...(workspaceRoot ? { cwd: workspaceRoot } : {}),
    hideConsoleWindows: configuration.get<boolean>('acp.hideConsoleWindows', false),
  }).probe().catch(() => undefined);

  // Not installed — the expected first answer, and the reason this button
  // exists. Hand over to the walkthrough instead of stopping at "not found".
  if (!probe?.installed) {
    const choice = await vscode.window.showInformationMessage(
      `To use your ${bridge.subscriptionName} for these models, AtlasMind needs \`${bridge.command}\` installed — a small adapter that lets it talk to the agent you already have. It is not installed yet.`,
      { modal: true, detail: `Install it with:\n\n${bridge.install}\n\nThe setup guide walks through this one step at a time and checks each one for you.` },
      'Open the setup guide',
      'Copy the install command',
    );
    if (choice === 'Open the setup guide') {
      await vscode.commands.executeCommand('atlasmind.openSetupGuide', 'acp');
    } else if (choice === 'Copy the install command') {
      await vscode.env.clipboard.writeText(bridge.install);
      void vscode.window.showInformationMessage('Install command copied. Run it in a terminal, then press this button again.');
    }
    return;
  }

  if (!probe.authenticated) {
    await offerAcpSignIn(bridge.command);
    return;
  }

  // Installed and signed in: register it if it is not already, and enable the
  // provider, because the user has just asked for exactly that.
  if (!configured.some(agent => agent.command === bridge.command)) {
    await configuration.update(
      'acp.agents',
      [...configured.filter(agent => agent.id !== bridge.agentId), candidate],
      vscode.ConfigurationTarget.Workspace,
    );
  }
  // Enabling is the point of the click, so do it through `setProviderEnabled`
  // — the same path the tree's toggle uses. Writing `enabled: true` straight
  // onto the router only changed memory: the persisted availability state still
  // said otherwise, and the very next `applyModelAvailabilityState` (including
  // the refresh two lines below, and every reload) put it back. The provider
  // looked enabled and was never routed to.
  await atlas.setProviderEnabled('acp', true);

  const summary = await atlas.refreshProviderModels(true);
  await atlas.refreshProviderHealth();
  atlas.modelsRefresh.fire();

  // Health is what the router checks last and the user sees least. Saying so
  // here is the difference between "configured" and "actually usable".
  const healthy = atlas.modelRouter.isProviderHealthy?.('acp') ?? true;
  void vscode.window.showInformationMessage(
    healthy
      ? `Your ${bridge.subscriptionName} is now available to AtlasMind as \`acp/${bridge.agentId}\`. `
        + `Refreshed ${summary.providersUpdated} provider(s) and ${summary.modelsAvailable} model entries.`
      : `\`acp/${bridge.agentId}\` is configured and enabled, but its first health check did not pass, so the router will skip it for now. `
        + `Run \`${bridge.command}\` once in a terminal to see what it reports.`,
  );
}

/**
 * "Installed, but it will not open a session" — the one probe answer AtlasMind
 * cannot fix for you, and used to be unhelpful about.
 *
 * The old message said to run the agent in a terminal and complete its login. It
 * named no command, and the command the reader would reasonably infer is the one
 * on screen — which is the *launch* command. `gemini --acp`, `copilot --acp` and
 * `qwen --acp` all start a JSON-RPC server that will never show a login prompt,
 * and `claude-agent-acp` does not own the Claude credential at all. So the
 * instruction was not merely vague, it pointed at the wrong binary.
 *
 * What this does *not* do is complete the sign-in. Every one of these flows opens
 * a browser and asks for an account password; none of them is something an
 * extension should be running unattended, and AtlasMind never sees the credential
 * either way. The button types the verified command into a terminal and stops —
 * pressing Enter, and answering what follows, stays with the user.
 *
 * An agent with no documented flow gets the plain message and no button, because
 * `<command> login` invented for an unknown binary is a confident instruction
 * nobody checked.
 */
export async function offerAcpSignIn(command: string): Promise<void> {
  const { acpSignInFor } = await import('../providers/acp.js');
  const signIn = acpSignInFor(command);

  if (!signIn) {
    void vscode.window.showWarningMessage(
      `\`${command}\` is installed but not signed in. Complete its own login — AtlasMind never handles that credential — then try again. `
      + 'AtlasMind has no published sign-in flow recorded for this agent, so it cannot tell you the exact command.',
    );
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `\`${command}\` is installed but not signed in.`,
    {
      modal: true,
      detail: `Sign in with the agent's own login — AtlasMind never handles that credential.\n\nRun:\n\n${signIn.command}\n\n`
        + `${signIn.then ? `${signIn.then.replace(/[`*]/g, '')}\n\n` : ''}`
        + 'Then try this again.',
    },
    'Open a terminal with the command',
    'Copy the command',
    'Read the docs',
  );

  if (choice === 'Open a terminal with the command') {
    await vscode.commands.executeCommand('atlasmind.setup.prepareCommand', signIn.command);
  } else if (choice === 'Copy the command') {
    await vscode.env.clipboard.writeText(signIn.command);
    void vscode.window.showInformationMessage(`Copied \`${signIn.command}\`. Run it in a terminal, then try again.`);
  } else if (choice === 'Read the docs') {
    await vscode.env.openExternal(vscode.Uri.parse(signIn.docs));
  }
}

/**
 * Ask the Windows-only launch question in words that describe the consequence.
 *
 * `force=false` makes this a setup step: an explicit workspace/user value means
 * the user has already answered and is not asked again. `force=true` is the
 * command-palette/settings action and always offers the choice.
 */
export async function chooseAcpConsoleMode(force = true): Promise<boolean> {
  if (process.platform !== 'win32') {
    return true;
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const inspected = configuration.inspect<boolean>('acp.hideConsoleWindows');
  const explicitlyChosen = isAcpConsoleModeChosen(process.platform, [
    inspected?.workspaceFolderValue,
    inspected?.workspaceValue,
    inspected?.globalValue,
  ]);
  if (!force && explicitlyChosen) {
    return true;
  }

  type ConsoleModeItem = vscode.QuickPickItem & { hide: boolean };
  const picked = await vscode.window.showQuickPick<ConsoleModeItem>([
    {
      label: 'Keep ACP terminal windows visible',
      description: 'Safest compatibility (recommended)',
      detail: 'An ACP agent may briefly open black terminal windows while it starts. AtlasMind reuses the live session, so this should happen far less often. No unusual Windows desktop technique is used.',
      hide: false,
    },
    {
      label: 'Hide ACP windows on a private desktop',
      description: 'No focus-stealing terminal pop-ups',
      detail: 'AtlasMind starts the agent and its descendants on a dedicated, non-visible Windows desktop. Hidden desktops are also used by some malware, so corporate EDR may flag or block this even though AtlasMind never switches to or remotely controls the desktop.',
      hide: true,
    },
  ], {
    title: 'How should AtlasMind start ACP agents on Windows?',
    placeHolder: 'This affects ACP agent processes only; you can change it later in Settings',
    ignoreFocusOut: true,
  });
  if (!picked) {
    return false;
  }

  await configuration.update(
    'acp.hideConsoleWindows',
    picked.hide,
    // This is a machine/EDR preference, not a repository policy. Recording the
    // guided choice in User settings also avoids dirtying `.vscode/settings.json`
    // merely because somebody completed setup; a workspace remains free to
    // override it explicitly through the normal Settings UI.
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(
    picked.hide
      ? 'ACP console windows will be kept on a private Windows desktop. If endpoint security blocks the launcher, uncheck “ACP: Hide Console Windows” in Settings.'
      : 'ACP agents will use ordinary Windows launching. Their own child processes may briefly show terminal windows during startup.',
  );
  return true;
}

/**
 * The one answer to "you picked an agent and it is not installed".
 *
 * Both ACP entry points reach this, and only one of them used to handle it
 * well. The agent picker ended at a dismissable toast whose single button
 * opened a documentation index — so choosing "Claude Agent" appeared to do
 * nothing except navigate to a website, with no install command, no
 * walkthrough, and no statement of what had just been saved.
 *
 * Not-installed is the *expected* first answer here, not an error: AtlasMind
 * never installs an agent, so almost everyone meets this on their first click.
 * It is modal because it is the step the user has to act on, it leads with the
 * exact command to run, and it offers the walkthrough that checks each step.
 */
async function reportAcpAgentNotInstalled(command: string, agentId: string): Promise<void> {
  const [{ findAcpBridgeByAgent }, { planAcpAgentInstall }, { findCommandExecutable }] = await Promise.all([
    import('../providers/acp.js'),
    import('../providers/acpInstaller.js'),
    import('../mcp/mcpClient.js'),
  ]);
  const install = findAcpBridgeByAgent(agentId)?.install;
  const plan = planAcpAgentInstall(agentId, { platform: process.platform, findExecutable: findCommandExecutable });

  // Every command is listed before anything runs. That list *is* the consent:
  // "Install it for me" is only honest if the user has already read what "it"
  // expands to, including a runtime install they did not ask for by name.
  const stepList = plan.status === 'plannable'
    ? plan.steps.map((step, index) => `  ${index + 1}. ${step.humanCommand}\n     ${step.purpose}`).join('\n')
    : '';

  const actions = plan.status === 'plannable'
    ? ['Install it for me', 'Copy the commands', 'Open the setup guide']
    : install
      ? ['Copy the install command', 'Open the setup guide']
      : ['Open the setup guide', 'Open the ACP agent list'];

  const detail = plan.status === 'plannable'
    ? `AtlasMind can run this for you:\n\n${stepList}\n\n`
      + (plan.steps.length > 1
        ? 'The first step installs a runtime the adapter needs, which you may not have yet. '
        : '')
      + 'Nothing runs until you choose. Each command is fixed in AtlasMind\'s source — none of it is generated or taken from a web page.'
    : plan.status === 'manual'
      ? `${plan.reason}\n\n${plan.humanCommand ? `Once its prerequisites are in place:\n\n${plan.humanCommand}` : ''}`
      : `Install it with:\n\n${install ?? command}`;

  const choice = await vscode.window.showWarningMessage(
    `AtlasMind saved \`${command}\` as your ACP agent, but the command is not on your PATH yet — so nothing will route to it until you install it.`,
    { modal: true, detail },
    ...actions,
  );

  if (choice === 'Install it for me' && plan.status === 'plannable') {
    await runAcpInstall(plan);
    return;
  }
  if (choice === 'Copy the commands' && plan.status === 'plannable') {
    await vscode.env.clipboard.writeText(plan.steps.map(step => step.humanCommand).join('\n'));
    void vscode.window.showInformationMessage('Install commands copied — run them in a terminal, then open this again.');
    return;
  }
  if (choice === 'Copy the install command' && install) {
    await vscode.env.clipboard.writeText(install);
    void vscode.window.showInformationMessage(`Copied: ${install}`);
    return;
  }
  if (choice === 'Open the setup guide') {
    await vscode.commands.executeCommand('atlasmind.openSetupGuide', 'acp');
    return;
  }
  if (choice === 'Open the ACP agent list') {
    await vscode.env.openExternal(vscode.Uri.parse(ACP_SETUP_URL));
  }
}

/**
 * Execute a confirmed install plan with visible progress.
 *
 * Each step is reported as it starts, because these are package-manager
 * commands that can take minutes and can prompt for elevation — a silent
 * spinner would leave the user unable to tell "working" from "hung".
 *
 * Deliberately **not** cancellable. A cancel button here could only abandon the
 * notification, not the package manager: `winget` and `apt-get` own their own
 * transactions, and killing one mid-write is how a half-installed runtime
 * happens. Offering a control that cannot do what it appears to do would be
 * worse than the wait it seems to shorten.
 */
async function runAcpInstall(plan: Extract<import('../providers/acpInstaller.js').AcpInstallPlan, { status: 'plannable' }>): Promise<void> {
  const [{ runAcpInstallPlan }, { findCommandExecutable }] = await Promise.all([
    import('../providers/acpInstaller.js'),
    import('../mcp/mcpClient.js'),
  ]);

  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Installing ${plan.displayName}`, cancellable: false },
    async progress => runAcpInstallPlan(
      plan,
      { platform: process.platform, findExecutable: findCommandExecutable },
      message => progress.report({ message }),
    ),
  );

  if (!outcome.ok) {
    void vscode.window.showWarningMessage(
      `AtlasMind could not finish installing ${plan.displayName}.`,
      { modal: true, detail: `${outcome.message}\n\n${outcome.completed.length > 0 ? `Completed before this: ${outcome.completed.join(', ')}` : 'Nothing was installed.'}` },
    );
    return;
  }
  void vscode.window.showInformationMessage(`${outcome.message} Open "Choose Agent" again and AtlasMind will check it is signed in.`);
}

/**
 * Add or replace the ACP agent this workspace uses.
 *
 * The setup *walkthrough* deliberately never writes a setting — but this is the
 * provider panel, where configuring the provider is the whole point of the
 * button. Everything still happens in front of the user: they pick the agent,
 * they see the probe result, and nothing is installed on their behalf.
 */
async function configureAcpProvider(atlas: AtlasMindContext): Promise<void> {
  const { VERIFIED_ACP_AGENTS, AcpAdapter, parseAcpAgentSettings } = await import('../providers/acp.js');

  const picked = await vscode.window.showQuickPick(
    [
      ...VERIFIED_ACP_AGENTS.map(agent => ({
        label: agent.label,
        description: [agent.command, ...agent.args].join(' '),
        detail: `Launch command declared in the ACP registry. Installs with npm as ${agent.npmPackage}.`
          + (agent.eligibility ? ` ${agent.eligibility}` : ''),
        agent,
      })),
      {
        label: 'Another ACP agent…',
        description: 'Enter the command yourself',
        detail: 'Any agent that speaks ACP over stdio. AtlasMind never installs it for you.',
        agent: undefined,
      },
    ],
    { title: 'Which ACP agent should AtlasMind drive?', ignoreFocusOut: true },
  );
  if (!picked) {
    return;
  }

  let id = picked.agent?.id ?? '';
  let command = picked.agent?.command ?? '';
  // The ACP-mode arguments matter as much as the command: `gemini`, `copilot` and
  // `qwen` are ordinary interactive CLIs until `--acp` is passed, so persisting
  // the command alone would launch a REPL that never speaks a word of JSON-RPC
  // and time the handshake out with nothing to explain why.
  let args: string[] = [...(picked.agent?.args ?? [])];
  if (!picked.agent) {
    const entered = await vscode.window.showInputBox({
      title: 'ACP agent command',
      prompt: 'The command that starts the agent in ACP mode, e.g. my-agent-acp, or my-cli --acp.',
      ignoreFocusOut: true,
      validateInput: value => (value ?? '').trim().length === 0 ? 'Enter the command that starts the agent.' : undefined,
    });
    if (!entered) {
      return;
    }
    // Split on whitespace so "my-cli --acp" works as typed. Nothing is passed to
    // a shell, so there is no quoting to honour and none is pretended: an
    // argument containing a space has to be configured in the settings file.
    const words = entered.trim().split(/\s+/);
    command = words[0] ?? '';
    args = words.slice(1);
    id = command.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase().slice(0, 32) || 'agent';
  }

  if (!await chooseAcpConsoleMode(false)) {
    return;
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const existing = parseAcpAgentSettings(configuration.get<unknown>('acp.agents'));
  const next = [
    ...existing.filter(agent => agent.id !== id),
    { id, command, ...(args.length > 0 ? { args } : {}) },
  ];
  await configuration.update('acp.agents', next, vscode.ConfigurationTarget.Workspace);

  // Report what is actually true rather than declaring success on a write.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const probe = await new AcpAdapter({
    agents: next,
    ...(workspaceRoot ? { cwd: workspaceRoot } : {}),
    hideConsoleWindows: configuration.get<boolean>('acp.hideConsoleWindows', false),
  }).probe().catch(() => undefined);

  if (!probe?.installed) {
    await reportAcpAgentNotInstalled(command, id);
    return;
  }
  if (!probe.authenticated) {
    await offerAcpSignIn(command);
    return;
  }

  const summary = await atlas.refreshProviderModels(true);
  await atlas.refreshProviderHealth();
  atlas.modelsRefresh.fire();
  void vscode.window.showInformationMessage(
    `\`${command}\` is ready — its models are routable as \`acp/${id}\`. Refreshed ${summary.providersUpdated} provider(s) and ${summary.modelsAvailable} model entries.`,
  );
}

export async function isProviderConfigured(
  context: Pick<vscode.ExtensionContext, 'secrets'>,
  provider: ProviderId,
): Promise<boolean> {
  if (provider === 'acp') {
    // Configured means an agent is named *and* actually usable — a command that
    // is not installed would otherwise read as a working provider.
    const { AcpAdapter, parseAcpAgentSettings } = await import('../providers/acp.js');
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const agents = parseAcpAgentSettings(configuration.get<unknown>('acp.agents'));
    if (agents.length === 0) {
      return false;
    }
    const inspected = configuration.inspect<boolean>('acp.hideConsoleWindows');
    if (!isAcpConsoleModeChosen(process.platform, [
      inspected?.workspaceFolderValue,
      inspected?.workspaceValue,
      inspected?.globalValue,
    ])) {
      return false;
    }
    const probe = await new AcpAdapter({
      agents,
      hideConsoleWindows: configuration.get<boolean>('acp.hideConsoleWindows', false),
    }).probe().catch(() => undefined);
    return Boolean(probe?.installed && probe.authenticated);
  }
  if (provider === 'copilot') {
    return true;
  }
  if (provider === 'local') {
    return getConfiguredLocalEndpoints({
      getEndpoints: () => vscode.workspace.getConfiguration('atlasmind').get<unknown>('localOpenAiEndpoints'),
      getLegacyBaseUrl: () => vscode.workspace.getConfiguration('atlasmind').get<string>('localOpenAiBaseUrl'),
    }).length > 0;
  }
  if (provider === 'azure') {
    const key = await context.secrets.get?.(getProviderSecretKey(provider));
    return Boolean(key && getConfiguredAzureOpenAiEndpoint() && getConfiguredAzureOpenAiDeployments().length > 0);
  }
  if (provider === 'bedrock') {
    const accessKeyId = await context.secrets.get?.(BEDROCK_ACCESS_KEY_SECRET);
    const secretAccessKey = await context.secrets.get?.(BEDROCK_SECRET_KEY_SECRET);
    return Boolean(accessKeyId && secretAccessKey && getConfiguredBedrockRegion() && getConfiguredBedrockModelIds().length > 0);
  }

  const key = await context.secrets.get?.(getProviderSecretKey(provider));
  return Boolean(key);
}

export function getProviderSecretKey(provider: ProviderId): string {
  return `atlasmind.provider.${provider}.apiKey`;
}

export function requiresApiKey(provider: ProviderId): boolean {
  // ACP reuses the agent's own vendor login, so AtlasMind stores no key for it.
  return provider !== 'copilot' && provider !== 'local'
    && provider !== 'azure' && provider !== 'bedrock' && provider !== 'acp';
}

export function getProviderDisplayName(provider: ProviderId): string {
  switch (provider) {
    case 'acp':
      return 'ACP Agents (subscription)';
    case 'anthropic':
      return 'Anthropic (Claude)';
    case 'openai':
      return 'OpenAI';
    case 'google':
      return 'Google (Gemini)';
    case 'azure':
      return 'Azure OpenAI';
    case 'mistral':
      return 'Mistral';
    case 'deepseek':
      return 'DeepSeek';
    case 'zai':
      return 'z.ai (GLM)';
    case 'bedrock':
      return 'Amazon Bedrock';
    case 'xai':
      return 'xAI (Grok)';
    case 'cohere':
      return 'Cohere';
    case 'perplexity':
      return 'Perplexity';
    case 'huggingface':
      return 'Hugging Face Inference';
    case 'nvidia':
      return 'NVIDIA NIM';
    case 'openrouter':
      return 'OpenRouter';
    case 'groq':
      return 'Groq';
    case 'together':
      return 'Together AI';
    case 'fireworks':
      return 'Fireworks AI';
    case 'qwen':
      return 'Qwen (Alibaba Cloud)';
    case 'moonshot':
      return 'Moonshot AI (Kimi)';
    case 'yi':
      return '01.AI (Yi)';
    case 'minimax':
      return 'MiniMax';
    case 'local':
      return 'Local LLM';
    case 'copilot':
      return 'GitHub Copilot';
    default:
      return provider;
  }
}

export function getProviderActionLabel(provider: ProviderId): string {
  if (provider === 'copilot') {
    return 'Use Session';
  }
  if (provider === 'acp') {
    // ACP stores no key — it reuses the agent's own vendor login, which is why
    // `requiresApiKey` excludes it. Labelling the button "Set API Key" promised
    // a prompt that never comes and hid what the button really does.
    return 'Choose Agent';
  }
  if (provider === 'local' || provider === 'azure' || provider === 'bedrock') {
    return 'Configure';
  }
  return 'Set API Key';
}

async function configureAzureOpenAiProvider(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const endpoint = await vscode.window.showInputBox({
    prompt: 'Enter the Azure OpenAI resource endpoint',
    value: getConfiguredAzureOpenAiEndpoint(),
    placeHolder: 'https://your-resource.openai.azure.com',
    ignoreFocusOut: true,
    validateInput: value => validateAzureEndpoint(value),
  });

  if (endpoint === undefined) {
    return;
  }

  const deploymentInput = await vscode.window.showInputBox({
    prompt: 'Enter Azure OpenAI deployment names (comma separated)',
    value: getConfiguredAzureOpenAiDeployments().join(', '),
    placeHolder: 'gpt-4o, gpt-4.1-mini',
    ignoreFocusOut: true,
    validateInput: value => parseCommaSeparatedValues(value).length === 0 ? 'At least one deployment name is required.' : undefined,
  });

  if (deploymentInput === undefined) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter the Azure OpenAI API key',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'API key cannot be empty.' : undefined,
  });

  if (apiKey === undefined) {
    return;
  }

  await configuration.update(AZURE_OPENAI_ENDPOINT_SETTING, normalizeLocalEndpoint(endpoint), vscode.ConfigurationTarget.Workspace);
  await configuration.update(AZURE_OPENAI_DEPLOYMENTS_SETTING, parseCommaSeparatedValues(deploymentInput), vscode.ConfigurationTarget.Workspace);
  await context.secrets.store(getProviderSecretKey('azure'), apiKey.trim());

  await validateConfiguredProvider(atlas, 'azure', 'Azure OpenAI');
}

async function configureBedrockProvider(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const region = await vscode.window.showInputBox({
    prompt: 'Enter the AWS region for Amazon Bedrock',
    value: getConfiguredBedrockRegion(),
    placeHolder: 'us-east-1',
    ignoreFocusOut: true,
    validateInput: value => validateAwsRegion(value),
  });

  if (region === undefined) {
    return;
  }

  const modelIdsInput = await vscode.window.showInputBox({
    prompt: 'Enter Bedrock model IDs (comma separated)',
    value: getConfiguredBedrockModelIds().join(', '),
    placeHolder: 'anthropic.claude-3-7-sonnet-20250219-v1:0, amazon.nova-pro-v1:0',
    ignoreFocusOut: true,
    validateInput: value => parseCommaSeparatedValues(value).length === 0 ? 'At least one Bedrock model ID is required.' : undefined,
  });

  if (modelIdsInput === undefined) {
    return;
  }

  const accessKeyId = await vscode.window.showInputBox({
    prompt: 'Enter the AWS access key ID',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'Access key ID cannot be empty.' : undefined,
  });

  if (accessKeyId === undefined) {
    return;
  }

  const secretAccessKey = await vscode.window.showInputBox({
    prompt: 'Enter the AWS secret access key',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'Secret access key cannot be empty.' : undefined,
  });

  if (secretAccessKey === undefined) {
    return;
  }

  const sessionToken = await vscode.window.showInputBox({
    prompt: 'Optional AWS session token',
    password: true,
    ignoreFocusOut: true,
  });

  if (sessionToken === undefined) {
    return;
  }

  await configuration.update(BEDROCK_REGION_SETTING, region.trim(), vscode.ConfigurationTarget.Workspace);
  await configuration.update(BEDROCK_MODEL_IDS_SETTING, parseCommaSeparatedValues(modelIdsInput), vscode.ConfigurationTarget.Workspace);
  await context.secrets.store(BEDROCK_ACCESS_KEY_SECRET, accessKeyId.trim());
  await context.secrets.store(BEDROCK_SECRET_KEY_SECRET, secretAccessKey.trim());
  if (sessionToken.trim().length > 0) {
    await context.secrets.store(BEDROCK_SESSION_TOKEN_SECRET, sessionToken.trim());
  } else {
    await context.secrets.delete(BEDROCK_SESSION_TOKEN_SECRET);
  }

  await validateConfiguredProvider(atlas, 'bedrock', 'Amazon Bedrock');
}

async function validateConfiguredProvider(
  atlas: AtlasMindContext,
  provider: ProviderId,
  label: string,
): Promise<void> {
  const adapter = atlas.providerRegistry.get(provider);
  if (adapter) {
    try {
      const models = await adapter.listModels();
      if (models.length > 0) {
        vscode.window.showInformationMessage(`Configured ${label} with ${models.length} model(s).`);
      } else {
        vscode.window.showWarningMessage(`${label} was saved, but no models are currently configured.`);
      }
    } catch (error) {
      vscode.window.showWarningMessage(`${label} settings were saved, but AtlasMind could not validate them yet.`);
      void error;
    }
  }

  await atlas.refreshProviderHealth();
  atlas.modelsRefresh.fire();
}

function validateLocalEndpoint(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Endpoint URL is required.';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Use an http:// or https:// URL.';
    }
    return undefined;
  } catch {
    return 'Enter a valid absolute URL.';
  }
}

function normalizeLocalEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function validateAzureEndpoint(value: string): string | undefined {
  const baseError = validateLocalEndpoint(value);
  if (baseError) {
    return baseError;
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') {
      return 'Azure OpenAI endpoints must use https://.';
    }
    return undefined;
  } catch {
    return 'Enter a valid absolute URL.';
  }
}

function validateAwsRegion(value: string): string | undefined {
  return /^[a-z]{2}-[a-z]+-\d+$/.test(value.trim()) ? undefined : 'Enter a valid AWS region like us-east-1.';
}

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function getConfiguredAzureOpenAiEndpoint(): string {
  const value = vscode.workspace.getConfiguration('atlasmind').get<string>(AZURE_OPENAI_ENDPOINT_SETTING, '');
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function getConfiguredAzureOpenAiDeployments(): string[] {
  const value = vscode.workspace.getConfiguration('atlasmind').get<string[]>(AZURE_OPENAI_DEPLOYMENTS_SETTING, []);
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(item => item.length > 0);
}

function renderMultiplierSyncBanner(syncResult: MultiplierSyncResult | undefined): string {
  if (!syncResult) {
    const staleDays = Math.round(MULTIPLIER_CACHE_STALE_MS / (24 * 60 * 60 * 1000));
    return `
      <div class="sync-banner sync-banner--warn">
        <span class="sync-banner__icon">⚠</span>
        <span class="sync-banner__text">
          Copilot AI credits pricing has not been synced yet.
          Click <strong>Refresh Model Metadata</strong> to fetch the latest per-token prices from
          <a href="${escapeHtml(COPILOT_MULTIPLIER_DOCS_URL)}" class="sync-banner__link">GitHub docs</a>
          (auto-refreshed every ${staleDays} days).
        </span>
      </div>`;
  }

  const syncDate = new Date(syncResult.syncedAt);
  const isStale = isSyncStale(syncResult);
  const formattedDate = syncDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const staleDays = Math.round(MULTIPLIER_CACHE_STALE_MS / (24 * 60 * 60 * 1000));

  if (isStale) {
    return `
      <div class="sync-banner sync-banner--warn">
        <span class="sync-banner__icon">⚠</span>
        <span class="sync-banner__text">
          Copilot AI credits pricing was last synced on <strong>${escapeHtml(formattedDate)}</strong>
          (${escapeHtml(String(syncResult.modelCount))} models). The data is over ${staleDays} days old —
          click <strong>Refresh Model Metadata</strong> to update, or check
          <a href="${escapeHtml(COPILOT_MULTIPLIER_DOCS_URL)}" class="sync-banner__link">GitHub docs</a>
          to override values manually via <code>atlasmind.premiumMultiplierOverrides</code>.
        </span>
      </div>`;
  }

  return `
    <div class="sync-banner sync-banner--ok">
      <span class="sync-banner__icon">✓</span>
      <span class="sync-banner__text">
        Copilot AI credits pricing synced on <strong>${escapeHtml(formattedDate)}</strong>
        (${escapeHtml(String(syncResult.modelCount))} models from
        <a href="${escapeHtml(COPILOT_MULTIPLIER_DOCS_URL)}" class="sync-banner__link">GitHub docs</a>).
        Override individual values via <code>atlasmind.premiumMultiplierOverrides</code>.
      </span>
    </div>`;
}
