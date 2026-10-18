/**
 * The page a person selects elements in: the project's real file, made
 * selectable without letting anything in it run.
 *
 * `uiSurfaceRender` shows a static page with scripts off at the webview and in
 * its policy. Selecting an element needs *a* script — and the rule this module
 * keeps is that it is only ever AtlasMind's: a constant in this file, never
 * built from the page, run under a policy that allows a script only with this
 * render's nonce. The page's own markup is changed in three ways and no other:
 *
 * 1. **Its scripts are removed from what is shown** — every `<script>` element,
 *    every `on…` handler attribute, `srcdoc`, and any URL attribute that is a
 *    `javascript:`, `vbscript:` or `data:text/html` URL. The policy already
 *    refuses all of them; removing them as well means the selection script is
 *    the only script in the document, by the parser's reading *and* the
 *    browser's, so two locks again rather than one.
 * 2. **Every element it can map is labelled with its id** — `data-atlas-el`,
 *    written straight after the tag name so it is the first declaration and wins
 *    over any `data-atlas-*` the file wrote itself (those are removed too). The
 *    insertion points an element offers ride beside it as `data-atlas-before`,
 *    `-in` and `-after`. The ids come from `htmlSourceMap`, built host-side, so
 *    the browser never has to work out where an element came from: it reads a
 *    label the host wrote and posts it back, and the host looks it up again.
 * 3. **`<base>` and `<meta http-equiv="refresh">` are removed**, as the plain
 *    render removes them, and a policy and a base of AtlasMind's go first.
 *
 * Nothing else is touched, and none of it is written to the project: this is
 * the document shown, built from the file and discarded.
 *
 * The webview posts an element id or an insertion point id and nothing else;
 * `isUiSurfaceEditMessage` refuses any other shape. What to do with the element
 * is asked host-side, in VS Code's own pickers, so no value typed for an edit
 * ever passes through a page built from somebody's file.
 *
 * Pure.
 */

import { decodeHtmlText, htmlInsertionPoints } from './uiSurfaceElementEdit.js';
import { HTML_ELEMENT_ID_PATTERN, leadingDoctypeEnd, type HtmlSourceDocument } from './htmlSourceMap.js';
import { UI_SURFACE_RENDER_FALLBACK, UI_SURFACE_RENDER_RULES } from './uiSurfaceRender.js';

// ── What can be edited, by render rule ────────────────────────────

export interface UiSurfaceEditSupport {
  /** A render rule id from `UI_SURFACE_RENDER_RULES` or its fallback. */
  renderRuleId: string;
  supported: boolean;
  statement: string;
}

/**
 * One row per render rule (asserted by test). Only a static page is edited in
 * place; everything else says why not and offers the editor.
 */
export const UI_SURFACE_EDIT_SUPPORT: readonly UiSurfaceEditSupport[] = [
  {
    renderRuleId: 'static-html',
    supported: true,
    statement: 'Select an element in the real file to edit it: its text, an allowlisted attribute, an element from the palette where its parent accepts one, removal, or a move past a sibling. Each is a minimal change to the file, shown before and after and written only when you confirm.',
  },
  {
    renderRuleId: 'framework-component',
    supported: false,
    statement: 'Element editing is not supported for components. UI Studio does not parse JSX, Vue or Svelte templates, and an edit it could not check against the source would be a guess. Open the file in the editor instead.',
  },
  {
    renderRuleId: 'token-stylesheet',
    supported: false,
    statement: 'A stylesheet has no elements to select. Read it into a brand on the Brands view, or open it in the editor.',
  },
  {
    renderRuleId: 'vscode-webview',
    supported: false,
    statement: 'A webview script builds its elements at run time inside its extension, so there is no markup here to select. Open it in the editor.',
  },
  {
    renderRuleId: 'engine-native',
    supported: false,
    statement: 'An engine file is laid out in its engine; its copy is pushed from the Handoff view.',
  },
  {
    renderRuleId: UI_SURFACE_RENDER_FALLBACK.id,
    supported: false,
    statement: 'No declared rule covers this file, so nothing in it is offered for editing.',
  },
];

