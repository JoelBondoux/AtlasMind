/**
 * The shared visual language for every Atlas Lens surface.
 *
 * Lens shipped as eight panels written weeks apart, and it looked like it: six
 * near-identical copies of a header, six slightly different card borders, three
 * spellings of the same empty state, and one panel with curved edges while the
 * others drew none. Every one of those was a defensible local choice and the
 * sum was a feature that read as unfinished.
 *
 * Three things live here rather than in eight places:
 *
 * - **`LENS_BASE_CSS`** — the tokens, header, cards, badges, and states. A
 *   panel that wants a card gets *the* card, so the surfaces cannot drift again.
 * - **`LENS_FLOW_CSS` + `LENS_FLOW_SCRIPT`** — flowing links between two DOM
 *   elements, with the hover highlighting that makes a dense graph readable.
 *   Curves are drawn from live element geometry rather than a layout guess, so
 *   they survive wrapping, scrolling, and a resized panel.
 * - **`LENS_INFO_CSS` + `LENS_INFO_SCRIPT`** — the ⓘ affordance. Lens is full
 *   of words that are precise and unhelpful to somebody meeting them for the
 *   first time ("merge base", "precedence", "possible flow"). The info popover
 *   is where the plain-language sentence lives, and it is a real button:
 *   keyboard-reachable, Escape-dismissable, and `aria-expanded`-labelled,
 *   because a tooltip that only exists on hover is a tooltip half the users
 *   never receive.
 *
 * Everything here is author-written static text or CSS. No caller may pass
 * project data through `renderLensInfo` without escaping — it goes through
 * `escapeHtml`, and the dynamic path (`createLensInfo` in the script) sets
 * `textContent`, never markup.
 */

import { escapeHtml } from './webviewUtils.js';

/**
 * Tokens, header, cards, badges, states.
 *
 * The accent map is keyed on `data-accent` so the core module can name a colour
 * family without knowing a hex value. Eight families from VS Code's six chart
 * colours: the last two are mixed rather than borrowed, so no two lenses share
 * a hue and every one still moves with the active theme.
 */
