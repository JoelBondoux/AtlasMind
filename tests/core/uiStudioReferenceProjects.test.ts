import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UiDesignGraph, WebsitePagePlan } from '../../src/types.ts';
import {
  applyDesignGraphToPages,
  designGraphFromPages,
  resolveUiNodeLayout,
} from '../../src/core/uiDesignGraph.ts';
import { applyUiEditCommand, createUiEditSession } from '../../src/core/uiEditCommands.ts';
import { injectUiPreviewRuntime, parseUiPreviewSelection } from '../../src/core/uiPreviewRuntime.ts';
import { renderWireframePreview } from '../../src/core/websiteWireframePreview.ts';
import {
  WEBSITE_WORKSPACE_SSOT_PATH,
  WebsiteWorkspaceManager,
} from '../../src/core/websiteWorkspaceManager.ts';
import { UI_STUDIO_REFERENCE_PROJECTS } from '../fixtures/uiStudioReferenceProjects.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function wireframeFacts(pages: readonly WebsitePagePlan[]): unknown {
  return pages.map(page => ({ id: page.id, wireframe: page.wireframe }));
}

function expectTargetIndependentGraph(graph: UiDesignGraph): void {
  expect(Object.keys(graph).sort()).toEqual(['revision', 'screens']);
  for (const screen of graph.screens) {
    expect(Object.keys(screen).sort()).toEqual([
      'baseBreakpoint', 'id', 'initialized', 'nodes', 'pageId',
    ]);
    for (const node of screen.nodes) {
      expect(Object.keys(node).every(key => [
        'id', 'kind', 'label', 'parentId', 'layout', 'viewportOverrides',
        'designPrompt', 'notes', 'contentRef', 'styleRef', 'componentRef',
      ].includes(key))).toBe(true);
      expect(Object.keys(node.layout).sort()).toEqual([
        'align', 'columns', 'direction', 'distribute', 'gap', 'heightMode', 'hidden', 'maxHeight',
        'maxWidth', 'minHeight', 'minWidth', 'mode', 'padding', 'rect', 'widthMode',
      ]);
      expect(Object.keys(node.layout.rect).sort()).toEqual(['height', 'width', 'x', 'y']);
    }
  }

  const serialized = JSON.stringify(graph);
  for (const targetSpecificField of [
    'surfaceKind', 'targetTechnologies', 'sourceRoots', 'slug', 'seoStatus',
    'hostingEnvironments', 'platforms', 'automations', 'frameworkId',
  ]) {
    expect(serialized).not.toContain(`"${targetSpecificField}"`);
  }
}