/** The edit support for a render rule. Total: an unknown rule is unsupported. */
export function uiSurfaceEditSupport(renderRuleId: string): UiSurfaceEditSupport {
  return UI_SURFACE_EDIT_SUPPORT.find(row => row.renderRuleId === renderRuleId)
    ?? UI_SURFACE_EDIT_SUPPORT.find(row => row.renderRuleId === UI_SURFACE_RENDER_FALLBACK.id)!;
}

/** Render rules with no edit-support row. Empty by construction; exported so a test can say so. */
export function renderRulesWithoutEditSupport(): string[] {
  return [...UI_SURFACE_RENDER_RULES, UI_SURFACE_RENDER_FALLBACK]
    .map(rule => rule.id)
    .filter(id => !UI_SURFACE_EDIT_SUPPORT.some(row => row.renderRuleId === id));
}

// ── The document ──────────────────────────────────────────────────

const NONCE = /^[A-Za-z0-9]{16,64}$/;

/** The render policy with one change: a script runs if it carries this render's nonce, and nothing else does. */
export function buildEditableSurfaceCsp(cspSource: string, nonce: string): string {
  if (!NONCE.test(nonce)) {
    throw new Error('A selection nonce is 16–64 letters and digits.');
  }
  const source = cspSource.replace(/[;\s"']/g, '');
  return [
    "default-src 'none'",
    `img-src ${source} data:`,
    `style-src ${source} 'unsafe-inline'`,
    `font-src ${source} data:`,
    `media-src ${source}`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    `base-uri ${source}`,
  ].join('; ');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'background', 'cite', 'longdesc', 'ping',
]);

/**
 * The `data:` media types an edit page keeps: raster images, which are pixels and nothing
 * else. SVG is absent on purpose — it is a document that can carry script.
 */
const RASTER_DATA_URL = /^data:image\/(?:png|gif|jpeg|jpg|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)[;,]/;

/**
 * Whether a URL attribute value could run script if followed. Decoded as the browser
 * decodes it. A `data:` URL is refused unless it is a raster image: naming the one
 * dangerous type (`data:text/html`) left every other one a page can be served as —
 * `application/xhtml+xml`, `image/svg+xml`, `text/xml` — open, and the policy is the
 * second line here, not the first.
 */
function isScriptUrl(raw: string): boolean {
  const decoded = decodeHtmlText(raw);
  const value = (decoded.status === 'decoded' ? decoded.text : raw).replace(/[\u0000- ]/g, '').toLowerCase();
  return value.startsWith('javascript:')
    || value.startsWith('vbscript:')
    || (value.startsWith('data:') && !RASTER_DATA_URL.test(value));
}

export interface EditableSurfaceDocument {
  html: string;
  /** Elements labelled with an id. */
  selectable: number;
  /** Elements that offer at least one insertion point. */
  withInsertionPoints: number;
  removedScripts: number;
  /** Handler attributes and script URLs removed. */
  removedHandlers: number;
  /** The file declares a Content-Security-Policy of its own, which may block the selection script. */
  declaresOwnPolicy: boolean;
  truncated: boolean;
}

interface Splice {
  at: number;
  end: number;
  text: string;
}

/**
 * The file's markup, labelled and stripped of everything that could run, with
 * a policy, a base and the selection script put in front of it.
 */
export function buildEditableSurfaceDocument(input: {
  doc: HtmlSourceDocument;
  baseHref: string;
  cspSource: string;
  nonce: string;
}): EditableSurfaceDocument {
  const { doc } = input;
  const splices: Splice[] = [];
  let selectable = 0;
  let withInsertionPoints = 0;
  let removedScripts = 0;
  let removedHandlers = 0;
  let declaresOwnPolicy = false;
  const value = (attribute: HtmlSourceDocument['elements'][number]['attributes'][number]) =>
    attribute.value ? doc.text.slice(attribute.value.start, attribute.value.end) : '';

  doc.elements.forEach((element, index) => {
    if (element.tagName === 'script') {
      splices.push({ at: element.start, end: element.end, text: '' });
      removedScripts += 1;
      return;
    }
    const httpEquiv = element.tagName === 'meta'
      ? value(element.attributes.find(attribute => attribute.name === 'http-equiv') ?? { name: '', start: 0, end: 0 }).trim().toLowerCase()
      : '';
    if (element.tagName === 'base' || httpEquiv === 'refresh') {
      splices.push({ at: element.start, end: element.end, text: '' });
      return;
    }
    if (httpEquiv === 'content-security-policy') {
      declaresOwnPolicy = true;
    }
    for (const attribute of element.attributes) {
      const strip = attribute.name.startsWith('on')
        || attribute.name.startsWith('data-atlas-')
        || attribute.name === 'srcdoc'
        || (URL_ATTRIBUTES.has(attribute.name) && isScriptUrl(value(attribute)));
      if (strip) {
        // With the whitespace before it, so the tag reads as if it was never there.
        let at = attribute.start;
        while (at > element.nameEnd && /[ \t\r\n\f]/.test(doc.text[at - 1]!)) {
          at -= 1;
        }
        splices.push({ at, end: attribute.end, text: '' });
        if (!attribute.name.startsWith('data-atlas-')) {
          removedHandlers += 1;
        }
      }
    }
    if (doc.truncated) {
      return;
    }
    const labels = [` data-atlas-el="${escapeAttribute(element.id)}"`];
    const points = htmlInsertionPoints(doc, index);
    for (const point of points) {
      labels.push(` data-atlas-${point.position}="${escapeAttribute(point.id)}"`);
    }
    if (points.length > 0) {
      withInsertionPoints += 1;
    }
    selectable += 1;
    splices.push({ at: element.nameEnd, end: element.nameEnd, text: labels.join('') });
  });

  // Back to front, so every offset still means what the parse said it meant.
  splices.sort((a, b) => b.at - a.at || b.end - a.end);
  let body = doc.text;
  for (const splice of splices) {
    body = body.slice(0, splice.at) + splice.text + body.slice(splice.end);
  }
  const baseHref = input.baseHref.endsWith('/') ? input.baseHref : `${input.baseHref}/`;
  const head = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(buildEditableSurfaceCsp(input.cspSource, input.nonce))}">`
    + `<base href="${escapeAttribute(baseHref)}">`
    + `<script nonce="${input.nonce}">${UI_SURFACE_SELECT_SCRIPT}</script>`;
  const doctypeEnd = leadingDoctypeEnd(body);
  return {
    html: doctypeEnd !== undefined ? `${body.slice(0, doctypeEnd)}${head}${body.slice(doctypeEnd)}` : `${head}${body}`,
    selectable,
    withInsertionPoints,
    removedScripts,
    removedHandlers,
    declaresOwnPolicy,
    truncated: doc.truncated,
  };
}

