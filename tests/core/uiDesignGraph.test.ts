import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyDesignGraphToPages,
  diagnoseUiScreenLayout,
  designGraphFromPages,
  resolveUiDesignToken,
  resolveUiComponentInstance,
  resolveUiNodeLayout,
  resolveUiScreenLayout,
  sanitizeUiDesignGraph,
  UI_DESIGN_GRAPH_MAX_REVISION,
  UI_DESIGN_GRAPH_MAX_TOKENS,
  wireframeFromScreen,
} from '../../src/core/uiDesignGraph.ts';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';

function pagesWithWireframe() {
  const pages = createDefaultWebsiteWorkspace().pages;
  pages[0]!.wireframe = {
    breakpoint: 'tablet',
    elements: [
      {
        id: 'hero',
        kind: 'hero',
        label: 'Opening',
        rect: { x: 10, y: 20, width: 900, height: 360 },
        designPrompt: 'Quiet and editorial.',
        notes: 'Keep the photograph uncropped.',
      },
      {
        id: 'copy',
        kind: 'text',
        label: 'Introduction',
        parentId: 'hero',
        rect: { x: 80, y: 100, width: 480, height: 160 },
        designPrompt: '',
        notes: '',
      },
    ],
  };
  return pages;
}

describe('UI design graph', () => {
  it('transcribes every legacy wireframe fact and round-trips its projection', () => {
    const pages = pagesWithWireframe();
    const graph = designGraphFromPages(pages);
    const screen = graph.screens[0]!;

    expect(screen).toMatchObject({
      id: pages[0]!.id,
      pageId: pages[0]!.id,
      initialized: true,
      baseBreakpoint: 'tablet',
    });
    expect(wireframeFromScreen(screen)).toEqual(pages[0]!.wireframe);
    expect(screen.nodes[1]).toMatchObject({
      id: 'copy',
      parentId: 'hero',
      layout: { mode: 'free', widthMode: 'fixed', heightMode: 'fixed', hidden: false },
      viewportOverrides: {},
    });
  });

  it('preserves the difference between an untouched screen and an empty drawing', () => {
    const pages = createDefaultWebsiteWorkspace().pages;
    const graph = designGraphFromPages(pages);
    expect(graph.screens.every(screen => !screen.initialized)).toBe(true);

    pages[0]!.wireframe = { breakpoint: 'desktop', elements: [] };
    const withEmptyDrawing = designGraphFromPages(pages);
    expect(withEmptyDrawing.screens[0]?.initialized).toBe(true);
    expect(applyDesignGraphToPages(pages, graph)[0]?.wireframe).toBeUndefined();
    expect(applyDesignGraphToPages(pages, withEmptyDrawing)[0]?.wireframe).toEqual({
      breakpoint: 'desktop',
      elements: [],
    });

    const hostile = designGraphFromPages(pages);
    hostile.revision = Number.MAX_SAFE_INTEGER;
    hostile.screens[0]!.initialized = false;
    hostile.screens[0]!.nodes = withEmptyDrawing.screens[0]!.nodes;
    const sanitized = sanitizeUiDesignGraph(hostile, pages);
    expect(sanitized.revision).toBe(UI_DESIGN_GRAPH_MAX_REVISION);
    expect(sanitized.screens[0]?.nodes).toEqual([]);
  });

  it('makes a supplied graph authoritative over its legacy page projection', () => {
    const pages = pagesWithWireframe();
    const graph = designGraphFromPages(pages, 7);
    graph.screens[0]!.nodes[0]!.label = 'Graph wins';

    const sanitized = sanitizeUiDesignGraph(graph, pages);
    const projected = applyDesignGraphToPages(pages, sanitized);

    expect(sanitized.revision).toBe(7);
    expect(projected[0]?.wireframe?.elements[0]?.label).toBe('Graph wins');
    expect(projected[0]?.sections[0]).toBe('Graph wins');
  });

  it('sanitizes typed tokens and resolves same-kind aliases without target assumptions', () => {
    const pages = pagesWithWireframe();
    const graph = designGraphFromPages(pages);
    graph.tokens = [
      { id: 'color-brand', label: 'Brand', kind: 'color', value: '#12abEF' },
      { id: 'color-action', label: 'Action', kind: 'color', aliasOf: 'color-brand' },
      { id: 'space-md', label: 'Medium', kind: 'spacing', value: 16 },
      { id: 'shadow-card', label: 'Card', kind: 'shadow', value: {
        x: 0, y: 8, blur: 24, spread: 0, color: '#000000',
      } },
      { id: 'motion-fast', label: 'Fast', kind: 'motion', value: {
        durationMs: 160, easing: 'ease-out',
      } },
    ];

    const sanitized = sanitizeUiDesignGraph(graph, pages);
    expect(sanitized.tokens).toEqual([
      { id: 'color-brand', label: 'Brand', kind: 'color', value: '#12ABEF' },
      { id: 'color-action', label: 'Action', kind: 'color', aliasOf: 'color-brand' },
      { id: 'space-md', label: 'Medium', kind: 'spacing', value: 16 },
      { id: 'shadow-card', label: 'Card', kind: 'shadow', value: {
        x: 0, y: 8, blur: 24, spread: 0, color: '#000000',
      } },
      { id: 'motion-fast', label: 'Fast', kind: 'motion', value: {
        durationMs: 160, easing: 'ease-out',
      } },
    ]);
    expect(resolveUiDesignToken(sanitized.tokens, 'color-action')).toEqual({
      id: 'color-action',
      label: 'Action',
      kind: 'color',
      value: '#12ABEF',
      sourceTokenId: 'color-brand',
      aliasChain: ['color-action', 'color-brand'],
    });

    const changed = structuredClone(sanitized.tokens);
    const brand = changed.find(token => token.id === 'color-brand')!;
    if ('value' in brand) { brand.value = '#654321'; }
    expect(resolveUiDesignToken(changed, 'color-action')?.value).toBe('#654321');
  });

  it('refuses malformed token values, broken aliases, cross-kind aliases, cycles, and excess entries', () => {
    const pages = pagesWithWireframe();
    const graph = designGraphFromPages(pages);
    graph.tokens = [
      { id: 'valid', label: 'Valid', kind: 'spacing', value: 8 },
      { id: 'broken', label: 'Broken', kind: 'spacing', aliasOf: 'missing' },
      { id: 'cross-kind', label: 'Cross kind', kind: 'color', aliasOf: 'valid' },
      { id: 'cycle-a', label: 'Cycle A', kind: 'spacing', aliasOf: 'cycle-b' },
      { id: 'cycle-b', label: 'Cycle B', kind: 'spacing', aliasOf: 'cycle-a' },
      { id: 'unsafe-font', label: 'Unsafe', kind: 'font-family', value: 'Inter; color: red' },
      { id: 'invalid-shadow', label: 'Invalid shadow', kind: 'shadow', value: {
        x: 0, y: 0, blur: -1, spread: 0, color: '#000000',
      } },
      ...Array.from({ length: UI_DESIGN_GRAPH_MAX_TOKENS }, (_, index) => ({
        id: `extra-${index}`,
        label: `Extra ${index}`,
        kind: 'radius' as const,
        value: index,
      })),
    ];
    const sanitized = sanitizeUiDesignGraph(graph, pages);
    expect(sanitized.tokens).toHaveLength(UI_DESIGN_GRAPH_MAX_TOKENS - 6);
    expect(sanitized.tokens[0]).toMatchObject({ id: 'valid' });
    expect(sanitized.tokens.some(token => token.id === 'broken')).toBe(false);
    expect(sanitized.tokens.some(token => token.id === 'cross-kind')).toBe(false);
    expect(sanitized.tokens.some(token => token.id.startsWith('cycle-'))).toBe(false);
    expect(resolveUiDesignToken(graph.tokens, 'broken')).toBeUndefined();
    expect(resolveUiDesignToken(graph.tokens, 'cross-kind')).toBeUndefined();
    expect(resolveUiDesignToken(graph.tokens, 'cycle-a')).toBeUndefined();
  });

  it('sanitizes component definitions and resolves default, variant, then instance provenance', () => {
    const pages = pagesWithWireframe();
    const graph = designGraphFromPages(pages);
    graph.components = [{
      id: 'hero-card', label: 'Hero card', description: 'Reusable introduction', rootKind: 'hero',
      properties: [
        { id: 'title', label: 'Title', kind: 'text', defaultValue: 'Welcome' },
        { id: 'emphasis', label: 'Emphasis', kind: 'choice', defaultValue: 'quiet', choices: ['quiet', 'strong'] },
      ],
      slots: [{ id: 'body', label: 'Body', required: true, allowedKinds: ['text'], maxChildren: 1 }],
      variants: [{ id: 'campaign', label: 'Campaign', propertyValues: { emphasis: 'strong' } }],
      states: ['default', 'focus', 'loading', 'error'],
    }];
    graph.screens[0]!.nodes[0]!.componentInstance = {
      definitionId: 'hero-card', variantId: 'campaign', state: 'loading', propertyOverrides: { title: 'Summer' },
    };
    graph.screens[0]!.nodes[1]!.componentSlot = 'body';
    const sanitized = sanitizeUiDesignGraph(graph, pages);
    const resolved = resolveUiComponentInstance(sanitized, sanitized.screens[0]!, sanitized.screens[0]!.nodes[0]!);
    expect(resolved).toMatchObject({
      definitionId: 'hero-card', variantId: 'campaign', state: 'loading',
      properties: [
        { id: 'title', value: 'Summer', source: 'instance' },
        { id: 'emphasis', value: 'strong', source: 'variant' },
      ],
      slots: [{ slotId: 'body', nodeIds: ['copy'] }],
    });
  });

  it('drops hostile component values, invalid instances, and impossible slot claims', () => {
    const pages = pagesWithWireframe();
    const graph = designGraphFromPages(pages);
    graph.components = [{
      id: 'hero-card', label: 'Hero card', description: '', rootKind: 'hero',
      properties: [
        { id: 'safe', label: 'Safe', kind: 'number', defaultValue: 2 },
        { id: 'unsafe', label: 'Unsafe', kind: 'choice', defaultValue: 'script', choices: ['quiet'] },
      ],
      slots: [{ id: 'media', label: 'Media', required: false, allowedKinds: ['media'], maxChildren: 1 }],
      variants: [{ id: 'bad', label: 'Bad', propertyValues: { missing: 'x', safe: Number.NaN } }],
      states: ['hover'],
    }];
    graph.screens[0]!.nodes[0]!.componentInstance = {
      definitionId: 'missing', state: 'error', propertyOverrides: { unsafe: '<script>' },
    };
    graph.screens[0]!.nodes[1]!.componentSlot = 'media';
    const sanitized = sanitizeUiDesignGraph(graph, pages);
    expect(sanitized.components[0]).toMatchObject({
      properties: [{ id: 'safe' }], variants: [{ id: 'bad', propertyValues: {} }], states: ['default', 'hover'],
    });
    expect(sanitized.screens[0]!.nodes[0]!.componentInstance).toBeUndefined();
    expect(sanitized.screens[0]!.nodes[1]!.componentSlot).toBeUndefined();
  });

  it('bounds layout, refs, viewport overrides, and invalid hierarchy through one sanitizer', () => {
    const pages = pagesWithWireframe();
    const raw = designGraphFromPages(pages);
    const node = raw.screens[0]!.nodes[1]!;
    (node as unknown as Record<string, unknown>)['locked'] = 'yes';
    node.parentId = 'missing';
    node.layout.rect = { x: -100, y: -10, width: 50_000, height: Number.POSITIVE_INFINITY };
    node.layout.minWidth = 800;
    node.layout.maxWidth = 200;
    Object.assign(node.layout as unknown as Record<string, unknown>, { wrap: 'reverse', order: 2_000 });
    node.contentRef = '../content/<script>';
    node.viewportOverrides.mobile = {
      rect: { x: -100, y: 9_000, width: 0, height: 0 },
      hidden: true,
      mode: 'grid',
      columns: 50,
      gap: 24,
      minHeight: 500,
      maxHeight: 100,
      wrap: 'wrap',
      order: -20,
    };

    const sanitized = sanitizeUiDesignGraph(raw, pages);
    const result = sanitized.screens[0]!.nodes[1]!;

    expect(result.parentId).toBeUndefined();
    expect(result.locked).toBe(false);
    expect(result.layout.rect.x).toBeGreaterThanOrEqual(0);
    expect(result.layout.rect.width).toBeLessThanOrEqual(1_000);
    expect(result.contentRef).toBe('content-script');
    expect(result.layout).toMatchObject({ minWidth: 800, maxWidth: null });
    expect(result.layout).toMatchObject({ wrap: 'nowrap', order: 0 });
    expect(result.viewportOverrides.mobile).toMatchObject({ hidden: true, mode: 'grid', gap: 24 });
    expect(result.viewportOverrides.mobile?.columns).toBeUndefined();
    expect(result.viewportOverrides.mobile?.minHeight).toBe(500);
    expect(result.viewportOverrides.mobile?.maxHeight).toBeUndefined();
    expect(result.viewportOverrides.mobile).toMatchObject({ wrap: 'wrap', order: -20 });

    raw.screens[0]!.nodes[0]!.locked = true;
    expect(sanitizeUiDesignGraph(raw, pages).screens[0]!.nodes[0]!.locked).toBe(true);
  });

  it('inherits responsive properties in order and reports the source of every computed value', () => {
    const graph = designGraphFromPages(pagesWithWireframe());
    const screen = graph.screens[0]!;
    const node = screen.nodes[0]!;
    node.viewportOverrides.mobile = { hidden: true };
    node.viewportOverrides.desktop = {
      rect: { x: 20, y: 30, width: 960, height: 400 },
    };

    // This migrated fixture has a tablet base. Wider desktop uses its exact
    // override; smaller mobile inherits tablet geometry and adds mobile state.
    const desktop = resolveUiNodeLayout(screen, node, 'desktop');
    expect(desktop.layout.rect).toEqual({ x: 20, y: 30, width: 960, height: 400 });
    expect(desktop.provenance.rect).toEqual({ kind: 'override', breakpoint: 'desktop' });

    const mobile = resolveUiNodeLayout(screen, node, 'mobile');
    expect(mobile.layout.rect).toEqual(node.layout.rect);
    expect(mobile.layout.hidden).toBe(true);
    expect(mobile.provenance).toEqual({
      mode: { kind: 'base', breakpoint: 'tablet' },
      rect: { kind: 'base', breakpoint: 'tablet' },
      widthMode: { kind: 'base', breakpoint: 'tablet' },
      heightMode: { kind: 'base', breakpoint: 'tablet' },
      hidden: { kind: 'override', breakpoint: 'mobile' },
      direction: { kind: 'base', breakpoint: 'tablet' },
      gap: { kind: 'base', breakpoint: 'tablet' },
      padding: { kind: 'base', breakpoint: 'tablet' },
      columns: { kind: 'base', breakpoint: 'tablet' },
      align: { kind: 'base', breakpoint: 'tablet' },
      distribute: { kind: 'base', breakpoint: 'tablet' },
      minWidth: { kind: 'base', breakpoint: 'tablet' },
      maxWidth: { kind: 'base', breakpoint: 'tablet' },
      minHeight: { kind: 'base', breakpoint: 'tablet' },
      maxHeight: { kind: 'base', breakpoint: 'tablet' },
      wrap: { kind: 'base', breakpoint: 'tablet' },
      order: { kind: 'base', breakpoint: 'tablet' },
    });

    const desktopBase = { ...screen, baseBreakpoint: 'desktop' as const };
    node.viewportOverrides.tablet = { rect: { x: 40, y: 50, width: 820, height: 320 } };
    const inheritedMobile = resolveUiNodeLayout(desktopBase, node, 'mobile');
    expect(inheritedMobile.layout.rect).toEqual(node.viewportOverrides.tablet.rect);
    expect(inheritedMobile.provenance.rect).toEqual({ kind: 'override', breakpoint: 'tablet' });
  });

  it('reports deterministic responsive overflow, clipping, overlap, and touch-target findings', () => {
    const graph = designGraphFromPages(pagesWithWireframe());
    const screen = graph.screens[0]!;
    const parent = screen.nodes[0]!;
    const child = screen.nodes[1]!;
    parent.layout.rect = { x: 0, y: 3_700, width: 300, height: 300 };
    parent.layout.mode = 'stack';
    parent.layout.padding = 0;
    parent.layout.gap = 200;
    child.kind = 'cta';
    child.layout.rect = { x: 250, y: 3_850, width: 100, height: 24 };
    const sibling = structuredClone(child);
    sibling.id = 'second-action';
    sibling.label = 'Second action';
    sibling.parentId = 'hero';
    sibling.layout.rect = { x: 260, y: 3_860, width: 100, height: 180 };
    screen.nodes.push(sibling);
    const overlapping = structuredClone(child);
    overlapping.id = 'floating-copy';
    overlapping.kind = 'text';
    overlapping.label = 'Floating copy';
    delete overlapping.parentId;
    overlapping.layout.rect = { x: 10, y: 3_710, width: 180, height: 180 };
    screen.nodes.push(overlapping);

    const diagnostics = diagnoseUiScreenLayout(screen, 'mobile');
    expect(diagnostics.some(item => item.code === 'viewport-overflow')).toBe(true);
    expect(diagnostics.some(item => item.code === 'parent-clipping')).toBe(true);
    expect(diagnostics.some(item => item.code === 'node-overlap')).toBe(true);
    expect(diagnostics.some(item => item.code === 'touch-target' && item.nodeIds[0] === 'copy')).toBe(true);
    expect(diagnostics.every(item => item.breakpoint === 'mobile')).toBe(true);
    expect(diagnostics).toEqual(diagnoseUiScreenLayout(screen, 'mobile'));

    parent.layout.mode = 'overlay';
    const overlayDiagnostics = diagnoseUiScreenLayout(screen, 'desktop');
    expect(overlayDiagnostics.some(item => item.code === 'node-overlap'
      && item.nodeIds.includes('copy') && item.nodeIds.includes('second-action'))).toBe(false);
  });

  it('projects grid and responsive stack containers without rewriting stored child rectangles', () => {
    const graph = designGraphFromPages(pagesWithWireframe());
    const screen = graph.screens[0]!;
    const parent = screen.nodes[0]!;
    const first = screen.nodes[1]!;
    const second = structuredClone(first);
    second.id = 'copy-2';
    second.label = 'Second';
    second.layout.rect = { x: 600, y: 100, width: 200, height: 120 };
    screen.nodes.push(second);
    Object.assign(parent.layout, {
      mode: 'grid', padding: 20, gap: 20, columns: 2, align: 'stretch', direction: 'horizontal',
    });
    first.layout.widthMode = 'fill';
    second.layout.widthMode = 'fill';

    const stored = screen.nodes.slice(1).map(node => ({ ...node.layout.rect }));
    const grid = new Map(resolveUiScreenLayout(screen, 'tablet').map(node => [node.id, node]));
    expect(grid.get('copy')?.layout.rect).toEqual({ x: 30, y: 40, width: 420, height: 160 });
    expect(grid.get('copy-2')?.layout.rect).toEqual({ x: 470, y: 40, width: 420, height: 120 });
    expect(grid.get('copy')?.provenance.rect).toEqual({
      kind: 'computed', breakpoint: 'tablet', containerId: 'hero', reason: 'container',
    });

    parent.viewportOverrides.mobile = { mode: 'stack', gap: 10, direction: 'vertical' };
    const mobile = new Map(resolveUiScreenLayout(screen, 'mobile').map(node => [node.id, node]));
    expect(mobile.get('copy')?.layout.rect).toEqual({ x: 30, y: 40, width: 860, height: 160 });
    expect(mobile.get('copy-2')?.layout.rect).toEqual({ x: 30, y: 210, width: 860, height: 120 });
    expect(parent.layout.mode).toBe('grid');
    expect(screen.nodes.slice(1).map(node => node.layout.rect)).toEqual(stored);
  });

  it('projects inherited min/max constraints without replacing stored geometry', () => {
    const graph = designGraphFromPages(pagesWithWireframe());
    const screen = graph.screens[0]!;
    const node = screen.nodes[0]!;
    const stored = { ...node.layout.rect };
    node.layout.maxWidth = 600;
    node.layout.minHeight = 420;
    node.viewportOverrides.mobile = { maxWidth: 320, minHeight: 240, maxHeight: 300 };

    const tablet = resolveUiScreenLayout(screen, 'tablet').find(candidate => candidate.id === node.id)!;
    expect(tablet.layout.rect).toEqual({ x: 10, y: 20, width: 600, height: 420 });
    expect(tablet.provenance.rect).toEqual({ kind: 'computed', breakpoint: 'tablet', reason: 'constraints' });

    const mobile = resolveUiScreenLayout(screen, 'mobile').find(candidate => candidate.id === node.id)!;
    expect(mobile.layout.rect).toEqual({ x: 10, y: 20, width: 320, height: 300 });
    expect(mobile.provenance.maxWidth).toEqual({ kind: 'override', breakpoint: 'mobile' });
    expect(mobile.provenance.minWidth).toEqual({ kind: 'base', breakpoint: 'tablet' });
    expect(node.layout.rect).toEqual(stored);
  });

  it('orders container children before wrapping a stack into deterministic lines', () => {
    const graph = designGraphFromPages(pagesWithWireframe());
    const screen = graph.screens[0]!;
    const parent = screen.nodes[0]!;
    const first = screen.nodes[1]!;
    const second = structuredClone(first);
    second.id = 'copy-2';
    second.layout.rect = { x: 500, y: 100, width: 500, height: 120 };
    second.layout.order = -1;
    screen.nodes.push(second);
    Object.assign(parent.layout, {
      mode: 'stack', direction: 'horizontal', wrap: 'wrap', padding: 20, gap: 20, align: 'start',
    });

    const wrapped = new Map(resolveUiScreenLayout(screen, 'tablet').map(node => [node.id, node]));
    expect(wrapped.get('copy-2')?.layout.rect).toEqual({ x: 30, y: 40, width: 500, height: 120 });
    expect(wrapped.get('copy')?.layout.rect).toEqual({ x: 30, y: 180, width: 480, height: 160 });

    first.viewportOverrides.mobile = { order: -2 };
    const reordered = new Map(resolveUiScreenLayout(screen, 'mobile').map(node => [node.id, node]));
    expect(reordered.get('copy')?.layout.rect).toEqual({ x: 30, y: 40, width: 480, height: 160 });
    expect(reordered.get('copy-2')?.layout.rect).toEqual({ x: 30, y: 220, width: 500, height: 120 });
    expect(reordered.get('copy')?.provenance.order).toEqual({ kind: 'override', breakpoint: 'mobile' });
  });

  it('is total for arbitrary untrusted graph input', () => {
    const pages = pagesWithWireframe();
    fc.assert(fc.property(fc.anything(), input => {
      const graph = sanitizeUiDesignGraph(input, pages);
      expect(graph.screens).toHaveLength(pages.length);
      expect(graph.tokens.length).toBeLessThanOrEqual(UI_DESIGN_GRAPH_MAX_TOKENS);
      expect(graph.components.length).toBeLessThanOrEqual(100);
      expect(Number.isSafeInteger(graph.revision)).toBe(true);
      for (const screen of graph.screens) {
        expect(pages.some(page => page.id === screen.pageId)).toBe(true);
      }
    }));
  });
});
