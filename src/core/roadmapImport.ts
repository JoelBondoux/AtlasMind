/**
 * Somebody else's roadmap, read into this one.
 *
 * AtlasMind's roadmap is `project_memory/roadmap/improvement-plan.md`, and until
 * now the only way into it was typing. That is fine for a project that started
 * here and useless for every project that did not: a team's plan already exists,
 * as a handful of markdown files under `docs/`, as a spreadsheet somebody
 * exported, as GitHub issues, or on a GitHub Project board. Asking them to
 * retype it is asking them not to use the canvas.
 *
 * Six rules, and every one of them is about not destroying a plan that already
 * works.
 *
 * **Import, never mirror.** `improvement-plan.md` stays the one file that says
 * what the work *is* — everything the canvas adds (links, deadlines, estimates,
 * assignees, positions) is keyed to durable ids in that file, and a second
 * source of truth would mean the graph overlay pointing at rows nobody owns.
 * So this copies in and records where each line came from; it does not leave
 * the source authoritative.
 *
 * **Re-runnable, and matched on a recorded key rather than on text.** An import
 * you can only do once is an import nobody dares do at all. Each item carries
 * `RoadmapImportRecord`, so a second run over the same source updates what
 * moved and adds what is new instead of producing a second copy of everything.
 * Text is the *fallback* key, used only for items with no record yet — which is
 * what stops a first import duplicating a backlog somebody already typed by
 * hand.
 *
 * **Nothing is deleted, ever.** An item the source no longer has is reported as
 * `missing` and left exactly where it is. The source may have dropped it, or
 * somebody may have renamed it, or the glob may have stopped matching a file —
 * three very different things that look identical from here, and deleting
 * somebody's roadmap line on the strength of that guess is not a trade worth
 * making. `debtRegister` refuses the same guess for the same reason.
 *
 * **A local edit is never overwritten; it is reported.** The normalized source
 * title is stored at import time, so "this line still says what the source said"
 * is answerable. When both sides have moved the item is a `conflict` carrying
 * both texts, and the import changes nothing about it. Silently taking either
 * side would be a lie in a committed file.
 *
 * **A plan is produced, and a plan is not a write.** `planRoadmapImport` returns
 * what would happen; the caller shows it and writes only on confirmation. No
 * function here touches a disk, a network or `vscode`.
 *
 * **Every source is untrusted text.** Markdown from a repository, a CSV
 * somebody exported, an issue title written by a stranger — all of it is
 * control-stripped, clamped, capped and counted, and nothing here throws. A
 * malformed source yields fewer items and a note saying so, never an exception
 * halfway through a plan.
 *
 * Pure + unit-tested. Reading files, calling `gh` and writing the roadmap all
 * live at the call site.
 */

// ── What a source is ──────────────────────────────────────────────────────

/**
 * Where a roadmap can be read from.
 *
 * Declared rather than open: each kind has a parser in this file that knows the
 * shape it produces, and an unrecognised kind is refused rather than guessed at.
 */
export type RoadmapImportSourceKind =
  | 'markdown'
  | 'github-issues'
  | 'github-project'
  | 'spreadsheet';

export const ROADMAP_IMPORT_SOURCES: readonly {
  kind: RoadmapImportSourceKind;
  label: string;
  /** What it reads, in the words somebody choosing between them would use. */
  detail: string;
  /** What the caller has to supply before this source can be read at all. */
  needs: string;
}[] = [
  {
    kind: 'markdown',
    label: 'Markdown files',
    detail: 'Checklists and bullet lists across one or more .md files, keeping the heading above each item as context.',
    needs: 'A file glob, relative to the workspace.',
  },
  {
    kind: 'github-issues',
    label: 'GitHub issues',
    detail: 'Open issues on this repository, with their labels and milestone as context. Each item links back to its issue.',
    needs: 'The issue list the dashboard already reads.',
  },
  {
    kind: 'github-project',
    label: 'GitHub Project',
    detail: 'Items on a Projects (v2) board, including the status column they sit in.',
    needs: 'A project number and its owner.',
  },
  {
    kind: 'spreadsheet',
    label: 'Spreadsheet export',
    detail: 'A CSV or TSV file, with you saying which column holds the title and which holds the status.',
    needs: 'A file path and a column mapping.',
  },
];

