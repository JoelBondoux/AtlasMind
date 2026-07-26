import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';

import { PANEL_NAV_JS } from '../../src/views/panelNav.ts';

/**
 * The shared vertical tab controller.
 *
 * The page-based panels shipped a container declaring `role="tablist"` whose children
 * were plain buttons — no `role="tab"`, no `aria-selected`, no `aria-controls`,
 * no `role="tabpanel"`, no roving tabindex and no keyboard handling of any
 * kind. This exercises the replacement against a minimal DOM stand-in rather
 * than trusting the markup by inspection.
 */

interface FakeElement {
  tagName: string;
  id: string;
  hidden: boolean;
  disabled: boolean;
  tabIndex: number;
  attributes: Record<string, string>;
  classes: Set<string>;
  focused: boolean;
  classList: { toggle: (name: string, on?: boolean) => void; contains: (name: string) => boolean };
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  focus: () => void;
  closest: (selector: string) => FakeElement | null;
}

function makeElement(tagName: string, attributes: Record<string, string> = {}): FakeElement {
  const el: FakeElement = {
    tagName,
    id: attributes['id'] ?? '',
    hidden: false,
    disabled: false,
    tabIndex: 0,
    attributes: { ...attributes },
    classes: new Set<string>(),
    focused: false,
    classList: {
      toggle: (name, on) => {
        const shouldHave = on ?? !el.classes.has(name);
        if (shouldHave) { el.classes.add(name); } else { el.classes.delete(name); }
      },
      contains: name => el.classes.has(name),
    },
    setAttribute: (name, value) => { el.attributes[name] = value; },
    getAttribute: name => el.attributes[name] ?? null,
    focus: () => { el.focused = true; },
    // Only ever called with '[role="tab"]' by the controller.
    closest: selector => (selector === '[role="tab"]' && el.attributes['role'] === 'tab' ? el : null),
  };
  return el;
}

/** Build a tablist + panels and run the controller against them. */
function mountNav(pageIds: string[], options: { orientation?: string } = {}) {
  const buttons = pageIds.map(id => makeElement('BUTTON', { 'data-page-target': id }));
  const pages = pageIds.map(id => makeElement('SECTION', { id: `page-${id}` }));

  const tablistAttributes: Record<string, string> = {};
  if (options.orientation) { tablistAttributes['aria-orientation'] = options.orientation; }
  const tablist = makeElement('NAV', tablistAttributes);

  let keydownHandler: ((event: Record<string, unknown>) => void) | null = null;
  const tablistWithListener = Object.assign(tablist, {
    querySelectorAll: () => buttons,
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
      if (type === 'keydown') { keydownHandler = handler; }
    },
  });

  const documentStub = {
    querySelector: () => tablistWithListener,
    querySelectorAll: () => pages,
  };

  // `HTMLElement` has to exist in the sandbox: the controller guards its
  // keydown handler with `event.target instanceof HTMLElement`, and an
  // undefined global there throws rather than simply evaluating false.
  class FakeHTMLElement {}
  const isFakeElement = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && 'closest' in (value as object);
  Object.defineProperty(FakeHTMLElement, Symbol.hasInstance, { value: isFakeElement });

  const factory = new Function('document', 'HTMLElement', `
    ${PANEL_NAV_JS}
    return createPanelNav;
  `) as (doc: unknown, htmlElement: unknown) => (opts?: unknown) => {
    activate: (id: string) => void;
    getActive: () => string;
    pageIds: string[];
  };

  const created = factory(documentStub, FakeHTMLElement);
  const captured: string[] = [];
  const nav = created({ onActivate: (id: string) => captured.push(id) });

  const press = (key: string, fromIndex: number) => {
    const event = {
      key,
      target: buttons[fromIndex],
      preventDefault: () => { (event as Record<string, unknown>)['defaultPrevented'] = true; },
    };
    keydownHandler?.(event);
    return event;
  };

  return { nav, buttons, pages, press, captured };
}

describe('createPanelNav — ARIA upgrade', () => {
  let mounted: ReturnType<typeof mountNav>;

  beforeEach(() => {
    mounted = mountNav(['overview', 'catalog', 'settings']);
  });

  it('gives every nav button real tab semantics', () => {
    for (const [index, id] of ['overview', 'catalog', 'settings'].entries()) {
      const button = mounted.buttons[index]!;
      expect(button.getAttribute('role')).toBe('tab');
      expect(button.id).toBe(`tab-${id}`);
      expect(button.getAttribute('aria-controls')).toBe(`page-${id}`);
    }
  });

  it('gives every section tabpanel semantics pointing back at its tab', () => {
    for (const [index, id] of ['overview', 'catalog', 'settings'].entries()) {
      const page = mounted.pages[index]!;
      expect(page.getAttribute('role')).toBe('tabpanel');
      expect(page.getAttribute('aria-labelledby')).toBe(`tab-${id}`);
    }
  });
});

