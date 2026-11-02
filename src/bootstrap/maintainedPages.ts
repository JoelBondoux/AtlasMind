/**
 * Maintained Project Memory pages — the ones import must never overwrite.
 *
 * Project Memory holds two kinds of page. *Imported* pages are generated from
 * other files (README, manifest, docs) and carry an `<!-- atlasmind-import`
 * footer; they refresh when their sources change. *Maintained* pages are kept
 * current by hand, or by an agent in any tool, and are where a project records
 * the facts it wants to answer without reading code.
 *
 * A project names its maintained pages under `## Maintained Pages` in
 * `project_soul.md`. That list is the explicit claim; a page with no import
 * footer is the implicit one. Either is enough to stop import writing over it,
 * because an overwritten SSOT page is worse than a stale one — it looks current.
 *
 * Pure functions only, so the rules can be tested without a workspace.
 */

export const MAINTAINED_PAGES_HEADING = 'Maintained Pages';

/** The maintained product-facts page AtlasMind scaffolds for a new project. */
export const PRODUCT_FACTS_PATH = 'domain/product-facts.md';

/**
 * The contradictions log: where a disagreement between Project Memory, docs
 * and code is recorded when the agent that found it cannot settle it in the
 * same change. AtlasMind surfaces its open entries, so a contradiction is
 * resolved later rather than lost.
 */
export const CONTRADICTIONS_PATH = 'operations/contradictions.md';

/** The section a new project soul starts with. */
export function buildDefaultMaintainedPagesSection(): string {
  return [
    `## ${MAINTAINED_PAGES_HEADING}`,
    'Pages kept current by hand, or by an agent in any tool, in the same change as the facts they record.',
    'AtlasMind\'s import never overwrites a page listed here.',
    `- ${PRODUCT_FACTS_PATH} — what the product does, its limits, defaults, tiers and the decisions behind them`,
    `- ${CONTRADICTIONS_PATH} — open contradictions between Project Memory, docs and code, until resolved`,
  ].join('\n');
}

/** Starter content for the contradictions log. */
export function buildContradictionsStarter(): string {
  return [
    '# Contradictions',
    '',
    '> Maintained page. When Project Memory, the docs and the code disagree, and the agent that noticed cannot',
    '> settle it in the same change (out of scope, or unclear which side is right), it is recorded here so it',
    '> is resolved rather than lost. AtlasMind lists the open entries in `index/import-freshness.md`, at',
    '> start-up, and in its own chat context. Never record secrets here.',
    '',
    'One line per contradiction, newest first, in this shape:',
    '',
    '```',
    '- [ ] YYYY-MM-DD — what disagrees — `path/a` says X; `path/b` says Y — why it was not settled — found by (tool)',
    '- [x] YYYY-MM-DD — what disagreed — settled: which side was right, and what changed',
    '```',
    '',
    'Tick the box and move the line to Resolved once it is settled.',
    '',
    '## Open',
    '',
    '## Resolved',
    '',
  ].join('\n');
}

/**
 * The open entries in a contradictions log: unchecked `- [ ]` items, outside
 * fenced code and HTML comments, that are not under `## Resolved`. A ticked box is resolved
 * wherever it sits, so forgetting to move the line never keeps it open.
 */
export function parseOpenContradictions(content: string | undefined): string[] {
  if (!content) {
    return [];
  }
  const withoutComments = stripHtmlComments(content.replace(/^```[\s\S]*?^```/gm, ''));
  const open: string[] = [];
  let inResolved = false;
  for (const line of withoutComments.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading !== undefined) {
      inResolved = /^resolved$/i.test(heading);
      continue;
    }
    const item = /^\s*[-*]\s+\[ \]\s+(.+?)\s*$/.exec(line)?.[1];
    if (item && !inResolved) {
      open.push(item);
    }
  }
  return open;
}

/**
 * The project's own `## Maintained Pages` section, verbatim, or the default
 * when it has none. Used when AtlasMind rewrites a starter soul, so a list the
 * project has already written is carried over rather than replaced.
 */
