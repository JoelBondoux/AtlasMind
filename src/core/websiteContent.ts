/**
 * The words on the page — kept in markdown files a copywriter can actually edit.
 *
 * Generated sites were full of invented copy. A client cannot review a site
 * whose words are fictional, so the review the whole Website Studio workflow
 * builds toward was being performed on something nobody could judge. Worse, a
 * page that *looks* finished gets signed off, and the fiction ships.
 *
 * Five rules carry this.
 *
 * **Invented copy must never look like approved copy.** `[PLACEHOLDER: …]` is a
 * first-class thing here — parsed, counted, and rendered visibly as a gap. A
 * page's readiness is "four placeholders remaining", a fact, rather than a
 * status somebody set. Generation is told to emit these markers instead of
 * plausible prose.
 *
 * **The file wins.** The Studio shows an editable mirror, but markdown on disk
 * is the source of truth. Somebody editing `content/about.md` in their own
 * editor must never lose that to a stale webview holding an older copy.
 *
 * **Missing is not empty.** A page with no content file has not been written
 * yet; a page with an empty file has been opened and left blank. They are
 * different facts and they stay different, the same way the preview server
 * keeps *unreachable* apart from *unassessed*.
 *
 * **Front-matter is bounded and sanitized** like every other untrusted input —
 * these files are hand-edited and may be written by a model.
 *
 * **The file path is derived from the slug, one way**, using the same
 * `normalizeSlug` the sitemap uses, so the content tree and the sitemap cannot
 * disagree about where a page lives. A file with no matching page is *reported*,
 * never deleted.
 *
 * Pure and `fs`-free — the caller supplies the file contents. Unit-tested.
 */

import type { WebsitePagePlan } from '../types.js';
import { normalizeSlug } from './websiteSitemap.js';

/** Where content lives by default, relative to the workspace root. */
export const DEFAULT_CONTENT_DIRECTORY = 'content';

/**
 * How far a page's copy has got.
 *
 * `approved` is deliberately a decision somebody records, not something derived
 * from the placeholder count reaching zero — a page can be complete and still
 * wrong, and only a person can say it is signed off.
 */
export type WebsiteContentStatus = 'draft' | 'review' | 'approved';

const CONTENT_STATUSES = new Set<WebsiteContentStatus>(['draft', 'review', 'approved']);

/** A gap somebody still has to fill, with what it is waiting for. */
export interface ContentPlaceholder {
  /** The text inside the marker: "two paragraphs on how the firm started". */
  need: string;
  /** 1-based line in the body, so the Studio can point at it. */
  line: number;
}

export interface WebsitePageContent {
  /** The page this belongs to, or undefined for an orphan file. */
  pageId?: string;
  /** Workspace-relative path of the markdown file. */
  filePath: string;
  title: string;
  metaDescription: string;
  status: WebsiteContentStatus;
  /** The markdown body, minus front-matter. */
  body: string;
  placeholders: ContentPlaceholder[];
  /**
   * True when no file exists. Distinct from a file that exists and is empty:
   * one has not been started, the other was started and left blank.
   */
  missing: boolean;
  /** Front-matter keys we did not recognise, preserved so a round trip loses nothing. */
  extraFrontMatter: Record<string, string>;
}

const MAX_BODY_LENGTH = 200_000;
const MAX_FIELD_LENGTH = 500;
const MAX_PLACEHOLDERS = 200;

/**
 * The placeholder marker.
 *
 * Deliberately loud and unlikely to occur in real copy. Case-insensitive so a
 * hurried `[placeholder: ...]` still counts — a marker that silently does not
 * match is worse than no marker, because the page then reads as finished.
 */
const PLACEHOLDER_PATTERN = /\[PLACEHOLDER:\s*([^\]]*)\]/gi;

// ── Paths ────────────────────────────────────────────────────────

/**
 * The content file a page maps to.
 *
 * `/` → `index.md`, `/services/seo` → `services/seo.md`. Derived from the slug
 * with the sitemap's own normalizer, so the two cannot drift.
 */
