/**
 * The bit the client actually touches.
 *
 * The strategy document called client comment-on-element the strongest
 * differentiator available and noted the hard part honestly: it needs a
 * rendezvous point, and AtlasMind is a local extension with a deny-by-default
 * posture and a stated "no hosted SaaS" rule.
 *
 * **This resolves that rather than ignoring it.** The review UI is *generated
 * into the site*, so it travels wherever the site does — including the
 * password-protected staging environment the Stack page already sets up, on the
 * client's own hosting, which AtlasMind never touches. Comments come back either
 * as a file the client exports and sends, or by POST to a webhook the team
 * already owns and has declared. **AtlasMind hosts nothing and stores nothing on
 * anybody's behalf.** The trade-off — no live presence, no cross-client threads —
 * is recorded in the decision record rather than discovered later.
 *
 * Three rules hold this together.
 *
 * **The overlay script is a declared constant.** It is the one and only place
 * generated output carries JavaScript, so it is written here, in full, by hand.
 * No model writes it, nothing is interpolated into its body, and a test asserts
 * the shipped script is byte-identical to the constant. Everything variable —
 * the page id, the element list, the endpoint — is passed as **JSON in a
 * `data-` attribute**, never spliced into code.
 *
 * **No endpoint is ever invented.** With no declared webhook the overlay is
 * export-only: it downloads a file. It never guesses a URL, and it never
 * silently falls back to one.
 *
 * **Everything coming back is untrusted twice over** — third-party text that has
 * been through a browser we do not control, possibly on a machine we know
 * nothing about. Import runs through the same sanitizer as the workspace file.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { WebsitePagePlan } from '../types.js';
import { wireframeKindSpec } from './websiteWireframe.js';
import { sanitizeReviewRecord, type WebsiteReviewComment, type WebsiteReviewRecord } from './websiteReviewComments.js';

/**
 * The overlay's runtime.
 *
 * Hand-written and frozen. It reads its configuration from
 * `#atlas-review[data-review]` rather than having anything interpolated into it,
 * so no value from the workspace — a page title, an element label, a URL — can
 * become code. A test pins that the emitted script equals this constant exactly.
 *
 * Deliberately small and dependency-free: it runs on a client's machine, in a
 * browser we have never seen, with no build step and no network except the one
 * optional POST.
 */
export const REVIEW_OVERLAY_SCRIPT = `(function () {
  'use strict';
  var mount = document.getElementById('atlas-review');
  if (!mount) { return; }

  var config;
  try { config = JSON.parse(mount.getAttribute('data-review') || '{}'); }
  catch (error) { return; }

  var storageKey = 'atlas-review:' + (config.pageId || 'page');
  var comments = [];
  try { comments = JSON.parse(localStorage.getItem(storageKey) || '[]'); }
  catch (error) { comments = []; }

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(comments)); } catch (error) { /* private mode */ }
    render();
  }

  function targetFor(node) {
    while (node && node !== document.body) {
      if (node.hasAttribute && node.hasAttribute('data-atlas-element')) { return node; }
      node = node.parentNode;
    }
    return null;
  }

  var armed = false;

  function onPick(event) {
    if (!armed) { return; }
    var host = targetFor(event.target);
    if (!host) { return; }
    event.preventDefault();
    event.stopPropagation();
    armed = false;
    document.body.classList.remove('atlas-review-arming');
    var text = window.prompt('Feedback on "' + (host.getAttribute('data-atlas-label') || 'this') + '"');
    if (!text) { return; }
    comments.push({
      id: 'rc-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
      pageId: config.pageId,
      elementId: host.getAttribute('data-atlas-element'),
      elementLabel: host.getAttribute('data-atlas-label') || '',
      body: text,
      author: currentAuthor(),
      status: 'open',
      round: config.round || 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    persist();
  }

  function currentAuthor() {
    var stored = '';
    try { stored = localStorage.getItem('atlas-review:author') || ''; } catch (error) { stored = ''; }
    if (stored) { return stored; }
    var asked = window.prompt('Your name, so the team knows who left this') || 'Client';
    try { localStorage.setItem('atlas-review:author', asked); } catch (error) { /* ignore */ }
    return asked;
  }

  function exportFile() {
    var payload = { version: 1, pageId: config.pageId, comments: comments };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'feedback-' + (config.pageId || 'page') + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function send() {
    if (!config.endpoint) { return; }
    var status = document.getElementById('atlas-review-status');
    if (status) { status.textContent = 'Sending…'; }
    fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, pageId: config.pageId, comments: comments })
    }).then(function (response) {
      if (status) { status.textContent = response.ok ? 'Sent. Thank you.' : 'Could not send — use Download instead.'; }
    }).catch(function () {
      if (status) { status.textContent = 'Could not send — use Download instead.'; }
    });
  }

  function render() {
    var list = document.getElementById('atlas-review-list');
    if (!list) { return; }
    list.textContent = '';
    comments.forEach(function (comment, index) {
      var row = document.createElement('li');
      var label = document.createElement('strong');
      label.textContent = comment.elementLabel || 'This page';
      var body = document.createElement('span');
      body.textContent = comment.body;
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () { comments.splice(index, 1); persist(); });
      row.appendChild(label);
      row.appendChild(body);
      row.appendChild(remove);
      list.appendChild(row);
    });
    var count = document.getElementById('atlas-review-count');
    if (count) { count.textContent = String(comments.length); }
  }

  document.addEventListener('click', onPick, true);

  var addButton = document.getElementById('atlas-review-add');
  if (addButton) {
    addButton.addEventListener('click', function () {
      armed = true;
      document.body.classList.add('atlas-review-arming');
    });
  }
  var downloadButton = document.getElementById('atlas-review-download');
  if (downloadButton) { downloadButton.addEventListener('click', exportFile); }
  var sendButton = document.getElementById('atlas-review-send');
  if (sendButton) { sendButton.addEventListener('click', send); }

  render();
}());`;

