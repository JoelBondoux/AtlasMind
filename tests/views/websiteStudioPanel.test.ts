import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import { designGraphFromPages } from '../../src/core/uiDesignGraph.ts';
import {
  buildWebsiteStudioResponsiveScreens,
  getWebsiteStudioHtml,
  isWebsiteStudioPage,
  isWebsiteStudioMessage,
  resolveWebsiteStudioPage,
} from '../../src/views/websiteStudioPanel.ts';

describe('Website Studio webview boundary', () => {
  it('accepts only known dashboard deep links', () => {
    expect(isWebsiteStudioPage('design')).toBe(true);
    expect(isWebsiteStudioPage('content')).toBe(true);
    expect(isWebsiteStudioPage('brands')).toBe(true);
    // Delivery left for the Dashboard in 0.474.0.
    expect(isWebsiteStudioPage('delivery')).toBe(false);
    expect(isWebsiteStudioPage('../../settings')).toBe(false);
    // The numbered steps are gone; their ids survive only as renames.
    expect(isWebsiteStudioPage('wireframes')).toBe(false);
    expect(isWebsiteStudioPage('stack')).toBe(false);
  });

  it('allows only the documented bounded message shapes', () => {
    expect(isWebsiteStudioMessage({ type: 'ready' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'saveConfig', payload: {} })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: '{"clientName":"Northstar"}' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openSsot', payload: 'json' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openCommand', payload: 'atlasmind.openProjectDashboard' })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'savePageContent',
      payload: { pageId: 'page-home', title: 'Home', metaDescription: '', status: 'draft', body: '# Home', expectedBody: '' },
    })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'seedPageContent', payload: { pageId: 'page-home' } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openPreview' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openResponsivePreview' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'refreshPreview' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'selectPreviewTarget', payload: { pageId: 'page-home', nodeId: 'hero-1' } })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph', payload: {
        type: 'add-token', expectedRevision: 2,
        token: { id: 'color-primary', label: 'Primary', kind: 'color', value: '#2563EB' },
      },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editRepositoryMapping',
      payload: {
        type: 'add-mapping', expectedRevision: 0,
        mapping: {
          id: 'button-source', label: 'Button source', adapterId: 'react',
          target: { kind: 'component', id: 'button' },
          sourcePath: 'src/components/Button.tsx', sourceSymbol: 'Button',
          propertyMappings: { label: 'children' }, slotMappings: { icon: 'icon' },
          coverage: 'declared', limitations: [],
        },
      },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editRepositoryMapping',
      payload: { type: 'import-mapping-evidence', expectedRevision: 4, mappingId: 'button-source' },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-locked', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1', locked: true,
      },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'duplicate-node', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1',
        identities: [{ sourceId: 'hero-1', newId: 'hero-copy' }], offsetX: 24, offsetY: 24,
      },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-frames', expectedRevision: 2, screenId: 'page-home', breakpoint: 'mobile',
        frames: [
          { nodeId: 'hero-1', rect: { x: 0, y: 0, width: 1_000, height: 300 } },
          { nodeId: 'copy-1', rect: { x: 0, y: 320, width: 1_000, height: 200 } },
        ],
      },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-layout', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1',
        breakpoint: 'mobile',
        layout: {
          mode: 'stack', widthMode: 'fill', heightMode: 'hug', direction: 'vertical', gap: 16,
          padding: 24, columns: 2, align: 'stretch', distribute: 'space-between',
          minWidth: 200, maxWidth: 800, minHeight: null, maxHeight: 600,
          wrap: 'wrap', order: -2,
        },
      },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-viewport-override', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1',
        breakpoint: 'mobile', hidden: true,
      },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'clear-node-viewport-override', expectedRevision: 3, screenId: 'page-home', nodeId: 'hero-1',
        breakpoint: 'mobile', property: 'hidden',
      },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-frame', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1',
        rect: { x: 0, y: 0, width: 1_000, height: 300 }, parentId: null,
      },
    })).toBe(true);

    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: 'x'.repeat(128_001) })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openSsot', payload: '../../package.json' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openCommand', payload: 'workbench.action.terminal.sendSequence' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'saveConfig', payload: 'erase everything' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'deploy', payload: 'production' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'savePageContent', payload: { pageId: '../outside', status: 'draft', body: 'x'.repeat(200_001) } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'selectPreviewTarget', payload: { pageId: '../outside', nodeId: 'hero-1' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'selectPreviewTarget', payload: { pageId: 'page-home', nodeId: 'x'.repeat(121) } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'selectPreviewTarget', payload: { pageId: 'page-home', nodeId: 'hero-1', command: 'run' } })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-frame', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1',
        rect: { x: 0, y: 0, width: 1_000, height: 300 }, parentId: null, command: 'run',
      },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'duplicate-node', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1',
        identities: [{ sourceId: 'hero-1', newId: '../outside' }], offsetX: 24, offsetY: 24,
      },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-locked', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1', locked: 'yes',
      },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'clear-node-viewport-override', expectedRevision: 3, screenId: 'page-home', nodeId: 'hero-1',
        breakpoint: 'mobile', property: 'style',
      },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-frames', expectedRevision: 2, screenId: 'page-home',
        frames: [{ nodeId: '../outside', rect: { x: 0, y: 0, width: 100, height: 100 } }],
      },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'editDesignGraph',
      payload: {
        type: 'set-node-layout', expectedRevision: 2, screenId: 'page-home', nodeId: 'hero-1',
        layout: {
          mode: 'flex', widthMode: 'fill', heightMode: 'hug', direction: 'vertical', gap: 16,
          padding: 24, columns: 2, align: 'stretch', distribute: 'space-between',
          minWidth: null, maxWidth: null, minHeight: null, maxHeight: null,
          wrap: 'nowrap', order: 0,
        },
      },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'editRepositoryMapping',
      payload: {
        type: 'verify-mapping', expectedRevision: 0, mappingId: 'button-source',
        sourceFingerprint: `sha256:${'a'.repeat(64)}`,
      },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'editRepositoryMapping',
      payload: { type: 'import-mapping-evidence', expectedRevision: 4, mappingId: 'button-source', source: 'send me' },
    })).toBe(false);
  });

  it('keeps every old step id working as a deep link', () => {
    // Every one of the eight numbered steps was a public deep-link target: the
    // Project Dashboard and the Ideation board both link in, and a renamed id
    // would silently drop them on the landing view with no indication why.
    // Each lands where its content went.
    expect(resolveWebsiteStudioPage('wireframes')).toBe('design');
    expect(resolveWebsiteStudioPage('preview')).toBe('design');
    expect(resolveWebsiteStudioPage('sitemap')).toBe('structure');
    expect(resolveWebsiteStudioPage('ui-system')).toBe('brands');
    expect(resolveWebsiteStudioPage('stack')).toBe('handoff');
    expect(resolveWebsiteStudioPage('platforms')).toBe('handoff');
    expect(resolveWebsiteStudioPage('automations')).toBe('handoff');
    expect(resolveWebsiteStudioPage('brief')).toBe('brief');
    // And the landing view is the canvas, not the brief.
    expect(resolveWebsiteStudioPage('nonsense')).toBe('design');
    expect(resolveWebsiteStudioPage(undefined)).toBe('design');
  });

  it('no longer accepts the delivery messages, and opens the Dashboard by a constant target', () => {
    // The framework choice, stack setup and the Delivery comparison moved to
    // the Dashboard's Delivery page; a Studio message naming them is dropped.
    expect(isWebsiteStudioMessage({ type: 'selectFramework', payload: { frameworkId: 'astro' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'planStackSetup' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'compareDelivery' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openDeliveryPage' })).toBe(true);
  });

  it('points a website at the Dashboard for its delivery half, and renders none of it here', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'handoff', {
      scriptContent: '/* canvas */',
    });
    expect(html).toContain('id="openDeliveryPage"');
    expect(html).toContain('A save here never touches them.');
    expect(html).not.toContain('data-framework=');
    expect(html).not.toContain('data-environment-id=');
    expect(html).not.toContain('data-platform-id=');
    expect(html).not.toContain('id="addWebsiteAutomation"');
  });

  it('renders explicit repository mapping controls and host divergence assessments', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.designGraph.components = [{
      id: 'button', label: 'Button', description: '', rootKind: 'cta', properties: [], slots: [],
      variants: [{ id: 'primary', label: 'Primary', propertyValues: {} }], states: ['default'],
    }];
    config.implementation.repositoryMappingRevision = 4;
    config.implementation.repositoryMappings = [{
      id: 'button-source', label: 'Button source', adapterId: 'react',
      target: { kind: 'component', id: 'button' }, sourcePath: 'src/components/Button.tsx', sourceSymbol: 'Button',
      propertyMappings: {}, slotMappings: {}, coverage: 'declared', limitations: [], lastVerified: null,
      lastImport: {
        adapterId: 'react', capability: 'partial', graphRevision: 3,
        designFingerprint: `sha256:${'a'.repeat(64)}`,
        sourceFingerprint: `sha256:${'b'.repeat(64)}`,
        importedAt: '2026-08-12T12:00:00.000Z',
        facts: [{ kind: 'export', name: 'Button' }],
        suggestedPropertyMappings: {}, suggestedSlotMappings: {},
        findings: [{ code: 'react-static-only', severity: 'loss', message: 'Runtime behavior was not evaluated.' }],
      },
    }];
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'handoff', {
      scriptContent: '/* canvas */',
      repositoryMappingAssessments: [{
        mappingId: 'button-source', status: 'code-only', sourceStatus: 'ok',
        message: 'Only repository source changed since verification.',
      }],
    });
    expect(html).toContain('Repository boundary · mapping revision 4');
    expect(html).toContain('Source mappings and divergence');
    expect(html).toContain('id="addRepositoryMapping"');
    expect(html).toContain('&quot;status&quot;:&quot;code-only&quot;');
    expect(html).toContain('&quot;sourcePath&quot;:&quot;src/components/Button.tsx&quot;');
    expect(html).toContain('&quot;capability&quot;:&quot;partial&quot;');
    expect(html).toContain('&quot;code&quot;:&quot;react-static-only&quot;');
  });

  it('renders client content escaped with nonce-protected scripts and no inline handlers', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: '<img src=x onerror=alert(1)>' });
    // The canvas script now lives in `media/websiteStudio.js` and is read off
    // disk by the panel, so the caller supplies it. Passed here as a stub
    // because this test is about the shell's escaping and nonce, not the script.
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'brief', {
      scriptContent: '/* canvas */',
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('value="<img src=x onerror=alert(1)>"');
    expect(html).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9]+'/);
    expect(html).toMatch(/<script nonce="[A-Za-z0-9]+">/);
    expect(html).not.toMatch(/\sonclick=/i);
  });

  it('uses the generalized screen workflow and hides website delivery for a native UI', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.surfaceKind = 'mobile-app';
    config.implementation.targetTechnologies = ['SwiftUI'];
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'handoff', {
      scriptContent: '/* canvas */',
    });

    expect(html).toContain('UI Studio');
    expect(html).toContain('Screens &amp; flows');
    expect(html).toContain('Implementation handoff');
    expect(html).toContain('SwiftUI');
    expect(html).not.toContain('Three deliberate hosting stages');
    expect(html).not.toContain('n8n automations');
  });

  it('renders content design rules and real Markdown-backed screen copy', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.contentDesign.voice = 'Calm and direct';
    const home = config.pages[0]!;
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'content', {
      scriptContent: '/* canvas */',
      contentDirectory: 'product-copy',
      pageContent: [{
        pageId: home.id,
        filePath: 'product-copy/index.md',
        title: 'Home',
        metaDescription: 'A useful product',
        status: 'review',
        body: '# Welcome\n\n[PLACEHOLDER: proof point]',
        placeholders: [{ need: 'proof point', line: 3 }],
        missing: false,
        extraFrontMatter: {},
      }],
    });

    expect(html).toContain('Content design');
    expect(html).toContain('Calm and direct');
    expect(html).toContain('product-copy/index.md');
    expect(html).toContain('1 unresolved placeholder');
    expect(html).toContain('save-page-content');
  });

  it('renders typed graph tokens as a revisioned UI System editor', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.designGraph.tokens = [
      { id: 'color-primary', label: 'Primary', kind: 'color', value: '#123456' },
      { id: 'color-action', label: 'Action', kind: 'color', aliasOf: 'color-primary' },
    ];
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'brands', {
      scriptContent: '/* canvas */',
    });

    expect(html).toContain('Typed design tokens');
    expect(html).toContain('id="designTokenEditor"');
    expect(html).toContain('id="addDesignToken"');
    expect(html).toContain('&quot;color-primary&quot;');
    expect(html).toContain('&quot;aliasOf&quot;:&quot;color-primary&quot;');
    expect(html).toContain('Reserved ids');
  });

  it('renders reusable definitions and resolved component instances as separate editing surfaces', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.pages[0]!.wireframe = {
      breakpoint: 'desktop', elements: [{ id: 'action', kind: 'cta', label: 'Action', rect: { x: 10, y: 10, width: 200, height: 60 }, designPrompt: '', notes: '' }],
    };
    config.designGraph = designGraphFromPages(config.pages, 3);
    config.designGraph.components = [{
      id: 'button', label: 'Button', description: '', rootKind: 'cta',
      properties: [{ id: 'label', label: 'Label', kind: 'text', defaultValue: 'Continue' }],
      slots: [], variants: [{ id: 'primary', label: 'Primary', propertyValues: {} }], states: ['default', 'hover'],
    }];
    config.designGraph.contentCollections = [{
      id: 'actions', label: 'Actions', description: 'Fixtures',
      fields: [{ id: 'label', label: 'Label', kind: 'text', required: true }],
      samples: [{ id: 'buy', label: 'Buy sample', values: { label: 'Buy' } }],
    }];
    config.designGraph.assets = [{
      id: 'action-icon', label: 'Action icon', kind: 'icon',
      source: { kind: 'workspace', reference: 'assets/action.svg' },
      width: 24, height: 24, crop: 'contain', focalPoint: { x: 50, y: 50 },
      altText: '', decorative: true, maturity: 'reviewed',
    }];
    config.designGraph.screens[0]!.nodes[0]!.componentInstance = {
      definitionId: 'button', variantId: 'primary', state: 'hover', propertyOverrides: { label: 'Buy' },
    };
    config.designGraph.screens[0]!.nodes[0]!.dataBinding = {
      collectionId: 'actions', sampleRecordId: 'buy', fieldMappings: { action: 'label' },
    };
    config.designGraph.screens[0]!.nodes[0]!.assetRef = 'action-icon';
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'brands', { scriptContent: '/* canvas */' });
    expect(html).toContain('Reusable components');
    expect(html).toContain('id="designComponentEditor"');
    expect(html).toContain('&quot;components&quot;:[{');
    expect(html).toContain('&quot;component&quot;:{&quot;definitionId&quot;:&quot;button&quot;');
    expect(html).toContain('Structured content collections');
    expect(html).toContain('id="contentCollectionEditor"');
    expect(html).toContain('&quot;contentCollections&quot;:[{');
    expect(html).toContain('&quot;dataBinding&quot;:{&quot;collectionId&quot;:&quot;actions&quot;');
    expect(html).toContain('Asset library');
    expect(html).toContain('id="designAssetEditor"');
    expect(html).toContain('&quot;assets&quot;:[{');
    expect(html).toContain('&quot;assetRef&quot;:&quot;action-icon&quot;');
  });

  it('keeps the built-in browser preview on the Design view, beside the canvas', () => {
    // It was a numbered step of its own, two steps after the canvas it
    // previews. Reviewing what you drew is part of drawing it.
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'design', {
      scriptContent: '/* canvas */',
    });

    expect(html).not.toContain('data-page-target="preview"');
    const design = html.slice(html.indexOf('data-page="design"'), html.indexOf('data-page="structure"'));
    expect(design).toContain('id="wireframeCanvas"');
    expect(design).toContain('Canonical review surface');
    expect(design).toContain('id="refreshFullPreview"');
    expect(html).toContain('Canonical review surface');
    expect(html).toContain('built-in browser');
    expect(html).toContain('id="refreshFullPreview"');
    expect(html).toContain('id="openResponsivePreview"');
  });

  it('renders host-resolved breakpoint controls and per-property provenance', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.pages[0]!.wireframe = {
      breakpoint: 'desktop',
      elements: [{
        id: 'hero', kind: 'hero', label: 'Opening',
        rect: { x: 0, y: 20, width: 1_000, height: 300 }, designPrompt: '', notes: '',
      }],
    };
    config.designGraph = designGraphFromPages(config.pages, 4);
    config.designGraph.screens[0]!.nodes[0]!.viewportOverrides.tablet = {
      rect: { x: 80, y: 40, width: 840, height: 260 },
    };
    config.designGraph.screens[0]!.nodes[0]!.viewportOverrides.mobile = {
      hidden: true, mode: 'stack', direction: 'vertical', gap: 12,
    };

    const responsive = buildWebsiteStudioResponsiveScreens(config.designGraph);
    expect(responsive[0]!.nodes[0]!.views.mobile).toMatchObject({
      layout: { rect: { x: 80, y: 40, width: 840, height: 260 }, hidden: true },
      provenance: {
        rect: { kind: 'override', breakpoint: 'tablet' },
        hidden: { kind: 'override', breakpoint: 'mobile' },
      },
    });
    expect(responsive[0]!.nodes[0]!.overrides).toMatchObject({
      tablet: { rect: true, hidden: false },
      mobile: { rect: false, hidden: true, layout: true },
    });
    expect(Object.keys(responsive[0]!.diagnostics)).toEqual(['desktop', 'tablet', 'mobile']);

    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'design', {
      scriptContent: '/* canvas */',
    });
    expect(html).toContain('aria-label="Canvas breakpoint"');
    expect(html).toContain('data-breakpoint="desktop"');
    expect(html).toContain('data-breakpoint="tablet"');
    expect(html).toContain('data-breakpoint="mobile"');
    expect(html).toContain('id="canvasDiagnostics"');
    expect(html).toContain('&quot;responsiveScreens&quot;');
    expect(html).toContain('&quot;tokens&quot;');
  });
});