/** One item as some external system holds it, before anything is decided about it. */
export interface RoadmapImportItem {
  /**
   * A key that identifies this item *within its source*, stably.
   *
   * Content-derived where the source has no id of its own (markdown, most
   * spreadsheets), because a positional id breaks the moment somebody inserts a
   * line — and an import that renumbers on every edit reconciles against
   * nothing. Where the source has a real id (an issue number, a project item
   * id) that is used instead, so a rename is an update rather than a
   * disappearance.
   */
  sourceId: string;
  title: string;
  completed: boolean;
  /** The heading, label set, or status column this item sat under. Never invented. */
  context?: string;
  /** Where to go and look at it. `https` only; absent when the source has no address. */
  url?: string;
}

/** What a source produced, and what it could not. */
export interface RoadmapImportRead {
  kind: RoadmapImportSourceKind;
  /** A short description of what was read, for the confirmation. */
  sourceLabel: string;
  items: RoadmapImportItem[];
  /**
   * What was skipped, capped or unreadable. Never empty because nothing went
   * wrong — empty means nothing went wrong.
   */
  notes: string[];
}

/** The provenance stored on a roadmap node for an imported item. */
export interface RoadmapImportRecord {
  kind: RoadmapImportSourceKind;
  sourceId: string;
  /** Which glob, project or file this came from, so a re-import can be scoped. */
  sourceLabel: string;
  /**
   * The normalized source title as it stood when this was last imported.
   *
   * The whole conflict mechanism rests on this one field: without it, "the user
   * edited this line" and "the source changed" are indistinguishable, and an
   * importer that cannot tell them apart has to either overwrite edits or never
   * update anything.
   */
  importedTitleNormalized: string;
  importedAt?: string;
  url?: string;
}

// ── Limits ────────────────────────────────────────────────────────────────

/** Per import. A roadmap nobody can read is not a roadmap. */
export const MAX_IMPORT_ITEMS = 300;
/** Per source file, so one enormous file cannot crowd out the rest of a glob. */
const MAX_ITEMS_PER_FILE = 150;
const MAX_IMPORT_TITLE_CHARS = 300;
const MAX_IMPORT_CONTEXT_CHARS = 80;
/** Files per markdown glob. Beyond this the glob is too broad to be a roadmap. */
export const MAX_IMPORT_FILES = 40;

// ── Boundary handling ─────────────────────────────────────────────────────

/**
 * Untrusted text, made safe to put in a committed markdown file.
 *
 * Control characters are stripped rather than escaped, list markers and
 * checkboxes are removed from the *start* of the text, and the result is
 * clamped on a word boundary. A title carrying its own `- [ ]` would nest a
 * checkbox inside a checkbox and break the roadmap parser on the next read.
 */
export function sanitizeImportedTitle(value: unknown, limit = MAX_IMPORT_TITLE_CHARS): string {
  if (typeof value !== 'string') {
    return '';
  }
  let text = value
    // Unicode property escape rather than a literal range: a control-character
    // class written out longhand puts real control bytes in this source file.
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Repeatedly, because "- [ ] - [x] thing" is a real thing exports produce.
  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text.replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX~-]?\]\s*/, '').trim();
  }
  // A pipe would split a markdown table cell; a newline is already gone.
  text = text.replace(/\|/g, '│');
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** The same normalizer the roadmap uses to decide whether two lines are the same item. */
export function normalizeImportedTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sanitizeContext(value: unknown): string | undefined {
  const text = sanitizeImportedTitle(value, MAX_IMPORT_CONTEXT_CHARS);
  return text === '' ? undefined : text;
}

/**
 * A link worth offering.
 *
 * `https` only, and never `javascript:` or a `data:` payload however it is
 * spelled — this ends up as a clickable destination, and a source file is a
 * place a stranger's text can reach.
 */
function sanitizeImportedUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Content-derived, so it survives a reorder and honestly breaks on a rename. */
function contentSourceId(scope: string, title: string): string {
  return `${scope}::${normalizeImportedTitle(title)}`;
}

// ── Markdown ──────────────────────────────────────────────────────────────

/** Checkbox states that mean the work is finished. `~` and `-` are common in the wild. */
const DONE_CHECKBOX = /^\[[xX✓]\]/;

