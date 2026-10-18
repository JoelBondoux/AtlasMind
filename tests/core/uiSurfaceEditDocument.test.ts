import { describe, expect, it } from 'vitest';
// jsdom ships no type declarations, and `tsconfig.test.json` carries no DOM lib —
// so nothing reached through the mounted window is typed here.
// @ts-expect-error -- no `@types/jsdom` in this repository
import { JSDOM } from 'jsdom';
import { parseHtmlSource } from '../../src/core/htmlSourceMap.ts';
import { UI_SURFACE_RENDER_FALLBACK, UI_SURFACE_RENDER_RULES } from '../../src/core/uiSurfaceRender.ts';
import {
  buildEditableSurfaceCsp,
  buildEditableSurfaceDocument,
  describeUiSurfaceEditRender,
  isUiSurfaceEditMessage,
  renderRulesWithoutEditSupport,
  UI_SURFACE_EDIT_SUPPORT,
  UI_SURFACE_SELECT_SCRIPT,
  uiSurfaceEditSupport,
} from '../../src/core/uiSurfaceEditDocument.ts';

/**
 * The page a person selects elements in. Its one script is AtlasMind's: the
 * page's own scripts, handlers and script URLs are left out of the document,
 * the policy admits only the render's nonce, and every mapped element carries
 * the host's id first so a label the file wrote cannot redirect a selection.
 * The selection script is executed here, in jsdom, rather than only read.
 */

type Mounted = ReturnType<typeof Object.create>;

const NONCE = 'abcdefabcdefabcdef0123456789abcd';
const PAGE = [
  '<!doctype html>',
  '<html><head><title>T</title><script>window.__ran = true;</script><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"></head>',
  '<body onload="window.__ran = true">',
  '  <main data-atlas-el="e-0-0">',
  '    <h1 class="hero">Welcome</h1>',
  '    <a href="javascript:window.__ran=true">bad</a> <a href="&#106;avascript:x">encoded</a> <a href="about.html" onclick="window.__ran = true">ok</a>',
  '    <form><button>Send</button></form>',
  '    <ul><li>One</li></ul>',
  '  </main>',
  '</body></html>',
].join('\n');

function build(text = PAGE) {
  return buildEditableSurfaceDocument({ doc: parseHtmlSource(text), baseHref: 'https://file+.vscode-resource.test/site', cspSource: 'https://file+.vscode-resource.test', nonce: NONCE });
}