export function contentPathFor(page: WebsitePagePlan, directory = DEFAULT_CONTENT_DIRECTORY): string {
  const slug = normalizeSlug(page.slug);
  const name = slug === '/' ? 'index' : slug.slice(1);
  return `${directory}/${name}.md`;
}

/**
 * A content directory we are willing to read and write.
 *
 * Constrained rather than escaped: it comes from a setting, is joined onto the
 * workspace root, and a traversal here would let a setting redirect content
 * writes anywhere on disk.
 */
export function sanitizeContentDirectory(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_CONTENT_DIRECTORY;
  }
  const candidate = value.trim().replace(/\\/g, '/');

  // An absolute path is *refused*, not relativised. Turning `/etc` into
  // `<workspace>/etc` would silently reinterpret what somebody wrote — they
  // meant the filesystem root — and leave them believing content went somewhere
  // it did not. Refusing falls back to the default, which is at least a place
  // they can find.
  if (candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) {
    return DEFAULT_CONTENT_DIRECTORY;
  }

  const trimmed = candidate.replace(/\/+$/g, '');
  if (trimmed.length === 0 || trimmed.length > 100) {
    return DEFAULT_CONTENT_DIRECTORY;
  }
  if (trimmed.split('/').some(segment => segment === '..' || segment === '.' || segment.length === 0)) {
    return DEFAULT_CONTENT_DIRECTORY;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(trimmed) ? trimmed : DEFAULT_CONTENT_DIRECTORY;
}

// ── Reading ──────────────────────────────────────────────────────

/**
 * Parse one content file.
 *
 * `raw === undefined` means the file does not exist, which produces a `missing`
 * record rather than an empty one — the caller needs to be able to tell "nobody
 * has written this" from "somebody wrote nothing".
 */
export function parsePageContent(
  page: WebsitePagePlan,
  raw: string | undefined,
  directory = DEFAULT_CONTENT_DIRECTORY,
): WebsitePageContent {
  const filePath = contentPathFor(page, directory);

  if (raw === undefined) {
    return {
      pageId: page.id,
      filePath,
      title: page.title,
      metaDescription: '',
      status: 'draft',
      body: '',
      placeholders: [],
      missing: true,
      extraFrontMatter: {},
    };
  }

  const { frontMatter, body } = splitFrontMatter(raw);

  const known = new Set(['title', 'metadescription', 'status']);
  const extraFrontMatter: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontMatter)) {
    if (!known.has(key.toLowerCase())) {
      extraFrontMatter[key] = value;
    }
  }

  const cleanBody = clampText(body, MAX_BODY_LENGTH);

  return {
    pageId: page.id,
    filePath,
    // The page title is the fallback, not an invention: it is a fact the
    // sitemap already holds.
    title: clampText(frontMatter['title'] ?? '', MAX_FIELD_LENGTH) || page.title,
    metaDescription: clampText(frontMatter['metaDescription'] ?? '', MAX_FIELD_LENGTH),
    status: CONTENT_STATUSES.has(frontMatter['status'] as WebsiteContentStatus)
      ? frontMatter['status'] as WebsiteContentStatus
      : 'draft',
    body: cleanBody,
    placeholders: findPlaceholders(cleanBody),
    missing: false,
    extraFrontMatter,
  };
}

/**
 * Find every unfilled gap, with the line it is on.
 *
 * Counted rather than merely detected: "four placeholders remaining" is a fact
 * a person can act on, where "has placeholders" is a boolean nobody prioritises.
 */
export function findPlaceholders(body: string): ContentPlaceholder[] {
  const found: ContentPlaceholder[] = [];
  const lines = body.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_PATTERN.exec(line)) !== null) {
      if (found.length >= MAX_PLACEHOLDERS) {
        return found;
      }
      found.push({
        need: clampText(match[1] ?? '', MAX_FIELD_LENGTH) || 'unspecified',
        line: index + 1,
      });
    }
  }
  return found;
}

/**
 * Split YAML front-matter from the body.
 *
 * A deliberately small parser: `key: value` pairs only, no nesting, no lists, no
 * anchors. A full YAML parser is a dependency and an attack surface for four
 * fields, and anything it would understand that this does not is preserved
 * verbatim in `extraFrontMatter` rather than lost.
 */
