/**
 * Where a real page can take a new element, and the small set of edits UI
 * Studio will make to one — each a minimal patch against the bytes of the file.
 *
 * The Studio could draw a surface and edit what it drew. A page the project
 * already has was evidence only: it rendered beside the canvas and nothing in
 * it could be picked, so "change this heading" or "add a card to this section"
 * sent you back to the editor to find the line. This module answers two
 * questions about the file itself — *where may an element go?* and *what is
 * the exact change that makes this edit?* — and most of it is about refusing to
 * answer either more generously than the source allows.
 *
 * Seven rules.
 *
 * **Where an element may go is a declared table, never a guess.**
 * `HTML_CONTAINMENT_RULES` sorts the HTML element index into what each element
 * accepts — flow containers take blocks and inline content, a paragraph or a
 * heading takes inline content only, a list takes list items only, and a void
 * element, a raw-text element, a table's structure, the document's `html` and
 * `head`, anything inside SVG or MathML, and a custom element take nothing from
 * the palette. Every element in the index is claimed by exactly one rule
 * (asserted by test); anything else falls to `unknown-element`, which accepts
 * nothing — an element nobody declared is not a container we know about.
 *
 * **The palette is the Studio's.** The blocks the canvas draws, each written as
 * the one-line element it stands for, plus the two HTML primitives a list and a
 * form need (list item, form field). An entry names the category it needs and
 * the ancestors it may not sit inside — no link in a link, no form in a form,
 * no footer in a header.
 *
 * **An edit is one splice.** Change text, set or remove an attribute from the
 * allowlist, insert a palette entry at a point, remove an element, or move it
 * past one sibling. Each becomes a single `{start, end, replacement}` against
 * the file's offsets; every byte outside it is the file as it was, so the
 * author's indentation, quoting and line endings survive by construction. An
 * insertion copies the indentation of what is already there, and a removal
 * takes the whole line only when the element had the line to itself.
 *
 * **A plan is good only against the file it was planned from.** It carries the
 * fingerprint of the text it was planned against and the bytes it replaces;
 * `applyHtmlEditPlan` refuses when either differs from the file as it is now —
 * the divergence rule `uiSurfaceEmit` keeps for emitted regions, applied to
 * every edit here. Nothing is merged and nothing is retried.
 *
 * **An attribute is set only from an allowlist.** `class`, `id`, `alt`, `title`
 * and `aria-*` anywhere; `href` on a link, https or relative; `src` on an image
 * or media source, relative only. Never an event handler, never `style`, never
 * `src` on a script or a frame — the edit vocabulary is for content and
 * labels, and anything that could make the page *do* something is not in it.
 *
 * **An end that is not written is not guessed.** Inserting into an element, or
 * removing or moving one, needs its end in the source. An element closed by
 * the next tag or by the end of the file is refused with the line to open.
 *
 * **Every refusal names its rule.** `HTML_EDIT_RULES` is published on the card,
 * and every refusal carries one, so "why can't I edit this?" has an answer that
 * is not "it didn't work".
 *
 * Pure. The host reads, confirms, checks the dry run and writes.
 */

import type { WireframeElementKind } from '../types.js';
import {
  findHtmlSourceElement,
  HTML_VOID_ELEMENTS,
  isOnlyWhitespaceAndComments,
  type HtmlSourceAttribute,
  type HtmlSourceDocument,
  type HtmlSourceElement,
} from './htmlSourceMap.js';

// ── What may contain what ─────────────────────────────────────────

export type HtmlContentCategory = 'flow' | 'phrasing' | 'list-item';

export interface HtmlContainmentRule {
  id: string;
  /** Lower-case tag names this rule claims. */
  tags: readonly string[];
  /** What a palette entry must be to go inside. Empty: nothing does. */
  accepts: readonly HtmlContentCategory[];
  description: string;
  /** Why, for the person who tried. */
  reason: string;
}

/**
 * Evaluated after two predicate rules — anything inside SVG or MathML, then a
 * custom element (a name with a hyphen) — and before the fallback.
 */
export const HTML_CONTAINMENT_RULES: readonly HtmlContainmentRule[] = [
  {
    id: 'flow-container',
    tags: ['body', 'main', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'div', 'form', 'fieldset',
      'figure', 'figcaption', 'blockquote', 'li', 'dd', 'td', 'th', 'details', 'dialog', 'search'],
    accepts: ['flow', 'phrasing'],
    description: 'Sections, groupings, forms, list items and table cells.',
    reason: 'Takes blocks and inline content.',
  },
  {
    id: 'phrasing-only',
    tags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'em', 'strong', 'b', 'i', 'u', 's', 'small',
      'label', 'button', 'code', 'pre', 'q', 'cite', 'abbr', 'time', 'mark', 'sub', 'sup', 'dfn', 'kbd', 'samp',
      'var', 'bdi', 'bdo', 'data', 'output', 'legend', 'summary', 'dt', 'address', 'del', 'ins'],
    accepts: ['phrasing'],
    description: 'Paragraphs, headings and inline elements.',
    reason: 'Takes inline content only — a block inside a paragraph is closed out of it by the browser.',
  },
  {
    id: 'list',
    tags: ['ul', 'ol', 'menu'],
    accepts: ['list-item'],
    description: 'Lists.',
    reason: 'Takes list items only.',
  },
  {
    id: 'void-element',
    tags: [...HTML_VOID_ELEMENTS],
    accepts: [],
    description: 'Void elements: img, input, br, hr, meta, link and the rest.',
    reason: 'A void element has no contents and no end tag.',
  },
  {
    id: 'raw-text',
    tags: ['script', 'style', 'textarea', 'title', 'iframe', 'noembed', 'noframes', 'xmp', 'plaintext'],
    accepts: [],
    description: 'Elements whose contents are text the browser does not read as elements.',
    reason: 'Its contents are text, not elements.',
  },
  {
    id: 'document-structure',
    tags: ['html', 'head'],
    accepts: [],
    description: 'The document element and its head.',
    reason: 'html and head hold the document\'s structure, not visible content. Add to the body instead.',
  },
  {
    id: 'needs-structure',
    tags: ['table', 'caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'select', 'optgroup', 'option',
      'datalist', 'dl', 'picture', 'video', 'audio', 'object', 'map', 'ruby', 'rt', 'rp', 'template', 'canvas',
      'hgroup', 'noscript', 'slot', 'meter', 'progress'],
    accepts: [],
    description: 'Tables, selects, description lists, media, ruby, templates and other structured elements.',
    reason: 'Its children follow a structure the palette does not draw — rows, options, sources, terms. Edit it in the editor.',
  },
];

