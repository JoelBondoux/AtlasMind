/**
 * The wireframe canvas geometry model — what a drawn box means, and what it is
 * not allowed to be.
 *
 * Website Studio used to render a "wireframe" by taking the first eight strings
 * out of `WebsitePagePlan.sections` and emitting `<div class="block-N">` where
 * `N = (index % 3) + 1`. That is decoration: it carries no position, no size, no
 * nesting and no identity, so nothing downstream could act on it and no two
 * people looking at it were looking at the same thing.
 *
 * Three rules carry the design here.
 *
 * **A drawn box is a claim about structure, not about pixels.** Every rectangle
 * lives on a fixed 1000-unit column grid rather than in device pixels. Pixels
 * would put the author's monitor size into a git-tracked SSOT file, and the same
 * design would then read differently on a laptop and a 4K panel — the author
 * never claimed "980px wide", they claimed "most of the width".
 *
 * **The canvas is an untrusted boundary.** Geometry arrives from a webview,
 * where a bug in the drag handler or a hand-edited `website.json` can produce
 * `NaN`, an infinite width, a parent that does not exist, or a parent cycle. The
 * sanitizer is total: it never throws, and for any input it returns a wireframe
 * whose rectangles are finite and on-canvas and whose parent graph is a forest.
 *
 * **An element's kind is a closed set.** Generation reads the kind to decide
 * what markup a box becomes, so a free-text kind would hand the produced element
 * to whoever wrote the string. `custom` is the honest escape hatch: it says
 * "structure I have not named" and renders as a plain container.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type {
  WebsiteWireframe,
  WebsiteWireframeElement,
  WireframeBreakpoint,
  WireframeElementKind,
  WireframeRect,
} from '../types.js';

/** Canvas width in grid units. The column grid divides this exactly. */
export const WIREFRAME_CANVAS_WIDTH = 1000;

/**
 * Canvas height in the same units. Generous rather than tight — a long landing
 * page is an ordinary thing to draw, and a canvas that runs out mid-page would
 * push people back to the notes field this module exists to replace.
 */
export const WIREFRAME_CANVAS_HEIGHT = 4_000;

/** The snap grid the canvas offers. 12 columns is the convention every CSS framework already speaks. */
export const WIREFRAME_COLUMNS = 12;

/** Smallest box that can still be selected and labelled on screen. */
export const WIREFRAME_MIN_WIDTH = WIREFRAME_CANVAS_WIDTH / WIREFRAME_COLUMNS;
export const WIREFRAME_MIN_HEIGHT = 24;

/**
 * Caps. A wireframe past these stopped being a wireframe and became a drawing;
 * more practically, every element is rendered as a focusable DOM node and read
 * into a generation prompt, and both have a budget.
 */
export const MAX_WIREFRAME_ELEMENTS = 60;
export const MAX_WIREFRAME_DEPTH = 3;

const MAX_LABEL_LENGTH = 120;
const MAX_ELEMENT_PROMPT_LENGTH = 1_000;
const MAX_ELEMENT_NOTES_LENGTH = 1_000;

export const WIREFRAME_BREAKPOINTS: readonly WireframeBreakpoint[] = ['desktop', 'tablet', 'mobile'];

const BREAKPOINTS = new Set<WireframeBreakpoint>(WIREFRAME_BREAKPOINTS);

/**
 * The palette, and what each kind means to generation.
 *
 * `linkSource` marks the two kinds whose labels are read as navigation by
 * `websiteLinkGraph`. It is a property of the kind rather than a guess made at
 * read time, so "which boxes are links?" has one answer both modules share.
 *
 * `container` marks the kinds that may hold children. A card inside a grid is
 * ordinary; a card inside a text block is a mis-drag, and refusing it at the
 * model level is cheaper than explaining it afterwards.
 */
export interface WireframeKindSpec {
  kind: WireframeElementKind;
  label: string;
  description: string;
  /** Default size in canvas units when the kind is placed rather than drawn. */
  defaultWidth: number;
  defaultHeight: number;
  container: boolean;
  linkSource: boolean;
}

