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
  UiComponentDefinition,
  UiContentCollection,
  UiDesignScreen,
  UiDesignToken,
  WebsiteDesignSystem,
  WebsitePagePlan,
  WebsiteWireframe,
  WebsiteWireframeElement,
  WireframeElementKind,
} from '../types.js';
import type { WebsitePageContent } from './websiteContent.js';
import {
  WIREFRAME_CANVAS_WIDTH,
  orderedWireframeElements,
  wireframeKindSpec,
} from './websiteWireframe.js';
import { normalizeSlug } from './websiteSitemap.js';
import {
  resolveUiComponentInstance,
  resolveUiDesignToken,
  resolveUiNodeContent,
  resolveUiScreenLayout,
} from './uiDesignGraph.js';

/** Fixed until breakpoint tokens become part of the design system in Phase 3. */
export const UI_PREVIEW_TABLET_MAX_WIDTH = 1_023;
export const UI_PREVIEW_MOBILE_MAX_WIDTH = 599;

export interface WireframePreviewOptions {
  page: WebsitePagePlan;
  designSystem: WebsiteDesignSystem;
  /** Other pages, so the nav placeholder can show real destinations. */
  siblings?: readonly WebsitePagePlan[];
  /** Site or project name for the header strip. */
  siteName?: string;
  /** Exact Markdown copy for this page. Missing copy remains visibly unfinished. */
  content?: WebsitePageContent;
  /** Authoritative screen used to project inherited tablet/mobile layout. */
  responsiveScreen?: UiDesignScreen;
  /** Typed system definitions projected through this target adapter. */
  tokens?: readonly UiDesignToken[];
  components?: readonly UiComponentDefinition[];
  /** Bounded sample records used only for deterministic design review. */
  contentCollections?: readonly UiContentCollection[];
}

export interface WireframeIndexOptions {
  /** Content records keyed by page id, used for honest readiness labels. */
  contents?: ReadonlyMap<string, WebsitePageContent>;
  /** A model-generated visual guide exists beside the deterministic draft. */
  generatedAvailable?: boolean;
  tokens?: readonly UiDesignToken[];
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
  const title = `${page.title} — design preview`;

  if (!wireframe || wireframe.elements.length === 0) {
    return renderShell({
      title,
      designSystem,
      tokens: options.tokens,
      banner: bannerMarkup(page, options.siteName, 'Not drawn yet', options.content),
      body: `<div class="wf-empty">
        <p><strong>This page has not been drawn yet.</strong></p>
        <p>Open UI Studio → Wireframe canvas, choose <em>${escapeHtml(page.title)}</em>,
        and drag a block onto the grid. This preview updates from the drawing — no model is involved.</p>
      </div>`,
    });
  }

  const ordered = orderedWireframeElements(wireframe);
  const baseProjection = options.responsiveScreen?.pageId === page.id
    ? new Map(resolveUiScreenLayout(options.responsiveScreen, 'desktop')
      .map(node => [node.id, node.layout]))
    : undefined;
  const height = baseProjection
    ? Math.max(600, ordered.reduce((lowest, element) => {
      const layout = baseProjection.get(element.id);
      return layout?.hidden ? lowest : Math.max(lowest, (layout?.rect ?? element.rect).y + (layout?.rect ?? element.rect).height);
    }, 0) + 40)
    : contentHeight(wireframe);
  const byId = new Map(ordered.map(element => [element.id, element]));
  const contentSections = splitContentSections(options.content?.body ?? '');
  let nextContentSection = 0;

