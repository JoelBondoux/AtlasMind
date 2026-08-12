import type {
  UiSurfaceKind,
  WebsitePagePlan,
  WebsiteWireframeElement,
  WebsiteWorkspaceConfig,
} from '../../src/types.ts';
import type { WebsitePageContent } from '../../src/core/websiteContent.ts';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';

export interface UiStudioReferenceProject {
  id: 'marketing-website' | 'operations-web-app' | 'desktop-control-room';
  surfaceKind: UiSurfaceKind;
  targetTechnology: string;
  proofText: string;
  legacyWorkspace: Omit<WebsiteWorkspaceConfig, 'version' | 'designGraph'> & { version: 5 };
  content: WebsitePageContent;
}

const FIXTURE_TIMESTAMP = '2026-08-11T12:00:00.000Z';

function element(
  id: string,
  kind: WebsiteWireframeElement['kind'],
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): WebsiteWireframeElement {
  return {
    id,
    kind,
    label,
    rect: { x, y, width, height },
    ...(parentId ? { parentId } : {}),
    designPrompt: `Make ${label.toLocaleLowerCase()} clear and purposeful.`,
    notes: `Reference fixture: ${label}.`,
  };
}

function page(
  id: string,
  title: string,
  slug: string,
  purpose: string,
  elements: WebsiteWireframeElement[],
): WebsitePagePlan {
  return {
    id,
    title,
    slug,
    purpose,
    template: 'Reference screen',
    sections: elements.map(candidate => candidate.label),
    wireframeNotes: 'Executable UI Studio reference fixture.',
    designNotes: 'Use the shared design graph; implementation details belong in the handoff.',
    wireframeStatus: 'approved',
    designStatus: 'review',
    contentStatus: 'review',
    seoStatus: 'not-started',
    order: 0,
    designPrompt: `Design ${title} as a complete, reviewable interface.`,
    links: [],
    wireframe: { breakpoint: 'desktop', elements },
  };
}

function fixture(options: {
  id: UiStudioReferenceProject['id'];
  surfaceKind: UiSurfaceKind;
  targetTechnology: string;
  projectName: string;
  page: WebsitePagePlan;
  proofText: string;
}): UiStudioReferenceProject {
  const workspace = createDefaultWebsiteWorkspace({
    projectName: options.projectName,
    summary: `Reference scenario for ${options.surfaceKind}.`,
  });
  workspace.updatedAt = FIXTURE_TIMESTAMP;
  workspace.surfaceKind = options.surfaceKind;
  workspace.pages = [options.page];
  workspace.implementation.targetTechnologies = [options.targetTechnology];
  workspace.implementation.sourceRoots = ['src/ui'];
  workspace.implementation.componentLocations = ['src/ui/components'];
  workspace.implementation.notes = ['The visual guide is authoritative for design intent, not source code.'];

  const { designGraph: _currentGraph, ...withoutGraph } = workspace;
  return {
    id: options.id,
    surfaceKind: options.surfaceKind,
    targetTechnology: options.targetTechnology,
    proofText: options.proofText,
    legacyWorkspace: { ...withoutGraph, version: 5 },
    content: {
      pageId: options.page.id,
      filePath: `content/${options.page.id}.md`,
      title: options.page.title,
      metaDescription: `Review copy for ${options.projectName}.`,
      status: 'review',
      body: `# ${options.page.title}\n\n${options.proofText}\n\nEvery word in this preview comes from the fixture.`,
      placeholders: [],
      missing: false,
      extraFrontMatter: {},
    },
  };
}

export const UI_STUDIO_REFERENCE_PROJECTS: readonly UiStudioReferenceProject[] = [
  fixture({
    id: 'marketing-website',
    surfaceKind: 'website',
    targetTechnology: 'Astro',
    projectName: 'Northstar Advisory',
    page: page(
      'northstar-home',
      'Northstar Advisory',
      '/',
      'Explain the offer and turn qualified visitors into enquiries.',
      [
        element('site-nav', 'nav', 'Primary navigation', 0, 0, 1_000, 72),
        element('opening', 'hero', 'Outcome-led opening', 0, 92, 1_000, 300),
        element('proof', 'text', 'Client evidence', 60, 420, 600, 180),
        element('enquire', 'cta', 'Book a working session', 700, 440, 240, 112),
        element('site-footer', 'footer', 'Footer', 0, 640, 1_000, 96),
      ],
    ),
    proofText: 'Make operational change visible before it becomes expensive.',
  }),
  fixture({
    id: 'operations-web-app',
    surfaceKind: 'web-app',
    targetTechnology: 'React',
    projectName: 'Relay Operations',
    page: page(
      'relay-dashboard',
      'Operations dashboard',
      '/operations',
      'Help an operator triage live work from a dense, data-rich overview.',
      [
        element('workspace-nav', 'sidebar', 'Workspace navigation', 0, 0, 220, 760),
        element('command-bar', 'nav', 'Command and filter bar', 240, 0, 760, 72),
        element('status-strip', 'section', 'Live service status', 240, 92, 760, 120),
        element('work-grid', 'grid', 'Priority work grid', 240, 232, 760, 340),
        element('breach-card', 'card', 'SLA breach queue', 260, 252, 350, 140, 'work-grid'),
        element('capacity-card', 'card', 'Team capacity', 630, 252, 350, 140, 'work-grid'),
        element('event-stream', 'text', 'Recent events', 240, 600, 760, 160),
      ],
    ),
    proofText: 'Three incidents need ownership; the oldest has 18 minutes remaining.',
  }),
  fixture({
    id: 'desktop-control-room',
    surfaceKind: 'desktop-app',
    targetTechnology: 'SwiftUI',
    projectName: 'Signal Control Room',
    page: page(
      'signal-workspace',
      'Signal workspace',
      '/workspace',
      'Guide a desktop operator through a focused review and confirmation flow.',
      [
        element('tool-rail', 'sidebar', 'Tool rail', 0, 0, 230, 720),
        element('window-toolbar', 'nav', 'Window toolbar', 250, 0, 750, 72),
        element('review-form', 'form', 'Signal review', 250, 92, 480, 430),
        element('context-panel', 'custom', 'Selected signal context', 750, 92, 250, 280),
        element('confirmation', 'cta', 'Confirm classification', 750, 396, 250, 126),
        element('status-bar', 'footer', 'Connection status', 250, 552, 750, 72),
      ],
    ),
    proofText: 'Review the captured signal, explain the classification, then confirm it.',
  }),
];