describe('the editable document', () => {
  it('leaves the page\'s scripts, handlers, script URLs, base and refresh out of what is shown', () => {
    const { html, removedScripts, removedHandlers } = build();
    expect(html).not.toContain('window.__ran = true;</script>');
    expect(html).not.toMatch(/onload=|onclick=/);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('&#106;avascript');
    expect(html).not.toContain('evil.example');
    expect(removedScripts).toBe(1);
    expect(removedHandlers).toBe(4);
    expect(html).toContain('href="about.html"');
  });

  it('keeps a raster data: image and removes every other data: URL, however it is spelled', () => {
    const { html } = build([
      '<!doctype html><body>',
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="kept">',
      '<img src="data:image/svg+xml,%3Csvg%3E" alt="svg">',
      '<iframe src="data:application/xhtml+xml,%3Chtml%3E"></iframe>',
      '<object data="DATA:text/xml,%3Cx%3E"></object>',
      '<a href="&#100;ata:text/html,%3Cp%3E">encoded</a>',
      '</body>',
    ].join('\n'));
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).not.toContain('image/svg+xml');
    expect(html).not.toContain('application/xhtml+xml');
    expect(html).not.toContain('text/xml');
    expect(html).not.toContain('&#100;ata:');
  });

  it('stays linear on a page that opens with the input that made the old doctype regex backtrack', () => {
    const started = Date.now();
    const { html } = build(`<!--${'--><!--'.repeat(20_000)}<p>x</p>`);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(html.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it('puts a nonce policy, a base and the selection script first, after the doctype', () => {
    const { html } = build();
    expect(html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    const csp = buildEditableSurfaceCsp('https://file+.vscode-resource.test', NONCE);
    expect(csp).toContain(`script-src 'nonce-${NONCE}'`);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toMatch(/script-src 'nonce-[a-z0-9]+';/);
    expect(csp).toContain("form-action 'none'");
    expect(html).toContain(`<script nonce="${NONCE}">`);
    expect(() => buildEditableSurfaceCsp('x', 'short')).toThrow();
    expect(() => buildEditableSurfaceCsp('x', `${NONCE}' 'unsafe-inline`)).toThrow();
  });

  it('labels every mapped element with its id as the first attribute, and drops labels the file wrote', () => {
    const text = PAGE;
    const doc = parseHtmlSource(text);
    const { html, selectable } = build(text);
    const main = doc.elements.find(element => element.tagName === 'main')!;
    expect(html).toContain(`<main data-atlas-el="${main.id}" data-atlas-before="${main.id}:before" data-atlas-in="${main.id}:in" data-atlas-after="${main.id}:after">`);
    expect(html).not.toContain('data-atlas-el="e-0-0"');
    // Everything but the script, the base and the refresh, which are not shown at all.
    expect(selectable).toBe(doc.elements.length - 3);
    const ul = doc.elements.find(element => element.tagName === 'ul')!;
    expect(html).toContain(`<ul data-atlas-el="${ul.id}" data-atlas-before="${ul.id}:before" data-atlas-in="${ul.id}:in" data-atlas-after="${ul.id}:after">`);
  });

  it('labels nothing in a page too large to map, and says so', () => {
    const doc = { ...parseHtmlSource('<p>a</p>'), truncated: true };
    const editable = buildEditableSurfaceDocument({ doc, baseHref: 'x', cspSource: 'x', nonce: NONCE });
    expect(editable.html).not.toMatch(/<p data-atlas-el/);
    expect(describeUiSurfaceEditRender({ path: 'a.html', modifiedAt: 't', document: editable })).toContain('nothing in it is offered for editing');
  });

  it('notes a policy the page declares itself, which may block selection', () => {
    const editable = build('<meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><p>a</p>');
    expect(editable.declaresOwnPolicy).toBe(true);
    expect(describeUiSurfaceEditRender({ path: 'a.html', modifiedAt: 't', document: editable })).toContain('declares its own Content-Security-Policy');
  });

  it('carries a selection script that cannot be ended or interpolated by markup', () => {
    expect(UI_SURFACE_SELECT_SCRIPT).not.toMatch(/<\/script|<!--/i);
    expect(UI_SURFACE_SELECT_SCRIPT).not.toContain('${');
    expect(UI_SURFACE_SELECT_SCRIPT).not.toMatch(/\beval\b|new Function|outerHTML|insertAdjacentHTML|document\.write/);
    // One markup assignment, of a constant, into AtlasMind's own shadow root.
    expect(UI_SURFACE_SELECT_SCRIPT.match(/innerHTML/g)).toEqual(['innerHTML']);
    expect(UI_SURFACE_SELECT_SCRIPT).toContain("shadow.innerHTML = '<style>'");
  });
});

describe('edit support', () => {
  it('has exactly one row per render rule, and edits only a static page', () => {
    expect(renderRulesWithoutEditSupport()).toEqual([]);
    const ids = [...UI_SURFACE_RENDER_RULES, UI_SURFACE_RENDER_FALLBACK].map(rule => rule.id);
    expect(UI_SURFACE_EDIT_SUPPORT.map(row => row.renderRuleId).sort()).toEqual([...ids].sort());
    expect(UI_SURFACE_EDIT_SUPPORT.filter(row => row.supported).map(row => row.renderRuleId)).toEqual(['static-html']);
    expect(uiSurfaceEditSupport('framework-component').statement).toMatch(/not supported for components/);
    expect(uiSurfaceEditSupport('made-up').supported).toBe(false);
  });
});

describe('messages from the page', () => {
  it('accept an element id or a point id and nothing else', () => {
    expect(isUiSurfaceEditMessage({ type: 'ready' })).toBe(true);
    expect(isUiSurfaceEditMessage({ type: 'listElements' })).toBe(true);
    expect(isUiSurfaceEditMessage({ type: 'selectElement', payload: { elementId: 'e-0.1-12' } })).toBe(true);
    expect(isUiSurfaceEditMessage({ type: 'insertAt', payload: { pointId: 'e-0.1-12:in' } })).toBe(true);
    for (const bad of [
      { type: 'selectElement', payload: { elementId: 'e-0.1-12', text: 'x' } },
      { type: 'selectElement', payload: { elementId: '../index.html' } },
      { type: 'selectElement', payload: { elementId: 'e-0.1-12' }, extra: 1 },
      { type: 'insertAt', payload: { pointId: 'e-0.1-12:inside' } },
      { type: 'insertAt', payload: { pointId: 'e-0.1-12' } },
      { type: 'setText', payload: { elementId: 'e-0-1', text: 'x' } },
      { type: 'ready', payload: {} },
      null, 'selectElement', [],
    ]) {
      expect(isUiSurfaceEditMessage(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

// ── Executed ──────────────────────────────────────────────────────

async function mount() {
  const posted: unknown[] = [];
  const { html } = build();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    beforeParse(window: Mounted) {
      // Through JSON, as a real postMessage would, so the page's realm stays behind.
      window.acquireVsCodeApi = () => ({ postMessage: (message: unknown) => posted.push(JSON.parse(JSON.stringify(message))) });
      window.Element.prototype.scrollIntoView = () => undefined;
    },
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  return { window: dom.window as Mounted, document: dom.window.document as Mounted, posted };
}

describe('the selection script, executed', () => {
  it('runs alone: the page\'s own scripts and handlers never ran', async () => {
    const { window, posted } = await mount();
    expect(window.__ran).toBeUndefined();
    expect(posted).toContainEqual({ type: 'ready' });
  });

  it('posts the id of the element clicked, and nothing about it but the id', async () => {
    const { document, posted } = await mount();
    const h1 = document.querySelector('h1');
    h1.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
    const last = posted[posted.length - 1] as { type: string; payload: Record<string, unknown> };
    expect(last).toEqual({ type: 'selectElement', payload: { elementId: h1.getAttribute('data-atlas-el') } });
    expect(isUiSurfaceEditMessage(last)).toBe(true);
  });

  it('swallows a click on a link, so the page cannot navigate', async () => {
    const { document, posted } = await mount();
    const link = [...document.querySelectorAll('a')].find((node: Mounted) => node.textContent === 'ok');
    const event = new document.defaultView.MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(posted[posted.length - 1]).toMatchObject({ type: 'selectElement' });
  });

  it('selects the nearest labelled element for a click on text inside it', async () => {
    const { document, posted } = await mount();
    const li = document.querySelector('li');
    li.firstChild.parentElement.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(posted[posted.length - 1]).toEqual({ type: 'selectElement', payload: { elementId: li.getAttribute('data-atlas-el') } });
  });
});