export const WIREFRAME_KIND_CATALOG: readonly WireframeKindSpec[] = [
  { kind: 'nav', label: 'Nav bar', description: 'Primary navigation. Its items are read as links to other pages.', defaultWidth: WIREFRAME_CANVAS_WIDTH, defaultHeight: 72, container: true, linkSource: true },
  { kind: 'hero', label: 'Hero banner', description: 'The opening statement: headline, supporting line, and usually one action.', defaultWidth: WIREFRAME_CANVAS_WIDTH, defaultHeight: 420, container: true, linkSource: false },
  { kind: 'section', label: 'Section', description: 'A band of related content running the width of the page.', defaultWidth: WIREFRAME_CANVAS_WIDTH, defaultHeight: 320, container: true, linkSource: false },
  { kind: 'grid', label: 'Grid', description: 'A repeating row or matrix of equal children.', defaultWidth: WIREFRAME_CANVAS_WIDTH, defaultHeight: 300, container: true, linkSource: false },
  { kind: 'card', label: 'Card', description: 'One unit inside a grid — a service, a feature, an article.', defaultWidth: WIREFRAME_CANVAS_WIDTH / 3, defaultHeight: 240, container: true, linkSource: false },
  { kind: 'media', label: 'Image / video', description: 'A picture, illustration, or embedded video.', defaultWidth: WIREFRAME_CANVAS_WIDTH / 2, defaultHeight: 280, container: false, linkSource: false },
  { kind: 'text', label: 'Text block', description: 'Prose: a heading with copy beneath it.', defaultWidth: WIREFRAME_CANVAS_WIDTH / 2, defaultHeight: 180, container: false, linkSource: false },
  { kind: 'form', label: 'Form', description: 'Fields the visitor fills in, and the button that submits them.', defaultWidth: WIREFRAME_CANVAS_WIDTH / 2, defaultHeight: 320, container: true, linkSource: false },
  { kind: 'cta', label: 'Call to action', description: 'The action this part of the page is asking for. Its label is read as a link.', defaultWidth: WIREFRAME_CANVAS_WIDTH / 3, defaultHeight: 96, container: false, linkSource: true },
  { kind: 'sidebar', label: 'Sidebar', description: 'Secondary column beside the main content.', defaultWidth: WIREFRAME_CANVAS_WIDTH / 4, defaultHeight: 600, container: true, linkSource: false },
  { kind: 'footer', label: 'Footer', description: 'Closing band: secondary navigation, legal, contact.', defaultWidth: WIREFRAME_CANVAS_WIDTH, defaultHeight: 240, container: true, linkSource: true },
  { kind: 'custom', label: 'Custom block', description: 'Structure that has not been named yet. Generated as a plain container.', defaultWidth: WIREFRAME_CANVAS_WIDTH / 2, defaultHeight: 200, container: true, linkSource: false },
];

const KIND_SPECS = new Map<WireframeElementKind, WireframeKindSpec>(
  WIREFRAME_KIND_CATALOG.map(spec => [spec.kind, spec]),
);

const KINDS = new Set<WireframeElementKind>(WIREFRAME_KIND_CATALOG.map(spec => spec.kind));

export function isWireframeElementKind(value: unknown): value is WireframeElementKind {
  return typeof value === 'string' && KINDS.has(value as WireframeElementKind);
}

export function wireframeKindSpec(kind: WireframeElementKind): WireframeKindSpec {
  // Every kind in the union is in the catalog; the fallback exists so a future
  // kind added to the type but forgotten here degrades to a plain container
  // rather than crashing the canvas.
  return KIND_SPECS.get(kind) ?? KIND_SPECS.get('custom')!;
}

/** Kinds whose labels `websiteLinkGraph` reads as navigation. */
export function isLinkSourceKind(kind: WireframeElementKind): boolean {
  return wireframeKindSpec(kind).linkSource;
}

// ── Sanitizing ───────────────────────────────────────────────────