  const blocks = ordered.map(element => {
    const spec = wireframeKindSpec(element.kind);
    const projected = baseProjection?.get(element.id);
    const { x, y, width, height: elementHeight } = projected?.rect ?? element.rect;

    // Positioned in percentages of the same 1000-unit grid the canvas uses, so
    // the browser shows what was drawn rather than an interpretation of it.
    const style = [
      `left:${percent(x / WIREFRAME_CANVAS_WIDTH)}`,
      `top:${percent(y / height)}`,
      `width:${percent(width / WIREFRAME_CANVAS_WIDTH)}`,
      `height:${percent(elementHeight / height)}`,
      ...(projected?.hidden ? ['display:none'] : []),
    ].join(';');

    const parent = element.parentId ? byId.get(element.parentId) : undefined;
    const describedAs = `${element.label || spec.label}, ${spec.label}`
      + (parent ? `, inside ${parent.label || wireframeKindSpec(parent.kind).label}` : '');
    const graphNode = options.responsiveScreen?.nodes.find(node => node.id === element.id);
    const component = graphNode && options.responsiveScreen
      ? resolveUiComponentInstance({
        revision: 0, tokens: options.tokens ? [...options.tokens] : [],
        components: options.components ? [...options.components] : [],
        contentCollections: options.contentCollections ? [...options.contentCollections] : [],
        screens: [options.responsiveScreen],
      }, options.responsiveScreen, graphNode)
      : undefined;
    const componentTag = component
      ? `<span class="wf-component-tag">${escapeHtml(component.definitionLabel)}${component.variantLabel ? ` · ${escapeHtml(component.variantLabel)}` : ''}${component.state !== 'default' ? ` · ${escapeHtml(component.state)}` : ''}</span>`
      : '';
    const contentState = graphNode?.previewContentState ?? 'default';
    const statePresentation = contentState === 'default'
      ? undefined
      : graphNode?.contentStatePresentations?.[contentState];
    const contentStateTag = statePresentation
      ? `<span class="wf-content-state ${escapeHtml(statePresentation.maturity)}">${escapeHtml(contentState)} · ${escapeHtml(statePresentation.maturity)}</span>`
      : '';
    const boundContent = graphNode && options.responsiveScreen
      ? resolveUiNodeContent({
        revision: 0,
        tokens: options.tokens ? [...options.tokens] : [],
        components: options.components ? [...options.components] : [],
        contentCollections: options.contentCollections ? [...options.contentCollections] : [],
        screens: [options.responsiveScreen],
      }, graphNode)
      : undefined;
    const dataTag = boundContent
      ? `<span class="wf-data-tag">${escapeHtml(boundContent.collectionLabel)} · ${escapeHtml(boundContent.sampleRecordLabel)}</span>`
      : '';
    const contentSection = consumesContent(element.kind) ? contentSections[nextContentSection++] : undefined;
    const renderedBody = statePresentation
      ? `<div class="wf-state-presentation"><strong>${escapeHtml(statePresentation.title || `${contentState} state`)}</strong>${statePresentation.body ? `<p>${escapeHtml(statePresentation.body)}</p>` : ''}${statePresentation.actionLabel ? `<span class="wf-button">${escapeHtml(statePresentation.actionLabel)}</span>` : ''}</div>`
      : boundContent && Object.keys(boundContent.values).length > 0
        ? `<div class="wf-bound-content">${boundContent.values.title ? `<strong>${escapeHtml(boundContent.values.title)}</strong>` : ''}${boundContent.values.body ? `<p>${escapeHtml(boundContent.values.body)}</p>` : ''}${boundContent.values.action ? `<span class="wf-button">${escapeHtml(boundContent.values.action)}</span>` : ''}</div>`
      : previewBody(
        element,
        options,
        contentSection,
      );

    return `<div class="wf-block" data-kind="${escapeHtml(element.kind)}"
      ${component ? `data-component="${escapeHtml(component.definitionId)}" data-component-state="${escapeHtml(component.state)}"` : ''}
      ${statePresentation ? `data-content-state="${escapeHtml(contentState)}" data-content-maturity="${escapeHtml(statePresentation.maturity)}"` : ''}
      data-atlas-screen-id="${escapeHtml(page.id)}" data-atlas-node-id="${escapeHtml(element.id)}" style="${style}"
      role="group" aria-label="${escapeHtml(describedAs)}">
      <div class="wf-tag">${escapeHtml(element.label || spec.label)}<span>${escapeHtml(spec.label)}</span>${componentTag}${contentStateTag}${dataTag}</div>
      ${renderedBody}
    </div>`;
  }).join('\n');