export const LENS_BASE_CSS = `
  /* The surface tokens Lens used to declare here — gap, radius, surface,
     border, muted — now come from \`DASHBOARD_TOKEN_ALIASES_CSS\`, so a Lens
     card is the dashboard's card. Only the accent stays local: it is keyed per
     surface so the header rule says which lens you are reading, which is
     information rather than decoration. */
  :root {
    --lens-accent: var(--vscode-charts-blue, #75beff);
  }
  [data-accent="blue"]   { --lens-accent: var(--vscode-charts-blue, #75beff); }
  [data-accent="purple"] { --lens-accent: var(--vscode-charts-purple, #b180d7); }
  [data-accent="orange"] { --lens-accent: var(--vscode-charts-orange, #d18616); }
  [data-accent="green"]  { --lens-accent: var(--vscode-charts-green, #89d185); }
  [data-accent="yellow"] { --lens-accent: var(--vscode-charts-yellow, #cca700); }
  [data-accent="red"]    { --lens-accent: var(--vscode-charts-red, #f14c4c); }
  [data-accent="teal"]   { --lens-accent: color-mix(in srgb, var(--vscode-charts-blue, #75beff) 50%, var(--vscode-charts-green, #89d185)); }
  [data-accent="indigo"] { --lens-accent: color-mix(in srgb, var(--vscode-charts-purple, #b180d7) 62%, var(--vscode-charts-blue, #75beff)); }

  .lens-shell { max-width: 1500px; margin: 0 auto; }

  /* Header. The gradient rule under it is the one purely decorative element in
     the system, and it is derived from the surface's accent so it still says
     which lens you are in. */
  .lens-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 18px; flex-wrap: wrap; padding-bottom: 14px; margin-bottom: 18px;
    border-bottom: 1px solid var(--lens-border); position: relative;
  }
  .lens-header::after {
    content: ''; position: absolute; left: 0; bottom: -1px; height: 2px; width: min(220px, 40%);
    background: linear-gradient(90deg, var(--lens-accent), transparent);
    border-radius: 2px;
  }
  .lens-header h1 { margin: 0; font-size: 1.45rem; line-height: 1.25; letter-spacing: -0.01em; }
  .lens-header-text { display: flex; flex-direction: column; gap: 4px; min-width: 240px; }
  .lens-eyebrow {
    margin: 0; font-size: .7rem; font-weight: 700; letter-spacing: .14em;
    text-transform: uppercase; color: var(--lens-accent);
    display: inline-flex; align-items: center; gap: 7px;
  }
  .lens-subtitle { margin: 0; color: var(--lens-muted); font-size: .88rem; max-width: 72ch; }
  .lens-header-aside { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  /* Badges. "mode" states where the facts came from and is on every surface,
     because a reader who forgets that is a reader who over-trusts the page. */
  .lens-badge {
    display: inline-flex; align-items: center; gap: 6px; flex: none;
    border: 1px solid var(--lens-border); border-radius: 999px;
    padding: 4px 11px; font-size: .74rem; font-weight: 600; color: var(--lens-muted);
    background: var(--lens-surface);
  }
  .lens-badge.mode { border-color: color-mix(in srgb, var(--lens-accent) 45%, transparent); color: var(--lens-accent); }
  .lens-badge.mode::before {
    content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--lens-accent); flex: none;
  }
  .lens-badge[data-state="ready"] { color: var(--vscode-charts-green, #89d185); border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 45%, transparent); }
  .lens-badge[data-state="needs-setup"] { color: var(--vscode-charts-orange, #d18616); border-color: color-mix(in srgb, var(--vscode-charts-orange, #d18616) 45%, transparent); }
  .lens-badge[data-state="needs-selection"] { color: var(--vscode-charts-blue, #75beff); border-color: color-mix(in srgb, var(--vscode-charts-blue, #75beff) 45%, transparent); }
  .lens-badge[data-state="unavailable"] { color: var(--vscode-errorForeground); border-color: color-mix(in srgb, var(--vscode-errorForeground) 45%, transparent); }
  .lens-badge[data-state="unknown"] { color: var(--lens-muted); border-style: dashed; }

  /* Notices carry the evidence caveats. They are never collapsed away: a bounded
     view that does not say it is bounded is a wrong view. */
  .lens-notices { list-style: none; display: grid; gap: 6px; margin: 0 0 18px; padding: 0; }
  .lens-notices:empty { display: none; }
  .lens-notices li {
    position: relative; padding: 8px 12px 8px 32px; border-radius: 8px;
    border: 1px solid var(--lens-border);
    background: color-mix(in srgb, var(--vscode-editorInfo-foreground, var(--vscode-charts-blue, #75beff)) 7%, transparent);
    color: var(--lens-muted); font-size: .82rem;
  }
  .lens-notices li::before {
    content: 'i'; position: absolute; left: 11px; top: 9px;
    width: 14px; height: 14px; border-radius: 50%; font-size: .64rem; font-weight: 700;
    display: grid; place-items: center; font-style: italic;
    background: color-mix(in srgb, var(--vscode-editorInfo-foreground, var(--vscode-charts-blue, #75beff)) 22%, transparent);
    color: var(--vscode-editorInfo-foreground, var(--vscode-charts-blue, #75beff));
  }

  /* Sections and panels. */
  .lens-section { margin-bottom: 22px; }
  .lens-section-head { display: flex; align-items: center; gap: 9px; margin: 0 0 10px; flex-wrap: wrap; }
  .lens-section-head h2 {
    margin: 0; font-size: .8rem; font-weight: 700; letter-spacing: .09em;
    text-transform: uppercase; color: var(--lens-muted);
  }
  .lens-section-count { font-size: .74rem; color: var(--lens-muted); font-variant-numeric: tabular-nums; }
  .lens-panel {
    border: 1px solid var(--lens-border); border-radius: var(--lens-radius);
    background: var(--lens-surface); padding: 16px;
  }

  /* The card. One definition, eight surfaces.
     The accent bar is an ::before rather than a border-left so a card can be a
     grid child without its content box shifting by 3px against its neighbours. */
  .lens-card {
    position: relative; display: flex; flex-direction: column; gap: 6px;
    padding: 12px 13px 12px 16px; border: 1px solid var(--lens-border);
    border-radius: 9px; background: var(--lens-surface-raised);
    transition: border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  }
  .lens-card::before {
    content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 3px;
    border-radius: 0 3px 3px 0; background: var(--lens-accent); opacity: .85;
  }
  .lens-card.is-interactive { cursor: pointer; }
  .lens-card.is-interactive:hover {
    border-color: color-mix(in srgb, var(--lens-accent) 55%, var(--lens-border));
    transform: translateY(-1px);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--tint-toward) 22%, transparent);
  }
  .lens-card.is-interactive:focus-visible,
  .lens-card:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .lens-card.is-dimmed { opacity: .38; }
  .lens-card.is-highlighted {
    border-color: var(--lens-accent);
    box-shadow: 0 0 0 1px var(--lens-accent), 0 4px 16px color-mix(in srgb, var(--lens-accent) 22%, transparent);
  }
  .lens-card-head { display: flex; align-items: flex-start; gap: 8px; justify-content: space-between; }
  .lens-card-title { margin: 0; font-size: .95rem; font-weight: 650; line-height: 1.3; }
  .lens-card-kicker {
    margin: 0; font-size: .68rem; font-weight: 700; letter-spacing: .1em;
    text-transform: uppercase; color: var(--lens-accent);
  }
  .lens-card-body { margin: 0; font-size: .82rem; color: var(--lens-muted); }
  .lens-card-path {
    margin: 0; font-family: var(--vscode-editor-font-family, monospace);
    font-size: .74rem; color: var(--lens-muted); overflow-wrap: anywhere;
  }
  .lens-card-meta { margin: 0; font-size: .74rem; color: var(--lens-muted); }
  .lens-card-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }

  /* Buttons. "quiet" is the default for a per-card action; "primary" is reserved
     for the one action a card is actually recommending, so a page cannot end up
     with nine equally loud buttons and no suggestion. */
  .lens-button {
    appearance: none; display: inline-flex; align-items: center; gap: 6px;
    border-radius: 999px; padding: 4px 12px; font: inherit; font-size: .76rem;
    font-weight: 600; cursor: pointer; line-height: 1.4;
    border: 1px solid var(--lens-border);
    background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent);
    color: var(--vscode-foreground);
    transition: background 110ms ease, border-color 110ms ease;
  }
  .lens-button:hover {
    background: color-mix(in srgb, var(--lens-accent) 16%, transparent);
    border-color: color-mix(in srgb, var(--lens-accent) 60%, var(--lens-border));
  }
  .lens-button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .lens-button.primary {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border-color: transparent;
  }
  .lens-button.primary:hover { background: var(--vscode-button-hoverBackground); }

  /* Empty and truncation states. */
  .lens-empty {
    margin: 0; padding: 16px; border: 1px dashed var(--lens-border); border-radius: 9px;
    color: var(--lens-muted); font-size: .84rem; text-align: center;
  }
  .lens-remainder { margin: 8px 0 0; font-size: .76rem; color: var(--lens-muted); font-style: italic; }

  /* The text alternative every visual surface carries. */
  .lens-text-view { margin-top: 20px; border-top: 1px solid var(--lens-border); padding-top: 12px; }
  .lens-text-view summary { cursor: pointer; font-weight: 600; font-size: .84rem; }
  .lens-text-view summary:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .lens-text-view p, .lens-text-view li { color: var(--lens-muted); font-size: .82rem; }

  @media (max-width: 640px) {
    .lens-header { flex-direction: column; }
  }
`;

