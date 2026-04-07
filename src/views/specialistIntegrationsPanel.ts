import * as vscode from 'vscode';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

type SpecialistSurfaceCommand = 'atlasmind.openVoicePanel' | 'atlasmind.openVisionPanel';

interface SpecialistProviderDefinition {
  id: string;
  displayName: string;
  category: string;
  description: string;
  surfaceLabel: string;
  command?: SpecialistSurfaceCommand;
}

const SPECIALIST_PROVIDERS: readonly SpecialistProviderDefinition[] = [
  {
    id: 'exa',
    displayName: 'EXA AI',
    category: 'Search',
    description: 'Research and web retrieval APIs belong on a search integration surface, not the routed chat-provider list.',
    surfaceLabel: 'Search integrations',
  },
  {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    category: 'Voice',
    description: 'Voice synthesis and transcription credentials feed the Voice Panel rather than chat routing.',
    surfaceLabel: 'Voice panel',
    command: 'atlasmind.openVoicePanel',
  },
  {
    id: 'stability',
    displayName: 'Stability AI',
    category: 'Image',
    description: 'Image generation belongs on the vision workflow surface instead of the model router.',
    surfaceLabel: 'Vision panel',
    command: 'atlasmind.openVisionPanel',
  },
  {
    id: 'runway',
    displayName: 'Runway',
    category: 'Video',
    description: 'Video generation and editing need a dedicated media workflow rather than a chat completion adapter.',
    surfaceLabel: 'Media workflow',
  },
  {
    id: 'meta',
    displayName: 'Meta',
    category: 'Future multimodal',
    description: 'Open-source Meta models may appear through other routed providers today; direct specialist support is tracked separately.',
    surfaceLabel: 'Future adapter',
  },
  {
    id: 'ludus',
    displayName: 'Ludus AI',
    category: 'Future multimodal',
    description: 'Ludus AI is tracked as a specialist integration so it does not distort routed-provider assumptions.',
    surfaceLabel: 'Future adapter',
  },
  {
    id: 'reka',
    displayName: 'Reka AI',
    category: 'Future multimodal',
    description: 'Reka AI requires a dedicated adapter path and remains separated from routed chat providers for now.',
    surfaceLabel: 'Future adapter',
  },
  {
    id: 'alephalpha',
    displayName: 'Aleph Alpha',
    category: 'Future multimodal',
    description: 'Aleph Alpha is staged as a specialist integration until AtlasMind adds a dedicated runtime adapter.',
    surfaceLabel: 'Future adapter',
  },
] as const;

type SpecialistProviderId = typeof SPECIALIST_PROVIDERS[number]['id'];

type SpecialistIntegrationsMessage =
  | { type: 'configureProvider'; payload: SpecialistProviderId }
  | { type: 'openCommand'; payload: SpecialistSurfaceCommand }
  | { type: 'openSettings' };

