/**
 * WebsiteWorkspaceManager — persists the Website Studio's client brief,
 * sitemap, wireframe/design workflow, publishing targets, and n8n plans.
 *
 * This service deliberately models work instead of executing deployments or
 * workflows. Platform credentials, webhook URLs, API keys, and passwords are
 * outside the schema; only human-readable secret references may be stored.
 * All data arriving from a webview or imported JSON passes through the same
 * bounded sanitizer before either SSOT file is written.
 */

import * as path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type {
  ClientWebsiteIntake,
  UiContentDesign,
  UiImplementationGuide,
  UiSurfaceKind,
  WebsiteAutomation,
  WebsiteAutomationStatus,
  WebsiteDesignSystem,
  WebsiteHostingEnvironment,
  WebsiteHostingEnvironmentId,
  WebsitePageLink,
  WebsitePagePlan,
  WebsitePlatformId,
  WebsitePlatformStatus,
  WebsitePlatformTarget,
  WebsiteStackChoice,
  WebsiteWorkspaceConfig,
  WebsiteWorkStatus,
} from '../types.js';
import { isWebsiteFrameworkId, isWebsitePackageManager } from './websiteFrameworks.js';
import { scanMemoryEntry } from '../memory/memoryScanner.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import { deriveSectionLabels, sanitizeWireframe } from './websiteWireframe.js';
import { buildSitemapTree, flattenSitemap, normalizeSlug } from './websiteSitemap.js';
import { buildLinkGraph } from './websiteLinkGraph.js';
import { interpretVersionedDocument } from './schemaMigration.js';
import { applyDesignGraphToPages, designGraphFromPages, sanitizeUiDesignGraph } from './uiDesignGraph.js';

export const WEBSITE_WORKSPACE_SSOT_PATH = 'project_memory/domain/website.json';
export const WEBSITE_WORKSPACE_SUMMARY_SSOT_PATH = 'project_memory/domain/website.md';

const MAX_IMPORTED_JSON_LENGTH = 128_000;
const MAX_PAGES = 80;
const MAX_AUTOMATIONS = 80;
const MAX_LIST_ITEMS = 40;
const MAX_PAGE_LINKS = 40;

/** The format this build writes. Registered in `schemaMigration.ts` as the `website` kind. */
const WEBSITE_SCHEMA_VERSION = 7;

const WORK_STATUSES = new Set<WebsiteWorkStatus>(['not-started', 'draft', 'review', 'approved', 'blocked']);
const PLATFORM_STATUSES = new Set<WebsitePlatformStatus>(['not-planned', 'planned', 'configured', 'live', 'blocked']);
const AUTOMATION_STATUSES = new Set<WebsiteAutomationStatus>(['idea', 'mapped', 'configured', 'verified', 'paused']);
const HOSTING_ENVIRONMENT_IDS: ReadonlyArray<WebsiteHostingEnvironmentId> = ['develop', 'staging', 'production'];
const UI_SURFACE_KINDS = new Set<UiSurfaceKind>([
  'website',
  'web-app',
  'mobile-app',
  'desktop-app',
  'editor-extension',
  'embedded-ui',
  'other',
]);

export type WebsiteHostingReadinessStatus = 'ready' | 'needs-setup' | 'blocked';

export interface WebsiteHostingReadiness {
  id: WebsiteHostingEnvironmentId;
  status: WebsiteHostingReadinessStatus;
  issues: string[];
}

export const WEBSITE_PLATFORM_CATALOG: ReadonlyArray<{
  id: WebsitePlatformId;
  label: string;
  description: string;
  mode: 'static' | 'managed' | 'commerce' | 'custom';
}> = [
  { id: 'cloudflare-pages', label: 'Cloudflare Pages', description: 'Static/JAMstack hosting with preview deployments and edge delivery.', mode: 'static' },
  { id: 'github-pages', label: 'GitHub Pages', description: 'Repository-backed static hosting for documentation and simple sites.', mode: 'static' },
  { id: 'wordpress-elementor', label: 'WordPress + Elementor', description: 'Managed CMS workflow with Elementor visual page composition.', mode: 'managed' },
  { id: 'wordpress', label: 'WordPress', description: 'Theme/block-based WordPress delivery without an Elementor dependency.', mode: 'managed' },
  { id: 'vercel', label: 'Vercel', description: 'Preview-first hosting for Next.js and other frontend frameworks.', mode: 'static' },
  { id: 'netlify', label: 'Netlify', description: 'Git-connected web hosting with previews, forms, and edge functions.', mode: 'static' },
  { id: 'azure-static-web-apps', label: 'Azure Static Web Apps', description: 'Azure-hosted static frontend and API integration.', mode: 'static' },
  { id: 'shopify', label: 'Shopify', description: 'Commerce storefront, theme, and content managed through Shopify.', mode: 'commerce' },
  { id: 'webflow', label: 'Webflow', description: 'Visual site design and managed CMS publishing.', mode: 'managed' },
  { id: 'custom', label: 'Custom / Other', description: 'A self-hosted or specialist platform described by the project team.', mode: 'custom' },
];

const PLATFORM_IDS = new Set<WebsitePlatformId>(WEBSITE_PLATFORM_CATALOG.map(platform => platform.id));

export interface WebsiteBootstrapSeed {
  clientName?: string;
  projectName?: string;
  summary?: string;
  goals?: string[];
  audiences?: string[];
  requiredFeatures?: string[];
  brandNotes?: string;
  constraints?: string[];
  successMetrics?: string[];
  targetLaunch?: string;
  budget?: string;
  platformHint?: string;
}

