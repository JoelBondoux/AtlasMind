/**
 * UI Studio's target-independent design graph and its compatibility projection.
 *
 * The graph is authoritative when it is present in a v7 workspace. Existing
 * readers still consume `WebsitePagePlan.wireframe`, so save/load derives that
 * projection from the graph rather than asking two structures to agree. Pure,
 * total at the untrusted-input boundary, and `vscode`-free.
 */

import type {
  UiComponentDefinition,
  UiComponentInstance,
  UiComponentPropertyDefinition,
  UiComponentPropertyKind,
  UiComponentPropertyValue,
  UiComponentState,
  UiAssetDiagnostic,
  UiContentCollection,
  UiContentDiagnostic,
  UiContentFieldKind,
  UiContentMaturity,
  UiContentSampleValue,
  UiDesignGraph,
  UiDesignAsset,
  UiDesignAssetCrop,
  UiDesignAssetKind,
  UiDesignNode,
  UiDesignScreen,
  UiDesignToken,
  UiDesignTokenKind,
  UiDesignTokenValue,
  UiLayoutAlignment,
  UiLayoutDirection,
  UiLayoutDistribution,
  UiLayoutMode,
  UiLayoutWrap,
  UiNodeViewportOverride,
  UiNodeContentState,
  UiNodeDataBinding,
  UiSizeMode,
  WebsitePagePlan,
  WebsiteWireframe,
  WireframeBreakpoint,
  WireframeRect,
} from '../types.js';
import {
  deriveSectionLabels,
  isWireframeElementKind,
  sanitizeRect,
  sanitizeWireframe,
  wireframeKindSpec,
  WIREFRAME_BREAKPOINTS,
  WIREFRAME_CANVAS_HEIGHT,
  WIREFRAME_CANVAS_WIDTH,
} from './websiteWireframe.js';

export const UI_DESIGN_GRAPH_MAX_REVISION = 2_147_483_647;
const MAX_REFERENCE_LENGTH = 160;
export const UI_DESIGN_GRAPH_MAX_TOKENS = 200;
export const UI_DESIGN_GRAPH_MAX_COMPONENTS = 100;
export const UI_DESIGN_GRAPH_MAX_CONTENT_COLLECTIONS = 50;
export const UI_DESIGN_GRAPH_MAX_ASSETS = 200;
export const UI_CONTENT_COLLECTION_MAX_FIELDS = 20;
export const UI_CONTENT_COLLECTION_MAX_SAMPLES = 50;
export const UI_COMPONENT_MAX_PROPERTIES = 30;
export const UI_COMPONENT_MAX_SLOTS = 20;
export const UI_COMPONENT_MAX_VARIANTS = 30;
const MAX_TOKEN_LABEL_LENGTH = 120;
const MAX_COMPONENT_TEXT_LENGTH = 500;
const MAX_COMPONENT_CHOICES = 40;
const TOKEN_KINDS = new Set<UiDesignTokenKind>([
  'color', 'font-family', 'font-size', 'font-weight', 'line-height',
  'spacing', 'radius', 'shadow', 'motion', 'breakpoint',
]);
const COMPONENT_PROPERTY_KINDS = new Set<UiComponentPropertyKind>(['text', 'number', 'boolean', 'choice']);
const COMPONENT_STATES = new Set<UiComponentState>([
  'default', 'hover', 'focus', 'active', 'disabled', 'loading', 'empty', 'error', 'success', 'validation',
]);
const NODE_CONTENT_STATES = new Set<UiNodeContentState>(['default', 'empty', 'loading', 'error', 'success']);
const CONTENT_MATURITIES = new Set<UiContentMaturity>(['placeholder', 'draft', 'reviewed', 'approved']);
const CONTENT_FIELD_KINDS = new Set<UiContentFieldKind>(['text', 'number', 'boolean', 'url', 'date']);
const ASSET_KINDS = new Set<UiDesignAssetKind>(['image', 'illustration', 'icon', 'video-poster']);
const ASSET_CROPS = new Set<UiDesignAssetCrop>(['cover', 'contain', 'none']);
const MAX_ASSET_REFERENCE_LENGTH = 1_000;
const MAX_ASSET_DIMENSION = 100_000;
const NODE_CONTENT_SLOTS = new Set(['title', 'body', 'action']);
const MOTION_EASINGS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
const LAYOUT_MODES = new Set<UiLayoutMode>(['free', 'stack', 'grid', 'overlay']);
const SIZE_MODES = new Set<UiSizeMode>(['fixed', 'fill', 'hug']);
const LAYOUT_DIRECTIONS = new Set<UiLayoutDirection>(['vertical', 'horizontal']);
const LAYOUT_ALIGNMENTS = new Set<UiLayoutAlignment>(['start', 'center', 'end', 'stretch']);
const LAYOUT_DISTRIBUTIONS = new Set<UiLayoutDistribution>(['start', 'center', 'end', 'space-between']);
const LAYOUT_WRAPS = new Set<UiLayoutWrap>(['nowrap', 'wrap']);
const BREAKPOINTS = new Set<WireframeBreakpoint>(WIREFRAME_BREAKPOINTS);
export const UI_LAYOUT_MAX_GAP = 500;
export const UI_LAYOUT_MAX_PADDING = 500;
export const UI_LAYOUT_MAX_COLUMNS = 12;
export const UI_LAYOUT_MAX_ORDER = 1_000;

export interface UiLayoutPropertySource {
  kind: 'base' | 'override' | 'computed';
  breakpoint: WireframeBreakpoint;
  containerId?: string;
  reason?: 'container' | 'constraints';
}

export interface ResolvedUiNodeLayout {
  layout: UiDesignNode['layout'];
  provenance: {
    mode: UiLayoutPropertySource;
    rect: UiLayoutPropertySource;
    widthMode: UiLayoutPropertySource;
    heightMode: UiLayoutPropertySource;
    hidden: UiLayoutPropertySource;
    direction: UiLayoutPropertySource;
    gap: UiLayoutPropertySource;
    padding: UiLayoutPropertySource;
    columns: UiLayoutPropertySource;
    align: UiLayoutPropertySource;
    distribute: UiLayoutPropertySource;
    minWidth: UiLayoutPropertySource;
    maxWidth: UiLayoutPropertySource;
    minHeight: UiLayoutPropertySource;
    maxHeight: UiLayoutPropertySource;
    wrap: UiLayoutPropertySource;
    order: UiLayoutPropertySource;
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
    direction: baseSource(),
    gap: baseSource(),
    padding: baseSource(),
    columns: baseSource(),
    align: baseSource(),
    distribute: baseSource(),
    minWidth: baseSource(),
    maxWidth: baseSource(),
    minHeight: baseSource(),
    maxHeight: baseSource(),
    wrap: baseSource(),
    order: baseSource(),
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
    for (const property of [
      'mode', 'widthMode', 'heightMode', 'direction', 'gap', 'padding', 'columns', 'align', 'distribute',
      'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
      'wrap', 'order',
    ] as const) {
      if (override[property] !== undefined) {
        Object.assign(layout, { [property]: override[property] });
        provenance[property] = { kind: 'override', breakpoint: candidate };
      }
    }
    if (override.hidden !== undefined) {
      layout.hidden = override.hidden;
      provenance.hidden = { kind: 'override', breakpoint: candidate };
    }
  }

  return { layout, provenance };
}

export interface ResolvedUiScreenNode extends ResolvedUiNodeLayout {
  id: string;
}

export interface ResolvedUiDesignToken {
  id: string;
  label: string;
  kind: UiDesignTokenKind;
  value: UiDesignTokenValue;
  /** The direct-value token at the end of this alias chain. */
  sourceTokenId: string;
  /** Ordered from the requested token to the direct-value token. */
  aliasChain: string[];
}

export interface ResolvedUiComponentProperty {
  id: string;
  label: string;
  kind: UiComponentPropertyKind;
  value: UiComponentPropertyValue;
  source: 'default' | 'variant' | 'instance';
}

export interface ResolvedUiComponentInstance {
  definitionId: string;
  definitionLabel: string;
  variantId?: string;
  variantLabel?: string;
  state: UiComponentState;
  properties: ResolvedUiComponentProperty[];
  slots: Array<{ slotId: string; label: string; nodeIds: string[] }>;
}

