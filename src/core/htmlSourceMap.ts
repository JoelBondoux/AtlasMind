/**
 * A project's HTML, read for *where things are* rather than for what they mean.
 *
 * Editing an element in somebody's page needs one fact a browser never keeps:
 * the bytes in the file that produced it. A DOM knows that a heading exists and
 * what it says; it does not know that its start tag begins at offset 1,204 and
 * its end tag at 1,231, and without that an edit has to re-serialise the page —
 * which reformats every line nobody asked to touch. So this is a parser whose
 * output is *offsets*: every element with the range of its start tag, each
 * attribute's name and value, its end tag if it has one, and an id built from
 * its position in the tree and the offset it starts at.
 *
 * Four rules.
 *
 * **Tolerant, never repairing.** The tokenizer follows the WHATWG tokenizer's
 * shape — comments, doctypes, raw-text elements, quoted and unquoted attribute
 * values, a `<` that does not open a tag — and the tree follows the parts of
 * tree construction that decide *which element a later tag belongs to*: a `<p>`
 * closed by a block, an `<li>` by the next `<li>`, an end tag closing whatever
 * is open above its match. It never invents an element the file does not
 * contain (the browser's implied `<tbody>` has no bytes, so it has no id), and
 * it never reads a file as anything but the file.
 *
 * **How an element ended is recorded, never assumed.** `explicit` has an end tag
 * in the source; `void` and `self-closed` end with their start tag; `implied`
 * was closed by something else and `unclosed` by the end of the file. Only the
 * first three have an end an edit can stand on — inserting "at the end of" an
 * element whose end is implied would be guessing where the author meant it to
 * stop, so the edit planner refuses it and says why.
 *
 * **An id is position, not content.** `e-<path>-<offset>`: the child indexes
 * from the top of the file and the offset of the start tag. It survives a
 * render, carries nothing a webview could use to name a file, and goes stale
 * the moment the file changes — which is the point, because the edit planner
 * also checks the file's fingerprint and refuses an id from a parse of a file
 * that is no longer there.
 *
 * **Bounded.** A page past `HTML_SOURCE_MAX_ELEMENTS` or nested past
 * `HTML_SOURCE_MAX_DEPTH` is reported `truncated`, and nothing is offered for
 * editing in it: an id from a partial map would be an id the planner could not
 * stand behind.
 *
 * Pure. Never throws.
 */

import { createHash } from 'node:crypto';

export const HTML_SOURCE_MAX_ELEMENTS = 20_000;
export const HTML_SOURCE_MAX_DEPTH = 256;

/** Elements with no contents and no end tag. */
export const HTML_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

/** Elements whose contents the tokenizer reads as text up to their own end tag. */
export const HTML_RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'textarea', 'title',
]);

/** Start tags that close an open `<p>` (WHATWG "in body" insertion mode). */
const CLOSES_P: ReadonlySet<string> = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p', 'search', 'section',
  'summary', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'listing', 'form', 'plaintext', 'hr', 'xmp',
  'li', 'dd', 'dt', 'table',
]);

const HEADINGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Where a search for an open `<p>` (or `<li>`) stops, as the spec's scopes do. */
const SCOPE_BOUNDARIES: ReadonlySet<string> = new Set([
  'applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template', 'button',
]);

/** The "special" elements that stop the search for an open `<li>`, `<dd>` or `<dt>`. */
const LIST_ITEM_STOPS: ReadonlySet<string> = new Set([
  'applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template', 'ol', 'ul', 'dl', 'menu',
  'article', 'aside', 'blockquote', 'body', 'details', 'dialog', 'fieldset', 'figure', 'footer', 'form', 'header',
  'main', 'nav', 'section',
]);

/** What may sit in `<head>`; anything else closes it. */
const HEAD_CONTENT: ReadonlySet<string> = new Set([
  'base', 'link', 'meta', 'title', 'style', 'script', 'noscript', 'template',
]);

/** HTML start tags that end SVG or MathML content (WHATWG "in foreign content"). */
const FOREIGN_BREAKOUT: ReadonlySet<string> = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre',
  'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
]);