export function createDefaultWebsiteWorkspace(seed: WebsiteBootstrapSeed = {}): WebsiteWorkspaceConfig {
  const now = new Date().toISOString();
  const primaryPlatform = inferPlatformId(seed.platformHint);
  const pages = [
    defaultPage('page-home', 'Home', '/', 'Explain the offer quickly and guide the primary audience to the main action.', ['Hero', 'Proof', 'Services or benefits', 'Primary call to action'], 0),
    defaultPage('page-about', 'About', '/about', 'Build trust through the client story, approach, and credentials.', ['Story', 'Values', 'Team or credentials', 'Call to action'], 1),
    defaultPage('page-services', 'Services', '/services', 'Describe the core services or products and help visitors choose a next step.', ['Service overview', 'Service detail', 'Process', 'Call to action'], 2),
    defaultPage('page-contact', 'Contact', '/contact', 'Give qualified visitors a clear, accessible way to make contact.', ['Contact options', 'Enquiry form', 'Location or availability', 'Privacy note'], 3),
  ];
  return {
    version: WEBSITE_SCHEMA_VERSION,
    updatedAt: now,
    surfaceKind: 'website',
    designPrompt: '',
    intake: {
      clientName: cleanText(seed.clientName, 160),
      projectName: cleanText(seed.projectName, 160),
      summary: cleanText(seed.summary, 4_000),
      goals: cleanStringList(seed.goals, MAX_LIST_ITEMS, 500),
      audiences: cleanStringList(seed.audiences, MAX_LIST_ITEMS, 500),
      requiredFeatures: cleanStringList(seed.requiredFeatures, MAX_LIST_ITEMS, 500),
      contentSources: [],
      brandNotes: cleanText(seed.brandNotes, 4_000),
      constraints: cleanStringList(seed.constraints, MAX_LIST_ITEMS, 500),
      successMetrics: cleanStringList(seed.successMetrics, MAX_LIST_ITEMS, 500),
      targetLaunch: optionalText(seed.targetLaunch, 160),
      budget: optionalText(seed.budget, 160),
      stakeholders: [],
    },
    pages,
    designGraph: designGraphFromPages(pages),
    designSystem: defaultDesignSystem(seed.brandNotes),
    contentDesign: defaultContentDesign(),
    implementation: defaultImplementationGuide(),
    platforms: WEBSITE_PLATFORM_CATALOG.map(platform => ({
      id: platform.id,
      label: platform.label,
      status: platform.id === primaryPlatform ? 'planned' : 'not-planned',
      primary: platform.id === primaryPlatform,
      notes: '',
    })),
    hostingEnvironments: createDefaultHostingEnvironments(),
    automations: [],
  };
}

export function sanitizeWebsiteWorkspace(input: unknown): WebsiteWorkspaceConfig {
  const source = asRecord(input);
  const fallback = createDefaultWebsiteWorkspace();
  const intake = sanitizeClientWebsiteIntake(source['intake']);
  const pages = sanitizePages(source['pages']);
  const selectedPages = pages.length > 0 ? pages : fallback.pages;
  const designGraph = sanitizeUiDesignGraph(source['designGraph'], selectedPages);
  const projectedPages = applyDesignGraphToPages(selectedPages, designGraph);
  const designSystem = sanitizeDesignSystem(source['designSystem']);
  const contentDesign = sanitizeContentDesign(source['contentDesign']);
  const implementation = sanitizeImplementationGuide(source['implementation']);
  const platforms = sanitizePlatforms(source['platforms']);
  const hostingEnvironments = sanitizeHostingEnvironments(source['hostingEnvironments']);
  const automations = sanitizeAutomations(source['automations']);

  const stack = sanitizeStackChoice(source['stack'], platforms.length > 0 ? platforms : fallback.platforms);

  return {
    version: WEBSITE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    surfaceKind: UI_SURFACE_KINDS.has(source['surfaceKind'] as UiSurfaceKind)
      ? source['surfaceKind'] as UiSurfaceKind
      : 'website',
    designPrompt: cleanText(source['designPrompt'], 4_000),
    intake,
    pages: projectedPages,
    designGraph,
    designSystem,
    contentDesign,
    implementation,
    platforms: platforms.length > 0 ? platforms : fallback.platforms,
    hostingEnvironments,
    automations,
    ...(stack ? { stack } : {}),
  };
}

/**
 * The framework/platform choice.
 *
 * Returns `undefined` for anything unrecognised rather than defaulting to a
 * framework. A defaulted stack would read as a decision somebody made, and the
 * setup planner would scaffold from it — so an unknown value has to mean "not
 * chosen", not "probably Astro".
 */
function sanitizeStackChoice(
  input: unknown,
  platforms: readonly WebsitePlatformTarget[],
): WebsiteStackChoice | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const source = input as Record<string, unknown>;
  if (!isWebsiteFrameworkId(source['frameworkId'])) {
    return undefined;
  }
  const platformId = PLATFORM_IDS.has(source['platformId'] as WebsitePlatformId)
    ? source['platformId'] as WebsitePlatformId
    // Falling back to the primary platform rather than dropping the whole
    // choice: the framework half is still a real decision worth keeping.
    : platforms.find(platform => platform.primary)?.id;
  if (!platformId) {
    return undefined;
  }
  return {
    frameworkId: source['frameworkId'],
    platformId,
    packageManager: isWebsitePackageManager(source['packageManager']) ? source['packageManager'] : 'npm',
    decidedAt: cleanIsoDate(source['decidedAt']),
  };
}