/** Styling for the overlay. Also a constant; nothing is interpolated. */
export const REVIEW_OVERLAY_STYLE = `#atlas-review-panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: 300px; max-height: 60vh; overflow: auto; padding: 14px;
  font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; color: #0f172a;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, .18);
}
#atlas-review-panel h2 { margin: 0 0 4px; font-size: .95rem; }
#atlas-review-panel p { margin: 0 0 10px; color: #475569; font-size: .8rem; }
#atlas-review-panel button {
  font: inherit; font-size: .78rem; padding: 5px 11px; margin: 0 6px 6px 0;
  border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; cursor: pointer;
}
#atlas-review-panel button:hover { background: #eef2f7; }
#atlas-review-add { background: #2563eb !important; border-color: #2563eb !important; color: #fff; }
#atlas-review-list { list-style: none; margin: 10px 0 0; padding: 0; }
#atlas-review-list li {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 8px;
  padding: 8px 0; border-top: 1px solid #e2e8f0;
}
#atlas-review-list strong { font-size: .78rem; }
#atlas-review-list span { grid-column: 1; font-size: .8rem; color: #334155; }
#atlas-review-list button { grid-row: 1 / span 2; grid-column: 2; align-self: start; margin: 0; }
#atlas-review-status { display: block; margin-top: 8px; font-size: .75rem; color: #475569; }
body.atlas-review-arming [data-atlas-element]:hover {
  outline: 2px solid #2563eb !important; outline-offset: 2px; cursor: crosshair !important;
}`;

export interface ReviewOverlayOptions {
  page: WebsitePagePlan;
  round: number;
  /**
   * Where comments POST to, when the team has declared one.
   *
   * Absent means **export-only**. No endpoint is ever invented or defaulted: a
   * guessed URL would send a client's feedback to a stranger.
   */
  endpoint?: string;
}

export interface ReviewOverlay {
  /** Markup to insert before `</body>`. */
  html: string;
  /** CSS to insert into `<head>`. */
  css: string;
  /** The script, byte-identical to `REVIEW_OVERLAY_SCRIPT`. */
  script: string;
  /**
   * The CSP the page needs while review mode is on. Stated rather than assumed,
   * because it is strictly wider than the ordinary preview policy and must only
   * ever apply to a review build.
   */
  contentSecurityPolicy: string;
}

/**
 * Build the overlay for one page.
 *
 * The configuration goes into a `data-` attribute as JSON, escaped for an
 * attribute context. That is the whole reason the script can be a frozen
 * constant: no page title, element label or URL is ever spliced into executable
 * text.
 */