/** Resolve definition defaults, then variant values, then bounded instance overrides. */
export function resolveUiComponentInstance(
  graph: UiDesignGraph,
  screen: UiDesignScreen,
  node: UiDesignNode,
): ResolvedUiComponentInstance | undefined {
  const instance = node.componentInstance;
  if (!instance) { return undefined; }
  const definition = graph.components.find(candidate => candidate.id === instance.definitionId);
  if (!definition || definition.rootKind !== node.kind || !definition.states.includes(instance.state)) {
    return undefined;
  }
  const variant = instance.variantId
    ? definition.variants.find(candidate => candidate.id === instance.variantId)
    : undefined;
  if (instance.variantId && !variant) { return undefined; }
  const properties = definition.properties.map(property => {
    let value = property.defaultValue;
    let source: ResolvedUiComponentProperty['source'] = 'default';
    if (variant && Object.prototype.hasOwnProperty.call(variant.propertyValues, property.id)) {
      value = variant.propertyValues[property.id]!;
      source = 'variant';
    }
    if (Object.prototype.hasOwnProperty.call(instance.propertyOverrides, property.id)) {
      value = instance.propertyOverrides[property.id]!;
      source = 'instance';
    }
    return { id: property.id, label: property.label, kind: property.kind, value, source };
  });
  return {
    definitionId: definition.id,
    definitionLabel: definition.label,
    ...(variant ? { variantId: variant.id, variantLabel: variant.label } : {}),
    state: instance.state,
    properties,
    slots: definition.slots.map(slot => ({
      slotId: slot.id,
      label: slot.label,
      nodeIds: screen.nodes
        .filter(candidate => candidate.parentId === node.id && candidate.componentSlot === slot.id)
        .map(candidate => candidate.id),
    })),
  };
}

/**
 * Resolve one typed token without interpreting it as CSS or target code.
 * Missing targets, cross-kind aliases, and cycles are refused deterministically.
 */
export function resolveUiDesignToken(
  tokens: readonly UiDesignToken[],
  tokenId: string,
): ResolvedUiDesignToken | undefined {
  const byId = new Map(tokens.map(token => [token.id, token]));
  const requested = byId.get(tokenId);
  if (!requested) {
    return undefined;
  }
  const visited = new Set<string>();
  const aliasChain: string[] = [];
  let current = requested;
  while (true) {
    if (visited.has(current.id) || current.kind !== requested.kind) {
      return undefined;
    }
    visited.add(current.id);
    aliasChain.push(current.id);
    if ('value' in current && current.value !== undefined) {
      return {
        id: requested.id,
        label: requested.label,
        kind: requested.kind,
        value: cloneTokenValue(current.value),
        sourceTokenId: current.id,
        aliasChain,
      };
    }
    const next = byId.get(current.aliasOf);
    if (!next) {
      return undefined;
    }
    current = next;
  }
}

export type UiResponsiveDiagnosticCode =
  | 'viewport-overflow'
  | 'parent-clipping'
  | 'node-overlap'
  | 'touch-target';

export interface UiResponsiveDiagnostic {
  code: UiResponsiveDiagnosticCode;
  severity: 'error' | 'warning';
  breakpoint: WireframeBreakpoint;
  nodeIds: string[];
  message: string;
}

const PREVIEW_WIDTH_BY_BREAKPOINT: Record<WireframeBreakpoint, number> = {
  desktop: 1_280,
  tablet: 834,
  mobile: 390,
};
const MIN_TOUCH_TARGET_PX = 44;
const INTERACTIVE_KINDS = new Set<UiDesignNode['kind']>(['nav', 'form', 'cta', 'footer']);

/**
 * Resolve a complete screen, including deterministic container layout.
 * Node rectangles remain stored as design inputs; stack/grid/overlay produce
 * a projection and never rewrite children merely because a parent mode changed.
 */
export function resolveUiScreenLayout(
  screen: UiDesignScreen,
  breakpoint: WireframeBreakpoint,
): ResolvedUiScreenNode[] {
  const resolved = screen.nodes.map(node => {
    const view = { id: node.id, ...resolveUiNodeLayout(screen, node, breakpoint) };
    const constrained = constrainRect(view.layout, WIREFRAME_CANVAS_WIDTH, WIREFRAME_CANVAS_HEIGHT);
    if (!sameRect(view.layout.rect, constrained)) {
      view.layout.rect = constrained;
      view.provenance.rect = { kind: 'computed', breakpoint, reason: 'constraints' };
    }
    return view;
  });
  const byId = new Map(resolved.map(node => [node.id, node]));
  const sourceById = new Map(screen.nodes.map(node => [node.id, node]));
  const depth = (node: UiDesignNode): number => {
    let value = 0;
    let parentId = node.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      value += 1;
      parentId = sourceById.get(parentId)?.parentId;
    }
    return value;
  };
  const parents = [...screen.nodes].sort((left, right) => depth(left) - depth(right));
  for (const parent of parents) {
    const parentView = byId.get(parent.id);
    if (!parentView || parentView.layout.mode === 'free' || !wireframeKindSpec(parent.kind).container) {
      continue;
    }
    const children = screen.nodes
      .filter(node => node.parentId === parent.id)
      .map(node => ({ source: node, view: byId.get(node.id)! }))
      .filter(candidate => candidate.view && !candidate.view.layout.hidden)
      .sort((left, right) => left.view.layout.order - right.view.layout.order
        || left.view.layout.rect.y - right.view.layout.rect.y
        || left.view.layout.rect.x - right.view.layout.rect.x
        || left.source.id.localeCompare(right.source.id));
    if (children.length === 0) {
      continue;
    }
    const projected = arrangeContainerChildren(parentView.layout, children.map(child => child.view.layout));
    children.forEach((child, index) => {
      child.view.layout.rect = projected[index]!;
      child.view.provenance.rect = { kind: 'computed', breakpoint, containerId: parent.id, reason: 'container' };
    });
  }
  return resolved;
}

/**
 * Deterministic responsive checks over the same projection used by Studio and
 * Full Preview. Unknown is not a pass: callers run this for every breakpoint.
 */