/**
 * The selection script — AtlasMind's own, a constant, and the only script the
 * edit render's policy lets run. It labels nothing and builds nothing from the
 * page: it reads the ids the host wrote, draws an outline and the "+" points in
 * a closed shadow root the page's styles cannot reach, swallows every click so
 * no link or form in the page acts, and posts an id.
 */
export const UI_SURFACE_SELECT_SCRIPT = String.raw`(function () {
  'use strict';
  var vscode = acquireVsCodeApi();
  var ELEMENT_ID = /^e-\d{1,5}(?:\.\d{1,5}){0,255}-\d{1,9}$/;
  var POINT_ID = /^e-\d{1,5}(?:\.\d{1,5}){0,255}-\d{1,9}:(?:in|before|after)$/;
  var POSITIONS = ['before', 'in', 'after'];
  var overlay = null;
  var shadow = null;
  var selected = null;
  var pointStyle = null;

  function owns(node) {
    return overlay !== null && (node === overlay || overlay.contains(node));
  }

  function elementOf(node) {
    while (node && node.nodeType === 1) {
      if (owns(node)) { return null; }
      var id = node.getAttribute('data-atlas-el');
      if (id && ELEMENT_ID.test(id)) { return node; }
      node = node.parentElement;
    }
    return null;
  }

  function part(name) { return shadow.querySelector('[data-part="' + name + '"]'); }

  function place(target, element) {
    var rect = element.getBoundingClientRect();
    target.style.left = rect.left + 'px';
    target.style.top = rect.top + 'px';
    target.style.width = Math.max(rect.width, 2) + 'px';
    target.style.height = Math.max(rect.height, 2) + 'px';
    target.hidden = false;
    return rect;
  }

  function placePoints(rect) {
    POSITIONS.forEach(function (position) {
      var button = part('plus-' + position);
      var id = selected ? selected.getAttribute('data-atlas-' + position) : '';
      var valid = Boolean(id) && POINT_ID.test(id);
      button.hidden = !valid;
      button.setAttribute('data-point', valid ? id : '');
      if (!valid) { return; }
      var top = position === 'before' ? rect.top - 22 : position === 'after' ? rect.bottom + 2 : rect.bottom - 24;
      var left = position === 'in' ? rect.right - 96 : rect.left;
      button.style.top = Math.max(top, 0) + 'px';
      button.style.left = Math.max(left, 0) + 'px';
    });
  }

  function select(element) {
    selected = element;
    placePoints(place(part('selected'), element));
    part('status').textContent = 'Selected ' + element.tagName.toLowerCase() + '. Choose what to do in the menu VS Code opened, or use a + to add an element.';
  }

  function clear() {
    selected = null;
    part('selected').hidden = true;
    POSITIONS.forEach(function (position) { part('plus-' + position).hidden = true; });
  }

  function onClick(event) {
    if (owns(event.target)) { return; }
    event.preventDefault();
    event.stopPropagation();
    var element = elementOf(event.target);
    if (!element) { clear(); return; }
    select(element);
    vscode.postMessage({ type: 'selectElement', payload: { elementId: element.getAttribute('data-atlas-el') } });
  }

  function onHover(event) {
    var element = owns(event.target) ? null : elementOf(event.target);
    var box = part('hover');
    if (!element) { box.hidden = true; return; }
    place(box, element);
  }

  function togglePoints(button) {
    if (pointStyle) {
      pointStyle.remove();
      pointStyle = null;
      button.setAttribute('aria-pressed', 'false');
      return;
    }
    pointStyle = document.createElement('style');
    pointStyle.textContent = '[data-atlas-in]{outline:1px dashed rgba(0,120,212,.75)!important;outline-offset:-1px!important}';
    (document.head || document.documentElement).appendChild(pointStyle);
    button.setAttribute('aria-pressed', 'true');
  }

  function build() {
    overlay = document.createElement('atlasmind-select-overlay');
    overlay.setAttribute('style', 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647');
    shadow = overlay.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<style>'
      + ':host{all:initial}'
      + '.box{position:fixed;box-sizing:border-box;pointer-events:none}'
      + '[data-part=hover]{border:1px solid rgba(0,120,212,.6)}'
      + '[data-part=selected]{border:2px solid #0078d4;background:rgba(0,120,212,.08)}'
      + '.bar{position:fixed;top:6px;right:6px;display:flex;gap:6px;align-items:center;max-width:70vw;padding:4px 6px;border-radius:6px;background:#1e1e1e;color:#fff;font:12px/1.4 system-ui,sans-serif;pointer-events:auto;box-shadow:0 1px 4px rgba(0,0,0,.4)}'
      + '.bar p{margin:0;overflow-wrap:anywhere}'
      + 'button{font:12px system-ui,sans-serif;padding:2px 8px;border-radius:4px;border:1px solid #0078d4;background:#0078d4;color:#fff;cursor:pointer;pointer-events:auto}'
      + 'button[aria-pressed=true]{background:#fff;color:#0078d4}'
      + '.plus{position:fixed}'
      + '[hidden]{display:none!important}'
      + '</style>'
      + '<div class="box" data-part="hover" hidden></div>'
      + '<div class="box" data-part="selected" hidden></div>'
      + '<button type="button" class="plus" data-part="plus-before" hidden>+ before</button>'
      + '<button type="button" class="plus" data-part="plus-in" hidden>+ inside</button>'
      + '<button type="button" class="plus" data-part="plus-after" hidden>+ after</button>'
      + '<div class="bar" role="toolbar" aria-label="Element editing">'
      + '<p data-part="status" role="status">Click an element to edit it.</p>'
      + '<button type="button" data-part="points" aria-pressed="false" title="Outline every element that can take a new one">Show where elements can go</button>'
      + '<button type="button" data-part="list" title="Pick an element from a list instead of clicking">List elements…</button>'
      + '</div>';
    POSITIONS.forEach(function (position) {
      part('plus-' + position).addEventListener('click', function (event) {
        var id = event.currentTarget.getAttribute('data-point');
        if (id && POINT_ID.test(id)) {
          vscode.postMessage({ type: 'insertAt', payload: { pointId: id } });
        }
      });
    });
    part('points').addEventListener('click', function (event) { togglePoints(event.currentTarget); });
    part('list').addEventListener('click', function () { vscode.postMessage({ type: 'listElements' }); });
    document.documentElement.appendChild(overlay);
  }

  function onHostMessage(event) {
    var message = event.data;
    if (!message || typeof message !== 'object') { return; }
    if (message.type === 'atlasSelect' && typeof message.elementId === 'string' && ELEMENT_ID.test(message.elementId)) {
      var nodes = document.querySelectorAll('[data-atlas-el]');
      for (var i = 0; i < nodes.length; i += 1) {
        if (nodes[i].getAttribute('data-atlas-el') === message.elementId) {
          nodes[i].scrollIntoView({ block: 'center' });
          select(nodes[i]);
          return;
        }
      }
    } else if (message.type === 'atlasStatus' && typeof message.text === 'string') {
      part('status').textContent = message.text.slice(0, 400);
    }
  }

  function start() {
    build();
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onClick, true);
    document.addEventListener('submit', function (event) { event.preventDefault(); }, true);
    document.addEventListener('mouseover', onHover, true);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') { clear(); } }, true);
    window.addEventListener('scroll', function () { if (selected) { placePoints(place(part('selected'), selected)); } }, true);
    window.addEventListener('resize', function () { if (selected) { placePoints(place(part('selected'), selected)); } });
    window.addEventListener('message', onHostMessage);
    vscode.postMessage({ type: 'ready' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();`;