/**
 * Could anybody find this panel?
 *
 * Website Studio shipped registered, documented and linked to from nowhere: the
 * command existed, the panel linked *out* to the Dashboard, Ideation and Chat,
 * and nothing anywhere linked back. The only way in was typing its name into the
 * command palette, which is not a discovery mechanism for a surface you do not
 * know exists.
 *
 * The rule this pins is narrow and checkable: **a panel that links to another
 * surface must be reachable from one.** A one-way link is how a whole panel goes
 * missing without a single test failing.
 */
describe('Website Studio is reachable from the surfaces it links to', () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');
  const OPEN_COMMAND = 'atlasmind.openWebsiteStudio';

  it('is offered by the panels it sends people to', () => {
    // It points at the Dashboard's delivery pipeline for publishing, and at the
    // Ideation board for the thinking that precedes a brief. Both now answer.
    expect(read('media/projectDashboard.js')).toContain(`data-payload="${OPEN_COMMAND}"`);
    expect(read('media/projectIdeation.js')).toContain(`data-payload="${OPEN_COMMAND}"`);
  });

  it('is allowlisted by the hosts of those buttons, so clicking does something', () => {
    expect(read('src/views/projectDashboardPanel.ts')).toContain(`'${OPEN_COMMAND}'`);
    expect(read('src/views/projectIdeationPanel.ts')).toContain(`'${OPEN_COMMAND}'`);
  });

  it('still declares the command it is opened by', () => {
    const manifest = JSON.parse(read('package.json')) as { contributes: { commands: Array<{ command: string }> } };
    expect(manifest.contributes.commands.some(entry => entry.command === OPEN_COMMAND)).toBe(true);
  });
});