export function splitFrontMatter(raw: string): { frontMatter: Record<string, string>; body: string } {
  const normalized = raw.replace(/^\uFEFF/, '');
  // The closing `---` is matched at a line start rather than after a mandatory
  // newline, so empty front-matter (`---\n---`) parses as empty front-matter.
  // Requiring a content line made that fall through and treat the whole file as
  // body, which then read as "this page has copy" when it has none.
  const match = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n)?([\s\S]*)$/m.exec(normalized);
  if (!match) {
    return { frontMatter: {}, body: normalized };
  }

  const frontMatter: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([A-Za-z][A-Za-z0-9_-]{0,60}):\s*(.*)$/.exec(line.trim());
    if (!pair) {
      continue;
    }
    let value = (pair[2] ?? '').trim();
    // Strip one layer of matching quotes; `metaDescription: ""` must read as
    // empty rather than as two quote characters.
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1);
    }
    frontMatter[pair[1]!] = value;
  }

  return { frontMatter, body: match[2] ?? '' };
}

// ── Writing ──────────────────────────────────────────────────────

/**
 * Serialize a content record back to markdown.
 *
 * Unknown front-matter keys are written back out, so a round trip through the
 * Studio never silently drops a field somebody's static-site generator depends
 * on. Values are quoted when they could otherwise be misread as YAML.
 */
export function renderPageContent(content: WebsitePageContent): string {
  const lines = ['---'];
  lines.push(`title: ${quoteIfNeeded(content.title)}`);
  lines.push(`metaDescription: ${quoteIfNeeded(content.metaDescription)}`);
  lines.push(`status: ${content.status}`);
  for (const [key, value] of Object.entries(content.extraFrontMatter)) {
    lines.push(`${key}: ${quoteIfNeeded(value)}`);
  }
  lines.push('---', '');
  lines.push(content.body.replace(/\s+$/, ''));
  return `${lines.join('\n')}\n`;
}

/**
 * A starter file for a page that has none.
 *
 * Every section is a **placeholder naming what is needed**, never draft prose.
 * Seeding plausible copy would be the exact failure this module exists to
 * prevent: it would read as somebody's work, and it would get signed off.
 */
export function seedPageContent(page: WebsitePagePlan, directory = DEFAULT_CONTENT_DIRECTORY): WebsitePageContent {
  const sections = page.wireframe?.elements.filter(element => !element.parentId) ?? [];
  const bodyLines: string[] = [];

  if (sections.length === 0) {
    bodyLines.push(`[PLACEHOLDER: the main copy for ${page.title}${page.purpose ? ` — ${page.purpose}` : ''}]`);
  } else {
    for (const element of sections) {
      bodyLines.push(`## ${element.label}`, '');
      bodyLines.push(`[PLACEHOLDER: copy for the ${element.label.toLowerCase()} section${
        element.designPrompt ? ` — ${element.designPrompt}` : ''}]`);
      bodyLines.push('');
    }
  }

  return {
    pageId: page.id,
    filePath: contentPathFor(page, directory),
    title: page.title,
    // Left empty rather than generated from the purpose: a meta description is
    // published text, and an invented one is invented text on a search result.
    metaDescription: '',
    status: 'draft',
    body: bodyLines.join('\n').trimEnd(),
    placeholders: [],
    missing: false,
    extraFrontMatter: {},
  };
}

// ── Readiness ────────────────────────────────────────────────────

export interface ContentReadiness {
  pageId: string;
  pageTitle: string;
  status: WebsiteContentStatus;
  /** True when no file exists at all. */
  missing: boolean;
  placeholderCount: number;
  /** True when the file exists, has a body, and no placeholders remain. */
  complete: boolean;
  /** A sentence for the Studio row. Never optimistic about a missing file. */
  summary: string;
}

export interface ContentReport {
  pages: ContentReadiness[];
  /** Files under the content directory that no page claims. Reported, never deleted. */
  orphanFiles: string[];
  /** One line for the page header. */
  summary: string;
}

