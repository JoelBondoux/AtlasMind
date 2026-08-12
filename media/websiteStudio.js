/**
 * Website Studio — webview behaviour, including the wireframe canvas.
 *
 * Loaded as an external file (inlined by the panel, matching projectDashboard.js)
 * rather than a template string in the panel's TypeScript. A drag-and-draw canvas
 * with hit testing, snapping, nesting and keyboard support is far past what a
 * string literal can hold readably.
 *
 * Three conventions carried from the rest of AtlasMind's webviews:
 *   - No inline event handlers anywhere. Everything is a delegated listener.
 *   - The webview sends *data*; it never names a command to run. The panel
 *     decides what a message means.
 *   - Geometry is in canvas units (a 1000-wide grid), never pixels. Pixels are a
 *     property of the reader's monitor and must not reach the saved file.
 */
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const value = (selector, root = document) => qs(selector, root)?.value?.trim() ?? '';
  const lines = input => input.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  const makeId = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

  // Must match websiteWireframe.ts. Duplicated rather than injected because
  // these are the canvas's own coordinate system and a mismatch would show up
  // immediately as boxes in the wrong place, not silently.
  const CANVAS_WIDTH = 1000;
  const CANVAS_MAX_HEIGHT = 4000;
  const COLUMNS = 12;
  const COLUMN_WIDTH = CANVAS_WIDTH / COLUMNS;
  const MIN_WIDTH = COLUMN_WIDTH;
  const MIN_HEIGHT = 24;
  const SNAP_TOLERANCE = 14;
  const MAX_ELEMENTS = 60;
  const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];

  // ── State ──────────────────────────────────────────────────────

  const stateNode = qs('#websiteStudioState');
  /** @type {{pages: Array, responsiveScreens: Array, kinds: Array, canGenerate: boolean, readOnly: boolean, atlasIcon: string}} */
  let state = { pages: [], responsiveScreens: [], kinds: [], canGenerate: false, readOnly: false, atlasIcon: '' };
  try {
    state = JSON.parse(stateNode?.dataset?.state ?? '{}');
  } catch {
    state = { pages: [], responsiveScreens: [], kinds: [], canGenerate: false, readOnly: false, atlasIcon: '' };
  }
  state.pages = Array.isArray(state.pages) ? state.pages : [];
  state.responsiveScreens = normalizeResponsiveScreens(state.responsiveScreens);
  state.kinds = Array.isArray(state.kinds) ? state.kinds : [];
  let designRevision = Number.isSafeInteger(state.designRevision) && state.designRevision >= 0
    ? state.designRevision
    : 0;
  let acknowledgedDesignRevision = designRevision;

  /** Page currently open on the canvas. */
  let activePageId = state.pages[0]?.id ?? '';
  /** Viewport currently projected on the canvas. */
  let activeBreakpoint = state.responsiveScreens.find(screen => screen?.pageId === activePageId)?.baseBreakpoint
    ?? state.pages[0]?.wireframe?.breakpoint
    ?? 'desktop';
  if (!BREAKPOINTS.includes(activeBreakpoint)) { activeBreakpoint = 'desktop'; }
  /** Selected wireframe element id, or '' for none. */
  let selectedElementId = '';
  /** Kind armed in the palette; a drag on empty canvas draws this. */
  let armedKind = 'section';

  const kindSpec = kind => state.kinds.find(spec => spec.kind === kind) ?? state.kinds[0] ?? {
    kind: 'custom', label: 'Block', defaultWidth: 500, defaultHeight: 200, container: true,
  };

  const activePage = () => state.pages.find(page => page.id === activePageId);
  const activeResponsiveScreen = () => state.responsiveScreens.find(screen => screen?.pageId === activePageId);
  const activeBaseBreakpoint = () => activeResponsiveScreen()?.baseBreakpoint
    ?? activePage()?.wireframe?.breakpoint
    ?? 'desktop';
  const responsiveNode = id => activeResponsiveScreen()?.nodes?.find(node => node?.id === id);

  function normalizeResponsiveScreens(input) {
    if (!Array.isArray(input) || input.length > 100) { return []; }
    return input.filter(screen => screen
      && /^[a-zA-Z0-9._-]{1,120}$/.test(screen.id)
      && /^[a-zA-Z0-9._-]{1,120}$/.test(screen.pageId)
      && BREAKPOINTS.includes(screen.baseBreakpoint)
      && Array.isArray(screen.nodes)
      && screen.nodes.length <= MAX_ELEMENTS
      && screen.nodes.every(node => node
        && /^[a-zA-Z0-9._-]{1,120}$/.test(node.id)
        && node.views && typeof node.views === 'object'
        && node.overrides && typeof node.overrides === 'object'));
  }

  function responsiveView(element) {
    const candidate = responsiveNode(element.id)?.views?.[activeBreakpoint];
    const rect = candidate?.layout?.rect;
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      return {
        layout: { rect: element.rect, hidden: false, mode: 'free', widthMode: 'fixed', heightMode: 'fixed' },
        provenance: {
          rect: { kind: 'base', breakpoint: activeBaseBreakpoint() },
          hidden: { kind: 'base', breakpoint: activeBaseBreakpoint() },
          mode: { kind: 'base', breakpoint: activeBaseBreakpoint() },
          widthMode: { kind: 'base', breakpoint: activeBaseBreakpoint() },
          heightMode: { kind: 'base', breakpoint: activeBaseBreakpoint() },
        },
      };
    }
    return candidate;
  }

  function notifyPreviewSelection() {
    if (!activePageId || !selectedElementId) { return; }
    vscode.postMessage({
      type: 'selectPreviewTarget',
      payload: { pageId: activePageId, nodeId: selectedElementId },
    });
  }

  function submitDesignEdit(command) {
    const expectedRevision = designRevision;
    designRevision += 1;
    vscode.postMessage({
      type: 'editDesignGraph',
      payload: { ...command, expectedRevision },
    });
    markDirty();
  }

  function elementsOf(page) {
    if (!page) { return []; }
    if (!page.wireframe) { page.wireframe = { breakpoint: 'desktop', elements: [] }; }
    if (!Array.isArray(page.wireframe.elements)) { page.wireframe.elements = []; }
    return page.wireframe.elements;
  }

  const findElement = id => elementsOf(activePage()).find(element => element.id === id);

  function notice(message, tone = '') {
    const element = qs('#studioNotice');
    if (!element) { return; }
    element.textContent = message;
    element.className = 'notice visible ' + tone;
  }

  function showPage(pageId) {
    qsa('.studio-page').forEach(page => page.classList.toggle('active', page.dataset.page === pageId));
    qsa('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.pageTarget === pageId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Canvas geometry ────────────────────────────────────────────

  /**
   * How tall the canvas is right now, in units.
   *
   * Grows to fit the content plus a band of empty space, so there is always
   * somewhere to draw the next element. Never shrinks below a screenful, or an
   * empty page would open as a sliver nobody can drag in.
   */
  function canvasHeight() {
    const elements = elementsOf(activePage());
    const lowest = elements.reduce((max, element) => {
      const rect = responsiveView(element).layout.rect;
      return Math.max(max, rect.y + rect.height);
    }, 0);
    return Math.min(CANVAS_MAX_HEIGHT, Math.max(1200, lowest + 320));
  }

  function canvasSurface() {
    return qs('#wireframeCanvas');
  }

  /** Pointer position → canvas units. */
  function toUnits(event, surface) {
    const bounds = surface.getBoundingClientRect();
    const height = canvasHeight();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * CANVAS_WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * height,
    };
  }

  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
  const round = n => Math.round(n * 100) / 100;

  /**
   * Snap an edge to the column grid or to a nearby sibling edge.
   *
   * Sibling edges are offered first: lining a box up with the one above it is
   * almost always the intent, and the column grid is the fallback that keeps
   * everything on a system. `null` means no snap was close enough — the caller
   * keeps the raw value rather than being dragged to the nearest column from
   * halfway across the canvas.
   */
  function snapX(candidate, excludeId) {
    const edges = [];
    for (const element of elementsOf(activePage())) {
      if (element.id === excludeId) { continue; }
      const rect = responsiveView(element).layout.rect;
      edges.push(rect.x, rect.x + rect.width);
    }
    for (let column = 0; column <= COLUMNS; column += 1) {
      edges.push(column * COLUMN_WIDTH);
    }
    let best = null;
    let bestDistance = SNAP_TOLERANCE;
    for (const edge of edges) {
      const distance = Math.abs(edge - candidate);
      if (distance < bestDistance) {
        best = edge;
        bestDistance = distance;
      }
    }
    return best;
  }

  function snapY(candidate, excludeId) {
    let best = null;
    let bestDistance = SNAP_TOLERANCE;
    for (const element of elementsOf(activePage())) {
      if (element.id === excludeId) { continue; }
      const rect = responsiveView(element).layout.rect;
      for (const edge of [rect.y, rect.y + rect.height]) {
        const distance = Math.abs(edge - candidate);
        if (distance < bestDistance) {
          best = edge;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  /**
   * The container a rectangle was dropped into: the deepest container element
   * that fully encloses it.
   *
   * "Fully encloses" rather than "overlaps" on purpose. Overlap-based nesting
   * re-parents a box the moment its corner clips a neighbour, which makes
   * dragging across a busy canvas feel possessed.
   */
  function containerAt(rect, excludeId) {
    let best = null;
    let bestArea = Infinity;
    for (const element of elementsOf(activePage())) {
      if (element.id === excludeId) { continue; }
      if (!kindSpec(element.kind).container) { continue; }
      if (isDescendantOf(element.id, excludeId)) { continue; }
      const box = responsiveView(element).layout.rect;
      const encloses = rect.x >= box.x - 1
        && rect.y >= box.y - 1
        && rect.x + rect.width <= box.x + box.width + 1
        && rect.y + rect.height <= box.y + box.height + 1;
      if (!encloses) { continue; }
      const area = box.width * box.height;
      if (area < bestArea) {
        best = element;
        bestArea = area;
      }
    }
    return best;
  }

  /** Guard against dropping a parent inside its own child. */
  function isDescendantOf(candidateId, ancestorId) {
    if (!ancestorId) { return false; }
    const seen = new Set();
    let cursor = candidateId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (cursor === ancestorId) { return true; }
      cursor = findElement(cursor)?.parentId;
    }
    return false;
  }

  function depthOf(elementId) {
    let depth = 0;
    const seen = new Set();
    let cursor = findElement(elementId)?.parentId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      depth += 1;
      cursor = findElement(cursor)?.parentId;
    }
    return depth;
  }

  // ── Rendering the canvas ───────────────────────────────────────

  function renderCanvas() {
    const surface = canvasSurface();
    if (!surface) { return; }
    const page = activePage();
    const height = canvasHeight();
    surface.style.aspectRatio = CANVAS_WIDTH + ' / ' + height;

    const elements = elementsOf(page);
    // Parents first so children paint on top without needing z-index bookkeeping.
    const ordered = [...elements].sort((a, b) => {
      const left = responsiveView(a).layout.rect;
      const right = responsiveView(b).layout.rect;
      return depthOf(a.id) - depthOf(b.id)
        || left.y - right.y
        || left.x - right.x
        || (a.id < b.id ? -1 : 1);
    });

    surface.innerHTML = ordered.map(element => {
      const spec = kindSpec(element.kind);
      const view = responsiveView(element);
      const { x, y, width, height: h } = view.layout.rect;
      const style = 'left:' + (x / CANVAS_WIDTH * 100) + '%;'
        + 'top:' + (y / height * 100) + '%;'
        + 'width:' + (width / CANVAS_WIDTH * 100) + '%;'
        + 'height:' + (h / height * 100) + '%;';
      const selected = element.id === selectedElementId;
      // Every box is a real button: the canvas has to be reachable by keyboard,
      // and a div with a click handler is not.
      //
      // The kind rides on `data-kind` rather than being concatenated into the
      // class attribute. Styling on `[data-kind="hero"]` reads the same, and a
      // class built by string concatenation is invisible to any tool that reads
      // this file for the classes it uses — including the guard that checks every
      // classed button has a background of its own.
      return '<button type="button" class="wf-box' + (selected ? ' selected' : '')
        + (view.layout.hidden ? ' viewport-hidden' : '') + '"'
        + ' data-kind="' + escapeAttribute(element.kind) + '"'
        + ' style="' + style + '" data-element-id="' + escapeAttribute(element.id) + '"'
        + ' aria-pressed="' + (selected ? 'true' : 'false') + '"'
        + ' aria-label="' + escapeAttribute(describeForScreenReader(element, spec)) + '">'
        + '<span class="wf-box-label">' + escapeText(element.label || spec.label) + '</span>'
        + '<span class="wf-box-kind">' + escapeText(spec.label) + '</span>'
        + (view.layout.hidden ? '<span class="wf-box-visibility">Hidden at ' + escapeText(activeBreakpoint) + '</span>' : '')
        + (selected ? handlesMarkup() : '')
        + '</button>';
    }).join('');

    renderInspector();
    renderCanvasSummary();
  }

  /**
   * The accessible name.
   *
   * Position is spoken as a fraction rather than a coordinate — "full width,
   * near the top" is what somebody needs to picture the page, and "x 0 y 40" is
   * not.
   */
  function describeForScreenReader(element, spec) {
    const view = responsiveView(element);
    const rect = view.layout.rect;
    const fraction = rect.width / CANVAS_WIDTH;
    const span = fraction >= 0.98 ? 'full width'
      : fraction >= 0.72 ? 'most of the width'
        : fraction >= 0.45 ? 'about half the width'
          : fraction >= 0.28 ? 'about a third of the width'
            : 'a narrow column';
    const height = canvasHeight();
    const vertical = rect.y / height < 0.2 ? 'near the top'
      : rect.y / height > 0.7 ? 'near the bottom'
        : 'in the middle';
    const parent = element.parentId ? findElement(element.parentId) : undefined;
    return (element.label || spec.label) + ', ' + spec.label + ', ' + span + ', ' + vertical
      + (view.layout.hidden ? ', hidden at ' + activeBreakpoint : '')
      + (parent ? ', inside ' + (parent.label || kindSpec(parent.kind).label) : '');
  }

  function handlesMarkup() {
    return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
      .map(position => '<span class="wf-handle wf-handle-' + position + '" data-handle="' + position + '"></span>')
      .join('');
  }

  function renderCanvasSummary() {
    const summary = qs('#canvasSummary');
    if (!summary) { return; }
    const count = elementsOf(activePage()).length;
    const viewport = activeBreakpoint[0].toUpperCase() + activeBreakpoint.slice(1);
    summary.textContent = count === 0
      ? 'Empty canvas — pick a block on the left, then drag on the grid to draw it.'
      : viewport + ': ' + count + ' element' + (count === 1 ? '' : 's') + '. '
        + (MAX_ELEMENTS - count) + ' remaining.';
    syncBreakpointControls();
  }

  function sourceLabel(source) {
    const breakpoint = BREAKPOINTS.includes(source?.breakpoint) ? source.breakpoint : activeBaseBreakpoint();
    return (source?.kind === 'override' ? 'Override · ' : 'Base · ') + breakpoint;
  }

  function syncBreakpointControls() {
    const base = activeBaseBreakpoint();
    qsa('.breakpoint-button').forEach(button => {
      const active = button.dataset.breakpoint === activeBreakpoint;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const context = qs('#breakpointContext');
    if (context) {
      context.textContent = activeBreakpoint === base
        ? 'Base layout · structural editing'
        : 'Responsive view · drag, resize, nudge, or use the inspector to create overrides';
    }
    qsa('.palette-button').forEach(button => {
      button.disabled = state.readOnly || activeBreakpoint !== base;
      button.title = activeBreakpoint === base
        ? (button.dataset.description || button.title)
        : 'Switch to the base breakpoint to add structure.';
    });
    canvasSurface()?.classList.toggle('responsive-view', activeBreakpoint !== base);
  }

  /** The panel beside the canvas: what is selected, and what can be said about it. */
  function renderInspector() {
    const inspector = qs('#wireframeInspector');
    if (!inspector) { return; }
    const element = findElement(selectedElementId);
    if (!element) {
      inspector.innerHTML = '<p class="inspector-empty">Select an element on the canvas to describe it, '
        + 'or use the page prompt below to describe the whole page.</p>';
      return;
    }
    const spec = kindSpec(element.kind);
    const parent = element.parentId ? findElement(element.parentId) : undefined;
    const view = responsiveView(element);
    const rect = view.layout.rect;
    const base = activeBaseBreakpoint();
    const isBase = activeBreakpoint === base;
    const override = responsiveNode(element.id)?.overrides?.[activeBreakpoint] ?? { rect: false, hidden: false };
    const readOnly = state.readOnly ? ' disabled' : '';
    const responsiveFields = isBase ? `
      <div class="responsive-inspector base">
        <p class="responsive-title">${escapeText(activeBreakpoint)} base layout</p>
        <p class="responsive-copy">Geometry and visibility originate here. Choose Tablet or Mobile to inspect inheritance and create a deliberate departure.</p>
      </div>` : `
      <div class="responsive-inspector">
        <div class="responsive-head"><p class="responsive-title">${escapeText(activeBreakpoint)} layout</p>
          <span class="source-chip">${escapeText(sourceLabel(view.provenance.rect))}</span></div>
        <p class="responsive-copy">Only layout and visibility are breakpoint-specific. Label, type, hierarchy, and design intent remain shared.</p>
        <div class="geometry-grid">
          <label><span>X</span><input id="responsiveX" type="number" step="1" value="${escapeAttribute(String(rect.x))}"${readOnly} /></label>
          <label><span>Y</span><input id="responsiveY" type="number" step="1" value="${escapeAttribute(String(rect.y))}"${readOnly} /></label>
          <label><span>W</span><input id="responsiveWidth" type="number" step="1" min="1" value="${escapeAttribute(String(rect.width))}"${readOnly} /></label>
          <label><span>H</span><input id="responsiveHeight" type="number" step="1" min="1" value="${escapeAttribute(String(rect.height))}"${readOnly} /></label>
        </div>
        <div class="responsive-actions">
          <button type="button" class="secondary" id="applyResponsiveRect"${readOnly}>Apply layout</button>
          <button type="button" class="secondary subtle" id="resetResponsiveRect"${override.rect && !state.readOnly ? '' : ' disabled'}>Use inherited layout</button>
        </div>
        <div class="responsive-visibility">
          <label><input id="responsiveHidden" type="checkbox"${view.layout.hidden ? ' checked' : ''}${readOnly} /> Hidden at ${escapeText(activeBreakpoint)}</label>
          <span class="source-chip">${escapeText(sourceLabel(view.provenance.hidden))}</span>
        </div>
        <div class="responsive-actions">
          <button type="button" class="secondary" id="applyResponsiveVisibility"${readOnly}>Apply visibility</button>
          <button type="button" class="secondary subtle" id="resetResponsiveVisibility"${override.hidden && !state.readOnly ? '' : ' disabled'}>Use inherited visibility</button>
        </div>
        <dl class="layout-provenance">
          <div><dt>Mode</dt><dd>${escapeText(view.layout.mode)} · ${escapeText(sourceLabel(view.provenance.mode))}</dd></div>
          <div><dt>Width</dt><dd>${escapeText(view.layout.widthMode)} · ${escapeText(sourceLabel(view.provenance.widthMode))}</dd></div>
          <div><dt>Height</dt><dd>${escapeText(view.layout.heightMode)} · ${escapeText(sourceLabel(view.provenance.heightMode))}</dd></div>
        </dl>
      </div>`;
    inspector.innerHTML = ''
      + '<div class="inspector-head"><p class="eyebrow">Selected</p><h3>' + escapeText(element.label || spec.label) + '</h3>'
      + '<p class="inspector-meta">' + escapeText(spec.label)
      + (parent ? ' inside ' + escapeText(parent.label || kindSpec(parent.kind).label) : ' at the top level')
      + '</p></div>'
      + '<label class="field"><span>Label</span><input id="inspectorLabel" value="' + escapeAttribute(element.label) + '" /></label>'
      + '<label class="field"><span>Type</span><select id="inspectorKind">'
      + state.kinds.map(candidate => '<option value="' + escapeAttribute(candidate.kind) + '"'
        + (candidate.kind === element.kind ? ' selected' : '') + '>' + escapeText(candidate.label) + '</option>').join('')
      + '</select></label>'
      + responsiveFields
      + '<label class="field"><span>Design prompt for this element</span>'
      + '<textarea id="inspectorPrompt" rows="3" placeholder="Full-bleed photo, headline left, one primary button.">'
      + escapeText(element.designPrompt || '') + '</textarea></label>'
      + '<div class="inspector-actions">'
      + '<button type="button" id="askAboutElement" class="atlas-discuss-action icon-only" title="Ask AtlasMind to review this wireframe element and its design prompt" aria-label="Ask AtlasMind about this wireframe element"><img src="' + escapeAttribute(state.atlasIcon || '') + '" alt="" aria-hidden="true" /><span class="atlas-discuss-label">Ask AtlasMind about this wireframe element</span></button>'
      + (state.canGenerate ? '<button type="button" class="secondary" id="generateElement">Generate</button>' : '')
      + (isBase ? '<button type="button" class="danger subtle" id="deleteElement">Delete</button>' : '')
      + '</div>'
      + '<p class="inspector-hint">' + (isBase
        ? 'Arrow keys nudge. Hold Shift for larger steps. Delete removes. Ctrl/Cmd+Z undoes; add Shift to redo.'
        : 'Drag, resize, or use arrow keys to create a layout override. Structure stays shared. Reset either property to resume inheritance.')
      + '</p>';
  }

  // ── Drawing, moving, resizing ──────────────────────────────────

  /** @type {null | {mode: string, id: string, handle: string, start: object, origin: object, parentId?: string, responsive?: boolean}} */
  let drag = null;

  /**
   * Optimistically project a responsive rectangle while a gesture is active.
   *
   * The host remains authoritative: pointer-up submits the closed reducer
   * command and the next host message replaces this temporary projection.
   */
  function projectResponsiveRect(elementId, rect) {
    const node = responsiveNode(elementId);
    const view = node?.views?.[activeBreakpoint];
    if (!node || !view?.layout || activeBreakpoint === activeBaseBreakpoint()) { return; }
    view.layout.rect = { ...rect };
    view.provenance = {
      ...view.provenance,
      rect: { kind: 'override', breakpoint: activeBreakpoint },
    };
    node.overrides[activeBreakpoint] = {
      ...(node.overrides[activeBreakpoint] ?? { rect: false, hidden: false }),
      rect: true,
    };
  }

  function projectGestureRect(element, rect, responsive) {
    if (responsive) {
      projectResponsiveRect(element.id, rect);
    } else {
      element.rect = { ...rect };
    }
  }

  function beginCanvasPointer(event) {
    const surface = canvasSurface();
    if (!surface || state.readOnly) { return; }
    const point = toUnits(event, surface);

    const handle = event.target.closest('.wf-handle');
    const box = event.target.closest('.wf-box');

    const responsive = activeBreakpoint !== activeBaseBreakpoint();

    if (handle && box) {
      const element = findElement(box.dataset.elementId);
      if (!element) { return; }
      drag = {
        mode: 'resize',
        id: box.dataset.elementId,
        handle: handle.dataset.handle,
        origin: point,
        start: { ...responsiveView(element).layout.rect },
        parentId: element.parentId,
        responsive,
      };
    } else if (box) {
      selectedElementId = box.dataset.elementId;
      notifyPreviewSelection();
      const element = findElement(selectedElementId);
      if (!element) { return; }
      drag = {
        mode: 'move',
        id: selectedElementId,
        handle: '',
        origin: point,
        start: { ...responsiveView(element).layout.rect },
        parentId: element.parentId,
        responsive,
      };
      renderCanvas();
    } else {
      if (responsive) {
        notice('Responsive views override existing nodes. Switch to the base breakpoint to draw new structure.');
        event.preventDefault();
        return;
      }
      if (elementsOf(activePage()).length >= MAX_ELEMENTS) {
        notice('This page already has ' + MAX_ELEMENTS + ' elements, the maximum for one wireframe.', 'error');
        return;
      }
      drag = { mode: 'draw', id: '', handle: '', origin: point, start: null };
    }
    surface.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveCanvasPointer(event) {
    if (!drag) { return; }
    const surface = canvasSurface();
    if (!surface) { return; }
    const point = toUnits(event, surface);
    const height = canvasHeight();

    if (drag.mode === 'draw') {
      const rect = normalizeDrawn(drag.origin, point, height);
      paintGhost(rect, height);
      return;
    }

    const element = findElement(drag.id);
    if (!element) { return; }
    const dx = point.x - drag.origin.x;
    const dy = point.y - drag.origin.y;

    if (drag.mode === 'move') {
      let x = clamp(drag.start.x + dx, 0, CANVAS_WIDTH - drag.start.width);
      let y = clamp(drag.start.y + dy, 0, CANVAS_MAX_HEIGHT - drag.start.height);
      const snappedX = snapX(x, element.id);
      if (snappedX !== null) { x = clamp(snappedX, 0, CANVAS_WIDTH - drag.start.width); }
      const snappedY = snapY(y, element.id);
      if (snappedY !== null) { y = clamp(snappedY, 0, CANVAS_MAX_HEIGHT - drag.start.height); }
      projectGestureRect(element, {
        ...drag.start,
        x: round(x),
        y: round(y),
      }, drag.responsive === true);
    } else if (drag.mode === 'resize') {
      projectGestureRect(element, resizedRect(element, drag, dx, dy), drag.responsive === true);
    }
    renderCanvas();
  }

  function resizedRect(element, session, dx, dy) {
    const start = session.start;
    let { x, y, width, height } = start;

    if (session.handle.includes('w')) {
      const right = start.x + start.width;
      x = clamp(start.x + dx, 0, right - MIN_WIDTH);
      const snapped = snapX(x, element.id);
      if (snapped !== null && snapped <= right - MIN_WIDTH) { x = snapped; }
      width = right - x;
    }
    if (session.handle.includes('e')) {
      width = clamp(start.width + dx, MIN_WIDTH, CANVAS_WIDTH - start.x);
      const snapped = snapX(start.x + width, element.id);
      if (snapped !== null && snapped - start.x >= MIN_WIDTH) { width = snapped - start.x; }
    }
    if (session.handle.includes('n')) {
      const bottom = start.y + start.height;
      y = clamp(start.y + dy, 0, bottom - MIN_HEIGHT);
      const snapped = snapY(y, element.id);
      if (snapped !== null && snapped <= bottom - MIN_HEIGHT) { y = snapped; }
      height = bottom - y;
    }
    if (session.handle.includes('s')) {
      height = clamp(start.height + dy, MIN_HEIGHT, CANVAS_MAX_HEIGHT - start.y);
      const snapped = snapY(start.y + height, element.id);
      if (snapped !== null && snapped - start.y >= MIN_HEIGHT) { height = snapped - start.y; }
    }

    return { x: round(x), y: round(y), width: round(width), height: round(height) };
  }

  function normalizeDrawn(origin, point, height) {
    const x = clamp(Math.min(origin.x, point.x), 0, CANVAS_WIDTH);
    const y = clamp(Math.min(origin.y, point.y), 0, height);
    const width = clamp(Math.abs(point.x - origin.x), 0, CANVAS_WIDTH - x);
    const rectHeight = clamp(Math.abs(point.y - origin.y), 0, height - y);
    return { x: round(x), y: round(y), width: round(width), height: round(rectHeight) };
  }

  function paintGhost(rect, height) {
    let ghost = qs('#wireframeGhost');
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.id = 'wireframeGhost';
      ghost.className = 'wf-ghost';
      canvasSurface()?.appendChild(ghost);
    }
    ghost.style.left = (rect.x / CANVAS_WIDTH * 100) + '%';
    ghost.style.top = (rect.y / height * 100) + '%';
    ghost.style.width = (rect.width / CANVAS_WIDTH * 100) + '%';
    ghost.style.height = (rect.height / height * 100) + '%';
  }

  function endCanvasPointer(event) {
    if (!drag) { return; }
    const surface = canvasSurface();
    const session = drag;
    drag = null;
    qs('#wireframeGhost')?.remove();

    if (session.mode === 'draw' && surface) {
      const point = toUnits(event, surface);
      let rect = normalizeDrawn(session.origin, point, canvasHeight());
      const spec = kindSpec(armedKind);
      // A click rather than a drag places the kind at its natural size. Drawing
      // a 3-unit box and calling it the user's intent would be pedantic.
      if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) {
        rect = {
          x: clamp(session.origin.x, 0, CANVAS_WIDTH - spec.defaultWidth),
          y: clamp(session.origin.y, 0, CANVAS_MAX_HEIGHT - spec.defaultHeight),
          width: spec.defaultWidth,
          height: spec.defaultHeight,
        };
      }
      const created = {
        id: makeId('el'),
        kind: armedKind,
        label: spec.label,
        rect,
        designPrompt: '',
        notes: '',
      };
      const container = containerAt(rect, created.id);
      if (container && depthOf(container.id) < 2) { created.parentId = container.id; }
      elementsOf(activePage()).push(created);
      selectedElementId = created.id;
      submitDesignEdit({ type: 'add-node', screenId: activePageId, node: created });
      notifyPreviewSelection();
      renderCanvas();
      notice('Added a ' + spec.label.toLowerCase() + '. Describe it in the panel on the right, then Save.');
      return;
    }

    if (session.mode === 'move' && !session.responsive) {
      const element = findElement(session.id);
      if (element) {
        const container = containerAt(element.rect, element.id);
        const nextParent = container && depthOf(container.id) < 2 ? container.id : undefined;
        if (nextParent !== element.parentId) {
          if (nextParent) { element.parentId = nextParent; } else { delete element.parentId; }
          notice(nextParent
            ? 'Nested inside ' + (findElement(nextParent).label || 'the block around it') + '.'
            : 'Moved to the top level.');
        }
      }
    }
    const changed = findElement(session.id);
    const changedRect = changed ? responsiveView(changed).layout.rect : undefined;
    if (changed && session.responsive && JSON.stringify(changedRect) !== JSON.stringify(session.start)) {
      submitDesignEdit({
        type: 'set-node-viewport-override',
        screenId: activePageId,
        nodeId: changed.id,
        breakpoint: activeBreakpoint,
        rect: { ...changedRect },
      });
      notice('Created a ' + activeBreakpoint + ' layout override. Undo or reset it to resume inheritance.');
    } else if (changed && (JSON.stringify(changed.rect) !== JSON.stringify(session.start)
        || (changed.parentId ?? null) !== (session.parentId ?? null))) {
      submitDesignEdit({
        type: 'set-node-frame',
        screenId: activePageId,
        nodeId: changed.id,
        rect: { ...changed.rect },
        parentId: changed.parentId ?? null,
      });
    }
    renderCanvas();
  }

  /**
   * Delete, promoting the children rather than removing them too.
   *
   * Cascade delete is the obvious implementation and the wrong one: somebody
   * deleting a wrapper loses the six cards inside it with no warning and no
   * undo. Promoting them to the deleted element's parent keeps the work and is
   * announced, so the outcome is visible either way.
   */
  function deleteSelected() {
    if (activeBreakpoint !== activeBaseBreakpoint()) {
      notice('Switch to the base breakpoint before deleting structure. A node exists in every viewport.');
      return;
    }
    const element = findElement(selectedElementId);
    if (!element) { return; }
    const elements = elementsOf(activePage());
    const promoted = elements.filter(candidate => candidate.parentId === element.id);
    for (const child of promoted) {
      if (element.parentId) { child.parentId = element.parentId; } else { delete child.parentId; }
    }
    activePage().wireframe.elements = elements.filter(candidate => candidate.id !== element.id);
    submitDesignEdit({ type: 'delete-node', screenId: activePageId, nodeId: element.id });
    selectedElementId = '';
    renderCanvas();
    notice(promoted.length > 0
      ? 'Deleted. The ' + promoted.length + ' element' + (promoted.length === 1 ? '' : 's') + ' inside moved up a level rather than being deleted too.'
      : 'Element deleted. Save Website Studio to persist.');
  }

  function nudgeSelected(dx, dy) {
    const element = findElement(selectedElementId);
    if (!element) { return; }
    const responsive = activeBreakpoint !== activeBaseBreakpoint();
    const current = responsiveView(element).layout.rect;
    const rect = {
      ...current,
      x: round(clamp(current.x + dx, 0, CANVAS_WIDTH - current.width)),
      y: round(clamp(current.y + dy, 0, CANVAS_MAX_HEIGHT - current.height)),
    };
    projectGestureRect(element, rect, responsive);
    submitDesignEdit(responsive
      ? {
        type: 'set-node-viewport-override', screenId: activePageId, nodeId: element.id,
        breakpoint: activeBreakpoint, rect,
      }
      : {
        type: 'set-node-frame', screenId: activePageId, nodeId: element.id,
        rect, parentId: element.parentId ?? null,
      });
    renderCanvas();
  }

  let dirty = false;
  function markDirty() {
    dirty = true;
    const badge = qs('#unsavedBadge');
    if (badge) { badge.hidden = false; }
  }

  // ── Wiring ─────────────────────────────────────────────────────

  function wireCanvas() {
    const surface = canvasSurface();
    if (!surface) { return; }
    surface.addEventListener('pointerdown', beginCanvasPointer);
    surface.addEventListener('pointermove', moveCanvasPointer);
    surface.addEventListener('pointerup', endCanvasPointer);
    surface.addEventListener('pointercancel', endCanvasPointer);

    surface.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        submitDesignEdit({ type: event.shiftKey ? 'redo' : 'undo' });
        event.preventDefault();
        return;
      }
      if (!selectedElementId) { return; }
      const step = event.shiftKey ? COLUMN_WIDTH : 8;
      if (event.key === 'ArrowLeft') { nudgeSelected(-step, 0); event.preventDefault(); }
      else if (event.key === 'ArrowRight') { nudgeSelected(step, 0); event.preventDefault(); }
      else if (event.key === 'ArrowUp') { nudgeSelected(0, -step); event.preventDefault(); }
      else if (event.key === 'ArrowDown') { nudgeSelected(0, step); event.preventDefault(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { deleteSelected(); event.preventDefault(); }
      else if (event.key === 'Escape') { selectedElementId = ''; renderCanvas(); }
    });
  }

  // Inspector fields are re-created on every render, so they are handled by
  // delegation rather than by binding listeners that would immediately be
  // thrown away.
  document.addEventListener('input', event => {
    const target = event.target;
    if (target.id === 'inspectorLabel') {
      const element = findElement(selectedElementId);
      if (element) { element.label = target.value; markDirty(); renderCanvasSummary(); }
      const box = qs('.wf-box[data-element-id="' + cssEscape(selectedElementId) + '"] .wf-box-label');
      if (box) { box.textContent = target.value; }
    } else if (target.id === 'inspectorPrompt') {
      const element = findElement(selectedElementId);
      if (element) { element.designPrompt = target.value; markDirty(); }
    }
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'inspectorLabel') {
      submitDesignEdit({
        type: 'set-node-label', screenId: activePageId, nodeId: selectedElementId,
        label: event.target.value,
      });
    } else if (event.target.id === 'inspectorPrompt') {
      submitDesignEdit({
        type: 'set-node-design-prompt', screenId: activePageId, nodeId: selectedElementId,
        designPrompt: event.target.value,
      });
    } else if (event.target.id === 'inspectorKind') {
      const element = findElement(selectedElementId);
      if (element) {
        element.kind = event.target.value;
        submitDesignEdit({
          type: 'set-node-kind', screenId: activePageId, nodeId: element.id, kind: event.target.value,
        });
        renderCanvas();
      }
    } else if (event.target.id === 'wireframePageSelect') {
      activePageId = event.target.value;
      selectedElementId = '';
      renderCanvas();
      renderPagePromptField();
    }
  });

  document.addEventListener('click', event => {
    const paletteButton = event.target.closest('.palette-button[data-kind]');
    if (paletteButton) {
      if (activeBreakpoint !== activeBaseBreakpoint()) {
        notice('Switch to the base breakpoint to add structure. Responsive views override existing nodes only.');
        return;
      }
      armedKind = paletteButton.dataset.kind;
      qsa('.palette-button[data-kind]').forEach(button => button.classList.toggle('armed', button === paletteButton));
      notice('Drag on the canvas to draw a ' + paletteButton.textContent.trim().toLowerCase() + ', or click once to place it.');
      return;
    }

    const breakpointButton = event.target.closest('.breakpoint-button[data-breakpoint]');
    if (breakpointButton && BREAKPOINTS.includes(breakpointButton.dataset.breakpoint)) {
      activeBreakpoint = breakpointButton.dataset.breakpoint;
      renderCanvas();
      notice(activeBreakpoint === activeBaseBreakpoint()
        ? 'Showing the base layout. Direct manipulation changes the shared structure.'
        : 'Showing the resolved ' + activeBreakpoint + ' layout. Dragging, resizing, and nudging create an override; structure stays shared.');
      return;
    }

    if (event.target.id === 'applyResponsiveRect') {
      const rect = {
        x: Number(value('#responsiveX')),
        y: Number(value('#responsiveY')),
        width: Number(value('#responsiveWidth')),
        height: Number(value('#responsiveHeight')),
      };
      if (!Object.values(rect).every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
        notice('Responsive geometry needs finite X, Y, width, and height values.', 'error');
        return;
      }
      submitDesignEdit({
        type: 'set-node-viewport-override', screenId: activePageId, nodeId: selectedElementId,
        breakpoint: activeBreakpoint, rect,
      });
      return;
    }
    if (event.target.id === 'resetResponsiveRect') {
      submitDesignEdit({
        type: 'clear-node-viewport-override', screenId: activePageId, nodeId: selectedElementId,
        breakpoint: activeBreakpoint, property: 'rect',
      });
      return;
    }
    if (event.target.id === 'applyResponsiveVisibility') {
      submitDesignEdit({
        type: 'set-node-viewport-override', screenId: activePageId, nodeId: selectedElementId,
        breakpoint: activeBreakpoint, hidden: qs('#responsiveHidden')?.checked === true,
      });
      return;
    }
    if (event.target.id === 'resetResponsiveVisibility') {
      submitDesignEdit({
        type: 'clear-node-viewport-override', screenId: activePageId, nodeId: selectedElementId,
        breakpoint: activeBreakpoint, property: 'hidden',
      });
      return;
    }

    if (event.target.id === 'deleteElement') { deleteSelected(); return; }

    if (event.target.closest('#askAboutElement')) {
      promptFor('element', { elementId: selectedElementId });
      return;
    }
    if (event.target.closest('#askAboutPage')) {
      promptFor('page', {});
      return;
    }
    if (event.target.closest('#askAboutSite')) {
      promptFor('site', {});
      return;
    }
    if (event.target.id === 'generateElement') {
      requestGenerate('element', { pageId: activePageId, elementId: selectedElementId });
      return;
    }

    const generateButton = event.target.closest('[data-generate-stage]');
    if (generateButton) {
      requestGenerate(generateButton.dataset.generateStage, {
        pageId: generateButton.dataset.pageId || activePageId,
      });
      return;
    }

    const frameworkCard = event.target.closest('[data-framework]');
    if (frameworkCard) {
      // Data only: the id names a catalog entry, and the panel decides what that
      // entry means. The webview never names a command to run.
      vscode.postMessage({ type: 'selectFramework', payload: { frameworkId: frameworkCard.dataset.framework } });
      qsa('[data-framework]').forEach(card => {
        const selected = card === frameworkCard;
        card.classList.toggle('selected', selected);
        card.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      return;
    }

    if (event.target.id === 'planStackSetup') {
      vscode.postMessage({ type: 'planStackSetup' });
      notice('Working out what setting this stack up would involve…');
      return;
    }

    if (event.target.id === 'syncToDelivery') {
      vscode.postMessage({ type: 'compareDelivery' });
      notice('Comparing with the Delivery pipeline…');
      return;
    }

    const sitemapNode = event.target.closest('[data-sitemap-page]');
    if (sitemapNode) {
      activePageId = sitemapNode.dataset.sitemapPage;
      selectedElementId = '';
      showPage('wireframes');
      syncPageSelect();
      renderCanvas();
      renderPagePromptField();
      return;
    }
  });

  /**
   * Send a scoped instruction to the panel.
   *
   * The webview supplies the scope and the ids; the panel composes the prompt
   * and decides where it goes. Composing it here would put the fencing rules in
   * the least trustworthy place in the system.
   */
  function promptFor(scope, extra) {
    const input = qs(scope === 'element' ? '#inspectorPrompt'
      : scope === 'page' ? '#pageDesignPrompt' : '#siteDesignPrompt');
    const instruction = (input?.value ?? '').trim();
    if (!instruction) {
      notice('Write what you want changed first, then ask Atlas.', 'error');
      input?.focus();
      return;
    }
    vscode.postMessage({
      type: 'promptForTarget',
      payload: { scope, pageId: activePageId, instruction, ...extra },
    });
    notice('Sent to Atlas with the selection attached.');
  }

  function requestGenerate(stage, extra) {
    vscode.postMessage({ type: 'generate', payload: { stage, ...extra } });
    notice('Preparing the generation plan…');
  }

  function syncPageSelect() {
    const select = qs('#wireframePageSelect');
    if (select) { select.value = activePageId; }
  }

  function renderPagePromptField() {
    const field = qs('#pageDesignPrompt');
    if (field) { field.value = activePage()?.designPrompt ?? ''; }
    const heading = qs('#wireframePageTitle');
    if (heading) { heading.textContent = activePage()?.title ?? ''; }
  }

  document.addEventListener('input', event => {
    if (event.target.id === 'pageDesignPrompt') {
      const page = activePage();
      if (page) { page.designPrompt = event.target.value; markDirty(); }
    }
  });

  // ── Collecting for save ────────────────────────────────────────

  function collectConfig() {
    const pageBasics = new Map(qsa('#sitemapRows tr[data-page-id]').map(row => [row.dataset.pageId, {
      id: row.dataset.pageId,
      title: value('.page-title', row),
      slug: value('.page-slug', row),
      purpose: value('.page-purpose', row),
      template: value('.page-template', row),
      parentId: value('.page-parent', row) || undefined,
      order: Number(value('.page-order', row)) || 0,
    }]));

    // The in-memory model is authoritative for everything the canvas owns; the
    // DOM is authoritative for the text fields. Merging them here rather than
    // re-reading the canvas out of the DOM is what keeps geometry in units.
    const pages = state.pages.map(page => {
      const basics = pageBasics.get(page.id) ?? {};
      const card = qs('[data-wireframe-card="' + cssEscape(page.id) + '"]');
      return {
        id: page.id,
        title: basics.title || page.title,
        slug: basics.slug || page.slug,
        purpose: basics.purpose ?? page.purpose,
        template: basics.template || page.template,
        parentId: basics.parentId ?? page.parentId,
        order: basics.order ?? page.order,
        designPrompt: page.designPrompt ?? '',
        links: page.links ?? [],
        wireframe: page.wireframe,
        sections: page.sections ?? [],
        wireframeNotes: card ? value('.page-wireframeNotes', card) : (page.wireframeNotes ?? ''),
        designNotes: card ? value('.page-designNotes', card) : (page.designNotes ?? ''),
        wireframeStatus: card ? value('.page-wireframeStatus', card) : page.wireframeStatus,
        designStatus: card ? value('.page-designStatus', card) : page.designStatus,
        contentStatus: card ? value('.page-contentStatus', card) : page.contentStatus,
        seoStatus: card && qs('.page-seoStatus', card) ? value('.page-seoStatus', card) : page.seoStatus,
      };
    });

    const platforms = qsa('[data-platform-id]').map(card => ({
      id: card.dataset.platformId,
      label: qs('h2', card)?.textContent ?? card.dataset.platformId,
      primary: qs('input[name="primaryPlatform"]', card)?.checked === true,
      status: value('.platform-status', card),
      siteUrl: value('.platform-siteUrl', card),
      projectReference: value('.platform-projectReference', card),
      environmentReference: value('.platform-environmentReference', card),
      notes: value('.platform-notes', card),
    }));
    const hostingEnvironments = qsa('[data-environment-id]').map(card => ({
      id: card.dataset.environmentId,
      hostingMode: value('.environment-hostingMode', card) || card.dataset.hostingMode,
      url: value('.environment-url', card),
      branchReference: value('.environment-branchReference', card),
      credentialReference: value('.environment-credentialReference', card),
      subdomainLabel: value('.environment-subdomainLabel', card),
      notes: value('.environment-notes', card),
    }));
    const automations = qsa('[data-automation-id]').map(card => ({
      id: card.dataset.automationId,
      name: value('.automation-name', card),
      event: value('.automation-event', card),
      outcome: value('.automation-outcome', card),
      status: value('.automation-status', card),
      n8nWorkflowId: value('.automation-workflowId', card),
      instanceUrl: value('.automation-instanceUrl', card),
      credentialReference: value('.automation-credentialReference', card),
      dataNotes: value('.automation-dataNotes', card),
    }));

    return {
      version: 6,
      designRevision,
      surfaceKind: value('#surfaceKind') || state.surfaceKind || 'website',
      designPrompt: value('#siteDesignPrompt'),
      intake: {
        clientName: value('#intake-clientName'),
        projectName: value('#intake-projectName'),
        summary: value('#intake-summary'),
        goals: lines(value('#intake-goals')),
        audiences: lines(value('#intake-audiences')),
        requiredFeatures: lines(value('#intake-requiredFeatures')),
        contentSources: lines(value('#intake-contentSources')),
        brandNotes: value('#intake-brandNotes'),
        constraints: lines(value('#intake-constraints')),
        successMetrics: lines(value('#intake-successMetrics')),
        targetLaunch: value('#intake-targetLaunch'),
        budget: value('#intake-budget'),
        stakeholders: lines(value('#intake-stakeholders')),
      },
      pages,
      designSystem: {
        brandDirection: value('#design-brandDirection'),
        tone: value('#design-tone'),
        primaryColor: value('#design-primaryColor'),
        secondaryColor: value('#design-secondaryColor'),
        accentColor: value('#design-accentColor'),
        headingFont: value('#design-headingFont'),
        bodyFont: value('#design-bodyFont'),
        spacingScale: value('#design-spacingScale'),
        cornerStyle: value('#design-cornerStyle'),
        accessibilityTarget: value('#design-accessibilityTarget'),
        componentNotes: lines(value('#design-componentNotes')),
      },
      contentDesign: {
        voice: value('#content-voice'),
        principles: lines(value('#content-principles')),
        preferredTerms: lines(value('#content-preferredTerms')),
        avoidedTerms: lines(value('#content-avoidedTerms')),
        readingLevel: value('#content-readingLevel'),
        locales: lines(value('#content-locales')),
        accessibilityNotes: value('#content-accessibilityNotes'),
      },
      implementation: {
        targetTechnologies: lines(value('#implementation-targetTechnologies')),
        sourceRoots: lines(value('#implementation-sourceRoots')),
        componentLocations: lines(value('#implementation-componentLocations')),
        notes: lines(value('#implementation-notes')),
      },
      platforms,
      hostingEnvironments,
      automations,
    };
  }

  // ── Static wiring ──────────────────────────────────────────────

  qsa('[data-page-target]').forEach(button =>
    button.addEventListener('click', () => showPage(button.dataset.pageTarget)));
  qsa('[data-command]').forEach(button =>
    button.addEventListener('click', () => vscode.postMessage({ type: 'openCommand', payload: button.dataset.command })));
  qsa('[data-open-ssot]').forEach(button =>
    button.addEventListener('click', () => vscode.postMessage({ type: 'openSsot', payload: button.dataset.openSsot })));

  qsa('.environment-hostingMode').forEach(select => select.addEventListener('change', () => {
    const card = select.closest('[data-environment-id]');
    if (!card) { return; }
    card.dataset.hostingMode = select.value;
    const access = qs('.environment-accessPolicy strong', card);
    if (access) { access.textContent = select.value === 'hosted' ? 'password-protected' : 'local-only'; }
    notice(select.value === 'hosted'
      ? 'Hosted Develop requires HTTPS and a password credential reference.'
      : 'Develop restored to loopback-only local hosting. Save to persist.');
  }));

  qs('#saveWebsiteStudio')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'saveConfig', payload: collectConfig() });
    notice('Saving Website Studio…');
  });
  qs('#importClientIntake')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'importIntake', payload: qs('#clientIntakeJson')?.value ?? '' });
    notice('Importing and normalizing client intake…');
  });

  document.addEventListener('click', event => {
    const saveContent = event.target.closest('.save-page-content');
    if (saveContent) {
      const card = saveContent.closest('[data-content-page-id]');
      if (!card) { return; }
      vscode.postMessage({
        type: 'savePageContent',
        payload: {
          pageId: card.dataset.contentPageId,
          title: value('.content-title', card),
          metaDescription: value('.content-metaDescription', card),
          status: value('.content-status', card),
          body: value('.content-body', card),
          expectedBody: value('.content-expectedBody', card),
        },
      });
      notice('Saving the Markdown content file…');
      return;
    }
    const seedContent = event.target.closest('.seed-page-content');
    if (seedContent) {
      const card = seedContent.closest('[data-content-page-id]');
      if (!card) { return; }
      vscode.postMessage({ type: 'seedPageContent', payload: { pageId: card.dataset.contentPageId } });
      notice('Creating a placeholder-only content outline…');
    }
  });
  qs('#stopPreview')?.addEventListener('click', () => vscode.postMessage({ type: 'stopPreview' }));
  qs('#openPreview')?.addEventListener('click', () => vscode.postMessage({ type: 'openPreview' }));
  qs('#openFullPreview')?.addEventListener('click', () => vscode.postMessage({ type: 'openPreview' }));
  qs('#refreshFullPreview')?.addEventListener('click', () => vscode.postMessage({ type: 'refreshPreview' }));
  qs('#openResponsivePreview')?.addEventListener('click', () => vscode.postMessage({ type: 'openResponsivePreview' }));

  qs('#addWebsitePage')?.addEventListener('click', () => {
    if (state.readOnly) { return; }
    const id = makeId('page');
    const isWebsite = (value('#surfaceKind') || state.surfaceKind) === 'website';
    const title = isWebsite ? 'New page' : 'New screen';
    // Added to the model first, so the canvas and the sitemap agree without a
    // round trip to the panel.
    state.pages.push({
      id, title, slug: isWebsite ? '/new-page' : 'screen/new', purpose: '', template: isWebsite ? 'Standard page' : 'Standard screen',
      sections: [], wireframeNotes: '', designNotes: '',
      wireframeStatus: 'not-started', designStatus: 'not-started',
      contentStatus: 'not-started', seoStatus: 'not-started',
      order: state.pages.length, designPrompt: '', links: [],
      wireframe: { breakpoint: 'desktop', elements: [] },
    });
    qs('#sitemapRows')?.insertAdjacentHTML('beforeend', sitemapRowMarkup(id, title, isWebsite));
    const select = qs('#wireframePageSelect');
    if (select) {
      select.insertAdjacentHTML('beforeend', '<option value="' + escapeAttribute(id) + '">' + escapeText(title) + '</option>');
    }
    markDirty();
    notice('New page added. Save Website Studio to persist it and redraw the hierarchy map.');
  });

  function sitemapRowMarkup(id, title, isWebsite) {
    return '<tr data-page-id="' + escapeAttribute(id) + '">'
      + '<td><input class="page-title" aria-label="Page title" value="' + escapeAttribute(title) + '" /></td>'
      + '<td><input class="page-slug" aria-label="Route or view id" value="' + (isWebsite ? '/new-page' : 'screen/new') + '" /></td>'
      + '<td><textarea class="page-purpose" aria-label="Page purpose" rows="2"></textarea></td>'
      + '<td><input class="page-template" aria-label="Screen template" value="' + (isWebsite ? 'Standard page' : 'Standard screen') + '" /></td>'
      + '<td class="links-cell">—</td>'
      + '<td><button type="button" class="danger subtle remove-page" data-remove-id="' + escapeAttribute(id) + '">Remove</button></td>'
      + '</tr>';
  }

  qs('#addWebsiteAutomation')?.addEventListener('click', () => {
    qs('#automationEmpty')?.remove();
    const id = makeId('automation');
    qs('#automationCards')?.insertAdjacentHTML('beforeend', automationCardMarkup(id));
    notice('New n8n workflow added. Add references only, then save.');
  });

  function automationCardMarkup(id) {
    return '<article class="automation-card" data-automation-id="' + escapeAttribute(id) + '">'
      + '<div class="card-heading"><p class="eyebrow">n8n workflow</p>'
      + '<button type="button" class="danger subtle remove-automation" data-remove-automation="' + escapeAttribute(id) + '">Remove</button></div>'
      + '<label class="field"><span>Workflow name</span><input class="automation-name" value="New automation" /></label>'
      + '<label class="field"><span>Event / trigger</span><input class="automation-event" /></label>'
      + '<label class="field"><span>Expected outcome</span><textarea class="automation-outcome" rows="4"></textarea></label>'
      + '<label class="field"><span>Status</span><select class="automation-status">'
      + '<option value="idea">Idea</option><option value="mapped">Mapped</option><option value="configured">Configured</option>'
      + '<option value="verified">Verified</option><option value="paused">Paused</option></select></label>'
      + '<div class="field-pair"><label class="field"><span>n8n workflow ID</span><input class="automation-workflowId" /></label>'
      + '<label class="field"><span>n8n instance URL</span><input class="automation-instanceUrl" placeholder="https://n8n.example.com/" /></label></div>'
      + '<label class="field"><span>Credential reference</span><input class="automation-credentialReference" placeholder="env:N8N_WORKFLOW_URL" /></label>'
      + '<label class="field"><span>Data and privacy notes</span><textarea class="automation-dataNotes" rows="4"></textarea></label></article>';
  }

  document.addEventListener('click', event => {
    const removePage = event.target.closest('[data-remove-id]');
    if (removePage) {
      if (removePage.dataset.confirm !== 'true') {
        removePage.dataset.confirm = 'true';
        removePage.textContent = 'Confirm remove';
        return;
      }
      const id = removePage.dataset.removeId;
      state.pages = state.pages.filter(page => page.id !== id);
      qsa('tr[data-page-id]').filter(row => row.dataset.pageId === id).forEach(row => row.remove());
      qsa('#wireframePageSelect option').filter(option => option.value === id).forEach(option => option.remove());
      if (activePageId === id) {
        activePageId = state.pages[0]?.id ?? '';
        selectedElementId = '';
        syncPageSelect();
        renderCanvas();
        renderPagePromptField();
      }
      markDirty();
      notice('Page removed from the draft. Any links pointing at it will be reported once you save.');
      return;
    }
    const removeAutomation = event.target.closest('[data-remove-automation]');
    if (removeAutomation) {
      if (removeAutomation.dataset.confirm !== 'true') {
        removeAutomation.dataset.confirm = 'true';
        removeAutomation.textContent = 'Confirm remove';
        return;
      }
      removeAutomation.closest('[data-automation-id]')?.remove();
      notice('Automation removed from the draft. Save Website Studio to persist.');
    }
  });

  function paintSwatch(id, colour) {
    const swatch = qs('[data-token-swatch="' + cssEscape(id) + '"]');
    if (swatch) { swatch.style.background = colour; }
  }

  qsa('[data-color-for]').forEach(picker => {
    const id = picker.dataset.colorFor;
    const target = document.getElementById(id);
    picker.addEventListener('input', () => {
      if (target) { target.value = picker.value; }
      paintSwatch(id, picker.value);
    });
    target?.addEventListener('input', () => {
      const next = target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(next)) {
        picker.value = next;
        paintSwatch(id, next);
      }
    });
  });

  // ── Escaping ───────────────────────────────────────────────────

  function escapeText(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttribute(text) {
    return escapeText(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Ids are constrained to an identifier charset by the sanitizer, but they are
   * interpolated into selectors here, so they are escaped anyway. A selector
   * built from unescaped input throws on the first unusual character and takes
   * the whole panel down with it.
   */
  function cssEscape(text) {
    const raw = String(text ?? '');
    return window.CSS?.escape ? window.CSS.escape(raw) : raw.replace(/["\\\]]/g, '\\$&');
  }

  function applyDesignGraphState(message) {
    if (!Number.isSafeInteger(message.revision) || message.revision < acknowledgedDesignRevision
        || !Array.isArray(message.pages) || message.pages.length > 100) {
      return;
    }
    acknowledgedDesignRevision = message.revision;
    if (message.type === 'designEditRefused') {
      designRevision = message.revision;
    } else if (message.revision < designRevision) {
      return;
    } else {
      designRevision = message.revision;
    }
    for (const update of message.pages) {
      if (!update || !/^[a-zA-Z0-9._-]{1,120}$/.test(update.id)) { continue; }
      const page = state.pages.find(candidate => candidate.id === update.id);
      if (!page) { continue; }
      if (update.wireframe && typeof update.wireframe === 'object') {
        page.wireframe = update.wireframe;
      } else {
        delete page.wireframe;
      }
    }
    if (message.responsiveScreens !== undefined) {
      state.responsiveScreens = normalizeResponsiveScreens(message.responsiveScreens);
    }
    if (!findElement(selectedElementId)) { selectedElementId = ''; }
    renderCanvas();
    renderPagePromptField();
    if (message.type === 'designEditRefused') {
      notice('That canvas edit was refused (' + String(message.reason || 'invalid edit') + '). The saved revision was restored.', 'error');
    }
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'notice') {
      notice(message.message, message.tone);
      if (message.tone === 'success') {
        dirty = false;
        const badge = qs('#unsavedBadge');
        if (badge) { badge.hidden = true; }
      }
    } else if (message?.type === 'designGraphUpdated' || message?.type === 'designEditRefused') {
      applyDesignGraphState(message);
    } else if (message?.type === 'previewSelection') {
      const pageId = typeof message.pageId === 'string' ? message.pageId : '';
      const nodeId = typeof message.nodeId === 'string' ? message.nodeId : '';
      if (!/^[a-zA-Z0-9._-]{1,120}$/.test(pageId) || !/^[a-zA-Z0-9._-]{1,120}$/.test(nodeId)) {
        return;
      }
      const page = state.pages.find(candidate => candidate.id === pageId);
      if (!page?.wireframe?.elements?.some(element => element.id === nodeId)) {
        return;
      }
      activePageId = pageId;
      selectedElementId = nodeId;
      syncPageSelect();
      showPage('wireframes');
      renderCanvas();
      renderPagePromptField();
      qs('.wf-box[data-element-id="' + cssEscape(nodeId) + '"]')?.focus();
    }
  });

  window.addEventListener('beforeunload', event => {
    if (dirty) { event.preventDefault(); }
  });

  wireCanvas();
  syncPageSelect();
  renderCanvas();
  renderPagePromptField();
  vscode.postMessage({ type: 'ready' });
}());
