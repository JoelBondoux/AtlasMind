import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
// jsdom ships no type declarations, and `tsconfig.test.json` carries no DOM lib.
// @ts-expect-error -- no `@types/jsdom` in this repository
import { JSDOM } from 'jsdom';
import {
  findHtmlSourceElement,
  HTML_ELEMENT_ID_PATTERN,
  HTML_SOURCE_MAX_DEPTH,
  htmlSourceFingerprint,
  parseHtmlSource,
  startsWithDoctype,
  type HtmlSourceDocument,
} from '../../src/core/htmlSourceMap.ts';

describe('startsWithDoctype', () => {
  it.each([
    ['<!DOCTYPE html><p>', true],
    ['﻿  \n<!doctype html>', true],
    ['<!-- a --> <!-- b -->\n<!DocType html>', true],
    ['<!---->\n<!doctype html>', true],
    ['<!--> <!doctype html>', false],
    ['<!-- never closed <!doctype html>', false],
    ['<p><!doctype html>', false],
    ['', false],
  ])('%j → %s', (text, expected) => {
    expect(startsWithDoctype(text)).toBe(expected);
  });

  it('ends a comment at its first --> as a browser does, where the old regex could run on to a later one', () => {
    expect(startsWithDoctype('<!-- a --> x --> <!doctype html>')).toBe(false);
  });

  it('never finds a doctype the regex it replaced would not have found', () => {
    const legacy = /^﻿?\s*(?:<!--[\s\S]*?-->\s*)*<!doctype/i;
    const piece = fc.constantFrom('<!--', '-->', ' ', '\n', 'x', '<!doctype', '<!DOCTYPE html>', '﻿', '<p>');
    fc.assert(fc.property(fc.array(piece, { maxLength: 12 }), parts => {
      const text = parts.join('');
      if (startsWithDoctype(text)) {
        expect(legacy.test(text)).toBe(true);
      }
    }), { numRuns: 500 });
  });

  it('stays linear on the input that made the regex backtrack', () => {
    const hostile = `<!--${'--><!--'.repeat(50_000)}`;
    const started = Date.now();
    expect(startsWithDoctype(hostile)).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

/**
 * The parser's job is offsets: where each element's tags are in the file, so
 * an edit can change those bytes and no others. These pin the offsets, the
 * closure kinds an edit relies on, the tolerant cases a browser handles
 * without an error, and — against jsdom — that the elements it finds in a
 * well-formed page are the elements a browser finds.
 */

function tags(doc: HtmlSourceDocument): string[] {
  return doc.elements.map(element => element.tagName);
}

function byTag(doc: HtmlSourceDocument, tag: string, nth = 0) {
  const found = doc.elements.filter(element => element.tagName === tag)[nth];
  expect(found, tag).toBeDefined();
  return found!;
}

describe('offsets', () => {
  it('records start tag, end tag, attributes and line for each element', () => {
    const text = '<!doctype html>\n<body>\n  <h1 class="hero" id=top data-x=\'1\'>Hi</h1>\n</body>';
    const doc = parseHtmlSource(text);
    const h1 = byTag(doc, 'h1');
    expect(text.slice(h1.start, h1.startTagEnd)).toBe('<h1 class="hero" id=top data-x=\'1\'>');
    expect(text.slice(h1.endTagStart!, h1.end)).toBe('</h1>');
    expect(text.slice(h1.start, h1.nameEnd)).toBe('<h1');
    expect(h1.line).toBe(3);
    expect(h1.closure).toBe('explicit');
    expect(h1.attributes.map(attribute => [attribute.name, attribute.value?.quote, text.slice(attribute.value!.start, attribute.value!.end)]))
      .toEqual([['class', '"', 'hero'], ['id', '', 'top'], ['data-x', "'", '1']]);
    expect(h1.id).toBe(`e-0.0-${h1.start}`);
    expect(HTML_ELEMENT_ID_PATTERN.test(h1.id)).toBe(true);
    expect(findHtmlSourceElement(doc, h1.id)).toBe(doc.elements.indexOf(h1));
  });

  it('reads a bare attribute and keeps a `>` inside a quoted value', () => {
    const text = '<input disabled title="a > b"><p>x</p>';
    const doc = parseHtmlSource(text);
    const input = byTag(doc, 'input');
    expect(input.closure).toBe('void');
    expect(input.attributes[0]).toMatchObject({ name: 'disabled' });
    expect(input.attributes[0]!.value).toBeUndefined();
    expect(text.slice(input.start, input.end)).toBe('<input disabled title="a > b">');
    expect(tags(doc)).toEqual(['input', 'p']);
  });

  it('treats a raw-text element\'s contents as text, not markup', () => {
    const text = '<div><script>if (a < b) { document.write("<p>no</p>"); }</script><style>p>a{}</style><textarea><b>x</b></textarea></div>';
    const doc = parseHtmlSource(text);
    expect(tags(doc)).toEqual(['div', 'script', 'style', 'textarea']);
    expect(byTag(doc, 'script').closure).toBe('explicit');
    expect(byTag(doc, 'div').closure).toBe('explicit');
  });

  it('skips comments, doctypes and processing instructions, and marks the element they sit in', () => {
    const doc = parseHtmlSource('<!-- <div> --><p>a<!-- <span> -->b</p><?xml x?>');
    expect(tags(doc)).toEqual(['p']);
    expect(byTag(doc, 'p').hasComment).toBe(true);
  });

  it('closes an open p at a block, an li at the next li, and records both as implied', () => {
    const text = '<p>one<div>two</div><ul><li>a<li>b</ul>';
    const doc = parseHtmlSource(text);
    const p = byTag(doc, 'p');
    expect(p.closure).toBe('implied');
    expect(p.end).toBe(text.indexOf('<div>'));
    expect(byTag(doc, 'div').parent).toBe(-1);
    const [first, second] = [byTag(doc, 'li', 0), byTag(doc, 'li', 1)];
    expect(first.closure).toBe('implied');
    expect(second.closure).toBe('implied');
    expect(doc.elements[first.parent]!.tagName).toBe('ul');
    expect(doc.elements[second.parent]!.tagName).toBe('ul');
  });

  it('lets an end tag close what is open above its match, and ignores a stray one', () => {
    const text = '<div><span>a</div></em><p>b</p>';
    const doc = parseHtmlSource(text);
    expect(byTag(doc, 'span').closure).toBe('implied');
    expect(byTag(doc, 'div').closure).toBe('explicit');
    expect(byTag(doc, 'p').parent).toBe(-1);
  });

  it('closes what is still open at the end of the file as unclosed', () => {
    const doc = parseHtmlSource('<main><section><h2>x');
    expect(doc.elements.map(element => element.closure)).toEqual(['unclosed', 'unclosed', 'unclosed']);
  });

  it('honours self-closing syntax in SVG and ignores it in HTML', () => {
    const doc = parseHtmlSource('<div/><span>a</span><svg><path d="M0"/><g></g></svg>');
    expect(byTag(doc, 'div').closure).toBe('unclosed');
    expect(doc.elements[byTag(doc, 'span').parent]!.tagName).toBe('div');
    expect(byTag(doc, 'path')).toMatchObject({ closure: 'self-closed', foreign: true });
    expect(byTag(doc, 'g').foreign).toBe(true);
  });

  it('treats an unterminated tag at the end of the file as text', () => {
    const doc = parseHtmlSource('<p>a</p><div class="x');
    expect(tags(doc)).toEqual(['p']);
  });

  it('reports line endings and fingerprints the exact text', () => {
    expect(parseHtmlSource('<p>\r\n</p>').newline).toBe('\r\n');
    expect(parseHtmlSource('<p>\n</p>').newline).toBe('\n');
    const doc = parseHtmlSource('<p>a</p>');
    expect(doc.fingerprint).toBe(htmlSourceFingerprint('<p>a</p>'));
    expect(doc.fingerprint).not.toBe(htmlSourceFingerprint('<p>a</p> '));
  });

  it('is truncated past its depth bound rather than mapping part of a tree', () => {
    const doc = parseHtmlSource('<div>'.repeat(HTML_SOURCE_MAX_DEPTH + 5));
    expect(doc.truncated).toBe(true);
  });

  it('refuses a malformed id before looking anything up', () => {
    const doc = parseHtmlSource('<p>a</p>');
    expect(findHtmlSourceElement(doc, 'e-0-0')).toBe(0);
    expect(findHtmlSourceElement(doc, 'e-0-1')).toBe(-1);
    expect(findHtmlSourceElement(doc, 'p')).toBe(-1);
    expect(findHtmlSourceElement(doc, 'e-0-0"><script>')).toBe(-1);
  });
});

describe('total on anything', () => {
  it('never throws, and every element sits inside its file and its parent', () => {
    fc.assert(fc.property(fc.oneof(fc.string(), fc.stringMatching(/^[<>a-z/!"'= -]{0,80}$/)), text => {
      const doc = parseHtmlSource(text);
      for (const element of doc.elements) {
        expect(element.start).toBeGreaterThanOrEqual(0);
        expect(element.start).toBeLessThan(element.startTagEnd);
        expect(element.startTagEnd).toBeLessThanOrEqual(element.end);
        expect(element.end).toBeLessThanOrEqual(text.length);
        expect(text[element.start]).toBe('<');
        if (element.parent !== -1) {
          const parent = doc.elements[element.parent]!;
          expect(element.start).toBeGreaterThanOrEqual(parent.startTagEnd);
          expect(element.end).toBeLessThanOrEqual(parent.end);
        }
      }
    }), { numRuns: 400 });
  });
});

// ── Against a browser's parser ────────────────────────────────────

const FLOW = ['div', 'section', 'article', 'main', 'aside', 'nav', 'header', 'footer'] as const;
// No `a`: a link inside a link is not well-formed, and the browser's repair of
// it (the adoption agency) is not something this claims to reproduce.
const PHRASING = ['span', 'em', 'strong', 'b', 'code', 'small'] as const;

/** A well-formed fragment: flow containers holding paragraphs, lists and inline content. */
const fragment: fc.Arbitrary<string> = fc.letrec<{ flow: string; inline: string }>(tie => ({
  inline: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.stringMatching(/^[a-zA-Z ]{0,8}$/),
    fc.tuple(fc.constantFrom(...PHRASING), fc.array(tie('inline'), { maxLength: 2 }), fc.constantFrom('', ' class="x"', " title='t > s'"))
      .map(([tag, children, attribute]) => `<${tag}${attribute}>${children.join('')}</${tag}>`),
    fc.constant('<br>'),
    fc.constant('<img alt="a">'),
  ),
  flow: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.array(tie('inline'), { maxLength: 3 }).map(children => `<p>${children.join('')}</p>`),
    fc.array(fc.stringMatching(/^[a-z ]{0,6}$/), { minLength: 1, maxLength: 3 }).map(items => `<ul>${items.map(item => `<li>${item}</li>`).join('\n  ')}</ul>`),
    fc.tuple(fc.constantFrom(...FLOW), fc.array(tie('flow'), { maxLength: 3 }), fc.constantFrom('\n', '', '\n    '))
      .map(([tag, children, space]) => `<${tag}>${space}${children.join(space)}${space}</${tag}>`),
    fc.constant('<!-- note -->'),
  ),
})).flow;

describe('the elements a browser finds', () => {
  it('are the elements this finds, in the same order, in a well-formed page', () => {
    fc.assert(fc.property(fc.array(fragment, { minLength: 1, maxLength: 4 }), parts => {
      const body = parts.join('\n');
      const doc = parseHtmlSource(`<!doctype html><html><head></head><body>${body}</body></html>`);
      const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`);
      const browser = [...dom.window.document.querySelectorAll('*')].map((node: { tagName: string }) => node.tagName.toLowerCase());
      expect(tags(doc)).toEqual(browser);
      expect(doc.elements.every(element => element.closure === 'explicit' || element.closure === 'void')).toBe(true);
    }), { numRuns: 150 });
  });

  it('slices each element back out of the file exactly', () => {
    fc.assert(fc.property(fragment, body => {
      const doc = parseHtmlSource(body);
      for (const element of doc.elements) {
        const slice = body.slice(element.start, element.end);
        expect(slice.startsWith(`<${element.tagName}`)).toBe(true);
        if (element.closure === 'explicit') {
          expect(slice.endsWith(`</${element.tagName}>`)).toBe(true);
        }
      }
    }), { numRuns: 200 });
  });
});