/**
 * Summarize where the copy has got to.
 *
 * `complete` requires a file, a body, and no remaining placeholders — and is
 * still separate from `approved`, which only a person sets. A page can be
 * complete and wrong.
 */
export function buildContentReport(
  pages: readonly WebsitePagePlan[],
  contents: ReadonlyMap<string, WebsitePageContent>,
  knownFiles: readonly string[] = [],
  directory = DEFAULT_CONTENT_DIRECTORY,
): ContentReport {
  const claimed = new Set<string>();

  const rows = pages.map((page): ContentReadiness => {
    const content = contents.get(page.id);
    claimed.add(contentPathFor(page, directory));

    if (!content || content.missing) {
      return {
        pageId: page.id,
        pageTitle: page.title,
        status: 'draft',
        missing: true,
        placeholderCount: 0,
        complete: false,
        // Deliberately not "0 placeholders" — a missing file has no
        // placeholders and is the furthest thing from ready.
        summary: 'No content file yet.',
      };
    }

    const placeholderCount = content.placeholders.length;
    const hasBody = content.body.trim().length > 0;
    const complete = hasBody && placeholderCount === 0;

    return {
      pageId: page.id,
      pageTitle: page.title,
      status: content.status,
      missing: false,
      placeholderCount,
      complete,
      summary: !hasBody
        ? 'File exists but is empty.'
        : placeholderCount > 0
          ? `${placeholderCount} placeholder${placeholderCount === 1 ? '' : 's'} remaining.`
          : content.status === 'approved'
            ? 'Complete and approved.'
            : 'Complete, awaiting sign-off.',
    };
  });

  const orphanFiles = knownFiles.filter(file => !claimed.has(file));

  const missing = rows.filter(row => row.missing).length;
  const remaining = rows.reduce((total, row) => total + row.placeholderCount, 0);
  const summaryParts: string[] = [];
  if (missing > 0) {
    summaryParts.push(`${missing} page${missing === 1 ? '' : 's'} with no content file`);
  }
  if (remaining > 0) {
    summaryParts.push(`${remaining} placeholder${remaining === 1 ? '' : 's'} remaining`);
  }
  if (orphanFiles.length > 0) {
    summaryParts.push(`${orphanFiles.length} file${orphanFiles.length === 1 ? '' : 's'} with no matching page`);
  }

  return {
    pages: rows,
    orphanFiles,
    summary: summaryParts.length === 0
      ? (rows.length === 0 ? 'No pages yet.' : 'Every page has content with no placeholders left.')
      : summaryParts.join(', ') + '.',
  };
}

/**
 * The content block for a generation prompt.
 *
 * Real copy is given verbatim so the model uses it rather than writing its own.
 * Placeholders are passed through **as markers**, with an instruction to keep
 * them visible — the model must not helpfully fill them in, because that is
 * precisely how fiction gets into a page nobody realises is unfinished.
 */
export function renderContentForPrompt(content: WebsitePageContent | undefined): string {
  if (!content || content.missing) {
    return '(no content file for this page — every piece of copy on it is a placeholder you must mark as such)';
  }
  if (content.body.trim().length === 0) {
    return '(the content file for this page is empty — every piece of copy on it is a placeholder you must mark as such)';
  }
  const note = content.placeholders.length > 0
    ? `\n\nThis copy contains ${content.placeholders.length} [PLACEHOLDER: …] marker${
      content.placeholders.length === 1 ? '' : 's'}. Reproduce each one visibly in the page as an unfilled gap. Do not write copy to fill them.`
    : '';
  return `${content.body}${note}`;
}

// ── Helpers ──────────────────────────────────────────────────────

function quoteIfNeeded(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  return /^[A-Za-z0-9][A-Za-z0-9 ._,()'/-]*$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Clamp and strip control characters, keeping newlines and tabs.
 *
 * Markdown is line-structured, so unlike the wireframe's labels this must not
 * collapse whitespace — doing so would destroy every paragraph break in the
 * document.
 */
function clampText(value: string, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
    .slice(0, max);
}
