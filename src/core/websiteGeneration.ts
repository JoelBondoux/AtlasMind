/**
 * What pressing **Generate** produces — decided here, before any model runs.
 *
 * Generate can be pressed from four places: the brief, the sitemap, a page's
 * wireframe, or a single selected element. Each knows a different amount, and
 * the honest thing is to say so rather than to produce the same output from all
 * four and let the reader assume the geometry was honoured when there was no
 * geometry to honour.
 *
 * Five rules.
 *
 * **The file list is deterministic and no model chooses it.** Same workspace and
 * same stage produce a byte-identical plan. That is what makes the confirmation
 * dialog worth reading: a list a model composed would differ on every press, so
 * nobody could learn what "yes" means. The model writes file *contents*; it
 * never decides file *paths*.
 *
 * **A path that does not validate refuses the whole plan.** Not sanitized, not
 * skipped — refused, with the reason. The same rule `lensEndpoints` applies to a
 * credential-shaped key: quietly cleaning a bad path leaves whoever wrote it
 * believing something else happened, and here the something else is a write.
 *
 * **Everything lands under the preview root.** Generated markup is model output.
 * It goes to `.atlasmind/website-preview/`, never into the project's source
 * tree, and promoting it out of there is a separate, deliberate act.
 *
 * **What the stage could not cover is stated, not silently omitted.** Generating
 * from the brief cannot honour a layout nobody has drawn. Recording that in
 * `omitted` keeps a partial answer from being read as a whole one the next time
 * somebody opens the preview.
 *
 * **The prompt fences the workspace text.** Same boundary as
 * `websiteDesignPrompt`: labels and design prompts are model-writable, and this
 * path ends in files being written, so it is the one that least tolerates an
 * instruction smuggled through a page title.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { WebsitePagePlan, WebsiteWorkspaceConfig } from '../types.js';
import { buildScopedDesignPrompt } from './websiteDesignPrompt.js';
import { normalizeSlug } from './websiteSitemap.js';
import { buildSitemapTree, flattenSitemap } from './websiteSitemap.js';
import { orderedWireframeElements, wireframeKindSpec } from './websiteWireframe.js';
import { renderContentForPrompt, type WebsitePageContent } from './websiteContent.js';
import { reviewGenerationInstruction } from './websiteReviewBundle.js';

/** Where Generate was pressed. Ordered from least to most structural knowledge. */
export type WebsiteGenerationStage = 'brief' | 'sitemap' | 'wireframe' | 'element';

/** The directory every generated file lands in, relative to the workspace root. */
export const WEBSITE_PREVIEW_ROOT = '.atlasmind/website-preview';

/**
 * Extensions a generated file may carry.
 *
 * No `.js`. A generated page that can execute is a different security question
 * from one that cannot, and the preview server serves this directory over
 * localhost — static markup and styling are enough to see a design, and adding
 * script would mean deciding what model-authored JavaScript is allowed to do.
 */
export const GENERATED_FILE_EXTENSIONS: readonly string[] = ['.html', '.css', '.svg', '.txt'];

/** Hard ceiling regardless of settings — a runaway plan is a bug, not a big site. */
export const MAX_GENERATED_FILES = 120;

export interface PlannedFile {
  /** Path relative to the preview root. Always forward-slashed. */
  relativePath: string;
  /** What this file is for, shown in the confirmation dialog. */
  purpose: string;
}

export interface WebsiteGenerationPlan {
  stage: WebsiteGenerationStage;
  /** Human label for the confirmation dialog: "the Services page", "the whole site". */
  targetLabel: string;
  files: PlannedFile[];
  /** The prompt handed to the model. Workspace text inside it is fenced. */
  prompt: string;
  /**
   * What this stage could not account for. Rendered next to the result, so a
   * partial generation is never read as a complete one.
   */
  omitted: string[];
}

export type WebsiteGenerationPlanResult =
  | { ok: true; plan: WebsiteGenerationPlan }
  | { ok: false; reason: string };