describe('createPanelNav — activation', () => {
  it('marks exactly one tab selected and shows only its panel', () => {
    const { nav, buttons, pages } = mountNav(['overview', 'catalog', 'settings']);
    nav.activate('catalog');

    expect(buttons.map(b => b.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(buttons.map(b => b.classList.contains('active'))).toEqual([false, true, false]);
    expect(pages.map(p => p.hidden)).toEqual([true, false, true]);
    expect(pages.map(p => p.classList.contains('active'))).toEqual([false, true, false]);
  });

  it('keeps a single tab stop via roving tabindex', () => {
    // Without this, reaching the last tab took one Tab press per tab.
    const { nav, buttons } = mountNav(['overview', 'catalog', 'settings']);
    nav.activate('settings');
    expect(buttons.map(b => b.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('ignores an unknown page id instead of blanking every panel', () => {
    // Several panels activate from a persisted state value that may name a
    // page which no longer exists.
    const { nav, buttons, pages } = mountNav(['overview', 'catalog']);
    nav.activate('overview');
    nav.activate('a-page-that-was-removed');

    expect(nav.getActive()).toBe('overview');
    expect(buttons[0]!.getAttribute('aria-selected')).toBe('true');
    expect(pages.some(p => !p.hidden)).toBe(true);
  });

  it('reports activations through onActivate for panel-specific work', () => {
    // Two panels persist the active page to webview state this way.
    const { nav, captured } = mountNav(['overview', 'catalog']);
    nav.activate('catalog');
    nav.activate('overview');
    expect(captured).toEqual(['catalog', 'overview']);
  });
});

describe('createPanelNav — keyboard', () => {
  it('moves with Down/Up on a vertical tablist and wraps at both ends', () => {
    const { nav, buttons, press } = mountNav(['a', 'b', 'c']);
    nav.activate('a');

    press('ArrowDown', 0);
    expect(nav.getActive()).toBe('b');
    expect(buttons[1]!.focused).toBe(true);

    press('ArrowUp', 1);
    expect(nav.getActive()).toBe('a');

    press('ArrowUp', 0);
    expect(nav.getActive()).toBe('c');

    press('ArrowDown', 2);
    expect(nav.getActive()).toBe('a');
  });

  it('supports Home and End', () => {
    const { nav, press } = mountNav(['a', 'b', 'c']);
    nav.activate('b');
    press('End', 1);
    expect(nav.getActive()).toBe('c');
    press('Home', 2);
    expect(nav.getActive()).toBe('a');
  });

  it('skips tabs hidden by the panel search filter', () => {
    // A tab filtered out of view must not be reachable by arrow key either.
    const { nav, buttons, press } = mountNav(['a', 'b', 'c']);
    nav.activate('a');
    buttons[1]!.classList.toggle('hidden-by-search', true);

    press('ArrowDown', 0);
    expect(nav.getActive()).toBe('c');
  });

  it('prevents default so the panel does not scroll under the arrow key', () => {
    const { nav, press } = mountNav(['a', 'b']);
    nav.activate('a');
    const event = press('ArrowDown', 0) as Record<string, unknown>;
    expect(event['defaultPrevented']).toBe(true);
  });

  it('leaves unrelated keys alone', () => {
    const { nav, press } = mountNav(['a', 'b']);
    nav.activate('a');
    press('Tab', 0);
    press('x', 0);
    expect(nav.getActive()).toBe('a');
  });

  it('honours a horizontal orientation', () => {
    const { nav, press } = mountNav(['a', 'b'], { orientation: 'horizontal' });
    nav.activate('a');
    press('ArrowRight', 0);
    expect(nav.getActive()).toBe('b');
  });
});

describe('panels adopting the shared nav', () => {
  const VIEWS = path.join(process.cwd(), 'src', 'views');

  // Settings is deliberately exempt. It is the one panel that already
  // implemented the tabs pattern properly — real `role="tab"`, `aria-selected`,
  // `role="tabpanel"`, keyboard handling — and it does so on top of a
  // progressive-enhancement fallback (`fallback-visible` / `settings-pages-ready`)
  // that keeps sections reachable as plain anchors if the script never boots.
  // Swapping that for the shared controller would trade a working, more capable
  // implementation for uniformity. It is covered by its own test below instead.
  const EXEMPT = new Set(['settingsPanel.ts', 'panelNav.ts']);

  const panelsWithTablist = readdirSync(VIEWS)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !EXEMPT.has(file))
    .map(file => ({ file, text: readFileSync(path.join(VIEWS, file), 'utf8') }))
    .filter(({ text }) => text.includes('role="tablist"'));

  it('finds the panels that declare a tablist', () => {
    expect(panelsWithTablist.length).toBeGreaterThanOrEqual(6);
  });

  it('settings keeps its own, already-correct tab implementation', () => {
    const text = readFileSync(path.join(VIEWS, 'settingsPanel.ts'), 'utf8');
    expect(text).toContain('role="tab"');
    expect(text).toContain('aria-selected');
    expect(text).toContain('role="tabpanel"');
    expect(text).toContain('keydown');
  });

  it.each(panelsWithTablist.map(p => p.file))('%s uses createPanelNav', file => {
    const text = readFileSync(path.join(VIEWS, file), 'utf8');
    expect(text).toContain('PANEL_NAV_JS');
    expect(text).toContain('createPanelNav(');
  });

  it.each(panelsWithTablist.map(p => p.file))('%s no longer hand-rolls activatePage', file => {
    const text = readFileSync(path.join(VIEWS, file), 'utf8');
    // The old body toggled page.hidden directly inside activatePage.
    const handRolled = /function activatePage\([\s\S]{0,600}?page\.hidden = /.test(text);
    expect(handRolled, `${file} still contains a bespoke activatePage body`).toBe(false);
  });
});