export function diagnoseUiScreenLayout(
  screen: UiDesignScreen,
  breakpoint: WireframeBreakpoint,
): UiResponsiveDiagnostic[] {
  const resolved = resolveUiScreenLayout(screen, breakpoint);
  const sourceById = new Map(screen.nodes.map(node => [node.id, node]));
  const viewById = new Map(resolved.map(node => [node.id, node]));
  const visible = resolved.filter(node => !node.layout.hidden);
  const diagnostics: UiResponsiveDiagnostic[] = [];
  const label = (id: string): string => sourceById.get(id)?.label || id;

  for (const view of visible) {
    const rect = view.layout.rect;
    if (rect.x < 0 || rect.y < 0
        || rect.x + rect.width > WIREFRAME_CANVAS_WIDTH
        || rect.y + rect.height > WIREFRAME_CANVAS_HEIGHT) {
      diagnostics.push({
        code: 'viewport-overflow', severity: 'error', breakpoint, nodeIds: [view.id],
        message: `${label(view.id)} extends beyond the ${breakpoint} canvas.`,
      });
    }
    const source = sourceById.get(view.id);
    const parentView = source?.parentId ? viewById.get(source.parentId) : undefined;
    if (parentView && !parentView.layout.hidden && !containsRect(parentView.layout.rect, rect)) {
      diagnostics.push({
        code: 'parent-clipping', severity: 'error', breakpoint, nodeIds: [view.id, parentView.id],
        message: `${label(view.id)} extends outside ${label(parentView.id)} and may be clipped.`,
      });
    }
    if (source && INTERACTIVE_KINDS.has(source.kind)) {
      const viewportWidth = PREVIEW_WIDTH_BY_BREAKPOINT[breakpoint];
      const minimumCanvasUnits = MIN_TOUCH_TARGET_PX / viewportWidth * WIREFRAME_CANVAS_WIDTH;
      if (rect.width < minimumCanvasUnits || rect.height < minimumCanvasUnits) {
        diagnostics.push({
          code: 'touch-target', severity: 'warning', breakpoint, nodeIds: [view.id],
          message: `${label(view.id)} is smaller than 44px in the ${breakpoint} preview.`,
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < visible.length; leftIndex += 1) {
    const left = visible[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < visible.length; rightIndex += 1) {
      const right = visible[rightIndex]!;
      if (!rectsOverlap(left.layout.rect, right.layout.rect)
          || isAncestor(sourceById, left.id, right.id)
          || isAncestor(sourceById, right.id, left.id)
          || sharesOverlayParent(sourceById, viewById, left.id, right.id)) {
        continue;
      }
      diagnostics.push({
        code: 'node-overlap', severity: 'warning', breakpoint, nodeIds: [left.id, right.id],
        message: `${label(left.id)} overlaps ${label(right.id)} at ${breakpoint}.`,
      });
    }
  }
  return diagnostics;
}

function containsRect(parent: WireframeRect, child: WireframeRect): boolean {
  return child.x >= parent.x && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

function rectsOverlap(left: WireframeRect, right: WireframeRect): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

function isAncestor(nodes: ReadonlyMap<string, UiDesignNode>, ancestorId: string, nodeId: string): boolean {
  let parentId = nodes.get(nodeId)?.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) { return true; }
    seen.add(parentId);
    parentId = nodes.get(parentId)?.parentId;
  }
  return false;
}

function sharesOverlayParent(
  nodes: ReadonlyMap<string, UiDesignNode>,
  views: ReadonlyMap<string, ResolvedUiScreenNode>,
  leftId: string,
  rightId: string,
): boolean {
  const parentId = nodes.get(leftId)?.parentId;
  return parentId !== undefined
    && parentId === nodes.get(rightId)?.parentId
    && views.get(parentId)?.layout.mode === 'overlay';
}

function arrangeContainerChildren(
  parent: UiDesignNode['layout'],
  children: readonly UiDesignNode['layout'][],
): WireframeRect[] {
  const padding = Math.min(parent.padding, parent.rect.width / 2, parent.rect.height / 2);
  const inner = {
    x: parent.rect.x + padding,
    y: parent.rect.y + padding,
    width: Math.max(1, parent.rect.width - padding * 2),
    height: Math.max(1, parent.rect.height - padding * 2),
  };
  if (parent.mode === 'overlay') {
    return children.map(child => {
      const desiredWidth = child.widthMode === 'fill' || parent.align === 'stretch'
        ? inner.width : Math.min(child.rect.width, inner.width);
      const desiredHeight = child.heightMode === 'fill'
        ? inner.height : Math.min(child.rect.height, inner.height);
      const width = constrainAxis(desiredWidth, child.minWidth, child.maxWidth, inner.width);
      const height = constrainAxis(desiredHeight, child.minHeight, child.maxHeight, inner.height);
      const x = crossPosition(inner.x, inner.width, width, parent.align);
      const y = mainPosition(inner.y, inner.height, height, parent.distribute);
      return roundedRect(x, y, width, height);
    });
  }
  if (parent.mode === 'grid') {
    return arrangeGrid(parent, children, inner);
  }
  return arrangeStack(parent, children, inner);
}

function arrangeStack(
  parent: UiDesignNode['layout'],
  children: readonly UiDesignNode['layout'][],
  inner: WireframeRect,
): WireframeRect[] {
  if (parent.wrap === 'wrap' && children.length > 1) {
    return arrangeWrappedStack(parent, children, inner);
  }
  return arrangeStackRun(parent, children, inner);
}

function arrangeWrappedStack(
  parent: UiDesignNode['layout'],
  children: readonly UiDesignNode['layout'][],
  inner: WireframeRect,
): WireframeRect[] {
  const horizontal = parent.direction === 'horizontal';
  const mainAvailable = horizontal ? inner.width : inner.height;
  const crossAvailable = horizontal ? inner.height : inner.width;
  const lines: UiDesignNode['layout'][][] = [];
  let current: UiDesignNode['layout'][] = [];
  let occupied = 0;
  for (const child of children) {
    const main = intrinsicMain(child, horizontal, mainAvailable);
    const next = current.length === 0 ? main : occupied + parent.gap + main;
    if (current.length > 0 && next > mainAvailable) {
      lines.push(current);
      current = [];
      occupied = 0;
    }
    occupied = current.length === 0 ? main : occupied + parent.gap + main;
    current.push(child);
  }
  if (current.length > 0) {
    lines.push(current);
  }

  let crossCursor = crossStart(horizontal, inner);
  return lines.flatMap(line => {
    const lineCross = Math.min(crossAvailable, Math.max(...line.map(child =>
      intrinsicCross(child, horizontal, crossAvailable))));
    const lineRect = horizontal
      ? { x: inner.x, y: crossCursor, width: inner.width, height: lineCross }
      : { x: crossCursor, y: inner.y, width: lineCross, height: inner.height };
    crossCursor += lineCross + parent.gap;
    return arrangeStackRun(parent, line, lineRect);
  });
}

function arrangeStackRun(
  parent: UiDesignNode['layout'],
  children: readonly UiDesignNode['layout'][],
  inner: WireframeRect,
): WireframeRect[] {
  const horizontal = parent.direction === 'horizontal';
  const mainAvailable = horizontal ? inner.width : inner.height;
  const crossAvailable = horizontal ? inner.height : inner.width;
  const fillChildren = children.filter(child => horizontal
    ? child.widthMode === 'fill' : child.heightMode === 'fill').length;
  const fixedTotal = children.reduce((sum, child) => {
    if ((horizontal ? child.widthMode : child.heightMode) === 'fill') {
      return sum;
    }
    const size = horizontal ? child.rect.width : child.rect.height;
    return sum + (horizontal
      ? constrainAxis(size, child.minWidth, child.maxWidth, mainAvailable)
      : constrainAxis(size, child.minHeight, child.maxHeight, mainAvailable));
  }, 0);
  const baseGaps = parent.gap * Math.max(0, children.length - 1);
  const fillSize = fillChildren > 0 ? Math.max(1, (mainAvailable - fixedTotal - baseGaps) / fillChildren) : 0;
  const sizes = children.map(child => {
    const desiredMain = (horizontal ? child.widthMode : child.heightMode) === 'fill'
      ? fillSize : Math.min(horizontal ? child.rect.width : child.rect.height, mainAvailable);
    const desiredCross = (horizontal ? child.heightMode : child.widthMode) === 'fill' || parent.align === 'stretch'
      ? crossAvailable : Math.min(horizontal ? child.rect.height : child.rect.width, crossAvailable);
    const main = horizontal
      ? constrainAxis(desiredMain, child.minWidth, child.maxWidth, mainAvailable)
      : constrainAxis(desiredMain, child.minHeight, child.maxHeight, mainAvailable);
    const cross = horizontal
      ? constrainAxis(desiredCross, child.minHeight, child.maxHeight, crossAvailable)
      : constrainAxis(desiredCross, child.minWidth, child.maxWidth, crossAvailable);
    return { main, cross };
  });
  const contentSize = sizes.reduce((sum, size) => sum + size.main, 0) + baseGaps;
  const placement = distributedRun(innerStart(horizontal, inner), mainAvailable, contentSize, parent.gap,
    children.length, parent.distribute);
  let cursor = placement.start;
  return sizes.map(size => {
    const cross = crossPosition(crossStart(horizontal, inner), crossAvailable, size.cross, parent.align);
    const rect = horizontal
      ? roundedRect(cursor, cross, size.main, size.cross)
      : roundedRect(cross, cursor, size.cross, size.main);
    cursor += size.main + placement.gap;
    return rect;
  });
}

function intrinsicMain(child: UiDesignNode['layout'], horizontal: boolean, available: number): number {
  const fill = (horizontal ? child.widthMode : child.heightMode) === 'fill';
  const size = fill ? available : (horizontal ? child.rect.width : child.rect.height);
  return horizontal
    ? constrainAxis(size, child.minWidth, child.maxWidth, available)
    : constrainAxis(size, child.minHeight, child.maxHeight, available);
}

function intrinsicCross(child: UiDesignNode['layout'], horizontal: boolean, available: number): number {
  const size = horizontal ? child.rect.height : child.rect.width;
  return horizontal
    ? constrainAxis(size, child.minHeight, child.maxHeight, available)
    : constrainAxis(size, child.minWidth, child.maxWidth, available);
}

function arrangeGrid(
  parent: UiDesignNode['layout'],
  children: readonly UiDesignNode['layout'][],
  inner: WireframeRect,
): WireframeRect[] {
  const columns = Math.max(1, Math.min(parent.columns, children.length));
  const rows = Math.ceil(children.length / columns);
  const cellWidth = Math.max(1, (inner.width - parent.gap * (columns - 1)) / columns);
  const rowHeights = Array.from({ length: rows }, (_, row) => children
    .filter((_, index) => gridPosition(index, columns, rows, parent.direction).row === row)
    .reduce((height, child) => Math.max(height,
      constrainAxis(child.rect.height, child.minHeight, child.maxHeight, inner.height)), 1));
  const contentHeight = rowHeights.reduce((sum, height) => sum + height, 0) + parent.gap * (rows - 1);
  const placement = distributedRun(inner.y, inner.height, contentHeight, parent.gap, rows, parent.distribute);
  const rowStarts: number[] = [];
  let cursor = placement.start;
  for (const height of rowHeights) {
    rowStarts.push(cursor);
    cursor += height + placement.gap;
  }
  return children.map((child, index) => {
    const position = gridPosition(index, columns, rows, parent.direction);
    const cellX = inner.x + position.column * (cellWidth + parent.gap);
    const cellHeight = rowHeights[position.row]!;
    const desiredWidth = child.widthMode === 'fill' || parent.align === 'stretch'
      ? cellWidth : Math.min(child.rect.width, cellWidth);
    const desiredHeight = child.heightMode === 'fill' ? cellHeight : Math.min(child.rect.height, cellHeight);
    const width = constrainAxis(desiredWidth, child.minWidth, child.maxWidth, cellWidth);
    const height = constrainAxis(desiredHeight, child.minHeight, child.maxHeight, cellHeight);
    return roundedRect(
      crossPosition(cellX, cellWidth, width, parent.align),
      rowStarts[position.row]!,
      width,
      height,
    );
  });
}

function gridPosition(index: number, columns: number, rows: number, direction: UiLayoutDirection): { row: number; column: number } {
  return direction === 'horizontal'
    ? { row: Math.floor(index / columns), column: index % columns }
    : { row: index % rows, column: Math.floor(index / rows) };
}

function distributedRun(
  start: number,
  available: number,
  content: number,
  gap: number,
  count: number,
  distribution: UiLayoutDistribution,
): { start: number; gap: number } {
  const remaining = Math.max(0, available - content);
  if (distribution === 'center') { return { start: start + remaining / 2, gap }; }
  if (distribution === 'end') { return { start: start + remaining, gap }; }
  if (distribution === 'space-between' && count > 1) {
    return { start, gap: gap + remaining / (count - 1) };
  }
  return { start, gap };
}

function crossPosition(start: number, available: number, size: number, alignment: UiLayoutAlignment): number {
  if (alignment === 'center') { return start + (available - size) / 2; }
  if (alignment === 'end') { return start + available - size; }
  return start;
}

function mainPosition(start: number, available: number, size: number, distribution: UiLayoutDistribution): number {
  if (distribution === 'center') { return start + (available - size) / 2; }
  if (distribution === 'end') { return start + available - size; }
  return start;
}

function innerStart(horizontal: boolean, rect: WireframeRect): number {
  return horizontal ? rect.x : rect.y;
}

function crossStart(horizontal: boolean, rect: WireframeRect): number {
  return horizontal ? rect.y : rect.x;
}

function roundedRect(x: number, y: number, width: number, height: number): WireframeRect {
  return {
    x: Math.round(x * 1_000) / 1_000,
    y: Math.round(y * 1_000) / 1_000,
    width: Math.max(1, Math.round(width * 1_000) / 1_000),
    height: Math.max(1, Math.round(height * 1_000) / 1_000),
  };
}

function constrainRect(layout: UiDesignNode['layout'], availableWidth: number, availableHeight: number): WireframeRect {
  const width = constrainAxis(layout.rect.width, layout.minWidth, layout.maxWidth, availableWidth);
  const height = constrainAxis(layout.rect.height, layout.minHeight, layout.maxHeight, availableHeight);
  return roundedRect(
    Math.min(layout.rect.x, Math.max(0, availableWidth - width)),
    Math.min(layout.rect.y, Math.max(0, availableHeight - height)),
    width,
    height,
  );
}

function constrainAxis(size: number, minimum: number | null, maximum: number | null, available: number): number {
  const safeMinimum = Math.min(minimum ?? 1, available);
  const safeMaximum = Math.max(safeMinimum, Math.min(maximum ?? available, available));
  return Math.max(safeMinimum, Math.min(size, safeMaximum));
}

function sameRect(left: WireframeRect, right: WireframeRect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

/** Transcribe every compatible page fact into the v7 graph without guessing. */
export function designGraphFromPages(
  pages: readonly WebsitePagePlan[],
  revision = 0,
): UiDesignGraph {
  return {
    revision: sanitizeRevision(revision),
    tokens: [],
    components: [],
    contentCollections: [],
    assets: [],
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

  const components = sanitizeUiComponentDefinitions(source['components']);
  const contentCollections = sanitizeUiContentCollections(source['contentCollections']);
  const assets = sanitizeUiDesignAssets(source['assets']);
  return {
    revision: sanitizeRevision(source['revision']),
    tokens: sanitizeUiDesignTokens(source['tokens']),
    components,
    contentCollections,
    assets,
    screens: pages.map(page => {
      const candidate = byPageId.get(page.id);
      return candidate ? sanitizeScreen(candidate, page, components) : screenFromPage(page);
    }),
  };
}

/** Sanitize the complete token collection at every persisted or command boundary. */
export function sanitizeUiDesignTokens(input: unknown): UiDesignToken[] {
  const rawTokens = Array.isArray(input) ? input.slice(0, UI_DESIGN_GRAPH_MAX_TOKENS) : [];
  const candidates: UiDesignToken[] = [];
  const ids = new Set<string>();
  for (const candidate of rawTokens) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanTokenLabel(source['label']);
    const kind = TOKEN_KINDS.has(source['kind'] as UiDesignTokenKind)
      ? source['kind'] as UiDesignTokenKind
      : undefined;
    if (!id || !label || !kind || ids.has(id)) {
      continue;
    }
    const aliasOf = cleanIdentifier(source['aliasOf']);
    if (aliasOf) {
      candidates.push({ id, label, kind, aliasOf });
      ids.add(id);
      continue;
    }
    const value = sanitizeTokenValue(kind, source['value']);
    if (value !== undefined) {
      candidates.push({ id, label, kind, value });
      ids.add(id);
    }
  }

  // An alias is only retained if its entire same-kind path reaches a direct
  // value. This one rule removes missing targets, cross-kind links and cycles.
  return candidates.filter(token => 'value' in token
    || resolveUiDesignToken(candidates, token.id) !== undefined);
}

/** Sanitize the complete component library without evaluating target markup or style. */
export function sanitizeUiComponentDefinitions(input: unknown): UiComponentDefinition[] {
  const rawDefinitions = Array.isArray(input) ? input.slice(0, UI_DESIGN_GRAPH_MAX_COMPONENTS) : [];
  const definitions: UiComponentDefinition[] = [];
  const definitionIds = new Set<string>();
  for (const candidate of rawDefinitions) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanComponentText(source['label'], 120);
    const description = cleanComponentText(source['description'], MAX_COMPONENT_TEXT_LENGTH, true);
    if (!id || !label || description === undefined || definitionIds.has(id)
        || !isWireframeElementKind(source['rootKind'])) {
      continue;
    }
    const properties = sanitizeComponentProperties(source['properties']);
    const propertyById = new Map(properties.map(property => [property.id, property]));
    const slots = sanitizeComponentSlots(source['slots']);
    const variants = sanitizeComponentVariants(source['variants'], propertyById);
    const states = sanitizeComponentStates(source['states']);
    definitions.push({
      id,
      label,
      description,
      rootKind: source['rootKind'],
      properties,
      slots,
      variants,
      states,
    });
    definitionIds.add(id);
  }
  return definitions;
}

/** Validate an instance against a sanitized definition collection. */
export function sanitizeUiComponentInstance(
  input: unknown,
  definitions: readonly UiComponentDefinition[],
  nodeKind: UiDesignNode['kind'],
): UiComponentInstance | undefined {
  const source = asRecord(input);
  const definitionId = cleanIdentifier(source['definitionId']);
  const definition = definitionId
    ? definitions.find(candidate => candidate.id === definitionId && candidate.rootKind === nodeKind)
    : undefined;
  if (!definition) { return undefined; }
  const variantId = cleanIdentifier(source['variantId']);
  if (variantId && !definition.variants.some(candidate => candidate.id === variantId)) {
    return undefined;
  }
  const state = COMPONENT_STATES.has(source['state'] as UiComponentState)
    && definition.states.includes(source['state'] as UiComponentState)
    ? source['state'] as UiComponentState
    : 'default';
  const propertyById = new Map(definition.properties.map(property => [property.id, property]));
  const propertyOverrides = sanitizeComponentPropertyValues(source['propertyOverrides'], propertyById);
  return { definitionId: definition.id, ...(variantId ? { variantId } : {}), state, propertyOverrides };
}

function sanitizeComponentProperties(input: unknown): UiComponentPropertyDefinition[] {
  const raw = Array.isArray(input) ? input.slice(0, UI_COMPONENT_MAX_PROPERTIES) : [];
  const properties: UiComponentPropertyDefinition[] = [];
  const ids = new Set<string>();
  for (const candidate of raw) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanComponentText(source['label'], 120);
    const kind = COMPONENT_PROPERTY_KINDS.has(source['kind'] as UiComponentPropertyKind)
      ? source['kind'] as UiComponentPropertyKind
      : undefined;
    if (!id || !label || !kind || ids.has(id)) { continue; }
    const choices = kind === 'choice' ? sanitizeComponentChoices(source['choices']) : undefined;
    const defaultValue = sanitizeComponentPropertyValue(kind, source['defaultValue'], choices);
    if (defaultValue === undefined || (kind === 'choice' && choices?.length === 0)) { continue; }
    properties.push({ id, label, kind, defaultValue, ...(choices ? { choices } : {}) });
    ids.add(id);
  }
  return properties;
}

function sanitizeComponentSlots(input: unknown): UiComponentDefinition['slots'] {
  const raw = Array.isArray(input) ? input.slice(0, UI_COMPONENT_MAX_SLOTS) : [];
  const slots: UiComponentDefinition['slots'] = [];
  const ids = new Set<string>();
  for (const candidate of raw) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanComponentText(source['label'], 120);
    if (!id || !label || ids.has(id) || !Number.isSafeInteger(source['maxChildren'])
        || (source['maxChildren'] as number) < 1 || (source['maxChildren'] as number) > 60) {
      continue;
    }
    const allowedKinds = Array.isArray(source['allowedKinds'])
      ? [...new Set(source['allowedKinds'].filter(isWireframeElementKind))]
      : [];
    slots.push({
      id, label, required: source['required'] === true, allowedKinds,
      maxChildren: source['maxChildren'] as number,
    });
    ids.add(id);
  }
  return slots;
}

function sanitizeComponentVariants(
  input: unknown,
  properties: ReadonlyMap<string, UiComponentPropertyDefinition>,
): UiComponentDefinition['variants'] {
  const raw = Array.isArray(input) ? input.slice(0, UI_COMPONENT_MAX_VARIANTS) : [];
  const variants: UiComponentDefinition['variants'] = [];
  const ids = new Set<string>();
  for (const candidate of raw) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanComponentText(source['label'], 120);
    if (!id || !label || ids.has(id)) { continue; }
    variants.push({
      id, label,
      propertyValues: sanitizeComponentPropertyValues(source['propertyValues'], properties),
    });
    ids.add(id);
  }
  return variants;
}