// ── Messages from the page ────────────────────────────────────────

export type UiSurfaceEditMessage =
  | { type: 'ready' }
  | { type: 'listElements' }
  | { type: 'selectElement'; payload: { elementId: string } }
  | { type: 'insertAt'; payload: { pointId: string } };

const POINT_ID = /^e-\d{1,5}(?:\.\d{1,5}){0,255}-\d{1,9}:(?:in|before|after)$/;

/**
 * An id, or nothing. The page the message comes from was built from somebody
 * else's file, so the shape is exact: one key, one string, matching the id
 * pattern. The host then looks the id up in a fresh parse.
 */
export function isUiSurfaceEditMessage(input: unknown): input is UiSurfaceEditMessage {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const message = input as Record<string, unknown>;
  const keys = Object.keys(message);
  if (message['type'] === 'ready' || message['type'] === 'listElements') {
    return keys.length === 1;
  }
  if (keys.length !== 2 || typeof message['payload'] !== 'object' || message['payload'] === null || Array.isArray(message['payload'])) {
    return false;
  }
  const payload = message['payload'] as Record<string, unknown>;
  const payloadKeys = Object.keys(payload);
  if (message['type'] === 'selectElement') {
    return payloadKeys.length === 1 && typeof payload['elementId'] === 'string' && HTML_ELEMENT_ID_PATTERN.test(payload['elementId']);
  }
  if (message['type'] === 'insertAt') {
    return payloadKeys.length === 1 && typeof payload['pointId'] === 'string' && POINT_ID.test(payload['pointId']);
  }
  return false;
}

