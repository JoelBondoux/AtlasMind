/**
 * Shared metric widgets for AtlasMind webview panels.
 *
 * The Project Dashboard grew a vocabulary of metric primitives (tone-aware
 * pills with inline meters, segmented proportion bars, progress meters) that
 * every other panel re-invented as flat text. This module makes that vocabulary
 * available everywhere, in the two forms panels actually need:
 *
 * - **Server-rendered** — the `render*Html` functions below, for the
 *   `bodyContent` a panel builds in TypeScript.
 * - **Client-rendered** — {@link DASHBOARD_WIDGETS_JS}, the same helpers as a
 *   source string to inject into a panel's inline `scriptContent`, for panels
 *   that rebuild their markup in the webview.
 *
 * Both forms emit identical markup, so a panel can mix them.
 *
 * ## Why animation is driven from script
 *
 * A panel that rebuilds markup via `innerHTML` gets a freshly parsed node with
 * exactly one computed style, so a CSS `transition` between two values can
 * never interpolate — the animation silently never plays. Every meter emitted
 * here therefore renders at zero and declares `data-anim-key` / `data-anim-to`;
 * {@link DASHBOARD_WIDGETS_JS}'s `applyValueAnimations()` remembers the last
 * value painted per key and moves only what actually changed, so an unrelated
 * re-render repaints at the final value with no motion and no flicker.
 *
 * A server-rendered panel that never re-renders can call `applyValueAnimations()`
 * once on load and get the same grow-in for free.
 */

import { escapeHtml } from './webviewUtils.js';

/** Status tone shared across every AtlasMind metric surface. */
export type WidgetTone = 'good' | 'warn' | 'critical' | 'accent' | 'muted';

/** One slice of a {@link renderDistributionBarHtml} bar. */
export interface DistributionSegment {
  label: string;
  value: number;
  tone: WidgetTone;
}