export const HTML_CONTAINMENT_FOREIGN: HtmlContainmentRule = {
  id: 'foreign-content',
  tags: [],
  accepts: [],
  description: 'Anything inside <svg> or <math>, and those elements themselves.',
  reason: 'SVG and MathML have content models of their own, and the palette draws HTML.',
};

export const HTML_CONTAINMENT_CUSTOM: HtmlContainmentRule = {
  id: 'custom-element',
  tags: [],
  accepts: [],
  description: 'A custom element — a name with a hyphen.',
  reason: 'What a custom element accepts is decided by its own script, which does not run here.',
};

/** Unknown is not a container. */
export const HTML_CONTAINMENT_FALLBACK: HtmlContainmentRule = {
  id: 'unknown-element',
  tags: [],
  accepts: [],
  description: 'An element no rule above names, including obsolete ones.',
  reason: 'No declared rule says what it accepts, so nothing is offered rather than something that might be invalid.',
};

/** Which rule decides what an element accepts. Total. */
export function htmlContainmentRuleFor(element: Pick<HtmlSourceElement, 'tagName' | 'foreign'>): HtmlContainmentRule {
  if (element.foreign) {
    return HTML_CONTAINMENT_FOREIGN;
  }
  if (element.tagName.includes('-')) {
    return HTML_CONTAINMENT_CUSTOM;
  }
  return HTML_CONTAINMENT_RULES.find(rule => rule.tags.includes(element.tagName)) ?? HTML_CONTAINMENT_FALLBACK;
}

// ── The palette ───────────────────────────────────────────────────

export type HtmlInsertPaletteId = WireframeElementKind | 'list-item' | 'form-field';

export interface HtmlInsertPaletteEntry {
  id: HtmlInsertPaletteId;
  label: string;
  category: HtmlContentCategory;
  /** Written before the text. */
  open: string;
  /** Written after it. */
  close: string;
  /** Whether the text lands in an attribute value (escaped as one) or as content. */
  textIn: 'content' | 'attribute';
  textPrompt: string;
  defaultText: string;
  /** Ancestors it may not sit inside. */
  forbiddenAncestors: readonly string[];
}

/** The Studio's blocks as the one-line element each stands for, plus a list item and a form field. */
export const HTML_INSERT_PALETTE: readonly HtmlInsertPaletteEntry[] = [
  { id: 'nav', label: 'Nav bar', category: 'flow', open: '<nav><a href="#">', close: '</a></nav>', textIn: 'content', textPrompt: 'The first link\'s label', defaultText: 'Home', forbiddenAncestors: ['nav'] },
  { id: 'hero', label: 'Hero banner', category: 'flow', open: '<section class="hero"><h1>', close: '</h1></section>', textIn: 'content', textPrompt: 'The headline', defaultText: 'Headline', forbiddenAncestors: [] },
  { id: 'section', label: 'Section', category: 'flow', open: '<section><h2>', close: '</h2></section>', textIn: 'content', textPrompt: 'The section heading', defaultText: 'Section heading', forbiddenAncestors: [] },
  { id: 'grid', label: 'Grid', category: 'flow', open: '<div class="grid"><div>', close: '</div></div>', textIn: 'content', textPrompt: 'The first item\'s text', defaultText: 'Grid item', forbiddenAncestors: [] },
  { id: 'card', label: 'Card', category: 'flow', open: '<article class="card"><h3>', close: '</h3></article>', textIn: 'content', textPrompt: 'The card title', defaultText: 'Card title', forbiddenAncestors: [] },
  { id: 'media', label: 'Image', category: 'phrasing', open: '<img alt="', close: '">', textIn: 'attribute', textPrompt: 'The image\'s alternative text (set its src afterwards)', defaultText: 'Describe the image', forbiddenAncestors: [] },
  { id: 'text', label: 'Text block', category: 'flow', open: '<p>', close: '</p>', textIn: 'content', textPrompt: 'The paragraph', defaultText: 'Text', forbiddenAncestors: [] },
  { id: 'form', label: 'Form', category: 'flow', open: '<form><label>', close: ' <input type="text" name="field"></label> <button type="submit">Send</button></form>', textIn: 'content', textPrompt: 'The field\'s label', defaultText: 'Name', forbiddenAncestors: ['form'] },
  { id: 'cta', label: 'Call to action', category: 'phrasing', open: '<a class="cta" href="#">', close: '</a>', textIn: 'content', textPrompt: 'The action\'s label', defaultText: 'Get started', forbiddenAncestors: ['a', 'button'] },
  { id: 'sidebar', label: 'Sidebar', category: 'flow', open: '<aside><p>', close: '</p></aside>', textIn: 'content', textPrompt: 'The sidebar\'s text', defaultText: 'Related', forbiddenAncestors: [] },
  { id: 'footer', label: 'Footer', category: 'flow', open: '<footer><p>', close: '</p></footer>', textIn: 'content', textPrompt: 'The footer\'s text', defaultText: 'Footer', forbiddenAncestors: ['header', 'footer', 'address'] },
  { id: 'custom', label: 'Custom block', category: 'flow', open: '<div>', close: '</div>', textIn: 'content', textPrompt: 'The block\'s text', defaultText: 'Content', forbiddenAncestors: [] },
  { id: 'list-item', label: 'List item', category: 'list-item', open: '<li>', close: '</li>', textIn: 'content', textPrompt: 'The item\'s text', defaultText: 'Item', forbiddenAncestors: [] },
  { id: 'form-field', label: 'Form field', category: 'phrasing', open: '<label>', close: ' <input type="text" name="field"></label>', textIn: 'content', textPrompt: 'The field\'s label', defaultText: 'Label', forbiddenAncestors: ['a', 'button', 'label'] },
];