/** An ISO timestamp, or now. A malformed date is not worth refusing a choice over. */
function cleanIsoDate(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Evaluate the fixed website delivery pipeline without performing deployment.
 * Missing setup remains editable, while insecure URLs or invalid staging
 * topology are blocked from being treated as promotion-ready.
 */
export function assessWebsiteHostingEnvironments(
  config: Pick<WebsiteWorkspaceConfig, 'hostingEnvironments'>,
): WebsiteHostingReadiness[] {
  const environments = new Map(config.hostingEnvironments.map(environment => [environment.id, environment]));
  const production = environments.get('production');

  return HOSTING_ENVIRONMENT_IDS.map(id => {
    const environment = environments.get(id);
    if (!environment) {
      return { id, status: 'blocked', issues: [`The fixed ${id} environment is missing.`] };
    }

    const missing: string[] = [];
    const blocked: string[] = [];
    if (id === 'develop') {
      if (environment.hostingMode === 'local') {
        if (!environment.url) {
          missing.push('Add a loopback development URL.');
        } else if (!isLoopbackUrl(environment.url)) {
          blocked.push('Local Develop must use localhost, 127.0.0.1, or ::1.');
        }
      } else {
        if (!environment.url) {
          missing.push('Add the hosted Develop fallback URL.');
        } else if (!isHttpsUrl(environment.url)) {
          blocked.push('Hosted Develop must use HTTPS.');
        }
        if (!environment.credentialReference) {
          missing.push('Add a password credential reference for hosted Develop.');
        }
      }
    } else if (id === 'staging') {
      if (!environment.url) {
        missing.push('Add the Staging review URL.');
      } else if (!isHttpsUrl(environment.url)) {
        blocked.push('Staging must use HTTPS.');
      }
      if (!environment.credentialReference) {
        missing.push('Add a password credential reference for Staging.');
      }
      if (!production?.url) {
        missing.push('Add the Production URL so the review subdomain can be validated.');
      } else if (environment.url && !isExpectedReviewSubdomain(
        environment.url,
        production.url,
        environment.subdomainLabel ?? 'staging',
      )) {
        blocked.push(`Staging must use ${environment.subdomainLabel ?? 'staging'}.<production-domain>.`);
      }
    } else {
      if (!environment.url) {
        missing.push('Add the public Production URL.');
      } else if (!isHttpsUrl(environment.url)) {
        blocked.push('Production must use HTTPS.');
      }
    }

    return {
      id,
      status: blocked.length > 0 ? 'blocked' : missing.length > 0 ? 'needs-setup' : 'ready',
      issues: [...blocked, ...missing],
    };
  });
}

export function importClientWebsiteIntake(
  current: WebsiteWorkspaceConfig,
  jsonText: string,
): WebsiteWorkspaceConfig {
  if (typeof jsonText !== 'string' || jsonText.length === 0) {
    throw new Error('Paste a JSON client intake before importing.');
  }
  if (jsonText.length > MAX_IMPORTED_JSON_LENGTH) {
    throw new Error(`Client intake is too large. The maximum supported JSON size is ${MAX_IMPORTED_JSON_LENGTH.toLocaleString()} characters.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error('Client intake is not valid JSON.');
  }

  const root = asRecord(parsed);
  const client = asRecord(root['client']);
  const website = asRecord(root['website']);
  const merged: Record<string, unknown> = { ...client, ...website, ...root };
  delete merged['client'];
  delete merged['website'];

  const imported = sanitizeClientWebsiteIntake({
    clientName: firstValue(merged, ['clientName', 'companyName', 'businessName', 'organisation', 'organization']),
    projectName: firstValue(merged, ['projectName', 'websiteName', 'siteName']),
    summary: firstValue(merged, ['summary', 'brief', 'description', 'overview']),
    goals: firstValue(merged, ['goals', 'objectives', 'websiteGoals']),
    audiences: firstValue(merged, ['audiences', 'audience', 'targetAudience', 'personas']),
    requiredFeatures: firstValue(merged, ['requiredFeatures', 'features', 'functionality', 'requirements']),
    contentSources: firstValue(merged, ['contentSources', 'content', 'existingContent', 'assets']),
    brandNotes: firstValue(merged, ['brandNotes', 'brand', 'visualDirection', 'style']),
    constraints: firstValue(merged, ['constraints', 'risks', 'limitations']),
    successMetrics: firstValue(merged, ['successMetrics', 'metrics', 'kpis']),
    targetLaunch: firstValue(merged, ['targetLaunch', 'launchDate', 'deadline', 'timeline']),
    budget: firstValue(merged, ['budget', 'projectBudget']),
    stakeholders: firstValue(merged, ['stakeholders', 'contacts', 'approvers']),
  });

  return sanitizeWebsiteWorkspace({
    ...current,
    intake: {
      clientName: imported.clientName || current.intake.clientName,
      projectName: imported.projectName || current.intake.projectName,
      summary: imported.summary || current.intake.summary,
      goals: imported.goals.length > 0 ? imported.goals : current.intake.goals,
      audiences: imported.audiences.length > 0 ? imported.audiences : current.intake.audiences,
      requiredFeatures: imported.requiredFeatures.length > 0 ? imported.requiredFeatures : current.intake.requiredFeatures,
      contentSources: imported.contentSources.length > 0 ? imported.contentSources : current.intake.contentSources,
      brandNotes: imported.brandNotes || current.intake.brandNotes,
      constraints: imported.constraints.length > 0 ? imported.constraints : current.intake.constraints,
      successMetrics: imported.successMetrics.length > 0 ? imported.successMetrics : current.intake.successMetrics,
      targetLaunch: imported.targetLaunch ?? current.intake.targetLaunch,
      budget: imported.budget ?? current.intake.budget,
      stakeholders: imported.stakeholders.length > 0 ? imported.stakeholders : current.intake.stakeholders,
    },
  });
}

export function renderWebsiteWorkspaceMarkdown(config: WebsiteWorkspaceConfig): string {
  const primary = config.platforms.find(platform => platform.primary);
  const lines = [
    '# UI Studio',
    '',
    `> Updated ${config.updatedAt}. This mirror is generated from \`${WEBSITE_WORKSPACE_SSOT_PATH}\`.`,
    '',
    '## Client Brief',
    '',
    `- Client: ${markdownValue(config.intake.clientName)}`,
    `- Project: ${markdownValue(config.intake.projectName)}`,
    `- Interface profile: ${config.surfaceKind}`,
    `- Summary: ${markdownValue(config.intake.summary)}`,
    `- Target launch: ${markdownValue(config.intake.targetLaunch)}`,
    `- Budget: ${markdownValue(config.intake.budget)}`,
    `- Primary platform: ${markdownValue(primary?.label)}`,
    '',
    '### Goals',
    '',
    ...markdownList(config.intake.goals),
    '',
    '### Audiences',
    '',
    ...markdownList(config.intake.audiences),
    '',
    '### Required Features',
    '',
    ...markdownList(config.intake.requiredFeatures),
    '',
    '## Sitemap & Production Workflow',
    '',
    ...renderSitemapOutline(config),
    '',
    '| Page | Slug | Links to | Wireframe | UI design | Content | SEO |',
    '|---|---|---|---:|---:|---:|---:|',
    ...renderPageRows(config),
    '',
    `Design graph revision: ${config.designGraph.revision}. Screens: ${config.designGraph.screens.length}. Tokens: ${config.designGraph.tokens.length}.`,
    '',
    ...renderLinkFindings(config),
    '## Page Design Prompts',
    '',
    ...renderDesignPrompts(config),
    '',
    '## Content Design',
    '',
    `- Voice: ${markdownValue(config.contentDesign.voice)}`,
    `- Reading level: ${markdownValue(config.contentDesign.readingLevel)}`,
    `- Locales: ${markdownValue(config.contentDesign.locales.join(', '))}`,
    `- Accessibility notes: ${markdownValue(config.contentDesign.accessibilityNotes)}`,
    '',
    '### Principles',
    '',
    ...markdownList(config.contentDesign.principles),
    '',
    '### Preferred terms',
    '',
    ...markdownList(config.contentDesign.preferredTerms),
    '',
    '### Avoided terms',
    '',
    ...markdownList(config.contentDesign.avoidedTerms),
    '',
    '## UI System',
    '',
    `- Brand direction: ${markdownValue(config.designSystem.brandDirection)}`,
    `- Tone: ${markdownValue(config.designSystem.tone)}`,
    `- Palette: ${config.designSystem.primaryColor}, ${config.designSystem.secondaryColor}, ${config.designSystem.accentColor}`,
    `- Typography: ${markdownValue(config.designSystem.headingFont)} headings / ${markdownValue(config.designSystem.bodyFont)} body`,
    `- Accessibility target: ${markdownValue(config.designSystem.accessibilityTarget)}`,
    '',
    '## Implementation Guide',
    '',
    `- Target technologies: ${markdownValue(config.implementation.targetTechnologies.join(', '))}`,
    `- Source roots: ${markdownValue(config.implementation.sourceRoots.join(', '))}`,
    `- Component locations: ${markdownValue(config.implementation.componentLocations.join(', '))}`,
    '',
    ...markdownList(config.implementation.notes),
    '',
    '## Hosting Environments',
    '',
    '| Environment | Hosting | Access | URL | Branch/reference | Promotion guard |',
    '|---|---|---|---|---|---|',
    ...config.hostingEnvironments.map(environment =>
      `| ${environment.name} | ${environment.hostingMode} | ${environment.accessPolicy} | ${escapeMarkdownCell(environment.url ?? '—')} | ${escapeMarkdownCell(environment.branchReference ?? '—')} | ${environment.promotionProtected ? 'Protected' : 'Standard'} |`),
    '',
    ...assessWebsiteHostingEnvironments(config).flatMap(readiness => {
      const environment = config.hostingEnvironments.find(candidate => candidate.id === readiness.id);
      const summary = `- ${environment?.name ?? readiness.id}: **${readiness.status}**`;
      return readiness.issues.length > 0
        ? [summary, ...readiness.issues.map(issue => `  - ${issue}`)]
        : [summary];
    }),
    '',
    '> Develop is loopback-only unless explicitly switched to the password-protected hosted fallback. Staging is always password-protected and must use the configured review subdomain of Production. Production is public and promotion-protected.',
    '',
    '## Publishing Targets',
    '',
    '| Platform | Role | Status | Site | Project/environment reference |',
    '|---|---|---|---|---|',
    ...config.platforms
      .filter(platform => platform.primary || platform.status !== 'not-planned')
      .map(platform =>
        `| ${escapeMarkdownCell(platform.label)} | ${platform.primary ? 'Primary' : 'Alternative'} | ${platform.status} | ${escapeMarkdownCell(platform.siteUrl ?? '—')} | ${escapeMarkdownCell([platform.projectReference, platform.environmentReference].filter(Boolean).join(' / ') || '—')} |`),
    '',
    '## n8n Automations',
    '',
    config.automations.length > 0
      ? '| Workflow | Event | Outcome | Status | Credential reference |'
      : '_No n8n automations mapped yet._',
    ...(config.automations.length > 0
      ? [
          '|---|---|---|---|---|',
          ...config.automations.map(automation =>
            `| ${escapeMarkdownCell(automation.name)} | ${escapeMarkdownCell(automation.event)} | ${escapeMarkdownCell(automation.outcome)} | ${automation.status} | ${escapeMarkdownCell(automation.credentialReference ?? '—')} |`),
        ]
      : []),
    '',
    '> Security boundary: UI Studio stores only secret references. It never stores API keys, passwords, n8n webhook URLs, or credential values, and it never deploys or triggers a workflow without a separate guarded action.',
    '',
  ];
  return lines.join('\n');
}

/** What `load()` found, for callers that need to know rather than just read. */
export interface WebsiteWorkspaceRead {
  config: WebsiteWorkspaceConfig;
  /**
   * True when a real file exists that this build must not write over — it was
   * written by a newer AtlasMind. The panel renders read-only and refuses to
   * save rather than replacing a format it does not understand.
   */
  preserveExisting: boolean;
  /** A sentence for the user about the file itself: migrated, or refused. */
  notice?: string;
}

export class WebsiteWorkspaceManager {
  public constructor(private readonly workspaceRoot?: string) {}

  public exists(): boolean {
    return Boolean(this.workspaceRoot && existsSync(path.join(this.workspaceRoot, WEBSITE_WORKSPACE_SSOT_PATH)));
  }

  public load(): WebsiteWorkspaceConfig {
    return this.read().config;
  }

  /**
   * Read the file and say what happened to it.
   *
   * Routed through `interpretVersionedDocument` rather than the old
   * `try { parse } catch { default }`, which collapsed two very different
   * situations into one: a corrupt file (safe to replace) and a file written by
   * a *newer* AtlasMind (never safe to replace). The old path would hand back a
   * default, and the first save would then overwrite a colleague's newer format
   * with this build's idea of the schema — silently, and in a git-tracked file.
   */
  public read(): WebsiteWorkspaceRead {
    if (!this.workspaceRoot) {
      return { config: createDefaultWebsiteWorkspace(), preserveExisting: false };
    }
    let parsed: unknown;
    try {
      const raw = readFileSync(path.join(this.workspaceRoot, WEBSITE_WORKSPACE_SSOT_PATH), 'utf8');
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // Absent or unparseable. Both are safe to replace; neither is a refusal.
      return { config: createDefaultWebsiteWorkspace(), preserveExisting: false };
    }

    const outcome = interpretVersionedDocument<Record<string, unknown>>(
      'website',
      parsed,
      isRecordCandidate,
    );

    if (outcome.preserveExisting) {
      return {
        config: createDefaultWebsiteWorkspace(),
        preserveExisting: true,
        ...(outcome.notice ? { notice: outcome.notice } : {}),
      };
    }

    return {
      config: sanitizeWebsiteWorkspace(outcome.config ?? parsed),
      preserveExisting: false,
      ...(outcome.notice ? { notice: outcome.notice } : {}),
    };
  }

  public async save(input: unknown): Promise<WebsiteWorkspaceConfig> {
    if (!this.workspaceRoot) {
      throw new Error('Open a workspace folder before saving UI Studio.');
    }
    // The refusal is re-checked here rather than trusted from a previous read:
    // the file can be replaced between opening the panel and pressing save, and
    // this is the last point before a write.
    if (this.read().preserveExisting) {
      throw new Error(
        'This project\'s website.json was written by a newer version of AtlasMind. '
        + 'Update AtlasMind to edit it — saving now would overwrite settings this build cannot read.',
      );
    }
    const config = sanitizeWebsiteWorkspace(input);
    const jsonPath = path.join(this.workspaceRoot, WEBSITE_WORKSPACE_SSOT_PATH);
    const markdownPath = path.join(this.workspaceRoot, WEBSITE_WORKSPACE_SUMMARY_SSOT_PATH);
    const serialized = `${JSON.stringify(config, null, 2)}\n`;
    const markdown = renderWebsiteWorkspaceMarkdown(config);
    const blockedScan = [
      scanMemoryEntry(WEBSITE_WORKSPACE_SSOT_PATH, serialized),
      scanMemoryEntry(WEBSITE_WORKSPACE_SUMMARY_SSOT_PATH, markdown),
    ].find(result => result.status === 'blocked');
    if (blockedScan) {
      const issue = blockedScan.issues.find(candidate => candidate.severity === 'error');
      throw new Error(`UI Studio blocked unsafe SSOT content${issue ? `: ${issue.message}` : '.'}`);
    }
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, serialized, 'utf8');
    await writeFile(markdownPath, markdown, 'utf8');
    return config;
  }
}

/**
 * The hierarchy as an indented outline.
 *
 * The mirror is the artefact a client or a colleague actually reads in a pull
 * request, and a flat table cannot show that Pricing sits under Services. The
 * outline is generated from the same `buildSitemapTree` the panel draws, so the
 * committed document and the screen cannot disagree about the shape of the site.
 */
function renderSitemapOutline(config: WebsiteWorkspaceConfig): string[] {
  const tree = buildSitemapTree(config.pages);
  const nodes = flattenSitemap(tree);
  if (nodes.length === 0) {
    return ['_No pages planned yet._'];
  }
  const lines = nodes.map(node => {
    const indent = '  '.repeat(node.depth);
    // A derived edge is marked, so nobody reads an inferred hierarchy as a
    // stated one.
    const marker = node.parentSource === 'slug' ? ' _(from slug)_' : node.parentSource === 'orphaned' ? ' _(no parent found)_' : '';
    return `${indent}- **${escapeMarkdownCell(node.page.title)}** \`${escapeMarkdownCell(normalizeSlug(node.page.slug))}\`${marker}`;
  });
  const findings = tree.findings.map(finding => `- ⚠️ ${escapeMarkdownCell(finding.message)}`);
  return findings.length > 0 ? [...lines, '', ...findings] : lines;
}

function renderPageRows(config: WebsiteWorkspaceConfig): string[] {
  const graph = buildLinkGraph(config.pages);
  const titles = new Map(config.pages.map(page => [page.id, page.title]));
  return config.pages.map(page => {
    const summary = graph.byPageId.get(page.id);
    const destinations = (summary?.outbound ?? []).map(resolved => {
      if (resolved.dangling) {
        return '⚠️ missing page';
      }
      return resolved.targetPageId
        ? titles.get(resolved.targetPageId) ?? resolved.targetPageId
        : resolved.externalUrl ?? '';
    }).filter(value => value.length > 0);
    const linkCell = destinations.length > 0 ? destinations.join(', ') : '—';
    return `| ${escapeMarkdownCell(page.title)} | \`${escapeMarkdownCell(page.slug)}\` | ${escapeMarkdownCell(linkCell)} | ${page.wireframeStatus} | ${page.designStatus} | ${page.contentStatus} | ${page.seoStatus} |`;
  });
}

/**
 * Orphan pages and broken links, in the mirror rather than only on screen.
 *
 * These are the findings a reviewer wants in the diff — "nothing links to the
 * new Pricing page" is a review comment, and it belongs in the file that gets
 * reviewed.
 */
function renderLinkFindings(config: WebsiteWorkspaceConfig): string[] {
  const graph = buildLinkGraph(config.pages);
  if (graph.findings.length === 0) {
    return [];
  }
  return [
    '### Navigation findings',
    '',
    ...graph.findings.map(finding => `- ${escapeMarkdownCell(finding.message)}`),
    '',
  ];
}

function renderDesignPrompts(config: WebsiteWorkspaceConfig): string[] {
  const lines: string[] = [];
  if (config.designPrompt.trim().length > 0) {
    lines.push(`**Whole site:** ${escapeMarkdownCell(config.designPrompt)}`, '');
  }
  const written = config.pages.filter(page => page.designPrompt.trim().length > 0);
  if (written.length === 0) {
    lines.push('_No page design prompts written yet. A page with a prompt can be generated from the sitemap without being drawn._');
    return lines;
  }
  for (const page of written) {
    lines.push(`- **${escapeMarkdownCell(page.title)}:** ${escapeMarkdownCell(page.designPrompt)}`);
  }
  return lines;
}

/**
 * The shape check `interpretVersionedDocument` needs.
 *
 * Deliberately shallow. The full validation is `sanitizeWebsiteWorkspace`, which
 * coerces rather than rejects — a file missing one field is repairable, and
 * treating it as corrupt would discard the rest of somebody's work. This guard
 * only answers "is this a JSON object at all?", which is the question that
 * separates a usable file from a truncated one.
 */
function isRecordCandidate(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Seed Website Studio during project bootstrap without overwriting an existing client plan. */
export async function seedWebsiteWorkspace(
  workspaceRoot: string,
  seed: WebsiteBootstrapSeed,
): Promise<boolean> {
  const manager = new WebsiteWorkspaceManager(workspaceRoot);
  if (manager.exists()) {
    return false;
  }
  await manager.save(createDefaultWebsiteWorkspace(seed));
  return true;
}

function defaultPage(
  id: string,
  title: string,
  slug: string,
  purpose: string,
  sections: string[],
  order: number,
): WebsitePagePlan {
  return {
    id,
    title,
    slug,
    purpose,
    template: 'Standard page',
    sections,
    wireframeNotes: '',
    designNotes: '',
    wireframeStatus: 'not-started',
    designStatus: 'not-started',
    contentStatus: 'not-started',
    seoStatus: 'not-started',
    order,
    // Left empty on purpose. A seeded design prompt would be a design decision
    // AtlasMind made on the author's behalf, and it would then be generated from
    // as though somebody had written it.
    designPrompt: '',
    links: [],
  };
}

function defaultDesignSystem(brandNotes?: string): WebsiteDesignSystem {
  return {
    brandDirection: cleanText(brandNotes, 4_000),
    tone: '',
    primaryColor: '#2563eb',
    secondaryColor: '#0f172a',
    accentColor: '#14b8a6',
    headingFont: 'System sans-serif',
    bodyFont: 'System sans-serif',
    spacingScale: '4 / 8 / 12 / 16 / 24 / 32 / 48 / 64',
    cornerStyle: '8px',
    accessibilityTarget: 'WCAG 2.2 AA',
    componentNotes: [],
  };
}

function defaultContentDesign(): UiContentDesign {
  return {
    voice: '',
    principles: [],
    preferredTerms: [],
    avoidedTerms: [],
    readingLevel: '',
    locales: [],
    accessibilityNotes: '',
  };
}

function defaultImplementationGuide(): UiImplementationGuide {
  return {
    targetTechnologies: [],
    sourceRoots: [],
    componentLocations: [],
    notes: [],
  };
}

function createDefaultHostingEnvironments(): WebsiteHostingEnvironment[] {
  return [
    {
      id: 'develop',
      name: 'Develop',
      purpose: 'Local implementation and private team quality assurance.',
      hostingMode: 'local',
      accessPolicy: 'local-only',
      url: 'http://localhost:3000/',
      notes: '',
      promotionProtected: false,
    },
    {
      id: 'staging',
      name: 'Staging',
      purpose: 'Password-protected client review on a subdomain of the production site.',
      hostingMode: 'hosted',
      accessPolicy: 'password-protected',
      subdomainLabel: 'staging',
      notes: '',
      promotionProtected: false,
    },
    {
      id: 'production',
      name: 'Production',
      purpose: 'Public live website with guarded promotion and verification.',
      hostingMode: 'hosted',
      accessPolicy: 'public',
      notes: '',
      promotionProtected: true,
    },
  ];
}

function sanitizeClientWebsiteIntake(input: unknown): ClientWebsiteIntake {
  const source = asRecord(input);
  return {
    clientName: cleanText(source['clientName'], 160),
    projectName: cleanText(source['projectName'], 160),
    summary: cleanText(source['summary'], 4_000),
    goals: valueToStringList(source['goals']),
    audiences: valueToStringList(source['audiences']),
    requiredFeatures: valueToStringList(source['requiredFeatures']),
    contentSources: valueToStringList(source['contentSources']),
    brandNotes: cleanText(source['brandNotes'], 4_000),
    constraints: valueToStringList(source['constraints']),
    successMetrics: valueToStringList(source['successMetrics']),
    targetLaunch: optionalText(source['targetLaunch'], 160),
    budget: optionalText(source['budget'], 160),
    stakeholders: valueToStringList(source['stakeholders']),
  };
}

function sanitizePages(input: unknown): WebsitePagePlan[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const usedIds = new Set<string>();
  const pages = input.slice(0, MAX_PAGES).map((item, index): WebsitePagePlan => {
    const source = asRecord(item);
    const title = cleanText(source['title'], 160) || `Page ${index + 1}`;
    const id = uniqueId(cleanIdentifier(source['id']) || `page-${slugify(title) || index + 1}`, usedIds);
    const wireframe = sanitizeWireframe(source['wireframe']);
    const parentId = cleanIdentifier(source['parentId']);
    return {
      id,
      title,
      slug: cleanSlug(source['slug'], title),
      purpose: cleanText(source['purpose'], 2_000),
      template: cleanText(source['template'], 160) || 'Standard page',
      // Derived from the canvas where there is one, so the drawing is the single
      // source of truth and the two lists cannot disagree. A page with no
      // wireframe keeps whatever `sections` it already had.
      sections: wireframe && wireframe.elements.length > 0
        ? deriveSectionLabels(wireframe)
        : valueToStringList(source['sections']),
      wireframeNotes: cleanText(source['wireframeNotes'], 4_000),
      designNotes: cleanText(source['designNotes'], 4_000),
      wireframeStatus: cleanStatus(source['wireframeStatus'], WORK_STATUSES, 'not-started'),
      designStatus: cleanStatus(source['designStatus'], WORK_STATUSES, 'not-started'),
      contentStatus: cleanStatus(source['contentStatus'], WORK_STATUSES, 'not-started'),
      seoStatus: cleanStatus(source['seoStatus'], WORK_STATUSES, 'not-started'),
      // A self-parent is dropped rather than refused: it is always a UI slip,
      // never an intent, and the page is still perfectly usable at the top level.
      ...(parentId && parentId !== id ? { parentId } : {}),
      order: cleanOrder(source['order'], index),
      designPrompt: cleanText(source['designPrompt'], 2_000),
      links: sanitizePageLinks(source['links']),
      ...(wireframe ? { wireframe } : {}),
    };
  });

  // Parent ids are resolved only once every page id is known — a page may name a
  // parent that appears later in the array, and dropping it on a first pass
  // would flatten hierarchies purely on file ordering.
  const knownIds = new Set(pages.map(page => page.id));
  return pages.map(page => (page.parentId && !knownIds.has(page.parentId))
    ? stripPageParent(page)
    : page);
}

function stripPageParent(page: WebsitePagePlan): WebsitePagePlan {
  const { parentId: _dropped, ...rest } = page;
  return rest;
}

/**
 * Links are bounded, deduplicated, and https-only for external destinations.
 *
 * `http` is refused rather than upgraded. These URLs are rendered as clickable
 * links in a webview and written into generated pages; silently rewriting the
 * scheme would change where somebody's link points without telling them.
 */
function sanitizePageLinks(input: unknown): WebsitePageLink[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const usedIds = new Set<string>();
  const links: WebsitePageLink[] = [];
  for (const item of input.slice(0, MAX_PAGE_LINKS)) {
    const source = asRecord(item);
    const targetPageId = cleanIdentifier(source['targetPageId']);
    const externalUrl = cleanHttpsUrl(source['externalUrl']);
    // A link pointing at nothing is not a link. Keeping it would put an empty
    // row in the inventory that no action can resolve.
    if (!targetPageId && !externalUrl) {
      continue;
    }
    links.push({
      id: uniqueId(cleanIdentifier(source['id']) || `link-${links.length + 1}`, usedIds),
      label: cleanText(source['label'], 160),
      ...(targetPageId ? { targetPageId } : {}),
      ...(!targetPageId && externalUrl ? { externalUrl } : {}),
      origin: source['origin'] === 'derived' ? 'derived' : 'declared',
    });
  }
  return links;
}

function cleanHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2_000) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function cleanOrder(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function sanitizeDesignSystem(input: unknown): WebsiteDesignSystem {
  const source = asRecord(input);
  const fallback = defaultDesignSystem();
  return {
    brandDirection: cleanText(source['brandDirection'], 4_000),
    tone: cleanText(source['tone'], 1_000),
    primaryColor: cleanColor(source['primaryColor'], fallback.primaryColor),
    secondaryColor: cleanColor(source['secondaryColor'], fallback.secondaryColor),
    accentColor: cleanColor(source['accentColor'], fallback.accentColor),
    headingFont: cleanText(source['headingFont'], 160) || fallback.headingFont,
    bodyFont: cleanText(source['bodyFont'], 160) || fallback.bodyFont,
    spacingScale: cleanText(source['spacingScale'], 500) || fallback.spacingScale,
    cornerStyle: cleanText(source['cornerStyle'], 160) || fallback.cornerStyle,
    accessibilityTarget: cleanText(source['accessibilityTarget'], 160) || fallback.accessibilityTarget,
    componentNotes: valueToStringList(source['componentNotes']),
  };
}

function sanitizeContentDesign(input: unknown): UiContentDesign {
  const source = asRecord(input);
  return {
    voice: cleanText(source['voice'], 4_000),
    principles: cleanStringList(source['principles'], MAX_LIST_ITEMS, 500),
    preferredTerms: cleanStringList(source['preferredTerms'], MAX_LIST_ITEMS, 300),
    avoidedTerms: cleanStringList(source['avoidedTerms'], MAX_LIST_ITEMS, 300),
    readingLevel: cleanText(source['readingLevel'], 300),
    locales: cleanStringList(source['locales'], MAX_LIST_ITEMS, 100),
    accessibilityNotes: cleanText(source['accessibilityNotes'], 4_000),
  };
}

function sanitizeImplementationGuide(input: unknown): UiImplementationGuide {
  const source = asRecord(input);
  return {
    targetTechnologies: cleanStringList(source['targetTechnologies'], MAX_LIST_ITEMS, 300),
    sourceRoots: cleanStringList(source['sourceRoots'], MAX_LIST_ITEMS, 500),
    componentLocations: cleanStringList(source['componentLocations'], MAX_LIST_ITEMS, 500),
    notes: cleanStringList(source['notes'], MAX_LIST_ITEMS, 1_000),
  };
}

function sanitizePlatforms(input: unknown): WebsitePlatformTarget[] {
  if (!Array.isArray(input)) {
    return [];
  }
  let primarySeen = false;
  const usedIds = new Set<WebsitePlatformId>();
  const items: WebsitePlatformTarget[] = [];
  for (const item of input.slice(0, WEBSITE_PLATFORM_CATALOG.length)) {
    const source = asRecord(item);
    const id = cleanText(source['id'], 80) as WebsitePlatformId;
    if (!PLATFORM_IDS.has(id) || usedIds.has(id)) {
      continue;
    }
    usedIds.add(id);
    const catalog = WEBSITE_PLATFORM_CATALOG.find(platform => platform.id === id);
    const requestedPrimary = source['primary'] === true;
    const primary: boolean = requestedPrimary && !primarySeen;
    if (primary) {
      primarySeen = true;
    }
    items.push({
      id,
      label: catalog?.label ?? (cleanText(source['label'], 160) || id),
      status: cleanStatus(source['status'], PLATFORM_STATUSES, primary ? 'planned' : 'not-planned'),
      primary,
      siteUrl: cleanPublicUrl(source['siteUrl']),
      projectReference: optionalText(source['projectReference'], 500),
      environmentReference: optionalText(source['environmentReference'], 500),
      notes: cleanText(source['notes'], 2_000),
    });
  }
  return items;
}

function sanitizeHostingEnvironments(input: unknown): WebsiteHostingEnvironment[] {
  const provided = new Map<WebsiteHostingEnvironmentId, Record<string, unknown>>();
  if (Array.isArray(input)) {
    for (const item of input) {
      const source = asRecord(item);
      const id = cleanText(source['id'], 40) as WebsiteHostingEnvironmentId;
      if (HOSTING_ENVIRONMENT_IDS.includes(id) && !provided.has(id)) {
        provided.set(id, source);
      }
    }
  }

  return createDefaultHostingEnvironments().map(fallback => {
    const source = provided.get(fallback.id) ?? {};
    const shared = {
      branchReference: optionalText(source['branchReference'], 500),
      notes: cleanText(source['notes'], 2_000),
    };
    if (fallback.id === 'develop') {
      const hostingMode = source['hostingMode'] === 'hosted' ? 'hosted' : 'local';
      const url = hostingMode === 'local'
        ? cleanLoopbackUrl(source['url']) ?? fallback.url
        : cleanPublicUrl(source['url']);
      return {
        ...fallback,
        ...shared,
        hostingMode,
        accessPolicy: hostingMode === 'local' ? 'local-only' : 'password-protected',
        url,
        credentialReference: hostingMode === 'hosted'
          ? cleanCredentialReference(source['credentialReference'])
          : undefined,
      };
    }
    if (fallback.id === 'staging') {
      return {
        ...fallback,
        ...shared,
        url: cleanPublicUrl(source['url']),
        credentialReference: cleanCredentialReference(source['credentialReference']),
        subdomainLabel: cleanHostnameLabel(source['subdomainLabel']) ?? fallback.subdomainLabel,
      };
    }
    return {
      ...fallback,
      ...shared,
      url: cleanPublicUrl(source['url']),
    };
  });
}

function sanitizeAutomations(input: unknown): WebsiteAutomation[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const usedIds = new Set<string>();
  return input.slice(0, MAX_AUTOMATIONS).map((item, index) => {
    const source = asRecord(item);
    const name = cleanText(source['name'], 160) || `Automation ${index + 1}`;
    const id = uniqueId(cleanIdentifier(source['id']) || `automation-${slugify(name) || index + 1}`, usedIds);
    return {
      id,
      name,
      event: cleanText(source['event'], 500),
      outcome: cleanText(source['outcome'], 1_000),
      status: cleanStatus(source['status'], AUTOMATION_STATUSES, 'idea'),
      n8nWorkflowId: optionalText(source['n8nWorkflowId'], 200),
      instanceUrl: cleanPublicUrl(source['instanceUrl']),
      credentialReference: cleanCredentialReference(source['credentialReference']),
      dataNotes: cleanText(source['dataNotes'], 2_000),
    };
  });
}

function inferPlatformId(value: unknown): WebsitePlatformId | undefined {
  const normalized = cleanText(value, 200).toLocaleLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes('cloudflare')) { return 'cloudflare-pages'; }
  if (normalized.includes('github pages')) { return 'github-pages'; }
  if (normalized.includes('elementor')) { return 'wordpress-elementor'; }
  if (normalized.includes('wordpress')) { return 'wordpress'; }
  if (normalized.includes('vercel')) { return 'vercel'; }
  if (normalized.includes('netlify')) { return 'netlify'; }
  if (normalized.includes('azure static')) { return 'azure-static-web-apps'; }
  if (normalized.includes('shopify')) { return 'shopify'; }
  if (normalized.includes('webflow')) { return 'webflow'; }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

function cleanText(value: unknown, maxLength: number): string {
  const cleaned = typeof value === 'string'
    ? value.slice(0, maxLength + 1).replace(/\u0000/g, '').trim().slice(0, maxLength)
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value).slice(0, maxLength)
      : '';
  return redactSecrets(cleaned).text.replace(
    /https?:\/\/[^\s"'<>]+\/(?:webhook|webhook-test)\/[^\s"'<>]+/gi,
    '[N8N_WEBHOOK_REDACTED]',
  );
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  const cleaned = cleanText(value, maxLength);
  return cleaned || undefined;
}

function valueToStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return cleanStringList(value, MAX_LIST_ITEMS, 500);
  }
  if (typeof value === 'string') {
    return cleanStringList(value.split(/\r?\n|[,;](?=\s|$)/), MAX_LIST_ITEMS, 500);
  }
  return [];
}

function cleanStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .slice(0, maxItems)
    .map(item => cleanText(item, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function cleanStatus<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const candidate = cleanText(value, 80) as T;
  return allowed.has(candidate) ? candidate : fallback;
}

function cleanIdentifier(value: unknown): string {
  return cleanText(value, 120).toLocaleLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function uniqueId(candidate: string, used: Set<string>): string {
  let result = candidate || 'item';
  let suffix = 2;
  while (used.has(result)) {
    result = `${candidate}-${suffix}`;
    suffix += 1;
  }
  used.add(result);
  return result;
}

function slugify(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function cleanSlug(value: unknown, title: string): string {
  const raw = cleanText(value, 240);
  if (raw === '/') {
    return '/';
  }
  const segments = raw
    .split('/')
    .map(segment => slugify(segment))
    .filter(Boolean);
  if (segments.length > 0) {
    return `/${segments.join('/')}`;
  }
  return `/${slugify(title) || 'page'}`;
}

function cleanColor(value: unknown, fallback: string): string {
  const candidate = cleanText(value, 20);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLocaleLowerCase() : fallback;
}

function cleanPublicUrl(value: unknown): string | undefined {
  const candidate = cleanText(value, 1_000);
  if (!candidate) {
    return undefined;
  }
  try {
    const parsed = new URL(candidate);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function cleanLoopbackUrl(value: unknown): string | undefined {
  const candidate = cleanPublicUrl(value);
  return candidate && isLoopbackUrl(candidate) ? candidate : undefined;
}

function cleanHostnameLabel(value: unknown): string | undefined {
  const candidate = cleanText(value, 63).toLocaleLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(candidate)
    ? candidate
    : undefined;
}

function cleanCredentialReference(value: unknown): string | undefined {
  const candidate = cleanText(value, 200);
  if (!candidate) {
    return undefined;
  }
  // A required provider prefix separates an opaque lookup label from a raw
  // password/token. Values and URL-shaped inputs are rejected.
  if (
    /[:][/][/]|[?&#=]/.test(candidate)
    || !/^(?:env|secretstorage|secret-manager|vault|1password|aws-secrets-manager|azure-key-vault|gcp-secret-manager):[a-z0-9_.\\/-]+$/i.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isExpectedReviewSubdomain(
  stagingUrl: string,
  productionUrl: string,
  subdomainLabel: string,
): boolean {
  try {
    const stagingHostname = new URL(stagingUrl).hostname.toLocaleLowerCase();
    const productionHostname = new URL(productionUrl).hostname.toLocaleLowerCase().replace(/^www\./, '');
    return stagingHostname === `${subdomainLabel}.${productionHostname}`;
  } catch {
    return false;
  }
}

function markdownList(values: string[]): string[] {
  return values.length > 0
    ? values.map(value => `- ${value.replace(/\r?\n/g, ' ')}`)
    : ['- _Not captured yet._'];
}

function markdownValue(value: string | undefined): string {
  return value ? value.replace(/\r?\n/g, ' ') : '_Not captured yet._';
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
