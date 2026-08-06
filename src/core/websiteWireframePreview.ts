/**
 * The wireframe, rendered to HTML you can actually look at — with no model
 * involved.
 *
 * This exists because of a real bug. There was no deterministic HTML renderer
 * anywhere in the codebase: the only HTML in `src/core/` was the preview
 * server's error page. So a wireframe could not reach a browser *at all* without
 * first running a model generation, and opening the preview before generating
 * served the 404 — a white page with one line of small grey text, which is
 * exactly what it looked like.
 *
 * Three things make this worth having beyond fixing that.
 *
 * **It is deterministic, instant and free.** The same wireframe always produces
 * the same page, with no model call, no cost and no waiting. That makes the
 * preview usable as a working surface — draw, look, adjust — rather than
 * something you spend a model call to consult.
 *
 * **A placeholder is unmistakably a placeholder.** Hatched fill, dashed border,
 * the element's own label, and for a text block grey bars rather than lorem
 * ipsum. This is the same rule the content model turns on: filler that looks
 * finished is worse than an obvious gap, because somebody signs it off.
 *
 * **It carries no script and no external request.** The output has to satisfy
 * the preview server's existing strict CSP (`default-src 'none'`, no script, no
 * network) without that policy being widened, so everything is inline CSS and
 * static markup. A test asserts there is no `<script>` in any producible render.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type {
  WebsiteDesignSystem,
  WebsitePagePlan,
  WebsiteWireframe,
  WebsiteWireframeElement,
  WireframeElementKind,
} from '../types.js';
import {
  WIREFRAME_CANVAS_WIDTH,
  orderedWireframeElements,
  wireframeKindSpec,
} from './websiteWireframe.js';
import { normalizeSlug } from './websiteSitemap.js';

export interface WireframePreviewOptions {
  page: WebsitePagePlan;
  designSystem: WebsiteDesignSystem;
  /** Other pages, so the nav placeholder can show real destinations. */
  siblings?: readonly WebsitePagePlan[];
  /** Site or project name for the header strip. */
  siteName?: string;
}

/**
 * How tall the rendered page is, in canvas units.
 *
 * Derived from the content rather than fixed, so a long page is not clipped and
 * a short one does not open onto a screen of empty grid.
 */
function contentHeight(wireframe: WebsiteWireframe): number {
  const lowest = wireframe.elements.reduce(
    (max, element) => Math.max(max, element.rect.y + element.rect.height),
    0,
  );
  return Math.max(600, lowest + 40);
}

export function renderWireframePreview(options: WireframePreviewOptions): string {
  const { page, designSystem } = options;
  const wireframe = page.wireframe;
  const title = `${page.title} — wireframe`;

  if (!wireframe || wireframe.elements.length === 0) {
    return renderShell({
      title,
      designSystem,
      banner: bannerMarkup(page, options.siteName, 'Not drawn yet'),
      body: `<div class="wf-empty">
        <p><strong>This page has not been drawn yet.</strong></p>
        <p>Open Website Studio → Wireframe canvas, choose <em>${escapeHtml(page.title)}</em>,
        and drag a block onto the grid. This preview updates from the drawing — no model is involved.</p>
      </div>`,
    });
  }

  const height = contentHeight(wireframe);
  const ordered = orderedWireframeElements(wireframe);
  const byId = new Map(ordered.map(element => [element.id, element]));

  const blocks = ordered.map(element => {
    const spec = wireframeKindSpec(element.kind);
    const { x, y, width, height: elementHeight } = element.rect;

    // Positioned in percentages of the same 1000-unit grid the canvas uses, so
    // the browser shows what was drawn rather than an interpretation of it.
    const style = [
      `left:${percent(x / WIREFRAME_CANVAS_WIDTH)}`,
      `top:${percent(y / height)}`,
      `width:${percent(width / WIREFRAME_CANVAS_WIDTH)}`,
      `height:${percent(elementHeight / height)}`,
    ].join(';');

    const parent = element.parentId ? byId.get(element.parentId) : undefined;
    const describedAs = `${element.label || spec.label}, ${spec.label}`
      + (parent ? `, inside ${parent.label || wireframeKindSpec(parent.kind).label}` : '');

    return `<div class="wf-block" data-kind="${escapeHtml(element.kind)}" style="${style}"
      role="group" aria-label="${escapeHtml(describedAs)}">
      <div class="wf-tag">${escapeHtml(element.label || spec.label)}<span>${escapeHtml(spec.label)}</span></div>
      ${placeholderBody(element, options)}
    </div>`;
  }).join('\n');

  return renderShell({
    title,
    designSystem,
    banner: bannerMarkup(page, options.siteName, `${ordered.length} element${ordered.length === 1 ? '' : 's'}`),
    body: `<div class="wf-stage" style="aspect-ratio:${WIREFRAME_CANVAS_WIDTH} / ${height}">${blocks}</div>`,
  });
}