/**
 * Roadmap items out of arbitrary markdown.
 *
 * Two decisions worth stating, because both are inferences and both are visible
 * in the plan before anything is written — a wrong guess here costs a glance,
 * not a damaged file.
 *
 * **A file containing any checkbox is read as checkboxes only.** A roadmap file
 * that uses `- [ ]` for its items almost always uses plain bullets for the notes
 * around them, so taking every bullet would import the prose as work. A file
 * with no checkbox at all falls back to plain bullets, because that is the other
 * common shape and refusing it would leave the most ordinary roadmap unreadable.
 *
 * **The nearest heading above an item is kept as context, never merged into the
 * title.** "Q3" and "Authentication" say something about an item and are not
 * part of what it is; folding them in would produce titles that read as
 * headings and would break the text match on the next import.
 *
 * Fenced code blocks are skipped entirely: a snippet showing a markdown list is
 * documentation about lists, not a plan.
 */
export function parseMarkdownRoadmapItems(
  files: ReadonlyArray<{ path: string; content: string }>,
): RoadmapImportRead {
  const notes: string[] = [];
  const items: RoadmapImportItem[] = [];
  const seen = new Set<string>();

  const considered = files.slice(0, MAX_IMPORT_FILES);
  if (files.length > considered.length) {
    notes.push(`${files.length - considered.length} more file${files.length - considered.length === 1 ? '' : 's'} matched the glob and ${files.length - considered.length === 1 ? 'was' : 'were'} not read. Narrow it if the roadmap really is spread that widely.`);
  }

  for (const file of considered) {
    const lines = String(file.content ?? '').split(/\r?\n/);
    const hasCheckbox = lines.some(line => /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX✓~-]?\]/.test(line));
    let heading = '';
    let fenced = false;
    let fromFile = 0;

    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) {
        continue;
      }
      const headingMatch = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
      if (headingMatch) {
        heading = sanitizeContext(headingMatch[1]) ?? '';
        continue;
      }
      const listMatch = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (!listMatch) {
        continue;
      }
      const body = listMatch[1] ?? '';
      const checkbox = /^\[([ xX✓~-]?)\]\s*(.*)$/.exec(body);
      if (hasCheckbox && !checkbox) {
        continue;
      }
      const rawTitle = checkbox ? (checkbox[2] ?? '') : body;
      const title = sanitizeImportedTitle(rawTitle);
      if (title === '' || normalizeImportedTitle(title) === '') {
        continue;
      }
      if (fromFile >= MAX_ITEMS_PER_FILE) {
        notes.push(`${file.path} has more than ${MAX_ITEMS_PER_FILE} items; the rest were not read.`);
        break;
      }
      const sourceId = contentSourceId(file.path, title);
      if (seen.has(sourceId)) {
        continue;
      }
      seen.add(sourceId);
      fromFile += 1;
      items.push({
        sourceId,
        title,
        completed: checkbox ? DONE_CHECKBOX.test(`[${checkbox[1] ?? ''}]`) : false,
        ...(heading === '' ? {} : { context: heading }),
      });
    }
  }

  return finishRead('markdown', describeMarkdownScope(considered), items, notes);
}

function describeMarkdownScope(files: ReadonlyArray<{ path: string }>): string {
  if (files.length === 0) {
    return 'no matching files';
  }
  return files.length === 1
    ? String(files[0]?.path ?? '')
    : `${files.length} markdown files`;
}

// ── Spreadsheet ───────────────────────────────────────────────────────────

export interface SpreadsheetColumnMapping {
  /** Header name of the column holding the item text. Required — never guessed silently. */
  title: string;
  status?: string;
  /** Header of a stable id column, where the export has one. */
  id?: string;
  /** Values in the status column that mean finished. Compared case-insensitively. */
  doneValues?: readonly string[];
}

export const DEFAULT_DONE_VALUES: readonly string[] = ['done', 'complete', 'completed', 'shipped', 'closed', 'yes', 'true', '1', 'x'];

/** Header names that are almost certainly the item text, in preference order. */
const TITLE_HEADER_HINTS = ['title', 'item', 'task', 'name', 'summary', 'feature', 'work', 'description'];
const STATUS_HEADER_HINTS = ['status', 'state', 'done', 'complete', 'completed', 'progress'];

/**
 * Split one delimiter-separated line, honouring quotes.
 *
 * Hand-rolled rather than split-on-delimiter because a roadmap row is exactly
 * the kind of text that contains a comma, and "Fix login, then logout" arriving
 * as two items is a silent corruption nobody would look for.
 */