/**
 * The flowing links.
 *
 * `vector-effect: non-scaling-stroke` is load-bearing: the layer is sized to the
 * stage's *scroll* box, and without it a wide graph's strokes thin out as the
 * viewBox grows. The moving dashes run only on a highlighted edge and only when
 * the OS has not asked for reduced motion — permanent ambient animation in an
 * editor panel is a distraction tax paid on every render.
 */
export const LENS_FLOW_CSS = `
  .lens-stage { position: relative; }
  .lens-flow-layer {
    position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: visible;
  }
  .lens-flow-content { position: relative; z-index: 1; }
  .lens-edge {
    fill: none; stroke: var(--lens-edge-color, var(--lens-muted)); stroke-width: 1.6;
    stroke-linecap: round; opacity: .5; vector-effect: non-scaling-stroke;
    transition: opacity 130ms ease, stroke-width 130ms ease;
  }
  .lens-edge[data-strength="declared"] { opacity: .34; stroke-dasharray: 5 4; }
  .lens-edge[data-strength="absent"] { opacity: .22; stroke-dasharray: 2 5; }
  .lens-edge.is-dimmed { opacity: .07; }
  .lens-edge.is-highlighted { opacity: 1; stroke-width: 2.4; }
  .lens-edge-cap { fill: var(--lens-edge-color, var(--lens-muted)); opacity: .55; transition: opacity 130ms ease; }
  .lens-edge-cap.is-dimmed { opacity: .08; }
  .lens-edge-cap.is-highlighted { opacity: 1; }
  @media (prefers-reduced-motion: no-preference) {
    .lens-edge.is-highlighted[data-strength="live"] {
      stroke-dasharray: 7 6;
      animation: lens-flow-dash 900ms linear infinite;
    }
    @keyframes lens-flow-dash { to { stroke-dashoffset: -26; } }
  }
`;