export type HtmlElementClosure = 'explicit' | 'void' | 'self-closed' | 'implied' | 'unclosed';

export interface HtmlSourceAttribute {
  /** Lower-cased, as the browser reads it. */
  name: string;
  /** The whole attribute, `name` through the end of its value. */
  start: number;
  end: number;
  /** Absent for a bare attribute (`<input disabled>`). */
  value?: {
    /** The value's own characters, inside any quotes. */
    start: number;
    end: number;
    quote: '"' | "'" | '';
  };
}

export interface HtmlSourceElement {
  id: string;
  /** Lower-cased. */
  tagName: string;
  /** Child indexes from the top of the file. */
  path: readonly number[];
  /** Index of the parent in `elements`, or -1 at the top level. */
  parent: number;
  /** Indexes of element children in `elements`, in source order. */
  children: number[];
  /** The `<` of the start tag. */
  start: number;
  /** Just after the tag name, where an attribute can be added without touching the others. */
  nameEnd: number;
  /** Just after the start tag's `>`. */
  startTagEnd: number;
  /** The `<` of the end tag, when there is one in the source. */
  endTagStart?: number;
  /** Just after the element: its end tag, its start tag if void, or where it was closed. */
  end: number;
  closure: HtmlElementClosure;
  /** Written `<x/>`. Meaningful only for foreign elements; HTML ignores it. */
  selfClosingSyntax: boolean;
  attributes: HtmlSourceAttribute[];
  /** 1-based line of the start tag. */
  line: number;
  /** Inside `<svg>` or `<math>` (or is one). */
  foreign: boolean;
  /** Its contents include a comment, doctype or processing instruction. */
  hasComment: boolean;
}

export interface HtmlSourceDocument {
  text: string;
  /** sha-256 of the exact text; an id is only good against a file with this fingerprint. */
  fingerprint: string;
  elements: HtmlSourceElement[];
  /** Indexes of top-level elements. */
  roots: number[];
  /** The map stopped at a bound; nothing in it is offered for editing. */
  truncated: boolean;
  /** CRLF if the file uses it anywhere, else LF. */
  newline: '\n' | '\r\n';
}

export function htmlSourceFingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The shape of an element id; anything else is refused before a lookup. */
export const HTML_ELEMENT_ID_PATTERN = /^e-\d{1,5}(?:\.\d{1,5}){0,255}-\d{1,9}$/;

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
}

interface TagScan {
  name: string;
  nameEnd: number;
  end: number;
  attributes: HtmlSourceAttribute[];
  selfClosing: boolean;
}

/**
 * Read a tag from `<` (start) or `</` (end) to its `>`. Returns undefined when
 * the file ends inside the tag — the tokenizer then treats the rest as text,
 * which is what a browser does with an unterminated tag at end of file.
 */
function scanTag(text: string, at: number, nameStart: number): TagScan | undefined {
  const n = text.length;
  let j = nameStart;
  while (j < n) {
    const code = text.charCodeAt(j);
    if (isSpace(code) || code === 47 /* / */ || code === 62 /* > */) {
      break;
    }
    j += 1;
  }
  const name = text.slice(nameStart, j).toLowerCase();
  const nameEnd = j;
  const attributes: HtmlSourceAttribute[] = [];
  let selfClosing = false;
  while (j < n) {
    const code = text.charCodeAt(j);
    if (isSpace(code)) {
      j += 1;
      continue;
    }
    if (code === 47) {
      selfClosing = text.charCodeAt(j + 1) === 62;
      j += 1;
      continue;
    }
    if (code === 62) {
      return { name, nameEnd, end: j + 1, attributes, selfClosing };
    }
    selfClosing = false;
    // Attribute name: the first character is part of it whatever it is (the
    // spec's `=` as a first character included), then up to a delimiter.
    const attrStart = j;
    j += 1;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (isSpace(c) || c === 47 || c === 62 || c === 61 /* = */) {
        break;
      }
      j += 1;
    }
    const attrName = text.slice(attrStart, j).toLowerCase();
    let k = j;
    while (k < n && isSpace(text.charCodeAt(k))) {
      k += 1;
    }
    if (text.charCodeAt(k) !== 61) {
      attributes.push({ name: attrName, start: attrStart, end: j });
      continue;
    }
    k += 1;
    while (k < n && isSpace(text.charCodeAt(k))) {
      k += 1;
    }
    if (k >= n) {
      return undefined;
    }
    const quote = text[k];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, k + 1);
      if (close === -1) {
        return undefined;
      }
      attributes.push({ name: attrName, start: attrStart, end: close + 1, value: { start: k + 1, end: close, quote } });
      j = close + 1;
      continue;
    }
    if (text.charCodeAt(k) === 62) {
      // `name=>`: a missing value. The spec reads an empty value here.
      attributes.push({ name: attrName, start: attrStart, end: k, value: { start: k, end: k, quote: '' } });
      j = k;
      continue;
    }
    let v = k;
    while (v < n && !isSpace(text.charCodeAt(v)) && text.charCodeAt(v) !== 62) {
      v += 1;
    }
    attributes.push({ name: attrName, start: attrStart, end: v, value: { start: k, end: v, quote: '' } });
    j = v;
  }
  return undefined;
}