  const contentProof = renderContentProof(options.content);
  const responsiveStyles = options.responsiveScreen?.pageId === page.id
    ? renderResponsiveStyles(options.responsiveScreen, options.tokens ?? [])
    : '';

  return renderShell({
    title,
    designSystem,
    tokens: options.tokens,
    banner: bannerMarkup(
      page,
      options.siteName,
      `${ordered.length} element${ordered.length === 1 ? '' : 's'}`,
      options.content,
    ),
    body: `<div class="wf-stage" style="aspect-ratio:${WIREFRAME_CANVAS_WIDTH} / ${height}">${blocks}</div>${contentProof}${responsiveStyles}`,
  });
}

function renderResponsiveStyles(screen: UiDesignScreen, tokens: readonly UiDesignToken[]): string {
  if (!screen.initialized || screen.nodes.length === 0) {
    return '';
  }
  const tabletWidth = numericToken(tokens, 'breakpoint-tablet', UI_PREVIEW_TABLET_MAX_WIDTH);
  const mobileWidth = numericToken(tokens, 'breakpoint-mobile', UI_PREVIEW_MOBILE_MAX_WIDTH);
  const tablet = renderResponsiveBreakpoint(screen, 'tablet', tabletWidth);
  const mobile = renderResponsiveBreakpoint(screen, 'mobile', mobileWidth);
  return `<style data-atlas-responsive-layout>\n${tablet}\n${mobile}\n</style>`;
}

function renderResponsiveBreakpoint(
  screen: UiDesignScreen,
  breakpoint: 'tablet' | 'mobile',
  maxWidth: number,
): string {
  const resolved = resolveUiScreenLayout(screen, breakpoint).map(view => ({
    node: screen.nodes.find(candidate => candidate.id === view.id)!,
    layout: view.layout,
  }));
  const height = Math.max(
    600,
    resolved.reduce(
      (lowest, candidate) => candidate.layout.hidden
        ? lowest
        : Math.max(lowest, candidate.layout.rect.y + candidate.layout.rect.height),
      0,
    ) + 40,
  );
  const rules = resolved.map(({ node, layout }) => {
    const rect = layout.rect;
    const selector = `.wf-block[data-atlas-screen-id="${cssIdentifier(screen.id)}"]`
      + `[data-atlas-node-id="${cssIdentifier(node.id)}"]`;
    return `  ${selector} { left:${percent(rect.x / WIREFRAME_CANVAS_WIDTH)} !important;`
      + ` top:${percent(rect.y / height)} !important;`
      + ` width:${percent(rect.width / WIREFRAME_CANVAS_WIDTH)} !important;`
      + ` height:${percent(rect.height / height)} !important;`
      + ` display:${layout.hidden ? 'none' : 'block'} !important; }`;
  }).join('\n');
  return `@media (max-width: ${maxWidth}px) {\n`
    + `  .wf-stage { aspect-ratio:${WIREFRAME_CANVAS_WIDTH} / ${height} !important; }\n`
    + `${rules}\n}`;
}

/** CSS-string escaping for an attribute value; graph IDs are sanitized too. */
function cssIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, character => `\\${character.codePointAt(0)!.toString(16)} `);
}

function consumesContent(kind: WireframeElementKind): boolean {
  return kind === 'hero' || kind === 'text' || kind === 'section' || kind === 'custom';
}