export function htmlInsertPaletteEntry(id: string): HtmlInsertPaletteEntry | undefined {
  return HTML_INSERT_PALETTE.find(entry => entry.id === id);
}

// ── The edit rules ────────────────────────────────────────────────

export interface HtmlEditRule {
  id: string;
  description: string;
}

/** Every refusal names one of these. */
export const HTML_EDIT_RULES: readonly HtmlEditRule[] = [
  { id: 'map-complete', description: 'Nothing is edited in a page too large or too deeply nested to map completely: an id from a partial map is one the planner cannot stand behind.' },
  { id: 'id-current', description: 'An element is addressed by its position in the file as it was parsed; an id the current parse does not have is refused, never matched to something nearby.' },
  { id: 'html-only', description: 'Elements inside SVG or MathML are selected and opened in the editor, never edited here.' },
  { id: 'structure-kept', description: 'html, head and body are not removed or moved: that is not an element edit.' },
  { id: 'written-end', description: 'Inserting into, removing or moving an element needs its end in the source. An end implied by the next tag or by the end of the file is not guessed.' },
  { id: 'text-only', description: 'Text is changed only on an element whose contents are text alone — no child elements, no comments — so nothing else in it can be lost.' },
  { id: 'decodable-text', description: 'Text containing a character reference AtlasMind does not decode is not shown as editable, since it could not be shown faithfully.' },
  { id: 'attribute-allowlist', description: 'Attributes come from an allowlist: class, id, alt, title and aria-* anywhere; href on a or area (https or relative); src on img, source, video or audio (relative). Never an event handler, style, or src on a script or frame.' },
  { id: 'attribute-value', description: 'An attribute value has no control characters and stays within its length; a URL has no backslash, no whitespace and no other scheme.' },
  { id: 'single-declaration', description: 'An attribute written twice is not edited: the browser uses the first, and an edit would have to guess which one was meant.' },
  { id: 'containment', description: 'An element is inserted only where HTML_CONTAINMENT_RULES says its parent accepts it, and never inside an ancestor it may not sit in.' },
  { id: 'adjacent-sibling', description: 'An element moves past one element sibling, and only across whitespace or comments, so no text changes places with it.' },
  { id: 'plain-text', description: 'New text has no control characters and stays within 2,000 characters.' },
];

// ── Insertion points ──────────────────────────────────────────────

export type HtmlInsertPosition = 'in' | 'before' | 'after';

/** The shape of an insertion point id: an element id and a position. */
export const HTML_INSERTION_POINT_PATTERN = /^(e-\d{1,5}(?:\.\d{1,5}){0,255}-\d{1,9}):(in|before|after)$/;

export interface HtmlInsertionPoint {
  id: string;
  elementIndex: number;
  position: HtmlInsertPosition;
  /** The element the new one would be a child of. */
  parentIndex: number;
  /** Palette entries this point accepts, in palette order. */
  entries: HtmlInsertPaletteId[];
}

function hasKnownEnd(element: HtmlSourceElement): boolean {
  return element.closure === 'explicit' || element.closure === 'void' || element.closure === 'self-closed';
}

function ancestorTags(doc: HtmlSourceDocument, index: number): Set<string> {
  const tags = new Set<string>();
  let at = index;
  while (at !== -1) {
    const element = doc.elements[at]!;
    tags.add(element.tagName);
    at = element.parent;
  }
  return tags;
}

function entriesFor(doc: HtmlSourceDocument, parentIndex: number): HtmlInsertPaletteId[] {
  const parent = doc.elements[parentIndex]!;
  const accepts = htmlContainmentRuleFor(parent).accepts;
  if (accepts.length === 0) {
    return [];
  }
  const ancestors = ancestorTags(doc, parentIndex);
  return HTML_INSERT_PALETTE
    .filter(entry => accepts.includes(entry.category) && !entry.forbiddenAncestors.some(tag => ancestors.has(tag)))
    .map(entry => entry.id);
}

function pointFor(doc: HtmlSourceDocument, index: number, position: HtmlInsertPosition): HtmlInsertionPoint | undefined {
  const element = doc.elements[index]!;
  if (position === 'in') {
    if (element.closure !== 'explicit') {
      return undefined;
    }
    const entries = entriesFor(doc, index);
    return entries.length > 0 ? { id: `${element.id}:in`, elementIndex: index, position, parentIndex: index, entries } : undefined;
  }
  if (element.parent === -1 || (position === 'after' && !hasKnownEnd(element))) {
    return undefined;
  }
  const entries = entriesFor(doc, element.parent);
  return entries.length > 0 ? { id: `${element.id}:${position}`, elementIndex: index, position, parentIndex: element.parent, entries } : undefined;
}

/** Where a new element may go around and inside this one. Empty for a truncated map. */
export function htmlInsertionPoints(doc: HtmlSourceDocument, index: number): HtmlInsertionPoint[] {
  if (doc.truncated || !doc.elements[index]) {
    return [];
  }
  return (['before', 'in', 'after'] as const)
    .map(position => pointFor(doc, index, position))
    .filter((point): point is HtmlInsertionPoint => point !== undefined);
}

/** Resolve a point id against a parse. Undefined when the id is malformed or the point does not exist. */
export function findHtmlInsertionPoint(doc: HtmlSourceDocument, pointId: string): HtmlInsertionPoint | undefined {
  const match = HTML_INSERTION_POINT_PATTERN.exec(pointId);
  if (!match || doc.truncated) {
    return undefined;
  }
  const index = findHtmlSourceElement(doc, match[1]!);
  return index === -1 ? undefined : pointFor(doc, index, match[2] as HtmlInsertPosition);
}

// ── Text and attribute values ─────────────────────────────────────