function sanitizeComponentPropertyValues(
  input: unknown,
  properties: ReadonlyMap<string, UiComponentPropertyDefinition>,
): Record<string, UiComponentPropertyValue> {
  const source = asRecord(input);
  const result: Record<string, UiComponentPropertyValue> = {};
  for (const [id, candidate] of Object.entries(source).slice(0, UI_COMPONENT_MAX_PROPERTIES)) {
    const property = properties.get(id);
    if (!property) { continue; }
    const value = sanitizeComponentPropertyValue(property.kind, candidate, property.choices);
    if (value !== undefined) { result[id] = value; }
  }
  return result;
}

function sanitizeComponentPropertyValue(
  kind: UiComponentPropertyKind,
  input: unknown,
  choices?: readonly string[],
): UiComponentPropertyValue | undefined {
  if (kind === 'boolean') { return typeof input === 'boolean' ? input : undefined; }
  if (kind === 'number') {
    return typeof input === 'number' && Number.isFinite(input) && input >= -1_000_000 && input <= 1_000_000
      ? input : undefined;
  }
  if (typeof input !== 'string') { return undefined; }
  const value = cleanComponentText(input, MAX_COMPONENT_TEXT_LENGTH, true);
  if (value === undefined) { return undefined; }
  return kind === 'choice' && !choices?.includes(value) ? undefined : value;
}