export interface WebsiteGenerationRequest {
  config: WebsiteWorkspaceConfig;
  stage: WebsiteGenerationStage;
  pageId?: string;
  elementId?: string;
  /** Ceiling from settings, further clamped by `MAX_GENERATED_FILES`. */
  maxFiles?: number;
  /**
   * Real copy, by page id, read from `content/`.
   *
   * Supplied by the caller rather than read here, so this module stays pure.
   * A page with no entry gets the "mark everything as a placeholder"
   * instruction — which is the honest default, not a degraded one.
   */
  content?: ReadonlyMap<string, WebsitePageContent>;
  /**
   * `atlasmind.website.review.includeOverlayInBuild`. When on, generated pages
   * carry the data attributes the client review overlay needs.
   */
  reviewMode?: boolean;
}

// ── Planning ─────────────────────────────────────────────────────

export function planWebsiteGeneration(request: WebsiteGenerationRequest): WebsiteGenerationPlanResult {
  const { config, stage } = request;
  if (config.pages.length === 0 && stage !== 'brief') {
    return { ok: false, reason: 'There are no pages to generate. Add a page on the Sitemap tab first.' };
  }

  const draft = draftFor(request);
  if (!draft.ok) {
    return draft;
  }

  const limit = Math.min(
    MAX_GENERATED_FILES,
    typeof request.maxFiles === 'number' && Number.isFinite(request.maxFiles) && request.maxFiles > 0
      ? Math.floor(request.maxFiles)
      : MAX_GENERATED_FILES,
  );

  const plan = draft.plan;

  // Validate every path before anything is reported as plannable. A single bad
  // path refuses the plan rather than being dropped — see the module note.
  for (const file of plan.files) {
    const problem = validateGeneratedPath(file.relativePath);
    if (problem) {
      return { ok: false, reason: `Refusing to generate: ${problem} (${file.relativePath})` };
    }
  }

  const duplicate = firstDuplicatePath(plan.files);
  if (duplicate) {
    return { ok: false, reason: `Refusing to generate: two planned files share the path ${duplicate}. Give the pages distinct slugs.` };
  }

  if (plan.files.length > limit) {
    return {
      ok: false,
      reason: `This would write ${plan.files.length} files, over the limit of ${limit}. Raise atlasmind.website.generation.maxFiles or generate one page at a time.`,
    };
  }

  return { ok: true, plan };
}

function draftFor(request: WebsiteGenerationRequest): WebsiteGenerationPlanResult {
  switch (request.stage) {
    case 'brief':
      return planFromBrief(request.config, request);
    case 'sitemap':
      return planFromSitemap(request.config, request);
    case 'wireframe':
      return planFromWireframe(request.config, request.pageId, request);
    case 'element':
      return planFromElement(request.config, request.pageId, request.elementId, request);
    default:
      return { ok: false, reason: 'Unknown generation stage.' };
  }
}

/**
 * From the brief alone.
 *
 * One page, because that is all the brief supports. A brief describes a company
 * and an audience; it does not say how many pages the site has, and inventing
 * six would put structure into the preview that nobody chose and that the
 * sitemap would then contradict.
 */
function planFromBrief(config: WebsiteWorkspaceConfig, request: WebsiteGenerationRequest): WebsiteGenerationPlanResult {
  const prompt = buildGenerationPrompt(config, {
    heading: 'Generate a single-page visual concept for this site from the brief below.',
    scope: 'site',
    instruction: [
      'Produce one self-contained HTML page and one stylesheet that show the visual direction:',
      'a nav, a hero, two or three content bands, and a footer, using the design system given.',
      'This is a concept, not the finished site — no page has been planned in detail yet.',
    ].join(' '),
    ...(request.reviewMode ? { reviewMode: true } : {}),
  });

  return {
    ok: true,
    plan: {
      stage: 'brief',
      targetLabel: 'a concept page from the brief',
      files: [
        { relativePath: 'index.html', purpose: 'Single-page visual concept' },
        { relativePath: 'assets/site.css', purpose: 'Shared stylesheet from the design system' },
      ],
      prompt,
      omitted: [
        'No wireframe exists yet, so the layout is the model\'s proposal rather than yours.',
        config.pages.length > 0
          ? `The ${config.pages.length} planned pages are not generated at this stage — use Generate on the Sitemap tab for those.`
          : 'No pages have been planned yet.',
      ],
    },
  };
}