const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', copy: '©', reg: '®',
  trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', middot: '·', bull: '•', times: '×', euro: '€',
  pound: '£', deg: '°',
};

export type HtmlTextDecoding = { status: 'decoded'; text: string } | { status: 'unknown-reference'; reference: string };

/**
 * Decode the character references a person would expect to see as characters.
 * One AtlasMind does not know — including a legacy one written without its
 * semicolon — is reported rather than shown raw, since raw would be re-escaped
 * on save and change what the page says.
 */
export function decodeHtmlText(raw: string): HtmlTextDecoding {
  let unknown: string | undefined;
  const text = raw.replace(/&(#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{0,31};?)/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2, -1), 16)
        : Number.parseInt(body.slice(1, -1), 10);
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        return String.fromCodePoint(code);
      }
      unknown ??= whole;
      return whole;
    }
    const name = body.endsWith(';') ? body.slice(0, -1) : '';
    const value = name ? NAMED_REFERENCES[name] : undefined;
    if (value === undefined) {
      unknown ??= whole;
      return whole;
    }
    return value;
  });
  return unknown === undefined ? { status: 'decoded', text } : { status: 'unknown-reference', reference: unknown };
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttributeValue(value: string, quote: '"' | '\''): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return quote === '"' ? escaped.replace(/"/g, '&quot;') : escaped.replace(/'/g, '&#39;');
}

const CONTROL = /[\u0000-\u001f\u007f]/;
export const HTML_EDIT_TEXT_MAX = 2_000;

/** Undefined when the text may be written; otherwise why not. */
export function validateHtmlEditText(text: string): string | undefined {
  if (CONTROL.test(text)) {
    return 'Text cannot contain control characters or line breaks.';
  }
  if (text.length > HTML_EDIT_TEXT_MAX) {
    return `Text is limited to ${HTML_EDIT_TEXT_MAX.toLocaleString('en-US')} characters.`;
  }
  return undefined;
}

