import { describe, expect, it } from 'vitest';
import {
  buildInterfaceStudioSelectionContext,
  createStableInterfaceStudioId,
  DEFAULT_INTERFACE_STUDIO_PREVIEW_PROFILES,
  projectWebsiteWorkspaceToInterfaceStudio,
  resolveInterfaceStudioSelection,
  serializeInterfaceStudioSelectionContext,
} from '../../src/core/interfaceStudioModel.ts';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import type { WebsiteWorkspaceConfig } from '../../src/types.ts';

function createWorkspace(): WebsiteWorkspaceConfig {
  const workspace = createDefaultWebsiteWorkspace({
    clientName: 'Northstar Cooperative',
    projectName: 'Northstar service',
    summary: 'Help members find and request the right service.',
  });
  workspace.updatedAt = '2026-08-02T10:30:00.000Z';
  workspace.pages = [
    {
      ...workspace.pages[0]!,
      id: 'page-home',
      title: 'Welcome',
      slug: '/',
      purpose: 'Orient members and provide a clear next action.',
      template: 'campaign-landing',
      sections: ['Hero', 'Service finder', 'Hero'],
      wireframeNotes: 'Keep the decision path short.',
      designNotes: 'Use calm, high-contrast surfaces.',
      wireframeStatus: 'approved',
      designStatus: 'review',
      contentStatus: 'draft',
      seoStatus: 'blocked',
    },
    {
      ...workspace.pages[1]!,
      id: 'page-support',
      title: 'Support',
      slug: '/support',
      purpose: 'Let a member request help.',
      sections: ['Support options', 'Request form'],
    },
  ];
  workspace.designSystem = {
    brandDirection: 'Warm, practical, and quietly confident',
    tone: 'Plain-spoken',
    primaryColor: '#123456',
    secondaryColor: '#d8e2ee',
    accentColor: '#ff8055',
    headingFont: 'Fraunces',
    bodyFont: 'Inter',
    spacingScale: '4, 8, 12, 16, 24, 32',
    cornerStyle: 'Soft 12px corners',
    accessibilityTarget: 'WCAG 2.2 AA',
    componentNotes: ['Buttons use sentence case.', 'Forms show help before errors.'],
  };
  workspace.platforms[0]!.siteUrl = undefined;
  workspace.hostingEnvironments[1]!.url = 'https://staging.northstar.example/';
  workspace.automations = [{
    id: 'request-help',
    name: 'Route support request',
    event: 'Request submitted',
    outcome: 'Create a triage item',
    status: 'mapped',
    n8nWorkflowId: 'workflow-42',
    dataNotes: 'Send only the fields the member approved.',
  }];
  return workspace;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

describe('Interface Studio model', () => {
  it('creates stable, kind-scoped IDs without relying on a lossy slug alone', () => {
    const first = createStableInterfaceStudioId('node', 'Surface A', 'A B');

    expect(first).toBe(createStableInterfaceStudioId('node', 'Surface A', 'A B'));
    expect(first).not.toBe(createStableInterfaceStudioId('node', 'Surface A', 'a-b'));
    expect(first).not.toBe(createStableInterfaceStudioId('surface', 'Surface A', 'A B'));
    expect(first).toMatch(/^interface-node-/);
  });

  it('projects the legacy workspace without mutating it or sharing mutable source data', () => {
    const workspace = createWorkspace();
    const original = JSON.parse(JSON.stringify(workspace)) as WebsiteWorkspaceConfig;
    const frozenWorkspace = deepFreeze(workspace);

    const project = projectWebsiteWorkspaceToInterfaceStudio(frozenWorkspace);
    const metadata = project.targetAdapters[0]!.metadata;

    expect(workspace).toEqual(original);
    expect(metadata.sourceSnapshot).toEqual(workspace);
    expect(metadata.sourceSnapshot).not.toBe(workspace);
    expect(metadata.sourceSnapshot.intake).not.toBe(workspace.intake);
    expect('siteUrl' in metadata.sourceSnapshot.platforms[0]!).toBe(true);

    (metadata.sourceSnapshot.intake.goals as string[]).push('Projection-only goal');
    expect(workspace.intake.goals).not.toContain('Projection-only goal');
  });

  it('maps pages and repeated sections into a stable renderer-neutral hierarchy', () => {
    const workspace = createWorkspace();
    const first = projectWebsiteWorkspaceToInterfaceStudio(workspace);
    const second = projectWebsiteWorkspaceToInterfaceStudio(workspace);

    expect(first.id).toBe(second.id);
    expect(first.flows).toHaveLength(1);
    expect(first.flows[0]).toMatchObject({ name: 'Primary experience' });
    expect(first.flows[0]!.surfaces.map(surface => surface.name)).toEqual(['Welcome', 'Support']);
    expect(first.flows[0]!.surfaces[0]!.nodes.map(node => node.name)).toEqual([
      'Hero',
      'Service finder',
      'Hero',
    ]);
    expect(new Set(first.flows[0]!.surfaces[0]!.nodes.map(node => node.id)).size).toBe(3);
    expect(first.flows[0]!.surfaces.map(surface => surface.id)).toEqual(
      second.flows[0]!.surfaces.map(surface => surface.id),
    );
    expect(first.flows[0]!.surfaces[0]!.nodes.map(node => node.id)).toEqual(
      second.flows[0]!.surfaces[0]!.nodes.map(node => node.id),
    );

    expect(first).not.toHaveProperty('slug');
    expect(first).not.toHaveProperty('hostingEnvironments');
    expect(first.flows[0]).not.toHaveProperty('platforms');
    expect(first.flows[0]!.surfaces[0]).not.toHaveProperty('slug');
    expect(first.flows[0]!.surfaces[0]).not.toHaveProperty('seoStatus');
    expect(first.flows[0]!.surfaces[0]!.nodes[0]).not.toHaveProperty('template');
  });

  it('keeps web delivery, route, SEO, and workflow details in target-adapter metadata', () => {
    const workspace = createWorkspace();
    const project = projectWebsiteWorkspaceToInterfaceStudio(workspace);
    const adapter = project.targetAdapters[0]!;
    const firstSurface = project.flows[0]!.surfaces[0]!;
    const surfaceMetadata = adapter.metadata.surfaces.find(item => item.surfaceId === firstSurface.id);

    expect(adapter).toMatchObject({
      targetKind: 'web',
      renderer: 'website-workspace-v1',
    });
    expect(surfaceMetadata).toMatchObject({
      pageId: 'page-home',
      route: { path: '/' },
      seo: { status: 'blocked' },
      template: 'campaign-landing',
      workStatus: {
        wireframe: 'approved',
        design: 'review',
        content: 'draft',
      },
    });
    expect(surfaceMetadata?.sourcePage).toEqual(workspace.pages[0]);
    expect(adapter.metadata.delivery.platforms).toEqual(workspace.platforms);
    expect(adapter.metadata.delivery.hostingEnvironments).toEqual(workspace.hostingEnvironments);
    expect(adapter.metadata.automations).toEqual(workspace.automations);
  });

  it('projects visual decisions as semantic tokens and supplies neutral preview profiles', () => {
    const project = projectWebsiteWorkspaceToInterfaceStudio(createWorkspace());
    const tokens = new Map(project.visualLanguage.tokens.map(token => [token.role, token.value]));

    expect(tokens).toEqual(new Map([
      ['color.brand.primary', '#123456'],
      ['color.brand.secondary', '#d8e2ee'],
      ['color.brand.accent', '#ff8055'],
      ['typography.heading', 'Fraunces'],
      ['typography.body', 'Inter'],
      ['spacing.scale', '4, 8, 12, 16, 24, 32'],
      ['radius.corner', 'Soft 12px corners'],
    ]));
    expect(project.visualLanguage).toMatchObject({
      direction: 'Warm, practical, and quietly confident',
      tone: 'Plain-spoken',
      accessibilityIntent: 'WCAG 2.2 AA',
      componentGuidance: ['Buttons use sentence case.', 'Forms show help before errors.'],
    });
    expect(project.previewProfiles).toEqual(DEFAULT_INTERFACE_STUDIO_PREVIEW_PROFILES);
    expect(project.previewProfiles.map(profile => profile.formFactor)).toEqual([
      'compact',
      'medium',
      'expanded',
    ]);
  });

  it('resolves a deterministic selection path and builds compact chat context', () => {
    const project = projectWebsiteWorkspaceToInterfaceStudio(createWorkspace());
    const flow = project.flows[0]!;
    const surface = flow.surfaces[0]!;
    const node = surface.nodes[1]!;
    const selection = { nodeId: node.id };

    const resolved = resolveInterfaceStudioSelection(project, selection);
    const context = buildInterfaceStudioSelectionContext(project, selection);
    const repeatedContext = buildInterfaceStudioSelectionContext(project, selection);

    expect(resolved?.path.map(item => item.kind)).toEqual(['project', 'flow', 'surface', 'node']);
    expect(resolved?.selection).toEqual({
      flowId: flow.id,
      surfaceId: surface.id,
      nodeId: node.id,
    });
    expect(context).toMatchObject({
      subject: { kind: 'node', id: node.id, name: 'Service finder' },
      path: resolved?.path,
      adapterMetadata: [{
        targetKind: 'web',
        metadata: {
          surfaceId: surface.id,
          pageId: 'page-home',
          section: { index: 1, label: 'Service finder' },
        },
      }],
    });
    expect(context?.adapterMetadata[0]!.metadata).not.toHaveProperty('sourceSnapshot');
    expect(context).toEqual(repeatedContext);
    expect(serializeInterfaceStudioSelectionContext(context!)).toBe(
      serializeInterfaceStudioSelectionContext(repeatedContext!),
    );

    const reordered = Object.fromEntries(Object.entries(context!).reverse()) as typeof context;
    expect(serializeInterfaceStudioSelectionContext(reordered!)).toBe(
      serializeInterfaceStudioSelectionContext(context!),
    );
    expect(resolveInterfaceStudioSelection(project, {
      flowId: 'missing-flow',
      surfaceId: surface.id,
    })).toBeUndefined();
    expect(buildInterfaceStudioSelectionContext(project, { nodeId: 'missing-node' })).toBeUndefined();
  });
});