/**
 * From the sitemap: every page, driven by its natural-language design prompt.
 *
 * This is the stage that makes "build a whole site in early design form from the
 * sitemap alone" true — a page with a written prompt and no drawing still gets a
 * real page out of it.
 */
function planFromSitemap(config: WebsiteWorkspaceConfig, request: WebsiteGenerationRequest): WebsiteGenerationPlanResult {
  const tree = buildSitemapTree(config.pages);
  const ordered = flattenSitemap(tree).map(node => node.page);

  const files: PlannedFile[] = [
    { relativePath: 'assets/site.css', purpose: 'Shared stylesheet from the design system' },
  ];
  for (const page of ordered) {
    files.push({
      relativePath: pagePath(page),
      purpose: `${page.title} — ${page.purpose || 'no stated purpose'}`,
    });
  }

  const undrawn = ordered.filter(page => !page.wireframe || page.wireframe.elements.length === 0);
  const unprompted = ordered.filter(page => page.designPrompt.trim().length === 0);

  const prompt = buildGenerationPrompt(config, {
    heading: `Generate ${ordered.length} linked page${ordered.length === 1 ? '' : 's'} for this site.`,
    scope: 'site',
    instruction: [
      'Produce one HTML file per page listed below plus one shared stylesheet.',
      'Follow each page\'s own design prompt where it has one. Wire the navigation using the',
      'sitemap hierarchy and the recorded links so the pages actually reach each other.',
    ].join(' '),
    includeSitemap: true,
    contentPages: ordered,
    ...(request.content ? { content: request.content } : {}),
    ...(request.reviewMode ? { reviewMode: true } : {}),
  });

  return {
    ok: true,
    plan: {
      stage: 'sitemap',
      targetLabel: `all ${ordered.length} page${ordered.length === 1 ? '' : 's'}`,
      files,
      prompt,
      omitted: [
        ...(undrawn.length > 0
          ? [`${undrawn.length} page${undrawn.length === 1 ? ' has' : 's have'} no wireframe, so ${undrawn.length === 1 ? 'its' : 'their'} layout is the model's proposal: ${undrawn.map(page => page.title).join(', ')}.`]
          : []),
        ...(unprompted.length > 0
          ? [`${unprompted.length} page${unprompted.length === 1 ? ' has' : 's have'} no design prompt, so only the purpose field guided ${unprompted.length === 1 ? 'it' : 'them'}: ${unprompted.map(page => page.title).join(', ')}.`]
          : []),
      ],
    },
  };
}

/** From one page's drawn wireframe — the stage with the most structure to honour. */
function planFromWireframe(
  config: WebsiteWorkspaceConfig,
  pageId: string | undefined,
  request: WebsiteGenerationRequest,
): WebsiteGenerationPlanResult {
  const page = config.pages.find(candidate => candidate.id === pageId);
  if (!page) {
    return { ok: false, reason: 'That page is no longer in the sitemap.' };
  }

  const elements = page.wireframe ? orderedWireframeElements(page.wireframe) : [];
  const prompt = buildGenerationPrompt(config, {
    heading: `Generate the ${page.title} page from its wireframe.`,
    scope: 'page',
    pageId: page.id,
    instruction: [
      'The wireframe below is the layout the author drew. Honour the order, nesting, and',
      'relative widths of the boxes — the coordinates are canvas units on a 1000-wide grid,',
      'not pixels, so treat them as proportions. Produce one HTML file and update the shared',
      'stylesheet.',
    ].join(' '),
    contentPages: [page],
    ...(request.content ? { content: request.content } : {}),
    ...(request.reviewMode ? { reviewMode: true } : {}),
  });

  return {
    ok: true,
    plan: {
      stage: 'wireframe',
      targetLabel: `the ${page.title} page`,
      files: [
        { relativePath: pagePath(page), purpose: `${page.title} — generated from ${elements.length} drawn element${elements.length === 1 ? '' : 's'}` },
        { relativePath: 'assets/site.css', purpose: 'Shared stylesheet from the design system' },
      ],
      prompt,
      omitted: [
        ...(elements.length === 0
          ? ['This page has no drawn elements, so the layout is entirely the model\'s proposal.']
          : []),
        'Only this page is generated. Links to other pages will not resolve until those are generated too.',
      ],
    },
  };
}