/**
 * `createLensFlow(stage, layer)` → `{ render(edges), redraw() }`.
 *
 * An edge is `{ id, from, to, accent?, strength?, direction? }` where `from`
 * and `to` are elements already in the DOM. Geometry is read at draw time from
 * `getBoundingClientRect`, so nothing here needs to know how the stage laid its
 * children out — which is what lets the same renderer serve a three-column flow
 * map, a depth-ordered call graph, and a precedence chain.
 *
 * `direction: 'vertical'` bends the curve top-to-bottom instead of
 * left-to-right, for stages that stack rather than flow across.
 *
 * Highlighting is exposed as `highlight(nodeIdOrNull)`; the caller decides what
 * hovering means on its own surface.
 */
export const LENS_FLOW_SCRIPT = `
  function createLensFlow(stage, layer) {
    const ACCENTS = {
      blue: 'var(--vscode-charts-blue, #75beff)',
      purple: 'var(--vscode-charts-purple, #b180d7)',
      orange: 'var(--vscode-charts-orange, #d18616)',
      green: 'var(--vscode-charts-green, #89d185)',
      yellow: 'var(--vscode-charts-yellow, #cca700)',
      red: 'var(--vscode-charts-red, #f14c4c)',
      teal: 'color-mix(in srgb, var(--vscode-charts-blue, #75beff) 50%, var(--vscode-charts-green, #89d185))',
      indigo: 'color-mix(in srgb, var(--vscode-charts-purple, #b180d7) 62%, var(--vscode-charts-blue, #75beff))'
    };
    let edges = [];
    let highlighted = null;
    let frame = 0;

    function svg(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

    function anchors(fromRect, toRect, stageRect, scrollLeft, scrollTop, vertical) {
      const fx = fromRect.left - stageRect.left + scrollLeft;
      const fy = fromRect.top - stageRect.top + scrollTop;
      const tx = toRect.left - stageRect.left + scrollLeft;
      const ty = toRect.top - stageRect.top + scrollTop;
      // Two boxes in the same column overlap horizontally, and side anchors then
      // send the curve out past the whole stage and back to an x it started at —
      // which is exactly what a self-transition or a same-step state change looks
      // like. Overlapping endpoints route top-to-bottom regardless of the caller's
      // preference; the caller's 'vertical' only forces the case that does not.
      const overlapsHorizontally = fx < tx + toRect.width && tx < fx + fromRect.width;
      if (vertical || overlapsHorizontally) {
        const downward = ty + toRect.height / 2 >= fy + fromRect.height / 2;
        return {
          vertical: true,
          x1: fx + fromRect.width / 2, y1: downward ? fy + fromRect.height : fy,
          x2: tx + toRect.width / 2, y2: downward ? ty : ty + toRect.height
        };
      }
      // Left-to-right by default, but a target that sits to the left of its
      // source is drawn back into the source's left edge rather than crossing
      // straight through the card it started from.
      const forward = tx + toRect.width / 2 >= fx + fromRect.width / 2;
      return {
        vertical: false,
        x1: forward ? fx + fromRect.width : fx, y1: fy + fromRect.height / 2,
        x2: forward ? tx : tx + toRect.width, y2: ty + toRect.height / 2
      };
    }

    function draw() {
      frame = 0;
      layer.replaceChildren();
      if (!edges.length) { return; }
      const stageRect = stage.getBoundingClientRect();
      const width = Math.max(stage.scrollWidth, stageRect.width);
      const height = Math.max(stage.scrollHeight, stageRect.height);
      layer.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      layer.setAttribute('width', String(width));
      layer.setAttribute('height', String(height));
      layer.style.width = width + 'px';
      layer.style.height = height + 'px';

      for (const edge of edges) {
        if (!edge.from || !edge.to || !edge.from.isConnected || !edge.to.isConnected) { continue; }
        const vertical = edge.direction === 'vertical';
        const point = anchors(
          edge.from.getBoundingClientRect(), edge.to.getBoundingClientRect(),
          stageRect, stage.scrollLeft, stage.scrollTop, vertical
        );
        const path = svg('path');
        const span = point.vertical ? Math.abs(point.y2 - point.y1) : Math.abs(point.x2 - point.x1);
        const bend = Math.max(22, span * 0.45);
        path.setAttribute('d', point.vertical
          ? 'M ' + point.x1 + ' ' + point.y1 + ' C ' + point.x1 + ' ' + (point.y1 + bend) + ', ' + point.x2 + ' ' + (point.y2 - bend) + ', ' + point.x2 + ' ' + point.y2
          : 'M ' + point.x1 + ' ' + point.y1 + ' C ' + (point.x1 + bend) + ' ' + point.y1 + ', ' + (point.x2 - bend) + ' ' + point.y2 + ', ' + point.x2 + ' ' + point.y2);
        path.setAttribute('class', 'lens-edge');
        path.setAttribute('data-strength', edge.strength || 'live');
        path.style.setProperty('--lens-edge-color', ACCENTS[edge.accent] || 'var(--vscode-descriptionForeground)');
        const cap = svg('circle');
        cap.setAttribute('cx', String(point.x2));
        cap.setAttribute('cy', String(point.y2));
        cap.setAttribute('r', '3');
        cap.setAttribute('class', 'lens-edge-cap');
        cap.style.setProperty('--lens-edge-color', ACCENTS[edge.accent] || 'var(--vscode-descriptionForeground)');
        if (highlighted) {
          const touches = edge.fromId === highlighted || edge.toId === highlighted;
          path.classList.add(touches ? 'is-highlighted' : 'is-dimmed');
          cap.classList.add(touches ? 'is-highlighted' : 'is-dimmed');
        }
        layer.appendChild(path);
        layer.appendChild(cap);
      }
    }

    function schedule() {
      if (frame) { return; }
      frame = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', schedule);
    stage.addEventListener('scroll', schedule, { passive: true });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(schedule).observe(stage);
    }

    return {
      render(next) { edges = next || []; schedule(); },
      redraw: schedule,
      highlight(nodeId) {
        if (highlighted === nodeId) { return; }
        highlighted = nodeId || null;
        schedule();
      },
      isHighlighting() { return Boolean(highlighted); }
    };
  }
`;