/** Find `</name` followed by a delimiter, case-insensitively. */
function findRawTextEnd(text: string, from: number, name: string): number {
  const lower = text.toLowerCase();
  let at = from;
  for (;;) {
    const found = lower.indexOf(`</${name}`, at);
    if (found === -1) {
      return -1;
    }
    const after = text.charCodeAt(found + 2 + name.length);
    if (Number.isNaN(after) || isSpace(after) || after === 47 || after === 62) {
      return found;
    }
    at = found + 1;
  }
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid]! <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1;
}

/**
 * Where the run of whitespace and comments starting at `from` ends: the offset of the
 * first character that is neither, or -1 when a comment opens and never closes. A comment
 * ends at its first `-->`, as a browser ends one. A scan rather than a regex:
 * `(?:<!--[\s\S]*?-->\s*)*` backtracks exponentially on `<!--` followed by many
 * `--><!--`, and this runs on files we did not write. Every caller that needs to step over
 * leading comments asks this, so none of them grows that regex back.
 */
function skipWhitespaceAndComments(text: string, from: number): number {
  let i = from;
  for (;;) {
    while (i < text.length && /\s/u.test(text[i]!)) {
      i += 1;
    }
    if (!text.startsWith('<!--', i)) {
      return i;
    }
    const close = text.indexOf('-->', i + 4);
    if (close === -1) {
      return -1;
    }
    i = close + 3;
  }
}

function doctypeStart(text: string): number | undefined {
  const i = skipWhitespaceAndComments(text, text.charCodeAt(0) === 0xfeff ? 1 : 0);
  return i !== -1 && text.slice(i, i + 9).toLowerCase() === '<!doctype' ? i : undefined;
}

/** Whether the page opens with a doctype, after an optional BOM and any whitespace and comments. */
export function startsWithDoctype(text: string): boolean {
  return doctypeStart(text) !== undefined;
}

/**
 * The offset just past a leading doctype's `>`, read as `startsWithDoctype` reads it, or
 * undefined when the page does not open with one — where anything that must come after
 * the doctype and before the rest of the page is inserted.
 */
export function leadingDoctypeEnd(text: string): number | undefined {
  const start = doctypeStart(text);
  if (start === undefined) {
    return undefined;
  }
  const close = text.indexOf('>', start + 9);
  return close === -1 ? undefined : close + 1;
}

/** Whether `text` holds nothing but whitespace and comments. */
export function isOnlyWhitespaceAndComments(text: string): boolean {
  return skipWhitespaceAndComments(text, 0) === text.length;
}