/**
 * From one selected element.
 *
 * Rewrites the page that contains it rather than emitting a fragment. A fragment
 * cannot be previewed — there is nothing to open — and stitching one back into
 * an existing file would mean parsing model-authored HTML and splicing it, which
 * fails silently and badly. Regenerating the page is honest about what changed,
 * and `omitted` says so.
 */
function planFromElement(
  config: WebsiteWorkspaceConfig,
  pageId: string | undefined,
  elementId: string | undefined,
  request: WebsiteGenerationRequest,
): WebsiteGenerationPlanResult {
  const page = config.pages.find(candidate => candidate.id === pageId);
  if (!page) {
    return { ok: false, reason: 'That page is no longer in the sitemap.' };
  }
  const element = page.wireframe?.elements.find(candidate => candidate.id === elementId);
  if (!element) {
    return { ok: false, reason: 'That element is no longer on the canvas.' };
  }

  const spec = wireframeKindSpec(element.kind);
  const label = element.label || spec.label;
  const prompt = buildGenerationPrompt(config, {
    heading: `Regenerate the ${page.title} page, changing the "${label}" element.`,
    scope: 'element',
    pageId: page.id,
    elementId: element.id,
    instruction: [
      `Rewrite the whole page, but change only the "${label}" element and whatever must move`,
      'to accommodate it. Every other element keeps its current structure and styling.',
    ].join(' '),
    contentPages: [page],
    ...(request.content ? { content: request.content } : {}),
    ...(request.reviewMode ? { reviewMode: true } : {}),
  });

  return {
    ok: true,
    plan: {
      stage: 'element',
      targetLabel: `"${label}" on the ${page.title} page`,
      files: [
        { relativePath: pagePath(page), purpose: `${page.title} — regenerated around the "${label}" element` },
        { relativePath: 'assets/site.css', purpose: 'Shared stylesheet from the design system' },
      ],
      prompt,
      omitted: [
        `The whole ${page.title} page is rewritten, not just this element — hand-edits made to the generated file since the last run will be lost.`,
      ],
    },
  };
}

// ── Prompt ───────────────────────────────────────────────────────

interface GenerationPromptOptions {
  heading: string;
  scope: 'site' | 'page' | 'element';
  pageId?: string;
  elementId?: string;
  instruction: string;
  includeSitemap?: boolean;
  /** Pages whose real copy should be included, in order. */
  contentPages?: readonly WebsitePagePlan[];
  content?: ReadonlyMap<string, WebsitePageContent>;
  reviewMode?: boolean;
}

/**
 * Wrap `buildScopedDesignPrompt` with the rules specific to writing files.
 *
 * Reusing the scoped builder is deliberate: it already fences every
 * model-writable field, and a second prompt composer here would be the copy that
 * forgets to. This adds only what generation needs on top — the output contract
 * and the constraint that the result is static.
 */