function previewBody(
  element: WebsiteWireframeElement,
  options: WireframePreviewOptions,
  contentSection: string | undefined,
): string {
  if (contentSection?.trim()) {
    return `<div class="wf-real-content">${renderMarkdownPreview(contentSection)}</div>`;
  }
  return placeholderBody(element, options);
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

function bannerMarkup(
  page: WebsitePagePlan,
  siteName: string | undefined,
  detail: string,
  content: WebsitePageContent | undefined,
): string {
  const contentState = !content || content.missing
    ? 'content missing'
    : content.placeholders.length > 0
      ? `${content.placeholders.length} content gap${content.placeholders.length === 1 ? '' : 's'}`
      : `${content.status} content`;
  return `<header class="wf-banner">
    <div>
      <p class="wf-eyebrow">${escapeHtml(siteName ?? 'UI Studio')} · live design preview</p>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="wf-slug">${escapeHtml(normalizeSlug(page.slug))} · ${escapeHtml(detail)} · ${escapeHtml(contentState)}</p>
    </div>
    <p class="wf-note">${content && !content.missing
      ? 'A deterministic draft of the current layout, UI tokens, and exact Markdown copy. No model call is involved.'
      : 'Structure only. Every block below is a placeholder — nothing here is real content.'}</p>
  </header>`;
}

interface ShellOptions {
  title: string;
  designSystem: WebsiteDesignSystem;
  banner: string;
  body: string;
  tokens?: readonly UiDesignToken[];
}

/**
 * The document.
 *
 * Inline CSS and static markup only, because the preview server sends
 * `default-src 'none'` with no script — widening that policy so a *wireframe*
 * could render would weaken every generated page served alongside it.
 */
function renderShell(options: ShellOptions): string {
  const tokens = options.tokens ?? [];
  const accent = colourToken(tokens, 'color-primary', safeColour(options.designSystem.primaryColor, '#2563eb'));
  const secondary = colourToken(tokens, 'color-secondary', safeColour(options.designSystem.secondaryColor, '#0f172a'));
  const highlight = colourToken(tokens, 'color-accent', safeColour(options.designSystem.accentColor, '#14b8a6'));
  const headingFont = fontToken(tokens, 'font-heading', safeFontFamily(options.designSystem.headingFont, 'ui-sans-serif, system-ui, sans-serif'));
  const bodyFont = fontToken(tokens, 'font-body', safeFontFamily(options.designSystem.bodyFont, 'ui-sans-serif, system-ui, sans-serif'));
  const spacing = numericToken(tokens, 'spacing-base', 12);
  const radius = numericToken(tokens, 'radius-base', 8);
  const tokenDeclarations = renderTokenDeclarations(tokens);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title)}</title>