/**
 * What goes inside a block.
 *
 * Each kind gets a shape that reads as *the kind of thing it is* without
 * pretending to be content. A text block is grey bars, not sentences; an image
 * is a crossed rectangle, not a stock photo; a nav shows the real page names,
 * because those are actual facts from the sitemap rather than invented copy.
 */
function placeholderBody(element: WebsiteWireframeElement, options: WireframePreviewOptions): string {
  switch (element.kind) {
    case 'nav':
    case 'footer': {
      const pages = (options.siblings ?? []).slice(0, 6);
      if (pages.length === 0) {
        return '<div class="wf-navrow"><span class="wf-chip">Nav item</span><span class="wf-chip">Nav item</span></div>';
      }
      // Real page titles: a fact from the sitemap, not filler.
      return `<div class="wf-navrow">${pages
        .map(page => `<span class="wf-chip">${escapeHtml(page.title)}</span>`)
        .join('')}</div>`;
    }
    case 'media':
      return '<div class="wf-media" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none">'
        + '<line x1="0" y1="0" x2="100" y2="100" /><line x1="100" y1="0" x2="0" y2="100" />'
        + '</svg></div>';
    case 'text':
      return '<div class="wf-lines" aria-hidden="true">'
        + '<i style="width:70%"></i><i style="width:95%"></i><i style="width:88%"></i><i style="width:52%"></i></div>';
    case 'cta':
      return '<div class="wf-cta" aria-hidden="true"><span class="wf-button">Action</span></div>';
    case 'form':
      return '<div class="wf-form" aria-hidden="true"><i></i><i></i><i></i><span class="wf-button">Submit</span></div>';
    case 'hero':
      return '<div class="wf-lines wf-lines-hero" aria-hidden="true">'
        + '<i style="width:60%;height:16px"></i><i style="width:40%"></i><span class="wf-button">Action</span></div>';
    default:
      return '';
  }
}

function bannerMarkup(page: WebsitePagePlan, siteName: string | undefined, detail: string): string {
  return `<header class="wf-banner">
    <div>
      <p class="wf-eyebrow">${escapeHtml(siteName ?? 'Website Studio')} · wireframe preview</p>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="wf-slug">${escapeHtml(normalizeSlug(page.slug))} · ${escapeHtml(detail)}</p>
    </div>
    <p class="wf-note">Structure only. Every block below is a placeholder — nothing here is real content.</p>
  </header>`;
}

interface ShellOptions {
  title: string;
  designSystem: WebsiteDesignSystem;
  banner: string;
  body: string;
}

/**
 * The document.
 *
 * Inline CSS and static markup only, because the preview server sends
 * `default-src 'none'` with no script — widening that policy so a *wireframe*
 * could render would weaken every generated page served alongside it.
 */
function renderShell(options: ShellOptions): string {
  const accent = safeColour(options.designSystem.primaryColor, '#2563eb');
  const secondary = safeColour(options.designSystem.secondaryColor, '#0f172a');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title)}</title>