export interface DistributionOptions {
  /** Heading above the bar. */
  title?: string;
  /** Small right-aligned caption, typically the denominator. */
  caption?: string;
  /** Shown instead of the bar when every segment is zero. Omit to render nothing. */
  emptyLabel?: string;
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

/**
 * A bare animated meter bar. `key` must be stable across renders and unique
 * within the panel — two elements sharing a key fight over one memory slot and
 * one of them stops animating.
 */
export function renderMeterHtml(key: string, percent: number, tone: WidgetTone = 'accent'): string {
  return `<span class="dash-meter dash-meter-${escapeAttr(tone)}"><span data-anim-key="${escapeAttr(key)}" data-anim-to="${clampPercent(percent)}%" style="width:0%"></span></span>`;
}

/**
 * Label + value pill, optionally tone-dotted, optionally carrying an inline
 * meter. The workhorse for "a number that means something".
 */
export function renderMetricPillHtml(
  label: string,
  value: string,
  options: { tone?: WidgetTone; meter?: number; meterKey?: string } = {},
): string {
  const toneClass = options.tone ? ` pill-tone-${escapeAttr(options.tone)}` : '';
  const dot = options.tone ? '<span class="pill-dot"></span>' : '';
  const meter = typeof options.meter === 'number' && Number.isFinite(options.meter)
    ? renderMeterHtml(options.meterKey || `metric:${label}`, options.meter, options.tone ?? 'accent')
    : '';
  return `<div class="metric-pill${toneClass}">`
    + `<span class="metric-head">${dot}<span class="metric-label">${escapeHtml(label)}</span></span>`
    + `<span class="metric-value">${escapeHtml(value)}</span>${meter}</div>`;
}

/**
 * Segmented proportion bar plus legend. Replaces the "3 verified · 1 blocked ·
 * 2 missing" sentences that carry counts but no magnitude.
 */
export function renderDistributionBarHtml(
  key: string,
  segments: DistributionSegment[],
  options: DistributionOptions = {},
): string {
  const usable = segments.filter(segment => Number(segment.value) > 0);
  const total = usable.reduce((sum, segment) => sum + Number(segment.value), 0);
  if (total <= 0) {
    return options.emptyLabel ? `<div class="dist-empty">${escapeHtml(options.emptyLabel)}</div>` : '';
  }
  const bar = usable.map(segment => {
    const percent = (Number(segment.value) / total) * 100;
    return `<span class="dist-seg dist-${escapeAttr(segment.tone)}"`
      + ` data-anim-key="dist:${escapeAttr(key)}:${escapeAttr(segment.label)}"`
      + ` data-anim-to="${percent}%" style="width:0%"`
      + ` title="${escapeAttr(`${segment.label}: ${segment.value}`)}"></span>`;
  }).join('');
  const legend = usable.map(segment => `<span class="dist-legend-item">`
    + `<span class="dist-swatch dist-${escapeAttr(segment.tone)}" aria-hidden="true"></span>`
    + `<span class="dist-legend-label">${escapeHtml(segment.label)}</span>`
    + `<strong>${escapeHtml(String(segment.value))}</strong></span>`).join('');
  const heading = options.title
    ? `<div class="dist-title"><span>${escapeHtml(options.title)}</span>${options.caption ? `<span class="list-meta">${escapeHtml(options.caption)}</span>` : ''}</div>`
    : '';
  const ariaLabel = usable.map(s => `${s.label}: ${s.value}`).join(', ');
  return `<div class="dist-block">${heading}`
    + `<div class="dist-bar" role="img" aria-label="${escapeAttr(ariaLabel)}">${bar}</div>`
    + `<div class="dist-legend">${legend}</div></div>`;
}

/**
 * A compact inline trend line. Unlike the Project Dashboard's full chart card
 * this carries no axes or interaction — it is a shape cue to sit beside a
 * number, for panels where a full chart would dominate the layout.
 *
 * Rendered as an SVG polyline so it scales with its container and needs no
 * per-point DOM.
 */
export function renderSparklineHtml(
  values: number[],
  options: { tone?: WidgetTone; label?: string; width?: number; height?: number } = {},
): string {
  const points = values.filter(v => Number.isFinite(v));
  if (points.length < 2) {
    return '';
  }
  const width = options.width ?? 120;
  const height = options.height ?? 28;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  // y is inverted: SVG origin is top-left, but a higher value must sit higher.
  const path = points
    .map((value, index) => `${(index * stepX).toFixed(1)},${(height - ((value - min) / span) * height).toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1] ?? 0;
  const lastX = width;
  const lastY = height - ((last - min) / span) * height;
  const tone = options.tone ?? 'accent';
  const label = options.label ?? `Trend across ${points.length} points, latest ${last}`;
  return `<svg class="dash-sparkline spark-${escapeAttr(tone)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeAttr(label)}">`
    + `<polyline points="${path}" fill="none" vector-effect="non-scaling-stroke" />`
    + `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2" vector-effect="non-scaling-stroke" />`
    + `</svg>`;
}

/** Styling for every widget above. Inject after {@link DASHBOARD_THEME_CSS}. */
export const DASHBOARD_WIDGETS_CSS = `
  /* ── Metric pill ──────────────────────────────────────────────────── */
  .metric-pill {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    padding: 9px 12px;
    border: 1px solid var(--dash-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--dash-panel) 70%, transparent);
    min-width: 0;
  }

  .metric-head { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .metric-label { font-size: 11px; color: var(--dash-muted); }
  .metric-value { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }

  .pill-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: var(--dash-muted);
  }

  .pill-tone-good .pill-dot { background: var(--dash-good); }
  .pill-tone-warn .pill-dot { background: var(--dash-warn); }
  .pill-tone-critical .pill-dot { background: var(--dash-critical); }
  .pill-tone-accent .pill-dot { background: var(--dash-accent-strong); }

  /* ── Meter ────────────────────────────────────────────────────────── */
  .dash-meter {
    flex-basis: 100%;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dash-border) 70%, transparent);
    overflow: hidden;
    margin-top: 2px;
  }

  .dash-meter > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--dash-accent-strong);
    transition: width var(--dash-dur-value) var(--dash-ease);
  }

  .dash-meter-good > span { background: var(--dash-good); }
  .dash-meter-warn > span { background: var(--dash-warn); }
  .dash-meter-critical > span { background: var(--dash-critical); }
  .dash-meter-muted > span { background: color-mix(in srgb, var(--dash-muted) 55%, transparent); }

  /* ── Distribution bar ─────────────────────────────────────────────── */
  .dist-block { display: flex; flex-direction: column; gap: 7px; }

  .dist-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    font-weight: 600;
  }

  .dist-bar {
    display: flex;
    height: 12px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--dash-border) 45%, transparent);
  }

  .dist-seg {
    display: block;
    height: 100%;
    min-width: 2px;
    transition: width var(--dash-dur-value) var(--dash-ease);
  }

  .dist-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; }

  .dist-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--dash-muted);
  }

  .dist-legend-item strong { color: var(--vscode-foreground); font-variant-numeric: tabular-nums; }
  .dist-swatch { width: 9px; height: 9px; border-radius: 3px; flex: none; }
  .dist-empty { font-size: 12px; color: var(--dash-muted); }

  .dist-good { background: var(--dash-good); }
  .dist-warn { background: var(--dash-warn); }
  .dist-critical { background: var(--dash-critical); }
  .dist-accent { background: var(--dash-accent-strong); }
  .dist-muted { background: color-mix(in srgb, var(--dash-muted) 45%, transparent); }

  /* ── Sparkline ────────────────────────────────────────────────────── */
  .dash-sparkline {
    width: 120px;
    height: 28px;
    overflow: visible;
  }

  .dash-sparkline polyline { stroke: var(--dash-accent-strong); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
  .dash-sparkline circle { fill: var(--dash-accent-strong); stroke: none; }
  .spark-good polyline, .spark-good circle { stroke: var(--dash-good); fill: var(--dash-good); }
  .spark-warn polyline, .spark-warn circle { stroke: var(--dash-warn); fill: var(--dash-warn); }
  .spark-critical polyline, .spark-critical circle { stroke: var(--dash-critical); fill: var(--dash-critical); }
  .spark-good polyline, .spark-warn polyline, .spark-critical polyline { fill: none; }
`;

/**
 * Client-side counterpart. Inject into a panel's inline `scriptContent`.
 *
 * Exposes `atlasWidgets.renderMetricPill / renderDistributionBar / renderMeter`
 * (identical markup to the server-rendered functions) and, crucially,
 * `atlasWidgets.applyValueAnimations(root)` — call it after every render, and
 * once on load for a server-rendered panel.
 */
export const DASHBOARD_WIDGETS_JS = `
const atlasWidgets = (function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(value) { return escapeHtml(value).replace(/\`/g, '&#96;'); }
  function clampPercent(v) { return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0; }

  function renderMeter(key, percent, tone) {
    return '<span class="dash-meter dash-meter-' + escapeAttr(tone || 'accent') + '">'
      + '<span data-anim-key="' + escapeAttr(key) + '" data-anim-to="' + clampPercent(percent) + '%" style="width:0%"></span></span>';
  }

  function renderMetricPill(label, value, options) {
    var o = options || {};
    var toneClass = o.tone ? ' pill-tone-' + escapeAttr(o.tone) : '';
    var dot = o.tone ? '<span class="pill-dot"></span>' : '';
    var meter = (typeof o.meter === 'number' && Number.isFinite(o.meter))
      ? renderMeter(o.meterKey || ('metric:' + label), o.meter, o.tone || 'accent') : '';
    return '<div class="metric-pill' + toneClass + '">'
      + '<span class="metric-head">' + dot + '<span class="metric-label">' + escapeHtml(label) + '</span></span>'
      + '<span class="metric-value">' + escapeHtml(value) + '</span>' + meter + '</div>';
  }

  function renderDistributionBar(key, segments, options) {
    var o = options || {};
    var usable = (segments || []).filter(function (s) { return Number(s.value) > 0; });
    var total = usable.reduce(function (sum, s) { return sum + Number(s.value); }, 0);
    if (total <= 0) {
      return o.emptyLabel ? '<div class="dist-empty">' + escapeHtml(o.emptyLabel) + '</div>' : '';
    }
    var bar = usable.map(function (s) {
      var pct = (Number(s.value) / total) * 100;
      return '<span class="dist-seg dist-' + escapeAttr(s.tone || 'accent') + '"'
        + ' data-anim-key="dist:' + escapeAttr(key) + ':' + escapeAttr(s.label) + '"'
        + ' data-anim-to="' + pct + '%" style="width:0%"'
        + ' title="' + escapeAttr(s.label + ': ' + s.value) + '"></span>';
    }).join('');
    var legend = usable.map(function (s) {
      return '<span class="dist-legend-item"><span class="dist-swatch dist-' + escapeAttr(s.tone || 'accent') + '" aria-hidden="true"></span>'
        + '<span class="dist-legend-label">' + escapeHtml(s.label) + '</span><strong>' + escapeHtml(String(s.value)) + '</strong></span>';
    }).join('');
    var heading = o.title
      ? '<div class="dist-title"><span>' + escapeHtml(o.title) + '</span>'
        + (o.caption ? '<span class="list-meta">' + escapeHtml(o.caption) + '</span>' : '') + '</div>'
      : '';
    var aria = usable.map(function (s) { return s.label + ': ' + s.value; }).join(', ');
    return '<div class="dist-block">' + heading
      + '<div class="dist-bar" role="img" aria-label="' + escapeAttr(aria) + '">' + bar + '</div>'
      + '<div class="dist-legend">' + legend + '</div></div>';
  }

  // See this module's header: a CSS transition cannot interpolate on a node
  // that was parsed a moment ago, so meters are driven from here instead.
  // Only values that actually changed move, which is what keeps an unrelated
  // re-render from re-animating the whole panel.
  var animMemory = new Map();
  var reducedMotionQuery = (typeof window.matchMedia === 'function')
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function setAnimValue(el, prop, value) {
    if (prop === 'dashoffset') { el.style.strokeDashoffset = value; }
    else if (prop !== 'class') { el.style[prop] = value; }
  }

  function applyValueAnimations(scope) {
    var root = scope || document;
    var reduced = !!(reducedMotionQuery && reducedMotionQuery.matches);
    var pending = [];
    root.querySelectorAll('[data-anim-key]').forEach(function (el) {
      var key = el.getAttribute('data-anim-key');
      var prop = el.getAttribute('data-anim-prop') || 'width';
      var to = el.getAttribute('data-anim-to') || '';
      var from = el.getAttribute('data-anim-from') || '0%';

      // Hidden elements paint at their final value but are NOT recorded, so
      // they animate the first time their section is actually shown.
      var hiddenHost = el.closest('[hidden], [aria-hidden="true"], .is-hidden');
      if (hiddenHost) { setAnimValue(el, prop, to); return; }

      var previous = animMemory.get(key);
      animMemory.set(key, to);
      if (reduced || previous === to) { setAnimValue(el, prop, to); return; }
      setAnimValue(el, prop, previous === undefined ? from : previous);
      pending.push([el, prop, to]);
    });
    if (pending.length === 0) { return; }
    // Two frames: the first commits the "from" value as a real computed style,
    // the second starts the transition from it.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        pending.forEach(function (entry) {
          entry[0].classList.add('is-animating');
          setAnimValue(entry[0], entry[1], entry[2]);
        });
      });
    });
  }

  return {
    renderMeter: renderMeter,
    renderMetricPill: renderMetricPill,
    renderDistributionBar: renderDistributionBar,
    applyValueAnimations: applyValueAnimations,
  };
})();
`;