/**
 * Bring any input into a wireframe that is safe to render, store, and prompt
 * from. Total by contract: never throws, and always returns a usable value.
 *
 * The order matters. Elements are read and clamped first, then the parent graph
 * is resolved against the ids that actually survived — resolving parents first
 * would let an element keep a parent that was subsequently dropped for being
 * over the cap, which is exactly the dangling reference this is here to prevent.
 */
export function sanitizeWireframe(input: unknown): WebsiteWireframe | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const rawElements = Array.isArray(record['elements']) ? record['elements'] : [];

  const seenIds = new Set<string>();
  const elements: WebsiteWireframeElement[] = [];
  for (const raw of rawElements) {
    if (elements.length >= MAX_WIREFRAME_ELEMENTS) {
      break;
    }
    const element = sanitizeElement(raw, seenIds);
    if (element) {
      seenIds.add(element.id);
      elements.push(element);
    }
  }

  const resolved = resolveParents(elements);

  return {
    breakpoint: BREAKPOINTS.has(record['breakpoint'] as WireframeBreakpoint)
      ? (record['breakpoint'] as WireframeBreakpoint)
      : 'desktop',
    elements: resolved,
  };
}

function sanitizeElement(input: unknown, seenIds: ReadonlySet<string>): WebsiteWireframeElement | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;

  const id = cleanIdentifier(record['id']);
  // An element with no usable id is dropped rather than assigned one. A
  // generated id would look like a real element to every later reader while
  // pointing at nothing the author drew, and selection state would attach to it.
  if (!id || seenIds.has(id)) {
    return undefined;
  }

  const kind = isWireframeElementKind(record['kind']) ? record['kind'] : 'custom';
  const spec = wireframeKindSpec(kind);
  const rect = sanitizeRect(record['rect'], spec);

  const parentId = cleanIdentifier(record['parentId']);

  return {
    id,
    kind,
    label: clampText(record['label'], MAX_LABEL_LENGTH) || spec.label,
    rect,
    ...(parentId && parentId !== id ? { parentId } : {}),
    designPrompt: clampText(record['designPrompt'], MAX_ELEMENT_PROMPT_LENGTH),
    notes: clampText(record['notes'], MAX_ELEMENT_NOTES_LENGTH),
  };
}

/**
 * Clamp a rectangle onto the canvas.
 *
 * A non-finite or missing value falls back to the kind's default rather than to
 * zero. Zero would produce an element that exists in the data and cannot be seen
 * or clicked on the canvas — present in every prompt, invisible to the person
 * trying to fix it.
 */
export function sanitizeRect(input: unknown, spec: WireframeKindSpec): WireframeRect {
  const record = (typeof input === 'object' && input !== null && !Array.isArray(input))
    ? input as Record<string, unknown>
    : {};

  const width = clampNumber(record['width'], WIREFRAME_MIN_WIDTH, WIREFRAME_CANVAS_WIDTH, spec.defaultWidth);
  const height = clampNumber(record['height'], WIREFRAME_MIN_HEIGHT, WIREFRAME_CANVAS_HEIGHT, spec.defaultHeight);
  const x = clampNumber(record['x'], 0, WIREFRAME_CANVAS_WIDTH - width, 0);
  const y = clampNumber(record['y'], 0, WIREFRAME_CANVAS_HEIGHT - height, 0);

  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}

/**
 * Resolve `parentId` into a forest.
 *
 * Three things are refused, each by dropping the parent rather than the element:
 * a parent that is not present, a parent whose kind cannot contain children, and
 * a chain that cycles or runs deeper than `MAX_WIREFRAME_DEPTH`. Dropping the
 * element instead would delete work somebody did because of a bad drag; dropping
 * the parent promotes it to the top level, where it is visible and can be
 * re-nested.
 */
