import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { ProviderId } from '../types.js';
import {
  BEDROCK_ACCESS_KEY_SECRET,
  BEDROCK_MODEL_IDS_SETTING,
  BEDROCK_REGION_SETTING,
  BEDROCK_SECRET_KEY_SECRET,
  BEDROCK_SESSION_TOKEN_SECRET,
  CLAUDE_CLI_SETUP_URL,
  getConfiguredBedrockModelIds,
  getConfiguredBedrockRegion,
  getConfiguredLocalEndpoints,
  probeClaudeCli,
} from '../providers/index.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

const AZURE_OPENAI_ENDPOINT_SETTING = 'azureOpenAiEndpoint';
const AZURE_OPENAI_DEPLOYMENTS_SETTING = 'azureOpenAiDeployments';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'claude-cli',
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
  'local',
  'copilot',
];

type ModelProviderMessage =
  | { type: 'saveApiKey'; payload: ProviderId }
  | { type: 'refreshModels' }
  | { type: 'openSpecialistIntegrations' }
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
  }

  private dispose(): void {
    ModelProviderPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private async refresh(): Promise<void> {
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
      case 'refreshModels':
        {
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
        detailsHtml: providerId === 'local' ? getLocalEndpointDetailsHtml() : undefined,
      });
    }));

    const configuredCount = providerCards.filter(card => card.configured).length;
    const failedProviderCount = providerCards.filter(card => card.hasFailures).length;
    const catalogCards = providerCards.map(card => card.html).join('');
    const routedCards = providerCards.filter(card => card.page === 'routed').map(card => card.html).join('');
    const platformCards = providerCards.filter(card => card.page === 'platform').map(card => card.html).join('');

    return getWebviewHtmlShell({
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
          <button type="button" class="nav-link" data-page-target="routed" data-search="routed api anthropic openai google mistral deepseek zai xai cohere perplexity huggingface nvidia">Routed APIs</button>
          <button type="button" class="nav-link" data-page-target="platform" data-search="platform local azure bedrock copilot cloud endpoint deployments aws region">Platform &amp; Local</button>
        </nav>

        <main class="panel-main">
          <section id="page-overview" class="panel-page active">
            <div class="page-header">
              <p class="page-kicker">Overview</p>
              <h2>Provider workspace</h2>
              <p>Refresh catalog metadata, jump to specialist integrations, or open the AtlasMind settings page that holds workspace-scoped endpoint fields.</p>
            </div>

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
        :root {
          --atlas-surface: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-sideBar-background) 20%);
          --atlas-surface-strong: color-mix(in srgb, var(--vscode-editor-background) 64%, var(--vscode-sideBar-background) 36%);
          --atlas-border: var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
          --atlas-accent: var(--vscode-textLink-foreground);
          --atlas-muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
        }
        body { padding: 20px; }
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
        @media (max-width: 920px) {
          .panel-layout, .action-grid, .summary-grid, .card-grid { grid-template-columns: 1fr; }
          .panel-nav { position: static; }
          .panel-hero { flex-direction: column; }
        }
      `,
      scriptContent:
      `
        const vscode = acquireVsCodeApi();
        const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
        const pages = Array.from(document.querySelectorAll('.panel-page'));
        const searchInput = document.getElementById('providerSearch');
        const searchStatus = document.getElementById('providerSearchStatus');
        const providerCards = Array.from(document.querySelectorAll('.provider-card'));
        let activeStatusFilter = '';

        function activatePage(pageId) {
          navButtons.forEach(button => {
            if (!(button instanceof HTMLButtonElement)) {
              return;
            }
            const isActive = button.dataset.pageTarget === pageId;
            button.classList.toggle('active', isActive);
          });
          pages.forEach(page => {
            if (!(page instanceof HTMLElement)) {
              return;
            }
            const isActive = page.id === 'page-' + pageId;
            page.classList.toggle('active', isActive);
            page.hidden = !isActive;
          });
          const state = vscode.getState() ?? {};
          vscode.setState({ ...state, pageId, statusFilter: activeStatusFilter });
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
    if (providerId === 'claude-cli') {
      return { displayName: 'Claude Code CLI (chat only)', badge: configured ? 'Chat only: local CLI ready' : 'Chat only: install CLI + sign in', failureBadge };
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

  return message.type === 'saveApiKey'
    && typeof message.payload === 'string'
    && PROVIDER_IDS.includes(message.payload as ProviderId);
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
        <p class="provider-copy">${escapeHtml(notes)}</p>
        ${options.detailsHtml ?? ''}
        <div class="provider-actions">
          <button type="button" data-provider="${options.providerId}">${escapeHtml(options.actionLabel)}</button>
        </div>
      </article>`,
  };
}

function getProviderFailureCount(atlas: AtlasMindContext, providerId: ProviderId): number {
  const router = atlas.modelRouter as unknown as { getProviderFailureCount?: (id: string) => number } | undefined;
  return typeof router?.getProviderFailureCount === 'function' ? router.getProviderFailureCount(providerId) : 0;
}

function isPlatformProvider(providerId: ProviderId): boolean {
  return providerId === 'copilot' || providerId === 'local' || providerId === 'azure' || providerId === 'bedrock';
}

function getProviderMetaLabel(providerId: ProviderId): string {
  switch (providerId) {
    case 'claude-cli':
      return 'Beta session bridge';
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
    case 'claude-cli':
      return 'Chat-only bridge that reuses an installed Claude Code CLI login in constrained print mode, so AtlasMind remains the orchestrator and tool executor.';
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

export async function configureProvider(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
  provider: ProviderId,
): Promise<void> {
  if (provider === 'claude-cli') {
    const probe = await probeClaudeCli();
    if (!probe.installed) {
      const selection = await vscode.window.showWarningMessage(
        'Claude Code CLI (chat only) is not installed. Install Claude, sign in, then retry this provider.',
        'Open Setup Docs',
      );
      if (selection === 'Open Setup Docs') {
        await vscode.env.openExternal(vscode.Uri.parse(CLAUDE_CLI_SETUP_URL));
      }
      return;
    }

    if (!probe.authenticated) {
      const selection = await vscode.window.showWarningMessage(
        'Claude Code CLI (chat only) is installed but not signed in. Run "claude auth login" in a terminal, then retry this provider.',
        'Open Setup Docs',
      );
      if (selection === 'Open Setup Docs') {
        await vscode.env.openExternal(vscode.Uri.parse(CLAUDE_CLI_SETUP_URL));
      }
      return;
    }

    const summary = await atlas.refreshProviderModels(true);
    await atlas.refreshProviderHealth();
    atlas.modelsRefresh.fire();
    vscode.window.showInformationMessage(
      `Claude Code CLI (chat only) is ready for AtlasMind. Refreshed ${summary.providersUpdated} provider(s) and ${summary.modelsAvailable} model entries.`,
    );
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

  await atlas.refreshProviderHealth();
  atlas.modelsRefresh.fire();
}

export async function isProviderConfigured(
  context: Pick<vscode.ExtensionContext, 'secrets'>,
  provider: ProviderId,
): Promise<boolean> {
  if (provider === 'claude-cli') {
    const probe = await probeClaudeCli();
    return probe.installed && probe.authenticated;
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
  return provider !== 'claude-cli' && provider !== 'copilot' && provider !== 'local' && provider !== 'azure' && provider !== 'bedrock';
}

export function getProviderDisplayName(provider: ProviderId): string {
  switch (provider) {
    case 'claude-cli':
      return 'Claude Code CLI (chat only)';
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
    case 'local':
      return 'Local LLM';
    case 'copilot':
      return 'GitHub Copilot';
  }
}

export function getProviderActionLabel(provider: ProviderId): string {
  if (provider === 'claude-cli') {
    return 'Enable Beta';
  }
  if (provider === 'copilot') {
    return 'Use Session';
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