export function buildMaintainedPagesSection(existingSoul: string | undefined): string {
  const section = extractMaintainedPagesSection(existingSoul);
  return section ?? buildDefaultMaintainedPagesSection();
}

function extractMaintainedPagesSection(soul: string | undefined): string | undefined {
  if (!soul) {
    return undefined;
  }
  const lines = soul.split(/\r?\n/);
  const start = lines.findIndex(line => isMaintainedPagesHeading(line));
  if (start < 0) {
    return undefined;
  }
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end] ?? '')) {
    end += 1;
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

function isMaintainedPagesHeading(line: string): boolean {
  return /^##\s+maintained pages\s*$/i.test(line.trim());
}

/**
 * The SSOT-relative paths listed under `## Maintained Pages`.
 *
 * Accepts the shapes a person actually writes: `- path — note`, `- \`path\``,
 * `- [title](path)`, and a path prefixed with the memory root. Anything that
 * escapes the memory root is ignored rather than trusted.
 */
export function parseMaintainedPages(soul: string | undefined, ssotRelPath = 'project_memory'): Set<string> {
  const pages = new Set<string>();
  const section = extractMaintainedPagesSection(soul);
  if (!section) {
    return pages;
  }
  const rootPrefix = `${normalizePath(ssotRelPath)}/`;
  for (const line of section.split('\n').slice(1)) {
    const item = /^\s*[-*]\s+(.+)$/.exec(line)?.[1];
    if (!item) {
      continue;
    }
    const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(item)?.[1];
    const token = link ?? item.trim().split(/\s+/)[0] ?? '';
    let candidate = normalizePath(token.replace(/^`|`$/g, ''));
    if (rootPrefix !== '/' && candidate.startsWith(rootPrefix)) {
      candidate = candidate.slice(rootPrefix.length);
    }
    if (isSafeMemoryPath(candidate)) {
      pages.add(candidate);
    }
  }
  return pages;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

function isSafeMemoryPath(candidate: string): boolean {
  return /\.[a-z0-9]+$/i.test(candidate)
    && !candidate.split('/').includes('..')
    && !/^[A-Za-z]:/.test(candidate)
    && !/[\u0000-\u001f`]/.test(candidate);
}

/** Starter content for the maintained product-facts page. */
export function buildProductFactsStarter(): string {
  return [
    '# Product Facts',
    '',
    '> Maintained page: the single source of truth for simple product facts. AtlasMind\'s import never',
    '> overwrites it. Any change, from any tool, that alters one of these facts updates this page in the',
    '> same change. If a question is not answered here, settle it in the code once and write the answer here.',
    '',
    '## What It Does',
    '_Not recorded yet._',
    '',
    '## Limits',
    '_Not recorded yet._',
    '',
    '## Defaults',
    '_Not recorded yet._',
    '',
    '## Tiers and Plans',
    '_Not recorded yet. Remove this section if the project has none._',
    '',
    '## Decisions',
    '_Not recorded yet. Newest first, with the date._',
    '',
  ].join('\n');
}

/**
 * Remove HTML comments, repeating until none remain, then drop any unmatched
 * opener: one pass over `<!<!---->--` would leave a fresh `<!--` behind.
 */
function stripHtmlComments(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(/<!--[\s\S]*?-->/g, '');
    if (next === current) {
      break;
    }
    current = next;
  }
  return current.replace(/<!--[\s\S]*$/, '');
}

/**
 * A one-line note when an imported page was generated from an older manifest
 * version than the one the project is at now. `undefined` when either version
 * is unknown or they match — no claim is better than a guessed one.
 */
export function describeVersionDrift(generatedFrom: string | undefined, current: string | undefined): string | undefined {
  if (!generatedFrom || !current || generatedFrom === current) {
    return undefined;
  }
  return `generated from version ${generatedFrom}; the manifest is now at ${current}`;
}