function sanitizeComponentChoices(input: unknown): string[] {
  if (!Array.isArray(input)) { return []; }
  const choices: string[] = [];
  for (const candidate of input.slice(0, MAX_COMPONENT_CHOICES)) {
    const choice = cleanComponentText(candidate, 120);
    if (choice && !choices.includes(choice)) { choices.push(choice); }
  }
  return choices;
}

function sanitizeComponentStates(input: unknown): UiComponentState[] {
  const supplied = Array.isArray(input)
    ? input.filter((candidate): candidate is UiComponentState => COMPONENT_STATES.has(candidate as UiComponentState))
    : [];
  return ['default', ...new Set(supplied.filter(candidate => candidate !== 'default'))];
}

function cleanComponentText(input: unknown, maximum: number, allowEmpty = false): string | undefined {
  if (typeof input !== 'string') { return undefined; }
  const cleaned = input.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum);
  return cleaned || (allowEmpty ? '' : undefined);
}

function sanitizeTokenValue(kind: UiDesignTokenKind, input: unknown): UiDesignTokenValue | undefined {
  switch (kind) {
    case 'color':
      return cleanHexColor(input);
    case 'font-family':
      return typeof input === 'string' && /^[a-zA-Z0-9 _,-]{1,120}$/.test(input.trim())
        ? input.trim()
        : undefined;
    case 'font-size':
      return boundedNumber(input, 1, 256);
    case 'font-weight':
      return boundedInteger(input, 100, 900);
    case 'line-height':
      return boundedNumber(input, 0.5, 3);
    case 'spacing':
    case 'radius':
      return boundedNumber(input, 0, 1_000);
    case 'breakpoint':
      return boundedInteger(input, 240, 2_560);
    case 'shadow': {
      const source = asRecord(input);
      const x = boundedNumber(source['x'], -1_000, 1_000);
      const y = boundedNumber(source['y'], -1_000, 1_000);
      const blur = boundedNumber(source['blur'], 0, 1_000);
      const spread = boundedNumber(source['spread'], 0, 1_000);
      const color = cleanHexColor(source['color']);
      return x !== undefined && y !== undefined && blur !== undefined && spread !== undefined && color
        ? { x, y, blur, spread, color }
        : undefined;
    }
    case 'motion': {
      const source = asRecord(input);
      const durationMs = boundedInteger(source['durationMs'], 0, 60_000);
      const easing = typeof source['easing'] === 'string' && MOTION_EASINGS.has(source['easing'])
        ? source['easing'] as 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
        : undefined;
      return durationMs !== undefined && easing ? { durationMs, easing } : undefined;
    }
  }
}

function cleanTokenLabel(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  const label = input.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_TOKEN_LABEL_LENGTH);
  return label || undefined;
}

function cleanHexColor(input: unknown): string | undefined {
  return typeof input === 'string' && /^#[0-9a-fA-F]{6}$/.test(input)
    ? input.toUpperCase()
    : undefined;
}

