/**
 * UI Studio's target-independent design graph and its compatibility projection.
 *
 * The graph is authoritative when it is present in a v6 workspace. Existing
 * readers still consume `WebsitePagePlan.wireframe`, so save/load derives that
 * projection from the graph rather than asking two structures to agree. Pure,
 * total at the untrusted-input boundary, and `vscode`-free.
 */

import type {
  UiDesignGraph,
  UiDesignNode,
  UiDesignScreen,
  UiLayoutMode,
  UiNodeViewportOverride,
  UiSizeMode,
  WebsitePagePlan,
  WebsiteWireframe,
  WireframeBreakpoint,
} from '../types.js';
import {
  deriveSectionLabels,
  sanitizeRect,
  sanitizeWireframe,
  wireframeKindSpec,
  WIREFRAME_BREAKPOINTS,
} from './websiteWireframe.js';

export const UI_DESIGN_GRAPH_MAX_REVISION = 2_147_483_647;
const MAX_REFERENCE_LENGTH = 160;
const LAYOUT_MODES = new Set<UiLayoutMode>(['free', 'stack', 'grid', 'overlay']);
const SIZE_MODES = new Set<UiSizeMode>(['fixed', 'fill', 'hug']);
const BREAKPOINTS = new Set<WireframeBreakpoint>(WIREFRAME_BREAKPOINTS);

export interface UiLayoutPropertySource {
  kind: 'base' | 'override';
  breakpoint: WireframeBreakpoint;
}

export interface ResolvedUiNodeLayout {
  layout: UiDesignNode['layout'];
  provenance: {
    mode: UiLayoutPropertySource;
    rect: UiLayoutPropertySource;
    widthMode: UiLayoutPropertySource;
    heightMode: UiLayoutPropertySource;
    hidden: UiLayoutPropertySource;
  };
}

/**
 * Resolve one node at a viewport while retaining where every value came from.
 * Smaller viewports inherit intervening overrides (desktop → tablet → mobile).
 * A legacy mobile/tablet base can still describe a wider viewport, but only an
 * exact wider override changes it; migration never invents the missing intent.
 */
export function resolveUiNodeLayout(
  screen: UiDesignScreen,
  node: UiDesignNode,
  breakpoint: WireframeBreakpoint,
): ResolvedUiNodeLayout {
  const baseSource = (): UiLayoutPropertySource => ({
    kind: 'base',
    breakpoint: screen.baseBreakpoint,
  });
  const layout: UiDesignNode['layout'] = {
    ...node.layout,
    rect: { ...node.layout.rect },
  };
  const provenance: ResolvedUiNodeLayout['provenance'] = {
    mode: baseSource(),
    rect: baseSource(),
    widthMode: baseSource(),
    heightMode: baseSource(),
    hidden: baseSource(),
  };
  const baseIndex = WIREFRAME_BREAKPOINTS.indexOf(screen.baseBreakpoint);
  const targetIndex = WIREFRAME_BREAKPOINTS.indexOf(breakpoint);
  const candidates = targetIndex > baseIndex
    ? WIREFRAME_BREAKPOINTS.slice(baseIndex + 1, targetIndex + 1)
    : targetIndex < baseIndex
      ? [breakpoint]
      : [];

  for (const candidate of candidates) {
    const override = node.viewportOverrides[candidate];
    if (!override) {
      continue;
    }
    if (override.rect) {
      layout.rect = { ...override.rect };
      provenance.rect = { kind: 'override', breakpoint: candidate };
    }
    if (override.hidden !== undefined) {
      layout.hidden = override.hidden;
      provenance.hidden = { kind: 'override', breakpoint: candidate };
    }
  }

  return { layout, provenance };
}

/** Transcribe every compatible page fact into the v6 graph without guessing. */
export function designGraphFromPages(
  pages: readonly WebsitePagePlan[],
  revision = 0,
): UiDesignGraph {
  return {
    revision: sanitizeRevision(revision),
    screens: pages.map(page => screenFromPage(page)),
  };
}

/**
 * Sanitize an untrusted graph against the pages that own its screen identities.
 * Missing screens are transcribed from their page, so a partial/hand-edited
 * graph cannot make an unrelated page disappear.
 */
export function sanitizeUiDesignGraph(
  input: unknown,
  pages: readonly WebsitePagePlan[],
): UiDesignGraph {
  const source = asRecord(input);
  const rawScreens = Array.isArray(source['screens']) ? source['screens'] : [];
  const byPageId = new Map<string, Record<string, unknown>>();
  const knownPageIds = new Set(pages.map(page => page.id));

  for (const candidate of rawScreens) {
    const record = asRecord(candidate);
    const pageId = cleanIdentifier(record['pageId']);
    if (pageId && knownPageIds.has(pageId) && !byPageId.has(pageId)) {
      byPageId.set(pageId, record);
    }
  }

  return {
    revision: sanitizeRevision(source['revision']),
    screens: pages.map(page => {
      const candidate = byPageId.get(page.id);
      return candidate ? sanitizeScreen(candidate, page) : screenFromPage(page);
    }),
  };
}

/** Rebuild the compatibility wireframes from the authoritative graph. */
export function applyDesignGraphToPages(
  pages: readonly WebsitePagePlan[],
  graph: UiDesignGraph,
): WebsitePagePlan[] {
  const screens = new Map(graph.screens.map(screen => [screen.pageId, screen]));
  return pages.map(page => {
    const screen = screens.get(page.id);
    if (!screen) {
      return page;
    }
    if (!screen.initialized) {
      const { wireframe: _wireframe, ...withoutWireframe } = page;
      return withoutWireframe;
    }
    const wireframe = wireframeFromScreen(screen);
    return {
      ...page,
      wireframe,
      sections: deriveSectionLabels(wireframe),
    };
  });
}

