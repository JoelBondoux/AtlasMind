import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { htmlSourceFingerprint, parseHtmlSource, type HtmlSourceDocument } from '../../src/core/htmlSourceMap.ts';
import { WIREFRAME_KIND_CATALOG } from '../../src/core/websiteWireframe.ts';
import {
  applyHtmlEditPlan,
  decodeHtmlText,
  describeHtmlEditConfirmation,
  describeHtmlElement,
  HTML_CONTAINMENT_CUSTOM,
  HTML_CONTAINMENT_FALLBACK,
  HTML_CONTAINMENT_FOREIGN,
  HTML_CONTAINMENT_RULES,
  HTML_EDIT_RULES,
  HTML_INSERT_PALETTE,
  htmlContainmentRuleFor,
  htmlElementActions,
  htmlElementText,
  htmlInsertionPoints,
  planHtmlElementEdit,
  validateHtmlAttributeEdit,
  validateHtmlEditText,
  type HtmlEditPlan,
  type HtmlElementEdit,
  type ReadyHtmlEditPlan,
} from '../../src/core/uiSurfaceElementEdit.ts';

/**
 * Element editing on a real page: where a new element may go, which edits are
 * allowed, and the single splice each becomes. The properties that matter most
 * are walked rather than argued — every byte outside a patch is the file as it
 * was, re-parsing finds the edited element where the edit put it, and a plan
 * is refused against any file but the one it was planned from.
 */

/** Every element in the WHATWG HTML element index. */
const HTML_ELEMENT_INDEX = [
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br',
  'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn',
  'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label',
  'legend', 'li', 'link', 'main', 'map', 'mark', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup',
  'option', 'output', 'p', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
];

function element(doc: HtmlSourceDocument, tag: string, nth = 0) {
  const index = doc.elements.findIndex((candidate, at) => candidate.tagName === tag && doc.elements.slice(0, at).filter(prior => prior.tagName === tag).length === nth);
  expect(index, tag).toBeGreaterThan(-1);
  return { index, element: doc.elements[index]! };
}

function ready(plan: HtmlEditPlan): ReadyHtmlEditPlan {
  if (plan.status !== 'ready') {
    throw new Error(`refused (${plan.rule}): ${plan.reason}`);
  }
  return plan;
}

function apply(doc: HtmlSourceDocument, edit: HtmlElementEdit): string {
  const applied = applyHtmlEditPlan(doc.text, ready(planHtmlElementEdit(doc, edit)), htmlSourceFingerprint);
  if (applied.status !== 'applied') {
    throw new Error(applied.reason);
  }
  return applied.text;
}