// ── What is on screen ─────────────────────────────────────────────

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The sentence the Studio's card shows while an edit render is open. */
export function describeUiSurfaceEditRender(state: { path: string; modifiedAt: string; document: EditableSurfaceDocument }): string {
  const { document } = state;
  if (document.truncated) {
    return `Real file at ${state.path}, as of ${state.modifiedAt}, shown for editing — but it is too large or too deeply nested to map completely, so nothing in it is offered for editing. Edit it in the editor.`;
  }
  const removed = [
    document.removedScripts > 0 ? `${plural(document.removedScripts, 'script')}` : '',
    document.removedHandlers > 0 ? `${plural(document.removedHandlers, 'handler or script URL')}` : '',
  ].filter(Boolean);
  return [
    `Editing elements of ${state.path} — the real file, as of ${state.modifiedAt}.`,
    `${plural(document.selectable, 'element')} selectable; ${document.withInsertionPoints} can take a new element ("Show where elements can go" outlines them).`,
    `The page's own scripts do not run${removed.length > 0 ? ` (${removed.join(' and ')} left out of what is shown)` : ''}; the only script is AtlasMind's selection script.`,
    document.declaresOwnPolicy ? 'The page declares its own Content-Security-Policy; if nothing can be selected, that policy is blocking the selection script.' : '',
  ].filter(Boolean).join(' ');
}