function boundedNumber(input: unknown, minimum: number, maximum: number): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input >= minimum && input <= maximum
    ? input
    : undefined;
}

function boundedInteger(input: unknown, minimum: number, maximum: number): number | undefined {
  return Number.isSafeInteger(input) && (input as number) >= minimum && (input as number) <= maximum
    ? input as number
    : undefined;
}

function cloneTokenValue(value: UiDesignTokenValue): UiDesignTokenValue {
  return typeof value === 'object' ? { ...value } : value;
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
      locked: false,
      ...(element.parentId ? { parentId: element.parentId } : {}),
      layout: {
        mode: 'free',
        rect: { ...element.rect },
        widthMode: 'fixed',
        heightMode: 'fixed',
        hidden: false,
        direction: 'vertical',
        gap: 16,
        padding: 16,
        columns: 2,
        align: 'start',
        distribute: 'start',
        minWidth: null,
        maxWidth: null,
        minHeight: null,
        maxHeight: null,
        wrap: 'nowrap',
        order: 0,
      },
      viewportOverrides: {},
      designPrompt: element.designPrompt,
      notes: element.notes,
    })) ?? [],
  };
}

function sanitizeScreen(
  input: Record<string, unknown>,
  page: WebsitePagePlan,
  components: readonly UiComponentDefinition[],
): UiDesignScreen {
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

  const nodes: UiDesignNode[] = initialized ? (wireframe?.elements ?? []).map(element => {
      const raw = rawById.get(element.id) ?? {};
      const layout = asRecord(raw['layout']);
      const constraints = sanitizeConstraintSet(layout);
      const componentInstance = sanitizeUiComponentInstance(raw['componentInstance'], components, element.kind);
      const contentStatePresentations = sanitizeNodeStatePresentations(raw['contentStatePresentations']);
      const dataBinding = sanitizeUiNodeDataBinding(raw['dataBinding']);
      const previewContentState = NODE_CONTENT_STATES.has(raw['previewContentState'] as UiNodeContentState)
        ? raw['previewContentState'] as UiNodeContentState
        : 'default';
      return {
        id: element.id,
        kind: element.kind,
        label: element.label,
        locked: raw['locked'] === true,
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
          direction: LAYOUT_DIRECTIONS.has(layout['direction'] as UiLayoutDirection)
            ? layout['direction'] as UiLayoutDirection
            : 'vertical',
          gap: boundedLayoutNumber(layout['gap'], 16, UI_LAYOUT_MAX_GAP),
          padding: boundedLayoutNumber(layout['padding'], 16, UI_LAYOUT_MAX_PADDING),
          columns: boundedLayoutInteger(layout['columns'], 2, 1, UI_LAYOUT_MAX_COLUMNS),
          align: LAYOUT_ALIGNMENTS.has(layout['align'] as UiLayoutAlignment)
            ? layout['align'] as UiLayoutAlignment
            : 'start',
          distribute: LAYOUT_DISTRIBUTIONS.has(layout['distribute'] as UiLayoutDistribution)
            ? layout['distribute'] as UiLayoutDistribution
            : 'start',
          ...constraints,
          wrap: LAYOUT_WRAPS.has(layout['wrap'] as UiLayoutWrap)
            ? layout['wrap'] as UiLayoutWrap
            : 'nowrap',
          order: boundedLayoutInteger(layout['order'], 0, -UI_LAYOUT_MAX_ORDER, UI_LAYOUT_MAX_ORDER),
        },
        viewportOverrides: sanitizeOverrides(raw['viewportOverrides'], element.kind, breakpoint),
        designPrompt: element.designPrompt,
        notes: element.notes,
        ...optionalReference('contentRef', raw['contentRef']),
        ...optionalReference('styleRef', raw['styleRef']),
        ...optionalReference('componentRef', raw['componentRef']),
        ...(componentInstance ? { componentInstance } : {}),
        ...optionalComponentSlot(raw['componentSlot']),
        ...(previewContentState !== 'default' ? { previewContentState } : {}),
        ...(Object.keys(contentStatePresentations).length > 0 ? { contentStatePresentations } : {}),
        ...(dataBinding ? { dataBinding } : {}),
        ...optionalReference('assetRef', raw['assetRef']),
      };
    }) : [];
  sanitizeComponentSlotsOnNodes(nodes, components);

  return {
    id: page.id,
    pageId: page.id,
    initialized,
    baseBreakpoint: wireframe?.breakpoint ?? breakpoint,
    nodes,
  };
}

/** Short state copy is bounded separately from the screen's long-form Markdown authority. */
export function sanitizeNodeStatePresentations(
  input: unknown,
): NonNullable<UiDesignNode['contentStatePresentations']> {
  const source = asRecord(input);
  const result: NonNullable<UiDesignNode['contentStatePresentations']> = {};
  for (const state of ['empty', 'loading', 'error', 'success'] as const) {
    const raw = asRecord(source[state]);
    const title = cleanStateCopy(raw['title'], 160);
    const body = cleanStateCopy(raw['body'], 1_000);
    const actionLabel = cleanStateCopy(raw['actionLabel'], 120);
    const maturity = CONTENT_MATURITIES.has(raw['maturity'] as UiContentMaturity)
      ? raw['maturity'] as UiContentMaturity
      : undefined;
    if (title === undefined || body === undefined || actionLabel === undefined || !maturity) { continue; }
    const unresolved = /\[PLACEHOLDER:\s*[^\]]*\]/i.test(`${title}\n${body}\n${actionLabel}`);
    result[state] = { title, body, actionLabel, maturity: maturity === 'approved' && unresolved ? 'placeholder' : maturity };
  }
  return result;
}

export interface ResolvedUiNodeContent {
  collectionId: string;
  collectionLabel: string;
  sampleRecordId: string;
  sampleRecordLabel: string;
  values: Partial<Record<'title' | 'body' | 'action', string>>;
}

/** Resolve only declared sample facts. Missing references stay absent and are diagnosed separately. */
export function resolveUiNodeContent(
  graph: UiDesignGraph,
  node: UiDesignNode,
): ResolvedUiNodeContent | undefined {
  const binding = node.dataBinding;
  if (!binding) { return undefined; }
  const collection = graph.contentCollections.find(candidate => candidate.id === binding.collectionId);
  const sample = collection?.samples.find(candidate => candidate.id === binding.sampleRecordId);
  if (!collection || !sample) { return undefined; }
  const values: ResolvedUiNodeContent['values'] = {};
  for (const [slot, fieldId] of Object.entries(binding.fieldMappings)) {
    if (!NODE_CONTENT_SLOTS.has(slot) || !collection.fields.some(field => field.id === fieldId)) { continue; }
    const value = sample.values[fieldId];
    if (value !== undefined) { values[slot as keyof ResolvedUiNodeContent['values']] = String(value); }
  }
  return {
    collectionId: collection.id,
    collectionLabel: collection.label,
    sampleRecordId: sample.id,
    sampleRecordLabel: sample.label,
    values,
  };
}

/** Report broken bindings and missing state designs at the node that owns the decision. */
export function diagnoseUiContentBindings(
  graph: UiDesignGraph,
  screen: UiDesignScreen,
): UiContentDiagnostic[] {
  const diagnostics: UiContentDiagnostic[] = [];
  for (const node of screen.nodes) {
    const binding = node.dataBinding;
    if (!binding) { continue; }
    const collection = graph.contentCollections.find(candidate => candidate.id === binding.collectionId);
    if (!collection) {
      diagnostics.push({
        code: 'collection-not-found', severity: 'error', nodeIds: [node.id],
        message: `${node.label} references missing collection ${binding.collectionId}.`,
      });
      continue;
    }
    const sample = collection.samples.find(candidate => candidate.id === binding.sampleRecordId);
    if (!sample) {
      diagnostics.push({
        code: 'sample-record-not-found', severity: 'error', nodeIds: [node.id],
        message: `${node.label} references missing sample ${binding.sampleRecordId} in ${collection.label}.`,
      });
    }
    for (const [slot, fieldId] of Object.entries(binding.fieldMappings)) {
      const field = collection.fields.find(candidate => candidate.id === fieldId);
      if (!field) {
        diagnostics.push({
          code: 'field-not-found', severity: 'error', nodeIds: [node.id],
          message: `${node.label}'s ${slot} binding references missing field ${fieldId}.`,
        });
      } else if (sample && sample.values[fieldId] === undefined) {
        diagnostics.push({
          code: 'sample-value-missing', severity: field.required ? 'error' : 'warning', nodeIds: [node.id],
          message: `${node.label}'s sample has no ${field.label} value for its ${slot}.`,
        });
      }
    }
    for (const state of ['empty', 'loading', 'error', 'success'] as const) {
      if (!node.contentStatePresentations?.[state]) {
        diagnostics.push({
          code: 'content-state-missing', severity: 'warning', nodeIds: [node.id],
          message: `${node.label} is data-bound but has no designed ${state} presentation.`,
        });
      }
    }
  }
  return diagnostics;
}