<style>
  :root { --accent: ${accent}; --ink: ${secondary}; --line: rgba(15, 23, 42, .28); }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 0 48px;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink); background: #f6f7f9;
  }
  .wf-banner {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; flex-wrap: wrap;
    padding: 20px 24px; background: #fff; border-bottom: 2px solid var(--accent);
  }
  .wf-banner h1 { margin: 2px 0; font-size: 1.35rem; }
  .wf-eyebrow { margin: 0; font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; opacity: .6; font-weight: 700; }
  .wf-slug { margin: 0; font-size: .8rem; opacity: .65; font-family: ui-monospace, monospace; }
  .wf-note { margin: 0; font-size: .78rem; opacity: .7; max-width: 34ch; text-align: right; }

  .wf-stage {
    position: relative; width: min(1100px, calc(100% - 32px)); margin: 24px auto 0;
    background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
  }

  .wf-block {
    position: absolute; overflow: hidden; padding: 10px 12px;
    border: 1.5px dashed var(--line); border-radius: 6px;
    background-color: rgba(148, 163, 184, .10);
    background-image: repeating-linear-gradient(135deg,
      rgba(148, 163, 184, .16) 0 8px, transparent 8px 16px);
  }
  .wf-tag {
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
    font-size: .8rem; font-weight: 700; color: var(--ink);
  }
  .wf-tag span {
    font-size: .62rem; font-weight: 600; letter-spacing: .09em; text-transform: uppercase;
    opacity: .55; border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px;
  }

  .wf-block[data-kind="nav"], .wf-block[data-kind="footer"] { background-color: rgba(15, 23, 42, .06); }
  .wf-block[data-kind="hero"] {
    background-color: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  }
  .wf-block[data-kind="cta"] { border-style: solid; border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); }

  .wf-navrow { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .wf-chip { font-size: .75rem; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; background: #fff; }

  .wf-lines { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
  .wf-lines i { display: block; height: 9px; border-radius: 3px; background: rgba(15, 23, 42, .14); }
  .wf-lines-hero i { height: 12px; }

  .wf-media { position: absolute; inset: 30px 12px 12px; opacity: .35; }
  .wf-media svg { width: 100%; height: 100%; }
  .wf-media line { stroke: var(--ink); stroke-width: .6; vector-effect: non-scaling-stroke; }

  .wf-button {
    display: inline-block; margin-top: 10px; padding: 6px 16px; border-radius: 6px;
    background: var(--accent); color: #fff; font-size: .78rem; font-weight: 700;
  }
  .wf-form { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .wf-form i { display: block; width: 100%; max-width: 320px; height: 26px; border: 1px solid var(--line); border-radius: 5px; background: #fff; }

  .wf-empty {
    width: min(620px, calc(100% - 32px)); margin: 48px auto; padding: 28px;
    background: #fff; border: 1px dashed var(--line); border-radius: 10px;
  }
  .wf-empty p { margin: 0 0 10px; }
</style>
</head>
<body>
${options.banner}
${options.body}
</body>
</html>
`;
}

/** An index listing every page, so the preview root is never a bare 404. */
export function renderWireframeIndex(
  pages: readonly WebsitePagePlan[],
  designSystem: WebsiteDesignSystem,
  siteName?: string,
): string {
  const rows = pages.length === 0
    ? '<p>No pages yet. Add one on the Sitemap tab.</p>'
    : `<ul class="wf-index">${pages.map(page => {
        const drawn = page.wireframe?.elements.length ?? 0;
        return `<li>
          <a href="${escapeHtml(previewPathFor(page))}">${escapeHtml(page.title)}</a>
          <span>${escapeHtml(normalizeSlug(page.slug))}</span>
          <em>${drawn === 0 ? 'not drawn yet' : `${drawn} element${drawn === 1 ? '' : 's'}`}</em>
        </li>`;
      }).join('')}</ul>`;

  return renderShell({
    title: `${siteName ?? 'Website'} — wireframes`,
    designSystem,
    banner: `<header class="wf-banner">
      <div>
        <p class="wf-eyebrow">${escapeHtml(siteName ?? 'Website Studio')}</p>
        <h1>Wireframes</h1>
        <p class="wf-slug">${pages.length} page${pages.length === 1 ? '' : 's'}</p>
      </div>
      <p class="wf-note">Structure only, rendered from the canvas. No model has run — press Generate for a real page.</p>
    </header>`,
    body: `<div class="wf-empty">${rows}
      <style>
        .wf-index { list-style: none; margin: 0; padding: 0; }
        .wf-index li { display: flex; align-items: baseline; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
        .wf-index a { font-weight: 700; color: var(--accent); }
        .wf-index span { font-family: ui-monospace, monospace; font-size: .78rem; opacity: .6; }
        .wf-index em { margin-left: auto; font-size: .75rem; opacity: .6; font-style: normal; }
      </style>
    </div>`,
  });
}

/**
 * Where a page's wireframe render is written.
 *
 * Deliberately *not* `pagePath()` from `websiteGeneration`. A wireframe render
 * must never sit at the address a generated page will occupy — if it did, a
 * later Generate would either be blocked by the create-only rule or would
 * silently replace it, and in both cases somebody is looking at the wrong thing.
 * They live side by side under `_wireframe/`.
 */
export function previewPathFor(page: WebsitePagePlan): string {
  const slug = normalizeSlug(page.slug);
  const name = slug === '/' ? 'index' : slug.slice(1).replace(/\//g, '-');
  return `_wireframe/${name}.html`;
}

/** The wireframe index's own path, for the same reason. */
export const WIREFRAME_INDEX_PATH = '_wireframe/index.html';

// ── Helpers ──────────────────────────────────────────────────────

function percent(fraction: number): string {
  return `${Math.max(0, Math.min(100, fraction * 100)).toFixed(3)}%`;
}

/**
 * A colour we are willing to put in a stylesheet.
 *
 * Six-digit hex or nothing. The design system's colours are user-editable text
 * and this value is interpolated into CSS, so anything that is not obviously a
 * colour falls back rather than being escaped and hoped for.
 */
function safeColour(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Kinds that render a distinct placeholder shape. Exported for the test that pins coverage. */
export const KINDS_WITH_PLACEHOLDER_SHAPE: readonly WireframeElementKind[] = [
  'nav', 'footer', 'media', 'text', 'cta', 'form', 'hero',
];