function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Whichever of tab or comma appears more often in the header. Ties go to comma. */
export function detectSpreadsheetDelimiter(text: string): string {
  const header = String(text ?? '').split(/\r?\n/)[0] ?? '';
  const tabs = (header.match(/\t/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

/**
 * The headers of a delimited file, so the caller can offer a real column list
 * rather than asking somebody to type a column name.
 */
export function readSpreadsheetHeaders(text: string): string[] {
  const delimiter = detectSpreadsheetDelimiter(text);
  const header = String(text ?? '').split(/\r?\n/)[0] ?? '';
  return splitDelimited(header, delimiter).map(cell => sanitizeImportedTitle(cell, 80)).filter(cell => cell !== '');
}

/**
 * A best guess at the mapping, offered as a *starting point* for the caller to
 * confirm — never applied on its own.
 *
 * Returns no title column rather than falling back to the first one. A
 * spreadsheet whose title column could not be identified is one where importing
 * the wrong column would fill a roadmap with dates or owner names, and that is
 * both useless and tedious to undo.
 */
export function suggestSpreadsheetMapping(headers: readonly string[]): Partial<SpreadsheetColumnMapping> {
  const find = (hints: readonly string[]): string | undefined => {
    for (const hint of hints) {
      const match = headers.find(header => normalizeImportedTitle(header) === hint);
      if (match !== undefined) {
        return match;
      }
    }
    return headers.find(header => hints.some(hint => normalizeImportedTitle(header).includes(hint)));
  };
  const title = find(TITLE_HEADER_HINTS);
  const status = find(STATUS_HEADER_HINTS);
  return {
    ...(title === undefined ? {} : { title }),
    ...(status === undefined || status === title ? {} : { status }),
  };
}

export function parseSpreadsheetRoadmapItems(
  text: string,
  mapping: SpreadsheetColumnMapping,
  sourceLabel = 'spreadsheet',
): RoadmapImportRead {
  const notes: string[] = [];
  const items: RoadmapImportItem[] = [];
  const seen = new Set<string>();

  const delimiter = detectSpreadsheetDelimiter(text);
  const lines = String(text ?? '').split(/\r?\n/).filter(line => line.trim() !== '');
  const headerLine = lines.shift();
  if (headerLine === undefined) {
    return finishRead('spreadsheet', sourceLabel, [], ['The file is empty.']);
  }
  const headers = splitDelimited(headerLine, delimiter).map(cell => sanitizeImportedTitle(cell, 80));
  const columnOf = (name: string | undefined): number =>
    name === undefined ? -1 : headers.findIndex(header => normalizeImportedTitle(header) === normalizeImportedTitle(name));

  const titleColumn = columnOf(mapping.title);
  if (titleColumn < 0) {
    // Refused rather than defaulted to column 0: importing the wrong column
    // fills a roadmap with dates or owner names.
    return finishRead('spreadsheet', sourceLabel, [], [
      `No column called “${sanitizeImportedTitle(mapping.title, 60)}” was found. Nothing was read. Columns present: ${headers.join(', ') || 'none'}.`,
    ]);
  }
  const statusColumn = columnOf(mapping.status);
  const idColumn = columnOf(mapping.id);
  const doneValues = new Set((mapping.doneValues ?? DEFAULT_DONE_VALUES).map(value => normalizeImportedTitle(String(value))));

  let skipped = 0;
  for (const line of lines) {
    const cells = splitDelimited(line, delimiter);
    const title = sanitizeImportedTitle(cells[titleColumn]);
    if (title === '' || normalizeImportedTitle(title) === '') {
      skipped += 1;
      continue;
    }
    if (items.length >= MAX_IMPORT_ITEMS) {
      notes.push(`Stopped after ${MAX_IMPORT_ITEMS} rows.`);
      break;
    }
    const status = statusColumn >= 0 ? sanitizeContext(cells[statusColumn]) : undefined;
    const declaredId = idColumn >= 0 ? sanitizeImportedTitle(cells[idColumn], 80) : '';
    const sourceId = declaredId !== '' ? `${sourceLabel}#${declaredId}` : contentSourceId(sourceLabel, title);
    if (seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    items.push({
      sourceId,
      title,
      completed: status !== undefined && doneValues.has(normalizeImportedTitle(status)),
      ...(status === undefined ? {} : { context: status }),
    });
  }
  if (skipped > 0) {
    notes.push(`${skipped} row${skipped === 1 ? '' : 's'} had nothing in the title column and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  }

  return finishRead('spreadsheet', sourceLabel, items, notes);
}

// ── GitHub ────────────────────────────────────────────────────────────────

/** The shape the dashboard's issue list already has. Only what is needed is read. */
export interface GithubIssueLike {
  number: number;
  title: string;
  state?: string;
  url?: string;
  labels?: readonly string[];
  milestone?: string;
}

/**
 * Issues as roadmap items.
 *
 * A closed issue is imported as *completed* rather than skipped: a roadmap that
 * silently omits finished work cannot show how you got here, which is the whole
 * argument for keeping completed prerequisites on the canvas.
 */
export function parseGithubIssueRoadmapItems(
  issues: readonly GithubIssueLike[],
  sourceLabel = 'GitHub issues',
): RoadmapImportRead {
  const notes: string[] = [];
  const items: RoadmapImportItem[] = [];
  const seen = new Set<string>();

  for (const issue of issues ?? []) {
    const number = Number(issue?.number);
    const title = sanitizeImportedTitle(issue?.title);
    if (!Number.isSafeInteger(number) || number <= 0 || title === '') {
      continue;
    }
    const sourceId = `issue#${number}`;
    if (seen.has(sourceId)) {
      continue;
    }
    if (items.length >= MAX_IMPORT_ITEMS) {
      notes.push(`Stopped after ${MAX_IMPORT_ITEMS} issues.`);
      break;
    }
    seen.add(sourceId);
    const context = sanitizeContext([
      ...(issue.milestone === undefined ? [] : [issue.milestone]),
      ...(issue.labels ?? []).slice(0, 4),
    ].join(', '));
    const url = sanitizeImportedUrl(issue.url);
    items.push({
      sourceId,
      title,
      completed: String(issue.state ?? '').toLowerCase() === 'closed',
      ...(context === undefined ? {} : { context }),
      ...(url === undefined ? {} : { url }),
    });
  }

  return finishRead('github-issues', sourceLabel, items, notes);
}

/**
 * `gh project item-list --format json`, read defensively.
 *
 * Every field is optional and the shape is checked rather than assumed: this is
 * a CLI whose JSON is not a stable contract, and a parser that threw on an
 * unexpected field would take the whole import down rather than one row.
 *
 * A status column is *context*, never a completion flag, with one exception —
 * the caller may declare which statuses mean done, because "Done" is a
 * convention and not a guarantee. Absent that declaration, nothing is imported
 * as completed: marking live work as finished is the more expensive mistake.
 */
export function parseGithubProjectRoadmapItems(
  raw: unknown,
  sourceLabel = 'GitHub Project',
  doneStatuses: readonly string[] = [],
): RoadmapImportRead {
  const notes: string[] = [];
  const items: RoadmapImportItem[] = [];
  const seen = new Set<string>();
  const done = new Set(doneStatuses.map(value => normalizeImportedTitle(String(value))));

  const container = raw as { items?: unknown } | null | undefined;
  const list = Array.isArray(container?.items)
    ? container.items
    : Array.isArray(raw) ? raw : undefined;
  if (list === undefined) {
    return finishRead('github-project', sourceLabel, [], ['The project listing could not be read as a list of items.']);
  }

  let unreadable = 0;
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) {
      unreadable += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const content = (typeof record['content'] === 'object' && record['content'] !== null
      ? record['content'] as Record<string, unknown>
      : {});
    const title = sanitizeImportedTitle(record['title'] ?? content['title']);
    if (title === '') {
      unreadable += 1;
      continue;
    }
    if (items.length >= MAX_IMPORT_ITEMS) {
      notes.push(`Stopped after ${MAX_IMPORT_ITEMS} board items.`);
      break;
    }
    const declaredId = sanitizeImportedTitle(record['id'], 80);
    const number = Number(content['number']);
    const sourceId = declaredId !== ''
      ? `project:${declaredId}`
      : Number.isSafeInteger(number) && number > 0
        ? `issue#${number}`
        : contentSourceId(sourceLabel, title);
    if (seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    const status = sanitizeContext(record['status']);
    const url = sanitizeImportedUrl(content['url'] ?? record['url']);
    items.push({
      sourceId,
      title,
      completed: status !== undefined && done.has(normalizeImportedTitle(status)),
      ...(status === undefined ? {} : { context: status }),
      ...(url === undefined ? {} : { url }),
    });
  }
  if (unreadable > 0) {
    notes.push(`${unreadable} board item${unreadable === 1 ? '' : 's'} had no readable title and ${unreadable === 1 ? 'was' : 'were'} skipped.`);
  }
  if (done.size === 0 && items.length > 0) {
    notes.push('No status was declared as meaning "done", so every board item is imported as outstanding.');
  }

  return finishRead('github-project', sourceLabel, items, notes);
}

/** The one place the global cap is applied, so no parser can forget to state it. */
function finishRead(
  kind: RoadmapImportSourceKind,
  sourceLabel: string,
  items: RoadmapImportItem[],
  notes: string[],
): RoadmapImportRead {
  if (items.length <= MAX_IMPORT_ITEMS) {
    return { kind, sourceLabel, items, notes };
  }
  return {
    kind,
    sourceLabel,
    items: items.slice(0, MAX_IMPORT_ITEMS),
    notes: [...notes, `${items.length - MAX_IMPORT_ITEMS} item${items.length - MAX_IMPORT_ITEMS === 1 ? '' : 's'} past the ${MAX_IMPORT_ITEMS}-item limit were not imported.`],
  };
}

// ── Planning ──────────────────────────────────────────────────────────────

/** A roadmap line as it stands now, with whatever import record it carries. */
export interface ExistingRoadmapLine {
  /** The durable node id, where the backlog has been anchored. */
  nodeId?: string;
  text: string;
  completed: boolean;
  imported?: RoadmapImportRecord;
}

export type RoadmapImportOutcome = 'add' | 'update' | 'conflict' | 'unchanged' | 'missing';

export interface RoadmapImportEntry {
  outcome: RoadmapImportOutcome;
  /** The source item. Absent on `missing`, which is about an item the source lost. */
  item?: RoadmapImportItem;
  /** The roadmap line this matched. Absent on `add`. */
  existing?: ExistingRoadmapLine;
  /** What this line would say afterwards. Absent unless something would be written. */
  nextText?: string;
  /** The declared rule that produced this outcome, published with the plan. */
  reason: string;
}

export interface RoadmapImportPlan {
  kind: RoadmapImportSourceKind;
  sourceLabel: string;
  entries: RoadmapImportEntry[];
  counts: Record<RoadmapImportOutcome, number>;
  notes: string[];
  /** One sentence for the confirmation dialog. Never omits the conflicts. */
  summary: string;
}

/**
 * The rules, published with every plan so a reader can check the grading rather
 * than trust it — the same contract the debt register and the release gates use.
 */
export const ROADMAP_IMPORT_RULES: readonly { outcome: RoadmapImportOutcome; rule: string }[] = [
  { outcome: 'add', rule: 'The source has an item this roadmap has never seen, by import key or by text.' },
  { outcome: 'update', rule: 'The source text changed and this line still says what the source last said, so nothing of yours is at stake.' },
  { outcome: 'conflict', rule: 'Both sides changed. Nothing is written; both texts are shown so you can decide.' },
  { outcome: 'unchanged', rule: 'The source says what this line already says.' },
  { outcome: 'missing', rule: 'This line was imported before and the source no longer has it. It is left exactly where it is.' },
];

/**
 * What an import would do, decided without doing any of it.
 *
 * Matching runs in two passes and the order is the policy. **The recorded import
 * key wins**, because it is the only thing that survives a rename on either
 * side. Only then does text matching run, and only against lines that have *no*
 * import record — which is what makes a first import over a hand-typed backlog
 * adopt those lines instead of duplicating every one of them, while stopping a
 * later import from stealing a line that belongs to a different source.
 */
export function planRoadmapImport(
  read: RoadmapImportRead,
  existing: readonly ExistingRoadmapLine[],
): RoadmapImportPlan {
  const entries: RoadmapImportEntry[] = [];
  const claimed = new Set<number>();

  const byKey = new Map<string, number>();
  const byText = new Map<string, number>();
  existing.forEach((line, index) => {
    if (line.imported !== undefined) {
      byKey.set(importKey(line.imported.kind, line.imported.sourceId), index);
    } else {
      const normalized = normalizeImportedTitle(line.text);
      if (normalized !== '' && !byText.has(normalized)) {
        byText.set(normalized, index);
      }
    }
  });

  for (const item of read.items) {
    const key = importKey(read.kind, item.sourceId);
    const normalized = normalizeImportedTitle(item.title);
    const matchedIndex = byKey.get(key) ?? byText.get(normalized);
    const line = matchedIndex === undefined ? undefined : existing[matchedIndex];

    if (line === undefined || matchedIndex === undefined) {
      entries.push({ outcome: 'add', item, nextText: item.title, reason: ruleFor('add') });
      continue;
    }
    claimed.add(matchedIndex);

    const localNormalized = normalizeImportedTitle(line.text);
    if (localNormalized === normalized) {
      entries.push({ outcome: 'unchanged', item, existing: line, reason: ruleFor('unchanged') });
      continue;
    }
    // No record means this line was adopted by text on a first import, so there
    // is no "what the source last said" to compare against — and the texts
    // matching is what got us here. Anything else is a genuine divergence.
    const lastImported = line.imported?.importedTitleNormalized;
    if (lastImported !== undefined && localNormalized !== lastImported) {
      entries.push({ outcome: 'conflict', item, existing: line, reason: ruleFor('conflict') });
      continue;
    }
    entries.push({ outcome: 'update', item, existing: line, nextText: item.title, reason: ruleFor('update') });
  }

  // Lines this source imported before and did not produce this time. Only ever
  // reported: the source may have dropped it, somebody may have renamed it, or
  // the glob may have stopped matching a file, and those look identical here.
  existing.forEach((line, index) => {
    if (claimed.has(index) || line.imported?.kind !== read.kind) {
      return;
    }
    if (line.imported.sourceLabel !== read.sourceLabel) {
      return;
    }
    entries.push({ outcome: 'missing', existing: line, reason: ruleFor('missing') });
  });

  const counts = entries.reduce((all, entry) => ({ ...all, [entry.outcome]: all[entry.outcome] + 1 }), {
    add: 0, update: 0, conflict: 0, unchanged: 0, missing: 0,
  } as Record<RoadmapImportOutcome, number>);

  return {
    kind: read.kind,
    sourceLabel: read.sourceLabel,
    entries,
    counts,
    notes: read.notes,
    summary: describeRoadmapImportPlan(counts, read.sourceLabel),
  };
}

function importKey(kind: RoadmapImportSourceKind, sourceId: string): string {
  return `${kind}::${sourceId}`;
}

function ruleFor(outcome: RoadmapImportOutcome): string {
  return ROADMAP_IMPORT_RULES.find(rule => rule.outcome === outcome)?.rule ?? '';
}

/**
 * The sentence a confirmation dialog leads with.
 *
 * Conflicts and untouched lines are named even when the counts are small,
 * because "12 added" alone reads as the whole story and the two things somebody
 * would want to know before agreeing are exactly what it leaves out.
 */
function describeRoadmapImportPlan(
  counts: Record<RoadmapImportOutcome, number>,
  sourceLabel: string,
): string {
  const changes = [
    counts.add > 0 ? `${counts.add} to add` : '',
    counts.update > 0 ? `${counts.update} to update` : '',
  ].filter(Boolean).join(', ');
  const held = [
    counts.conflict > 0 ? `${counts.conflict} changed on both sides and will not be touched` : '',
    counts.missing > 0 ? `${counts.missing} no longer in the source and will be left alone` : '',
    counts.unchanged > 0 ? `${counts.unchanged} already up to date` : '',
  ].filter(Boolean).join('; ');

  if (changes === '') {
    return held === ''
      ? `Nothing to import from ${sourceLabel}.`
      : `Nothing would change from ${sourceLabel} — ${held}.`;
  }
  return held === ''
    ? `From ${sourceLabel}: ${changes}.`
    : `From ${sourceLabel}: ${changes}. Also ${held}.`;
}

/** The record to store against a line this plan wrote. */
export function importRecordFor(
  read: RoadmapImportRead,
  item: RoadmapImportItem,
  importedAt?: string,
): RoadmapImportRecord {
  return {
    kind: read.kind,
    sourceId: item.sourceId,
    sourceLabel: read.sourceLabel,
    importedTitleNormalized: normalizeImportedTitle(item.title),
    ...(importedAt === undefined ? {} : { importedAt }),
    ...(item.url === undefined ? {} : { url: item.url }),
  };
}