export function buildReviewOverlay(options: ReviewOverlayOptions): ReviewOverlay {
  const endpoint = sanitizeEndpoint(options.endpoint);
  const config = {
    pageId: options.page.id,
    round: Math.max(1, Math.floor(options.round)),
    ...(endpoint ? { endpoint } : {}),
  };

  const html = `<div id="atlas-review" hidden data-review="${escapeAttribute(JSON.stringify(config))}"></div>
<aside id="atlas-review-panel" aria-label="Review feedback">
  <h2>Leave feedback</h2>
  <p>Click <strong>Comment on something</strong>, then click the part of the page you mean.</p>
  <button type="button" id="atlas-review-add">Comment on something</button>
  <button type="button" id="atlas-review-download">Download (<span id="atlas-review-count">0</span>)</button>
  ${endpoint ? '<button type="button" id="atlas-review-send">Send to the team</button>' : ''}
  <span id="atlas-review-status">${endpoint
    ? 'Send when you are done, or download the file and email it.'
    : 'Download the file when you are done and send it to the team.'}</span>
  <ul id="atlas-review-list"></ul>
</aside>`;

  return {
    html,
    css: REVIEW_OVERLAY_STYLE,
    script: REVIEW_OVERLAY_SCRIPT,
    contentSecurityPolicy: buildReviewCsp(endpoint),
  };
}

/**
 * The policy a review page runs under.
 *
 * Wider than the ordinary preview's `default-src 'none'` — it has to be, since
 * the overlay is script — but only by what the overlay actually needs, and
 * `connect-src` names the single declared endpoint rather than opening the
 * network. With no endpoint, `connect-src` stays `'none'`: an export-only build
 * cannot make a request at all.
 */