function buildGenerationPrompt(config: WebsiteWorkspaceConfig, options: GenerationPromptOptions): string {
  const scoped = buildScopedDesignPrompt({
    scope: options.scope,
    config,
    ...(options.pageId ? { pageId: options.pageId } : {}),
    ...(options.elementId ? { elementId: options.elementId } : {}),
    instruction: options.instruction,
  });

  const sitemapBlock = options.includeSitemap ? renderSitemapBlock(config) : '';
  const contentBlock = renderContentBlock(options.contentPages ?? [], options.content);
  const reviewBlock = options.reviewMode
    ? (options.contentPages ?? []).map(page => reviewGenerationInstruction(page)).filter(Boolean).join('\n\n')
    : '';

  return [
    options.heading,
    '',
    scoped?.prompt ?? options.instruction,
    '',
    sitemapBlock,
    '',
    contentBlock,
    '',
    reviewBlock,
    '',
    '--- output contract ---',
    'Return each file in its own fenced code block, preceded by a line reading `FILE: <path>`',
    'using exactly the paths listed in the plan. Write complete files, not fragments or diffs.',
    'The result must be static: no <script> tags, no inline event handlers, no external requests,',
    'no CDN links, no web fonts. The page is served from a local sandbox with no network access.',
    'Meet the stated accessibility target: real landmarks, one h1, alt text, visible focus.',
    '',
    'ABOUT CONTENT YOU WERE NOT GIVEN:',
    'Where real copy, a real image or a real statistic was not supplied, you must leave a visible',
    'placeholder rather than inventing something plausible. Write the placeholder as',
    '`[PLACEHOLDER: what is needed here]` in the text, and style it so it is obviously unfinished',
    '(a dashed outline and a muted background). For an image, output a plain coloured block with',
    'its intended subject written on it — never a data-URI photograph and never a stock image.',
    'Do not write invented company names, testimonials, prices, client logos, or statistics.',
    'A page that looks finished but is full of fiction is worse than an obviously unfinished one,',
    'because somebody signs it off.',
    '--- end output contract ---',
  ].filter(line => line !== '').join('\n');
}

/**
 * The real copy for each page being generated.
 *
 * Given verbatim so the model uses the client's words rather than writing its
 * own, and fenced like everything else read out of the workspace. A page with no
 * content file says so explicitly — the instruction to mark every piece of copy
 * as a placeholder is the *point*, not a fallback, because a page of plausible
 * invented prose is the failure this whole path exists to prevent.
 */
function renderContentBlock(
  pages: readonly WebsitePagePlan[],
  content: ReadonlyMap<string, WebsitePageContent> | undefined,
): string {
  if (pages.length === 0) {
    return '';
  }
  const blocks = pages.map(page => [
    `### ${page.title} (${pagePath(page)})`,
    renderContentForPrompt(content?.get(page.id)),
  ].join('\n'));

  return [
    '--- page copy (untrusted) ---',
    'Use this text as the page\'s words. Do not rewrite it, do not improve it, and do not extend it.',
    ...blocks,
    '--- end page copy ---',
  ].join('\n\n');
}

function renderSitemapBlock(config: WebsiteWorkspaceConfig): string {
  const tree = buildSitemapTree(config.pages);
  const lines = flattenSitemap(tree).map(node => {
    const indent = '  '.repeat(node.depth);
    const page = node.page;
    const prompt = page.designPrompt.trim();
    return `${indent}- ${page.title} → ${pagePath(page)}${prompt ? ` — ${prompt}` : ''}`;
  });
  return [
    '--- sitemap and per-page design prompts (untrusted) ---',
    ...(lines.length > 0 ? lines : ['(no pages)']),
    '--- end sitemap ---',
  ].join('\n');
}

// ── Paths ────────────────────────────────────────────────────────

/**
 * The file a page becomes.
 *
 * `/` is `index.html`; `/services/seo` is `services/seo/index.html`, so the
 * preview server can serve the same addresses the real site will use and a link
 * written as `/services/seo` works in the preview without rewriting.
 */
export function pagePath(page: WebsitePagePlan): string {
  const slug = normalizeSlug(page.slug);
  if (slug === '/') {
    return 'index.html';
  }
  return `${slug.slice(1)}/index.html`;
}