function resolveParents(elements: readonly WebsiteWireframeElement[]): WebsiteWireframeElement[] {
  const byId = new Map(elements.map(element => [element.id, element]));

  return elements.map(element => {
    if (!element.parentId) {
      return element;
    }
    const parent = byId.get(element.parentId);
    if (!parent || !wireframeKindSpec(parent.kind).container) {
      return stripParent(element);
    }

    // Walk up. `seen` catches a cycle; `depth` catches a chain that is merely
    // too long. Both end the same way, and both are reached in bounded time
    // because the walk stops the first time it revisits an id.
    const seen = new Set<string>([element.id]);
    let depth = 0;
    let cursor: WebsiteWireframeElement | undefined = parent;
    while (cursor) {
      if (seen.has(cursor.id)) {
        return stripParent(element);
      }
      seen.add(cursor.id);
      depth += 1;
      if (depth >= MAX_WIREFRAME_DEPTH) {
        return stripParent(element);
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return element;
  });
}

function stripParent(element: WebsiteWireframeElement): WebsiteWireframeElement {
  const { parentId: _dropped, ...rest } = element;
  return rest;
}

// ── Reading ──────────────────────────────────────────────────────

/**
 * Paint and hit order: parents before their children, then top to bottom, then
 * left to right, then by id.
 *
 * The final tie-break on id is the point. Two boxes drawn at the same spot must
 * come back in the same order on every render, or the canvas reshuffles between
 * saves and selection lands on a different element than the one clicked.
 */
export function orderedWireframeElements(wireframe: WebsiteWireframe): WebsiteWireframeElement[] {
  const byId = new Map(wireframe.elements.map(element => [element.id, element]));
  const childrenOf = new Map<string, WebsiteWireframeElement[]>();
  const roots: WebsiteWireframeElement[] = [];

  for (const element of wireframe.elements) {
    if (element.parentId && byId.has(element.parentId)) {
      const siblings = childrenOf.get(element.parentId) ?? [];
      siblings.push(element);
      childrenOf.set(element.parentId, siblings);
    } else {
      roots.push(element);
    }
  }

  const ordered: WebsiteWireframeElement[] = [];
  const visit = (level: WebsiteWireframeElement[]): void => {
    for (const element of [...level].sort(compareByPosition)) {
      ordered.push(element);
      const children = childrenOf.get(element.id);
      if (children) {
        visit(children);
      }
    }
  };
  visit(roots);
  return ordered;
}

function compareByPosition(a: WebsiteWireframeElement, b: WebsiteWireframeElement): number {
  if (a.rect.y !== b.rect.y) {
    return a.rect.y - b.rect.y;
  }
  if (a.rect.x !== b.rect.x) {
    return a.rect.x - b.rect.x;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The chain from an element up to its outermost ancestor, nearest parent first. */
export function wireframeAncestry(
  wireframe: WebsiteWireframe,
  elementId: string,
): WebsiteWireframeElement[] {
  const byId = new Map(wireframe.elements.map(element => [element.id, element]));
  const chain: WebsiteWireframeElement[] = [];
  const seen = new Set<string>([elementId]);
  let cursor = byId.get(elementId)?.parentId;
  while (cursor && !seen.has(cursor)) {
    const parent = byId.get(cursor);
    if (!parent) {
      break;
    }
    chain.push(parent);
    seen.add(parent.id);
    cursor = parent.parentId;
  }
  return chain;
}

/**
 * Regenerate the flat `sections` list from the canvas.
 *
 * `WebsitePagePlan.sections` predates the canvas and is still read by the
 * markdown mirror, the brief, and anything written against version 1. Deriving
 * it from the top-level element labels keeps one source of truth — the drawing —
 * instead of two lists that disagree the moment somebody moves a box.
 */
export function deriveSectionLabels(wireframe: WebsiteWireframe): string[] {
  return orderedWireframeElements(wireframe)
    .filter(element => !element.parentId)
    .map(element => element.label)
    .filter(label => label.length > 0);
}

/**
 * Build a wireframe from the old flat `sections` array — the version 1 → 2
 * migration path.
 *
 * Stacked full-width bands, in the order the strings were in. It is a
 * transcription rather than a design: nobody drew this, and the geometry claims
 * only what the list already said, which is the sequence. The alternative was to
 * leave migrated projects opening onto an empty canvas, where the work they had
 * already done would look lost.
 */
export function wireframeFromSections(sections: readonly string[]): WebsiteWireframe {
  const usable = sections
    .map(section => clampText(section, MAX_LABEL_LENGTH))
    .filter(section => section.length > 0)
    .slice(0, MAX_WIREFRAME_ELEMENTS);

  let cursorY = 0;
  const elements: WebsiteWireframeElement[] = usable.map((label, index) => {
    const kind = inferKindFromLabel(label, index, usable.length);
    const spec = wireframeKindSpec(kind);
    const height = Math.min(spec.defaultHeight, WIREFRAME_CANVAS_HEIGHT - cursorY);
    const element: WebsiteWireframeElement = {
      id: `wf-${index + 1}`,
      kind,
      label,
      rect: { x: 0, y: round(cursorY), width: WIREFRAME_CANVAS_WIDTH, height: round(Math.max(height, WIREFRAME_MIN_HEIGHT)) },
      designPrompt: '',
      notes: '',
    };
    cursorY = Math.min(cursorY + element.rect.height, WIREFRAME_CANVAS_HEIGHT - WIREFRAME_MIN_HEIGHT);
    return element;
  });

  return { breakpoint: 'desktop', elements };
}

/**
 * Guess a kind from a section label, for migration only.
 *
 * Deliberately a short, boring table over exact-ish word matches rather than
 * anything clever. A wrong guess here is cheap — the author sees a box of the
 * wrong colour and changes it — but a *confident* wrong guess spread across a
 * large vocabulary would silently retype dozens of elements, and generation
 * reads the kind. Anything unmatched stays `section`, which claims nothing.
 */
function inferKindFromLabel(label: string, index: number, total: number): WireframeElementKind {
  const text = label.toLowerCase();
  if (/\b(nav|navigation|menu|header)\b/.test(text)) {
    return 'nav';
  }
  if (/\b(hero|banner|masthead)\b/.test(text)) {
    return index === 0 ? 'hero' : 'section';
  }
  if (/\b(footer)\b/.test(text)) {
    return 'footer';
  }
  if (/\b(form|enquiry|inquiry|contact form|signup|sign-up)\b/.test(text)) {
    return 'form';
  }
  if (/\b(call to action|cta)\b/.test(text)) {
    return 'cta';
  }
  if (/\b(gallery|image|photo|video|media)\b/.test(text)) {
    return 'media';
  }
  if (/\b(grid|cards|tiles)\b/.test(text)) {
    return 'grid';
  }
  // A first band with no other signal is almost always the hero; a last one is
  // almost always the footer. Both are safe defaults on a page-shaped list.
  if (index === 0) {
    return 'hero';
  }
  if (index === total - 1 && total > 2) {
    return 'footer';
  }
  return 'section';
}

/** An empty canvas for a page nobody has drawn yet. */
export function emptyWireframe(breakpoint: WireframeBreakpoint = 'desktop'): WebsiteWireframe {
  return { breakpoint, elements: [] };
}

// ── Shared helpers ───────────────────────────────────────────────

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  // `max` can fall below `min` when the fallback size exceeds the space left on
  // the canvas. Ordering the clamps this way keeps the result inside the canvas
  // and lets the size shrink, rather than returning a negative width.
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(candidate, min), max);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Ids reach the DOM as attribute values and reach generation as file-name
 * fragments, so the charset is constrained rather than escaped. An id that does
 * not fit is refused; coercing one would silently merge two elements whose ids
 * differed only in the removed characters.
 */
function cleanIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return undefined;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed) ? trimmed : undefined;
}

/** Strip control characters, collapse whitespace, and clamp. Applied to every free-text field. */
function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  // Control characters are stripped rather than escaped: these strings are
  // rendered into a webview and interpolated into prompts, matching the
  // boundary issueTracker.ts applies to third-party text.
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