/** Resolve one stable node reference without fetching or interpreting its source. */
export function resolveUiDesignAsset(
  graph: UiDesignGraph,
  node: UiDesignNode,
): UiDesignAsset | undefined {
  return node.assetRef ? graph.assets.find(asset => asset.id === node.assetRef) : undefined;
}

/** Report missing asset authority and alternative text at the assigning node. */
export function diagnoseUiAssets(
  graph: UiDesignGraph,
  screen: UiDesignScreen,
): UiAssetDiagnostic[] {
  const diagnostics: UiAssetDiagnostic[] = [];
  for (const node of screen.nodes) {
    if (!node.assetRef) { continue; }
    const asset = resolveUiDesignAsset(graph, node);
    if (!asset) {
      diagnostics.push({
        code: 'asset-not-found', severity: 'error', nodeIds: [node.id],
        message: `${node.label} references missing asset ${node.assetRef}.`,
      });
    } else if (!asset.decorative && asset.altText.length === 0) {
      diagnostics.push({
        code: 'asset-alt-missing', severity: 'error', nodeIds: [node.id],
        message: `${node.label}'s ${asset.label} asset needs alternative text or an explicit decorative decision.`,
      });
    }
  }
  return diagnostics;
}

/** Sanitize bounded metadata and syntactically validated source references. */
export function sanitizeUiDesignAssets(input: unknown): UiDesignAsset[] {
  const rawAssets = Array.isArray(input) ? input.slice(0, UI_DESIGN_GRAPH_MAX_ASSETS) : [];
  const assets: UiDesignAsset[] = [];
  const ids = new Set<string>();
  for (const candidate of rawAssets) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanComponentText(source['label'], 120);
    const kind = ASSET_KINDS.has(source['kind'] as UiDesignAssetKind)
      ? source['kind'] as UiDesignAssetKind : undefined;
    const assetSource = sanitizeAssetSource(source['source']);
    const width = validAssetDimension(source['width']) ? source['width'] : undefined;
    const height = validAssetDimension(source['height']) ? source['height'] : undefined;
    const crop = ASSET_CROPS.has(source['crop'] as UiDesignAssetCrop)
      ? source['crop'] as UiDesignAssetCrop : undefined;
    const rawFocalPoint = asRecord(source['focalPoint']);
    const focalX = validPercentage(rawFocalPoint['x']) ? rawFocalPoint['x'] : undefined;
    const focalY = validPercentage(rawFocalPoint['y']) ? rawFocalPoint['y'] : undefined;
    const decorative = source['decorative'] === true;
    const altText = cleanComponentText(source['altText'], 500, true);
    const maturity = CONTENT_MATURITIES.has(source['maturity'] as UiContentMaturity)
      ? source['maturity'] as UiContentMaturity : undefined;
    if (!id || !label || !kind || !assetSource || width === undefined || height === undefined
        || !crop || focalX === undefined || focalY === undefined || altText === undefined
        || !maturity || ids.has(id)) {
      continue;
    }
    assets.push({
      id, label, kind, source: assetSource, width, height, crop,
      focalPoint: { x: focalX, y: focalY },
      altText: decorative ? '' : altText,
      decorative,
      maturity,
    });
    ids.add(id);
  }
  return assets;
}

function sanitizeAssetSource(input: unknown): UiDesignAsset['source'] | undefined {
  const source = asRecord(input);
  if ((source['kind'] !== 'workspace' && source['kind'] !== 'https')
      || typeof source['reference'] !== 'string') {
    return undefined;
  }
  const reference = source['reference'].trim().replace(/\\/g, '/');
  if (reference.length === 0 || reference.length > MAX_ASSET_REFERENCE_LENGTH
      || /[\u0000-\u001f\u007f]/.test(reference)) {
    return undefined;
  }
  if (source['kind'] === 'workspace') {
    const segments = reference.split('/');
    return reference.startsWith('/') || reference.startsWith('//') || /^[a-zA-Z]:/.test(reference)
      || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..' || segment.includes(':'))
      ? undefined
      : { kind: 'workspace', reference };
  }
  try {
    const parsed = new URL(reference);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
      && parsed.search === '' && parsed.hash === '' && parsed.href === reference
      ? { kind: 'https', reference }
      : undefined;
  } catch {
    return undefined;
  }
}

function validAssetDimension(input: unknown): input is number {
  return Number.isSafeInteger(input) && (input as number) >= 1 && (input as number) <= MAX_ASSET_DIMENSION;
}

function validPercentage(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= 100;
}

/** Sanitize one binding structurally while retaining stale references for owning-node diagnostics. */
export function sanitizeUiNodeDataBinding(input: unknown): UiNodeDataBinding | undefined {
  const source = asRecord(input);
  const collectionId = cleanIdentifier(source['collectionId']);
  const sampleRecordId = cleanIdentifier(source['sampleRecordId']);
  const rawMappings = asRecord(source['fieldMappings']);
  const fieldMappings: UiNodeDataBinding['fieldMappings'] = {};
  for (const [slot, value] of Object.entries(rawMappings)) {
    if (!NODE_CONTENT_SLOTS.has(slot)) { continue; }
    const fieldId = cleanIdentifier(value);
    if (fieldId) { fieldMappings[slot as keyof UiNodeDataBinding['fieldMappings']] = fieldId; }
  }
  return collectionId && sampleRecordId && Object.keys(fieldMappings).length > 0
    ? { collectionId, sampleRecordId, fieldMappings }
    : undefined;
}

/** Sanitize preview-only structured collections at persisted and exact-command boundaries. */
export function sanitizeUiContentCollections(input: unknown): UiContentCollection[] {
  const rawCollections = Array.isArray(input)
    ? input.slice(0, UI_DESIGN_GRAPH_MAX_CONTENT_COLLECTIONS)
    : [];
  const collections: UiContentCollection[] = [];
  const collectionIds = new Set<string>();
  for (const candidate of rawCollections) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanComponentText(source['label'], 120);
    const description = cleanComponentText(source['description'], 500, true);
    if (!id || !label || description === undefined || collectionIds.has(id)) { continue; }
    const fields = sanitizeContentFields(source['fields']);
    const samples = sanitizeContentSamples(source['samples'], fields);
    collections.push({ id, label, description, fields, samples });
    collectionIds.add(id);
  }
  return collections;
}

function sanitizeContentFields(input: unknown): UiContentCollection['fields'] {
  const raw = Array.isArray(input) ? input.slice(0, UI_CONTENT_COLLECTION_MAX_FIELDS) : [];
  const fields: UiContentCollection['fields'] = [];
  const ids = new Set<string>();
  for (const candidate of raw) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanComponentText(source['label'], 120);
    const kind = CONTENT_FIELD_KINDS.has(source['kind'] as UiContentFieldKind)
      ? source['kind'] as UiContentFieldKind
      : undefined;
    if (!id || !label || !kind || ids.has(id)) { continue; }
    fields.push({ id, label, kind, required: source['required'] === true });
    ids.add(id);
  }
  return fields;
}