<style>
  :root { --accent: ${accent}; --highlight: ${highlight}; --ink: ${secondary}; --line: rgba(15, 23, 42, .28); --heading-font: ${headingFont}; --body-font: ${bodyFont}; --atlas-spacing-base: ${spacing}px; --atlas-radius-base: ${radius}px; ${tokenDeclarations} }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 0 48px;
    font: 15px/1.5 var(--body-font);
    color: var(--ink); background: #f6f7f9;
  }
  .wf-banner {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; flex-wrap: wrap;
    padding: 20px 24px; background: #fff; border-bottom: 2px solid var(--accent);
  }
  .wf-banner h1 { margin: 2px 0; font-size: 1.35rem; }
  h1, h2, h3, h4, .wf-tag { font-family: var(--heading-font); }
  .wf-eyebrow { margin: 0; font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; opacity: .6; font-weight: 700; }
  .wf-slug { margin: 0; font-size: .8rem; opacity: .65; font-family: ui-monospace, monospace; }
  .wf-note { margin: 0; font-size: .78rem; opacity: .7; max-width: 34ch; text-align: right; }

  .wf-stage {
    position: relative; width: min(1100px, calc(100% - 32px)); margin: 24px auto 0;
    background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
  }

  .wf-block {
    position: absolute; overflow: hidden; padding: 10px 12px;
    border: 1.5px dashed var(--line); border-radius: var(--atlas-radius-base);
    background-color: rgba(148, 163, 184, .10);
    background-image: repeating-linear-gradient(135deg,
      rgba(148, 163, 184, .16) 0 8px, transparent 8px 16px);
  }
  .wf-block[data-atlas-preview-selected] {
    outline: 3px solid var(--accent); outline-offset: 3px; border-style: solid;
  }
  .wf-tag {
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
    font-size: .8rem; font-weight: 700; color: var(--ink);
  }
  .wf-tag span {
    font-size: .62rem; font-weight: 600; letter-spacing: .09em; text-transform: uppercase;
    opacity: .55; border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px;
  }
  .wf-component-tag { display:inline-block; margin-left:6px; padding:2px 5px; border-radius:999px; color:var(--accent); background:color-mix(in srgb, var(--accent) 10%, transparent); font-size:.62rem; }
  .wf-content-state { display:inline-block; padding:2px 5px; border-radius:999px; font-size:.62rem; }
  .wf-content-state.placeholder { color:#9a3412; background:#ffedd5; }
  .wf-content-state.draft { color:#854d0e; background:#fef9c3; }
  .wf-content-state.reviewed { color:#1d4ed8; background:#dbeafe; }
  .wf-content-state.approved { color:#166534; background:#dcfce7; }
  .wf-data-tag { display:inline-block; padding:2px 5px; border-radius:999px; font-size:.62rem; color:#5b21b6; background:#ede9fe; }
  .wf-state-presentation { display:grid; gap:7px; margin-top:10px; }
  .wf-state-presentation p { margin:0; font-size:.82rem; }
  .wf-bound-content { display:grid; gap:7px; margin-top:10px; }
  .wf-bound-content p { margin:0; font-size:.82rem; }
  .wf-block[data-component-state="disabled"] { opacity:.5; filter:grayscale(.45); }
  .wf-block[data-component-state="loading"] { border-style:dotted; }
  .wf-block[data-component-state="error"], .wf-block[data-component-state="validation"] { border-color:#b42318; }
  .wf-block[data-component-state="success"] { border-color:#16803c; }

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

  .wf-real-content { margin-top: 8px; max-height: calc(100% - 28px); overflow: hidden; }
  .wf-real-content h1, .wf-real-content h2, .wf-real-content h3 { margin: 0 0 6px; line-height: 1.15; }
  .wf-real-content h1 { font-size: clamp(1.1rem, 2.4vw, 2.2rem); }
  .wf-real-content h2 { font-size: clamp(1rem, 1.8vw, 1.55rem); }
  .wf-real-content h3 { font-size: 1rem; }
  .wf-real-content p, .wf-real-content ul, .wf-real-content ol { margin: 5px 0; }
  .wf-real-content .content-gap, .content-proof .content-gap {
    display: inline-block; padding: 2px 6px; border: 1px dashed #b45309; border-radius: 4px;
    color: #92400e; background: #fffbeb; font-weight: 700;
  }

  .content-proof {
    width: min(920px, calc(100% - 32px)); margin: 24px auto 0; padding: clamp(20px, 4vw, 44px);
    border: 1px solid var(--line); border-top: 4px solid var(--highlight); border-radius: 10px; background: #fff;
  }
  .content-proof > header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; flex-wrap: wrap; margin-bottom: 24px; }
  .content-proof > header h2 { margin: 0; font-size: 1.35rem; }
  .content-proof > header p { margin: 0; opacity: .62; font-size: .78rem; }
  .content-copy { max-width: 72ch; }
  .content-copy h1 { font-size: clamp(2rem, 5vw, 4rem); line-height: 1.05; margin: 0 0 24px; }
  .content-copy h2 { font-size: clamp(1.45rem, 3vw, 2.25rem); margin: 36px 0 12px; }
  .content-copy h3 { font-size: 1.2rem; margin: 28px 0 10px; }
  .content-copy p, .content-copy li { font-size: 1.02rem; line-height: 1.7; }
  .content-copy blockquote { margin: 20px 0; padding-left: 18px; border-left: 3px solid var(--highlight); opacity: .82; }
  .content-missing { margin: 0; padding: 20px; border: 1px dashed var(--line); border-radius: 8px; opacity: .72; }

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
  options: WireframeIndexOptions = {},
): string {
  const rows = pages.length === 0
    ? '<p>No pages yet. Add one on the Sitemap tab.</p>'
    : `<ul class="wf-index">${pages.map(page => {
        const drawn = page.wireframe?.elements.length ?? 0;
        const content = options.contents?.get(page.id);
        const contentState = !content || content.missing
          ? 'content missing'
          : content.placeholders.length > 0
            ? `${content.placeholders.length} gap${content.placeholders.length === 1 ? '' : 's'}`
            : content.status;
        return `<li>
          <a href="${escapeHtml(previewPathFromIndex(page))}">${escapeHtml(page.title)}</a>
          <span>${escapeHtml(normalizeSlug(page.slug))}</span>
          <em>${drawn === 0 ? 'not drawn yet' : `${drawn} element${drawn === 1 ? '' : 's'}`} · ${escapeHtml(contentState)}</em>
        </li>`;
      }).join('')}</ul>`;

  const generated = options.generatedAvailable
    ? '<p class="wf-generated"><a href="../index.html">Open the generated visual guide</a><span>Model-authored output, kept separate from the live Studio draft.</span></p>'
    : '';

  return renderShell({
    title: `${siteName ?? 'UI'} — design previews`,
    designSystem,
    tokens: options.tokens,
    banner: `<header class="wf-banner">
      <div>
        <p class="wf-eyebrow">${escapeHtml(siteName ?? 'UI Studio')}</p>
        <h1>Live design previews</h1>
        <p class="wf-slug">${pages.length} page${pages.length === 1 ? '' : 's'}</p>
      </div>
      <p class="wf-note">Rendered directly from structure, UI tokens, and Markdown content. Refresh after a Studio edit; no model run is required.</p>
    </header>`,
    body: `<div class="wf-empty">${generated}${rows}
      <style>
        .wf-index { list-style: none; margin: 0; padding: 0; }
        .wf-index li { display: flex; align-items: baseline; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
        .wf-index a { font-weight: 700; color: var(--accent); }
        .wf-index span { font-family: ui-monospace, monospace; font-size: .78rem; opacity: .6; }
        .wf-index em { margin-left: auto; font-size: .75rem; opacity: .6; font-style: normal; }
        .wf-generated { display:grid; gap:3px; margin:0 0 20px; padding:12px; border:1px solid var(--line); border-radius:8px; }
        .wf-generated a { color:var(--accent); font-weight:700; }
        .wf-generated span { font-size:.76rem; opacity:.65; }
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
  // `index.html` belongs to the screen inventory. Giving the root page that
  // same name made the page loop overwrite the entry point after it was
  // written, so the preview silently stopped being an index at all.
  const name = slug === '/' ? 'home' : slug.slice(1).replace(/\//g, '-');
  return `_wireframe/${name}.html`;
}

/** The wireframe index's own path, for the same reason. */
export const WIREFRAME_INDEX_PATH = '_wireframe/index.html';

/** Links inside the index are relative to `_wireframe/`, not the preview root. */
function previewPathFromIndex(page: WebsitePagePlan): string {
  return previewPathFor(page).slice('_wireframe/'.length);
}

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

function safeFontFamily(value: string, fallback: string): string {
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 120 || !/^[A-Za-z0-9 ,_'"-]+$/.test(candidate)) {
    return fallback;
  }
  return candidate;
}

function resolvedToken(tokens: readonly UiDesignToken[], id: string) {
  return resolveUiDesignToken(tokens, id)?.value;
}

function colourToken(tokens: readonly UiDesignToken[], id: string, fallback: string): string {
  const value = resolvedToken(tokens, id);
  return typeof value === 'string' ? safeColour(value, fallback) : fallback;
}

function fontToken(tokens: readonly UiDesignToken[], id: string, fallback: string): string {
  const value = resolvedToken(tokens, id);
  return typeof value === 'string' ? safeFontFamily(value, fallback) : fallback;
}

function numericToken(tokens: readonly UiDesignToken[], id: string, fallback: number): number {
  const value = resolvedToken(tokens, id);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function renderTokenDeclarations(tokens: readonly UiDesignToken[]): string {
  return tokens.flatMap(token => {
    const resolved = resolveUiDesignToken(tokens, token.id);
    if (!resolved) { return []; }
    const name = token.id.split('').map(character => character.codePointAt(0)!.toString(16)).join('-');
    const value = resolved.value;
    if (typeof value === 'string') {
      const safe = token.kind === 'color'
        ? safeColour(value, '#000000')
        : safeFontFamily(value, 'ui-sans-serif, system-ui, sans-serif');
      return [`--atlas-token-${name}: ${safe};`];
    }
    if (typeof value === 'number') {
      const unit = token.kind === 'font-weight' || token.kind === 'line-height' ? '' : 'px';
      return [`--atlas-token-${name}: ${value}${unit};`];
    }
    if ('durationMs' in value) {
      return [
        `--atlas-token-${name}-duration: ${value.durationMs}ms;`,
        `--atlas-token-${name}-easing: ${value.easing};`,
      ];
    }
    return [`--atlas-token-${name}: ${value.x}px ${value.y}px ${value.blur}px ${value.spread}px ${value.color};`];
  }).join(' ');
}

function splitContentSections(body: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^#{1,4}\s+/.test(line) && current.some(item => item.trim().length > 0)) {
      sections.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.some(item => item.trim().length > 0)) {
    sections.push(current.join('\n').trim());
  }
  return sections;
}

function renderContentProof(content: WebsitePageContent | undefined): string {
  if (!content || content.missing || content.body.trim().length === 0) {
    return `<section class="content-proof"><header><h2>Content proof</h2><p>Exact copy, not generated copy</p></header>
      <p class="content-missing">No Markdown content exists for this screen yet. Create it in UI Studio → Content design; gaps remain explicit until then.</p></section>`;
  }
  return `<section class="content-proof"><header><h2>Content proof</h2><p>${escapeHtml(content.status)} · ${content.placeholders.length} unresolved gap${content.placeholders.length === 1 ? '' : 's'}</p></header>
    <article class="content-copy">${renderMarkdownPreview(content.body)}</article></section>`;
}

/** Render a deliberately small, inert Markdown subset. All input is escaped first. */
function renderMarkdownPreview(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let list: 'ul' | 'ol' | undefined;
  const closeList = () => {
    if (list) {
      output.push(`</${list}>`);
      list = undefined;
    }
  };

  for (const raw of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(raw);
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(raw);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1]!.length);
      output.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
    } else if (unordered || ordered) {
      const next = unordered ? 'ul' : 'ol';
      if (list !== next) {
        closeList();
        list = next;
        output.push(`<${next}>`);
      }
      output.push(`<li>${renderInline((unordered?.[1] ?? ordered?.[1]) ?? '')}</li>`);
    } else if (/^\s*>\s?/.test(raw)) {
      closeList();
      output.push(`<blockquote>${renderInline(raw.replace(/^\s*>\s?/, ''))}</blockquote>`);
    } else if (raw.trim().length === 0) {
      closeList();
    } else {
      closeList();
      output.push(`<p>${renderInline(raw)}</p>`);
    }
  }
  closeList();
  return output.join('\n');
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\[PLACEHOLDER:\s*([^\]]*)\]/gi, '<span class="content-gap">Gap: $1</span>');
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