/**
 * Everything a generated path must be, checked one reason at a time so the
 * refusal can name which rule it broke.
 *
 * Ordered root-cause first: an absolute path is a different mistake from a
 * traversal, and reporting the first thing that is wrong rather than the first
 * rule in the list is what makes the message actionable.
 */
export function validateGeneratedPath(relativePath: string): string | undefined {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return 'the path is empty';
  }
  if (relativePath.length > 200) {
    return 'the path is too long';
  }
  // Decode first: `%2e%2e%2f` is a traversal that passes a literal `..` check.
  // A path that cannot be decoded is refused rather than used as-is.
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return 'the path is not valid URI-encoded text';
  }
  const candidate = decoded.replace(/\\/g, '/');
  if (candidate !== relativePath) {
    return 'the path must be plain, forward-slashed, and unencoded';
  }
  if (candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) {
    return 'the path must be relative to the preview folder';
  }
  if (candidate.split('/').some(segment => segment === '..' || segment === '.')) {
    return 'the path must not navigate outside the preview folder';
  }
  if (/[\u0000-\u001f\u007f]/.test(candidate)) {
    return 'the path contains control characters';
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(candidate)) {
    return 'the path may only use letters, digits, dot, dash, underscore and slash';
  }
  if (candidate.includes('//')) {
    return 'the path contains an empty folder name';
  }
  const extension = candidate.slice(candidate.lastIndexOf('.')).toLowerCase();
  if (!candidate.includes('.') || !GENERATED_FILE_EXTENSIONS.includes(extension)) {
    return `only ${GENERATED_FILE_EXTENSIONS.join(', ')} files may be generated`;
  }
  return undefined;
}

function firstDuplicatePath(files: readonly PlannedFile[]): string | undefined {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.relativePath)) {
      return file.relativePath;
    }
    seen.add(file.relativePath);
  }
  return undefined;
}

// ── Reading the model's answer ───────────────────────────────────

export interface GeneratedFile {
  relativePath: string;
  contents: string;
}

export interface ParsedGeneration {
  files: GeneratedFile[];
  /** Paths the model returned that were not in the plan. Reported, never written. */
  rejected: { relativePath: string; reason: string }[];
}

const MAX_GENERATED_FILE_BYTES = 400_000;

/**
 * Read `FILE: <path>` blocks out of the model's reply.
 *
 * **A returned path is checked against the plan, not merely validated.** A model
 * that invents `admin/index.html` produces a perfectly valid path — the defence
 * is that it was not on the list the user approved. Anything unplanned is
 * reported in `rejected` rather than dropped, so the discrepancy is visible.
 */
export function parseGeneratedFiles(reply: string, plan: WebsiteGenerationPlan): ParsedGeneration {
  const planned = new Set(plan.files.map(file => file.relativePath));
  const files: GeneratedFile[] = [];
  const rejected: { relativePath: string; reason: string }[] = [];
  const seen = new Set<string>();

  const blockPattern = /^[ \t]*FILE:[ \t]*(\S+)[ \t]*\r?\n+```[^\n]*\r?\n([\s\S]*?)^```/gm;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(reply)) !== null) {
    const declaredPath = match[1]!.trim().replace(/^[`'"]|[`'"]$/g, '');
    const contents = match[2] ?? '';

    if (seen.has(declaredPath)) {
      rejected.push({ relativePath: declaredPath, reason: 'the same file was returned twice' });
      continue;
    }
    seen.add(declaredPath);

    const problem = validateGeneratedPath(declaredPath);
    if (problem) {
      rejected.push({ relativePath: declaredPath, reason: problem });
      continue;
    }
    if (!planned.has(declaredPath)) {
      rejected.push({ relativePath: declaredPath, reason: 'this file was not in the approved plan' });
      continue;
    }
    if (contents.length > MAX_GENERATED_FILE_BYTES) {
      rejected.push({ relativePath: declaredPath, reason: 'the file is larger than the generation limit' });
      continue;
    }
    files.push({ relativePath: declaredPath, contents });
  }

  return { files, rejected };
}