/** Convert one graph screen to the existing bounded wireframe projection. */
export function wireframeFromScreen(screen: UiDesignScreen): WebsiteWireframe {
  return {
    breakpoint: screen.baseBreakpoint,
    elements: screen.nodes.map(node => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      rect: { ...node.layout.rect },
      ...(node.parentId ? { parentId: node.parentId } : {}),
      designPrompt: node.designPrompt,
      notes: node.notes,
    })),
  };
}

function screenFromPage(page: WebsitePagePlan): UiDesignScreen {
  const wireframe = page.wireframe;
  return {
    id: page.id,
    pageId: page.id,
    initialized: wireframe !== undefined,
    baseBreakpoint: wireframe?.breakpoint ?? 'desktop',
    nodes: wireframe?.elements.map(element => ({
      id: element.id,
      kind: element.kind,
      label: element.label,
      ...(element.parentId ? { parentId: element.parentId } : {}),
      layout: {
        mode: 'free',
        rect: { ...element.rect },
        widthMode: 'fixed',
        heightMode: 'fixed',
        hidden: false,
      },
      viewportOverrides: {},
      designPrompt: element.designPrompt,
      notes: element.notes,
    })) ?? [],
  };
}

function sanitizeScreen(input: Record<string, unknown>, page: WebsitePagePlan): UiDesignScreen {
  const initialized = input['initialized'] === true;
  const breakpoint = BREAKPOINTS.has(input['baseBreakpoint'] as WireframeBreakpoint)
    ? input['baseBreakpoint'] as WireframeBreakpoint
    : page.wireframe?.breakpoint ?? 'desktop';
  const rawNodes = Array.isArray(input['nodes']) ? input['nodes'] : [];
  const rawById = new Map<string, Record<string, unknown>>();
  const compatibleNodes = rawNodes.map(candidate => {
    const record = asRecord(candidate);
    const layout = asRecord(record['layout']);
    const id = cleanIdentifier(record['id']);
    if (id && !rawById.has(id)) {
      rawById.set(id, record);
    }
    return {
      id: record['id'],
      kind: record['kind'],
      label: record['label'],
      parentId: record['parentId'],
      rect: layout['rect'],
      designPrompt: record['designPrompt'],
      notes: record['notes'],
    };
  });
  const wireframe = sanitizeWireframe({ breakpoint, elements: compatibleNodes });

  return {
    id: page.id,
    pageId: page.id,
    initialized,
    baseBreakpoint: wireframe?.breakpoint ?? breakpoint,
    nodes: initialized ? (wireframe?.elements ?? []).map(element => {
      const raw = rawById.get(element.id) ?? {};
      const layout = asRecord(raw['layout']);
      return {
        id: element.id,
        kind: element.kind,
        label: element.label,
        ...(element.parentId ? { parentId: element.parentId } : {}),
        layout: {
          mode: LAYOUT_MODES.has(layout['mode'] as UiLayoutMode)
            ? layout['mode'] as UiLayoutMode
            : 'free',
          rect: element.rect,
          widthMode: SIZE_MODES.has(layout['widthMode'] as UiSizeMode)
            ? layout['widthMode'] as UiSizeMode
            : 'fixed',
          heightMode: SIZE_MODES.has(layout['heightMode'] as UiSizeMode)
            ? layout['heightMode'] as UiSizeMode
            : 'fixed',
          hidden: layout['hidden'] === true,
        },
        viewportOverrides: sanitizeOverrides(raw['viewportOverrides'], element.kind, breakpoint),
        designPrompt: element.designPrompt,
        notes: element.notes,
        ...optionalReference('contentRef', raw['contentRef']),
        ...optionalReference('styleRef', raw['styleRef']),
        ...optionalReference('componentRef', raw['componentRef']),
      };
    }) : [],
  };
}

function sanitizeOverrides(
  input: unknown,
  kind: UiDesignNode['kind'],
  baseBreakpoint: WireframeBreakpoint,
): UiDesignNode['viewportOverrides'] {
  const source = asRecord(input);
  const overrides: Partial<Record<WireframeBreakpoint, UiNodeViewportOverride>> = {};
  for (const breakpoint of WIREFRAME_BREAKPOINTS) {
    if (breakpoint === baseBreakpoint) {
      continue;
    }
    const raw = asRecord(source[breakpoint]);
    const hasRect = isRecord(source[breakpoint]) && isRecord(raw['rect']);
    const hasHidden = typeof raw['hidden'] === 'boolean';
    if (!hasRect && !hasHidden) {
      continue;
    }
    overrides[breakpoint] = {
      ...(hasRect ? { rect: sanitizeRect(raw['rect'], wireframeKindSpec(kind)) } : {}),
      ...(hasHidden ? { hidden: raw['hidden'] as boolean } : {}),
    };
  }
  return overrides;
}

function optionalReference(
  key: 'contentRef' | 'styleRef' | 'componentRef',
  value: unknown,
): Partial<Record<typeof key, string>> {
  const cleaned = cleanIdentifier(value, MAX_REFERENCE_LENGTH);
  return cleaned ? { [key]: cleaned } : {};
}

function sanitizeRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return 0;
  }
  return Math.min(value, UI_DESIGN_GRAPH_MAX_REVISION);
}

function cleanIdentifier(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, maxLength);
  return cleaned || undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