/**
 * The ⓘ affordance.
 *
 * Positioned by the script rather than by CSS `position: absolute` alone,
 * because a popover anchored inside a scrolling stage otherwise clips against
 * the stage's overflow — the one place a first-time reader is most likely to
 * open one.
 */
export const LENS_INFO_CSS = `
  /* A serif, upright 'i' at 20px. The first draft was an italic sans 'i' in an
     18px circle with a 55%-alpha border, and at render size it read as a slash
     — which is worse than no affordance, because a stray '/' after a heading
     looks like a typo rather than something to press. */
  .lens-info {
    appearance: none; flex: none; width: 20px; height: 20px; padding: 0;
    border-radius: 50%; cursor: pointer; font-size: .82rem; line-height: 1;
    font-family: Georgia, 'Times New Roman', serif; font-weight: 700;
    display: inline-grid; place-items: center; vertical-align: middle;
    border: 1px solid color-mix(in srgb, var(--lens-muted) 85%, transparent);
    background: color-mix(in srgb, var(--lens-muted) 10%, transparent);
    color: var(--lens-muted);
    transition: color 110ms ease, border-color 110ms ease, background 110ms ease;
  }
  .lens-info:hover, .lens-info[aria-expanded="true"] {
    color: var(--lens-accent);
    border-color: var(--lens-accent);
    background: color-mix(in srgb, var(--lens-accent) 14%, transparent);
  }
  .lens-info:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .lens-info-popover {
    position: fixed; z-index: 50; max-width: 320px; padding: 11px 13px;
    border: 1px solid var(--lens-border); border-radius: 9px;
    background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
    box-shadow: 0 6px 22px color-mix(in srgb, var(--tint-toward) 40%, transparent);
    font-size: .8rem; line-height: 1.45;
  }
  .lens-info-popover[hidden] { display: none; }
  .lens-info-popover h4 { margin: 0 0 5px; font-size: .8rem; font-weight: 700; }
  .lens-info-popover p { margin: 0; color: var(--lens-muted); }
  .lens-info-popover p + p { margin-top: 7px; }
`;

/**
 * Delegated info behaviour, plus `createLensInfo(title, body, note)` for the
 * cards a panel builds in JavaScript. One popover element is reused for every
 * button on the page: N popovers in the DOM is N chances for one to be left
 * open behind a re-render.
 */