export function buildReviewCsp(endpoint: string | undefined): string {
  return [
    "default-src 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // The overlay is same-origin, served from the site itself.
    "script-src 'self'",
    endpoint ? `connect-src ${new URL(endpoint).origin}` : "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * The attributes an element needs to be commentable.
 *
 * Emitted into generated markup so the overlay can find a target. Just an id and
 * a human label — nothing that could carry behaviour.
 */
export function reviewAttributesFor(elementId: string, label: string): string {
  return `data-atlas-element="${escapeAttribute(elementId)}" data-atlas-label="${escapeAttribute(label)}"`;
}

/**
 * The instruction added to a generation prompt when review mode is on.
 *
 * The model adds the attributes; it never writes the overlay itself.
 */
export function reviewGenerationInstruction(page: WebsitePagePlan): string {
  const elements = page.wireframe?.elements ?? [];
  if (elements.length === 0) {
    return '';
  }
  return [
    'REVIEW MODE IS ON. Every top-level section you emit must carry two attributes so the client can',
    'comment on it: data-atlas-element="<the element id below>" and data-atlas-label="<its label>".',
    'Add nothing else for review — no script, no panel. AtlasMind injects those itself.',
    '',
    'Element ids and labels for this page:',
    ...elements.map(element => `  ${element.id} = ${element.label || wireframeKindSpec(element.kind).label}`),
  ].join('\n');
}

/**
 * Put the overlay into a generated page.
 *
 * Done here, after generation, rather than by asking the model to emit it. The
 * model adds the `data-atlas-element` attributes — which are inert — and
 * AtlasMind adds the script, the styling and the policy. That split is the whole
 * reason the script can be a frozen constant: if the model wrote it, it would be
 * different every time and reviewable never.
 *
 * The page's own `<meta http-equiv="Content-Security-Policy">` is replaced
 * rather than added to, because two policies intersect and the generated page's
 * `default-src 'none'` would forbid the overlay's own script.
 */
export function injectReviewOverlay(html: string, overlay: ReviewOverlay): string {
  if (!html.includes('</body>')) {
    // Not a document we recognise. Returning it untouched is better than
    // guessing at where the end is and corrupting the page.
    return html;
  }

  const withoutOldCsp = html.replace(
    /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi,
    '',
  );

  const head = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(overlay.contentSecurityPolicy)}" />\n`
    + `<style>${overlay.css}</style>\n`;

  const withHead = withoutOldCsp.includes('</head>')
    ? withoutOldCsp.replace('</head>', `${head}</head>`)
    : `${head}${withoutOldCsp}`;

  return withHead.replace(
    '</body>',
    `${overlay.html}\n<script src="${REVIEW_OVERLAY_FILENAME}"></script>\n</body>`,
  );
}

/**
 * Where the overlay script is written in the preview root.
 *
 * A separate file rather than inline, so the page's `script-src 'self'` needs no
 * `unsafe-inline` — a nonce would have to change per render and an inline script
 * would mean loosening the policy for every generated page.
 */
export const REVIEW_OVERLAY_FILENAME = 'atlas-review.js';

// ── Importing feedback ───────────────────────────────────────────

export interface ImportResult {
  /** Comments accepted and merged. */
  imported: WebsiteReviewComment[];
  /** Comments already present, matched by id — an import is idempotent. */
  duplicates: number;
  /** Comments naming a page or element the workspace does not have. Reported, kept. */
  unresolved: { commentId: string; reason: string }[];
  /** Entries that could not be read at all. */
  rejected: number;
  record: WebsiteReviewRecord;
}

/**
 * Merge exported feedback into the review record.
 *
 * Everything here has been through a browser on somebody else's machine, so it
 * is run through the same sanitizer as the workspace file rather than a lighter
 * one. Two things it deliberately does *not* do:
 *
 * - **It does not drop a comment naming an unknown element.** That is reported
 *   as unresolved and kept, because the likeliest cause is that the element was
 *   deleted after the client looked — which is exactly the feedback somebody
 *   needs to see.
 * - **It does not overwrite an existing comment.** A re-imported file is
 *   idempotent: same ids, no duplicates, no status reset. A client who sends the
 *   same export twice must not un-resolve the work already done on it.
 */
export function importReviewFeedback(
  record: WebsiteReviewRecord,
  raw: unknown,
  pages: readonly WebsitePagePlan[],
): ImportResult {
  const source = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};
  const rawCount = Array.isArray(source['comments']) ? source['comments'].length : 0;

  // Reuse the record sanitizer wholesale rather than writing a second, looser
  // one for imports — a second parser is how the two drift.
  const incoming = sanitizeReviewRecord({ comments: source['comments'] }).comments;

  const knownPages = new Set(pages.map(page => page.id));
  const knownElements = new Set<string>();
  for (const page of pages) {
    for (const element of page.wireframe?.elements ?? []) {
      knownElements.add(element.id);
    }
  }

  const existing = new Map(record.comments.map(comment => [comment.id, comment]));
  const imported: WebsiteReviewComment[] = [];
  const unresolved: { commentId: string; reason: string }[] = [];
  let duplicates = 0;

  for (const comment of incoming) {
    if (existing.has(comment.id)) {
      duplicates += 1;
      continue;
    }
    if (!knownPages.has(comment.pageId)) {
      unresolved.push({ commentId: comment.id, reason: `names a page that is not in this workspace (${comment.pageId})` });
    } else if (comment.elementId && !knownElements.has(comment.elementId)) {
      unresolved.push({ commentId: comment.id, reason: 'was left on an element that no longer exists' });
    }
    imported.push(comment);
    existing.set(comment.id, comment);
  }

  return {
    imported,
    duplicates,
    unresolved,
    rejected: Math.max(0, rawCount - incoming.length),
    record: {
      ...record,
      updatedAt: new Date().toISOString(),
      comments: [...record.comments, ...imported],
    },
  };
}

/** A sentence for the notification. Names every non-ideal outcome. */
export function describeImport(result: ImportResult): string {
  if (result.imported.length === 0 && result.duplicates === 0) {
    return result.rejected > 0
      ? `No feedback could be read from that file — ${result.rejected} entr${result.rejected === 1 ? 'y was' : 'ies were'} malformed.`
      : 'That file contained no feedback.';
  }
  const parts = [`Imported ${result.imported.length} comment${result.imported.length === 1 ? '' : 's'}.`];
  if (result.duplicates > 0) {
    parts.push(`${result.duplicates} ${result.duplicates === 1 ? 'was' : 'were'} already recorded and left as ${result.duplicates === 1 ? 'it is' : 'they are'}.`);
  }
  if (result.unresolved.length > 0) {
    parts.push(`${result.unresolved.length} refer${result.unresolved.length === 1 ? 's' : ''} to something no longer in the workspace and ${result.unresolved.length === 1 ? 'is' : 'are'} kept flagged.`);
  }
  if (result.rejected > 0) {
    parts.push(`${result.rejected} could not be read.`);
  }
  return parts.join(' ');
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * A webhook we are willing to POST to.
 *
 * `https` only, no credentials in the URL, and returned as the parsed form so
 * the CSP origin and the request target cannot disagree. Anything else yields
 * `undefined`, which means export-only — never a fallback endpoint.
 */
export function sanitizeEndpoint(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
