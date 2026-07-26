/**
 * Shared vertical tab navigation for AtlasMind webview panels.
 *
 * Seven panels — Voice, Vision, Specialist Integrations, Tool Webhooks, Model
 * Providers, Agent Manager and MCP — each shipped their own copy of the same
 * nav, and each copy had the same accessibility gap: a container declaring
 * `role="tablist"` whose children were plain buttons. No `role="tab"`, no
 * `aria-selected`, no `aria-controls`, no `role="tabpanel"` on the sections, no
 * roving `tabindex`, and no keyboard handling at all — so a screen reader was
 * promised a tab list and found unrelated buttons, and reaching the last tab
 * took one Tab press per tab.
 *
 * ## Why this upgrades markup instead of replacing it
 *
 * Every one of those panels already agrees on the same conventions:
 *
 * - a nav container with `role="tablist"`
 * - `<button data-page-target="X">` for each tab
 * - `<section id="page-X" class="panel-page">` for each panel
 * - a local `activatePage(pageId)` that toggles `.active` and `hidden`
 *
 * So rather than rewrite seven sets of markup — and risk seven visual
 * regressions — {@link PANEL_NAV_JS} adds the missing ARIA at runtime and takes
 * over activation and keyboard handling. Each panel keeps its own markup,
 * classes and styling untouched; it swaps its bespoke `activatePage` body for a
 * call into the shared one, and passes any extra work (state persistence,
 * re-running a search filter) through `onActivate`.
 */

/**
 * Client-side tab controller. Inject into a panel's inline `scriptContent`,
 * then create it once the DOM exists:
 *
 * ```js
 * const panelNav = createPanelNav({
 *   onActivate: (pageId) => vscode.setState({ ...vscode.getState(), pageId }),
 * });
 * function activatePage(pageId) { panelNav.activate(pageId); }
 * ```
 *
 * `activate()` is idempotent and safe to call with an unknown id, which is
 * simply ignored — several panels activate from a persisted state value that
 * may name a page that no longer exists.
 */
export const PANEL_NAV_JS = `
function createPanelNav(options) {
  const opts = options || {};
  const tablistSelector = opts.tablist || '[role="tablist"]';
  const buttonSelector = opts.buttonSelector || '[data-page-target]';
  const pageSelector = opts.pageSelector || '.panel-page';
  const pageIdPrefix = opts.pageIdPrefix || 'page-';
  const onActivate = typeof opts.onActivate === 'function' ? opts.onActivate : null;

  const tablist = document.querySelector(tablistSelector);
  const buttons = Array.from(tablist ? tablist.querySelectorAll(buttonSelector) : []);
  const pages = Array.from(document.querySelectorAll(pageSelector));

  const pageIdOf = button => button.getAttribute('data-page-target') || '';

  // Add the tab semantics the markup never declared. Ids are derived from the
  // page id so the tab ↔ panel pairing cannot drift.
  buttons.forEach(button => {
    const pageId = pageIdOf(button);
    if (!pageId) { return; }
    button.setAttribute('role', 'tab');
    button.id = 'tab-' + pageId;
    button.setAttribute('aria-controls', pageIdPrefix + pageId);
  });

  pages.forEach(page => {
    const pageId = page.id.startsWith(pageIdPrefix) ? page.id.slice(pageIdPrefix.length) : '';
    if (!pageId) { return; }
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', 'tab-' + pageId);
  });

  // A tab hidden by the panel's search filter must not be reachable by arrow
  // key — it is not reachable by eye either.
  const isNavigable = button =>
    !button.classList.contains('hidden-by-search') && !button.hidden && !button.disabled;

  let currentPageId = '';

  function activate(pageId) {
    if (!pageId) { return; }
    const known = buttons.some(button => pageIdOf(button) === pageId)
      || pages.some(page => page.id === pageIdPrefix + pageId);
    if (!known) { return; }

    currentPageId = pageId;

    buttons.forEach(button => {
      const isActive = pageIdOf(button) === pageId;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      // Roving tabindex: exactly one tab stop for the whole tablist, so Tab
      // moves past the nav rather than through every item in it.
      button.tabIndex = isActive ? 0 : -1;
    });

    pages.forEach(page => {
      const isActive = page.id === pageIdPrefix + pageId;
      page.classList.toggle('active', isActive);
      page.hidden = !isActive;
    });

    if (onActivate) { onActivate(pageId); }
  }

  function focusTab(index) {
    const navigable = buttons.filter(isNavigable);
    if (navigable.length === 0) { return; }
    const wrapped = (index + navigable.length) % navigable.length;
    const target = navigable[wrapped];
    activate(pageIdOf(target));
    target.focus();
  }

  if (tablist) {
    tablist.addEventListener('keydown', event => {
      const button = event.target instanceof HTMLElement ? event.target.closest('[role="tab"]') : null;
      if (!button) { return; }

      // Honour the declared orientation: these navs are vertical, so Up/Down is
      // the primary axis, but Left/Right is accepted too rather than swallowed.
      const vertical = tablist.getAttribute('aria-orientation') !== 'horizontal';
      const next = vertical ? 'ArrowDown' : 'ArrowRight';
      const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
      const alsoNext = vertical ? 'ArrowRight' : 'ArrowDown';
      const alsoPrevious = vertical ? 'ArrowLeft' : 'ArrowUp';

      const navigable = buttons.filter(isNavigable);
      const at = navigable.indexOf(button);
      if (at === -1) { return; }

      if (event.key === next || event.key === alsoNext) { event.preventDefault(); focusTab(at + 1); return; }
      if (event.key === previous || event.key === alsoPrevious) { event.preventDefault(); focusTab(at - 1); return; }
      if (event.key === 'Home') { event.preventDefault(); focusTab(0); return; }
      if (event.key === 'End') { event.preventDefault(); focusTab(navigable.length - 1); return; }
    });
  }

  return {
    activate: activate,
    getActive: () => currentPageId,
    pageIds: buttons.map(pageIdOf).filter(Boolean),
  };
}
`;