/** Parse a page into elements with source offsets. Total: never throws. */
export function parseHtmlSource(text: string): HtmlSourceDocument {
  const elements: HtmlSourceElement[] = [];
  const roots: number[] = [];
  const stack: number[] = [];
  const lineStarts = buildLineStarts(text);
  const n = text.length;
  let truncated = false;
  const hasDoctype = startsWithDoctype(text);

  const top = (): HtmlSourceElement | undefined => {
    const index = stack[stack.length - 1];
    return index === undefined ? undefined : elements[index];
  };
  const markComment = () => {
    const current = top();
    if (current) {
      current.hasComment = true;
    }
  };
  /** Close everything above (and including) stack position `depth` as implied at `at`. */
  const popTo = (depth: number, at: number) => {
    while (stack.length > depth) {
      const index = stack.pop()!;
      const element = elements[index]!;
      element.closure = 'implied';
      element.end = at;
    }
  };
  /** The stack position of the nearest open `name`, searching down to a boundary. */
  const findOpen = (names: ReadonlySet<string> | string, stops: ReadonlySet<string>): number => {
    for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
      const element = elements[stack[depth]!]!;
      if (typeof names === 'string' ? element.tagName === names : names.has(element.tagName)) {
        return depth;
      }
      if (stops.has(element.tagName)) {
        return -1;
      }
    }
    return -1;
  };

  const openElement = (scan: TagScan, at: number): HtmlSourceElement | undefined => {
    const name = scan.name;
    let current = top();
    if (current?.foreign && FOREIGN_BREAKOUT.has(name)) {
      let depth = stack.length;
      while (depth > 0 && elements[stack[depth - 1]!]!.foreign) {
        depth -= 1;
      }
      popTo(depth, at);
      current = top();
    }
    const foreign = name === 'svg' || name === 'math' || current?.foreign === true;
    if (!foreign) {
      if (current?.tagName === 'head' && !HEAD_CONTENT.has(name)) {
        popTo(stack.length - 1, at);
      }
      if (name === 'body') {
        const head = findOpen('head', new Set());
        if (head !== -1) {
          popTo(head, at);
        }
      }
      if (name === 'li') {
        const open = findOpen('li', LIST_ITEM_STOPS);
        if (open !== -1) {
          popTo(open, at);
        }
      } else if (name === 'dd' || name === 'dt') {
        const open = findOpen(new Set(['dd', 'dt']), LIST_ITEM_STOPS);
        if (open !== -1) {
          popTo(open, at);
        }
      }
      // `<table>` closes a `<p>` only in standards mode, which a doctype selects.
      if (CLOSES_P.has(name) && (name !== 'table' || hasDoctype)) {
        const open = findOpen('p', SCOPE_BOUNDARIES);
        if (open !== -1) {
          popTo(open, at);
        }
      }
      if (HEADINGS.has(name) && top() && HEADINGS.has(top()!.tagName)) {
        popTo(stack.length - 1, at);
      }
      if (name === 'a' || name === 'button' || name === 'nobr') {
        const open = findOpen(name, name === 'button' ? SCOPE_BOUNDARIES : new Set(['table', 'html', 'template']));
        if (open !== -1) {
          popTo(open, at);
        }
      }
      if (name === 'option' || name === 'optgroup') {
        if (top()?.tagName === 'option') {
          popTo(stack.length - 1, at);
        }
        if (name === 'optgroup' && top()?.tagName === 'optgroup') {
          popTo(stack.length - 1, at);
        }
      }
      if (name === 'td' || name === 'th') {
        const open = findOpen(new Set(['td', 'th']), new Set(['table', 'html', 'template']));
        if (open !== -1) {
          popTo(open, at);
        }
      } else if (name === 'tr') {
        const open = findOpen(new Set(['tr', 'td', 'th']), new Set(['table', 'html', 'template']));
        if (open !== -1) {
          popTo(open, at);
        }
      } else if (name === 'tbody' || name === 'thead' || name === 'tfoot') {
        const open = findOpen(new Set(['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']), new Set(['table', 'html', 'template']));
        if (open !== -1) {
          popTo(open, at);
        }
      }
    }
    if (elements.length >= HTML_SOURCE_MAX_ELEMENTS || stack.length >= HTML_SOURCE_MAX_DEPTH) {
      truncated = true;
      return undefined;
    }
    const parentIndex = stack[stack.length - 1] ?? -1;
    const siblings = parentIndex === -1 ? roots : elements[parentIndex]!.children;
    const parentPath = parentIndex === -1 ? [] : elements[parentIndex]!.path;
    const path = [...parentPath, siblings.length];
    const element: HtmlSourceElement = {
      id: `e-${path.join('.')}-${at}`,
      tagName: name,
      path,
      parent: parentIndex,
      children: [],
      start: at,
      nameEnd: scan.nameEnd,
      startTagEnd: scan.end,
      end: scan.end,
      closure: 'unclosed',
      selfClosingSyntax: scan.selfClosing,
      attributes: scan.attributes,
      line: lineAt(lineStarts, at),
      foreign,
      hasComment: false,
    };
    const index = elements.length;
    elements.push(element);
    siblings.push(index);
    if (!foreign && HTML_VOID_ELEMENTS.has(name)) {
      element.closure = 'void';
      return element;
    }
    if (foreign && scan.selfClosing) {
      element.closure = 'self-closed';
      return element;
    }
    stack.push(index);
    return element;
  };

  const closeElement = (name: string, at: number, tagEnd: number) => {
    for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
      const element = elements[stack[depth]!]!;
      if (element.tagName === name) {
        popTo(depth + 1, at);
        stack.pop();
        element.closure = 'explicit';
        element.endTagStart = at;
        element.end = tagEnd;
        return;
      }
    }
    // A stray end tag closes nothing, as in a browser (which also ignores most).
  };

  let i = 0;
  while (i < n && !truncated) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      break;
    }
    i = lt;
    const next = text.charCodeAt(i + 1);
    if (text.startsWith('<!--', i)) {
      let end: number;
      if (text.startsWith('<!-->', i)) {
        end = i + 5;
      } else if (text.startsWith('<!--->', i)) {
        end = i + 6;
      } else {
        const close = text.indexOf('-->', i + 4);
        end = close === -1 ? n : close + 3;
      }
      markComment();
      i = end;
      continue;
    }
    if (next === 33 /* ! */ || next === 63 /* ? */) {
      if (top()?.foreign && text.startsWith('<![CDATA[', i)) {
        const close = text.indexOf(']]>', i + 9);
        i = close === -1 ? n : close + 3;
        continue;
      }
      const gt = text.indexOf('>', i + 2);
      markComment();
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    if (next === 47 /* / */) {
      if (isAsciiLetter(text.charCodeAt(i + 2))) {
        const scan = scanTag(text, i, i + 2);
        if (!scan) {
          break;
        }
        closeElement(scan.name, i, scan.end);
        i = scan.end;
        continue;
      }
      if (text.charCodeAt(i + 2) === 62) {
        i += 3;
        continue;
      }
      const gt = text.indexOf('>', i + 2);
      markComment();
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    if (isAsciiLetter(next)) {
      const scan = scanTag(text, i, i + 1);
      if (!scan) {
        break;
      }
      const element = openElement(scan, i);
      i = scan.end;
      if (!element || element.foreign || !HTML_RAW_TEXT_ELEMENTS.has(element.tagName) && element.tagName !== 'plaintext') {
        continue;
      }
      // Raw text: everything up to the matching end tag is text, not markup.
      stack.pop();
      if (element.tagName === 'plaintext') {
        element.closure = 'unclosed';
        element.end = n;
        i = n;
        continue;
      }
      const close = findRawTextEnd(text, i, element.tagName);
      if (close === -1) {
        element.closure = 'unclosed';
        element.end = n;
        i = n;
        continue;
      }
      const endScan = scanTag(text, close, close + 2);
      element.closure = 'explicit';
      element.endTagStart = close;
      element.end = endScan ? endScan.end : n;
      i = element.end;
      continue;
    }
    i += 1;
  }
  // Whatever is still open was closed by the end of the file.
  while (stack.length > 0) {
    const element = elements[stack.pop()!]!;
    element.closure = 'unclosed';
    element.end = n;
  }
  return {
    text,
    fingerprint: htmlSourceFingerprint(text),
    elements,
    roots,
    truncated,
    newline: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

/** Index of an element by id, or -1. The id's shape is checked first. */
export function findHtmlSourceElement(doc: HtmlSourceDocument, id: string): number {
  if (!HTML_ELEMENT_ID_PATTERN.test(id)) {
    return -1;
  }
  return doc.elements.findIndex(element => element.id === id);
}