export const LENS_INFO_SCRIPT = `
  const lensInfoPopover = (() => {
    const node = document.createElement('div');
    node.className = 'lens-info-popover';
    node.setAttribute('role', 'dialog');
    node.hidden = true;
    const heading = document.createElement('h4');
    const body = document.createElement('p');
    const note = document.createElement('p');
    node.append(heading, body, note);
    document.body.appendChild(node);
    let anchor = null;

    function close() {
      if (!anchor) { return; }
      anchor.setAttribute('aria-expanded', 'false');
      anchor = null;
      node.hidden = true;
    }

    function open(button) {
      heading.textContent = button.dataset.infoTitle || 'About this';
      body.textContent = button.dataset.infoBody || '';
      note.textContent = button.dataset.infoNote || '';
      note.hidden = !button.dataset.infoNote;
      anchor = button;
      button.setAttribute('aria-expanded', 'true');
      node.hidden = false;
      const rect = button.getBoundingClientRect();
      const size = node.getBoundingClientRect();
      const left = Math.min(Math.max(8, rect.left - size.width / 2 + rect.width / 2), window.innerWidth - size.width - 8);
      const below = rect.bottom + 8;
      node.style.left = left + 'px';
      node.style.top = (below + size.height > window.innerHeight - 8 ? Math.max(8, rect.top - size.height - 8) : below) + 'px';
    }

    document.addEventListener('click', event => {
      const button = event.target.closest('.lens-info');
      if (button) {
        event.stopPropagation();
        if (anchor === button) { close(); } else { close(); open(button); }
        return;
      }
      if (!event.target.closest('.lens-info-popover')) { close(); }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); } });
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return { close };
  })();

  function createLensInfo(title, body, note) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lens-info';
    button.textContent = 'i';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'What is ' + title + '?');
    button.title = body;
    button.dataset.infoTitle = title;
    button.dataset.infoBody = body;
    if (note) { button.dataset.infoNote = note; }
    return button;
  }
`;

export interface LensInfoOptions {
  title: string;
  body: string;
  /** A second paragraph, used for the honesty line about what a lens cannot prove. */
  note?: string;
}

/**
 * A static ⓘ button for `bodyContent`. The `title` attribute is set as well as
 * the popover data so a hover still explains it before anybody discovers the
 * click — the two affordances are not alternatives.
 */
export function renderLensInfo(options: LensInfoOptions): string {
  const note = options.note ? ` data-info-note="${escapeHtml(options.note)}"` : '';
  return `<button type="button" class="lens-info" aria-expanded="false"` +
    ` aria-label="What is ${escapeHtml(options.title)}?" title="${escapeHtml(options.body)}"` +
    ` data-info-title="${escapeHtml(options.title)}" data-info-body="${escapeHtml(options.body)}"${note}>i</button>`;
}

/** Every lens surface pulls the same three stylesheets in the same order. */
export const LENS_PANEL_CSS = `${LENS_BASE_CSS}${LENS_FLOW_CSS}${LENS_INFO_CSS}`;

/** Every lens surface that draws links pulls both scripts, flow first. */
export const LENS_PANEL_SCRIPT = `${LENS_FLOW_SCRIPT}${LENS_INFO_SCRIPT}`;

/**
 * The header every lens surface opens with.
 *
 * Passing the mode badge in rather than defaulting it is deliberate: "Static
 * evidence", "Declared model", and "Committed Git evidence" are different
 * promises, and a shared default would eventually put the wrong one on a page.
 */
export interface LensHeaderOptions {
  eyebrow: string;
  title: string;
  titleId?: string;
  subtitle: string;
  subtitleId?: string;
  /** What kind of facts this surface shows. Required, never defaulted. */
  mode: string;
  info?: LensInfoOptions;
  /** Extra controls rendered beside the mode badge. */
  aside?: string;
}

export function renderLensHeader(options: LensHeaderOptions): string {
  const titleId = options.titleId ? ` id="${escapeHtml(options.titleId)}"` : '';
  const subtitleId = options.subtitleId ? ` id="${escapeHtml(options.subtitleId)}"` : '';
  return `
    <header class="lens-header">
      <div class="lens-header-text">
        <p class="lens-eyebrow">${escapeHtml(options.eyebrow)}${options.info ? renderLensInfo(options.info) : ''}</p>
        <h1${titleId}>${escapeHtml(options.title)}</h1>
        <p class="lens-subtitle"${subtitleId}>${escapeHtml(options.subtitle)}</p>
      </div>
      <div class="lens-header-aside">
        ${options.aside ?? ''}
        <span class="lens-badge mode">${escapeHtml(options.mode)}</span>
      </div>
    </header>`;
}