export class SpecialistIntegrationsPanel {
  public static currentPanel: SpecialistIntegrationsPanel | undefined;
  private static readonly viewType = 'atlasmind.specialistIntegrations';
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SpecialistIntegrationsPanel.currentPanel) {
      SpecialistIntegrationsPanel.currentPanel.panel.reveal(column);
      void SpecialistIntegrationsPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SpecialistIntegrationsPanel.viewType,
      'Specialist Integrations',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    SpecialistIntegrationsPanel.currentPanel = new SpecialistIntegrationsPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    void this.refresh();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);
  }

  private dispose(): void {
    SpecialistIntegrationsPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async refresh(): Promise<void> {
    this.panel.webview.html = await this.getHtml();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isSpecialistIntegrationsMessage(message)) {
      return;
    }

    if (message.type === 'openCommand') {
      await vscode.commands.executeCommand(message.payload);
      return;
    }

    if (message.type === 'openSettings') {
      await vscode.commands.executeCommand('atlasmind.openSettings', { page: 'models', query: 'specialist' });
      return;
    }

    await configureSpecialistProvider(this.context, message.payload);
    await this.refresh();
  }

  private async getHtml(): Promise<string> {
    const cards = await Promise.all(SPECIALIST_PROVIDERS.map(async provider => {
      const configured = await isSpecialistProviderConfigured(this.context, provider.id);
      return renderSpecialistCard(provider, configured);
    }));

    const configuredCount = cards.filter(card => card.configured).length;
    const catalogCards = cards.map(card => card.html).join('');
    const liveCards = cards.filter(card => card.page === 'live').map(card => card.html).join('');
    const futureCards = cards.filter(card => card.page === 'future').map(card => card.html).join('');

    return getWebviewHtmlShell({
      title: 'Specialist Integrations',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <div class="panel-hero">
        <div>
          <p class="eyebrow">Non-routing vendors</p>
          <h1>Specialist Integrations</h1>
          <p class="hero-copy">Keep search, voice, image, and video services off the routed chat-provider list while still giving them a dedicated setup surface and a clear path into the right AtlasMind workflow.</p>
        </div>
        <div class="hero-badges" aria-label="Integration summary">
          <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="catalog" data-status-filter="configured" title="Show specialist providers with stored credentials.">${configuredCount} configured</button>
          <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="catalog" data-status-filter="pending" title="Show specialist providers that still need credentials.">${SPECIALIST_PROVIDERS.length - configuredCount} awaiting setup</button>
          <span class="hero-badge" data-tooltip="AtlasMind stores specialist API keys in VS Code SecretStorage so voice, search, image, and video credentials stay out of workspace files." tabindex="0">SecretStorage-backed</span>
        </div>
      </div>

      <div class="search-shell">
        <label class="search-label" for="specialistSearch">Search specialist integrations</label>
        <input id="specialistSearch" type="search" placeholder="Search by provider, category, or workflow" />
        <p id="specialistSearchStatus" class="search-status" aria-live="polite">Browse by category or search for a specialist provider.</p>
      </div>

      <div class="panel-layout">
        <nav class="panel-nav" aria-label="Specialist integration sections" role="tablist" aria-orientation="vertical">
          <button type="button" class="nav-link active" data-page-target="overview" data-search="overview specialist settings voice vision search media">Overview</button>
          <button type="button" class="nav-link" data-page-target="catalog" data-search="catalog all specialist providers configured pending credentials voice vision search image video">All Integrations</button>
          <button type="button" class="nav-link" data-page-target="live" data-search="live search exa voice elevenlabs image stability video runway voice panel vision panel">Live surfaces</button>
          <button type="button" class="nav-link" data-page-target="future" data-search="future meta ludus reka aleph alpha upcoming adapters">Future adapters</button>
        </nav>

        <main class="panel-main">
          <section id="page-overview" class="panel-page active">
            <div class="page-header">
              <p class="page-kicker">Overview</p>
              <h2>Specialist workflow surfaces</h2>
              <p>Configure credentials here, then move into voice or vision workflows without polluting the routed model list.</p>
            </div>

            <div class="action-grid">
              <button id="open-voice" class="action-card action-primary">
                <span class="action-title">Open Voice Panel</span>
                <span class="action-copy">Use speech synthesis and transcription surfaces tied to specialist credentials.</span>
              </button>
              <button id="open-vision" class="action-card">
                <span class="action-title">Open Vision Panel</span>
                <span class="action-copy">Handle multimodal image workflows separately from routed chat providers.</span>
              </button>
              <button id="open-settings" class="action-card">
                <span class="action-title">Open Model Settings</span>
                <span class="action-copy">Jump to the AtlasMind settings models page to review local and provider-adjacent configuration.</span>
              </button>
            </div>

            <div class="summary-grid">
              <article class="summary-card">
                <p class="card-kicker">Status</p>
                <h3>${configuredCount}</h3>
                <p>Specialist vendors currently configured in SecretStorage.</p>
              </article>
              <article class="summary-card">
                <p class="card-kicker">Live surfaces</p>
                <h3>${cards.filter(card => card.page === 'live').length}</h3>
                <p>Providers already mapped to an active AtlasMind workflow surface.</p>
              </article>
              <article class="summary-card">
                <p class="card-kicker">Future adapters</p>
                <h3>${cards.filter(card => card.page === 'future').length}</h3>
                <p>Tracked integrations that stay visible without pretending they are shipped today.</p>
              </article>
            </div>
          </section>

          <section id="page-catalog" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">All Integrations</p>
              <h2>Specialist credential catalog</h2>
              <p>See every specialist adapter in one place, then use the summary chips above to isolate configured or waiting integrations.</p>
            </div>
            <div class="card-grid catalog-grid">
              ${catalogCards}
            </div>
          </section>

          <section id="page-live" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">Live surfaces</p>
              <h2>Available workflows</h2>
              <p>These providers either already map to a concrete AtlasMind panel or represent near-term specialist workflows.</p>
            </div>
            <div class="card-grid">
              ${liveCards}
            </div>
          </section>

          <section id="page-future" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">Future adapters</p>
              <h2>Tracked but not routed</h2>
              <p>These integrations stay visible so they can be managed intentionally without being mistaken for routed chat backends.</p>
            </div>
            <div class="card-grid">
              ${futureCards}
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
        .panel-hero { display: flex; justify-content: space-between; gap: 20px; padding: 20px 22px; margin-bottom: 18px; border: 1px solid var(--atlas-border); border-radius: 18px; background: radial-gradient(circle at top right, color-mix(in srgb, var(--atlas-accent) 14%, transparent), transparent 40%), linear-gradient(160deg, var(--atlas-surface), var(--vscode-editor-background)); }
        .eyebrow, .page-kicker, .card-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.74rem; color: var(--atlas-muted); }
        .panel-hero h1, .page-header h2, .integration-card h3 { margin: 0; }
        .hero-copy, .page-header p:last-child, .integration-copy, .search-status { color: var(--atlas-muted); }
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
        .panel-page { display: none; }
        .panel-page.active { display: block; }
        .action-grid, .summary-grid, .card-grid { display: grid; gap: 12px; }
        .action-grid, .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .action-card, .summary-card, .integration-card { border: 1px solid var(--atlas-border); border-radius: 16px; padding: 16px; background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background)); }
        .action-card { display: flex; flex-direction: column; gap: 6px; text-align: left; }
        .action-primary { border-color: color-mix(in srgb, var(--atlas-accent) 42%, var(--atlas-border)); }
        .action-title { font-weight: 700; }
        .action-copy, .summary-card p:last-child { color: var(--atlas-muted); }
        .summary-card h3 { margin: 0; font-size: 1.8rem; }
        .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .catalog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .integration-card { display: grid; gap: 10px; }
        .integration-card.hidden-by-search { display: none; }
        .integration-card.hidden-by-status { display: none; }
        .integration-topline { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; align-items: flex-start; }
        .integration-badges { display: flex; flex-wrap: wrap; gap: 8px; }
        .status-badge, .meta-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 0.88rem; border: 1px solid var(--atlas-border); }
        .status-badge.configured { background: color-mix(in srgb, var(--vscode-testing-iconPassed) 16%, transparent); }
        .status-badge.pending { background: color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 16%, transparent); }
        .integration-actions { display: flex; flex-wrap: wrap; gap: 10px; }
        .integration-actions button { padding: 6px 12px; }
        .nav-link:hover, .nav-link:focus-visible, .action-card:hover, .action-card:focus-visible, .integration-actions button:focus-visible { outline: 2px solid var(--atlas-accent); outline-offset: 2px; }
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
        const searchInput = document.getElementById('specialistSearch');
        const searchStatus = document.getElementById('specialistSearchStatus');
        const cards = Array.from(document.querySelectorAll('.integration-card'));
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
          cards.forEach(card => {
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
            const statusLabel = activeStatusFilter.length > 0 ? ' matching that status' : '';
            if (normalized.length === 0 && activeStatusFilter.length === 0) {
              searchStatus.textContent = 'Browse by category or search for a specialist provider.';
            } else if (visibleCards === 0) {
              searchStatus.textContent = 'No specialist integrations matched the current filter.';
            } else if (visibleCards === 1) {
              searchStatus.textContent = '1 specialist integration matched' + statusLabel + '.';
            } else {
              searchStatus.textContent = visibleCards + ' specialist integrations matched' + statusLabel + '.';
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
            vscode.postMessage({ type: 'configureProvider', payload: provider });
          });
        });

        document.querySelectorAll('button[data-command]').forEach(button => {
          button.addEventListener('click', () => {
            const command = button.getAttribute('data-command');
            if (!command) {
              return;
            }
            vscode.postMessage({ type: 'openCommand', payload: command });
          });
        });

        const settingsButton = document.getElementById('open-settings');
        if (settingsButton) {
          settingsButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'openSettings' });
          });
        }

        const voiceButton = document.getElementById('open-voice');
        if (voiceButton) {
          voiceButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'openCommand', payload: 'atlasmind.openVoicePanel' });
          });
        }

        const visionButton = document.getElementById('open-vision');
        if (visionButton) {
          visionButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'openCommand', payload: 'atlasmind.openVisionPanel' });
          });
        }
      `,
    });
  }
}

export function isSpecialistIntegrationsMessage(value: unknown): value is SpecialistIntegrationsMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (message.type === 'openSettings') {
    return true;
  }

  if (message.type === 'openCommand') {
    return message.payload === 'atlasmind.openVoicePanel' || message.payload === 'atlasmind.openVisionPanel';
  }

  return message.type === 'configureProvider'
    && typeof message.payload === 'string'
    && SPECIALIST_PROVIDERS.some(provider => provider.id === message.payload);
}

async function configureSpecialistProvider(
  context: vscode.ExtensionContext,
  providerId: SpecialistProviderId,
): Promise<void> {
  const existing = await context.secrets.get(getSpecialistProviderSecretKey(providerId));
  const selection = await vscode.window.showQuickPick([
    { label: existing ? 'Update API key' : 'Store API key', value: 'store' },
    { label: 'Clear saved API key', value: 'clear' },
  ], {
    title: `Configure ${getSpecialistProviderDisplayName(providerId)}`,
    placeHolder: 'Choose how AtlasMind should manage this credential.',
    ignoreFocusOut: true,
  });

  if (!selection) {
    return;
  }

  if (selection.value === 'clear') {
    await context.secrets.delete(getSpecialistProviderSecretKey(providerId));
    vscode.window.showInformationMessage(`Cleared saved credentials for ${getSpecialistProviderDisplayName(providerId)}.`);
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: `Enter the API key for ${getSpecialistProviderDisplayName(providerId)}`,
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'API key cannot be empty.' : undefined,
  });

  if (apiKey === undefined) {
    return;
  }

  await context.secrets.store(getSpecialistProviderSecretKey(providerId), apiKey.trim());
  vscode.window.showInformationMessage(`Stored ${getSpecialistProviderDisplayName(providerId)} credentials in VS Code SecretStorage.`);
}

async function isSpecialistProviderConfigured(
  context: Pick<vscode.ExtensionContext, 'secrets'>,
  providerId: SpecialistProviderId,
): Promise<boolean> {
  const apiKey = await context.secrets.get(getSpecialistProviderSecretKey(providerId));
  return Boolean(apiKey);
}

function getSpecialistProviderSecretKey(providerId: SpecialistProviderId): string {
  return `atlasmind.integration.${providerId}.apiKey`;
}

function getSpecialistProviderDisplayName(providerId: SpecialistProviderId): string {
  return SPECIALIST_PROVIDERS.find(provider => provider.id === providerId)?.displayName ?? providerId;
}

function renderSpecialistCard(
  provider: SpecialistProviderDefinition,
  configured: boolean,
): { page: 'live' | 'future'; configured: boolean; html: string } {
  const page = provider.command || provider.id === 'exa' || provider.id === 'runway' ? 'live' : 'future';
  const search = escapeHtml([
    provider.displayName,
    provider.category,
    provider.surfaceLabel,
    provider.description,
  ].join(' ').toLowerCase());
  const statusClass = configured ? 'configured' : 'pending';
  const surfaceAction = provider.command
    ? `<button type="button" data-command="${provider.command}">Open ${escapeHtml(provider.surfaceLabel)}</button>`
    : '';
  return {
    page,
    configured,
    html: `
      <article class="integration-card" data-search="${search}" data-status="${statusClass}">
        <div class="integration-topline">
          <div>
            <p class="card-kicker">${escapeHtml(provider.category)}</p>
            <h3>${escapeHtml(provider.displayName)}</h3>
          </div>
          <div class="integration-badges">
            <span class="status-badge ${statusClass}">${configured ? 'credential stored' : 'not configured'}</span>
            <span class="meta-badge">${escapeHtml(provider.surfaceLabel)}</span>
          </div>
        </div>
        <p class="integration-copy">${escapeHtml(provider.description)}</p>
        <div class="integration-actions">
          <button type="button" data-provider="${provider.id}">${configured ? 'Update Key' : 'Store Key'}</button>
          ${surfaceAction}
        </div>
      </article>`,
  };
}
