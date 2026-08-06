/**
 * Content and review feedback on disk.
 *
 * Two stores with one rule between them: **the file wins.** Markdown under
 * `content/` is the source of truth for copy, and the Studio shows a mirror of
 * it. A copywriter editing `content/about.md` in their own editor — or a client
 * being sent one — must never lose that work to a webview holding an older copy.
 * So every save re-reads before writing, and a file that changed underneath is
 * refused rather than overwritten.
 *
 * The review record is ordinary SSOT: JSON plus a markdown mirror, the shape
 * every other register in this codebase uses.
 *
 * `fs`-only; no `vscode`. Unit-tested against a temporary directory.
 */

import * as path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { WebsitePagePlan } from '../types.js';
import {
  DEFAULT_CONTENT_DIRECTORY,
  buildContentReport,
  contentPathFor,
  parsePageContent,
  renderPageContent,
  sanitizeContentDirectory,
  seedPageContent,
  type ContentReport,
  type WebsitePageContent,
} from './websiteContent.js';
import {
  WEBSITE_REVIEW_SSOT_PATH,
  WEBSITE_REVIEW_SUMMARY_SSOT_PATH,
  emptyReviewRecord,
  renderReviewMarkdown,
  sanitizeReviewRecord,
  summarizeReview,
  type WebsiteReviewRecord,
} from './websiteReviewComments.js';

/** Deepest folder nesting scanned for stray content files. */
const MAX_SCAN_DEPTH = 6;
const MAX_SCANNED_FILES = 500;

export class WebsiteContentManager {
  private readonly directory: string;

  constructor(
    private readonly workspaceRoot: string | undefined,
    directory: unknown = DEFAULT_CONTENT_DIRECTORY,
  ) {
    this.directory = sanitizeContentDirectory(directory);
  }

  get contentDirectory(): string {
    return this.directory;
  }

  /**
   * Read every page's content.
   *
   * A page with no file gets a `missing` record rather than being skipped —
   * "nobody has written this yet" is the single most useful thing the Content
   * page can tell you, and omitting the row would hide it.
   */
  read(pages: readonly WebsitePagePlan[]): Map<string, WebsitePageContent> {
    const byPageId = new Map<string, WebsitePageContent>();
    for (const page of pages) {
      byPageId.set(page.id, parsePageContent(page, this.readRaw(contentPathFor(page, this.directory)), this.directory));
    }
    return byPageId;
  }

  report(pages: readonly WebsitePagePlan[]): ContentReport {
    return buildContentReport(pages, this.read(pages), this.listContentFiles(), this.directory);
  }

  /**
   * Write a page's content.
   *
   * `expectedOnDisk` is the body the caller last saw. If the file has changed
   * since, the write is **refused** rather than resolved — merging two versions
   * of somebody's prose automatically would produce a document neither of them
   * wrote, and the Studio can simply reload.
   */
  async save(
    page: WebsitePagePlan,
    content: WebsitePageContent,
    expectedOnDisk?: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.workspaceRoot) {
      return { ok: false, reason: 'Open a workspace folder before saving content.' };
    }
    const relative = contentPathFor(page, this.directory);
    const absolute = path.join(this.workspaceRoot, relative);

    if (expectedOnDisk !== undefined) {
      const current = this.readRaw(relative);
      const currentBody = current === undefined ? undefined : parsePageContent(page, current, this.directory).body;
      if (currentBody !== undefined && currentBody !== expectedOnDisk) {
        return {
          ok: false,
          reason: `${relative} changed on disk since you opened it. Reload the Content page — the file is the source of truth, and overwriting it would lose whoever edited it.`,
        };
      }
    }

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, renderPageContent(content), 'utf8');
    return { ok: true };
  }

  /**
   * Create a starter file for a page that has none.
   *
   * Create-only: an existing file is reported untouched. The seed is entirely
   * placeholders — see `seedPageContent` for why nothing plausible is written.
   */
  async seed(page: WebsitePagePlan): Promise<'written' | 'exists' | 'no-workspace'> {
    if (!this.workspaceRoot) {
      return 'no-workspace';
    }
    const relative = contentPathFor(page, this.directory);
    const absolute = path.join(this.workspaceRoot, relative);
    if (existsSync(absolute)) {
      return 'exists';
    }
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, renderPageContent(seedPageContent(page, this.directory)), 'utf8');
    return 'written';
  }

  /** Every markdown file under the content directory, workspace-relative. */
  listContentFiles(): string[] {
    if (!this.workspaceRoot) {
      return [];
    }
    const base = path.join(this.workspaceRoot, this.directory);
    if (!existsSync(base)) {
      return [];
    }

    const found: string[] = [];
    const walk = (absolute: string, relative: string, depth: number): void => {
      if (depth > MAX_SCAN_DEPTH || found.length >= MAX_SCANNED_FILES) {
        return;
      }
      let entries: string[];
      try {
        entries = readdirSync(absolute);
      } catch {
        return;
      }
      for (const entry of entries.sort()) {
        if (found.length >= MAX_SCANNED_FILES) {
          return;
        }
        const childAbsolute = path.join(absolute, entry);
        const childRelative = relative ? `${relative}/${entry}` : entry;
        let stats;
        try {
          stats = statSync(childAbsolute);
        } catch {
          continue;
        }
        if (stats.isDirectory()) {
          walk(childAbsolute, childRelative, depth + 1);
        } else if (entry.toLowerCase().endsWith('.md')) {
          found.push(`${this.directory}/${childRelative}`);
        }
      }
    };
    walk(base, '', 0);
    return found;
  }

  private readRaw(relative: string): string | undefined {
    if (!this.workspaceRoot) {
      return undefined;
    }
    try {
      return readFileSync(path.join(this.workspaceRoot, relative), 'utf8');
    } catch {
      // Absent or unreadable. Both mean "no content", and the caller
      // distinguishes that from an empty file by the `missing` flag.
      return undefined;
    }
  }
}

// ── Review record ────────────────────────────────────────────────

export class WebsiteReviewManager {
  constructor(private readonly workspaceRoot: string | undefined) {}

  load(): WebsiteReviewRecord {
    if (!this.workspaceRoot) {
      return emptyReviewRecord();
    }
    try {
      const raw = readFileSync(path.join(this.workspaceRoot, WEBSITE_REVIEW_SSOT_PATH), 'utf8');
      return sanitizeReviewRecord(JSON.parse(raw) as unknown);
    } catch {
      return emptyReviewRecord();
    }
  }

  /**
   * Persist the record and regenerate the markdown mirror.
   *
   * The mirror is written from the *reconciled* summary, so an orphaned comment
   * shows as orphaned in the pull request too rather than only on screen.
   */
  async save(record: WebsiteReviewRecord, pages: readonly WebsitePagePlan[]): Promise<WebsiteReviewRecord> {
    if (!this.workspaceRoot) {
      throw new Error('Open a workspace folder before saving review feedback.');
    }
    const clean = sanitizeReviewRecord(record);
    const jsonPath = path.join(this.workspaceRoot, WEBSITE_REVIEW_SSOT_PATH);
    const markdownPath = path.join(this.workspaceRoot, WEBSITE_REVIEW_SUMMARY_SSOT_PATH);

    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
    await writeFile(markdownPath, renderReviewMarkdown(summarizeReview(clean, { pages }), clean), 'utf8');
    return clean;
  }
}