function sanitizeContentSamples(
  input: unknown,
  fields: readonly UiContentCollection['fields'][number][],
): UiContentCollection['samples'] {
  const raw = Array.isArray(input) ? input.slice(0, UI_CONTENT_COLLECTION_MAX_SAMPLES) : [];
  const samples: UiContentCollection['samples'] = [];
  const ids = new Set<string>();
  const fieldById = new Map(fields.map(field => [field.id, field]));
  for (const candidate of raw) {
    const source = asRecord(candidate);
    const id = cleanIdentifier(source['id']);
    const label = cleanComponentText(source['label'], 120);
    if (!id || !label || ids.has(id)) { continue; }
    const values: Record<string, UiContentSampleValue> = {};
    for (const [fieldId, value] of Object.entries(asRecord(source['values']))) {
      const field = fieldById.get(fieldId);
      const sanitized = field ? sanitizeContentSampleValue(field.kind, value) : undefined;
      if (sanitized !== undefined) { values[fieldId] = sanitized; }
    }
    samples.push({ id, label, values });
    ids.add(id);
  }
  return samples;
}

function sanitizeContentSampleValue(kind: UiContentFieldKind, input: unknown): UiContentSampleValue | undefined {
  if (kind === 'boolean') { return typeof input === 'boolean' ? input : undefined; }
  if (kind === 'number') {
    return typeof input === 'number' && Number.isFinite(input) && input >= -1_000_000_000 && input <= 1_000_000_000
      ? input : undefined;
  }
  if (typeof input !== 'string') { return undefined; }
  const cleaned = input.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 2_000);
  if (kind === 'url') { return /^https:\/\/[^\s]{1,1992}$/i.test(cleaned) ? cleaned : undefined; }
  if (kind === 'date') { return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : undefined; }
  return cleaned;
}

function cleanStateCopy(input: unknown, maximum: number): string | undefined {
  return typeof input === 'string'
    ? input.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, maximum)
    : undefined;
}

function optionalComponentSlot(value: unknown): Partial<Pick<UiDesignNode, 'componentSlot'>> {
  const cleaned = cleanIdentifier(value, MAX_REFERENCE_LENGTH);
  return cleaned ? { componentSlot: cleaned } : {};
}

function sanitizeComponentSlotsOnNodes(
  nodes: UiDesignNode[],
  definitions: readonly UiComponentDefinition[],
): void {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const used = new Map<string, number>();
  for (const node of nodes) {
    if (!node.componentSlot || !node.parentId) { delete node.componentSlot; continue; }
    const parent = byId.get(node.parentId);
    const definition = parent?.componentInstance
      ? definitions.find(candidate => candidate.id === parent.componentInstance?.definitionId)
      : undefined;
    const slot = definition?.slots.find(candidate => candidate.id === node.componentSlot);
    const key = `${parent?.id ?? ''}:${node.componentSlot}`;
    const count = used.get(key) ?? 0;
    if (!slot || (slot.allowedKinds.length > 0 && !slot.allowedKinds.includes(node.kind))
        || count >= slot.maxChildren) {
      delete node.componentSlot;
      continue;
    }
    used.set(key, count + 1);
  }
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
    const hasMode = LAYOUT_MODES.has(raw['mode'] as UiLayoutMode);
    const hasWidthMode = SIZE_MODES.has(raw['widthMode'] as UiSizeMode);
    const hasHeightMode = SIZE_MODES.has(raw['heightMode'] as UiSizeMode);
    const hasDirection = LAYOUT_DIRECTIONS.has(raw['direction'] as UiLayoutDirection);
    const hasGap = validBoundedLayoutNumber(raw['gap'], UI_LAYOUT_MAX_GAP);
    const hasPadding = validBoundedLayoutNumber(raw['padding'], UI_LAYOUT_MAX_PADDING);
    const hasColumns = validBoundedLayoutInteger(raw['columns'], 1, UI_LAYOUT_MAX_COLUMNS);
    const hasAlign = LAYOUT_ALIGNMENTS.has(raw['align'] as UiLayoutAlignment);
    const hasDistribute = LAYOUT_DISTRIBUTIONS.has(raw['distribute'] as UiLayoutDistribution);
    const constraintFields = sanitizeConstraintOverride(raw);
    const hasWrap = LAYOUT_WRAPS.has(raw['wrap'] as UiLayoutWrap);
    const hasOrder = validBoundedLayoutInteger(raw['order'], -UI_LAYOUT_MAX_ORDER, UI_LAYOUT_MAX_ORDER);
    if (!hasRect && !hasHidden && !hasMode && !hasWidthMode && !hasHeightMode && !hasDirection
        && !hasGap && !hasPadding && !hasColumns && !hasAlign && !hasDistribute
        && Object.keys(constraintFields).length === 0 && !hasWrap && !hasOrder) {
      continue;
    }
    overrides[breakpoint] = {
      ...(hasRect ? { rect: sanitizeRect(raw['rect'], wireframeKindSpec(kind)) } : {}),
      ...(hasHidden ? { hidden: raw['hidden'] as boolean } : {}),
      ...(hasMode ? { mode: raw['mode'] as UiLayoutMode } : {}),
      ...(hasWidthMode ? { widthMode: raw['widthMode'] as UiSizeMode } : {}),
      ...(hasHeightMode ? { heightMode: raw['heightMode'] as UiSizeMode } : {}),
      ...(hasDirection ? { direction: raw['direction'] as UiLayoutDirection } : {}),
      ...(hasGap ? { gap: raw['gap'] as number } : {}),
      ...(hasPadding ? { padding: raw['padding'] as number } : {}),
      ...(hasColumns ? { columns: raw['columns'] as number } : {}),
      ...(hasAlign ? { align: raw['align'] as UiLayoutAlignment } : {}),
      ...(hasDistribute ? { distribute: raw['distribute'] as UiLayoutDistribution } : {}),
      ...constraintFields,
      ...(hasWrap ? { wrap: raw['wrap'] as UiLayoutWrap } : {}),
      ...(hasOrder ? { order: raw['order'] as number } : {}),
    };
  }
  return overrides;
}

function optionalReference(
  key: 'contentRef' | 'styleRef' | 'componentRef' | 'assetRef',
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

function boundedLayoutNumber(value: unknown, fallback: number, maximum: number): number {
  return validBoundedLayoutNumber(value, maximum) ? value : fallback;
}

function boundedLayoutInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return validBoundedLayoutInteger(value, minimum, maximum) ? value : fallback;
}

function validBoundedLayoutNumber(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function validBoundedLayoutInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function sanitizeConstraintSet(source: Record<string, unknown>): Pick<UiDesignNode['layout'],
  'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'> {
  const minWidth = constraintValue(source['minWidth'], WIREFRAME_CANVAS_WIDTH);
  const maxWidth = constraintValue(source['maxWidth'], WIREFRAME_CANVAS_WIDTH);
  const minHeight = constraintValue(source['minHeight'], WIREFRAME_CANVAS_HEIGHT);
  const maxHeight = constraintValue(source['maxHeight'], WIREFRAME_CANVAS_HEIGHT);
  return {
    minWidth,
    maxWidth: minWidth !== null && maxWidth !== null && maxWidth < minWidth ? null : maxWidth,
    minHeight,
    maxHeight: minHeight !== null && maxHeight !== null && maxHeight < minHeight ? null : maxHeight,
  };
}

function sanitizeConstraintOverride(source: Record<string, unknown>): Partial<Pick<UiNodeViewportOverride,
  'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'>> {
  const result: Partial<Pick<UiNodeViewportOverride, 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'>> = {};
  for (const [property, maximum] of [
    ['minWidth', WIREFRAME_CANVAS_WIDTH],
    ['maxWidth', WIREFRAME_CANVAS_WIDTH],
    ['minHeight', WIREFRAME_CANVAS_HEIGHT],
    ['maxHeight', WIREFRAME_CANVAS_HEIGHT],
  ] as const) {
    const value = source[property];
    if (value === null || validConstraint(value, maximum)) {
      Object.assign(result, { [property]: value });
    }
  }
  if (typeof result.minWidth === 'number' && typeof result.maxWidth === 'number'
      && result.maxWidth < result.minWidth) {
    delete result.maxWidth;
  }
  if (typeof result.minHeight === 'number' && typeof result.maxHeight === 'number'
      && result.maxHeight < result.minHeight) {
    delete result.maxHeight;
  }
  return result;
}

function constraintValue(value: unknown, maximum: number): number | null {
  return validConstraint(value, maximum) ? value : null;
}

function validConstraint(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= maximum;
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