export interface HtmlAttributeRule {
  id: string;
  /** Lower-case names, or a pattern for a family. */
  names: readonly string[] | RegExp;
  /** Tags it may be set on; empty means any HTML element. */
  elements: readonly string[];
  maxLength: number;
  description: string;
  /** Undefined when the value is acceptable; otherwise why not. */
  validate(value: string): string | undefined;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function urlProblem(value: string, allowHttps: boolean): string | undefined {
  if (/[\s\\]/.test(value)) {
    return 'A URL here has no whitespace and no backslash (write a space as %20).';
  }
  if (value.startsWith('//')) {
    return 'A protocol-relative URL (//host) reaches another site; use https:// or a relative path.';
  }
  if (SCHEME.test(value)) {
    if (!allowHttps || !/^https:\/\/[^/?#]/i.test(value)) {
      return allowHttps ? 'Only https:// links or relative paths are set here.' : 'Only a relative path is set here.';
    }
    try {
      return new URL(value).protocol === 'https:' ? undefined : 'Only https:// links or relative paths are set here.';
    } catch {
      return 'That is not a valid URL.';
    }
  }
  return undefined;
}

export const HTML_ATTRIBUTE_RULES: readonly HtmlAttributeRule[] = [
  { id: 'class', names: ['class'], elements: [], maxLength: 500, description: 'Class names, separated by spaces.', validate: () => undefined },
  { id: 'id', names: ['id'], elements: [], maxLength: 128, description: 'An id with no whitespace.', validate: value => (value === '' || /\s/.test(value) ? 'An id is not empty and has no whitespace.' : undefined) },
  { id: 'alt', names: ['alt'], elements: [], maxLength: 1_000, description: 'Alternative text.', validate: () => undefined },
  { id: 'title', names: ['title'], elements: [], maxLength: 1_000, description: 'An advisory title.', validate: () => undefined },
  { id: 'aria', names: /^aria-[a-z]{2,32}$/, elements: [], maxLength: 500, description: 'An aria-* label or state.', validate: () => undefined },
  { id: 'href', names: ['href'], elements: ['a', 'area'], maxLength: 2_000, description: 'A link: https:// or a relative path.', validate: value => urlProblem(value, true) },
  { id: 'src', names: ['src'], elements: ['img', 'source', 'video', 'audio'], maxLength: 2_000, description: 'A relative path to an image or media file.', validate: value => (value === '' ? 'A src is not empty.' : urlProblem(value, false)) },
];

/** Which allowlist rule covers this attribute on this element, if any. */
export function htmlAttributeRuleFor(tagName: string, name: string): HtmlAttributeRule | undefined {
  return HTML_ATTRIBUTE_RULES.find(rule =>
    (Array.isArray(rule.names) ? rule.names.includes(name) : (rule.names as RegExp).test(name))
    && (rule.elements.length === 0 || rule.elements.includes(tagName)));
}

/** Undefined when `name="value"` may be set on `tagName`; otherwise why not. */
export function validateHtmlAttributeEdit(tagName: string, name: string, value: string): string | undefined {
  const rule = htmlAttributeRuleFor(tagName, name);
  if (!rule) {
    return `${name} is not an attribute UI Studio sets on <${tagName}>.`;
  }
  if (CONTROL.test(value)) {
    return 'A value cannot contain control characters or line breaks.';
  }
  if (value.length > rule.maxLength) {
    return `${name} is limited to ${rule.maxLength.toLocaleString('en-US')} characters.`;
  }
  return rule.validate(value);
}

// ── Planning an edit ──────────────────────────────────────────────

export type HtmlElementEdit =
  | { kind: 'set-text'; elementId: string; text: string }
  | { kind: 'set-attribute'; elementId: string; name: string; value: string }
  | { kind: 'remove-attribute'; elementId: string; name: string }
  | { kind: 'insert'; pointId: string; entryId: string; text: string }
  | { kind: 'remove'; elementId: string }
  | { kind: 'move'; elementId: string; direction: 'up' | 'down' };

export interface HtmlSourcePatch {
  start: number;
  end: number;
  /** The bytes being replaced, as they were when planned. */
  original: string;
  replacement: string;
}

export type HtmlEditPlan =
  | { status: 'ready'; edit: HtmlElementEdit; sourceFingerprint: string; patch: HtmlSourcePatch; line: number; summary: string }
  | { status: 'refused'; rule: string; reason: string; line?: number };

export type ReadyHtmlEditPlan = Extract<HtmlEditPlan, { status: 'ready' }>;

function refuse(rule: string, reason: string, line?: number): HtmlEditPlan {
  return line === undefined ? { status: 'refused', rule, reason } : { status: 'refused', rule, reason, line };
}

function tagLabel(element: HtmlSourceElement): string {
  return `<${element.tagName}>`;
}

function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** The whitespace before `offset` on its line, when nothing else is there. */
function indentBefore(text: string, offset: number): string | undefined {
  const leading = text.slice(lineStartOf(text, offset), offset);
  return /^[ \t]*$/.test(leading) ? leading : undefined;
}

/** Nothing but whitespace between `offset` and the end of its line. */
function endsLine(text: string, offset: number): boolean {
  const newline = text.indexOf('\n', offset);
  return /^[ \t\r]*$/.test(text.slice(offset, newline === -1 ? text.length : newline));
}

/** The file's indentation step: a tab if any line starts with one, else the smallest space run. */
function indentUnit(text: string): string {
  if (/^\t/m.test(text)) {
    return '\t';
  }
  let smallest = Infinity;
  for (const match of text.matchAll(/^( +)\S/gm)) {
    smallest = Math.min(smallest, match[1]!.length);
  }
  return Number.isFinite(smallest) && smallest <= 8 ? ' '.repeat(smallest) : '  ';
}

function ready(doc: HtmlSourceDocument, edit: HtmlElementEdit, start: number, end: number, replacement: string, line: number, summary: string): HtmlEditPlan {
  return {
    status: 'ready',
    edit,
    sourceFingerprint: doc.fingerprint,
    patch: { start, end, original: doc.text.slice(start, end), replacement },
    line,
    summary,
  };
}

function lookup(doc: HtmlSourceDocument, elementId: string): { index: number; element: HtmlSourceElement } | HtmlEditPlan {
  if (doc.truncated) {
    return refuse('map-complete', 'This page is too large or too deeply nested to map completely, so nothing in it is edited here. Edit it in the editor.');
  }
  const index = findHtmlSourceElement(doc, elementId);
  if (index === -1) {
    return refuse('id-current', 'That element is not in the file as it is now. The render has been refreshed; select it again.');
  }
  const element = doc.elements[index]!;
  if (element.foreign) {
    return refuse('html-only', `${tagLabel(element)} is inside SVG or MathML, which UI Studio does not edit. Open it in the editor at line ${element.line}.`, element.line);
  }
  return { index, element };
}

function contentRange(element: HtmlSourceElement): { start: number; end: number } | undefined {
  return element.closure === 'explicit' && element.endTagStart !== undefined
    ? { start: element.startTagEnd, end: element.endTagStart }
    : undefined;
}

/**
 * The text of an element whose contents are text alone, decoded. Refused with
 * a rule when it is anything else.
 */
export function htmlElementText(doc: HtmlSourceDocument, index: number): { status: 'ok'; text: string } | { status: 'refused'; rule: string; reason: string } {
  const element = doc.elements[index]!;
  const rule = htmlContainmentRuleFor(element);
  if (rule.id === 'void-element' || rule.id === 'raw-text' || rule.id === 'document-structure' || element.tagName === 'body') {
    return { status: 'refused', rule: 'text-only', reason: `${tagLabel(element)} has no text UI Studio edits.` };
  }
  const range = contentRange(element);
  if (!range) {
    return { status: 'refused', rule: 'written-end', reason: `${tagLabel(element)} at line ${element.line} has no end tag in the source, so where its text stops is not written down.` };
  }
  if (element.children.length > 0 || element.hasComment) {
    return { status: 'refused', rule: 'text-only', reason: `${tagLabel(element)} contains elements or comments as well as text; change the text of the element inside it, or edit it in the editor.` };
  }
  const decoded = decodeHtmlText(doc.text.slice(range.start, range.end).trim());
  if (decoded.status === 'unknown-reference') {
    return { status: 'refused', rule: 'decodable-text', reason: `${tagLabel(element)} contains ${decoded.reference}, a character reference UI Studio does not decode. Edit it in the editor at line ${element.line}.` };
  }
  return { status: 'ok', text: decoded.text };
}

function planSetText(doc: HtmlSourceDocument, edit: Extract<HtmlElementEdit, { kind: 'set-text' }>): HtmlEditPlan {
  const found = lookup(doc, edit.elementId);
  if ('status' in found) {
    return found;
  }
  const problem = validateHtmlEditText(edit.text);
  if (problem) {
    return refuse('plain-text', problem, found.element.line);
  }
  const current = htmlElementText(doc, found.index);
  if (current.status === 'refused') {
    return refuse(current.rule, current.reason, found.element.line);
  }
  const range = contentRange(found.element)!;
  const content = doc.text.slice(range.start, range.end);
  const escaped = escapeHtmlText(edit.text);
  if (content.trim() === '') {
    return ready(doc, edit, range.start, range.end, escaped, found.element.line, `change the text of ${tagLabel(found.element)}`);
  }
  // Keep the whitespace around the text: it is the author's layout, not the text.
  const leading = /^\s*/.exec(content)![0].length;
  const trailing = /\s*$/.exec(content)![0].length;
  return ready(doc, edit, range.start + leading, range.end - trailing, escaped, found.element.line, `change the text of ${tagLabel(found.element)}`);
}

function findAttribute(element: HtmlSourceElement, name: string): { attribute?: HtmlSourceAttribute; duplicated: boolean } {
  const matches = element.attributes.filter(attribute => attribute.name === name);
  return { attribute: matches[0], duplicated: matches.length > 1 };
}

function planSetAttribute(doc: HtmlSourceDocument, edit: Extract<HtmlElementEdit, { kind: 'set-attribute' }>): HtmlEditPlan {
  const found = lookup(doc, edit.elementId);
  if ('status' in found) {
    return found;
  }
  const { element } = found;
  const name = edit.name.toLowerCase();
  const problem = validateHtmlAttributeEdit(element.tagName, name, edit.value);
  if (problem) {
    return refuse(htmlAttributeRuleFor(element.tagName, name) ? 'attribute-value' : 'attribute-allowlist', problem, element.line);
  }
  const { attribute, duplicated } = findAttribute(element, name);
  if (duplicated) {
    return refuse('single-declaration', `${name} is written more than once on ${tagLabel(element)} at line ${element.line}; the browser uses the first. Edit it in the editor.`, element.line);
  }
  const summary = `set ${name} on ${tagLabel(element)}`;
  if (attribute?.value && attribute.value.quote !== '') {
    const quote = attribute.value.quote;
    return ready(doc, edit, attribute.value.start, attribute.value.end, escapeAttributeValue(edit.value, quote), element.line, summary);
  }
  if (attribute) {
    // Bare or unquoted: rewritten as one double-quoted attribute, name as spelled.
    const spelled = doc.text.slice(attribute.start, attribute.start + name.length);
    return ready(doc, edit, attribute.start, attribute.end, `${spelled}="${escapeAttributeValue(edit.value, '"')}"`, element.line, summary);
  }
  // New: after the last attribute (or the tag name), so the tag's own spacing stays.
  const last = element.attributes[element.attributes.length - 1];
  const at = last ? last.end : element.nameEnd;
  return ready(doc, edit, at, at, ` ${name}="${escapeAttributeValue(edit.value, '"')}"`, element.line, summary);
}

function planRemoveAttribute(doc: HtmlSourceDocument, edit: Extract<HtmlElementEdit, { kind: 'remove-attribute' }>): HtmlEditPlan {
  const found = lookup(doc, edit.elementId);
  if ('status' in found) {
    return found;
  }
  const { element } = found;
  const name = edit.name.toLowerCase();
  if (!htmlAttributeRuleFor(element.tagName, name)) {
    return refuse('attribute-allowlist', `${name} is not an attribute UI Studio changes on ${tagLabel(element)}.`, element.line);
  }
  const { attribute, duplicated } = findAttribute(element, name);
  if (!attribute) {
    return refuse('id-current', `${tagLabel(element)} at line ${element.line} has no ${name} attribute.`, element.line);
  }
  if (duplicated) {
    return refuse('single-declaration', `${name} is written more than once on ${tagLabel(element)} at line ${element.line}. Edit it in the editor.`, element.line);
  }
  let start = attribute.start;
  while (start > element.start && /[ \t\r\n\f]/.test(doc.text[start - 1]!)) {
    start -= 1;
  }
  return ready(doc, edit, start, attribute.end, '', element.line, `remove ${name} from ${tagLabel(element)}`);
}

const STRUCTURE = new Set(['html', 'head', 'body']);

function planRemove(doc: HtmlSourceDocument, edit: Extract<HtmlElementEdit, { kind: 'remove' }>): HtmlEditPlan {
  const found = lookup(doc, edit.elementId);
  if ('status' in found) {
    return found;
  }
  const { element } = found;
  if (STRUCTURE.has(element.tagName)) {
    return refuse('structure-kept', `${tagLabel(element)} is the document's structure, not an element to remove.`, element.line);
  }
  if (!hasKnownEnd(element)) {
    return refuse('written-end', `${tagLabel(element)} at line ${element.line} has no end tag in the source, so where it stops is not written down. Remove it in the editor.`, element.line);
  }
  const text = doc.text;
  const indent = indentBefore(text, element.start);
  if (indent !== undefined && endsLine(text, element.end)) {
    // Alone on its lines: take the lines, so no blank line is left behind.
    const lineStart = lineStartOf(text, element.start);
    const newline = text.indexOf('\n', element.end);
    return ready(doc, edit, lineStart, newline === -1 ? text.length : newline + 1, '', element.line, `remove ${tagLabel(element)}`);
  }
  return ready(doc, edit, element.start, element.end, '', element.line, `remove ${tagLabel(element)}`);
}

function planMove(doc: HtmlSourceDocument, edit: Extract<HtmlElementEdit, { kind: 'move' }>): HtmlEditPlan {
  const found = lookup(doc, edit.elementId);
  if ('status' in found) {
    return found;
  }
  const { index, element } = found;
  if (STRUCTURE.has(element.tagName)) {
    return refuse('structure-kept', `${tagLabel(element)} is the document's structure, not an element to move.`, element.line);
  }
  const siblings = element.parent === -1 ? doc.roots : doc.elements[element.parent]!.children;
  const at = siblings.indexOf(index);
  const otherIndex = siblings[edit.direction === 'up' ? at - 1 : at + 1];
  if (otherIndex === undefined) {
    return refuse('adjacent-sibling', `${tagLabel(element)} is already the ${edit.direction === 'up' ? 'first' : 'last'} element in its parent.`, element.line);
  }
  const other = doc.elements[otherIndex]!;
  if (!hasKnownEnd(element) || !hasKnownEnd(other)) {
    return refuse('written-end', `${tagLabel(hasKnownEnd(element) ? other : element)} has no end tag in the source, so where it stops is not written down. Move it in the editor.`, element.line);
  }
  const [first, second] = edit.direction === 'up' ? [other, element] : [element, other];
  const between = doc.text.slice(first.end, second.start);
  if (!isOnlyWhitespaceAndComments(between)) {
    return refuse('adjacent-sibling', `Text sits between ${tagLabel(first)} and ${tagLabel(second)}; moving one past the other would reorder it. Move it in the editor.`, element.line);
  }
  const replacement = doc.text.slice(second.start, second.end) + between + doc.text.slice(first.start, first.end);
  return ready(doc, edit, first.start, second.end, replacement, element.line, `move ${tagLabel(element)} ${edit.direction === 'up' ? 'before' : 'after'} the ${tagLabel(other)} beside it`);
}

function planInsert(doc: HtmlSourceDocument, edit: Extract<HtmlElementEdit, { kind: 'insert' }>): HtmlEditPlan {
  if (doc.truncated) {
    return refuse('map-complete', 'This page is too large or too deeply nested to map completely, so nothing is inserted into it here.');
  }
  const match = HTML_INSERTION_POINT_PATTERN.exec(edit.pointId);
  const found = match ? lookup(doc, match[1]!) : refuse('id-current', 'That insertion point is not in the file as it is now.');
  if ('status' in found) {
    return found;
  }
  const { element } = found;
  const entry = htmlInsertPaletteEntry(edit.entryId);
  if (!entry) {
    return refuse('containment', 'That is not an entry in the palette.', element.line);
  }
  const point = findHtmlInsertionPoint(doc, edit.pointId);
  if (!point) {
    const position = match![2] as HtmlInsertPosition;
    if (position === 'in' && element.closure !== 'explicit') {
      return refuse('written-end', `${tagLabel(element)} at line ${element.line} has no end tag in the source, so there is no written place to add inside it.`, element.line);
    }
    if (position === 'after' && !hasKnownEnd(element)) {
      return refuse('written-end', `${tagLabel(element)} at line ${element.line} has no end tag in the source, so there is no written place after it.`, element.line);
    }
    if (position !== 'in' && element.parent === -1) {
      return refuse('containment', `${tagLabel(element)} at line ${element.line} is at the top level of the file, outside any element. Add inside the body instead.`, element.line);
    }
    const container = doc.elements[position === 'in' ? found.index : element.parent]!;
    return refuse('containment', `Nothing from the palette goes ${position === 'in' ? 'inside' : position} ${tagLabel(element)} at line ${element.line}: ${htmlContainmentRuleFor(container).reason}`, element.line);
  }
  if (!point.entries.includes(entry.id)) {
    const parent = doc.elements[point.parentIndex]!;
    const rule = htmlContainmentRuleFor(parent);
    const blockedBy = entry.forbiddenAncestors.find(tag => ancestorTags(doc, point.parentIndex).has(tag));
    return refuse('containment', blockedBy
      ? `A ${entry.label.toLowerCase()} cannot sit inside a <${blockedBy}>.`
      : `${tagLabel(parent)} does not take a ${entry.label.toLowerCase()}: ${rule.reason}`, element.line);
  }
  const problem = validateHtmlEditText(edit.text);
  if (problem) {
    return refuse('plain-text', problem, element.line);
  }
  const snippet = `${entry.open}${entry.textIn === 'attribute' ? escapeAttributeValue(edit.text, '"') : escapeHtmlText(edit.text)}${entry.close}`;
  const text = doc.text;
  const newline = doc.newline;
  const summary = `insert a ${entry.label.toLowerCase()} ${point.position === 'in' ? 'at the end of' : point.position} ${tagLabel(element)}`;
  if (point.position === 'before') {
    const indent = indentBefore(text, element.start);
    return ready(doc, edit, element.start, element.start, indent !== undefined ? `${snippet}${newline}${indent}` : snippet, element.line, summary);
  }
  if (point.position === 'after') {
    const indent = indentBefore(text, element.start);
    const lineBreak = indent !== undefined && endsLine(text, element.end);
    return ready(doc, edit, element.end, element.end, lineBreak ? `${newline}${indent}${snippet}` : snippet, element.line, summary);
  }
  const endTag = element.endTagStart!;
  const endIndent = indentBefore(text, endTag);
  if (endIndent !== undefined && lineStartOf(text, endTag) > element.startTagEnd) {
    // The end tag has its own line: the new child gets a line of its own above
    // it, indented like the last child, or one step in from the parent.
    const lastChild = element.children.length > 0 ? doc.elements[element.children[element.children.length - 1]!]! : undefined;
    const childIndent = (lastChild ? indentBefore(text, lastChild.start) : undefined)
      ?? `${indentBefore(text, element.start) ?? endIndent}${indentUnit(text)}`;
    const at = lineStartOf(text, endTag);
    return ready(doc, edit, at, at, `${childIndent}${snippet}${newline}`, element.line, summary);
  }
  const before = text[endTag - 1];
  const spaced = entry.category === 'phrasing' && before !== undefined && !/[\s>]/.test(before);
  return ready(doc, edit, endTag, endTag, `${spaced ? ' ' : ''}${snippet}`, element.line, summary);
}

/** The single splice that makes an edit, or the rule that refuses it. Total. */
export function planHtmlElementEdit(doc: HtmlSourceDocument, edit: HtmlElementEdit): HtmlEditPlan {
  switch (edit.kind) {
    case 'set-text':
      return planSetText(doc, edit);
    case 'set-attribute':
      return planSetAttribute(doc, edit);
    case 'remove-attribute':
      return planRemoveAttribute(doc, edit);
    case 'insert':
      return planInsert(doc, edit);
    case 'remove':
      return planRemove(doc, edit);
    case 'move':
      return planMove(doc, edit);
  }
}

// ── Applying it ───────────────────────────────────────────────────

export type HtmlEditApplication =
  | { status: 'applied'; text: string }
  | { status: 'diverged'; reason: string };

/**
 * Apply a plan to the file as it is now — or refuse, if the file is not the one
 * the plan was made from. Both the whole-file fingerprint and the replaced
 * bytes are checked; the first catches any change, the second is what the
 * splice actually stands on.
 */
export function applyHtmlEditPlan(current: string, plan: ReadyHtmlEditPlan, fingerprint: (text: string) => string): HtmlEditApplication {
  if (fingerprint(current) !== plan.sourceFingerprint) {
    return { status: 'diverged', reason: 'The file changed after this edit was planned, so it was not written. The render has been refreshed; make the edit again.' };
  }
  if (current.slice(plan.patch.start, plan.patch.end) !== plan.patch.original) {
    return { status: 'diverged', reason: 'The bytes this edit replaces are not the ones it was planned against, so it was not written.' };
  }
  return { status: 'applied', text: current.slice(0, plan.patch.start) + plan.patch.replacement + current.slice(plan.patch.end) };
}

// ── Saying what it does ───────────────────────────────────────────

const SHOWN_MAX = 1_500;

/** Control and bidirectional-override characters shown as escapes, so the dialog cannot be made to lie. */
function visible(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g, char =>
    `\\u{${char.codePointAt(0)!.toString(16).padStart(4, '0')}}`);
}

function clip(value: string): string {
  return value.length > SHOWN_MAX
    ? `${value.slice(0, SHOWN_MAX)}\n… ${(value.length - SHOWN_MAX).toLocaleString('en-US')} more characters not shown here — open the file at the line above to see them.`
    : value;
}

/**
 * The confirmation: what changes, where, and the whole lines it touches before
 * and after. Composed here so no surface can describe an edit more briefly than
 * it is.
 */
export function describeHtmlEditConfirmation(path: string, plan: ReadyHtmlEditPlan, original: string): { title: string; detail: string } {
  const lineStart = lineStartOf(original, plan.patch.start);
  const newlineAfter = original.indexOf('\n', plan.patch.end);
  const lineEnd = newlineAfter === -1 ? original.length : newlineAfter;
  const before = original.slice(lineStart, lineEnd).replace(/\r$/, '');
  const after = (original.slice(lineStart, plan.patch.start) + plan.patch.replacement + original.slice(plan.patch.end, lineEnd)).replace(/\r$/, '');
  return {
    title: `Edit ${path}: ${plan.summary}?`,
    detail: [
      `Line ${plan.line} of ${path}.`,
      '',
      'Before:',
      clip(visible(before)) || '(nothing)',
      '',
      'After:',
      clip(visible(after)) || '(nothing — the lines are removed)',
      '',
      'Only these characters change; the rest of the file is written back exactly as it is. If the file changes before this is written, nothing is written.',
    ].join('\n'),
  };
}

/** A one-line label for an element in a list: tag, its id and classes, line, and its text if short. */
export function describeHtmlElement(doc: HtmlSourceDocument, index: number): string {
  const element = doc.elements[index]!;
  const attribute = (name: string) => {
    const found = element.attributes.find(entry => entry.name === name);
    return found?.value ? doc.text.slice(found.value.start, found.value.end) : undefined;
  };
  const id = attribute('id');
  const classes = attribute('class')?.trim().split(/\s+/).slice(0, 3).join('.');
  const text = htmlElementText(doc, index);
  const shown = text.status === 'ok' && text.text ? ` — “${text.text.length > 48 ? `${text.text.slice(0, 47)}…` : text.text}”` : '';
  return visible(`<${element.tagName}${id ? `#${id.slice(0, 40)}` : ''}${classes ? `.${classes.slice(0, 60)}` : ''}> · line ${element.line}${shown}`);
}

// ── What can be done to one element ───────────────────────────────

export type HtmlElementActionId = 'set-text' | 'set-attribute' | 'remove-attribute' | 'insert-before' | 'insert-in' | 'insert-after' | 'move-up' | 'move-down' | 'remove';

export interface HtmlElementAction {
  id: HtmlElementActionId;
  label: string;
  available: boolean;
  /** Why not, naming the rule, when unavailable. */
  reason?: string;
}

/**
 * Every action in the vocabulary, each available or not with its reason, so a
 * menu can show what is impossible and why instead of hiding it.
 */
export function htmlElementActions(doc: HtmlSourceDocument, index: number): HtmlElementAction[] {
  const element = doc.elements[index];
  if (!element) {
    return [];
  }
  const probe = (edit: HtmlElementEdit): { available: boolean; reason?: string } => {
    const plan = planHtmlElementEdit(doc, edit);
    return plan.status === 'ready' ? { available: true } : { available: false, reason: `${plan.reason} (${plan.rule})` };
  };
  const points = htmlInsertionPoints(doc, index);
  const pointAction = (position: HtmlInsertPosition, id: HtmlElementActionId, label: string): HtmlElementAction => {
    const point = points.find(candidate => candidate.position === position);
    if (point) {
      return { id, label, available: true };
    }
    const plan = planHtmlElementEdit(doc, { kind: 'insert', pointId: `${element.id}:${position}`, entryId: 'custom', text: 'x' });
    return { id, label, available: false, reason: plan.status === 'refused' ? `${plan.reason} (${plan.rule})` : 'Nothing from the palette goes here. (containment)' };
  };
  const settable = HTML_ATTRIBUTE_RULES.some(rule => rule.elements.length === 0 || rule.elements.includes(element.tagName));
  const removable = element.attributes.some(attribute => htmlAttributeRuleFor(element.tagName, attribute.name));
  const base = lookup(doc, element.id);
  const baseReason = 'status' in base && base.status === 'refused' ? `${base.reason} (${base.rule})` : undefined;
  return [
    { id: 'set-text', label: 'Change text…', ...probe({ kind: 'set-text', elementId: element.id, text: '' }) },
    { id: 'set-attribute', label: 'Set an attribute…', available: !baseReason && settable, ...(baseReason ? { reason: baseReason } : {}) },
    {
      id: 'remove-attribute', label: 'Remove an attribute…', available: !baseReason && removable,
      ...(baseReason ? { reason: baseReason } : removable ? {} : { reason: 'It has no attribute from the allowlist. (attribute-allowlist)' }),
    },
    pointAction('before', 'insert-before', 'Insert before…'),
    pointAction('in', 'insert-in', 'Insert inside, at the end…'),
    pointAction('after', 'insert-after', 'Insert after…'),
    { id: 'move-up', label: 'Move up', ...probe({ kind: 'move', elementId: element.id, direction: 'up' }) },
    { id: 'move-down', label: 'Move down', ...probe({ kind: 'move', elementId: element.id, direction: 'down' }) },
    { id: 'remove', label: 'Remove…', ...probe({ kind: 'remove', elementId: element.id }) },
  ];
}