describe('UI Studio canvas command wiring', () => {
  const source = readFileSync(path.join(process.cwd(), 'media/websiteStudio.js'), 'utf8');

  it('routes every current canvas mutation family through the closed command message', () => {
    expect(source).toContain("type: 'editDesignGraph'");
    for (const command of [
      'add-node', 'delete-node', 'duplicate-node', 'set-node-locked', 'set-node-frame', 'set-node-frames', 'set-node-kind',
      'set-node-label', 'set-node-design-prompt', 'set-node-viewport-override',
      'set-node-layout', 'clear-node-viewport-override', 'undo', 'redo',
      'add-token', 'set-token', 'delete-token',
      'add-component', 'set-component', 'delete-component', 'set-node-component', 'set-node-component-slot',
      'set-node-content-state', 'set-node-preview-content-state',
      'add-content-collection', 'set-content-collection', 'delete-content-collection', 'set-node-data-binding',
      'add-asset', 'set-asset', 'delete-asset', 'set-node-asset',
    ]) {
      expect(source).toContain(`'${command}'`);
    }
    expect(source).toContain('provenance.rect?.containerId');
    expect(source).toContain('container-positioned');
    expect(source).toContain('layoutMinWidth');
    expect(source).toContain('layoutOrder');
    expect(source).toContain('designRevision,');
    expect(source).not.toContain('designGraph: state');
    expect(source).toContain('applyResponsiveRect');
    expect(source).toContain('projectResponsiveRect');
    expect(source).toContain('const responsive = activeBreakpoint !== activeBaseBreakpoint();');
    expect(source).toContain("type: 'set-node-viewport-override', screenId: activePageId, nodeId: element.id");
    expect(source).toContain("property: 'hidden'");
    expect(source).toContain('sourceLabel(view.provenance.rect)');
    expect(source).toContain('applyMultiLayout');
    expect(source).toContain('selectedElementIds');
    expect(source).toContain('data-multi-layout="distribute-x"');
    expect(source).toContain('id="applyNodeLayout"');
    expect(source).toContain("property: 'layout'");
    expect(source).toContain('function duplicateSelected()');
    expect(source).toContain('id="toggleElementLock"');
    expect(source).toContain('isLocked(element.id)');
    expect(source).toContain("mode: 'group-move'");
    expect(source).toContain('new Set(frames.map(frame => frame.nodeId))');
    expect(source).toContain("notice('Moved ' + frames.length + ' elements as one undoable edit'");
    expect(source).toContain('function renderCanvasDiagnostics()');
    expect(source).toContain('[data-diagnostic-node]');
    expect(source).toContain('Unknown is not treated as a pass.');
    expect(source).toContain('Content states');
    expect(source).toContain('[PLACEHOLDER: …]');
    expect(source).toContain('Sample data binding');
    expect(source).toContain('CONTENT_DIAGNOSTIC_CODES');
    expect(source).toContain('Asset assignment');
    expect(source).toContain('ASSET_DIAGNOSTIC_CODES');
  });
});