describe.each(UI_STUDIO_REFERENCE_PROJECTS)('UI Studio reference: $id', reference => {
  it('migrates every legacy wireframe fact to v6 and preserves it through save/reopen', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `atlasmind-${reference.id}-`));
    temporaryRoots.push(root);
    const filePath = path.join(root, WEBSITE_WORKSPACE_SSOT_PATH);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(reference.legacyWorkspace, null, 2)}\n`, 'utf8');

    const manager = new WebsiteWorkspaceManager(root);
    const read = manager.read();
    const legacyPages = reference.legacyWorkspace.pages;

    expect(read.preserveExisting).toBe(false);
    expect(read.config).toMatchObject({ version: 6, surfaceKind: reference.surfaceKind });
    expect(wireframeFacts(read.config.pages)).toEqual(wireframeFacts(legacyPages));
    expectTargetIndependentGraph(read.config.designGraph);

    await manager.save(read.config);
    const reopened = manager.load();
    expect(wireframeFacts(reopened.pages)).toEqual(wireframeFacts(legacyPages));
    expect(reopened.designGraph).toEqual(read.config.designGraph);
  });

  it('uses one revisioned edit/history/selection contract for this target', () => {
    const graph = designGraphFromPages(reference.legacyWorkspace.pages);
    const screen = graph.screens[0]!;
    const node = screen.nodes[0]!;
    const initialLabel = node.label;
    const edited = applyUiEditCommand(createUiEditSession(graph), {
      type: 'set-node-label',
      expectedRevision: 0,
      screenId: screen.id,
      nodeId: node.id,
      label: `${initialLabel} — reviewed`,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) { throw new Error(`Reference edit refused: ${edited.reason}`); }

    const undone = applyUiEditCommand(edited.session, { type: 'undo', expectedRevision: 1 });
    expect(undone.ok).toBe(true);
    if (!undone.ok) { throw new Error(`Reference undo refused: ${undone.reason}`); }
    expect(undone.session.graph.screens[0]?.nodes[0]?.label).toBe(initialLabel);

    const redone = applyUiEditCommand(undone.session, { type: 'redo', expectedRevision: 2 });
    expect(redone.ok).toBe(true);
    if (!redone.ok) { throw new Error(`Reference redo refused: ${redone.reason}`); }
    expect(redone.session.graph.revision).toBe(3);
    expect(redone.session.graph.screens[0]?.nodes[0]?.label).toBe(`${initialLabel} — reviewed`);

    expect(applyUiEditCommand(redone.session, {
      type: 'set-node-label', expectedRevision: 0, screenId: screen.id, nodeId: node.id, label: 'Stale',
    })).toMatchObject({ ok: false, reason: 'stale-revision' });
    expect(parseUiPreviewSelection(JSON.stringify({
      revision: 3, screenId: screen.id, nodeId: node.id,
    }), 3)).toEqual({ revision: 3, screenId: screen.id, nodeId: node.id });
    expect(parseUiPreviewSelection(JSON.stringify({
      revision: 2, screenId: screen.id, nodeId: node.id,
    }), 3)).toBeUndefined();
  });

  it('renders real content and style as a deterministic full browser preview', () => {
    const pages = reference.legacyWorkspace.pages;
    const graph = designGraphFromPages(pages, 7);
    const projectedPages = applyDesignGraphToPages(pages, graph);
    const options = {
      page: projectedPages[0]!,
      siblings: projectedPages,
      designSystem: reference.legacyWorkspace.designSystem,
      siteName: reference.legacyWorkspace.intake.projectName,
      content: reference.content,
      responsiveScreen: graph.screens[0]!,
    };

    const first = renderWireframePreview(options);
    const second = renderWireframePreview(options);
    expect(first).toBe(second);
    expect(first).toContain(reference.proofText);
    expect(first).toContain('Content proof');
    expect(first).toContain('data-atlas-responsive-layout');
    expect(first).toContain(`data-atlas-screen-id="${projectedPages[0]!.id}"`);
    expect(first).toContain(`data-atlas-node-id="${graph.screens[0]!.nodes[0]!.id}"`);
    expect(first).not.toContain('<script');

    const live = injectUiPreviewRuntime(first, graph.revision);
    expect(live).toContain('data-atlas-preview-revision="7"');
    expect(live).toContain('<script src="../_atlas/runtime.js"></script>');
    expectTargetIndependentGraph(graph);
    expect(JSON.stringify(graph)).not.toContain(reference.targetTechnology);
  });

  it('inherits a tablet layout into mobile until that override is explicitly cleared', () => {
    const graph = designGraphFromPages(reference.legacyWorkspace.pages);
    const screen = graph.screens[0]!;
    const node = screen.nodes[0]!;
    const tabletRect = {
      x: node.layout.rect.x + 20,
      y: node.layout.rect.y + 12,
      width: node.layout.rect.width - 40,
      height: node.layout.rect.height,
    };
    const tablet = applyUiEditCommand(createUiEditSession(graph), {
      type: 'set-node-viewport-override', expectedRevision: 0,
      screenId: screen.id, nodeId: node.id, breakpoint: 'tablet', rect: tabletRect,
    });
    expect(tablet.ok).toBe(true);
    if (!tablet.ok) { return; }
    const mobile = applyUiEditCommand(tablet.session, {
      type: 'set-node-viewport-override', expectedRevision: 1,
      screenId: screen.id, nodeId: node.id, breakpoint: 'mobile', hidden: true,
    });
    expect(mobile.ok).toBe(true);
    if (!mobile.ok) { return; }
    const responsiveScreen = mobile.session.graph.screens[0]!;
    const responsiveNode = responsiveScreen.nodes[0]!;
    const resolved = resolveUiNodeLayout(responsiveScreen, responsiveNode, 'mobile');
    expect(resolved.layout).toMatchObject({ rect: tabletRect, hidden: true });
    expect(resolved.provenance.rect).toEqual({ kind: 'override', breakpoint: 'tablet' });
    expect(resolved.provenance.hidden).toEqual({ kind: 'override', breakpoint: 'mobile' });

    const cleared = applyUiEditCommand(mobile.session, {
      type: 'clear-node-viewport-override', expectedRevision: 2,
      screenId: screen.id, nodeId: node.id, breakpoint: 'tablet', property: 'rect',
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) { return; }
    const clearedScreen = cleared.session.graph.screens[0]!;
    const clearedNode = clearedScreen.nodes[0]!;
    expect(resolveUiNodeLayout(clearedScreen, clearedNode, 'mobile').layout.rect)
      .toEqual(node.layout.rect);
  });
});