describe('the containment table', () => {
  it('claims every element in the HTML index with a declared rule, and no element twice', () => {
    for (const tag of HTML_ELEMENT_INDEX) {
      expect(htmlContainmentRuleFor({ tagName: tag, foreign: false }).id, tag).not.toBe(HTML_CONTAINMENT_FALLBACK.id);
    }
    const claimed = HTML_CONTAINMENT_RULES.flatMap(rule => rule.tags);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('gives SVG, MathML, a custom element and an unknown one nothing', () => {
    expect(htmlContainmentRuleFor({ tagName: 'g', foreign: true })).toBe(HTML_CONTAINMENT_FOREIGN);
    expect(htmlContainmentRuleFor({ tagName: 'div', foreign: true })).toBe(HTML_CONTAINMENT_FOREIGN);
    expect(htmlContainmentRuleFor({ tagName: 'my-card', foreign: false })).toBe(HTML_CONTAINMENT_CUSTOM);
    expect(htmlContainmentRuleFor({ tagName: 'marquee', foreign: false })).toBe(HTML_CONTAINMENT_FALLBACK);
    for (const rule of [HTML_CONTAINMENT_FOREIGN, HTML_CONTAINMENT_CUSTOM, HTML_CONTAINMENT_FALLBACK]) {
      expect(rule.accepts).toEqual([]);
    }
  });

  it('lets nothing into a void, raw-text or structural element', () => {
    for (const tag of ['img', 'br', 'input', 'script', 'style', 'textarea', 'html', 'head', 'table', 'tr', 'select', 'dl']) {
      expect(htmlContainmentRuleFor({ tagName: tag, foreign: false }).accepts, tag).toEqual([]);
    }
    expect(htmlContainmentRuleFor({ tagName: 'ul', foreign: false }).accepts).toEqual(['list-item']);
    expect(htmlContainmentRuleFor({ tagName: 'p', foreign: false }).accepts).toEqual(['phrasing']);
    expect(htmlContainmentRuleFor({ tagName: 'section', foreign: false }).accepts).toEqual(['flow', 'phrasing']);
  });
});

describe('the palette', () => {
  it('is the Studio\'s blocks, each with an entry, plus a list item and a form field', () => {
    for (const spec of WIREFRAME_KIND_CATALOG) {
      expect(HTML_INSERT_PALETTE.some(entry => entry.id === spec.kind), spec.kind).toBe(true);
    }
    expect(HTML_INSERT_PALETTE.map(entry => entry.id)).toEqual(expect.arrayContaining(['list-item', 'form-field']));
  });

  it('has every category it uses accepted by some rule', () => {
    for (const entry of HTML_INSERT_PALETTE) {
      expect(HTML_CONTAINMENT_RULES.some(rule => rule.accepts.includes(entry.category)), entry.id).toBe(true);
    }
  });
});

describe('insertion points', () => {
  const doc = parseHtmlSource([
    '<body>',
    '  <main>',
    '    <p>Hello <a href="#">there</a></p>',
    '    <ul>',
    '      <li>One</li>',
    '    </ul>',
    '    <img alt="x">',
    '    <p>Unclosed',
    '  </main>',
    '</body>',
  ].join('\n'));

  it('offers inline content only inside a paragraph, list items only inside a list', () => {
    const p = element(doc, 'p');
    const inside = htmlInsertionPoints(doc, p.index).find(point => point.position === 'in')!;
    expect(inside.entries).toEqual(['media', 'cta', 'form-field']);
    const ul = element(doc, 'ul');
    expect(htmlInsertionPoints(doc, ul.index).find(point => point.position === 'in')!.entries).toEqual(['list-item']);
    const li = element(doc, 'li');
    expect(htmlInsertionPoints(doc, li.index).find(point => point.position === 'before')!.entries).toEqual(['list-item']);
  });

  it('never offers a link inside a link', () => {
    const a = element(doc, 'a');
    const inside = htmlInsertionPoints(doc, a.index).find(point => point.position === 'in')!;
    expect(inside.entries).not.toContain('cta');
    expect(inside.entries).not.toContain('form-field');
  });

  it('offers nothing inside a void element, and nothing inside or after an element whose end is implied', () => {
    const img = element(doc, 'img');
    expect(htmlInsertionPoints(doc, img.index).map(point => point.position)).toEqual(['before', 'after']);
    const unclosed = element(doc, 'p', 1);
    expect(unclosed.element.closure).toBe('implied');
    expect(htmlInsertionPoints(doc, unclosed.index).map(point => point.position)).toEqual(['before']);
  });

  it('offers nothing beside a top-level element, and nothing in a truncated map', () => {
    const body = element(doc, 'body');
    expect(htmlInsertionPoints(doc, body.index).map(point => point.position)).toEqual(['in']);
    expect(htmlInsertionPoints({ ...doc, truncated: true }, body.index)).toEqual([]);
  });
});

describe('the attribute allowlist', () => {
  it('sets labels and classes anywhere, and nothing that could run', () => {
    expect(validateHtmlAttributeEdit('div', 'class', 'a b')).toBeUndefined();
    expect(validateHtmlAttributeEdit('div', 'aria-label', 'Main')).toBeUndefined();
    expect(validateHtmlAttributeEdit('img', 'alt', 'A cat')).toBeUndefined();
    for (const name of ['onclick', 'onload', 'style', 'srcdoc', 'action', 'formaction', 'srcset', 'data-x']) {
      expect(validateHtmlAttributeEdit('div', name, 'x'), name).toMatch(/not an attribute/);
    }
    expect(validateHtmlAttributeEdit('div', 'id', 'has space')).toBeDefined();
    expect(validateHtmlAttributeEdit('div', 'title', 'line\nbreak')).toBeDefined();
  });

  it('sets href only on a link, https or relative', () => {
    expect(validateHtmlAttributeEdit('a', 'href', 'https://example.com/x')).toBeUndefined();
    for (const value of ['about.html', '../up.html', '/root', '#top', '?q=1']) {
      expect(validateHtmlAttributeEdit('a', 'href', value), value).toBeUndefined();
    }
    for (const value of ['javascript:alert(1)', 'JaVaScRiPt:x', 'http://example.com', '//evil.example', 'data:text/html,x', 'mailto:a@b', '\\\\evil', 'a b', 'https://']) {
      expect(validateHtmlAttributeEdit('a', 'href', value), value).toBeDefined();
    }
    expect(validateHtmlAttributeEdit('div', 'href', 'x.html')).toMatch(/not an attribute/);
  });

  it('sets src only on an image or media source, relative only — never on a script or frame', () => {
    expect(validateHtmlAttributeEdit('img', 'src', 'img/cat.png')).toBeUndefined();
    expect(validateHtmlAttributeEdit('img', 'src', 'https://cdn.example/cat.png')).toBeDefined();
    expect(validateHtmlAttributeEdit('img', 'src', '')).toBeDefined();
    for (const tag of ['script', 'iframe', 'embed', 'frame', 'object']) {
      expect(validateHtmlAttributeEdit(tag, 'src', 'x.js'), tag).toMatch(/not an attribute/);
    }
  });

  it('accepts plain text and refuses control characters', () => {
    expect(validateHtmlEditText('Hello <world> & you')).toBeUndefined();
    expect(validateHtmlEditText('a\u0000b')).toBeDefined();
    expect(validateHtmlEditText('x'.repeat(2_001))).toBeDefined();
  });
});

describe('decoding text', () => {
  it('decodes the references a person expects and refuses one it does not know', () => {
    expect(decodeHtmlText('Fish &amp; chips &copy; &#8212; &#x2014;')).toEqual({ status: 'decoded', text: 'Fish & chips \u00a9 \u2014 \u2014' });
    expect(decodeHtmlText('A &zwnj; B')).toMatchObject({ status: 'unknown-reference', reference: '&zwnj;' });
    expect(decodeHtmlText('&copy 2026')).toMatchObject({ status: 'unknown-reference' });
    expect(decodeHtmlText('a & b')).toEqual({ status: 'decoded', text: 'a & b' });
  });
});

describe('changing text', () => {
  it('replaces only the text, keeping the whitespace around it and escaping the new text', () => {
    const text = '<div>\n  <h1>\n    Welcome\n  </h1>\n</div>\n';
    const doc = parseHtmlSource(text);
    const h1 = element(doc, 'h1');
    expect(htmlElementText(doc, h1.index)).toEqual({ status: 'ok', text: 'Welcome' });
    const next = apply(doc, { kind: 'set-text', elementId: h1.element.id, text: 'Tom & <Jerry>' });
    expect(next).toBe('<div>\n  <h1>\n    Tom &amp; &lt;Jerry&gt;\n  </h1>\n</div>\n');
  });

  it('refuses an element with elements or comments in it, an implied end, and a reference it cannot show', () => {
    const doc = parseHtmlSource('<p>a <b>b</b></p><p>c<!-- x --></p><p>open<div></div><p>&zwnj;</p><script>x</script>');
    const refusals = [0, 1, 2, 3].map(nth => planHtmlElementEdit(doc, { kind: 'set-text', elementId: element(doc, 'p', nth).element.id, text: 'z' }));
    expect(refusals.map(plan => plan.status === 'refused' ? plan.rule : 'ready')).toEqual(['text-only', 'text-only', 'written-end', 'decodable-text']);
    expect(planHtmlElementEdit(doc, { kind: 'set-text', elementId: element(doc, 'script').element.id, text: 'z' })).toMatchObject({ status: 'refused', rule: 'text-only' });
  });

  it('refuses inside SVG, on a stale id, and in a truncated map', () => {
    const doc = parseHtmlSource('<svg><text>hi</text></svg><p>a</p>');
    expect(planHtmlElementEdit(doc, { kind: 'set-text', elementId: element(doc, 'text').element.id, text: 'z' })).toMatchObject({ rule: 'html-only' });
    expect(planHtmlElementEdit(doc, { kind: 'set-text', elementId: 'e-9-999', text: 'z' })).toMatchObject({ rule: 'id-current' });
    expect(planHtmlElementEdit({ ...doc, truncated: true }, { kind: 'set-text', elementId: element(doc, 'p').element.id, text: 'z' })).toMatchObject({ rule: 'map-complete' });
  });
});

describe('attributes', () => {
  it('keeps the quote style of an existing value and escapes for it', () => {
    const doc = parseHtmlSource('<a class=\'old\' href="x.html">a</a>');
    const a = element(doc, 'a');
    expect(apply(doc, { kind: 'set-attribute', elementId: a.element.id, name: 'class', value: "it's new" }))
      .toBe('<a class=\'it&#39;s new\' href="x.html">a</a>');
    expect(apply(doc, { kind: 'set-attribute', elementId: a.element.id, name: 'href', value: 'https://example.com/?a=1&b="2"' }))
      .toBe('<a class=\'old\' href="https://example.com/?a=1&amp;b=&quot;2&quot;">a</a>');
  });

  it('adds a new one after the last attribute, and rewrites a bare or unquoted one as quoted', () => {
    const doc = parseHtmlSource('<img src=cat.png >\n<div TITLE>x</div>');
    expect(apply(doc, { kind: 'set-attribute', elementId: element(doc, 'img').element.id, name: 'alt', value: 'A cat' }))
      .toBe('<img src=cat.png alt="A cat" >\n<div TITLE>x</div>');
    expect(apply(doc, { kind: 'set-attribute', elementId: element(doc, 'img').element.id, name: 'src', value: 'dog.png' }))
      .toBe('<img src="dog.png" >\n<div TITLE>x</div>');
    expect(apply(doc, { kind: 'set-attribute', elementId: element(doc, 'div').element.id, name: 'title', value: 'T' }))
      .toBe('<img src=cat.png >\n<div TITLE="T">x</div>');
  });

  it('removes one with the whitespace before it, and refuses one written twice or off the allowlist', () => {
    const doc = parseHtmlSource('<p class="a"\n   id="b">x</p><p id=1 id=2>y</p>');
    expect(apply(doc, { kind: 'remove-attribute', elementId: element(doc, 'p').element.id, name: 'id' })).toBe('<p class="a">x</p><p id=1 id=2>y</p>');
    expect(planHtmlElementEdit(doc, { kind: 'set-attribute', elementId: element(doc, 'p', 1).element.id, name: 'id', value: '3' })).toMatchObject({ rule: 'single-declaration' });
    expect(planHtmlElementEdit(doc, { kind: 'set-attribute', elementId: element(doc, 'p').element.id, name: 'onclick', value: 'x()' })).toMatchObject({ rule: 'attribute-allowlist' });
    expect(planHtmlElementEdit(doc, { kind: 'set-attribute', elementId: element(doc, 'p').element.id, name: 'id', value: 'a b' })).toMatchObject({ rule: 'attribute-value' });
  });
});

describe('inserting', () => {
  it('gives a new child its own line, indented like its siblings, above the end tag', () => {
    const text = '<section>\n    <h2>A</h2>\n    <p>B</p>\n</section>\n';
    const doc = parseHtmlSource(text);
    const section = element(doc, 'section');
    expect(apply(doc, { kind: 'insert', pointId: `${section.element.id}:in`, entryId: 'text', text: 'C & D' }))
      .toBe('<section>\n    <h2>A</h2>\n    <p>B</p>\n    <p>C &amp; D</p>\n</section>\n');
  });

  it('steps in one unit from the parent when there are no children, in tabs or CRLF as the file has them', () => {
    const tabs = parseHtmlSource('<body>\r\n\t<main>\r\n\t</main>\r\n</body>');
    expect(apply(tabs, { kind: 'insert', pointId: `${element(tabs, 'main').element.id}:in`, entryId: 'custom', text: 'x' }))
      .toBe('<body>\r\n\t<main>\r\n\t\t<div>x</div>\r\n\t</main>\r\n</body>');
  });

  it('inserts before and after on lines of their own when the element has one', () => {
    const doc = parseHtmlSource('<ul>\n  <li>One</li>\n</ul>');
    const li = element(doc, 'li');
    expect(apply(doc, { kind: 'insert', pointId: `${li.element.id}:before`, entryId: 'list-item', text: 'Zero' }))
      .toBe('<ul>\n  <li>Zero</li>\n  <li>One</li>\n</ul>');
    expect(apply(doc, { kind: 'insert', pointId: `${li.element.id}:after`, entryId: 'list-item', text: 'Two' }))
      .toBe('<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>');
  });

  it('inserts inline where the end tag is inline, with a space after text', () => {
    const doc = parseHtmlSource('<p>Read more</p>');
    expect(apply(doc, { kind: 'insert', pointId: `${element(doc, 'p').element.id}:in`, entryId: 'cta', text: 'here' }))
      .toBe('<p>Read more <a class="cta" href="#">here</a></p>');
  });

  it('refuses what the parent does not take, and says why', () => {
    const doc = parseHtmlSource('<ul><li>a</li></ul><p>x</p><a href="#">y</a><html-thing>z</html-thing>');
    expect(planHtmlElementEdit(doc, { kind: 'insert', pointId: `${element(doc, 'ul').element.id}:in`, entryId: 'text', text: 'x' })).toMatchObject({ status: 'refused', rule: 'containment' });
    expect(planHtmlElementEdit(doc, { kind: 'insert', pointId: `${element(doc, 'p').element.id}:in`, entryId: 'section', text: 'x' })).toMatchObject({ rule: 'containment' });
    expect(planHtmlElementEdit(doc, { kind: 'insert', pointId: `${element(doc, 'html-thing').element.id}:in`, entryId: 'cta', text: 'x' })).toMatchObject({ rule: 'containment' });
    expect(planHtmlElementEdit(doc, { kind: 'insert', pointId: `${element(doc, 'p').element.id}:after`, entryId: 'text', text: 'x' })).toMatchObject({ rule: 'containment' });
    expect(planHtmlElementEdit(doc, { kind: 'insert', pointId: `${element(doc, 'p').element.id}:in`, entryId: 'nonsense', text: 'x' })).toMatchObject({ rule: 'containment' });
  });

  it('writes an image\'s text as an attribute value, escaped as one', () => {
    const doc = parseHtmlSource('<div></div>');
    expect(apply(doc, { kind: 'insert', pointId: `${element(doc, 'div').element.id}:in`, entryId: 'media', text: 'A "cat" & <dog>' }))
      .toBe('<div><img alt="A &quot;cat&quot; &amp; &lt;dog>"></div>');
  });
});

describe('removing and moving', () => {
  it('takes the whole line when the element had it to itself, and only the element otherwise', () => {
    const doc = parseHtmlSource('<div>\n  <p>A</p>\n  <p>B</p> <span>C</span>\n</div>');
    expect(apply(doc, { kind: 'remove', elementId: element(doc, 'p').element.id })).toBe('<div>\n  <p>B</p> <span>C</span>\n</div>');
    expect(apply(doc, { kind: 'remove', elementId: element(doc, 'span').element.id })).toBe('<div>\n  <p>A</p>\n  <p>B</p> \n</div>');
  });

  it('swaps an element with its sibling and leaves the whitespace between them where it was', () => {
    const doc = parseHtmlSource('<ul>\n  <li>One</li>\n  <!-- x -->\n  <li>Two</li>\n</ul>');
    const two = element(doc, 'li', 1);
    expect(apply(doc, { kind: 'move', elementId: two.element.id, direction: 'up' })).toBe('<ul>\n  <li>Two</li>\n  <!-- x -->\n  <li>One</li>\n</ul>');
    expect(planHtmlElementEdit(doc, { kind: 'move', elementId: two.element.id, direction: 'down' })).toMatchObject({ rule: 'adjacent-sibling' });
  });

  it('refuses to move across text, to remove the document\'s structure, or to remove an element whose end is implied', () => {
    const doc = parseHtmlSource('<body><p>a</p> and <p>b</p><ul><li>x<li>y</ul></body>');
    expect(planHtmlElementEdit(doc, { kind: 'move', elementId: element(doc, 'p', 1).element.id, direction: 'up' })).toMatchObject({ rule: 'adjacent-sibling' });
    expect(planHtmlElementEdit(doc, { kind: 'remove', elementId: element(doc, 'body').element.id })).toMatchObject({ rule: 'structure-kept' });
    expect(planHtmlElementEdit(doc, { kind: 'remove', elementId: element(doc, 'li').element.id })).toMatchObject({ rule: 'written-end' });
  });

  it('reads a comment as ending at its first -->, so text after it is text and the move is refused', () => {
    const doc = parseHtmlSource('<div><p>a</p><!-- c --> x --><p>b</p></div>');
    expect(planHtmlElementEdit(doc, { kind: 'move', elementId: element(doc, 'p', 1).element.id, direction: 'up' })).toMatchObject({ rule: 'adjacent-sibling' });
  });

  it('stays linear when the gap between two siblings is the input that made the old regex backtrack', () => {
    const doc = parseHtmlSource(`<div><p>a</p><!--${'--><!--'.repeat(20_000)}--> x <p>b</p></div>`);
    const started = Date.now();
    const plan = planHtmlElementEdit(doc, { kind: 'move', elementId: element(doc, 'p', 1).element.id, direction: 'up' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(plan).toMatchObject({ rule: 'adjacent-sibling' });
  });
});

describe('divergence', () => {
  it('refuses a plan against a file that changed, anywhere, since it was planned', () => {
    const doc = parseHtmlSource('<p>a</p>\n<p>b</p>');
    const plan = ready(planHtmlElementEdit(doc, { kind: 'set-text', elementId: element(doc, 'p', 1).element.id, text: 'c' }));
    expect(applyHtmlEditPlan('<p>a</p>\n<p>b</p>', plan, htmlSourceFingerprint).status).toBe('applied');
    expect(applyHtmlEditPlan('<p>A</p>\n<p>b</p>', plan, htmlSourceFingerprint)).toMatchObject({ status: 'diverged' });
    expect(applyHtmlEditPlan('<p>a</p>\n<p>b</p>\n', plan, htmlSourceFingerprint)).toMatchObject({ status: 'diverged' });
  });

  it('refuses when the bytes it replaces are not the ones planned, even under a matching fingerprint', () => {
    const doc = parseHtmlSource('<p>a</p>');
    const plan = ready(planHtmlElementEdit(doc, { kind: 'set-text', elementId: element(doc, 'p').element.id, text: 'c' }));
    expect(applyHtmlEditPlan('<p>a</p>', { ...plan, patch: { ...plan.patch, original: 'z' } }, htmlSourceFingerprint)).toMatchObject({ status: 'diverged' });
  });
});

describe('the confirmation and the menu', () => {
  it('shows the whole lines before and after, with control and bidi characters made visible', () => {
    const doc = parseHtmlSource('<main>\n  <h1>Old \u202etitle</h1>\n</main>');
    const plan = ready(planHtmlElementEdit(doc, { kind: 'set-text', elementId: element(doc, 'h1').element.id, text: 'New' }));
    const { title, detail } = describeHtmlEditConfirmation('site/index.html', plan, doc.text);
    expect(title).toBe('Edit site/index.html: change the text of <h1>?');
    expect(detail).toContain('Line 2 of site/index.html.');
    expect(detail).toContain('Before:\n  <h1>Old \\u{202e}title</h1>');
    expect(detail).toContain('After:\n  <h1>New</h1>');
    expect(detail).not.toContain('\u202e');
  });

  it('lists every action, each available or with the rule that refuses it', () => {
    const doc = parseHtmlSource('<body>\n  <ul>\n    <li>A</li>\n  </ul>\n</body>');
    const actions = htmlElementActions(doc, element(doc, 'li').index);
    expect(actions.map(action => action.id)).toEqual(['set-text', 'set-attribute', 'remove-attribute', 'insert-before', 'insert-in', 'insert-after', 'move-up', 'move-down', 'remove']);
    const byId = Object.fromEntries(actions.map(action => [action.id, action]));
    expect(byId['set-text']!.available).toBe(true);
    expect(byId['remove-attribute']).toMatchObject({ available: false, reason: expect.stringContaining('(attribute-allowlist)') });
    expect(byId['move-up']).toMatchObject({ available: false, reason: expect.stringContaining('(adjacent-sibling)') });
    expect(describeHtmlElement(doc, element(doc, 'li').index)).toBe('<li> · line 3 — “A”');
    for (const action of actions.filter(entry => !entry.available)) {
      expect(HTML_EDIT_RULES.some(rule => action.reason!.includes(`(${rule.id})`)), action.id).toBe(true);
    }
  });
});

// ── Properties ────────────────────────────────────────────────────

const word = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,10}$/);
const indent = fc.constantFrom('', '  ', '    ', '\t');
const newline = fc.constantFrom('\n', '\r\n');

/** A page of sections holding headings and paragraphs, in the author's own spacing. */
const page = fc.tuple(fc.array(fc.tuple(fc.constantFrom('section', 'div', 'article'), fc.array(fc.tuple(fc.constantFrom('h2', 'p', 'span'), word), { minLength: 1, maxLength: 4 })), { minLength: 1, maxLength: 4 }), indent, newline)
  .map(([blocks, unit, nl]) => `<body>${nl}${blocks.map(([tag, children]) =>
    `${unit}<${tag} class="b">${nl}${children.map(([child, text]) => `${unit}${unit}<${child}>${text}</${child}>`).join(nl)}${nl}${unit}</${tag}>`).join(nl)}${nl}</body>${nl}`);

function outsideUnchanged(before: string, after: string, plan: ReadyHtmlEditPlan): void {
  expect(after.slice(0, plan.patch.start)).toBe(before.slice(0, plan.patch.start));
  expect(after.slice(plan.patch.start + plan.patch.replacement.length)).toBe(before.slice(plan.patch.end));
}

describe('properties', () => {
  it('a text edit changes only its patch, and re-parsing finds the element where it was with the new text', () => {
    fc.assert(fc.property(page, fc.nat(), fc.stringMatching(/^[^\u0000-\u001f\u007f]{0,30}$/), (text, pick, replacement) => {
      const doc = parseHtmlSource(text);
      const leaves = doc.elements.map((_, index) => index).filter(index => ['h2', 'p', 'span'].includes(doc.elements[index]!.tagName));
      const index = leaves[pick % leaves.length]!;
      const plan = ready(planHtmlElementEdit(doc, { kind: 'set-text', elementId: doc.elements[index]!.id, text: replacement }));
      const applied = applyHtmlEditPlan(text, plan, htmlSourceFingerprint);
      expect(applied.status).toBe('applied');
      const next = applied.status === 'applied' ? applied.text : '';
      outsideUnchanged(text, next, plan);
      const reparsed = parseHtmlSource(next);
      const same = reparsed.elements.findIndex(candidate => candidate.path.join('.') === doc.elements[index]!.path.join('.'));
      expect(reparsed.elements[same]!.tagName).toBe(doc.elements[index]!.tagName);
      expect(htmlElementText(reparsed, same)).toEqual({ status: 'ok', text: replacement.trim() });
      expect(reparsed.elements.length).toBe(doc.elements.length);
    }), { numRuns: 250 });
  });

  it('an insertion changes only its patch, and re-parsing finds the new element at the point', () => {
    fc.assert(fc.property(page, fc.nat(), fc.constantFrom('before', 'in', 'after'), word, (text, pick, position, label) => {
      const doc = parseHtmlSource(text);
      const index = pick % doc.elements.length;
      const point = htmlInsertionPoints(doc, index).find(candidate => candidate.position === position);
      fc.pre(point !== undefined);
      const entryId = point!.entries.includes('text') ? 'text' : point!.entries[0]!;
      const plan = ready(planHtmlElementEdit(doc, { kind: 'insert', pointId: point!.id, entryId, text: label }));
      const applied = applyHtmlEditPlan(text, plan, htmlSourceFingerprint);
      const next = applied.status === 'applied' ? applied.text : '';
      outsideUnchanged(text, next, plan);
      const reparsed = parseHtmlSource(next);
      const target = doc.elements[index]!;
      const parentPath = position === 'in' ? target.path : target.path.slice(0, -1);
      const childAt = position === 'in'
        ? target.children.length
        : position === 'before' ? target.path[target.path.length - 1]! : target.path[target.path.length - 1]! + 1;
      const inserted = reparsed.elements.find(candidate => candidate.path.join('.') === [...parentPath, childAt].join('.'));
      const entry = HTML_INSERT_PALETTE.find(candidate => candidate.id === entryId)!;
      expect(inserted?.tagName).toBe(/^<([a-z]+)/.exec(entry.open)![1]);
      expect(reparsed.elements.every(candidate => candidate.closure === 'explicit' || candidate.closure === 'void')).toBe(true);
    }), { numRuns: 250 });
  });

  it('setting an attribute changes only its patch, and re-parsing reads the value back', () => {
    fc.assert(fc.property(page, fc.nat(), fc.constantFrom('class', 'title', 'aria-label', 'id'), fc.stringMatching(/^[A-Za-z0-9&"'<>_-]{1,20}$/), (text, pick, name, value) => {
      const doc = parseHtmlSource(text);
      const index = pick % doc.elements.length;
      const plan = planHtmlElementEdit(doc, { kind: 'set-attribute', elementId: doc.elements[index]!.id, name, value });
      fc.pre(plan.status === 'ready');
      const readyPlan = plan as ReadyHtmlEditPlan;
      const applied = applyHtmlEditPlan(text, readyPlan, htmlSourceFingerprint);
      const next = applied.status === 'applied' ? applied.text : '';
      outsideUnchanged(text, next, readyPlan);
      const reparsed = parseHtmlSource(next);
      const attribute = reparsed.elements[index]!.attributes.find(candidate => candidate.name === name)!;
      expect(decodeHtmlText(next.slice(attribute.value!.start, attribute.value!.end))).toEqual({ status: 'decoded', text: value });
    }), { numRuns: 250 });
  });
});
